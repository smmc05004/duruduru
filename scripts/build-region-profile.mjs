#!/usr/bin/env node

/**
 * TourAPI 공식 분류(lclsSystmCode2) 기반 전국 관광지 지역 프로필 수집기 (T2).
 *
 * 기획서 D1·D2(`docs/product/TOURISM_RECOMMENDATION_UPGRADE.md`)를 따른다.
 *
 * - 분류별 전국 목록을 `KorService2/areaBasedList2`로 **페이지 끝까지** 받는다.
 * - 같은 `contentId`는 장소 하나로 합치고, 공통 해석기 `classifyInterests`로 관심사를
 *   판정한다. 판정 근거(`lclsSystm*`·`cat*`·`contentTypeId`·basis)를 레코드에 보존한다.
 * - 호출 경계: 동시성 1, 요청 시작 간 ≥1초, 요청 제한 20초, 실행 예산 기본 900회.
 *   실패도 예산에 포함. 인증/권한/일일한도 오류는 즉시 중단. 429·5xx·연결 오류는
 *   대기 후 최대 2회 재시도(재시도도 예산). HTTP 200의 원천/XML 오류는 성공이 아니다.
 * - 서비스 키·키 포함 URL은 로그/JSON/에러에 남기지 않는다.
 * - 수집 완전성 검증(결함 1): 스펙별 `totalCount` 대비 실제 고유 건수 부족, 요청
 *   페이지 범위의 누락, 페이지 간 중복 ID, 페이지별 `totalCount` 변동을 감지하면
 *   `document.completeness.blockers`에 남기고 `--promote` 교체를 막는다. 임시 산출물
 *   `data/region-profiles.next.json`은 남긴다.
 * - 안전 배포: 결과는 항상 `data/region-profiles.next.json`(+ 품질 보고)로만 쓴다.
 *   검증 후 `--promote`로만 `data/region-profiles.json`을 교체한다.
 * - 체크포인트: `data/region-profiles.checkpoint.json`에 실행 ID·버전·스펙별 **성공한
 *   페이지**를 저장한다(결함 3). `--resume`은 같은 분류 버전·매핑 버전·스펙 서명일 때만
 *   성공한 페이지를 재사용하고, 실패·미수집 페이지만 이어서 조회한다.
 *
 * 사용법:
 *   node scripts/build-region-profile.mjs [--resume] [--promote] [매핑.json]
 *   npm run build:region-profiles -- --resume
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CLASSIFICATION_VERSION,
  classifyInterests,
} from "../lib/interest-classification.ts";
import {
  DEFAULT_MAX_REQUESTS,
  FatalApiError,
  PAGE_SIZE,
  QUERY_SPECS,
  SCHEMA_VERSION,
  createProfileCollector,
  validateDocument,
} from "./lib/region-profile-core.mjs";

const DATA_DIR = "data";
const LIVE_PATH = `${DATA_DIR}/region-profiles.json`;
const NEXT_PATH = `${DATA_DIR}/region-profiles.next.json`;
const REPORT_PATH = `${DATA_DIR}/region-profiles.quality-report.json`;
const CHECKPOINT_PATH = `${DATA_DIR}/region-profiles.checkpoint.json`;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positionals = args.filter((a) => !a.startsWith("--"));
if (positionals.length > 1) {
  throw new Error(
    "사용법: node scripts/build-region-profile.mjs [--resume] [--promote] [매핑.json]",
  );
}
const mappingPath = positionals[0] ?? `${DATA_DIR}/region-mapping.json`;
const resume = flags.has("--resume");
const promote = flags.has("--promote");
for (const flag of flags) {
  if (!["--resume", "--promote"].includes(flag)) {
    throw new Error(`알 수 없는 옵션: ${flag}`);
  }
}

const maxRequests = Number(
  process.env.TOUR_API_PROFILE_MAX_REQUESTS ?? DEFAULT_MAX_REQUESTS,
);
if (!Number.isInteger(maxRequests) || maxRequests < 1) {
  throw new Error("TOUR_API_PROFILE_MAX_REQUESTS는 1 이상의 정수여야 합니다.");
}

function serviceKey() {
  const value = process.env.TOUR_API_SERVICE_KEY;
  if (!value) throw new Error("TOUR_API_SERVICE_KEY가 설정되지 않았습니다.");
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const legalKey = (regionCode, signguCode) => `${regionCode}|${signguCode}`;
const text = (value) => String(value ?? "").trim();

// ---- 체크포인트 -----------------------------------------------------------

let checkpoint = null;

async function persistCheckpoint() {
  if (!checkpoint) return;
  checkpoint.updatedAt = new Date().toISOString();
  await writeFile(
    resolve(CHECKPOINT_PATH),
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    "utf8",
  );
}

async function loadCheckpoint(runContext) {
  if (!resume) return null;
  try {
    const raw = JSON.parse(await readFile(resolve(CHECKPOINT_PATH), "utf8"));
    if (
      raw.classificationVersion === runContext.classificationVersion &&
      raw.mappingGeneratedAt === runContext.mappingGeneratedAt &&
      raw.pageSize === PAGE_SIZE &&
      raw.specSignature === runContext.specSignature
    ) {
      const doneSpecs = Object.values(raw.specs ?? {}).filter((s) => s.done);
      console.log(
        `[resume] 체크포인트 재사용 runId=${raw.runId} 완료 스펙 ${doneSpecs.length}/${QUERY_SPECS.length}`,
      );
      return raw;
    }
    console.warn(
      "[resume] 체크포인트의 버전/스펙이 현재 실행과 달라 새로 시작합니다.",
    );
  } catch {
    console.warn("[resume] 재사용할 체크포인트가 없어 새로 시작합니다.");
  }
  return null;
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
  await writeFile(
    resolve(LIVE_PATH),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
  console.log(`[promote] ${NEXT_PATH} → ${LIVE_PATH} 교체 완료.`);
}

// ---- 메인 ---------------------------------------------------------------

async function main() {
  if (promote && !resume && positionals.length === 0) {
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
  if (
    !Array.isArray(mappingDocument.mappings) ||
    mappingDocument.mappings.length === 0
  ) {
    throw new Error("검증된 지역 매핑이 없어 지역 프로필을 만들 수 없습니다.");
  }

  const specSignature = QUERY_SPECS.map((s) => s.label).join("|");
  const runContext = {
    classificationVersion: CLASSIFICATION_VERSION,
    mappingGeneratedAt: mappingDocument.generatedAt ?? "",
    specSignature,
  };

  const projectedRequests = QUERY_SPECS.length * 6;
  if (projectedRequests > maxRequests) {
    throw new Error(
      `예상 요청(~${projectedRequests})이 예산 ${maxRequests}회를 넘습니다. 예산을 늘리거나 스펙을 줄이세요. 부분 저장은 하지 않습니다.`,
    );
  }
  console.log(
    `[budget] 예산 ${maxRequests}회 · 스펙 ${QUERY_SPECS.length}개 · 예상 상한 ~${projectedRequests}회`,
  );

  checkpoint = await loadCheckpoint(runContext);
  if (!checkpoint) {
    checkpoint = {
      runId: `profile-${Date.now()}`,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      classificationVersion: runContext.classificationVersion,
      mappingGeneratedAt: runContext.mappingGeneratedAt,
      specSignature,
      pageSize: PAGE_SIZE,
      specs: {},
    };
  }

  const profiles = mappingDocument.mappings.map((mapping) => ({
    regionId: mapping.regionId,
    name: mapping.name,
    province: mapping.province,
    district: mapping.district,
    lDongRegnCd: mapping.lDongRegnCd,
    lDongSignguCd: mapping.lDongSignguCd,
    attractions: [],
  }));
  const profileByLegalCode = new Map(
    profiles.map((p) => [legalKey(p.lDongRegnCd, p.lDongSignguCd), p]),
  );

  const collector = createProfileCollector({
    fetchImpl: fetch,
    serviceKey: serviceKey(),
    maxRequests,
    logger: console,
  });

  // 1) 스펙별 수집
  const specReports = [];
  const completenessBlockers = [];
  const rawById = new Map();

  let currentSpec = null;
  try {
    for (const spec of QUERY_SPECS) {
      currentSpec = spec;
      const cpSpec = checkpoint.specs[spec.label];
      if (cpSpec?.done) {
        console.log(`[skip] ${spec.label} (체크포인트 완료)`);
        specReports.push(cpSpec.report);
        for (const item of cpSpec.items ?? []) {
          const id = text(item.contentid);
          if (id && !rawById.has(id)) rawById.set(id, item);
        }
        continue;
      }

      console.log(`[collect] ${spec.label} …`);
      // 결함 3: 재개 시 **검증까지 통과한(complete)** 페이지만 건너뛴다.
      const result = await collector.collectSpec(spec, {
        savedPages: cpSpec?.pages ?? {},
      });

      const report = {
        label: result.label,
        totalCount: result.totalCount,
        pageCount: result.pageCount,
        receivedUnique: result.receivedUnique,
        duplicateInSpec: result.duplicateInSpec,
        crossPageDuplicates: result.crossPageDuplicates,
        incompletePages: result.incompletePages,
        perPageTotals: result.perPageTotals,
        restarts: result.restarts,
        restartReasons: result.restartReasons,
        drift: result.drift,
        done: result.done,
        blockers: result.blockers,
      };
      console.log(
        `[collect] ${spec.label} total=${result.totalCount} pages=${result.pageCount} unique=${result.receivedUnique} dupInSpec=${result.duplicateInSpec} drift=${result.drift} done=${result.done}` +
          (result.restarts ? ` restart=${result.restarts}` : "") +
          (result.blockers.length ? ` BLOCKERS=${result.blockers.length}` : ""),
      );

      // 완료(done=false)되지 않은 스펙은 정상본 교체에서 제외한다.
      if (!result.done) {
        const reason =
          result.blockers.join(" · ") ||
          result.restartReasons.join(" · ") ||
          "기대 페이지가 전부 검증되지 않음";
        completenessBlockers.push(`[${spec.label}] ${reason}`);
      }
      for (const blocker of result.blockers)
        if (result.done)
          completenessBlockers.push(`[${spec.label}] ${blocker}`);

      specReports.push(report);
      for (const item of result.items) {
        const id = text(item.contentid);
        if (id && !rawById.has(id)) rawById.set(id, item);
      }
      // 검증 통과 페이지만 체크포인트에 남긴다. done=false 면 재개가 불완전·
      // 미저장 페이지만 이어서 조회한다. 일관성 붕괴로 재시작된 스펙은
      // validatedPages 가 비어 넘어와 1페이지부터 다시 수집된다.
      checkpoint.specs[spec.label] = {
        done: result.done,
        report,
        pages: result.validatedPages,
        items: result.items,
      };
      await persistCheckpoint();
    }
  } catch (error) {
    // 치명 오류 직전까지 검증 통과한 페이지를 남겨 재개가 재사용하게 한다.
    if (error.validatedPages && currentSpec) {
      checkpoint.specs[currentSpec.label] = {
        done: false,
        pages: error.validatedPages,
      };
    }
    await persistCheckpoint();
    if (error instanceof FatalApiError) {
      console.error(`\n[치명적 중단] ${error.message}`);
      console.error(
        "체크포인트를 저장했습니다. 원인 해결 후 --resume 으로 재개하세요.",
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // 2) contentId 단위 판정·배정
  const quality = {
    sourceRowSum: specReports.reduce((s, r) => s + r.totalCount, 0),
    uniqueContentIds: rawById.size,
    assigned: 0,
    unmappedRegion: 0,
    noValidClassification: 0,
    missingCoordinates: 0,
    unresolvedLclsRecords: 0,
    basis: { lcls: 0, legacy: 0 },
    suppressedNonInterestSignal: {
      AC: 0,
      SH: 0,
      FD: 0,
      EV: 0,
      C01: 0,
      other: 0,
    },
    signalSpecL1: {},
    byCategory: {},
    byRegionCategory: {},
    contentTypeByCategory: {},
    unmappedSamples: [],
  };

  for (const item of rawById.values()) {
    const contentId = text(item.contentid);
    const title = text(item.title)
      .replace(/<[^>]*>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    const lDongRegnCd = text(item.lDongRegnCd);
    const lDongSignguCd = text(item.lDongSignguCd);
    if (!contentId || !title) continue;

    const contentTypeId = text(item.contenttypeid);
    const lclsSystm1 = text(item.lclsSystm1);
    const lclsSystm2 = text(item.lclsSystm2);
    const lclsSystm3 = text(item.lclsSystm3);
    const cat1 = text(item.cat1);
    const cat2 = text(item.cat2);
    const cat3 = text(item.cat3);

    const { categories, basis, unresolvedLcls } = classifyInterests({
      lclsSystm1,
      lclsSystm2,
      lclsSystm3,
      cat1,
      cat2,
      cat3,
      contentTypeId,
    });

    const NON_INTEREST = ["AC", "SH", "FD", "EV", "C01"];
    if (
      NON_INTEREST.includes(lclsSystm1) &&
      ["14", "28"].includes(contentTypeId)
    ) {
      quality.suppressedNonInterestSignal[lclsSystm1] += 1;
    }
    if (["14", "28"].includes(contentTypeId) && lclsSystm1) {
      quality.signalSpecL1[lclsSystm1] =
        (quality.signalSpecL1[lclsSystm1] ?? 0) + 1;
    }

    if (categories.length === 0) {
      quality.noValidClassification += 1;
      continue;
    }
    if (unresolvedLcls.length > 0) quality.unresolvedLclsRecords += 1;

    const profile = profileByLegalCode.get(
      legalKey(lDongRegnCd, lDongSignguCd),
    );
    if (!profile) {
      quality.unmappedRegion += 1;
      if (quality.unmappedSamples.length < 40)
        quality.unmappedSamples.push({
          contentId,
          title,
          lDongRegnCd,
          lDongSignguCd,
          categories,
        });
      continue;
    }

    const mapX = text(item.mapx);
    const mapY = text(item.mapy);
    const hasCoordinates =
      mapX &&
      mapY &&
      Number.isFinite(Number(mapX)) &&
      Number.isFinite(Number(mapY)) &&
      Number(mapX) > 0 &&
      Number(mapY) > 0;
    if (!hasCoordinates) quality.missingCoordinates += 1;

    const stored = {
      contentId,
      title,
      categories,
      classificationBasis: basis,
      contentTypeId,
      address: text(item.addr1),
      imageUrl: text(item.firstimage) || text(item.firstimage2),
      imageCopyright: text(item.cpyrhtDivCd),
      mapX,
      mapY,
      cat1,
      cat2,
      cat3,
      classificationVersion: CLASSIFICATION_VERSION,
    };
    if (lclsSystm1) stored.lclsSystm1 = lclsSystm1;
    if (lclsSystm2) stored.lclsSystm2 = lclsSystm2;
    if (lclsSystm3) stored.lclsSystm3 = lclsSystm3;
    const modifiedAt = text(item.modifiedtime);
    if (modifiedAt) stored.sourceModifiedAt = modifiedAt;
    if (unresolvedLcls.length > 0) stored.unresolvedLcls = unresolvedLcls;

    profile.attractions.push(stored);
    quality.assigned += 1;
    quality.basis[basis] += 1;
    for (const categoryId of categories) {
      quality.byCategory[categoryId] =
        (quality.byCategory[categoryId] ?? 0) + 1;
      const key = `${profile.regionId}|${categoryId}`;
      quality.byRegionCategory[key] = (quality.byRegionCategory[key] ?? 0) + 1;
      const ct = `${categoryId}|type${contentTypeId || "NA"}`;
      quality.contentTypeByCategory[ct] =
        (quality.contentTypeByCategory[ct] ?? 0) + 1;
    }
  }

  const categoryReady = {};
  for (const profile of profiles) {
    const byCat = {};
    for (const a of profile.attractions)
      for (const c of a.categories) {
        byCat[c] = byCat[c] ?? new Set();
        byCat[c].add(a.contentId);
      }
    for (const [c, set] of Object.entries(byCat)) {
      if (set.size >= 3) categoryReady[c] = (categoryReady[c] ?? 0) + 1;
    }
  }

  const regionsWithAttractions = profiles.filter(
    (p) => p.attractions.length > 0,
  ).length;

  const document = {
    schemaVersion: SCHEMA_VERSION,
    classificationVersion: CLASSIFICATION_VERSION,
    source: {
      tourApi: "KorService2/areaBasedList2",
      querySpecs: QUERY_SPECS.map((s) => s.label),
      mappingGeneratedAt: mappingDocument.generatedAt ?? "",
      requestCount: collector.stats.requests,
      retryCount: collector.stats.retries,
      failedRequestCount: collector.stats.failedRequests,
      runId: checkpoint.runId,
    },
    completeness: {
      ok: completenessBlockers.length === 0,
      blockers: completenessBlockers,
    },
    generatedAt: new Date().toISOString(),
    profiles,
  };

  const report = {
    generatedAt: document.generatedAt,
    runId: checkpoint.runId,
    classificationVersion: CLASSIFICATION_VERSION,
    requests: collector.stats,
    specReports,
    completeness: document.completeness,
    quality: {
      ...quality,
      regionsTotal: profiles.length,
      regionsWithAttractions,
      categoryReadyRegions: categoryReady,
    },
    landmarkCheck: validateDocument(document),
  };

  await mkdir(dirname(resolve(NEXT_PATH)), { recursive: true });
  const tempPath = `${NEXT_PATH}.tmp`;
  await writeFile(
    resolve(tempPath),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
  await rename(resolve(tempPath), resolve(NEXT_PATH));
  await writeFile(
    resolve(REPORT_PATH),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log("\n=== 수집 요약 ===");
  console.log(
    `요청 ${collector.stats.requests}회 (재시도 ${collector.stats.retries}, 실패 ${collector.stats.failedRequests})`,
  );
  console.log(
    `원천 행 합계 ${quality.sourceRowSum} · 고유 contentId ${quality.uniqueContentIds}`,
  );
  console.log(
    `배정 ${quality.assigned} · 미매핑지역 ${quality.unmappedRegion} · 유효분류없음 ${quality.noValidClassification} · 좌표결측 ${quality.missingCoordinates}`,
  );
  console.log(
    `판정근거 lcls=${quality.basis.lcls} legacy=${quality.basis.legacy}`,
  );
  console.log(`관심사별 배정 ${JSON.stringify(quality.byCategory)}`);
  console.log(`카테고리 3개 이상 지역 ${JSON.stringify(categoryReady)}`);
  if (completenessBlockers.length) {
    console.error(
      `\n[수집 불완전] ${completenessBlockers.length}건 — 정상본 교체를 막습니다:`,
    );
    for (const b of completenessBlockers) console.error(`  - ${b}`);
  }
  console.log(`\n임시 출력: ${NEXT_PATH}\n품질 보고: ${REPORT_PATH}`);

  const blockers = validateDocument(document);
  if (blockers.length) {
    console.error("\n[검증 차단] 다음 사유로 --promote 교체를 막습니다:");
    for (const b of blockers) console.error(`  - ${b}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n[검증 통과] --promote 로 교체할 수 있습니다.");

  if (promote) {
    await writeFile(
      resolve(LIVE_PATH),
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );
    console.log(`[promote] ${LIVE_PATH} 교체 완료.`);
  }
}

const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (invokedDirectly) {
  await main().catch((error) => {
    if (error instanceof FatalApiError) {
      console.error(`\n[치명적 중단] ${error.message}`);
    } else {
      console.error(`\n[실패] ${error.message}`);
    }
    process.exitCode = 1;
  });
}
