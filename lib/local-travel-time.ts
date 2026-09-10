import type { Coordinates } from "./mvp-phase-two-types";

export type LocalTravelPolicy = {
  version: string;
  speedKmh: number;
  minimumMinutes: number;
  roundingMinutes: number;
  missingReserveMinutes: number;
};

/** Product estimate, not observed driving speeds or a routing service. */
export const LOCAL_TRAVEL_POLICY: LocalTravelPolicy = {
  version: "straight-line-v1",
  speedKmh: 30,
  minimumMinutes: 5,
  roundingMinutes: 5,
  missingReserveMinutes: 15,
};
export const LOCAL_TRAVEL_NOTICE =
  "장소 간 이동시간은 직선거리를 기준으로 추정했어요. 실제 도로의 우회, 교통 상황, 주차 등에 따라 달라질 수 있어요.";
export type LocalTravelEstimate = {
  status: "estimated" | "unavailable";
  distanceKm: number | null;
  estimatedMinutes: number | null;
  reservedMinutes: number;
  policyVersion: string;
};
export type LocalTravelLeg = LocalTravelEstimate & {
  fromId: string;
  toId: string;
};

export function validCoordinates(
  value: Coordinates | null,
): value is Coordinates {
  return Boolean(
    value &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.latitude) <= 90 &&
    Math.abs(value.longitude) <= 180,
  );
}

export function estimateLocalTravel(
  from: Coordinates | null,
  to: Coordinates | null,
  policy: LocalTravelPolicy = LOCAL_TRAVEL_POLICY,
): LocalTravelEstimate {
  if (
    !policy.version ||
    ![
      policy.speedKmh,
      policy.minimumMinutes,
      policy.roundingMinutes,
      policy.missingReserveMinutes,
    ].every((value) => Number.isFinite(value) && value > 0)
  )
    throw new Error("장소 간 이동시간 정책이 올바르지 않아요.");
  if (!validCoordinates(from) || !validCoordinates(to))
    return {
      status: "unavailable",
      distanceKm: null,
      estimatedMinutes: null,
      reservedMinutes: policy.missingReserveMinutes,
      policyVersion: policy.version,
    };
  const rad = Math.PI / 180;
  const h =
    Math.sin(((to.latitude - from.latitude) * rad) / 2) ** 2 +
    Math.cos(from.latitude * rad) *
      Math.cos(to.latitude * rad) *
      Math.sin(((to.longitude - from.longitude) * rad) / 2) ** 2;
  const distanceKm =
    6371 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
  const estimatedMinutes =
    distanceKm === 0
      ? 0
      : Math.max(
          policy.minimumMinutes,
          Math.ceil(
            ((distanceKm / policy.speedKmh) * 60) / policy.roundingMinutes,
          ) * policy.roundingMinutes,
        );
  return {
    status: "estimated",
    distanceKm,
    estimatedMinutes,
    reservedMinutes: estimatedMinutes,
    policyVersion: policy.version,
  };
}
