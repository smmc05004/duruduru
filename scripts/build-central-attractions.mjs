#!/usr/bin/env node

/**
 * 기초지자체 중심 관광지 수집기 (T3).
 *
 * 기획서 D2(`docs/product/TOURISM_RECOMMENDATION_UPGRADE.md`)를 따른다.
 *
 * - 원천: `LocgoHubTarService1/areaBasedList1` (공식 설명 https://www.data.go.kr/data/15128559/openapi.do).
 *   키 = `CENTRAL_ATTRACTION_API_SERVICE_KEY`(서버 전용). 디코딩 키를 넣으면 URLSearchParams가
 *   한 번만 인코딩한다. 키·키 포함 URL은 로그/JSON/에러에 남기지 않는다.
 * - `baseYm` = 202608 고정. 지역별 과거 월 자동 탐색·혼합 금지.
 * - `areaCd` = lDongRegnCd, `signguCd` = 5자리 시군구 코드(공식 응답 대조 완료).
 * - 호출 경계: 동시성 1, 요청 시작 간 ≥1초, 요청 제한 20초, 실행 예산 400회(중심 관광지 전용).
 *   실패·재시도도 예산 산입. 인증/일일한도 → 즉시 중단. 429·5xx·초당제한·연결오류 → 대기 후 최대 2회 재시도.
 *   HTTP 200의 원천/XML 오류는 성공이 아니다.
 * - 유효 지역 = `data/region-mapping.json`의 검증된 매핑(약 249). 미매핑 인천 구 등은 제외.
 * - 안전 배포: 항상 `data/central-attractions.next.json`(+ 품질 보고)로만 쓴다. 검증 통과 시
 *   `--promote`로만 `data/central-attractions.json`을 교체한다. 실패 지역이 남으면 교체하지 않는다.
 * - 체크포인트: `data/central-attractions.checkpoint.json`. `--resume`은 baseYm·매핑 버전·분류 버전이
 *   같을 때만 성공분(ok/empty)을 재사용하고 나머지(실패/미수집)만 다시 조회한다.
 * - 잠금 파일 `data/central-attractions.lock`으로 같은 데이터 작업의 동시 실행을 막는다.
 *
 * 사용법:
 *   npm run build:central-attractions
 *   npm run build:central-attractions -- --resume
 *   npm run build:central-attractions -- --resume --promote
 *   npm run build:central-attractions -- --promote           # next.json 재검증 후 교체만
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BASE_YM,
  CENTRAL_API,
  DEFAULT_MAX_REQUESTS,
  FatalApiError,
  OFFICIAL_DOC_URL,
  SAMPLE_REGION_DISTRICTS,
  SCHEMA_VERSION,
  STALE_LOCK_MS,
  centralApiCodesFor,
  createCollector,
  isCheckpointReusable,
  projectRequestBudget,
  regionsToCollect,
  validateDocument,
} from "./lib/central-attractions-core.mjs";
import { CLASSIFICATION_VERSION } from "../lib/interest-classification.ts";

const DATA_DIR = "data";
const LIVE_PATH = `${DATA_DIR}/central-attractions.json`;
const NEXT_PATH = `${DATA_DIR}/central-attractions.next.json`;
const REPORT_PATH = `${DATA_DIR}/central-attractions.quality-report.json`;
const CHECKPOINT_PATH = `${DATA_DIR}/central-attractions.checkpoint.json`;
const LOCK_PATH = `${DATA_DIR}/central-attractions.lock`;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positionals = args.filter((a) => !a.startsWith("--"));
for (const flag of flags) {
  if (!["--resume", "--promote"].includes(flag)) {
    throw new Error(`알 수 없는 옵션: ${flag}`);
  }
}
if (positionals.length > 1) {
  throw new Error(
    "사용법: node scripts/build-central-attractions.mjs [--resume] [--promote] [매핑.json]",
  );
}
const mappingPath = positionals[0] ?? `${DATA_DIR}/region-mapping.json`;
const resume = flags.has("--resume");
const promote = flags.has("--promote");

const maxRequests = Number(
  process.env.CENTRAL_ATTRACTION_MAX_REQUESTS ?? DEFAULT_MAX_REQUESTS,
);
if (!Number.isInteger(maxRequests) || maxRequests < 1) {
  throw new Error(
    "CENTRAL_ATTRACTION_MAX_REQUESTS는 1 이상의 정수여야 합니다.",
  );
}

function serviceKey() {
  const value = process.env.CENTRAL_ATTRACTION_API_SERVICE_KEY;
  if (!value) {
    throw new Error(
      "CENTRAL_ATTRACTION_API_SERVICE_KEY가 설정되지 않았습니다.",
    );
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const jsonLine = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * 프로덕션은 전역 `fetch` 를 그대로 쓴다. 테스트에서만 `DURUDURU_TEST_FETCH_MODULE`
 * 로 통제된 fetch(`createTestFetch`)를 주입한다. 그 변수가 없으면 동작이 바뀌지 않는다.
 */
async function resolveFetchImpl() {
  const modulePath = process.env.DURUDURU_TEST_FETCH_MODULE;
  if (!modulePath) return fetch;
  const mod = await import(pathToFileURL(resolve(modulePath)).href);
  if (typeof mod.createTestFetch !== "function") {
    throw new Error(
      "DURUDURU_TEST_FETCH_MODULE 은 createTestFetch 를 export 해야 합니다.",
    );
  }
  return mod.createTestFetch();
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(resolve(tempPath), jsonLine(value), "utf8");
  await rename(resolve(tempPath), resolve(path));
}

// ---- 잠금 --------------------------------------------------------------

let lockHeld = false;

async function acquireLock() {
  const payload = jsonLine({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  try {
    await writeFile(resolve(LOCK_PATH), payload, { flag: "wx" });
    lockHeld = true;
    return;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  let existing = null;
  try {
    existing = JSON.parse(await readFile(resolve(LOCK_PATH), "utf8"));
  } catch {
    /* 손상된 잠금 파일 */
  }
  const age = existing?.startedAt
    ? Date.now() - Date.parse(existing.startedAt)
    : Number.POSITIVE_INFINITY;
  if (Number.isFinite(age) && age < STALE_LOCK_MS) {
    throw new Error(
      `이미 실행 중입니다(잠금 파일 ${LOCK_PATH}, ${Math.round(age / 1000)}초 전 시작). ` +
        `중복 실행을 막습니다. 비정상 종료라면 잠금 파일을 삭제하세요.`,
    );
  }
  console.warn(
    `[lock] 오래된 잠금 파일(${LOCK_PATH})을 무시하고 새로 시작합니다.`,
  );
  await writeFile(resolve(LOCK_PATH), payload, "utf8");
  lockHeld = true;
}

async function releaseLock() {
  if (!lockHeld) return;
  lockHeld = false;
  await rm(resolve(LOCK_PATH), { force: true });
}

// ---- 문서 조립 ---------------------------------------------------------

function assembleDocument(checkpoint) {
  const regions = Object.values(checkpoint.regions)
    .map((record) => ({
      regionId: record.regionId,
      name: record.name,
      province: record.province,
      district: record.district,
      areaCd: record.areaCd,
      signguCd: record.signguCd,
      status: record.status,
      totalCount: record.totalCount ?? 0,
      collected: record.collected ?? 0,
      duplicateHubCds: record.duplicateHubCds ?? 0,
      rankRange: record.rankRange ?? null,
      hubs: record.hubs ?? [],
      ...(record.completenessBlockers?.length
        ? { completenessBlockers: record.completenessBlockers }
        : {}),
      ...(record.error ? { error: record.error } : {}),
    }))
    .sort((a, b) =>
      a.regionId.localeCompare(b.regionId, "en", { numeric: true }),
    );

  const summary = {
    regionsTotal: regions.length,
    ok: regions.filter((r) => r.status === "ok").length,
    empty: regions.filter((r) => r.status === "empty").length,
    failed: regions.filter((r) => r.status === "failed").length,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    baseYm: BASE_YM,
    mappingVersion: checkpoint.mappingVersion,
    classificationVersion: checkpoint.classificationVersion,
    source: {
      api: CENTRAL_API,
      officialDoc: OFFICIAL_DOC_URL,
      idNote:
        "hubTatsCd는 티맵 기반 중심 관광지 식별자이며 TourAPI contentId와 다른 ID다.",
      rankNote:
        "hubRank는 지역 내 연계 방문 중심성 순위(1~100)이며 전국 인기·역사적 가치·평점이 아니다.",
      requestCount: checkpoint.stats.requests,
      retryCount: checkpoint.stats.retries,
      failedRequestCount: checkpoint.stats.failedRequests,
      runId: checkpoint.runId,
    },
    generatedAt: new Date().toISOString(),
    summary,
    regions,
  };
}

function buildReport(document_, checkpoint) {
  const sampleByDistrict = new Map(
    document_.regions.map((r) => [r.district, r]),
  );
  const samples = SAMPLE_REGION_DISTRICTS.map((district) => {
    const region = sampleByDistrict.get(district);
    return {
      district,
      status: region?.status ?? "missing",
      totalCount: region?.totalCount ?? null,
      collected: region?.collected ?? null,
      duplicateHubCds: region?.duplicateHubCds ?? null,
      rankRange: region?.rankRange ?? null,
      topHubs: (region?.hubs ?? []).slice(0, 3).map((h) => ({
        rank: h.hubRank,
        name: h.hubTatsName,
        categoryMcls: h.categoryMcls,
      })),
    };
  });

  const categoryLcls = {};
  const categoryMcls = {};
  let hubsTotal = 0;
  let duplicatesTotal = 0;
  const totalCountMismatch = [];
  for (const region of document_.regions) {
    hubsTotal += region.collected;
    duplicatesTotal += region.duplicateHubCds;
    if (
      region.status === "ok" &&
      region.totalCount !== region.collected + region.duplicateHubCds
    ) {
      totalCountMismatch.push({
        regionId: region.regionId,
        totalCount: region.totalCount,
        collected: region.collected,
        duplicateHubCds: region.duplicateHubCds,
      });
    }
    for (const hub of region.hubs) {
      categoryLcls[hub.categoryLcls] =
        (categoryLcls[hub.categoryLcls] ?? 0) + 1;
      categoryMcls[hub.categoryMcls] =
        (categoryMcls[hub.categoryMcls] ?? 0) + 1;
    }
  }

  return {
    generatedAt: document_.generatedAt,
    runId: checkpoint.runId,
    baseYm: BASE_YM,
    mappingVersion: checkpoint.mappingVersion,
    classificationVersion: checkpoint.classificationVersion,
    requests: checkpoint.stats,
    summary: document_.summary,
    hubsTotal,
    duplicatesTotal,
    totalCountMismatch,
    categoryLcls,
    categoryMcls,
    emptyRegions: document_.regions
      .filter((r) => r.status === "empty")
      .map((r) => ({
        regionId: r.regionId,
        name: r.name,
        areaCd: r.areaCd,
        signguCd: r.signguCd,
        note: emptyReason(r),
      })),
    failedRegions: document_.regions
      .filter((r) => r.status === "failed")
      .map((r) => ({ regionId: r.regionId, error: r.error })),
    sampleRegressions: samples,
    validation: validateDocument(document_),
  };
}

/**
 * empty 지역의 사유. 2026-09-10 공식 응답 대조 결과:
 * 광주광역시·전라남도 전역과 경기도 화성시는 baseYm 202608 원천 자료가 비어 있고,
 * 인접 월(광주·전남: 202506/202507/202412/202601, 화성: 202507/202509)에는 자료가 있다.
 * → 코드 문제가 아니라 원천의 해당 월 공백. D2에 따라 과거 월로 대체하지 않고 empty 로 남긴다.
 */
function emptyReason(region) {
  if (region.province === "광주광역시" || region.province === "전라남도") {
    return "원천 202608 자료 공백(광주·전남 전역, 인접 월엔 자료 있음). 표준 SIG_CD 확인됨.";
  }
  if (region.district === "화성시") {
    return "원천 202608 자료 공백(202507·202509엔 자료 있음). 코드 정상.";
  }
  return "원천 202608 자료 0건.";
}

// ---- 모드: promote만 --------------------------------------------------

async function promoteOnly() {
  const next = JSON.parse(await readFile(resolve(NEXT_PATH), "utf8"));
  const blockers = validateDocument(next);
  if (blockers.length) {
    console.error("[promote] 검증 실패, 교체하지 않습니다:");
    for (const b of blockers) console.error(`  - ${b}`);
    process.exitCode = 1;
    return;
  }
  await writeJsonAtomic(LIVE_PATH, next);
  console.log(`[promote] ${NEXT_PATH} → ${LIVE_PATH} 교체 완료.`);
}

// ---- 메인 -----------------------------------------------------------

async function main() {
  if (promote && !resume && positionals.length === 0) {
    // --promote 단독: 새 수집 없이 next.json 재검증 후 교체.
    let hasNext = true;
    try {
      await readFile(resolve(NEXT_PATH), "utf8");
    } catch {
      hasNext = false;
    }
    if (hasNext) {
      await promoteOnly();
      return;
    }
  }

  const mappingDocument = JSON.parse(
    await readFile(resolve(mappingPath), "utf8"),
  );
  const mappings = Array.isArray(mappingDocument.mappings)
    ? mappingDocument.mappings
    : [];
  if (mappings.length === 0) {
    throw new Error(
      "검증된 지역 매핑이 없어 중심 관광지를 수집할 수 없습니다.",
    );
  }

  const context = {
    baseYm: BASE_YM,
    mappingVersion: mappingDocument.generatedAt ?? "",
    classificationVersion: CLASSIFICATION_VERSION,
  };

  // 코드 조립을 미리 검증한다(형식 해석 불가·비표준 코드 지역을 조기 발견).
  const codeErrors = [];
  for (const mapping of mappings) {
    try {
      centralApiCodesFor(mapping);
    } catch (error) {
      codeErrors.push(`${mapping.regionId}(${mapping.name}): ${error.message}`);
    }
  }
  if (codeErrors.length) {
    throw new Error(
      `지역 코드 형식을 해석할 수 없는 매핑이 있습니다:\n  ${codeErrors.join("\n  ")}`,
    );
  }

  await acquireLock();

  let checkpoint = null;
  if (resume) {
    try {
      const raw = JSON.parse(await readFile(resolve(CHECKPOINT_PATH), "utf8"));
      if (isCheckpointReusable(raw, context)) {
        const doneCount = Object.values(raw.regions ?? {}).filter(
          (r) => r.status === "ok" || r.status === "empty",
        ).length;
        console.log(
          `[resume] 체크포인트 재사용 runId=${raw.runId} 성공분 ${doneCount}/${mappings.length}`,
        );
        checkpoint = raw;
      } else {
        console.warn(
          "[resume] 체크포인트의 기준월/버전이 현재 실행과 달라 새로 시작합니다.",
        );
      }
    } catch {
      console.warn("[resume] 재사용할 체크포인트가 없어 새로 시작합니다.");
    }
  }
  if (!checkpoint) {
    checkpoint = {
      runId: `central-${Date.now()}`,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      baseYm: context.baseYm,
      mappingVersion: context.mappingVersion,
      classificationVersion: context.classificationVersion,
      codeScheme: "sig-5digit",
      stats: { requests: 0, retries: 0, failedRequests: 0 },
      regions: {},
    };
  }

  const pending = regionsToCollect(mappings, checkpoint);
  const projected =
    checkpoint.stats.requests + projectRequestBudget(pending.length);
  console.log(
    `[budget] 예산 ${maxRequests}회 · 이번 수집 대상 ${pending.length}개 지역 · 예상 상한 ~${projected}회`,
  );
  if (projected > maxRequests) {
    await releaseLock();
    throw new Error(
      `예상 요청(~${projected})이 예산 ${maxRequests}회를 넘습니다. ` +
        `예산을 늘리거나 대상을 나눠 실행하세요. 부분 결과는 정상본으로 만들지 않습니다.`,
    );
  }

  // 이전 실행들의 누적 요청 수(재개 시). 이번 실행의 collector.stats를 여기에 더한다.
  const priorStats = { ...checkpoint.stats };
  const collector = createCollector({
    fetchImpl: await resolveFetchImpl(),
    serviceKey: serviceKey(),
    baseYm: context.baseYm,
    maxRequests: maxRequests - priorStats.requests,
    // 통제된 fetch 를 주입한 테스트에서만 요청 간 지연을 없앤다.
    ...(process.env.DURUDURU_TEST_FETCH_MODULE
      ? { sleep: () => Promise.resolve() }
      : {}),
  });
  const syncStats = () => {
    checkpoint.stats = {
      requests: priorStats.requests + collector.stats.requests,
      retries: priorStats.retries + collector.stats.retries,
      failedRequests:
        priorStats.failedRequests + collector.stats.failedRequests,
    };
  };

  let processed = 0;
  let preflightConfirmed = pending.length === 0;
  let currentMapping = null;
  try {
    for (const mapping of pending) {
      currentMapping = mapping;
      const { areaCd, signguCd } = centralApiCodesFor(mapping);
      const priorRecord = checkpoint.regions[mapping.regionId];
      // 재개 시 **검증까지 통과한(complete)** 페이지만 건너뛴다.
      // 결함 2: 정상 페이지 검증 직후·재시작 직후 체크포인트를 디스크로 flush 한다.
      const result = await collector.collectRegion(mapping, {
        savedPages: priorRecord?.pages ?? {},
        onProgress: async ({ validatedPages, reason, morePagesExpected }) => {
          if (reason !== "restart" && !morePagesExpected) return;
          checkpoint.regions[mapping.regionId] = {
            ...(checkpoint.regions[mapping.regionId] ?? {}),
            regionId: mapping.regionId,
            name: mapping.name,
            province: mapping.province,
            district: mapping.district,
            areaCd,
            signguCd,
            status: "failed",
            pages: validatedPages,
            collectedAt: new Date().toISOString(),
          };
          syncStats();
          checkpoint.updatedAt = new Date().toISOString();
          await writeJsonAtomic(CHECKPOINT_PATH, checkpoint);
        },
      });
      checkpoint.regions[mapping.regionId] = {
        regionId: mapping.regionId,
        name: mapping.name,
        province: mapping.province,
        district: mapping.district,
        areaCd,
        signguCd,
        status: result.status,
        totalCount: result.totalCount,
        collected: result.collected,
        duplicateHubCds: result.duplicateHubCds,
        rankRange: result.rankRange,
        hubs: result.hubs,
        // 완료되지 않은 지역만 검증 통과 페이지를 남겨 재개가 이어서 조회한다.
        // 완료 지역은 페이지 기록을 남기지 않는다. 일관성 붕괴로 재시작된
        // 단위는 validatedPages 가 비어(=1페이지부터 재수집) 넘어온다.
        ...(!result.done && Object.keys(result.validatedPages ?? {}).length
          ? { pages: result.validatedPages }
          : {}),
        ...(result.restarted ? { restarted: result.restarted } : {}),
        ...(result.completenessBlockers?.length
          ? { completenessBlockers: result.completenessBlockers }
          : {}),
        ...(result.error ? { error: result.error } : {}),
        collectedAt: new Date().toISOString(),
      };
      syncStats();
      checkpoint.updatedAt = new Date().toISOString();
      await writeJsonAtomic(CHECKPOINT_PATH, checkpoint);

      processed += 1;
      if (!preflightConfirmed && result.status !== "failed") {
        preflightConfirmed = true;
        console.log("[preflight] 일일 잔여 한도 여유 확인됨(첫 요청 성공).");
      }
      const rank = result.rankRange
        ? `rank ${result.rankRange.min}..${result.rankRange.max}`
        : "-";
      console.log(
        `[${processed}/${pending.length}] ${mapping.regionId} ${mapping.district} ` +
          `status=${result.status} total=${result.totalCount} collected=${result.collected} ` +
          `dup=${result.duplicateHubCds}${result.restarted ? ` restart=${result.restarted}` : ""} ${rank}`,
      );
    }
  } catch (error) {
    // 치명 오류 직전까지 검증 통과한 페이지를 남겨 재개가 재사용하게 한다.
    if (error instanceof FatalApiError && error.savedPages && currentMapping) {
      const { areaCd, signguCd } = centralApiCodesFor(currentMapping);
      checkpoint.regions[currentMapping.regionId] = {
        ...(checkpoint.regions[currentMapping.regionId] ?? {
          regionId: currentMapping.regionId,
          name: currentMapping.name,
          province: currentMapping.province,
          district: currentMapping.district,
          areaCd,
          signguCd,
        }),
        status: "failed",
        pages: error.savedPages,
      };
    }
    syncStats();
    await writeJsonAtomic(CHECKPOINT_PATH, checkpoint);
    await releaseLock();
    if (error instanceof FatalApiError) {
      console.error(`\n[치명적 중단] ${error.message}`);
      console.error(
        `체크포인트를 저장했습니다. 원인 해결 후 --resume 으로 재개하세요.`,
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const document_ = assembleDocument(checkpoint);
  const report = buildReport(document_, checkpoint);

  await writeJsonAtomic(NEXT_PATH, document_);
  await writeFile(resolve(REPORT_PATH), jsonLine(report), "utf8");

  console.log("\n=== 수집 요약 ===");
  console.log(
    `요청 ${checkpoint.stats.requests}회 (재시도 ${checkpoint.stats.retries}, 실패 ${checkpoint.stats.failedRequests})`,
  );
  console.log(
    `지역 ${document_.summary.regionsTotal}개 · ok ${document_.summary.ok} · empty ${document_.summary.empty} · failed ${document_.summary.failed}`,
  );
  console.log(
    `중심 관광지 합계 ${report.hubsTotal} · 중복 hubTatsCd ${report.duplicatesTotal}`,
  );
  console.log(`hubCtgryLclsNm 분포 ${JSON.stringify(report.categoryLcls)}`);
  if (report.totalCountMismatch.length) {
    console.warn(
      `[주의] totalCount ≠ 수집+중복 인 지역 ${report.totalCountMismatch.length}곳`,
    );
  }
  console.log(`\n임시 출력: ${NEXT_PATH}\n품질 보고: ${REPORT_PATH}`);

  const blockers = validateDocument(document_);
  if (blockers.length) {
    console.error("\n[검증 차단] 다음 사유로 --promote 교체를 막습니다:");
    for (const b of blockers) console.error(`  - ${b}`);
    await releaseLock();
    process.exitCode = 1;
    return;
  }
  console.log("\n[검증 통과] --promote 로 교체할 수 있습니다.");

  if (promote) {
    await writeJsonAtomic(LIVE_PATH, document_);
    console.log(`[promote] ${LIVE_PATH} 교체 완료.`);
  }

  await releaseLock();
}

const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (invokedDirectly) {
  main().catch(async (error) => {
    await releaseLock().catch(() => {});
    console.error(`\n[실패] ${error.message}`);
    process.exitCode = 1;
  });
}
