import { describe, expect, it } from "@jest/globals";
import { pocDataAdapter, type DomainDataStatus } from "@/lib/poc-data-adapter";
import { supportConditionsV1 } from "@/lib/support-conditions";

const expectedTemporaryStatus: DomainDataStatus = "estimate";

describe("PoC 데이터 어댑터", () => {
  it("추천에 쓰는 목적지와 태그를 출처·수집시각·임시 상태와 함께 제공한다", () => {
    const destinations = pocDataAdapter.listDestinations();

    expect(destinations.map((destination) => destination.id)).toEqual([
      "gyeongju",
      "gongju",
      "gangneung",
    ]);
    expect(destinations[0]).toMatchObject({
      provenance: {
        source: expect.stringContaining("PoC 목업"),
        collectedAt: "2026-08-30",
        dataStatus: expectedTemporaryStatus,
      },
    });
    expect(destinations[0].tags[0]).toMatchObject({
      destinationId: "gyeongju",
      provenance: { dataStatus: expectedTemporaryStatus },
    });
  });

  it("목업에 없는 운영·대표음식·음식점 데이터는 근거 없는 값으로 만들지 않는다", () => {
    const destination = pocDataAdapter.listDestinations()[0];

    expect(pocDataAdapter.listRestaurants(destination.id)).toEqual([]);
    expect(pocDataAdapter.listRepresentativeFoods(destination.id)).toEqual([]);
    expect(
      pocDataAdapter.listPlaces(destination.id)[0].operation,
    ).toMatchObject({
      closedWeekdays: [],
      provenance: { dataStatus: expectedTemporaryStatus },
    });
    expect(
      pocDataAdapter.listPlaces(destination.id)[1].operation,
    ).toMatchObject({
      closedWeekdays: [1],
    });
  });

  it("이동시간은 출발지 차이를 숨기지 않는 임시 추정 계약으로 제공한다", () => {
    const travel = pocDataAdapter.lookupOriginTravelTime(
      "seoul",
      "gyeongju",
      "car",
    );

    expect(travel).toMatchObject({
      originId: "seoul",
      destinationId: "gyeongju",
      oneWayHours: 3.5,
      method: "poc-mock",
      provenance: { dataStatus: expectedTemporaryStatus },
    });
  });

  it("출발지 기준점도 출처·상태 계약으로 제공한다", () => {
    expect(pocDataAdapter.listOrigins()[0]).toMatchObject({
      id: "seoul",
      supportStatus: "unknown",
      coordinates: null,
      provenance: { dataStatus: expectedTemporaryStatus },
    });
  });

  it("PoC 출발지 투영은 E3의 정식 지원 조건 목록을 직접 따른다", () => {
    expect(pocDataAdapter.listOrigins().map((origin) => origin.id)).toEqual(
      supportConditionsV1.origins.map((origin) => origin.id),
    );
  });
});
