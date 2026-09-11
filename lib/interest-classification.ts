/**
 * 공통 관심사 해석기 (T1).
 *
 * 수집(`scripts/build-region-profile.mjs`)·검색(`lib/mvp-phase-two-search.ts`)·
 * 후보/저장 변환이 같은 규칙으로 TourAPI 분류를 5개 관심사로 해석하도록 한다.
 *
 * 규칙 요약:
 * 1. 새 공식 분류(`lclsSystm1/2/3`)가 있으면 그 값만으로 관심사를 판정한다.
 *    이때 구 `cat1/2/3` 값은 보지 않는다(새 분류 우선).
 * 2. 새 분류가 전혀 없을 때만 구 `cat1/2/3` 하위 호환 규칙을 쓴다.
 * 3. `contentTypeId` 14(문화시설)·28(레포츠)는 두 경로 모두에서 유효한 안정 신호다.
 * 4. 레코드에 있는 `lclsSystm*` 코드 중 2026-09-10 공식 코드 목록에 없는 값은
 *    임의로 기존 코드로 덮지 않고 `unresolvedLcls`로 분리해 집계 대상으로 남긴다.
 *
 * 공식 코드 목록 원천: KorService2 `lclsSystmCode2` (조회일 2026-09-10).
 * 전체 계층·명칭은 `data/tourapi-lcls-systm-codes.json`에 보존한다.
 * 관심사↔코드 버전별 표는 `docs/product/TOURISM_RECOMMENDATION_UPGRADE.md` D1을 따른다.
 *
 * 이 모듈은 `.mjs` 수집 스크립트가 상대 경로로 직접 import 하므로 런타임 의존성을
 * 두지 않는다(에러블 문법만 사용). 관심사 ID의 단일 출처도 여기에 둔다.
 */

/** MVP가 지원하는 5개 관심사. 표시·판정 정렬의 기준 순서다. */
export const MVP_CATEGORY_IDS = [
  "nature",
  "history",
  "rest",
  "culture",
  "leisure",
] as const;

export type MvpCategoryId = (typeof MVP_CATEGORY_IDS)[number];

/** 이 해석기가 기준으로 삼은 공식 분류 목록의 버전(조회일). */
export const CLASSIFICATION_VERSION = "lcls-2026-09-10";

/** 2026-09-10 기준 공식 `lclsSystm1` 코드와 명칭. */
export const OFFICIAL_LCLS1_NAMES: Readonly<Record<string, string>> = {
  AC: "숙박",
  C01: "추천코스",
  EV: "축제/공연/행사",
  EX: "체험관광",
  FD: "음식",
  HS: "역사관광",
  LS: "레저스포츠",
  NA: "자연관광",
  SH: "쇼핑",
  VE: "문화관광",
};

/**
 * 2026-09-10 `lclsSystmCode2` 응답의 모든 `lclsSystm1/2/3` 코드.
 * `data/tourapi-lcls-systm-codes.json`에서 파생했으며 두 값의 동기화는
 * `lib/__tests__/interest-classification.test.ts`가 검증한다.
 */
export const KNOWN_LCLS_CODES: ReadonlySet<string> = new Set([
  "AC",
  "AC01",
  "AC010100",
  "AC02",
  "AC020100",
  "AC020200",
  "AC03",
  "AC030100",
  "AC030200",
  "AC030300",
  "AC030400",
  "AC04",
  "AC040100",
  "AC05",
  "AC050100",
  "AC050200",
  "AC050300",
  "AC050400",
  "AC06",
  "AC060100",
  "AC060200",
  "C01",
  "C0112",
  "C01120001",
  "C0113",
  "C01130001",
  "C0114",
  "C01140001",
  "C0115",
  "C01150001",
  "C0116",
  "C01160001",
  "C0117",
  "C01170001",
  "EV",
  "EV01",
  "EV010100",
  "EV010200",
  "EV010300",
  "EV010400",
  "EV010500",
  "EV010600",
  "EV02",
  "EV020100",
  "EV020200",
  "EV020300",
  "EV020400",
  "EV020500",
  "EV020600",
  "EV020700",
  "EV020800",
  "EV020900",
  "EV021000",
  "EV03",
  "EV030100",
  "EV030200",
  "EV030300",
  "EV030400",
  "EX",
  "EX01",
  "EX010100",
  "EX02",
  "EX020100",
  "EX020200",
  "EX020300",
  "EX020400",
  "EX03",
  "EX030100",
  "EX030200",
  "EX030300",
  "EX030400",
  "EX04",
  "EX040100",
  "EX040200",
  "EX05",
  "EX050100",
  "EX050200",
  "EX050300",
  "EX050400",
  "EX050500",
  "EX050600",
  "EX050700",
  "EX050800",
  "EX06",
  "EX060100",
  "EX060200",
  "EX060300",
  "EX060400",
  "EX060500",
  "EX060600",
  "EX060700",
  "EX060800",
  "EX060900",
  "EX061000",
  "EX07",
  "EX070100",
  "EX070200",
  "FD",
  "FD01",
  "FD010100",
  "FD010200",
  "FD02",
  "FD020100",
  "FD020200",
  "FD020300",
  "FD020400",
  "FD020500",
  "FD03",
  "FD030100",
  "FD030200",
  "FD030300",
  "FD030400",
  "FD030500",
  "FD030600",
  "FD04",
  "FD040100",
  "FD040200",
  "FD040300",
  "FD040400",
  "FD040500",
  "FD05",
  "FD050100",
  "FD050200",
  "FD050300",
  "HS",
  "HS01",
  "HS010100",
  "HS010200",
  "HS010300",
  "HS010400",
  "HS010500",
  "HS010600",
  "HS010700",
  "HS010800",
  "HS010900",
  "HS011000",
  "HS011100",
  "HS011200",
  "HS02",
  "HS020100",
  "HS020200",
  "HS020300",
  "HS020400",
  "HS03",
  "HS030100",
  "HS030200",
  "HS030300",
  "HS030400",
  "HS04",
  "HS040100",
  "HS040200",
  "HS040300",
  "HS040400",
  "LS",
  "LS01",
  "LS010100",
  "LS010200",
  "LS010300",
  "LS010400",
  "LS010500",
  "LS010600",
  "LS010700",
  "LS010800",
  "LS010900",
  "LS011000",
  "LS011100",
  "LS011200",
  "LS011300",
  "LS011400",
  "LS011500",
  "LS011600",
  "LS011700",
  "LS011800",
  "LS011900",
  "LS02",
  "LS020100",
  "LS020200",
  "LS020300",
  "LS020400",
  "LS020500",
  "LS020600",
  "LS020700",
  "LS020800",
  "LS020900",
  "LS021000",
  "LS021100",
  "LS021200",
  "LS021300",
  "LS021400",
  "LS03",
  "LS030100",
  "LS030200",
  "LS030300",
  "LS030400",
  "LS030500",
  "LS030600",
  "LS04",
  "LS040100",
  "NA",
  "NA01",
  "NA010100",
  "NA010200",
  "NA010300",
  "NA010400",
  "NA010500",
  "NA02",
  "NA020100",
  "NA020200",
  "NA020300",
  "NA020400",
  "NA020500",
  "NA020600",
  "NA020700",
  "NA020800",
  "NA020900",
  "NA03",
  "NA030100",
  "NA030200",
  "NA030300",
  "NA030400",
  "NA030500",
  "NA04",
  "NA040100",
  "NA040200",
  "NA040300",
  "NA040400",
  "NA040500",
  "NA040600",
  "NA040700",
  "NA05",
  "NA050100",
  "SH",
  "SH01",
  "SH010100",
  "SH02",
  "SH020100",
  "SH020200",
  "SH03",
  "SH030100",
  "SH04",
  "SH040100",
  "SH040200",
  "SH040300",
  "SH05",
  "SH050100",
  "SH050200",
  "SH050300",
  "SH06",
  "SH060100",
  "SH060200",
  "SH07",
  "SH070100",
  "VE",
  "VE01",
  "VE010100",
  "VE010200",
  "VE010300",
  "VE010400",
  "VE010500",
  "VE010600",
  "VE010700",
  "VE010800",
  "VE010900",
  "VE02",
  "VE020100",
  "VE020200",
  "VE020300",
  "VE020400",
  "VE020500",
  "VE03",
  "VE030100",
  "VE030200",
  "VE030300",
  "VE030400",
  "VE030500",
  "VE04",
  "VE040100",
  "VE040200",
  "VE040300",
  "VE05",
  "VE050100",
  "VE050200",
  "VE06",
  "VE060100",
  "VE060200",
  "VE07",
  "VE070100",
  "VE070200",
  "VE070300",
  "VE070400",
  "VE070500",
  "VE070600",
  "VE08",
  "VE080600",
  "VE09",
  "VE090100",
  "VE090200",
  "VE090300",
  "VE090400",
  "VE090500",
  "VE090600",
  "VE10",
  "VE100100",
  "VE100200",
  "VE11",
  "VE110100",
  "VE110200",
  "VE110300",
  "VE110400",
  "VE110500",
  "VE110600",
  "VE12",
  "VE120100",
  "VE120200",
  "VE120300",
]);

type InterestRule = {
  /** 새 공식 분류 경로: 이 코드들 중 하나라도 레코드의 lclsSystm1/2/3에 있으면 일치. */
  lcls?: string[];
  /** 두 경로 공통: 안정적인 `contentTypeId` 신호. */
  contentTypeId?: string[];
  /** 하위 호환 경로: 새 분류가 전혀 없을 때만 본다. */
  legacyCat?: string[];
};

/**
 * 관심사 ↔ 분류 코드 표 (버전 2026-09-10).
 *
 * - nature/history/leisure 는 공식 L1 명칭이 1:1(자연관광/역사관광/레저스포츠)이라 활성화한다.
 * - culture 는 새 `VE 문화관광`이 구 `A0206 문화시설`보다 넓어, 의미를 보존하는 하위
 *   코드(공연·전시·교육 시설과 서점)만 활성화한다.
 * - rest(휴양)는 새 체계에 대응 L1이 없다. PM 결정(2026-09-10)에 따라 의미가 가장
 *   근접한 L2 세 개 — `EX05 웰니스관광`(온천·스파·찜질방·힐링), `NA04 자연공원`
 *   (국립·도립공원·지질공원·자연휴양림·수목원), `VE03 도시공원` — 로 활성화한다.
 *   `VE02 테마파크`·`VE05 복합관광시설`·리조트(놀이공원·리조트)는 휴양으로 보지 않는다.
 *   구 `cat2=A0202`는 새 분류가 없을 때만 fallback으로 유지한다.
 */
export const INTEREST_CLASSIFICATION_RULES: Readonly<
  Record<MvpCategoryId, InterestRule>
> = {
  nature: { lcls: ["NA"], legacyCat: ["A01"] },
  history: { lcls: ["HS"], legacyCat: ["A0201"] },
  rest: { lcls: ["EX05", "NA04", "VE03"], legacyCat: ["A0202"] },
  culture: {
    lcls: ["VE06", "VE07", "VE09", "VE120100"],
    contentTypeId: ["14"],
    legacyCat: ["A0206"],
  },
  leisure: { lcls: ["LS"], contentTypeId: ["28"], legacyCat: ["A03"] },
};

export type ClassificationInput = {
  lclsSystm1?: string | null;
  lclsSystm2?: string | null;
  lclsSystm3?: string | null;
  cat1?: string | null;
  cat2?: string | null;
  cat3?: string | null;
  contentTypeId?: string | null;
};

export type ClassificationBasis = "lcls" | "legacy" | "none";

export type ClassificationResult = {
  /** 해석된 관심사. 안정적인 정렬(선언 순서)을 유지한다. */
  categories: MvpCategoryId[];
  /** 어떤 분류 경로로 판정했는지. */
  basis: ClassificationBasis;
  /**
   * 레코드에 있으나 2026-09-10 공식 코드 목록에 없는 `lclsSystm*` 값.
   * 임의로 기존 코드로 덮지 않고 검토 대상으로 집계한다.
   */
  unresolvedLcls: string[];
};

const clean = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim() : "";

/** 새 공식 분류가 하나라도 있는 레코드인지. */
export function hasOfficialClassification(input: ClassificationInput): boolean {
  return !!(
    clean(input.lclsSystm1) ||
    clean(input.lclsSystm2) ||
    clean(input.lclsSystm3)
  );
}

/**
 * 5개 관심사에 매핑되지 않는 공식 L1. 레코드가 이 버킷으로 공식 분류되면
 * `contentTypeId` 신호가 있어도 관심사로 보지 않는다(공식 분류가 신호를 이긴다).
 * 예: `AC 숙박` + `contentTypeId=28`(수영장 있는 리조트)을 레저로 넣지 않는다.
 */
export const NON_INTEREST_LCLS1: ReadonlySet<string> = new Set([
  "AC",
  "SH",
  "FD",
  "EV",
  "C01",
]);

/**
 * TourAPI 분류를 5개 관심사로 해석한다.
 *
 * - 새 분류가 있으면 새 분류 + `contentTypeId`만 본다. 단, 공식 L1이 관심사 밖
 *   버킷(`AC`/`SH`/`FD`/`EV`/`C01`)이면 `contentTypeId` 신호도 무시한다.
 * - 새 분류가 없으면 구 `cat` + `contentTypeId`만 본다.
 * - 공식 목록에 없는 새 코드는 `unresolvedLcls`로 분리한다.
 */
export function classifyInterests(
  input: ClassificationInput,
): ClassificationResult {
  const lcls = [
    clean(input.lclsSystm1),
    clean(input.lclsSystm2),
    clean(input.lclsSystm3),
  ].filter(Boolean);
  const contentTypeId = clean(input.contentTypeId);
  const usesOfficial = lcls.length > 0;
  const categories: MvpCategoryId[] = [];

  const unresolvedLcls = usesOfficial
    ? lcls.filter((code) => !KNOWN_LCLS_CODES.has(code))
    : [];

  const officialNonInterest =
    usesOfficial && NON_INTEREST_LCLS1.has(clean(input.lclsSystm1));

  for (const id of MVP_CATEGORY_IDS) {
    const rule = INTEREST_CLASSIFICATION_RULES[id];
    let matched = false;
    if (
      !officialNonInterest &&
      rule.contentTypeId &&
      rule.contentTypeId.includes(contentTypeId)
    )
      matched = true;
    if (usesOfficial) {
      if (rule.lcls && rule.lcls.some((code) => lcls.includes(code)))
        matched = true;
    } else if (
      rule.legacyCat &&
      [clean(input.cat1), clean(input.cat2), clean(input.cat3)].some(
        (code) => code && rule.legacyCat!.includes(code),
      )
    ) {
      matched = true;
    }
    if (matched) categories.push(id);
  }

  const basis: ClassificationBasis = usesOfficial
    ? "lcls"
    : categories.length > 0
      ? "legacy"
      : "none";

  return { categories, basis, unresolvedLcls };
}

export type DetailClassificationInput = {
  lclsSystm2?: string | null;
  lclsSystm3?: string | null;
  cat2?: string | null;
  cat3?: string | null;
  categories?: readonly string[];
};

/**
 * 세부 분류 다양성 지표의 "값" 계산 근거 (결함 2).
 *
 * 새 공식 세부 분류(`lclsSystm3` → 없으면 `lclsSystm2`)를 우선하고, 없을 때만 구
 * `cat3` → `cat2`, 마지막으로 해석된 관심사 조합 문자열로 물러난다. 수집·검색·planner
 * 가 세부 분류 다양성을 같은 기준으로 세도록 이 헬퍼 하나만 쓴다.
 *
 * 정렬 키 순서·가중치·역할 순서는 이 변경으로 바뀌지 않는다. 이 함수가 돌려주는
 * 문자열의 계산 근거만 새 분류 우선으로 교체한다.
 */
export function detailClassification(input: DetailClassificationInput): string {
  return (
    clean(input.lclsSystm3) ||
    clean(input.lclsSystm2) ||
    clean(input.cat3) ||
    clean(input.cat2) ||
    (input.categories ?? []).join("+")
  );
}

/**
 * 목적 적합성 지표(T7 / D4)의 "세부 유형" 값. `detailClassification`과 달리 관심사
 * 조합 문자열 fallback을 쓰지 않는다 — D4는 "분류 결측을 독립 유형으로 세지 않는다".
 * 새 공식 세부 분류(`lclsSystm3` → `lclsSystm2`)를 우선하고, 없을 때만 구 `cat3` →
 * `cat2`를 본다. 아무 분류도 없으면 `null`이다.
 */
export function detailClassificationStrict(
  input: DetailClassificationInput,
): string | null {
  return (
    clean(input.lclsSystm3) ||
    clean(input.lclsSystm2) ||
    clean(input.cat3) ||
    clean(input.cat2) ||
    null
  );
}
