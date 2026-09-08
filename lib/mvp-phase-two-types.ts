import type { MvpCategoryId } from "@/lib/mvp-region-data";

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
  originId: "seoul" | "busan";
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
export type Visit = {
  attraction: Attraction;
  durationMinutes: VisitDuration;
  fixed: boolean;
};
export type TimeBlock = {
  id: string;
  day: 1 | 2;
  startAt: string;
  endAt: string;
  kind: "travel" | "attraction" | "meal" | "free" | "rest";
  title: string;
  durationMinutes: number;
  contentId?: string;
  attraction?: Attraction;
  restaurant?: Restaurant;
  fixed?: boolean;
  mealScope?: "local" | "transit";
  mealType?: "lunch" | "dinner";
  direction?: "outbound" | "return";
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
  reasons: string[];
};
export type PlanSnapshot = {
  schemaVersion: 2;
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
  | { type: "replace-attraction"; blockId: string; contentId: string }
  | { type: "duration"; blockId: string; durationMinutes: VisitDuration }
  | { type: "delete-attraction"; blockId: string };
export type EditResult =
  | { ok: true; plan: PlanSnapshot }
  | { ok: false; plan: PlanSnapshot; reason: string };
export type ScheduleResult =
  | { ok: true; blocks: TimeBlock[]; metrics: PlanMetrics }
  | { ok: false; reason: string };
