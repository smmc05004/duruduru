import type { DomainDataAdapter } from "./domain-data";
import type {
  RecommendationPolicy,
  ScoreComponentId,
  TiebreakMetricId,
} from "./trip-policy";
import type { TravelTimeAdapter, TravelTimeEstimate } from "./travel-time";
import type { ValidTripConditions } from "./trip-conditions";

/*
 * F-02 목적지 가능 여부·추천, F-03 점수·추천 근거의 도메인 규칙.
 *
 * 판정식 (FUNCTIONAL_SPEC.md F-02 · DECISIONS.md 2.3절 — 복귀 버퍼 항은 없다):
 *   현지 이용 가능 시간 = 복귀 − 출발 − 편도 이동 × 2
 *   통과 조건 = 현지 이용 가능 시간 ≥ 최소 현지 체류시간
 *
 * 점수 산식 (DECISIONS.md 7.1 · 7.2절):
 *   시간 적합성 = 현지 이용 가능 시간 / (복귀 − 출발)
 *   관심사 일치 = (목적지 태그 ∩ 선택 관심사) 개수 / 선택 관심사 개수
 * 두 값 모두 후보 집합에 의존하지 않는 절대 기준이다. 후보 중 최대값으로 정규화하지 않는다.
 *
 * ⚠ 알려진 느슨함 — 밤 시간 문제 (DECISIONS.md 5.4 · 7.4절).
 *   판정식은 밤 시간을 현지 이용 가능 시간에 포함한다. "저녁에는 숙소로 돌아간다"가 확정돼
 *   밤 시간이 관광에 쓰이지 않으므로 1박 이상에서 기준이 느슨할 수 있다.
 *   **지금 판정식을 바꾸지 않는다.** F-04 구현 시점의 재검토 대상으로 기록돼 있다.
 */

/** 점수를 매길 목적지 후보. 태그는 5장 "목적지 태그" 계약에서 온다. */
export type DestinationCandidate = {
  id: string;
  name: string;
  region: string;
  tags: string[];
};

export type ScoreComponentResult = {
  id: ScoreComponentId;
  label: string;
  /** 계산할 수 있었는가. false면 항을 제외하고 남은 항을 재정규화했다. */
  available: boolean;
  unavailableReason?: string;
  /** 0~1 원값. 계산할 수 없으면 null이다(0으로 대체하지 않는다). */
  raw: number | null;
  /** 재정규화 후 실제 사용된 가중치 */
  weight: number;
  /** raw × weight */
  weighted: number;
};

export type CandidateEvaluation = {
  id: string;
  name: string;
  region: string;
  tags: string[];
  /** 이동시간 데이터를 얻지 못하면 null이다. */
  travel: TravelTimeEstimate | null;
  oneWayHours: number | null;
  roundTripHours: number | null;
  localAvailableHours: number | null;
  minimumLocalStayHours: number;
  passed: boolean;
  rejectionReason?: string;
  /** 선택 관심사 중 이 목적지 태그와 겹친 것 */
  interestMatches: string[];
  score: number;
  components: ScoreComponentResult[];
  /** 재정규화 후 실제 사용된 가중치 (기록 요구 — DECISIONS 6.1절 3항) */
  usedWeights: Partial<Record<ScoreComponentId, number>>;
  policyVersion: string;
};

export type TripDuration = {
  /** 출발·복귀가 걸치는 서로 다른 KST 달력일 수 */
  days: number;
  /** 일수 − 1 */
  nights: number;
  /** "당일치기" / "1박 2일" / "2박 3일" … */
  label: string;
  /** 4시간 × 일수 */
  minimumLocalStayHours: number;
};

export type TiebreakRecord = {
  winnerId: string;
  loserId: string;
  stepId: TiebreakMetricId;
};

export type RecommendationInput = {
  conditions: ValidTripConditions;
  destinations: DestinationCandidate[];
  travelTime: TravelTimeAdapter;
};

export type RecommendationOutcome = {
  policyVersion: string;
  duration: TripDuration;
  minimumLocalStayHours: number;
  totalAvailableHours: number;
  /** 입력 순서 그대로의 전체 평가 결과 */
  candidates: CandidateEvaluation[];
  /** 통과 후보를 점수·동점 규칙대로 정렬한 목록 */
  passed: CandidateEvaluation[];
  rejected: CandidateEvaluation[];
  /** 동점이 몇 단계에서 갈렸는지 (기록 요구 — DECISIONS 6.1절 3항) */
  tiebreaks: TiebreakRecord[];
  travelTimeSource: { source: string; basisDate: string; provisional: boolean };
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * HOUR_MS;

/**
 * KST 달력일 인덱스. 여행 유형 판별이 실행 환경의 로컬 시간대에 의존하지 않게 한다
 * (DECISIONS.md 7.4절 — 판별 기준은 KST 달력일이다).
 */
function kstDayIndex(date: Date): number {
  return Math.floor((date.getTime() + KST_OFFSET_MS) / DAY_MS);
}

/**
 * 여행 유형과 최소 현지 체류시간 (DECISIONS.md 7.4 · 6.3절).
 * 일수 = 출발·복귀가 걸치는 서로 다른 KST 달력일 수, 박수 = 일수 − 1,
 * 최소 현지 체류시간 = 4시간 × 일수.
 *
 * 무박(밤새 이동)은 별도 유형으로 다루지 않는다 — 달력일이 바뀌면 1박 2일로 분류되고
 * 8시간 기준을 받는다. 이 사실을 감추지 않는다(7.4절, 나중 고도화 대상).
 */
export function resolveTripDuration(
  conditions: Pick<ValidTripConditions, "startAt" | "returnBy">,
  policy: RecommendationPolicy,
): TripDuration {
  const days = Math.max(
    1,
    kstDayIndex(conditions.returnBy) - kstDayIndex(conditions.startAt) + 1,
  );
  const nights = days - 1;
  return {
    days,
    nights,
    label: nights === 0 ? "당일치기" : `${nights}박 ${days}일`,
    minimumLocalStayHours: policy.minimumLocalStay.hoursPerDay * days,
  };
}

/** 동점 단계 id로 비교값을 찾는다. 단계의 순서와 방향은 정책 데이터가 정한다. */
const tiebreakMetrics: Record<
  TiebreakMetricId,
  (candidate: CandidateEvaluation) => number | string
> = {
  localAvailableHours: (candidate) =>
    candidate.localAvailableHours ?? Number.NEGATIVE_INFINITY,
  roundTripHours: (candidate) =>
    candidate.roundTripHours ?? Number.POSITIVE_INFINITY,
  destinationId: (candidate) => candidate.id,
};

/** 부동소수 오차로 동점이 갈리지 않게 비교 전 자릿수를 맞춘다. */
const round = (value: number) => Math.round(value * 1e9) / 1e9;

function compareByTiebreaks(
  a: CandidateEvaluation,
  b: CandidateEvaluation,
  policy: RecommendationPolicy,
): { order: number; stepId: TiebreakMetricId | null } {
  for (const step of policy.tiebreakSteps) {
    const left = tiebreakMetrics[step.id](a);
    const right = tiebreakMetrics[step.id](b);
    if (left === right) continue;
    let order: number;
    if (typeof left === "string" || typeof right === "string") {
      order = String(left) < String(right) ? -1 : 1;
    } else {
      order = left < right ? -1 : 1;
    }
    return {
      order: step.direction === "desc" ? -order : order,
      stepId: step.id,
    };
  }
  return { order: 0, stepId: null };
}

function evaluateOne(
  destination: DestinationCandidate,
  input: RecommendationInput,
  duration: TripDuration,
  policy: RecommendationPolicy,
): CandidateEvaluation {
  const { conditions } = input;
  const totalAvailableHours = conditions.availableHours;
  const travel = input.travelTime.lookup(
    conditions.originId,
    destination.id,
    conditions.transport,
  );
  const interestMatches = conditions.interests.filter((interest) =>
    destination.tags.includes(interest),
  );

  const base = {
    id: destination.id,
    name: destination.name,
    region: destination.region,
    tags: destination.tags,
    minimumLocalStayHours: duration.minimumLocalStayHours,
    interestMatches,
    policyVersion: policy.version,
  };

  if (!travel) {
    // 이동시간을 모르면 판정도 점수도 할 수 없다. 임의값으로 채우지 않는다(F-01 오류/결측과 같은 방향).
    return {
      ...base,
      travel: null,
      oneWayHours: null,
      roundTripHours: null,
      localAvailableHours: null,
      passed: false,
      rejectionReason: "이동시간 데이터가 없어 판정할 수 없어요.",
      score: 0,
      components: [],
      usedWeights: {},
    };
  }

  const roundTripHours = travel.oneWayHours * 2;
  const localAvailableHours = totalAvailableHours - roundTripHours;
  const passed =
    round(localAvailableHours) >= round(duration.minimumLocalStayHours);

  // 구성요소의 원값. 계산할 수 없으면 null이며 0으로 대체하지 않는다.
  const rawValues: Record<
    ScoreComponentId,
    { raw: number | null; reason?: string }
  > = {
    timeFit:
      totalAvailableHours > 0
        ? { raw: Math.max(0, localAvailableHours) / totalAvailableHours }
        : { raw: null, reason: "쓸 수 있는 시간이 0이라 계산할 수 없어요." },
    interestFit:
      conditions.interests.length > 0
        ? { raw: interestMatches.length / conditions.interests.length }
        : {
            raw: null,
            reason: "고른 관심사가 없어 관심사 항을 빼고 계산했어요.",
          },
    festivalFit: {
      raw: null,
      reason: "축제 추천(F-06)이 아직 구현되지 않았어요.",
    },
  };

  /*
   * 재정규화 (DECISIONS 6.1절): 계산할 수 없는 구성요소는 항을 제외하고, 남은 조합에 대해
   * 정책이 나열한 가중치 집합을 쓴다. 비율로 유도하지 않는 이유는 lib/trip-policy.ts의
   * WeightSet 주석에 있다 — 유도값(0.588/0.412)과 확정값(0.60/0.40)이 다르다.
   */
  const usableIds = policy.components
    .filter(
      (component) => component.enabled && rawValues[component.id].raw !== null,
    )
    .map((component) => component.id);
  const weightSet = policy.weightSets.find(
    (candidate) =>
      candidate.components.length === usableIds.length &&
      candidate.components.every((id) => usableIds.includes(id)),
  );
  if (!weightSet) {
    throw new Error(
      `사용 가능한 구성요소 조합(${usableIds.join(", ") || "없음"})에 대응하는 가중치 집합이 정책에 없습니다. 임의로 재정규화하지 않습니다(docs/product/DECISIONS.md 6.1절).`,
    );
  }

  const components: ScoreComponentResult[] = policy.components.map(
    (component) => {
      const value = rawValues[component.id];
      const available = usableIds.includes(component.id);
      const weight = available ? (weightSet.weights[component.id] ?? 0) : 0;
      return {
        id: component.id,
        label: component.label,
        available,
        unavailableReason: available
          ? undefined
          : (component.disabledReason ?? value.reason),
        raw: available ? value.raw : null,
        weight,
        weighted: available ? (value.raw as number) * weight : 0,
      };
    },
  );

  const usedWeights: Partial<Record<ScoreComponentId, number>> = {};
  for (const component of components) {
    if (component.available) usedWeights[component.id] = component.weight;
  }

  return {
    ...base,
    travel,
    oneWayHours: travel.oneWayHours,
    roundTripHours,
    localAvailableHours,
    passed,
    rejectionReason: passed
      ? undefined
      : `왕복 이동 ${roundTripHours.toFixed(1)}시간을 빼면 ${Math.max(0, localAvailableHours).toFixed(1)}시간만 남아, 최소로 머물러야 하는 ${duration.minimumLocalStayHours}시간에 모자라요.`,
    score: components.reduce((sum, component) => sum + component.weighted, 0),
    components: components.filter(
      (component) => component.available || component.id !== "festivalFit",
    ),
    usedWeights,
  };
}

/**
 * 통과·탈락 판정과 점수 정렬. 제약 충족을 점수보다 먼저 판정한다(6장 품질 요구).
 * 정책은 반드시 주입한다 — 주입되지 않으면 임의값으로 대체하지 않고 실패한다(DECISIONS 6.1절 1항).
 */
export function evaluateCandidates(
  input: RecommendationInput,
  policy: RecommendationPolicy,
): RecommendationOutcome {
  if (!policy) {
    throw new Error(
      "점수 정책이 주입되지 않았습니다. 임의 기본값으로 대체하지 않습니다(docs/product/DECISIONS.md 6.1절).",
    );
  }

  const duration = resolveTripDuration(input.conditions, policy);
  const candidates = input.destinations.map((destination) =>
    evaluateOne(destination, input, duration, policy),
  );

  const tiebreaks: TiebreakRecord[] = [];
  const passed = [...candidates.filter((candidate) => candidate.passed)].sort(
    (a, b) => {
      const byScore = round(b.score) - round(a.score);
      if (byScore !== 0) return byScore;
      return compareByTiebreaks(a, b, policy).order;
    },
  );

  // 정렬이 끝난 뒤, 점수가 같았던 인접 쌍이 몇 단계에서 갈렸는지 남긴다.
  for (let index = 1; index < passed.length; index += 1) {
    const winner = passed[index - 1];
    const loser = passed[index];
    if (round(winner.score) !== round(loser.score)) continue;
    const { stepId } = compareByTiebreaks(winner, loser, policy);
    if (stepId)
      tiebreaks.push({ winnerId: winner.id, loserId: loser.id, stepId });
  }

  return {
    policyVersion: policy.version,
    duration,
    minimumLocalStayHours: duration.minimumLocalStayHours,
    totalAvailableHours: input.conditions.availableHours,
    candidates,
    passed,
    rejected: candidates.filter((candidate) => !candidate.passed),
    tiebreaks,
    travelTimeSource: {
      source: input.travelTime.source,
      basisDate: input.travelTime.basisDate,
      provisional: input.travelTime.provisional,
    },
  };
}

/*
 * 지원 목적지 목록. lib/support-conditions.ts의 `provisionalSupportSet`과 같은 이유로 임시값이다.
 * docs/product/DECISIONS.md 1절의 `초기 지역`이 `제안` 상태이고, 5.4절이 "지원 목적지 목록"을
 * F-02의 남은 데이터 차단으로 적었다. 값은 PoC 목업(lib/mock-data.ts)에서 이어받았고
 * **정식 정책으로 승격하지 않는다.**
 */
export const provisionalDestinationSource = {
  provisional: true,
  source: "PoC 목업(lib/mock-data.ts) — 지원 지역 결정 전 임시 목록",
  basisDate: "2026-08-30",
};

export function destinationsFrom(
  data: Pick<DomainDataAdapter, "listDestinations">,
): DestinationCandidate[] {
  return data.listDestinations().map((destination) => ({
    id: destination.id,
    name: destination.name,
    region: destination.region,
    tags: destination.tags.map((tag) => tag.tag),
  }));
}
