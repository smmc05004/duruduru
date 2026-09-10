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
/**
 * 목적 근거 점수 (D4). 실제 초안에 배치된 관광지 중 `data/tourism-evidence.json`에서
 * 확정 연결(matched, `nonItineraryCategory` 제외)된 중심 관광지에 한해
 * `1/log2(1+hubRank)`를 부여하고, 선택 관심사별로 중복 시설 제거 후 상위 3개 값의
 * 합 ÷ 3, 요청 관심사 전체의 평균을 점수로 쓴다. 전국 인기·평점·영업 보장이 아니다.
 */
export type PurposeEvidence = {
  /** `data/tourism-evidence.json`의 `dataVersion`. 같은 버전이면 결정적 재현. */
  version: string;
  /** 중심 관광지 자료 기준월(`baseYm`). */
  baseYm: string;
  /**
   * - `scored`: 중심 자료를 조회해 점수를 계산했다(근거가 없으면 0).
   * - `no-central-data`: 후보의 모든 구성 지역에 중심 관광지 자료가 없다(점수 0, 지역 매력 0 아님).
   * - `unavailable`: 저장본에 근거 필드가 없어 다시 계산하지 않았다(0과 구분).
   */
  status: "scored" | "no-central-data" | "unavailable";
  /** 0~1. `unavailable`이면 null. */
  score: number | null;
  /** 선택 관심사별 (상위 3개 값의 합 ÷ 3). */
  perInterest: Partial<Record<MvpCategoryId, number>>;
  /** 점수에 실제로 기여한, 초안에 배치된 관광지 콘텐츠 ID. */
  contributingContentIds: string[];
  /** 중심 관광지 자료가 없는(`empty`) 구성 지역 ID. */
  centralEmptyRegionIds: string[];
  /** 초안 배치 관광지 중 확정 연결된(비-비일정) 중심 관광지 수. */
  matchedHubCount: number;
};
export type CandidateRecommendation = {
  role: RecommendationRole;
  algorithmVersion: "e1-v1" | "e1-v2";
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
  itineraryAlgorithmVersion?: "e2-v1" | "e2-v2";
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
