/*
 * 추천(층 ①) 점수·판정 정책.
 *
 * 추천 규칙은 docs/product/TRAVEL_RECOMMENDATION.md를 따른다.
 *   1. 주입 — 값은 엔진의 소스 상수·기본 인자가 아니라 아래 정책 객체로 주입한다.
 *             정책이 없으면 엔진은 임의값으로 대체하지 않고 실패한다.
 *   2. 구조 — 가중치 집합과 **순서가 있는 동점 단계 목록**을 데이터로 담는다.
 *             동점 규칙을 코드 분기로 쓰지 않는다.
 *   3. 기록 — 결과에 정책 버전·사용된 가중치·구성요소별 점수·갈린 동점 단계를 남긴다.
 *             기록은 lib/recommendation.ts가 한다.
 *
 * 값의 성격: 조사값이 아니라 제품 판단이다(6.1·6.3·7.1·7.2절). 조정은 `version`을 올려서 한다.
 * 값을 바꾸면서 버전을 그대로 두면 과거 결과의 재현이 깨진다.
 */

/** 층 ① 점수 구성요소. 축제는 F-06 구현 전까지 사용 불가다. */
export type ScoreComponentId = "timeFit" | "interestFit" | "festivalFit";

export type ScoreComponentSpec = {
  id: ScoreComponentId;
  /** 화면과 로그가 함께 쓰는 표시명 */
  label: string;
  /**
   * 이 구성요소를 지금 계산할 수 있는가.
   * false면 항을 제외하고 남은 항의 가중치 집합을 쓴다.
   * 0점으로 남기지 않는 이유는 6.1절에 있다 — 순서는 같지만 표시 점수가 실제보다 낮아진다.
   */
  enabled: boolean;
  /** 사용할 수 없다면 그 이유. 화면이 그대로 쓸 수 있는 문장이다. */
  disabledReason?: string;
};

/**
 * 사용 가능한 구성요소 조합별 가중치 집합.
 *
 * 재정규화를 비율 계산으로 유도하지 않고 **집합을 데이터로 나열한다.** 이유는 6.1절이 확정한
 * 값이 유도값과 다르기 때문이다 — 축제 항을 뺀 0.50 / 0.35를 비례 재정규화하면 0.588 / 0.412가
 * 되지만, 문서가 확정한 값은 **0.60 / 0.40**이다. 유도식을 쓰면 확정값이 아닌 값이 나온다.
 * 대응하는 집합이 없으면 엔진은 임의로 계산하지 않고 실패한다.
 */
export type WeightSet = {
  /** 이 집합이 적용되는 사용 가능 구성요소 (순서 무관) */
  components: ScoreComponentId[];
  weights: Partial<Record<ScoreComponentId, number>>;
  /** 근거 문서 위치 */
  basis: string;
};

/** 동점 단계 식별자. 값 추출은 엔진이 이 id로 찾는다. */
export type TiebreakMetricId =
  "localAvailableHours" | "roundTripHours" | "destinationId";

export type TiebreakStep = {
  id: TiebreakMetricId;
  label: string;
  /** desc = 큰 값이 앞선다, asc = 작은 값이 앞선다 */
  direction: "asc" | "desc";
};

export type RecommendationPolicy = {
  /** 정책 버전. 값을 바꾸면 반드시 올린다. */
  version: string;
  /**
   * 최소 현지 체류시간 = hoursPerDay × 일수 (일수 = 박수 + 1).
   * 당일치기 4시간 / 1박 2일 8시간 / 2박 3일 12시간 (DECISIONS 6.3절 일반화).
   */
  minimumLocalStay: { hoursPerDay: number };
  components: ScoreComponentSpec[];
  weightSets: WeightSet[];
  /** 순서대로 적용한다. 앞 단계에서 갈리면 뒤 단계는 보지 않는다. */
  tiebreakSteps: TiebreakStep[];
};

export const recommendationPolicyV1: RecommendationPolicy = {
  version: "layer1-2026-08-31",
  minimumLocalStay: { hoursPerDay: 4 },
  components: [
    { id: "timeFit", label: "시간 적합성", enabled: true },
    { id: "interestFit", label: "관심사 일치", enabled: true },
    {
      id: "festivalFit",
      label: "축제 적합성",
      enabled: false,
      disabledReason:
        "축제 추천(F-06)이 아직 구현되지 않아 점수에 넣지 않아요.",
    },
  ],
  weightSets: [
    {
      components: ["timeFit", "interestFit", "festivalFit"],
      weights: { timeFit: 0.5, interestFit: 0.35, festivalFit: 0.15 },
      basis: "DECISIONS.md 6.1절 층 ① 표 (축제 포함)",
    },
    {
      components: ["timeFit", "interestFit"],
      weights: { timeFit: 0.6, interestFit: 0.4 },
      basis: "DECISIONS.md 6.1절 층 ① 표 — 축제 미구현 구간(F-06 이전)",
    },
    {
      // 관심사 0개 안전장치. 정상 흐름에서는 도달하지 않는다(7.3절 관심사 1개 이상 필수).
      components: ["timeFit"],
      weights: { timeFit: 1 },
      basis: "DECISIONS.md 6.1절 — 계산할 수 없는 구성요소는 제외 후 재정규화",
    },
  ],
  tiebreakSteps: [
    {
      id: "localAvailableHours",
      label: "현지 이용 가능 시간이 긴 곳",
      direction: "desc",
    },
    {
      id: "roundTripHours",
      label: "왕복 이동시간이 짧은 곳",
      direction: "asc",
    },
    { id: "destinationId", label: "목적지 식별자 오름차순", direction: "asc" },
  ],
};
