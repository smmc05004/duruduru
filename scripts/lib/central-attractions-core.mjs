/**
 * 중심 관광지 수집기(T3)의 순수 로직.
 *
 * 네트워크·파일 IO를 갖지 않는 함수와, 주입된 `fetchImpl`로 동작하는 수집 클라이언트를
 * 여기 둔다. `scripts/build-central-attractions.mjs`(CLI)와
 * `scripts/__tests__/build-central-attractions.test.js`(Jest)가 함께 import 한다.
 *
 * 원천: LocgoHubTarService1/areaBasedList1
 * 공식 설명: https://www.data.go.kr/data/15128559/openapi.do
 *
 * 확인한 응답 형식(2026-09-10, baseYm=202608):
 *   - 요청: serviceKey, MobileOS, MobileApp, _type, numOfRows, pageNo, baseYm, areaCd, signguCd
 *   - areaCd = lDongRegnCd(2자리, 세종은 36), signguCd = 5자리 시군구 코드
 *     (일반 지역 = lDongRegnCd + lDongSignguCd, 세종 = 36110)
 *   - 3자리 signguCd·옛 TourAPI areaCode는 resultCode 0000 + totalCount 0(빈 응답)
 *   - 항목 필드: baseYm, mapX, mapY, areaCd, areaNm, signguCd, signguNm,
 *     hubTatsCd(32자리 해시 — TourAPI contentId와 다른 ID), hubTatsNm,
 *     hubCtgryLclsNm, hubCtgryMclsNm, hubRank(1~100, 문자열)
 *   - 미래월/미지원 코드도 resultCode 0000 + totalCount 0
 */

export const SCHEMA_VERSION = 1;
export const BASE_YM = "202608";
export const CENTRAL_API = "LocgoHubTarService1/areaBasedList1";
export const CENTRAL_API_BASE_URL =
  "https://apis.data.go.kr/B551011/LocgoHubTarService1/areaBasedList1";
export const OFFICIAL_DOC_URL =
  "https://www.data.go.kr/data/15128559/openapi.do";

/** 중심 관광지 전용 실행 예산(개발 계정 일일 한도 1,000과 혼동 금지). */
export const DEFAULT_MAX_REQUESTS = 400;
export const MIN_REQUEST_GAP_MS = 1_000;
export const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_RETRIES = 2;
export const RETRY_WAIT_MS = 3_000;
/** API가 상위 100위만 주므로 한 페이지로 끝나지만, 페이지 종료는 방어적으로 검증한다. */
export const PAGE_SIZE = 100;
/** 오래된 잠금 파일을 자동으로 무시하는 기준(분). */
export const STALE_LOCK_MS = 30 * 60 * 1_000;

/** 원천 응답 코드 중 즉시 중단(키/권한/일일 한도). */
export const FATAL_RESULT_CODES = new Set([
  "22", // LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR (일일 한도 초과)
  "30", // SERVICE_KEY_IS_NOT_REGISTERED_ERROR
  "31", // DEADLINE_HAS_EXPIRED_ERROR
  "32", // UNREGISTERED_IP_ERROR
  "33", // UNSIGNED_CALL_ERROR
]);

/** 대기 후 재시도할 원천 응답 코드(초당 허용량 초과·일시 오류). */
export const RETRY_RESULT_CODES = new Set([
  "23", // SERVICE_ACCESS_DENIED_ERROR / 초당 호출 허용량 초과
  "01", // 일시 오류로 관측되는 코드
  "1",
  "5",
]);

export class FatalApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "FatalApiError";
  }
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (value) => String(value ?? "").trim();

/** D0 회귀 표본 지역(구·군 단위, 202608). */
export const SAMPLE_REGION_DISTRICTS = [
  "공주시",
  "익산시",
  "경주시",
  "과천시",
  "광명시",
  "파주시",
];

/**
 * 중심 관광지 API 전용 표준 시군구 코드 오버라이드.
 *
 * `data/region-mapping.json`은 KTDB의 `전남광주통합특별시`(lDongRegnCd "12") 스킴을 쓴다.
 * 이 스킴의 `lDongSignguCd`는 표준 행정표준코드(SIG_CD) 뒤 3자리와 일치하지 않는다
 * (예: 광양시 190 vs 표준 46230, 고흥군 740 vs 표준 46770). 중심 API는 표준 SIG_CD만
 * 받으므로, 광주광역시·전라남도는 아래 검증된 표준 코드로 조회한다.
 *
 * KorService2용 `lDongRegnCd`/`lDongSignguCd`는 손대지 않는다 — 중심 API 파라미터만 바꾼다.
 *
 * 근거: 2026-09-10 공식 응답 대조. 27개 코드 모두 baseYm 202507에서 해당 시군구를 반환했고
 * (signguNm·areaNm 일치), baseYm 202608에서는 광주·전남 전역이 totalCount 0이었다
 * (원천의 해당 월 자료 공백 — 코드 문제가 아님).
 */
export const CENTRAL_SIGNGU_OVERRIDES = {
  "광주광역시|동구": "29110",
  "광주광역시|서구": "29140",
  "광주광역시|남구": "29155",
  "광주광역시|북구": "29170",
  "광주광역시|광산구": "29200",
  "전라남도|목포시": "46110",
  "전라남도|여수시": "46130",
  "전라남도|순천시": "46150",
  "전라남도|나주시": "46170",
  "전라남도|광양시": "46230",
  "전라남도|담양군": "46710",
  "전라남도|곡성군": "46720",
  "전라남도|구례군": "46730",
  "전라남도|고흥군": "46770",
  "전라남도|보성군": "46780",
  "전라남도|화순군": "46790",
  "전라남도|장흥군": "46800",
  "전라남도|강진군": "46810",
  "전라남도|해남군": "46820",
  "전라남도|영암군": "46830",
  "전라남도|무안군": "46840",
  "전라남도|함평군": "46860",
  "전라남도|영광군": "46870",
  "전라남도|장성군": "46880",
  "전라남도|완도군": "46890",
  "전라남도|진도군": "46900",
  "전라남도|신안군": "46910",
};

/** KTDB `전남광주통합특별시` 스킴처럼 표준 SIG_CD가 아닌 것으로 확인된 lDongRegnCd. */
const NON_STANDARD_REGN_CODES = new Set(["12"]);

/**
 * 중심 관광지 API 조회에 쓸 areaCd·signguCd(표준 SIG_CD 5자리)를 결정한다.
 *
 *   1. `province|district`가 오버라이드 표에 있으면 그 표준 코드(areaCd = 앞 2자리).
 *   2. 아니면 `regionCodesFor`의 일반 규칙.
 *   3. 비표준 lDongRegnCd인데 오버라이드가 없으면 throw(잘못된 코드 전송 방지).
 */
export function centralApiCodesFor(mapping) {
  const key = `${text(mapping.province)}|${text(mapping.district)}`;
  const override = CENTRAL_SIGNGU_OVERRIDES[key];
  if (override) {
    return { areaCd: override.slice(0, 2), signguCd: override };
  }
  if (NON_STANDARD_REGN_CODES.has(text(mapping.lDongRegnCd))) {
    throw new Error(
      `비표준 lDongRegnCd(${text(mapping.lDongRegnCd)})인데 중심 API 표준 코드 오버라이드가 없습니다: ${key}`,
    );
  }
  return regionCodesFor(mapping);
}

/**
 * 매핑 한 건에서 areaCd·signguCd(5자리)를 조립한다(일반 규칙).
 * 공식 응답으로 대조한 규칙:
 *   - lDongRegnCd 5자리(세종 36110): signguCd = 그 값, areaCd = 앞 2자리
 *   - lDongRegnCd 2자리 + lDongSignguCd 3자리: signguCd = 이어붙인 5자리, areaCd = lDongRegnCd
 */
export function regionCodesFor(mapping) {
  const regn = text(mapping.lDongRegnCd);
  const signgu = text(mapping.lDongSignguCd);
  let areaCd;
  let signguCd;
  if (/^\d{5}$/.test(regn)) {
    signguCd = regn;
    areaCd = regn.slice(0, 2);
  } else if (/^\d{2}$/.test(regn) && /^\d{3}$/.test(signgu)) {
    signguCd = `${regn}${signgu}`;
    areaCd = regn;
  } else if (/^\d{2}$/.test(regn) && /^\d{5}$/.test(signgu)) {
    signguCd = signgu;
    areaCd = regn;
  } else {
    throw new Error(
      `지역 코드 형식을 해석할 수 없습니다: lDongRegnCd=${regn} lDongSignguCd=${signgu}`,
    );
  }
  if (!/^\d{5}$/.test(signguCd)) {
    throw new Error(`signguCd가 5자리 숫자가 아닙니다: ${signguCd}`);
  }
  return { areaCd, signguCd };
}

/** 원천 resultCode를 처리 방침으로 분류한다. */
export function classifyResultCode(code) {
  const c = text(code);
  if (c === "0000" || c === "00" || c === "0") return "ok";
  if (FATAL_RESULT_CODES.has(c)) return "fatal";
  if (RETRY_RESULT_CODES.has(c)) return "retry";
  return "error";
}

/** HTTP 상태를 처리 방침으로 분류한다. */
export function classifyHttpStatus(status) {
  if (status === 429) return "retry";
  if (status >= 500) return "retry";
  return "error";
}

/** 네트워크 예외를 처리 방침으로 분류한다. */
export function classifyNetworkError(error) {
  const retryNames = new Set(["TimeoutError", "AbortError"]);
  const retryCodes = new Set([
    "ECONNRESET",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ]);
  if (retryNames.has(error?.name) || retryCodes.has(error?.code))
    return "retry";
  return "error";
}

/**
 * 전국 실행에 필요한 최소 요청 수를 보수적으로 추정한다.
 * 지역당 1페이지 + 첫 요청(사실상 잔여 한도 프리플라이트).
 */
export function projectRequestBudget(regionCount) {
  return regionCount + 1;
}

/** 체크포인트를 현재 실행에서 재사용할 수 있는지. */
export function isCheckpointReusable(checkpoint, context) {
  return Boolean(
    checkpoint &&
    checkpoint.baseYm === context.baseYm &&
    checkpoint.mappingVersion === context.mappingVersion &&
    checkpoint.classificationVersion === context.classificationVersion,
  );
}

/**
 * 재개 시 다시 조회할 지역 목록.
 *
 * 건너뛰는 조건(재사용)은 **status가 `ok`이고, 저장된 areaCd·signguCd가 지금 계산한 값과
 * 같을 때뿐**이다. 따라서:
 *   - `failed` · `empty` 지역은 항상 다시 조회한다(원천 월 공백은 값이 싸므로 재확인).
 *   - 코드 정규화로 areaCd/signguCd가 바뀐 지역은 `ok`여도 다시 조회한다(낡은 코드).
 *   - 체크포인트에 없는 지역은 새로 조회한다.
 *
 * `codesFor`는 매핑→{areaCd, signguCd} 함수(기본값 `centralApiCodesFor`).
 */
export function regionsToCollect(
  mappings,
  checkpoint,
  codesFor = centralApiCodesFor,
) {
  const regions = checkpoint?.regions ?? {};
  return mappings.filter((mapping) => {
    const record = regions[mapping.regionId];
    if (!record) return true;
    if (record.status !== "ok") return true;
    let codes;
    try {
      codes = codesFor(mapping);
    } catch {
      return true;
    }
    return record.areaCd !== codes.areaCd || record.signguCd !== codes.signguCd;
  });
}

/** 항목을 저장 형식으로 정규화한다. hubTatsCd는 TourAPI contentId와 분리해 둔다. */
export function normalizeHub(item) {
  const rankRaw = text(item.hubRank);
  const rank = rankRaw === "" ? Number.NaN : Number(rankRaw);
  return {
    hubTatsCd: text(item.hubTatsCd),
    hubTatsName: text(item.hubTatsNm)
      .replace(/<[^>]*>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
    hubRank: Number.isFinite(rank) ? rank : null,
    categoryLcls: text(item.hubCtgryLclsNm),
    categoryMcls: text(item.hubCtgryMclsNm),
    mapX: text(item.mapX),
    mapY: text(item.mapY),
  };
}

function asList(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/**
 * 주입된 `fetchImpl`로 동작하는 수집 클라이언트를 만든다.
 * - 동시성 1, 요청 시작 간 ≥ MIN_REQUEST_GAP_MS.
 * - 예산(성공·실패·재시도 모두 산입) 초과 시 FatalApiError.
 * - 키·키 포함 URL은 로깅하지 않는다(HTTP 상태·원천 코드·지역·페이지만).
 */
export function createCollector({
  fetchImpl,
  serviceKey,
  baseYm = BASE_YM,
  maxRequests = DEFAULT_MAX_REQUESTS,
  now = () => Date.now(),
  sleep = sleepDefault,
  logger = console,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl이 필요합니다.");
  }
  if (!serviceKey) {
    throw new Error("serviceKey가 필요합니다.");
  }

  const stats = { requests: 0, retries: 0, failedRequests: 0 };
  let lastRequestStartedAt = 0;

  async function pace() {
    const wait = MIN_REQUEST_GAP_MS - (now() - lastRequestStartedAt);
    if (wait > 0) await sleep(wait);
    lastRequestStartedAt = now();
  }

  function buildUrl(areaCd, signguCd, pageNo) {
    const url = new URL(CENTRAL_API_BASE_URL);
    // URLSearchParams가 한 번만 인코딩한다(디코딩 키를 넣는다는 전제).
    url.search = new URLSearchParams({
      serviceKey,
      MobileOS: "ETC",
      MobileApp: "DURUDURU_MVP",
      _type: "json",
      numOfRows: String(PAGE_SIZE),
      pageNo: String(pageNo),
      baseYm,
      areaCd,
      signguCd,
    }).toString();
    return url;
  }

  async function requestPage(region, areaCd, signguCd, pageNo) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      if (stats.requests >= maxRequests) {
        throw new FatalApiError(
          `실행 예산 ${maxRequests}회에 도달했습니다. 부분 결과는 정상본으로 만들지 않습니다.`,
        );
      }
      stats.requests += 1;
      if (attempt > 1) stats.retries += 1;

      await pace();
      let body;
      let httpStatus = 0;
      try {
        const response = await fetchImpl(buildUrl(areaCd, signguCd, pageNo), {
          signal:
            typeof AbortSignal !== "undefined" &&
            typeof AbortSignal.timeout === "function"
              ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
              : undefined,
        });
        httpStatus = response.status;
        body = await response.text();
        if (!response.ok) {
          const disposition = classifyHttpStatus(response.status);
          logger.warn(
            `[http-error] ${region} p${pageNo} HTTP ${response.status} disposition=${disposition}`,
          );
          if (disposition === "retry" && attempt <= MAX_RETRIES) {
            await sleep(RETRY_WAIT_MS * attempt);
            continue;
          }
          stats.failedRequests += 1;
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        if (error instanceof FatalApiError) throw error;
        // HTTP 상태 오류는 위 !response.ok 분기에서 이미 분류·재시도·계측됐다.
        if (/^HTTP \d{3}$/.test(String(error.message))) throw error;
        const disposition = classifyNetworkError(error);
        logger.warn(
          `[net-error] ${region} p${pageNo} ${error.name || error.code || "error"} disposition=${disposition}`,
        );
        if (disposition === "retry" && attempt <= MAX_RETRIES) {
          await sleep(RETRY_WAIT_MS * attempt);
          continue;
        }
        stats.failedRequests += 1;
        throw error;
      }

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        stats.failedRequests += 1;
        const codeMatch = String(body).match(
          /<returnReasonCode>([^<]+)<\/returnReasonCode>/u,
        );
        const code = codeMatch ? codeMatch[1] : "non-json";
        logger.warn(
          `[source-error] ${region} p${pageNo} HTTP ${httpStatus} code=${code} (XML/비-JSON)`,
        );
        if (classifyResultCode(code) === "fatal") {
          throw new FatalApiError(`원천 오류 ${code} — 키/권한/일일 한도.`);
        }
        if (classifyResultCode(code) === "retry" && attempt <= MAX_RETRIES) {
          await sleep(RETRY_WAIT_MS * attempt);
          continue;
        }
        throw new Error(`원천 비-JSON 응답 (${code})`);
      }

      const header = payload?.response?.header;
      const resultCode = text(header?.resultCode);
      const disposition = classifyResultCode(resultCode);
      if (disposition !== "ok") {
        stats.failedRequests += 1;
        logger.warn(
          `[source-error] ${region} p${pageNo} HTTP ${httpStatus} code=${resultCode} disposition=${disposition}`,
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

      const bodyNode = payload?.response?.body;
      return {
        items: asList(bodyNode?.items?.item),
        totalCount: Number(bodyNode?.totalCount ?? 0),
        pageNo: Number(bodyNode?.pageNo ?? pageNo),
        attempts: attempt,
      };
    }
  }

  /**
   * 한 지역의 중심 관광지를 수집한다.
   * 반환: { status: "ok"|"empty"|"failed", totalCount, collected, hubs, duplicateHubCds, rankRange, error? }
   */
  async function collectRegion(mapping) {
    const { areaCd, signguCd } = centralApiCodesFor(mapping);
    const label = `${mapping.regionId}(${signguCd})`;
    try {
      const first = await requestPage(label, areaCd, signguCd, 1);
      const totalCount = first.totalCount;
      const pages = [first.items];

      const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) {
        const page = await requestPage(label, areaCd, signguCd, pageNo);
        if (page.items.length === 0) break; // 페이지 종료
        pages.push(page.items);
      }

      const seen = new Set();
      let duplicateHubCds = 0;
      const hubs = [];
      for (const pageItems of pages) {
        for (const raw of pageItems) {
          const hub = normalizeHub(raw);
          if (!hub.hubTatsCd) continue;
          if (seen.has(hub.hubTatsCd)) {
            duplicateHubCds += 1;
            continue;
          }
          seen.add(hub.hubTatsCd);
          hubs.push(hub);
        }
      }
      hubs.sort((a, b) => {
        const ra = a.hubRank ?? Number.MAX_SAFE_INTEGER;
        const rb = b.hubRank ?? Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return a.hubTatsCd.localeCompare(b.hubTatsCd);
      });

      const ranks = hubs
        .map((h) => h.hubRank)
        .filter((r) => Number.isFinite(r));
      const rankRange = ranks.length
        ? { min: Math.min(...ranks), max: Math.max(...ranks) }
        : null;

      if (totalCount === 0 && hubs.length === 0) {
        return {
          status: "empty",
          totalCount,
          collected: 0,
          hubs: [],
          duplicateHubCds: 0,
          rankRange: null,
        };
      }
      return {
        status: "ok",
        totalCount,
        collected: hubs.length,
        hubs,
        duplicateHubCds,
        rankRange,
      };
    } catch (error) {
      if (error instanceof FatalApiError) throw error;
      return {
        status: "failed",
        totalCount: 0,
        collected: 0,
        hubs: [],
        duplicateHubCds: 0,
        rankRange: null,
        error: String(error.message),
      };
    }
  }

  return { stats, collectRegion, requestPage, buildUrl };
}

/**
 * 정상본 교체를 막을 사유 목록을 반환한다.
 * - 부분본(실패 지역 존재)은 전국 갱신으로 게시하지 않는다.
 * - D0 표본 6지역은 정상 수집돼야 한다.
 */
export function validateDocument(doc) {
  const blockers = [];
  if (doc?.schemaVersion !== SCHEMA_VERSION) {
    blockers.push(
      `schemaVersion이 ${SCHEMA_VERSION}이 아님: ${doc?.schemaVersion}`,
    );
  }
  if (doc?.baseYm !== BASE_YM) {
    blockers.push(`baseYm가 ${BASE_YM}이 아님: ${doc?.baseYm}`);
  }
  const regions = Array.isArray(doc?.regions) ? doc.regions : [];
  if (regions.length < 200) {
    blockers.push(`지역 수가 비정상: ${regions.length}`);
  }
  const failed = regions.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    blockers.push(
      `실패 지역 ${failed.length}곳이 남아 전국 정상본으로 교체할 수 없음: ${failed
        .slice(0, 10)
        .map((r) => r.regionId)
        .join(", ")}`,
    );
  }
  const byDistrict = new Map(
    regions.map((r) => [text(r.name).split(/\s+/u).pop(), r]),
  );
  for (const district of SAMPLE_REGION_DISTRICTS) {
    const region = byDistrict.get(district);
    if (!region) {
      blockers.push(`표본 지역 누락: ${district}`);
      continue;
    }
    if (region.status !== "ok") {
      blockers.push(`표본 지역 ${district} 상태가 ok 아님: ${region.status}`);
    } else if ((region.collected ?? 0) < 30) {
      blockers.push(
        `표본 지역 ${district} 수집 건수가 비정상: ${region.collected}`,
      );
    }
  }
  const gongju = byDistrict.get("공주시");
  if (
    gongju?.status === "ok" &&
    !gongju.hubs?.some((h) => h.hubTatsName.includes("공산성"))
  ) {
    blockers.push("표본 지역 공주시에 '공산성'이 없음(응답 형태 회귀 실패)");
  }
  return blockers;
}
