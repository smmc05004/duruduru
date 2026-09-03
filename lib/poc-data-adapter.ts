import type {
  DataProvenance,
  DestinationRecord,
  DomainDataAdapter,
  FestivalRecord,
  OriginRecord,
  OperationInfo,
  OriginDestinationTravelTime,
  PlaceRecord,
  RestaurantRecord,
  RepresentativeFood,
} from "./domain-data";
import { destinations as rawDestinations } from "./mock-data";
import type { ScheduleDestination } from "./planner";
import { supportConditionsV1 } from "./support-conditions";

export type { DomainDataStatus } from "./domain-data";

const POC_PROVENANCE: DataProvenance = {
  source: "PoC 목업(lib/mock-data.ts) — 실제 공공데이터 수집 전 임시값",
  collectedAt: "2026-08-30",
  dataStatus: "estimate",
};

const operationOf = (
  placeId: string,
  open: number,
  close: number,
  closedDays?: number[],
): OperationInfo => ({
  placeId,
  regularIntervals: [
    {
      opensAt: `${String(Math.floor(open)).padStart(2, "0")}:${open % 1 ? "30" : "00"}`,
      closesAt: `${String(Math.floor(close)).padStart(2, "0")}:${close % 1 ? "30" : "00"}`,
    },
  ],
  closedWeekdays: closedDays ? [...closedDays] : [],
  dateExceptions: [],
  provenance: POC_PROVENANCE,
});

function destinationRecord(
  raw: (typeof rawDestinations)[number],
): DestinationRecord {
  return {
    id: raw.id,
    name: raw.name,
    region: raw.region,
    supportStatus: "unknown",
    coordinates: null,
    summary: raw.summary,
    tags: raw.tags.map((tag) => ({
      destinationId: raw.id,
      tag,
      evidence: "PoC 목업 태그 — 정식 태그 근거 미확보",
      provenance: POC_PROVENANCE,
    })),
    tagProvenance: POC_PROVENANCE,
    provenance: POC_PROVENANCE,
  };
}

function placeRecords(raw: (typeof rawDestinations)[number]): PlaceRecord[] {
  return raw.attractions.map((attraction, index) => {
    const id = `${raw.id}-place-${index + 1}`;
    return {
      id,
      destinationId: raw.id,
      name: attraction.name,
      category: attraction.category,
      coordinates: null,
      description: attraction.description,
      operation: operationOf(
        id,
        attraction.open,
        attraction.close,
        attraction.closedDays,
      ),
      stayDuration: {
        placeId: id,
        category: attraction.category,
        recommendedHours: attraction.stayHours,
        sourceLevel: null,
        provenance: POC_PROVENANCE,
      },
      provenance: POC_PROVENANCE,
    };
  });
}

function festivalRecords(
  raw: (typeof rawDestinations)[number],
): FestivalRecord[] {
  if (!raw.festival) return [];
  return [
    {
      id: `${raw.id}-festival-1`,
      destinationId: raw.id,
      name: raw.festival.name,
      startsOn: raw.festival.start,
      endsOn: raw.festival.end,
      tags: [],
      operation: null,
      provenance: POC_PROVENANCE,
    },
  ];
}

export const pocDataAdapter: DomainDataAdapter = {
  listOrigins: (): OriginRecord[] =>
    supportConditionsV1.origins.map((origin) => ({
      id: origin.id,
      name: origin.name,
      region: origin.region,
      supportStatus: "unknown",
      coordinates: null,
      provenance: POC_PROVENANCE,
    })),
  listDestinations: () => rawDestinations.map(destinationRecord),
  listPlaces(destinationId) {
    const raw = rawDestinations.find((item) => item.id === destinationId);
    return raw ? placeRecords(raw) : [];
  },
  lookupOriginTravelTime(
    originId,
    destinationId,
    transport,
  ): OriginDestinationTravelTime | null {
    const raw = rawDestinations.find((item) => item.id === destinationId);
    if (!raw) return null;
    return {
      originId,
      destinationId,
      transport,
      oneWayHours: transport === "car" ? raw.driveHours : raw.publicHours,
      distanceKm: null,
      method: "poc-mock",
      basisDate: POC_PROVENANCE.collectedAt,
      provenance: POC_PROVENANCE,
    };
  },
  lookupPlaceTravelTime: () => null,
  listFestivals(destinationId) {
    const raw = rawDestinations.find((item) => item.id === destinationId);
    return raw ? festivalRecords(raw) : [];
  },
  listRepresentativeFoods: (): RepresentativeFood[] => [],
  listRestaurants: (): RestaurantRecord[] => [],
};

/** 종료된 PoC 일정 표시를 위한 계약 기반 투영. F-04 정식 엔진이 아니다. */
export function scheduleDestinationFromPoc(
  destinationId: string,
): ScheduleDestination | null {
  const destination = pocDataAdapter
    .listDestinations()
    .find((item) => item.id === destinationId);
  if (!destination) return null;
  const places = pocDataAdapter.listPlaces(destinationId);
  const carTravel = pocDataAdapter.lookupOriginTravelTime(
    "__poc_schedule__",
    destinationId,
    "car",
  );
  const publicTravel = pocDataAdapter.lookupOriginTravelTime(
    "__poc_schedule__",
    destinationId,
    "public",
  );
  if (carTravel?.oneWayHours === null || publicTravel?.oneWayHours === null)
    return null;
  const hoursFrom = (clock: string) => {
    const [hours, minutes] = clock.split(":").map(Number);
    return hours + minutes / 60;
  };
  return {
    id: destination.id,
    name: destination.name,
    driveHours: carTravel?.oneWayHours ?? Number.NaN,
    publicHours: publicTravel?.oneWayHours ?? Number.NaN,
    tags: destination.tags.map((tag) => tag.tag),
    attractions: places.flatMap((place) => {
      const interval = place.operation.regularIntervals[0];
      const stayHours = place.stayDuration.recommendedHours;
      if (!interval || stayHours === null || place.description === null)
        return [];
      return [
        {
          id: place.id,
          name: place.name,
          category: place.category,
          open: hoursFrom(interval.opensAt),
          close: hoursFrom(interval.closesAt),
          stayHours,
          closedDays: place.operation.closedWeekdays ?? undefined,
          description: place.description,
        },
      ];
    }),
    festival: (() => {
      const festival = pocDataAdapter.listFestivals(destinationId)[0];
      if (!festival || !festival.startsOn || !festival.endsOn) return undefined;
      return {
        name: festival.name,
        start: festival.startsOn,
        end: festival.endsOn,
      };
    })(),
  };
}
