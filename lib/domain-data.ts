import type { TransportMode } from "./support-conditions";

/** 5장 공통 데이터 상태. 값의 확실성을 숨기지 않고 결과까지 전달한다. */
export type DomainDataStatus =
  "normal" | "estimate" | "fallback" | "missing" | "stale";

export type DataProvenance = {
  source: string;
  /** 수집 또는 갱신 시각. PoC는 기준일을 보존한다. */
  collectedAt: string;
  dataStatus: DomainDataStatus;
  /** 수집 데이터셋 버전. 값이 없는 기존/결측 데이터와 호환을 위해 선택값이다. */
  dataVersion?: string;
};

export type Coordinates = { latitude: number; longitude: number };

export type DestinationTag = {
  destinationId: string;
  tag: string;
  evidence: string;
  provenance: DataProvenance;
};

export type DestinationRecord = {
  id: string;
  name: string;
  region: string;
  supportStatus: "supported" | "unsupported" | "unknown";
  coordinates: Coordinates | null;
  summary: string | null;
  tags: DestinationTag[];
  /** 빈 태그 목록이 실제 무관함인지 아직 미수집인지 구분하는 목록 수준 출처다. */
  tagProvenance: DataProvenance;
  provenance: DataProvenance;
};

export type OriginRecord = {
  id: string;
  name: string;
  region: string;
  supportStatus: "supported" | "unsupported" | "unknown";
  coordinates: Coordinates | null;
  provenance: DataProvenance;
};

export type OperatingInterval = { opensAt: string; closesAt: string };
export type OperationDateException = {
  date: string;
  intervals: OperatingInterval[];
  closed: boolean | null;
};

export type OperationInfo = {
  placeId: string;
  /** 평상시 운영 구간. 알 수 없으면 빈 배열이 아니라 provenance가 missing이어야 한다. */
  regularIntervals: OperatingInterval[];
  /** 반복 휴무 요일. 빈 배열은 매주 휴무 없음, null은 알 수 없음이다. */
  closedWeekdays: number[] | null;
  /** 날짜별 예외 운영/휴무. */
  dateExceptions: OperationDateException[];
  provenance: DataProvenance;
};

export type StayDuration = {
  placeId: string | null;
  category: string | null;
  recommendedHours: number | null;
  sourceLevel: "observed" | "official" | "category-default" | null;
  provenance: DataProvenance;
};

export type PlaceRecord = {
  id: string;
  destinationId: string;
  name: string;
  category: string;
  coordinates: Coordinates | null;
  description: string | null;
  operation: OperationInfo;
  stayDuration: StayDuration;
  provenance: DataProvenance;
};

export type OriginDestinationTravelTime = {
  originId: string;
  destinationId: string;
  transport: TransportMode;
  oneWayHours: number | null;
  distanceKm: number | null;
  method: string;
  basisDate: string;
  provenance: DataProvenance;
};

export type PlaceTravelTime = {
  fromPlaceId: string;
  toPlaceId: string;
  transport: TransportMode;
  estimatedHours: number | null;
  method: string;
  basisDate: string;
  provenance: DataProvenance;
};

export type FestivalRecord = {
  id: string;
  destinationId: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  tags: string[];
  operation: OperationInfo | null;
  provenance: DataProvenance;
};

export type RepresentativeFood = {
  id: string;
  destinationId: string;
  name: string;
  aliases: string[];
  evidence: string;
  sourceType: string | null;
  confidence: string | null;
  verifiedAt: string | null;
  provenance: DataProvenance;
};

export type RestaurantRecord = {
  id: string;
  destinationId: string;
  name: string;
  coordinates: Coordinates | null;
  representativeFoodIds: string[];
  foodLinkEvidence: string | null;
  operation: OperationInfo;
  mealDuration: StayDuration;
  provenance: DataProvenance;
};

/** E2의 실제 수집 계층이 구현할 조회 경계. */
export type DomainDataAdapter = {
  listOrigins(): OriginRecord[];
  listDestinations(): DestinationRecord[];
  listPlaces(destinationId: string): PlaceRecord[];
  lookupOriginTravelTime(
    originId: string,
    destinationId: string,
    transport: TransportMode,
  ): OriginDestinationTravelTime | null;
  lookupPlaceTravelTime(
    fromPlaceId: string,
    toPlaceId: string,
    transport: TransportMode,
  ): PlaceTravelTime | null;
  listFestivals(destinationId: string): FestivalRecord[];
  listRepresentativeFoods(destinationId: string): RepresentativeFood[];
  listRestaurants(destinationId: string): RestaurantRecord[];
};
