import { describe, expect, it } from "@jest/globals";
import {
  evaluateRecommendationRequest,
  requestRecommendations,
  type RecommendationDataSource,
} from "@/lib/recommendation-request";
import type { DomainDataAdapter } from "@/lib/domain-data";
import { recommendationPolicyV1 } from "@/lib/trip-policy";
import { supportConditionsV1 } from "@/lib/support-conditions";
import { validateTripConditions } from "@/lib/trip-conditions";

const conditionsResult = validateTripConditions(
  {
    originId: "seoul",
    startAt: "2026-09-12T08:00",
    returnBy: "2026-09-13T20:00",
    transport: "car",
    interests: ["역사"],
  },
  supportConditionsV1,
);

if (!conditionsResult.ok) throw new Error("테스트 조건이 유효해야 합니다.");
const conditions = conditionsResult.conditions;

const provenance = {
  source: "테스트 정규화 데이터",
  collectedAt: "2026-09-02T00:00:00.000Z",
  dataStatus: "normal" as const,
};

function sourceOf(
  overrides: Partial<DomainDataAdapter> = {},
): RecommendationDataSource {
  const source: DomainDataAdapter = {
    listOrigins: () => [],
    listDestinations: () => [
      {
        id: "gyeongju",
        name: "경주",
        region: "경상북도",
        supportStatus: "supported",
        coordinates: { latitude: 35.8562, longitude: 129.2247 },
        summary: null,
        tags: [
          {
            destinationId: "gyeongju",
            tag: "역사",
            evidence: "테스트 태그 근거",
            provenance,
          },
        ],
        tagProvenance: provenance,
        provenance,
      },
    ],
    listPlaces: () => [],
    lookupOriginTravelTime: () => ({
      originId: "seoul",
      destinationId: "gyeongju",
      transport: "car",
      oneWayHours: 3.5,
      distanceKm: 300,
      method: "테스트 평균",
      basisDate: "2026-09-02",
      provenance,
    }),
    lookupPlaceTravelTime: () => null,
    listFestivals: () => [],
    listRepresentativeFoods: () => [],
    listRestaurants: () => [],
    ...overrides,
  };
  return source;
}

describe("E3 조건 → E4 추천 요청 통합", () => {
  it("기본 요청은 PoC 목업이 아니라 현재 내부 데이터 계약의 결측 상태를 쓴다", async () => {
    const outcome = await requestRecommendations(conditions);

    expect(outcome.kind).toBe("data-unavailable");
    expect(outcome.candidates.map((candidate) => candidate.id)).toEqual([
      "gyeongju",
      "gongju",
      "gangneung",
    ]);
    expect(outcome.candidates.every((candidate) => !candidate.passed)).toBe(
      true,
    );
    expect(
      outcome.candidates.every(
        (candidate) =>
          "dataStatus" in candidate.data.travel &&
          candidate.data.travel.dataStatus === "missing",
      ),
    ).toBe(true);
  });

  it("정규화된 도메인 계약의 이동시간·태그·출처 상태와 조건 스냅샷을 결과에 보존한다", () => {
    const outcome = evaluateRecommendationRequest(
      conditions,
      sourceOf(),
      recommendationPolicyV1,
    );

    expect(outcome.kind).toBe("recommendations");
    expect(outcome.supportVersion).toBe("2026-09-02");
    expect(outcome.timeZone).toBe("Asia/Seoul");
    expect(outcome.passed[0]).toMatchObject({
      id: "gyeongju",
      data: {
        destination: provenance,
        tags: {
          records: [expect.objectContaining({ provenance })],
          provenance,
        },
        travel: expect.objectContaining({ provenance }),
      },
    });
  });

  it("이동시간이 결측이면 허위 후보 대신 데이터 준비 필요 결과를 돌려준다", () => {
    const outcome = evaluateRecommendationRequest(
      conditions,
      sourceOf({ lookupOriginTravelTime: () => null }),
      recommendationPolicyV1,
    );

    expect(outcome.kind).toBe("data-unavailable");
    expect(outcome.passed).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({
      data: { travel: { dataStatus: "missing" } },
    });
  });

  it("태그 미수집은 관심사 불일치 0점으로 바꾸지 않고 점수 항에서 제외한다", () => {
    const outcome = evaluateRecommendationRequest(
      conditions,
      sourceOf({
        listDestinations: () => [
          {
            id: "gyeongju",
            name: "경주",
            region: "경상북도",
            supportStatus: "supported",
            coordinates: { latitude: 35.8562, longitude: 129.2247 },
            summary: null,
            tags: [],
            tagProvenance: { ...provenance, dataStatus: "missing" },
            provenance,
          },
        ],
      }),
      recommendationPolicyV1,
    );

    const candidate = outcome.passed[0];
    expect(candidate.data.tags.provenance.dataStatus).toBe("missing");
    expect(
      candidate.components.find((item) => item.id === "interestFit"),
    ).toMatchObject({
      available: false,
      raw: null,
    });
    expect(candidate.usedWeights).toEqual({ timeFit: 1 });
  });

  it("시간 제약 탈락과 데이터 결측을 구분하고, 결과 없음에는 조정 가능한 조건을 남긴다", () => {
    const outcome = evaluateRecommendationRequest(
      conditions,
      sourceOf({
        lookupOriginTravelTime: () => ({
          originId: "seoul",
          destinationId: "gyeongju",
          transport: "car",
          oneWayHours: 20,
          distanceKm: 300,
          method: "테스트 평균",
          basisDate: "2026-09-02",
          provenance,
        }),
      }),
      recommendationPolicyV1,
    );

    expect(outcome.kind).toBe("no-results");
    expect(outcome.adjustableConditions).toEqual([
      "startAt",
      "returnBy",
      "originId",
    ]);
  });
});
