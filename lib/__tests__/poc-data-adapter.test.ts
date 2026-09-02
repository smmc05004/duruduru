import { describe, expect, it } from "@jest/globals";
import { pocDataAdapter, type DomainDataStatus } from "@/lib/poc-data-adapter";

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
      provenance: { dataStatus: expectedTemporaryStatus },
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
});
