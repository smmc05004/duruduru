import type { Coordinates, DataProvenance, OperationInfo } from "./domain-data";
import type { ValidTripConditions } from "./trip-conditions";

export type ReferenceInterestEvidence = {
  tag: string;
  evidence: string;
  provenance: DataProvenance;
};

export type ReferenceItineraryPlace = {
  id: string;
  destinationId: string;
  name: string;
  category: string;
  coordinates: Coordinates | null;
  interestEvidence: ReferenceInterestEvidence[];
  interestEvidenceProvenance: DataProvenance;
  visit: {
    estimatedHours: number | null;
    provenance: DataProvenance;
  };
  operation: OperationInfo | null;
  provenance: DataProvenance;
};

export type ReferenceTravel = {
  kind: "road-route";
  distanceKm: number;
  estimatedHours: number;
  method: string;
  source: string;
  basisDate: string;
  dataVersion: string;
  policyVersion: string;
  reproductionId: string;
  dataStatus: "estimate" | "normal";
};

/** E4와 같은 사전 수집 출발지→목적지 일반 이동시간 계약. 런타임 경로 조회는 하지 않는다. */
export type ReferenceOriginTravel = Omit<ReferenceTravel, "reproductionId"> & {
  originId: string;
  destinationId: string;
  reproductionId: string;
};

export type ReferenceItineraryDataSource = {
  listPlaces(destinationId: string): ReferenceItineraryPlace[];
  lookupTravel(fromPlaceId: string, toPlaceId: string): ReferenceTravel | null;
};

export type ReferenceItineraryInput = {
  destinationId: string;
  interests: string[];
  /** F-01에서 검증돼 선택 목적지까지 이어진 조건 요약. */
  conditions: Pick<
    ValidTripConditions,
    "supportVersion" | "timeZone" | "tripType" | "startAt" | "returnBy"
  >;
  /** E4와 같은 사전 수집 일반 편도시간. 결측이면 넓은 시간대를 계산하지 않는다. */
  originTravel: ReferenceOriginTravel | null;
};

export type ReferenceItineraryPolicy = {
  version: "2026-09-03";
  ordering: "matched-interest-evidence-desc:id-asc";
};

export const referenceItineraryPolicy: ReferenceItineraryPolicy = {
  version: "2026-09-03",
  ordering: "matched-interest-evidence-desc:id-asc",
};

type ReferenceItineraryPlaceResult = {
  id: string;
  name: string;
  category: string;
  matchedInterests: string[];
  interestEvidence: ReferenceInterestEvidence[];
  visit:
    | { kind: "estimate"; estimatedHours: number; provenance: DataProvenance }
    | {
        kind: "missing";
        reason: "예상 시간 정보 없음";
        provenance: DataProvenance;
      };
  /** E6이 계산하고 E7은 표시만 한다. 필요한 근거가 없으면 null이다. */
  broadTimeWindow: { startsAt: Date; endsAt: Date } | null;
  interestEvidenceProvenance: DataProvenance;
  operation:
    | { kind: "available"; value: OperationInfo }
    | {
        kind: "missing";
        reason: "운영 정보 없음";
        provenance: DataProvenance;
      };
  travelFromPrevious:
    ReferenceTravel | { kind: "missing"; reason: "이동시간 정보 없음" } | null;
};

export type ReferenceItineraryResult = {
  kind: "reference-itinerary";
  destinationId: string;
  conditions: ReferenceItineraryInput["conditions"];
  originTravel: ReferenceOriginTravel | null;
  policyVersion: ReferenceItineraryPolicy["version"];
  ordering: ReferenceItineraryPolicy["ordering"];
  disclaimer: {
    label: "참고용 계획";
    latestInfoAction: "방문 전 최신 운영·휴무·예약 정보를 확인";
  };
  guarantees: {
    operationChecked: false;
    restaurantAvailable: false;
    returnByChecked: false;
  };
  places: ReferenceItineraryPlaceResult[];
  notices: string[];
};

export type ReferenceItineraryUnavailable = {
  kind: "data-unavailable";
  destinationId: string;
  conditions: ReferenceItineraryInput["conditions"];
  originTravel: ReferenceOriginTravel | null;
  reason: "참고 계획에 필요한 장소 또는 관심사 근거가 부족합니다.";
  missing: ("places" | "interestEvidence")[];
};

const matchedEvidence = (place: ReferenceItineraryPlace, interests: string[]) =>
  place.interestEvidence.filter((evidence) => interests.includes(evidence.tag));

const cloneOperation = (operation: OperationInfo): OperationInfo => ({
  ...operation,
  regularIntervals: operation.regularIntervals.map((interval) => ({
    ...interval,
  })),
  closedWeekdays: operation.closedWeekdays
    ? [...operation.closedWeekdays]
    : null,
  dateExceptions: operation.dateExceptions.map((exception) => ({
    ...exception,
    intervals: exception.intervals.map((interval) => ({ ...interval })),
  })),
  provenance: { ...operation.provenance },
});

const addHours = (date: Date, hours: number) =>
  new Date(date.getTime() + hours * 3_600_000);

/**
 * E6 참고용 여행 계획의 순수 엔진.
 *
 * 도로 경로·방문시간·운영시간이 없어도 실제 장소 앵커와 결측을 결과로 전달한다. 이 함수는
 * 확정 일정, 영업 가능, 식사 가능 또는 복귀 가능을 판정하지 않는다.
 */
export function createReferenceItinerary(
  input: ReferenceItineraryInput,
  source: ReferenceItineraryDataSource,
  policy: ReferenceItineraryPolicy = referenceItineraryPolicy,
): ReferenceItineraryResult | ReferenceItineraryUnavailable {
  const places = source.listPlaces(input.destinationId);
  const eligiblePlaces = places.filter(
    (place) => place.interestEvidenceProvenance.dataStatus !== "missing",
  );
  if (eligiblePlaces.length < 2) {
    return {
      kind: "data-unavailable",
      destinationId: input.destinationId,
      conditions: {
        ...input.conditions,
        tripType: { ...input.conditions.tripType },
      },
      originTravel: input.originTravel ? { ...input.originTravel } : null,
      reason: "참고 계획에 필요한 장소 또는 관심사 근거가 부족합니다.",
      missing: [
        ...(places.length < 2 ? (["places"] as const) : []),
        ...(eligiblePlaces.length < 2 ? (["interestEvidence"] as const) : []),
      ],
    };
  }

  const ordered = [...eligiblePlaces].sort((left, right) => {
    const evidenceDifference =
      matchedEvidence(right, input.interests).length -
      matchedEvidence(left, input.interests).length;
    return evidenceDifference || left.id.localeCompare(right.id);
  });

  const matchingOriginTravel =
    input.originTravel?.destinationId === input.destinationId
      ? input.originTravel
      : null;
  let cursor = matchingOriginTravel
    ? addHours(input.conditions.startAt, matchingOriginTravel.estimatedHours)
    : null;
  const resultPlaces: ReferenceItineraryPlaceResult[] = ordered.map(
    (place, index) => {
      const previous = ordered[index - 1];
      const travel = previous
        ? source.lookupTravel(previous.id, place.id)
        : null;
      const visit =
        place.visit.estimatedHours === null
          ? {
              kind: "missing" as const,
              reason: "예상 시간 정보 없음" as const,
              provenance: { ...place.visit.provenance },
            }
          : {
              kind: "estimate" as const,
              estimatedHours: place.visit.estimatedHours,
              provenance: { ...place.visit.provenance },
            };
      if (previous && travel)
        cursor = cursor && addHours(cursor, travel.estimatedHours);
      if (previous && !travel) cursor = null;
      const candidateTimeWindow =
        cursor && visit.kind === "estimate"
          ? {
              startsAt: new Date(cursor),
              endsAt: addHours(cursor, visit.estimatedHours),
            }
          : null;
      const broadTimeWindow =
        candidateTimeWindow &&
        candidateTimeWindow.endsAt.getTime() <=
          input.conditions.returnBy.getTime()
          ? candidateTimeWindow
          : null;
      cursor = broadTimeWindow?.endsAt ?? null;
      return {
        id: place.id,
        name: place.name,
        category: place.category,
        matchedInterests: matchedEvidence(place, input.interests).map(
          (evidence) => evidence.tag,
        ),
        interestEvidence: [...place.interestEvidence],
        interestEvidenceProvenance: { ...place.interestEvidenceProvenance },
        visit,
        broadTimeWindow,
        operation: place.operation
          ? { kind: "available", value: cloneOperation(place.operation) }
          : {
              kind: "missing",
              reason: "운영 정보 없음",
              provenance: { ...place.provenance, dataStatus: "missing" },
            },
        travelFromPrevious: previous
          ? (travel ?? { kind: "missing", reason: "이동시간 정보 없음" })
          : null,
      };
    },
  );

  return {
    kind: "reference-itinerary",
    destinationId: input.destinationId,
    conditions: {
      ...input.conditions,
      tripType: { ...input.conditions.tripType },
    },
    originTravel: input.originTravel ? { ...input.originTravel } : null,
    policyVersion: policy.version,
    ordering: policy.ordering,
    disclaimer: {
      label: "참고용 계획",
      latestInfoAction: "방문 전 최신 운영·휴무·예약 정보를 확인",
    },
    guarantees: {
      operationChecked: false,
      restaurantAvailable: false,
      returnByChecked: false,
    },
    places: resultPlaces,
    notices: [
      "일반 이동·방문시간은 참고 정보이며 실시간 교통 또는 예약 가능 여부를 보증하지 않습니다.",
      "식사 장소는 직접 확인",
    ],
  };
}
