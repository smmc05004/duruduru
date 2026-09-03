import { describe, expect, it } from "@jest/globals";
import {
  createReferenceItinerary,
  type ReferenceItineraryDataSource,
} from "@/lib/reference-itinerary";
import { referenceItineraryDataSource } from "@/lib/reference-itinerary-data";

const conditions = {
  supportVersion: "2026-09-02",
  timeZone: "Asia/Seoul",
  tripType: { days: 1, nights: 0, label: "당일치기" },
  startAt: new Date("2026-09-03T09:00:00+09:00"),
  returnBy: new Date("2026-09-03T18:00:00+09:00"),
} as const;

const originTravel = {
  kind: "road-route" as const,
  originId: "seoul",
  destinationId: "gyeongju",
  distanceKm: 280,
  estimatedHours: 1,
  method: "사전 수집 도로 경로",
  source: "테스트 정적 경로 데이터",
  basisDate: "2026-09-03",
  dataVersion: "2026-09-03",
  policyVersion: "2026-09-03",
  reproductionId: "test:seoul:gyeongju",
  dataStatus: "estimate" as const,
};

const source: ReferenceItineraryDataSource = {
  listPlaces: () => [
    {
      id: "place-b",
      destinationId: "gyeongju",
      name: "두 번째 장소",
      category: "관광지",
      coordinates: { latitude: 35.8, longitude: 129.2 },
      interestEvidence: [
        {
          tag: "자연",
          evidence: "테스트 관심사 근거",
          provenance: {
            source: "테스트 공공 장소 데이터",
            collectedAt: "2026-09-03",
            dataStatus: "normal",
          },
        },
      ],
      interestEvidenceProvenance: {
        source: "테스트 공공 장소 데이터",
        collectedAt: "2026-09-03",
        dataStatus: "normal",
      },
      visit: {
        estimatedHours: null,
        provenance: {
          source: "테스트 공공 장소 데이터",
          collectedAt: "2026-09-03",
          dataStatus: "missing",
        },
      },
      operation: null,
      provenance: {
        source: "테스트 공공 장소 데이터",
        collectedAt: "2026-09-03",
        dataStatus: "normal",
      },
    },
    {
      id: "place-a",
      destinationId: "gyeongju",
      name: "첫 번째 장소",
      category: "관광지",
      coordinates: { latitude: 35.7, longitude: 129.1 },
      interestEvidence: [
        {
          tag: "역사",
          evidence: "테스트 관심사 근거",
          provenance: {
            source: "테스트 공공 장소 데이터",
            collectedAt: "2026-09-03",
            dataStatus: "normal",
          },
        },
      ],
      interestEvidenceProvenance: {
        source: "테스트 공공 장소 데이터",
        collectedAt: "2026-09-03",
        dataStatus: "normal",
      },
      visit: {
        estimatedHours: 1.5,
        provenance: {
          source: "테스트 공공 장소 데이터",
          collectedAt: "2026-09-03",
          dataStatus: "estimate",
        },
      },
      operation: {
        placeId: "place-a",
        regularIntervals: [{ opensAt: "09:00", closesAt: "18:00" }],
        closedWeekdays: null,
        dateExceptions: [],
        provenance: {
          source: "테스트 공공 장소 데이터",
          collectedAt: "2026-09-03",
          dataStatus: "normal",
        },
      },
      provenance: {
        source: "테스트 공공 장소 데이터",
        collectedAt: "2026-09-03",
        dataStatus: "normal",
      },
    },
  ],
  lookupTravel: (fromPlaceId, toPlaceId) =>
    fromPlaceId === "place-a" && toPlaceId === "place-b"
      ? {
          kind: "road-route",
          distanceKm: 3.2,
          estimatedHours: 0.25,
          method: "사전 수집 도로 경로",
          source: "테스트 정적 경로 데이터",
          basisDate: "2026-09-03",
          dataVersion: "2026-09-03",
          policyVersion: "2026-09-03",
          reproductionId: "test:place-a:place-b",
          dataStatus: "estimate",
        }
      : null,
};

describe("E6 참고용 여행 계획", () => {
  it("관심사 근거를 우선하고 동점은 안정 식별자로 정렬하며, 참고용 고지와 확인 행동을 보존한다", () => {
    const result = createReferenceItinerary(
      {
        destinationId: "gyeongju",
        interests: ["역사"],
        conditions,
        originTravel,
      },
      source,
    );

    expect(result.kind).toBe("reference-itinerary");
    if (result.kind !== "reference-itinerary") return;
    expect(result.places.map((place) => place.id)).toEqual([
      "place-a",
      "place-b",
    ]);
    expect(result.disclaimer).toEqual({
      label: "참고용 계획",
      latestInfoAction: "방문 전 최신 운영·휴무·예약 정보를 확인",
    });
    expect(result).toMatchObject({
      conditions: {
        supportVersion: "2026-09-02",
        timeZone: "Asia/Seoul",
      },
      policyVersion: "2026-09-03",
      ordering: "matched-interest-evidence-desc:id-asc",
      originTravel: {
        originId: "seoul",
        estimatedHours: 1,
        reproductionId: "test:seoul:gyeongju",
      },
    });
    expect(result.places[0]).toMatchObject({
      matchedInterests: ["역사"],
      visit: {
        kind: "estimate",
        estimatedHours: 1.5,
        provenance: { dataStatus: "estimate" },
      },
      operation: {
        kind: "available",
        value: { regularIntervals: [{ opensAt: "09:00" }] },
      },
    });
    expect(result.places[1].travelFromPrevious).toMatchObject({
      kind: "road-route",
      distanceKm: 3.2,
      estimatedHours: 0.25,
      dataVersion: "2026-09-03",
      reproductionId: "test:place-a:place-b",
    });
    expect(result.places.map((place) => place.broadTimeWindow)).toEqual([
      {
        startsAt: new Date("2026-09-03T10:00:00+09:00"),
        endsAt: new Date("2026-09-03T11:30:00+09:00"),
      },
      null,
    ]);
  });

  it("방문·이동 정보가 없으면 수치를 발명하거나 실행 가능 일정을 만들지 않는다", () => {
    const missingOnly: ReferenceItineraryDataSource = {
      ...source,
      lookupTravel: () => null,
    };
    const result = createReferenceItinerary(
      {
        destinationId: "gyeongju",
        interests: [],
        conditions,
        originTravel: null,
      },
      missingOnly,
    );

    expect(result.kind).toBe("reference-itinerary");
    if (result.kind !== "reference-itinerary") return;
    expect(result.places.map((place) => place.id)).toEqual([
      "place-a",
      "place-b",
    ]);
    expect(result.places[0].visit).toMatchObject({ kind: "estimate" });
    expect(result.places[1].travelFromPrevious).toEqual({
      kind: "missing",
      reason: "이동시간 정보 없음",
    });
    expect(result.guarantees).toEqual({
      operationChecked: false,
      restaurantAvailable: false,
      returnByChecked: false,
    });
  });

  it("선택 목적지와 다른 일반 이동시간은 넓은 시간대를 계산하는 데 쓰지 않는다", () => {
    const result = createReferenceItinerary(
      {
        destinationId: "gyeongju",
        interests: ["역사"],
        conditions,
        originTravel: { ...originTravel, destinationId: "gongju" },
      },
      source,
    );

    expect(result.kind).toBe("reference-itinerary");
    if (result.kind !== "reference-itinerary") return;
    expect(result.places[0].broadTimeWindow).toBeNull();
  });

  it("복귀 가능 시각을 넘는 넓은 시간대는 만들지 않는다", () => {
    const result = createReferenceItinerary(
      {
        destinationId: "gyeongju",
        interests: ["역사"],
        conditions: {
          ...conditions,
          returnBy: new Date("2026-09-03T11:00:00+09:00"),
        },
        originTravel,
      },
      source,
    );

    expect(result.kind).toBe("reference-itinerary");
    if (result.kind !== "reference-itinerary") return;
    expect(result.places[0].broadTimeWindow).toBeNull();
  });

  it("목적지에 식별 가능한 장소가 두 곳보다 적으면 데이터 부족 결과를 돌려준다", () => {
    const result = createReferenceItinerary(
      {
        destinationId: "gongju",
        interests: ["역사"],
        conditions,
        originTravel: null,
      },
      { ...source, listPlaces: () => [source.listPlaces("gyeongju")[0]] },
    );

    expect(result).toEqual({
      kind: "data-unavailable",
      destinationId: "gongju",
      conditions,
      originTravel: null,
      reason: "참고 계획에 필요한 장소 또는 관심사 근거가 부족합니다.",
      missing: ["places", "interestEvidence"],
    });
  });

  it.each(["gyeongju", "gongju", "gangneung"])(
    "실제 %s 장소 앵커와 정적 경로로 참고 계획을 만든다",
    (destinationId) => {
      const result = createReferenceItinerary(
        {
          destinationId,
          interests: ["역사"],
          conditions,
          originTravel: null,
        },
        referenceItineraryDataSource,
      );

      expect(result).toMatchObject({
        kind: "reference-itinerary",
        destinationId,
      });
      if (result.kind !== "reference-itinerary") return;
      expect(result.places).toHaveLength(2);
      expect(result.places[1]?.travelFromPrevious).toMatchObject({
        kind: "road-route",
        dataStatus: "estimate",
      });
    },
  );
});
