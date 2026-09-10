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
export type CandidateRecommendation = {
  role: RecommendationRole;
  algorithmVersion: "e1-v1";
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
  itineraryAlgorithmVersion?: "e2-v1";
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
