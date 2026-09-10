import { expect } from "@jest/globals";
import {
  createPlan,
  planMetrics,
  scheduleTrip,
} from "@/lib/mvp-phase-two-planner";
import { isSavedPlan } from "@/lib/mvp-phase-two-storage";
import { isLocalPlace, localLeg } from "@/lib/local-travel-schedule";
import type {
  Attraction,
  Candidate,
  PlanSnapshot,
  SearchInput,
  TimeBlock,
} from "@/lib/mvp-phase-two-types";
export const input: SearchInput = {
  originId: "seoul",
  startAt: "2026-09-12T07:00",
  returnBy: "2026-09-13T21:00",
  transport: "car",
  interests: ["history"],
};
export const attraction = (contentId: string): Attraction => ({
  contentId,
  contentTypeId: "12",
  regionId: "region",
  title: `관광 ${contentId}`,
  address: `충남 공주시 ${contentId}길 1`,
  imageUrl: "",
  coordinates: null,
  categories: ["history"],
  cat1: "A02",
  cat2: "A0201",
  cat3: "A02010100",
});
export const saved = (plan: PlanSnapshot) => ({
  ...plan,
  savedAt: "2026-09-09T00:00:00.000Z",
});

export function fixture(): PlanSnapshot {
  const attractions = ["A", "B", "C", "D"].map(attraction);
  const schedule = scheduleTrip(input, 30, attractions.slice(0, 3));
  if (!schedule.ok) throw new Error(schedule.reason);
  const candidate: Candidate = {
    groupId: "group",
    memberRegionIds: ["region"],
    representativeZoneId: "zone",
    displayName: "공주",
    name: "공주",
    province: "충남",
    oneWayMinutes: 30,
    attractions,
    preview: { blocks: schedule.blocks, metrics: schedule.metrics },
    reasons: [],
    metadata: {
      profileGeneratedAt: "2026-09-01T00:00:00Z",
      travelTimeGeneratedAt: "2026-09-01T00:00:00Z",
      networkYear: 2024,
      travelTimeSource: "KTDB",
      representativePoint: "대표점",
      searchedAt: "2026-09-01T00:00:00Z",
    },
  };
  const plan = createPlan(input, candidate, "correction");
  expect(isSavedPlan(saved(plan))).toBe(true);
  return plan;
}

/** Keep all generated driving, meals and rest; rebuild only the gaps around
 * controlled activities. Validate the resulting baseline before every edit. */
export function placed(
  plan: PlanSnapshot,
  activities: TimeBlock[],
): PlanSnapshot {
  const fixed = plan.blocks.filter(
    (b) =>
      !["attraction", "personal", "free"].includes(b.kind) && !b.localTravel,
  );
  const occupied = [...fixed, ...activities].toSorted((a, b) =>
    a.startAt.localeCompare(b.startAt),
  );
  // Rebuild connections for the controlled places, never remove regional driving.
  for (const day of [1, 2] as const) {
    const places = occupied.filter((b) => b.day === day && isLocalPlace(b));
    for (let i = 1; i < places.length; i++) {
      const leg = localLeg(places[i - 1], places[i]);
      if (!leg.reservedMinutes) continue;
      const end = places[i].startAt;
      const start = new Date(
        Date.parse(`${end}:00+09:00`) -
          leg.reservedMinutes * 60000 +
          9 * 3600000,
      )
        .toISOString()
        .slice(0, 16);
      occupied.push({
        id: `fixture-local-${day}-${i}`,
        day,
        startAt: start,
        endAt: end,
        kind: "travel",
        title: "현지 이동",
        durationMinutes: leg.reservedMinutes,
        localTravel: leg,
        reason: "새 연결의 이동 예약",
      });
    }
  }
  occupied.sort((a, b) => a.startAt.localeCompare(b.startAt));
  const blocks: TimeBlock[] = [];
  let cursor = plan.input.startAt;
  for (const block of occupied) {
    if (cursor < block.startAt)
      blocks.push({
        id: `gap-${blocks.length}`,
        day: cursor.slice(0, 10) === plan.input.startAt.slice(0, 10) ? 1 : 2,
        startAt: cursor,
        endAt: block.startAt,
        kind: "free",
        title: "여유시간",
        durationMinutes:
          (Date.parse(`${block.startAt}+09:00`) -
            Date.parse(`${cursor}+09:00`)) /
          60_000,
        reason: "제어된 경계 검증의 남은 낮 시간",
      });
    blocks.push(block);
    cursor = block.endAt;
  }
  const result = {
    ...plan,
    blocks,
    metrics: planMetrics(
      plan.input,
      blocks,
      plan.metrics.arrivalAt,
      plan.metrics.returnDepartureAt,
    ),
  };
  expect(isSavedPlan(saved(result))).toBe(true);
  return result;
}

export function personalPlan(): PlanSnapshot {
  const plan = fixture();
  const activities = plan.blocks.filter((b) => b.kind === "attraction");
  return placed(plan, [
    ...activities,
    {
      id: "personal-one",
      day: 1,
      kind: "personal",
      title: "친구와 약속",
      startAt: "2026-09-12T19:30",
      endAt: "2026-09-12T20:00",
      durationMinutes: 30,
      personal: {
        id: "personal-one",
        name: "친구와 약속",
        category: "appointment",
        day: 1,
        durationMinutes: 30,
        address: "공주시 약속 장소",
      },
      reason: "사용자가 입력한 개인 일정",
    },
  ]);
}
