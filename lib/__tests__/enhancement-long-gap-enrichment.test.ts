import { afterEach } from "@jest/globals";
import { enrichLongGaps, longGapMetrics } from "@/lib/long-gap-enrichment";
import { searchPhaseTwo } from "@/lib/mvp-phase-two-search";
import { createPlan, planMetrics } from "@/lib/mvp-phase-two-planner";
import { isLocalPlace, localLeg } from "@/lib/local-travel-schedule";
import {
  isSavedPlan,
  readSavedPlans,
  savePlan,
} from "@/lib/mvp-phase-two-storage";
import { fixture, placed, saved } from "@/lib/test-support/enhancement-fixture";
import type { PlanSnapshot, SearchInput } from "@/lib/mvp-phase-two-types";

const seoulHistoryDay: SearchInput = {
  originId: "seoul",
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
  transport: "car",
  interests: ["history"],
};

afterEach(() => localStorage.clear());

it("LG-0 서울·역사·주간 selected 계획 before 지표를 고정한다", () => {
  const result = searchPhaseTwo(
    seoulHistoryDay,
    "long-gap-baseline",
    "2026-09-14T00:00:00.000Z",
  );
  expect(result.kind).toBe("success");
  if (result.kind !== "success") return;
  const rows = result.candidates.map((candidate) => {
    const plan = createPlan(seoulHistoryDay, candidate, result.searchId);
    const metrics = longGapMetrics(plan);
    return {
      role: candidate.recommendation?.role,
      displayName: candidate.displayName,
      attractionCount: plan.metrics.attractionCount,
      totalFree: metrics.totalFreeMinutes,
      maxFree: metrics.maxFreeMinutes,
      excessFree: metrics.excessFreeMinutes,
    };
  });
  expect(rows).toEqual([
    {
      role: "nearby",
      displayName: "고양",
      attractionCount: 6,
      totalFree: 835,
      maxFree: 285,
      excessFree: 285,
    },
    {
      role: "overnight",
      displayName: "문경",
      attractionCount: 6,
      totalFree: 610,
      maxFree: 270,
      excessFree: 195,
    },
    {
      role: "interestRich",
      displayName: "순창",
      attractionCount: 6,
      totalFree: 530,
      maxFree: 210,
      excessFree: 120,
    },
  ]);
});

it("LG-8 서울·역사·주간 selected 계획 after 지표를 측정한다", () => {
  const result = searchPhaseTwo(
    seoulHistoryDay,
    "long-gap-after",
    "2026-09-14T00:00:00.000Z",
  );
  expect(result.kind).toBe("success");
  if (result.kind !== "success") return;
  const rows = result.candidates.map((candidate) => {
    const plan = createPlan(seoulHistoryDay, candidate, result.searchId);
    const enriched = enrichLongGaps(plan);
    const finalPlan = enriched.plan;
    const metrics = longGapMetrics(finalPlan);
    return {
      displayName: candidate.displayName,
      status: enriched.status,
      attractionCount: finalPlan.metrics.attractionCount,
      totalFree: metrics.totalFreeMinutes,
      maxFree: metrics.maxFreeMinutes,
      excessFree: metrics.excessFreeMinutes,
      evaluated: enriched.summary.performance.evaluatedCandidates,
    };
  });
  expect(rows).toEqual([
    {
      displayName: "고양",
      status: "applied",
      attractionCount: 6,
      totalFree: 835,
      maxFree: 285,
      excessFree: 195,
      evaluated: 12,
    },
    {
      displayName: "문경",
      status: "applied",
      attractionCount: 6,
      totalFree: 610,
      maxFree: 270,
      excessFree: 180,
      evaluated: 12,
    },
    {
      displayName: "순창",
      status: "unchanged",
      attractionCount: 6,
      totalFree: 530,
      maxFree: 210,
      excessFree: 120,
      evaluated: 6,
    },
  ]);
});

it("LG-2 실데이터 고양·문경 기존 관광 shift 회귀를 고정한다", () => {
  const result = searchPhaseTwo(
    seoulHistoryDay,
    "long-gap-shift-regression",
    "2026-09-14T00:00:00.000Z",
  );
  expect(result.kind).toBe("success");
  if (result.kind !== "success") return;
  const byName = new Map(
    result.candidates.map((candidate) => [
      candidate.displayName,
      createPlan(seoulHistoryDay, candidate, result.searchId),
    ]),
  );
  const goyang = enrichLongGaps(byName.get("고양")!);
  const mungyeong = enrichLongGaps(byName.get("문경")!);
  expect(goyang.status).toBe("applied");
  expect(mungyeong.status).toBe("applied");
  if (goyang.status !== "applied" || mungyeong.status !== "applied") return;
  expect(
    goyang.plan.blocks.find((block) => block.title.includes("행주산성"))
      ?.startAt,
  ).toBe("2026-09-12T14:15");
  expect(
    mungyeong.plan.blocks.find((block) => block.title.includes("운암사"))
      ?.startAt,
  ).toBe("2026-09-12T14:15");
  expect(goyang.summary.after.excessFreeMinutes).toBe(195);
  expect(mungyeong.summary.after.excessFreeMinutes).toBe(180);
});

it("LG-1/LG-3 150분 긴 여유에 가까운 60분 관광을 추가하고 원 구간 60분을 보존한다", () => {
  const plan = coordinatedFixture({ fixedStartAll: true });
  const before = longGapMetrics(plan);
  expect(before.maxFreeMinutes).toBeGreaterThan(120);
  const result = enrichLongGaps(plan);
  expect(result.status).toBe("applied");
  if (result.status !== "applied") return;
  expect(result.plan.longGapEnrichmentVersion).toBe("long-gap-v1");
  expect(result.plan.metrics.attractionCount).toBe(4);
  expect(result.summary.after.excessFreeMinutes).toBeLessThan(
    result.summary.before.excessFreeMinutes,
  );
  expect(
    result.summary.preservedTargets.every((target) =>
      result.summary.after.blocks.some(
        (block) =>
          block.day === target.day && overlapMinutes(block, target) >= 60,
      ),
    ),
  ).toBe(true);
});

it("LG-3 좌표가 멀면 후보를 제외하고 plan에 version/status를 남기지 않는다", () => {
  const plan = coordinatedFixture({
    farCandidate: true,
    fixedAll: true,
    fixedStartAll: true,
  });
  const result = enrichLongGaps(plan);
  expect(result.status).not.toBe("applied");
  expect(result.plan).toBe(plan);
  expect(result.plan.longGapEnrichmentVersion).toBeUndefined();
  expect(result.plan.longGapEnrichmentSummary).toBeUndefined();
});

it("LG-2 관광 추가 전에 같은 경계 안 기존 관광 재배치를 우선 적용한다", () => {
  const plan = coordinatedFixture({ farCandidate: true, fixedAll: true });
  const result = enrichLongGaps(plan);
  expect(result.status).toBe("applied");
  if (result.status !== "applied") return;
  expect(result.summary.addedAttractionCount).toBe(0);
  expect(result.summary.movedAttractionCount).toBeGreaterThan(0);
  expect(result.plan.metrics.attractionCount).toBe(3);
});

it("LG-2 총 8곳 한도에 도달해도 추가 없이 같은 경계 재배치를 실행한다", () => {
  const plan = totalEightRelocationFixture();
  expect(plan.metrics.attractionCount).toBe(8);
  const result = enrichLongGaps(plan);
  expect(result.status).toBe("applied");
  if (result.status !== "applied") return;
  expect(result.summary.addedAttractionCount).toBe(0);
  expect(result.summary.movedAttractionCount).toBeGreaterThan(0);
  expect(result.plan.metrics.attractionCount).toBe(8);
});

it("LG-2 개인 일정 경계를 넘는 관광 재배치는 거절한다", () => {
  const base = coordinatedFixture({ farCandidate: true });
  const [a, b, c] = base.blocks.filter((block) => block.kind === "attraction");
  const withBoundary = placed(base, [
    a,
    b,
    {
      id: "personal-boundary",
      day: 1,
      kind: "personal",
      title: "중간 약속",
      startAt: "2026-09-12T15:30",
      endAt: "2026-09-12T16:00",
      durationMinutes: 30,
      personal: {
        id: "personal-boundary",
        name: "중간 약속",
        category: "appointment",
        day: 1,
        durationMinutes: 30,
        address: "공주시 약속 장소",
      },
      reason: "사용자가 입력한 개인 일정",
    },
    c,
  ]);
  const result = enrichLongGaps(withBoundary);
  const checked = result.plan.blocks.find((block) => block.id === b.id);
  expect(checked?.endAt <= "2026-09-12T15:30").toBe(true);
});

it("LG-3 앞 날짜가 한도·고정으로 불가해도 다음 날짜의 가능한 보완을 계속 시도한다", () => {
  const plan = blockedFirstDaySecondDayInsertionFixture();
  const result = enrichLongGaps(plan);
  expect(result.status).toBe("applied");
  if (result.status !== "applied") return;
  expect(result.plan.blocks.some((block) => block.contentId === "D")).toBe(
    true,
  );
  expect(result.summary.addedAttractionCount).toBe(1);
});

it("LG-4 성공한 4곳 계획은 저장·복원되고 구 계획은 자동 전환되지 않는다", () => {
  const result = enrichLongGaps(coordinatedFixture({ fixedStartAll: true }));
  expect(result.status).toBe("applied");
  if (result.status !== "applied") return;
  expect(isSavedPlan(saved(result.plan))).toBe(true);
  expect(savePlan(result.plan).error).toBeUndefined();
  const restored = readSavedPlans().plans[0];
  expect(restored.longGapEnrichmentVersion).toBe("long-gap-v1");
  expect(
    restored.blocks.filter((block) => block.kind === "attraction"),
  ).toHaveLength(4);
});

function blockedFirstDaySecondDayInsertionFixture(): PlanSnapshot {
  const plan = coordinatedFixture({ fixedStartAll: true });
  const byId = new Map(
    plan.destination.attractions.map((place) => [place.contentId, place]),
  );
  byId.get("A")!.coordinates = { latitude: 36.46, longitude: 127.12 };
  byId.get("B")!.coordinates = { latitude: 36.461, longitude: 127.121 };
  byId.get("C")!.coordinates = { latitude: 37.46, longitude: 128.12 };
  byId.get("D")!.coordinates = { latitude: 37.461, longitude: 128.121 };
  const block = (
    id: string,
    day: 1 | 2,
    startAt: string,
    endAt: string,
    fixedStart = false,
  ) => ({
    id: `attraction-${id}`,
    day,
    startAt,
    endAt,
    kind: "attraction" as const,
    title: `관광 ${id}`,
    durationMinutes: 60 as const,
    contentId: id,
    attraction: byId.get(id)!,
    fixed: false,
    fixedStartAt: fixedStart ? startAt : undefined,
    reason: "테스트 배치 관광지",
  });
  return uncheckedPlaced(plan, [
    block("A", 1, "2026-09-12T12:45", "2026-09-12T13:45", true),
    block("B", 1, "2026-09-12T13:50", "2026-09-12T14:50", true),
    block("C", 2, "2026-09-13T07:00", "2026-09-13T08:00", true),
  ]);
}

function totalEightRelocationFixture(): PlanSnapshot {
  const result = searchPhaseTwo(
    seoulHistoryDay,
    "long-gap-total-eight",
    "2026-09-14T00:00:00.000Z",
  );
  expect(result.kind).toBe("success");
  if (result.kind !== "success") throw new Error("search failed");
  const candidate = result.candidates.find(
    (item) => item.displayName === "고양",
  )!;
  const plan = createPlan(seoulHistoryDay, candidate, result.searchId);
  const metrics = longGapMetrics(plan);
  plan.longGapEnrichmentVersion = "long-gap-v1";
  plan.longGapEnrichmentSummary = {
    addedAttractionCount: 2,
    movedAttractionCount: 0,
    remainingLongGapCount: 1,
    before: metrics,
    after: metrics,
    preservedTargets: [],
    performance: { evaluatedCandidates: 0, elapsedMs: 0, capped: false },
  };
  const used = new Set(
    plan.blocks.flatMap((block) => (block.contentId ? [block.contentId] : [])),
  );
  const unused = plan.destination.attractions
    .filter((place) => !used.has(place.contentId) && place.coordinates)
    .slice(0, 2);
  expect(unused).toHaveLength(2);
  const dummy = (
    place: (typeof unused)[number],
    day: 1 | 2,
    startAt: string,
    endAt: string,
  ) => ({
    id: `attraction-${place.contentId}`,
    day,
    startAt,
    endAt,
    kind: "attraction" as const,
    title: place.title,
    durationMinutes: 60 as const,
    contentId: place.contentId,
    attraction: place,
    fixed: false,
    reason: "테스트 배치 관광지",
  });
  const blocks = uncheckedPlaced(plan, [
    ...plan.blocks.filter((block) => block.kind === "attraction"),
    dummy(unused[0], 1, "2026-09-12T19:00", "2026-09-12T20:00"),
    dummy(unused[1], 2, "2026-09-13T14:00", "2026-09-13T15:00"),
  ]);
  return blocks;
}

function uncheckedPlaced(
  plan: PlanSnapshot,
  activities: PlanSnapshot["blocks"],
): PlanSnapshot {
  const fixed = plan.blocks.filter(
    (block) =>
      !["attraction", "personal", "free"].includes(block.kind) &&
      !block.localTravel,
  );
  const occupied = [...fixed, ...activities].toSorted((a, b) =>
    a.startAt.localeCompare(b.startAt),
  );
  for (const day of [1, 2] as const) {
    const places = occupied.filter(
      (block) => block.day === day && isLocalPlace(block),
    );
    for (let i = 1; i < places.length; i++) {
      const leg = localLeg(places[i - 1], places[i]);
      if (!leg.reservedMinutes) continue;
      const end = places[i].startAt;
      const start = new Date(
        Date.parse(`${end}:00+09:00`) -
          leg.reservedMinutes * 60_000 +
          9 * 3600_000,
      )
        .toISOString()
        .slice(0, 16);
      occupied.push({
        id: `unchecked-local-${day}-${i}`,
        day,
        startAt: start,
        endAt: end,
        kind: "travel",
        title: "현지 이동",
        durationMinutes: leg.reservedMinutes,
        localTravel: leg,
        reason: "테스트 연결 이동",
      });
    }
  }
  occupied.sort((a, b) => a.startAt.localeCompare(b.startAt));
  const blocks: PlanSnapshot["blocks"] = [];
  let cursor = plan.input.startAt;
  for (const block of occupied) {
    if (cursor < block.startAt)
      blocks.push({
        id: `unchecked-gap-${blocks.length}`,
        day: cursor.slice(0, 10) === plan.input.startAt.slice(0, 10) ? 1 : 2,
        startAt: cursor,
        endAt: block.startAt,
        kind: "free",
        title: "여유시간",
        durationMinutes:
          (Date.parse(`${block.startAt}+09:00`) -
            Date.parse(`${cursor}+09:00`)) /
          60_000,
        reason: "테스트 제어 여유시간",
      });
    blocks.push(block);
    cursor = block.endAt;
  }
  return {
    ...plan,
    blocks,
    metrics: planMetrics(
      plan.input,
      blocks,
      plan.metrics.arrivalAt,
      plan.metrics.returnDepartureAt,
    ),
  };
}

function coordinatedFixture(
  options: {
    farCandidate?: boolean;
    fixedAll?: boolean;
    fixedStartAll?: boolean;
  } = {},
): PlanSnapshot {
  const plan = fixture();
  const coordinates = {
    A: { latitude: 36.46, longitude: 127.12 },
    B: { latitude: 36.461, longitude: 127.121 },
    C: { latitude: 36.462, longitude: 127.122 },
    D: options.farCandidate
      ? { latitude: 37.7, longitude: 128.9 }
      : { latitude: 36.463, longitude: 127.123 },
  };
  for (const place of plan.destination.attractions) {
    place.coordinates =
      coordinates[place.contentId as keyof typeof coordinates];
    place.cat3 = `A02010${place.contentId}`;
    place.lclsSystm3 = `HS010${place.contentId}`;
  }
  for (const block of plan.blocks) {
    if (block.attraction)
      block.attraction =
        plan.destination.attractions.find(
          (place) => place.contentId === block.contentId,
        ) ?? block.attraction;
    if (options.fixedAll && block.kind === "attraction") block.fixed = true;
  }
  const attractions = plan.blocks.filter(
    (block) => block.kind === "attraction",
  );
  const [a, b, c] = attractions;
  const arranged = placed(plan, [
    {
      ...a,
      day: 1,
      startAt: "2026-09-12T12:45",
      endAt: "2026-09-12T13:45",
      attraction: plan.destination.attractions[0],
    },
    {
      ...b,
      day: 1,
      startAt: "2026-09-12T13:50",
      endAt: "2026-09-12T14:50",
      attraction: plan.destination.attractions[1],
    },
    {
      ...c,
      day: 2,
      startAt: "2026-09-13T07:00",
      endAt: "2026-09-13T08:00",
      attraction: plan.destination.attractions[2],
    },
  ]);
  return options.fixedStartAll
    ? {
        ...arranged,
        blocks: arranged.blocks.map((block) =>
          block.kind === "attraction"
            ? { ...block, fixedStartAt: block.startAt }
            : block,
        ),
      }
    : arranged;
}

function overlapMinutes(
  left: { startAt: string; endAt: string },
  right: { startAt: string; endAt: string },
): number {
  const start = Math.max(
    Date.parse(`${left.startAt}:00+09:00`),
    Date.parse(`${right.startAt}:00+09:00`),
  );
  const end = Math.min(
    Date.parse(`${left.endAt}:00+09:00`),
    Date.parse(`${right.endAt}:00+09:00`),
  );
  return Math.max(0, (end - start) / 60_000);
}
