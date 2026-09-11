import type { MvpCategoryId } from "@/lib/mvp-region-data";
import type { LocalTravelLeg } from "@/lib/local-travel-time";

/** Client-safe contracts: no national JSON or server runtime imports. */
export const INTERESTS: Array<{ id: MvpCategoryId; label: string }> = [
  { id: "nature", label: "자연" },
  { id: "history", label: "역사" },
  { id: "rest", label: "휴양" },
  { id: "culture", label: "문화" },
  { id: "leisure", label: "레저" },
];
export const ORIGINS = [
  { id: "seoul", label: "서울특별시", zoneId: "ktdb-zone-2" },
  { id: "busan", label: "부산광역시", zoneId: "ktdb-zone-26" },
] as const;
export type SearchInput = {
  originId: string;
  startAt: string;
  returnBy: string;
  transport: "car";
  interests: MvpCategoryId[];
};
export type Coordinates = { latitude: number; longitude: number };
export type Attraction = {
  contentId: string;
  contentTypeId: string;
  regionId: string;
  title: string;
  address: string;
  imageUrl: string;
  coordinates: Coordinates | null;
  categories: MvpCategoryId[];
  cat1: string;
  cat2: string;
  cat3: string;
  /** 새 공식 분류(`lclsSystmCode2`). 구 수집본·구 저장본에는 없어 선택 필드다. */
  lclsSystm1?: string;
  lclsSystm2?: string;
  lclsSystm3?: string;
};
export type Restaurant = {
  contentId: string;
  regionId: string;
  name: string;
  address: string;
  phone: string;
  imageUrl: string;
  coordinates: Coordinates | null;
  certified: boolean;
  foodCultureMatch: boolean;
  fetchedAt: string;
};
export type VisitDuration = 30 | 60 | 90 | 120;
export type PersonalActivityType = "appointment" | "place";
export type PersonalActivity = {
  /** Client-created stable ID. It never imitates a TourAPI content ID. */
  id: string;
  name: string;
  category: PersonalActivityType;
  day: 1 | 2;
  durationMinutes: VisitDuration;
  address: string;
};
export type AccommodationNote = {
  name: string;
  address: string;
  note: string;
};
export type Visit = {
  attraction: Attraction;
  durationMinutes: VisitDuration;
  fixed: boolean;
  facilityGroupId?: string;
  sessionId?: string;
  selectionNotice?: string;
};
export type TimeBlock = {
  id: string;
  day: 1 | 2;
  startAt: string;
  endAt: string;
  kind: "travel" | "attraction" | "personal" | "meal" | "free" | "rest";
  title: string;
  durationMinutes: number;
  contentId?: string;
  attraction?: Attraction;
  restaurant?: Restaurant;
  fixed?: boolean;
  /** E4 time lock. Unlike `fixed`, this locks both KST date and start time. */
  fixedStartAt?: string;
  personal?: PersonalActivity;
  mealScope?: "local" | "transit";
  mealType?: "lunch" | "dinner";
  direction?: "outbound" | "return";
  localTravel?: LocalTravelLeg;
  /** E2's conservative facility signal; it is not an official facility ID. */
  facilityGroupId?: string;
  /** Date + morning/afternoon selection session, not a route segment. */
  sessionId?: string;
  reason: string;
};
export type PlanMetrics = {
  arrivalAt: string;
  returnDepartureAt: string;
  localMinutes: number;
  freeMinutes: number;
  attractionCount: number;
  localMealCount: number;
  fulfilledInterests: MvpCategoryId[];
  categoryDiversity: number;
  averageDistanceKm: number | null;
};
export type DataMetadata = {
  profileGeneratedAt: string;
  travelTimeGeneratedAt: string;
  networkYear: number;
  travelTimeSource: string;
  representativePoint: string;
  searchedAt: string;
};
export type RecommendationRole = "easy" | "interest" | "relaxed";
/** 요청 관심사 하나의 목적 적합성 세부 지표 (T7 / D4). */
export type PurposeFitInterest = {
  /** 초안에 배치된, 이 관심사에 해당하는 서로 다른 시설 수(E2 시설 중복 제거). */
  facilities: number;
  /**
   * 그 시설들의 서로 다른 세부 유형 수. 시설 그룹당 대표 유형 하나만 기여한 뒤
   * 대표들을 다시 중복 제거해 센다(D1 새 분류 우선, 분류 결측 그룹은 대표 없이
   * 기여 0). 같은 시설의 세부 항목을 늘리는 것만으로 오르지 않는다.
   */
  types: number;
  /** `min(facilities, facilityCap) + min(types, typeCap)`. 포화 상한 적용. */
  fit: number;
};

/**
 * 목적 적합성 근거 (T7 / D4).
 *
 * **정렬에 쓰는 값은 `fitBand`(고정 구간)와 `matchedFacilityCount`(보조 근거)뿐이다.**
 * 구간은 실제 초안에 배치된 관광지의 관심사별 서로 다른 시설 수·세부 유형 수에
 * 포화 상한을 적용한 지표로 만든다. `score`는 이전(e1-v2) 의미의 원점수를 참고용으로
 * 보존하며 새 정렬에서는 사용하지 않는다. 전국 인기·평점·영업 보장이 아니다.
 */
export type PurposeEvidence = {
  /** `data/tourism-evidence.json`의 `dataVersion`. 같은 버전이면 결정적 재현. */
  version: string;
  /** 중심 관광지 자료 기준월(`baseYm`). */
  baseYm: string;
  /**
   * - `scored`: 중심 자료를 조회해 지표를 계산했다.
   * - `no-central-data`: 후보의 모든 구성 지역에 중심 관광지 자료가 없다(보조 근거 0, 지역 매력 0 아님).
   * - `unavailable`: 저장본에 근거 필드가 없어 다시 계산하지 않았다(0과 구분).
   */
  status: "scored" | "no-central-data" | "unavailable";
  /**
   * 목적 적합성 구간(0·1·2). `interest` 역할 정렬의 2번째 키. `unavailable`이면 null.
   * 구간 경계와 상한은 `PURPOSE_FIT_METRIC`에 고정된 제품 휴리스틱이다.
   * 이전(e1-v2) 저장본에는 없어 선택 필드다(없으면 정렬에서 0으로 취급).
   */
  fitBand?: number | null;
  /** 요청 관심사 평균 `fit`. 구간 경계 적용 전 값(투명성용, 정렬에 직접 쓰지 않음). */
  fitAverage?: number | null;
  /** 요청 관심사별 세부 지표. */
  fitByInterest?: Partial<Record<MvpCategoryId, PurposeFitInterest>>;
  /**
   * 보조 근거: 초안에 배치된 관심사 시설 중 확정 연결(matched·비-비일정)된 서로 다른
   * 시설 수에 상한(`matchedFacilityCap`)을 적용한 값. 하위 구 개수로 나누지 않으며
   * 행정구역 분할·구별 순위 숫자에 불변이다. 같은 구간·왕복시간 동점에서만 쓴다.
   * 이전(e1-v2) 저장본에는 없어 선택 필드다.
   */
  matchedFacilityCount?: number;
  /** 이전(e1-v2) 원점수(`1/log2(1+hubRank)` 기반 평균). 참고 보존, 정렬 미사용. `unavailable`이면 null. */
  score: number | null;
  /** 이전 원점수의 관심사별 값(참고 보존). */
  perInterest: Partial<Record<MvpCategoryId, number>>;
  /** 원점수에 기여한, 초안에 배치된 관광지 콘텐츠 ID. */
  contributingContentIds: string[];
  /** 중심 관광지 자료가 없는(`empty`) 구성 지역 ID. */
  centralEmptyRegionIds: string[];
  /** 초안 배치 관광지 중 확정 연결된(비-비일정) 중심 관광지 수(상한 없음, 참고). */
  matchedHubCount: number;
};
export type CandidateRecommendation = {
  role: RecommendationRole;
  algorithmVersion: "e1-v1" | "e1-v2" | "e1-v3";
  roundTripMinutes: number;
  fulfilledInterestCount: number;
  attractionCount: number;
  categoryDiversity: number;
  localFreeMinutes: number;
  distancePairCount: number;
  validDistancePairCount: number;
  averageDistanceKm: number | null;
  proximityComparable: boolean;
  requestedInterests: MvpCategoryId[];
  missingInterests: MvpCategoryId[];
  /** D4 목적 근거 점수. E1(v1) 저장본에는 없어 선택 필드다. */
  purpose?: PurposeEvidence;
};
export type Candidate = {
  groupId: string;
  memberRegionIds: string[];
  representativeZoneId: string;
  displayName: string;
  name: string;
  province: string;
  oneWayMinutes: number;
  attractions: Attraction[];
  preview: { blocks: TimeBlock[]; metrics: PlanMetrics };
  metadata: DataMetadata;
  /** Optional so v2 saved plans retain their original, pre-E2 evidence. */
  itineraryAlgorithmVersion?: "e2-v1" | "e2-v2" | "e2-v3";
  /** E1 metadata is absent in pre-E1 v2 saved plans. */
  recommendation?: CandidateRecommendation;
  reasons: string[];
};
export type RecommendedCandidate = Candidate & {
  recommendation: CandidateRecommendation;
};
export type PlanSnapshot = {
  schemaVersion: 3;
  id: string;
  searchId: string;
  createdAt: string;
  updatedAt: string;
  savedAt?: string;
  edited: boolean;
  input: SearchInput;
  destination: Candidate;
  blocks: TimeBlock[];
  metrics: PlanMetrics;
  accommodation?: AccommodationNote;
  itineraryRuleVersion: "e4-v1" | "e4-v2";
  localTravelVersion?: "straight-line-v1";
};
export type SearchResponse =
  | {
      kind: "success";
      searchId: string;
      candidates: Candidate[];
      profileGeneratedAt: string;
    }
  | { kind: "input-error" | "no-results" | "data-error"; message: string };
export type EditCommand =
  | { type: "toggle-fixed"; blockId: string }
  | {
      type: "replace-attraction";
      blockId: string;
      contentId: string;
      allowFacilityRepeat?: boolean;
    }
  | { type: "duration"; blockId: string; durationMinutes: VisitDuration }
  | { type: "delete-attraction"; blockId: string }
  | { type: "move-activity"; blockId: string; day: 1 | 2; position: number }
  | { type: "reorder-activity"; blockId: string; direction: "up" | "down" }
  | {
      type: "add-attraction";
      contentId: string;
      allowFacilityRepeat?: boolean;
      day: 1 | 2;
      durationMinutes: VisitDuration;
    }
  | { type: "add-personal"; personal: PersonalActivity }
  | { type: "delete-personal"; blockId: string }
  | { type: "set-fixed-start"; blockId: string; fixedStartAt: string | null };
export type EditResult =
  | { ok: true; plan: PlanSnapshot }
  | { ok: false; plan: PlanSnapshot; reason: string };
export type ScheduleResult =
  | { ok: true; blocks: TimeBlock[]; metrics: PlanMetrics }
  | { ok: false; reason: string };
