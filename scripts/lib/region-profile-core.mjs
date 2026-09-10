/**
 * 관광지 지역 프로필 수집기(T2)의 순수 로직.
 *
 * 네트워크·파일 IO 없는 함수와, 주입된 `fetchImpl`로 동작하는 스펙 수집 클라이언트를
 * 여기 둔다. `scripts/build-region-profile.mjs`(CLI)와
 * `scripts/__tests__/build-region-profile.test.js`(Jest)가 함께 import 한다.
 *
 * 관심사 판정(`classifyInterests`)은 CLI에 남긴다 — 이 모듈은 `.ts` 의존성을 갖지
 * 않는다. 여기서는 페이지 수집·재개·완전성 검증만 담당한다.
 *
 * 원천: KorService2/areaBasedList2. 새 공식 분류(`lclsSystm*`)와 안정 신호
 * (`contentTypeId` 14·28)로 전국 목록을 페이지 끝까지 받는다.
 */

import { assessCompleteness, expectedPageCount } from "./paged-collection.mjs";

export const TOUR_API_BASE_URL = "https://apis.data.go.kr/B551011/KorService2";
export const REQUEST_TIMEOUT_MS = 20_000;
export const MIN_REQUEST_GAP_MS = 1_000;
export const PAGE_SIZE = 1_000;
export const DEFAULT_MAX_REQUESTS = 900;
export const MAX_RETRIES = 2;
export const RETRY_WAIT_MS = 3_000;
export const SCHEMA_VERSION = 2;

/**
 * 조회 스펙. 모든 결과는 contentId로 합쳐 해석기가 한 번만 판정하므로 스펙 간 중복은
 * 자연히 제거된다.
 */
export const QUERY_SPECS = [
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
export const FATAL_RESULT_CODES = new Set(["22", "30", "31", "32", "33"]);

export class FatalApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "FatalApiError";
  }
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (value) => String(value ?? "").trim();

export function asList(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export function classifyFailure(resultCode) {
  if (FATAL_RESULT_CODES.has(resultCode)) return "fatal";
  if (["11", "12", "20", "21", "01", "1", "5"].includes(resultCode))
    return "retry";
  return "error";
}

/**
 * 주입된 `fetchImpl`로 동작하는 스펙 수집 클라이언트.
 * - 동시성 1, 요청 시작 간 ≥ MIN_REQUEST_GAP_MS.
 * - 예산(성공·실패·재시도 모두 산입) 초과 시 FatalApiError.
 * - 키·키 포함 URL은 로깅하지 않는다.
 */
export function createProfileCollector({
  fetchImpl,
  serviceKey,
  maxRequests = DEFAULT_MAX_REQUESTS,
  now = () => Date.now(),
  sleep = sleepDefault,
  logger = console,
}) {
  if (typeof fetchImpl !== "function")
    throw new Error("fetchImpl이 필요합니다.");
  if (!serviceKey) throw new Error("serviceKey가 필요합니다.");

  const stats = { requests: 0, retries: 0, failedRequests: 0 };
  let lastRequestStartedAt = 0;

  async function pace() {
    const wait = MIN_REQUEST_GAP_MS - (now() - lastRequestStartedAt);
    if (wait > 0) await sleep(wait);
    lastRequestStartedAt = now();
  }

  function buildUrl(spec, pageNo) {
    const url = new URL(`${TOUR_API_BASE_URL}/areaBasedList2`);
    url.search = new URLSearchParams({
      serviceKey,
      MobileOS: "ETC",
      MobileApp: "DURUDURU_MVP",
      _type: "json",
      arrange: "A",
      numOfRows: String(PAGE_SIZE),
      pageNo: String(pageNo),
      ...spec.params,
    }).toString();
    return url;
  }

  /** 한 페이지 조회. 반환: { items, totalCount, attempts }. */
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

      await pace();
      let payload;
      let httpStatus = 0;
      try {
        const response = await fetchImpl(buildUrl(spec, pageNo), {
          signal:
            typeof AbortSignal !== "undefined" &&
            typeof AbortSignal.timeout === "function"
              ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
              : undefined,
        });
        httpStatus = response.status;
        const body = await response.text();
        if (!response.ok) {
          if (
            (response.status >= 500 || response.status === 429) &&
            attempt <= MAX_RETRIES
          ) {
            logger.warn?.(
              `[retry] ${spec.label} p${pageNo} HTTP ${response.status} (attempt ${attempt})`,
            );
            await sleep(RETRY_WAIT_MS * attempt);
            continue;
          }
          stats.failedRequests += 1;
          throw new Error(`HTTP ${response.status}`);
        }
        try {
          payload = JSON.parse(body);
        } catch {
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
        if (/^HTTP \d{3}$/.test(String(error.message))) throw error;
        if (
          (error.name === "TimeoutError" ||
            error.name === "AbortError" ||
            error.code === "ECONNRESET" ||
            error.code === "ETIMEDOUT" ||
            error.code === "UND_ERR_CONNECT_TIMEOUT") &&
          attempt <= MAX_RETRIES
        ) {
          logger.warn?.(
            `[retry] ${spec.label} p${pageNo} ${error.name || error.code} (attempt ${attempt})`,
          );
          await sleep(RETRY_WAIT_MS * attempt);
          continue;
        }
        stats.failedRequests += 1;
        throw error;
      }

      const header = payload?.response?.header;
      const resultCode = text(header?.resultCode);
      if (resultCode !== "0000") {
        stats.failedRequests += 1;
        const disposition = classifyFailure(resultCode);
        logger.warn?.(
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
   * 한 스펙을 페이지 끝까지 조회한다.
   *
   * `savedPages`(`{ [pageNo]: { totalCount, items } }` 또는 `{ [pageNo]: items[] }`)를
   * 주면 그 페이지는 다시 호출하지 않는다(결함 3). `onPage(pageNo, { totalCount, items })`
   * 는 페이지 성공마다 호출한다.
   *
   * 완전성(건수 부족·페이지 누락·페이지 간 중복·페이지별 totalCount 변동)을 평가해
   * `completeness.blockers`로 돌려준다(결함 1).
   */
  async function collectSpec(spec, opts = {}) {
    const { savedPages = {}, onPage } = opts;
    /** pageNo -> { totalCount, items } */
    const fetched = new Map();
    for (const [key, value] of Object.entries(savedPages)) {
      const pageNo = Number(key);
      if (!Number.isInteger(pageNo) || pageNo < 1) continue;
      if (Array.isArray(value)) {
        fetched.set(pageNo, { totalCount: null, items: value });
      } else if (value && Array.isArray(value.items)) {
        fetched.set(pageNo, {
          totalCount: Number.isFinite(Number(value.totalCount))
            ? Number(value.totalCount)
            : null,
          items: value.items,
        });
      }
    }

    if (!fetched.has(1)) {
      const first = await requestPage(spec, 1);
      fetched.set(1, { totalCount: first.totalCount, items: first.items });
      if (onPage) await onPage(1, fetched.get(1));
    }
    const declaredTotal = fetched.get(1).totalCount ?? 0;
    const pageCount = expectedPageCount(declaredTotal, PAGE_SIZE);

    for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) {
      if (fetched.has(pageNo)) continue;
      const page = await requestPage(spec, pageNo);
      fetched.set(pageNo, { totalCount: page.totalCount, items: page.items });
      if (onPage) await onPage(pageNo, fetched.get(pageNo));
    }

    const orderedPages = [...fetched.entries()].sort((a, b) => a[0] - b[0]);
    const items = [];
    const seen = new Set();
    let duplicateInSpec = 0;
    for (const [, page] of orderedPages) {
      for (const item of page.items) {
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

    const completeness = assessCompleteness({
      declaredTotal,
      pageSize: PAGE_SIZE,
      pages: orderedPages.map(([pageNo, page]) => ({
        pageNo,
        totalCount: page.totalCount,
        ids: page.items.map((item) => text(item.contentid)).filter(Boolean),
      })),
    });

    return {
      label: spec.label,
      totalCount: declaredTotal,
      pageCount,
      fetchedPageNos: completeness.fetchedPageNos,
      missingPages: completeness.missingPages,
      perPageTotals: completeness.totalCountValues,
      receivedUnique: items.length,
      duplicateInSpec,
      crossPageDuplicates: completeness.crossPageDuplicateCount,
      emptyPages: completeness.missingPages.length,
      drift: completeness.shortfall,
      blockers: completeness.blockers,
      savedPages: Object.fromEntries(orderedPages),
      items,
    };
  }

  return { stats, collectSpec, requestPage, buildUrl };
}

/**
 * 대표 명소·최소 건수·수집 완전성 회귀 검증. 교체(promote) 차단 사유 목록을 반환한다.
 * `doc.completeness.blockers`(스펙별 불완전 수집 사유)가 있으면 그대로 차단한다.
 */
export function validateDocument(doc) {
  const blockers = [];
  if (doc?.schemaVersion !== SCHEMA_VERSION) {
    blockers.push(
      `schemaVersion이 ${SCHEMA_VERSION}이 아님: ${doc?.schemaVersion}`,
    );
  }
  if (!Array.isArray(doc?.profiles) || doc.profiles.length < 200) {
    blockers.push(`지역 프로필 수가 비정상: ${doc?.profiles?.length}`);
  }

  // 결함 1: 수집 완전성 실패는 정상본 교체를 막는다.
  if (
    Array.isArray(doc?.completeness?.blockers) &&
    doc.completeness.blockers.length
  ) {
    for (const blocker of doc.completeness.blockers) {
      blockers.push(`수집 불완전: ${blocker}`);
    }
  }

  const all = (doc?.profiles ?? []).flatMap((p) =>
    (p.attractions ?? []).map((a) => ({ ...a, regionId: p.regionId })),
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
    if (!found.categories?.includes(lm.cat)) {
      blockers.push(
        `대표 명소 ${lm.id} 분류 오류: ${JSON.stringify(found.categories)}`,
      );
    }
  }
  if (all.length < 8000) {
    blockers.push(`전체 관광지 수가 비정상적으로 적음: ${all.length}`);
  }
  return blockers;
}
