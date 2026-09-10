#!/usr/bin/env node

/**
 * TourAPI 공식 분류(lclsSystmCode2) 기반 전국 관광지 지역 프로필 수집기 (T2).
 *
 * 기획서 D1·D2(`docs/product/TOURISM_RECOMMENDATION_UPGRADE.md`)를 따른다.
 *
 * - 분류별 전국 목록을 `KorService2/areaBasedList2`로 **페이지 끝까지** 받는다.
 *   새 분류(`lclsSystm1/2/3`) 우선, 구 `cat` 필터는 하위 호환 레코드를 위한 병행 조회다.
 * - 같은 `contentId`는 장소 하나로 합치고, 공통 해석기 `classifyInterests`로 관심사를
 *   판정한다. 판정 근거(`lclsSystm*`·`cat*`·`contentTypeId`·basis)를 레코드에 보존한다.
 * - 호출 경계: 동시성 1, 요청 시작 간 ≥1초, 요청 제한 20초, 실행 예산 기본 900회.
 *   실패도 예산에 포함. 인증/권한/일일한도 오류는 즉시 중단. 429·5xx·연결 오류는
 *   대기 후 최대 2회 재시도(재시도도 예산). HTTP 200의 원천/XML 오류는 성공이 아니다.
 * - 서비스 키·키 포함 URL은 로그/JSON/에러에 남기지 않는다. HTTP 상태·원천 코드·분류·
 *   페이지만 로깅한다.
 * - 안전 배포: 결과는 항상 `data/region-profiles.next.json`(+ 품질 보고)로만 쓴다.
 *   기존 `data/region-profiles.json`은 이 스크립트가 건드리지 않는다. 검증 후
 *   `--promote`로만 교체한다.
 * - 체크포인트: `data/region-profiles.checkpoint.json`에 실행 ID·버전·스펙별 페이지
 *   진행을 저장한다. `--resume`은 같은 실행 ID·분류 버전·매핑 버전일 때만 재사용한다.
 *
 * 사용법:
 *   node scripts/build-region-profile.mjs [--resume] [--promote] [매핑.json]
 *   npm run build:region-profiles -- --resume
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CLASSIFICATION_VERSION,
  classifyInterests,
} from "../lib/interest-classification.ts";

const TOUR_API_BASE_URL = "https://apis.data.go.kr/B551011/KorService2";
const REQUEST_TIMEOUT_MS = 20_000;
const MIN_REQUEST_GAP_MS = 1_000;
const PAGE_SIZE = 1_000;
const DEFAULT_MAX_REQUESTS = 900;
const MAX_RETRIES = 2;
const RETRY_WAIT_MS = 3_000;
const SCHEMA_VERSION = 2;

const DATA_DIR = "data";
const LIVE_PATH = `${DATA_DIR}/region-profiles.json`;
const NEXT_PATH = `${DATA_DIR}/region-profiles.next.json`;
const REPORT_PATH = `${DATA_DIR}/region-profiles.quality-report.json`;
const CHECKPOINT_PATH = `${DATA_DIR}/region-profiles.checkpoint.json`;

/**
 * 조회 스펙. 새 공식 분류(`lclsSystm*`)와 안정 신호(`contentTypeId` 14·28)만 쓴다.
 * 모든 결과는 contentId로 합쳐 해석기가 한 번만 판정하므로 스펙 간 중복은 자연히
 * 제거된다.
 *
 * 구 `cat` 병행 조회는 T2 실측(2026-09-10)에서 **순유입 0건**이었다: `cat` 필터가
 * 데려온 레코드는 모두 `lclsSystm*`를 가지고 있고(basis=legacy 0건), 새 스펙이
 * 놓친 315건은 전부 `lclsSystm1=VE` 랜드마크로 어차피 관심사 밖 제외 대상이었다.
 * 따라서 구 `cat` 스펙은 제거한다. 해석기의 legacy 경로는 만약을 위해 유지한다.
 */
const QUERY_SPECS = [
  { label: "nature/new lclsSystm1=NA", params: { lclsSystm1: "NA" } },
  { label: "history/new lclsSystm1=HS", params: { lclsSystm1: "HS" } },
  { label: "leisure/new lclsSystm1=LS", params: { lclsSystm1: "LS" } },
  { label: "leisure/signal contentTypeId=28", params: { contentTypeId: "28" } },
  { label: "culture/new lclsSystm2=VE06", params: { lclsSystm2: "VE06" } },
  { label: "culture/new lclsSystm2=VE07", params: { lclsSystm2: "VE07" } },
  { label: "culture/new lclsSystm2=VE09", params: { lclsSystm2: "VE09" } },
  {
    label: "culture/new lclsSystm3=VE120100",
    params: { lclsSystm3: "VE120100" },
  },
  { label: "culture/signal contentTypeId=14", params: { contentTypeId: "14" } },
  { label: "rest/new lclsSystm2=EX05", params: { lclsSystm2: "EX05" } },
  { label: "rest/new lclsSystm2=NA04", params: { lclsSystm2: "NA04" } },
  { label: "rest/new lclsSystm2=VE03", params: { lclsSystm2: "VE03" } },
];

/** 원천 응답 코드 중 즉시 중단해야 하는 것(키/권한/일일 한도). */
const FATAL_RESULT_CODES = new Set([
  "22", // LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR (일일 한도)
  "30", // SERVICE_KEY_IS_NOT_REGISTERED_ERROR
  "31", // DEADLINE_HAS_EXPIRED_ERROR
  "32", // UNREGISTERED_IP_ERROR
  "33", // UNSIGNED_CALL_ERROR
]);

class FatalApiError extends Error {}

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

function asList(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

const legalKey = (regionCode, signguCode) => `${regionCode}|${signguCode}`;
const text = (value) => String(value ?? "").trim();

const stats = {
  requests: 0,
  retries: 0,
  failedRequests: 0,
};
let lastRequestStartedAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 요청 시작 간 최소 간격을 지킨다(동시성 1). */
async function pace() {
  const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestStartedAt);
  if (wait > 0) await sleep(wait);
  lastRequestStartedAt = Date.now();
}

function classifyFailure(resultCode) {
  if (FATAL_RESULT_CODES.has(resultCode)) return "fatal";
  // 초당 제한(로컬 정책 위반) 계열은 재시도.
  if (["11", "12", "20", "21", "01", "1", "5"].includes(resultCode))
    return "retry";
  return "error";
}

/**
 * 한 페이지를 조회한다. 예산·페이스·재시도·오류 분류를 담당한다.
 * 반환: { items, totalCount, attempts }
 */
async function requestPage(spec, pageNo) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    if (stats.requests >= maxRequests) {
      throw new FatalApiError(
        `TourAPI 요청이 실행 예산 ${maxRequests}회에 도달했습니다. 부분 결과는 저장하지 않았습니다.`,
      );
    }
    stats.requests += 1;
    if (attempt > 1) stats.retries += 1;

    const url = new URL(`${TOUR_API_BASE_URL}/areaBasedList2`);
    url.search = new URLSearchParams({
      serviceKey: serviceKey(),
      MobileOS: "ETC",
      MobileApp: "DURUDURU_MVP",
      _type: "json",
      // 제목순 정렬로 페이지네이션을 최대한 안정화한다(수정일순은 드리프트가 크다).
      arrange: "A",
      numOfRows: String(PAGE_SIZE),
      pageNo: String(pageNo),
      ...spec.params,
    }).toString();

    await pace();
    let payload;
    let httpStatus = 0;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      httpStatus = response.status;
      const body = await response.text();
      if (!response.ok) {
        if (
          (response.status >= 500 || response.status === 429) &&
          attempt <= MAX_RETRIES + 1
        ) {
          console.warn(
            `[retry] ${spec.label} p${pageNo} HTTP ${response.status} (attempt ${attempt})`,
          );
          if (attempt <= MAX_RETRIES) {
            await sleep(RETRY_WAIT_MS * attempt);
            continue;
          }
        }
        stats.failedRequests += 1;
        throw new Error(`HTTP ${response.status}`);
      }
      try {
        payload = JSON.parse(body);
      } catch {
        // XML/HTML 오류 응답은 성공이 아니다.
        stats.failedRequests += 1;
        const codeMatch = body.match(/<returnReasonCode>([^<]+)</);
        const code = codeMatch ? codeMatch[1] : "non-json";
        if (classifyFailure(code) === "fatal") {
          throw new FatalApiError(`원천 오류 ${code} (XML)`);
        }
        throw new Error(`원천 비-JSON 응답 (${code})`);
      }
    } catch (error) {
      if (error instanceof FatalApiError) throw error;
      if (
        (error.name === "TimeoutError" ||
          error.name === "AbortError" ||
          error.code === "ECONNRESET" ||
          error.code === "ETIMEDOUT" ||
          error.code === "UND_ERR_CONNECT_TIMEOUT" ||
          /HTTP 5\d\d|HTTP 429/.test(error.message)) &&
        attempt <= MAX_RETRIES
      ) {
        console.warn(
          `[retry] ${spec.label} p${pageNo} ${error.name || error.code || error.message} (attempt ${attempt})`,
        );
        await sleep(RETRY_WAIT_MS * attempt);
        continue;
      }
      throw error;
    }

    const header = payload?.response?.header;
    const resultCode = text(header?.resultCode);
    if (resultCode !== "0000") {
      stats.failedRequests += 1;
      const disposition = classifyFailure(resultCode);
      console.warn(
        `[source-error] ${spec.label} p${pageNo} HTTP ${httpStatus} code=${resultCode} disposition=${disposition}`,
      );
      if (disposition === "fatal") {
        throw new FatalApiError(
          `원천 오류 ${resultCode} — 키/권한/일일 한도. 즉시 중단합니다.`,
        );
      }
      if (disposition === "retry" && attempt <= MAX_RETRIES) {
        await sleep(RETRY_WAIT_MS * attempt);
        continue;
      }
      throw new Error(`원천 오류 ${resultCode}`);
    }

    return {
      items: asList(payload?.response?.body?.items?.item),
      totalCount: Number(payload?.response?.body?.totalCount ?? 0),
      attempts: attempt,
    };
  }
}

/**
 * 한 스펙을 페이지 끝까지 조회한다. 페이지 완전성·중복을 검증한다.
 * 체크포인트가 있으면 완료 페이지는 건너뛴다.
 */
async function collectSpec(spec, checkpointForSpec) {
  const cp = checkpointForSpec ?? { totalCount: 0, pages: {}, done: false };
  const byPage = new Map(
    Object.entries(cp.pages).map(([page, items]) => [Number(page), items]),
  );

  const first = byPage.has(1)
    ? { items: byPage.get(1), totalCount: cp.totalCount }
    : await requestPage(spec, 1);
  if (!byPage.has(1)) byPage.set(1, first.items);
  const totalCount = first.totalCount;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) {
    if (byPage.has(pageNo)) continue;
    const page = await requestPage(spec, pageNo);
    byPage.set(pageNo, page.items);
    // 페이지마다 체크포인트를 갱신한다.
    cp.totalCount = totalCount;
    cp.pages[String(pageNo)] = page.items;
    if (byPage.has(1)) cp.pages["1"] = byPage.get(1);
    await persistCheckpoint();
  }

  const items = [];
  const seen = new Set();
  let duplicateInSpec = 0;
  let emptyPages = 0;
  for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
    const pageItems = byPage.get(pageNo) ?? [];
    if (pageItems.length === 0 && pageNo < pageCount) emptyPages += 1;
    for (const item of pageItems) {
      const id = text(item.contentid);
      if (!id) continue;
      if (seen.has(id)) {
        duplicateInSpec += 1;
        continue;
      }
      seen.add(id);
      items.push(item);
    }
  }

  const drift = totalCount - items.length - duplicateInSpec;
  return {
    label: spec.label,
    totalCount,
    pageCount,
    receivedUnique: items.length,
    duplicateInSpec,
    emptyPages,
    drift,
    items,
  };
}

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
      console.log(
        `[resume] 체크포인트 재사용 runId=${raw.runId} 완료 스펙 ${
          Object.values(raw.specs).filter((s) => s.done).length
        }/${QUERY_SPECS.length}`,
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

// ---- 메인 ---------------------------------------------------------------

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

/** 대표 명소·최소 건수 회귀 검증. 교체 차단 사유 목록을 반환. */
function validateDocument(doc) {
  const blockers = [];
  if (doc.schemaVersion !== SCHEMA_VERSION)
    blockers.push(
      `schemaVersion이 ${SCHEMA_VERSION}이 아님: ${doc.schemaVersion}`,
    );
  if (!Array.isArray(doc.profiles) || doc.profiles.length < 200)
    blockers.push(`지역 프로필 수가 비정상: ${doc.profiles?.length}`);
  const all = (doc.profiles ?? []).flatMap((p) =>
    p.attractions.map((a) => ({ ...a, regionId: p.regionId })),
  );
  const byId = new Map(all.map((a) => [a.contentId, a]));
  const landmarks = [
    { id: "125949", region: "공주", cat: "history" },
    { id: "126166", region: "경주", cat: "history" },
    { id: "126207", region: "경주", cat: "history" },
    { id: "127977", region: "익산", cat: "history" },
  ];
  for (const lm of landmarks) {
    const found = byId.get(lm.id);
    if (!found) {
      blockers.push(`대표 명소 ${lm.id}(${lm.region}) 누락`);
      continue;
    }
    if (!found.categories?.includes(lm.cat))
      blockers.push(
        `대표 명소 ${lm.id} 분류 오류: ${JSON.stringify(found.categories)}`,
      );
  }
  const totalAttractions = all.length;
  if (totalAttractions < 8000)
    blockers.push(`전체 관광지 수가 비정상적으로 적음: ${totalAttractions}`);
  return blockers;
}

async function main() {
  if (promote && !resume) {
    await promoteOnly();
    return;
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

  const projectedRequests = QUERY_SPECS.length * 6; // 여유 있는 상한 추정
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

  // 프로필 골격
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

  // 1) 스펙별 수집
  const specReports = [];
  const rawById = new Map();
  for (const spec of QUERY_SPECS) {
    const cpSpec = checkpoint.specs[spec.label];
    if (cpSpec?.done) {
      console.log(`[skip] ${spec.label} (체크포인트 완료)`);
      const report = cpSpec.report;
      specReports.push(report);
      for (const item of cpSpec.items ?? []) {
        if (!rawById.has(text(item.contentid)))
          rawById.set(text(item.contentid), item);
      }
      continue;
    }
    console.log(`[collect] ${spec.label} …`);
    const result = await collectSpec(spec, checkpoint.specs[spec.label]?.wip);
    console.log(
      `[collect] ${spec.label} total=${result.totalCount} pages=${result.pageCount} unique=${result.receivedUnique} dupInSpec=${result.duplicateInSpec} drift=${result.drift}`,
    );
    for (const item of result.items) {
      const id = text(item.contentid);
      if (!rawById.has(id)) rawById.set(id, item);
    }
    const report = {
      label: result.label,
      totalCount: result.totalCount,
      pageCount: result.pageCount,
      receivedUnique: result.receivedUnique,
      duplicateInSpec: result.duplicateInSpec,
      emptyPages: result.emptyPages,
      drift: result.drift,
    };
    specReports.push(report);
    checkpoint.specs[spec.label] = {
      done: true,
      report,
      items: result.items,
    };
    delete checkpoint.specs[spec.label].wip;
    await persistCheckpoint();
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
    /** 공식 L1이 관심사 밖 버킷인데 contentTypeId 신호를 들고 온 레코드(해석기가 억제). */
    suppressedNonInterestSignal: {
      AC: 0,
      SH: 0,
      FD: 0,
      EV: 0,
      C01: 0,
      other: 0,
    },
    /** contentTypeId 조회가 데려온 원천 레코드의 공식 L1 분포. */
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

    // 관심사 밖 L1이 contentTypeId 신호를 들고 왔는지 계측(해석기가 억제하는 경우).
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

  // 지역별 카테고리 3개 이상 근거 집계
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
      requestCount: stats.requests,
      retryCount: stats.retries,
      failedRequestCount: stats.failedRequests,
      runId: checkpoint.runId,
    },
    generatedAt: new Date().toISOString(),
    profiles,
  };

  const report = {
    generatedAt: document.generatedAt,
    runId: checkpoint.runId,
    classificationVersion: CLASSIFICATION_VERSION,
    requests: stats,
    specReports,
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
    `요청 ${stats.requests}회 (재시도 ${stats.retries}, 실패 ${stats.failedRequests})`,
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
  console.log(
    `관심사밖 L1이 신호로 유입→억제 ${JSON.stringify(quality.suppressedNonInterestSignal)}`,
  );
  console.log(
    `유형14/28 조회의 공식 L1 분포 ${JSON.stringify(quality.signalSpecL1)}`,
  );
  console.log(`관심사별 배정 ${JSON.stringify(quality.byCategory)}`);
  console.log(`카테고리 3개 이상 지역 ${JSON.stringify(categoryReady)}`);
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

await main().catch((error) => {
  if (error instanceof FatalApiError) {
    console.error(`\n[치명적 중단] ${error.message}`);
  } else {
    console.error(`\n[실패] ${error.message}`);
  }
  process.exitCode = 1;
});
