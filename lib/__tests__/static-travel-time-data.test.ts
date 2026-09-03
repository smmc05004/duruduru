import { describe, expect, it } from "@jest/globals";
import {
  createStaticTravelTimeAdapter,
  staticTravelTimeManifestV1,
  validateStaticTravelTimeManifest,
  type StaticTravelTimeManifest,
} from "@/lib/static-travel-time-data";

const coordinateEvidence = {
  kind: "tourapi" as const,
  source: "TourAPI",
  sourceRecordId: "tourapi:place-a",
  collectedAt: "2026-09-03",
  dataVersion: "tourapi-2026-09-03",
  rawAddress: null,
  query: null,
  selectedAddress: null,
  matchEvidence: "원천 좌표",
  coordinates: { latitude: 35, longitude: 129 },
  missingReason: null,
};

const collectionBatch = {
  id: "batch-2026-09-03",
  termsCheckedAt: "2026-09-03",
  callLimitEvidence: "제공자 약관 1절",
  storagePolicyEvidence: "제공자 약관 2절",
  displayPolicyEvidence: "제공자 약관 3절",
  redistributionPolicyEvidence: "제공자 약관 4절",
  rawResponseRetentionEvidence: "제공자 약관 5절",
};

const collectedRouteFields = {
  dataset: "OSM 도로 데이터",
  dataVersion: "osm-2026-09-03",
  fromCoordinate: coordinateEvidence,
  toCoordinate: coordinateEvidence,
  missingReason: null,
};

describe("정적 이동시간 데이터 계약", () => {
  it("초기 3개 출발지와 3개 목적지의 3×3 수집 대상을 버전과 함께 보존한다", () => {
    expect(staticTravelTimeManifestV1.version).toBe("2026-09-03");
    expect(staticTravelTimeManifestV1.policyVersion).toBe("2026-09-03");
    expect(staticTravelTimeManifestV1.originDestinationTargets).toHaveLength(9);
    expect(
      staticTravelTimeManifestV1.originDestinationTargets.map(
        ({ originId, destinationId }) => `${originId}:${destinationId}`,
      ),
    ).toEqual([
      "seoul:gyeongju",
      "seoul:gongju",
      "seoul:gangneung",
      "daejeon:gyeongju",
      "daejeon:gongju",
      "daejeon:gangneung",
      "busan:gyeongju",
      "busan:gongju",
      "busan:gangneung",
    ]);
  });

  it("출처와 재현 근거가 없는 숫자를 정적 데이터로 받아들이지 않는다", () => {
    const invalid: StaticTravelTimeManifest = {
      ...staticTravelTimeManifestV1,
      collectionBatch,
      originDestinationRecords: [
        {
          originId: "seoul",
          destinationId: "gyeongju",
          transport: "car",
          ...collectedRouteFields,
          distanceKm: 300,
          estimatedHours: 3.5,
          estimate: true,
          source: "",
          basisDate: "2026-09-03",
          policyVersion: "2026-09-03",
          reproductionId: "",
          dataStatus: "estimate",
        },
      ],
    };

    expect(validateStaticTravelTimeManifest(invalid)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("source"),
        expect.stringContaining("reproductionId"),
      ]),
    );
  });

  it("3×3 수집 대상에서 빠진 경로를 매니페스트 검증으로 드러낸다", () => {
    const incomplete: StaticTravelTimeManifest = {
      ...staticTravelTimeManifestV1,
      collectionBatch,
      originDestinationTargets:
        staticTravelTimeManifestV1.originDestinationTargets.slice(1),
    };

    expect(validateStaticTravelTimeManifest(incomplete)).toEqual(
      expect.arrayContaining([expect.stringContaining("수집 대상이 없습니다")]),
    );
  });

  it("같은 3×3 또는 POI 쌍에 서로 다른 수치를 중복 저장하지 않는다", () => {
    const record = {
      originId: "seoul",
      destinationId: "gyeongju",
      transport: "car" as const,
      ...collectedRouteFields,
      distanceKm: 315.2,
      estimatedHours: 3.75,
      estimate: true as const,
      source: "허용된 사전 도로 경로 수집",
      basisDate: "2026-09-03",
      policyVersion: "2026-09-03",
      reproductionId: "route:seoul-city-hall:gyeongju-city-hall:car",
      dataStatus: "estimate" as const,
    };
    const duplicated: StaticTravelTimeManifest = {
      ...staticTravelTimeManifestV1,
      collectionBatch,
      originDestinationRecords: [record, { ...record, estimatedHours: 4 }],
      placeTravelTimeRecords: [
        {
          ...record,
          fromPlaceId: "place-a",
          toPlaceId: "restaurant-b",
        },
        {
          ...record,
          fromPlaceId: "place-a",
          toPlaceId: "restaurant-b",
          distanceKm: 320,
        },
      ],
    };

    expect(validateStaticTravelTimeManifest(duplicated)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("중복된 origin-destination"),
        expect.stringContaining("중복된 place"),
      ]),
    );
  });

  it("값이 없는 수집 대상은 임의 예상시간으로 바꾸지 않고 결측으로 조회한다", () => {
    const adapter = createStaticTravelTimeAdapter(staticTravelTimeManifestV1);

    expect(adapter.lookupOriginTravelTime("seoul", "gyeongju", "car")).toBe(
      null,
    );
    expect(
      adapter.lookupPlaceTravelTime("place-a", "restaurant-b", "car"),
    ).toBe(null);
  });

  it("검증된 정적 레코드는 거리·시간·추정 상태·출처·기준일·정책 버전·재현 식별자를 보존한다", () => {
    const manifest: StaticTravelTimeManifest = {
      ...staticTravelTimeManifestV1,
      collectionBatch,
      originDestinationRecords: [
        {
          originId: "seoul",
          destinationId: "gyeongju",
          transport: "car",
          ...collectedRouteFields,
          distanceKm: 315.2,
          estimatedHours: 3.75,
          estimate: true,
          source: "허용된 사전 도로 경로 수집",
          basisDate: "2026-09-03",
          policyVersion: "2026-09-03",
          reproductionId: "route:seoul-city-hall:gyeongju-city-hall:car",
          dataStatus: "estimate",
        },
      ],
      placeTravelTimeRecords: [
        {
          fromPlaceId: "place-a",
          toPlaceId: "restaurant-b",
          transport: "car",
          ...collectedRouteFields,
          distanceKm: 2.1,
          estimatedHours: 0.2,
          estimate: true,
          source: "허용된 사전 도로 경로 수집",
          basisDate: "2026-09-03",
          policyVersion: "2026-09-03",
          reproductionId: "route:place-a:restaurant-b:car",
          dataStatus: "estimate",
        },
      ],
    };
    const adapter = createStaticTravelTimeAdapter(manifest);

    expect(adapter.lookupOriginTravelTime("seoul", "gyeongju", "car")).toEqual({
      originId: "seoul",
      destinationId: "gyeongju",
      transport: "car",
      oneWayHours: 3.75,
      distanceKm: 315.2,
      method: "정적 사전 수집 도로 경로",
      basisDate: "2026-09-03",
      policyVersion: "2026-09-03",
      dataVersion: "osm-2026-09-03",
      reproductionId: "route:seoul-city-hall:gyeongju-city-hall:car",
      provenance: {
        source: "허용된 사전 도로 경로 수집",
        collectedAt: "2026-09-03",
        dataStatus: "estimate",
        dataVersion: "osm-2026-09-03",
      },
    });
    expect(
      adapter.lookupPlaceTravelTime("place-a", "restaurant-b", "car"),
    ).toEqual({
      fromPlaceId: "place-a",
      toPlaceId: "restaurant-b",
      transport: "car",
      estimatedHours: 0.2,
      distanceKm: 2.1,
      method: "정적 사전 수집 도로 경로",
      basisDate: "2026-09-03",
      policyVersion: "2026-09-03",
      dataVersion: "osm-2026-09-03",
      reproductionId: "route:place-a:restaurant-b:car",
      provenance: {
        source: "허용된 사전 도로 경로 수집",
        collectedAt: "2026-09-03",
        dataStatus: "estimate",
        dataVersion: "osm-2026-09-03",
      },
    });
  });
});
