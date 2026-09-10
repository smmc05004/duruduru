import { estimateLocalTravel } from "@/lib/local-travel-time";

// Explicit fixture parameters, not an implicit product-policy default.
const policy = {
  version: "fixture-v1",
  speedKmh: 30,
  minimumMinutes: 5,
  roundingMinutes: 5,
  missingReserveMinutes: 15,
};
const origin = { latitude: 37, longitude: 127 };

describe("장소 간 직선거리 추정 계약", () => {
  it("좌표 결측을 0분 추정으로 만들지 않는다", () => {
    expect(estimateLocalTravel(origin, null, policy)).toEqual({
      status: "unavailable",
      distanceKm: null,
      estimatedMinutes: null,
      reservedMinutes: 15,
      policyVersion: "fixture-v1",
    });
  });
  it("위경도 범위·비유한 좌표를 결측 처리한다", () => {
    for (const latitude of [91, -91, NaN, Infinity]) {
      expect(
        estimateLocalTravel(origin, { latitude, longitude: 127 }, policy)
          .status,
      ).toBe("unavailable");
    }
  });
  it("동일 좌표는 알려진 0분이며 짧은 거리는 최소시간을 적용한다", () => {
    expect(estimateLocalTravel(origin, origin, policy)).toMatchObject({
      status: "estimated",
      distanceKm: 0,
      estimatedMinutes: 0,
      reservedMinutes: 0,
    });
    expect(
      estimateLocalTravel(origin, { ...origin, latitude: 37.00001 }, policy)
        .estimatedMinutes,
    ).toBe(5);
  });
  it("직선거리와 정책 환산 분을 분리하고 올림한다", () => {
    const result = estimateLocalTravel(
      origin,
      { latitude: 37.1, longitude: 127 },
      policy,
    );
    expect(result.distanceKm).toBeCloseTo(11.1195, 3);
    expect(result.estimatedMinutes).toBe(25);
    expect(result.reservedMinutes).toBe(25);
    expect(result).toEqual(
      estimateLocalTravel(origin, { latitude: 37.1, longitude: 127 }, policy),
    );
  });
  it("잘못된 정책을 임의 기본값으로 대체하지 않는다", () => {
    expect(() =>
      estimateLocalTravel(origin, origin, { ...policy, speedKmh: 0 }),
    ).toThrow();
    expect(() =>
      estimateLocalTravel(origin, origin, { ...policy, roundingMinutes: 0 }),
    ).toThrow();
  });
});
