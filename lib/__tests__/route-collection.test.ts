import { describe, expect, it } from "@jest/globals";
import {
  validateOfflineGeocodeRequest,
  validateRouteCollectionManifest,
} from "@/lib/route-collection";
const point = {
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
const route = {
  fromId: "a",
  toId: "b",
  from: point,
  to: point,
  transport: "car" as const,
  distanceKm: 1,
  estimatedHours: 1,
  dataStatus: "estimate" as const,
  estimate: true as const,
  reproductionId: "safe-id",
  provider: "provider",
  dataset: "dataset",
  basisDate: "2026-09-03",
  dataVersion: "v1",
  missingReason: null,
};
describe("E10 정적 경로 수집 경계", () => {
  it("오프라인 지오코딩의 식별·주소·제공자·일치 근거를 요구한다", () => {
    expect(
      validateOfflineGeocodeRequest({
        sourceId: "x",
        address: "a",
        provider: "p",
        matchEvidence: "m",
      }),
    ).toEqual([]);
    expect(
      validateOfflineGeocodeRequest({
        sourceId: "",
        address: "",
        provider: "",
        matchEvidence: "",
      }),
    ).not.toEqual([]);
  });
  it("역방향은 독립적으로 허용한다", () =>
    expect(
      validateRouteCollectionManifest({
        version: "v",
        policyVersion: "p",
        collectionBatch,
        routes: [route, { ...route, fromId: "b", toId: "a" }],
      }),
    ).toEqual([]));
  it("좌표 범위·명시적 결측 사유·경로 재현 메타데이터를 검증한다", () => {
    const bad = {
      ...route,
      from: { ...point, coordinates: { latitude: 99, longitude: 1 } },
      distanceKm: null,
      estimatedHours: null,
      reproductionId: null,
      missingReason: null,
    };
    expect(
      validateRouteCollectionManifest({
        version: "v",
        policyVersion: "p",
        collectionBatch,
        routes: [bad, bad],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("WGS84"),
        expect.stringContaining("경로 결측 사유"),
        expect.stringContaining("중복"),
      ]),
    );
  });
  it("부분 거리·시간과 경로 provenance 결측을 거부한다", () => {
    expect(
      validateRouteCollectionManifest({
        version: "v",
        policyVersion: "p",
        collectionBatch,
        routes: [
          { ...route, estimatedHours: null },
          { ...route, fromId: "c", provider: null },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("동시성"),
        expect.stringContaining("메타데이터"),
      ]),
    );
  });
  it("상태별 경로값과 좌표 원천별 provenance를 엄격히 검증한다", () => {
    const offlineGeocodePoint = {
      ...point,
      kind: "offline-geocode" as const,
      sourceRecordId: "public:place-a",
      dataVersion: null,
      rawAddress: "경상북도 경주시",
      query: "경주시청",
      selectedAddress: "경상북도 경주시 동천동",
    };

    expect(
      validateRouteCollectionManifest({
        version: "v",
        policyVersion: "p",
        collectionBatch,
        routes: [
          { ...route, dataStatus: "missing" as const },
          { ...route, fromId: "c", from: { ...point, sourceRecordId: null } },
          {
            ...route,
            fromId: "d",
            from: { ...offlineGeocodePoint, query: null },
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("결측 경로 상태 오류"),
        expect.stringContaining("TourAPI 원천 레코드 ID"),
        expect.stringContaining("오프라인 지오코딩 provenance"),
      ]),
    );

    expect(
      validateRouteCollectionManifest({
        version: "v",
        policyVersion: "p",
        collectionBatch,
        routes: [
          {
            ...route,
            distanceKm: null,
            estimatedHours: null,
            dataStatus: "missing" as const,
            reproductionId: "missing:route-a-b",
            provider: "수집 배치 미완료",
            dataset: "수집 대상 매니페스트",
            basisDate: "2026-09-03",
            dataVersion: "v1",
            missingReason: "정적 수집 전",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("수집 배치와 런타임 입력 형식을 우회할 수 없다", () => {
    expect(
      validateRouteCollectionManifest({
        version: "",
        policyVersion: "p",
        collectionBatch: { ...collectionBatch, termsCheckedAt: "2026/09/03" },
        routes: [
          {
            ...route,
            fromId: " ",
            estimate: false as true,
            dataStatus: "normal" as "estimate",
            basisDate: "2026/09/03",
            from: { ...point, dataVersion: null },
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("매니페스트 버전"),
        expect.stringContaining("경로 끝점 ID"),
        expect.stringContaining("경로 상태 값 오류"),
        expect.stringContaining("TourAPI 좌표 데이터 버전"),
        expect.stringContaining("경로 메타데이터"),
      ]),
    );
  });

  it("실제 달력이 아닌 날짜와 공백 지오코딩 근거를 거부한다", () => {
    expect(
      validateRouteCollectionManifest({
        version: "v",
        policyVersion: "p",
        collectionBatch: { ...collectionBatch, termsCheckedAt: "2026-02-30" },
        routes: [
          {
            ...route,
            basisDate: "2026-99-99",
            from: {
              ...point,
              kind: "offline-geocode" as const,
              sourceRecordId: "public:place-a",
              dataVersion: null,
              rawAddress: " ",
              query: " ",
              selectedAddress: " ",
            },
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("오프라인 지오코딩 provenance"),
        expect.stringContaining("경로 메타데이터"),
      ]),
    );
  });

  it("공백만 있는 결측 사유를 거부한다", () => {
    expect(
      validateRouteCollectionManifest({
        version: "v",
        policyVersion: "p",
        collectionBatch,
        routes: [
          {
            ...route,
            distanceKm: null,
            estimatedHours: null,
            dataStatus: "missing" as const,
            missingReason: " ",
            from: { ...point, coordinates: null, missingReason: " " },
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("좌표 결측 사유"),
        expect.stringContaining("결측 경로 상태 오류"),
      ]),
    );
  });
});
