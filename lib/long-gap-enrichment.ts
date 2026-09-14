import { isLocalPlace, localLeg } from "@/lib/local-travel-schedule";
import { planTimeError } from "@/lib/plan-time-constraints";
import {
  distanceKm,
  facilityGroups,
  planMetrics,
} from "@/lib/mvp-phase-two-planner";
import type {
  Attraction,
  LongGapBlockMetric,
  LongGapEnrichmentSummary,
  LongGapPlanMetrics,
  PlanSnapshot,
  TimeBlock,
  VisitDuration,
} from "@/lib/mvp-phase-two-types";

export const LONG_GAP_ENRICHMENT_VERSION = "long-gap-v1" as const;
const MINUTE = 60_000;
const TARGET_THRESHOLD_MINUTES = 120;
const PRESERVED_FREE_MINUTES = 60;
const VISIT_MINUTES = 60 as VisitDuration;
const MAX_DAILY_ATTRACTIONS = 4;
const MAX_TOTAL_ATTRACTIONS = 8;
const MAX_TIME_CANDIDATES = 96;
const MAX_ATTRACTION_CANDIDATES = 80;
const MAX_EVALUATIONS = 2000;
const MAX_ROUNDS = 8;

export type LongGapFailureReason =
  | "no-target-gap"
  | "no-improvement"
  | "candidate-missing"
  | "limit-reached"
  | "boundary-conflict"
  | "free-preservation-failed";
export type LongGapEnrichmentResult =
  | {
      status: "applied";
      plan: PlanSnapshot;
      summary: LongGapEnrichmentSummary;
    }
  | {
      status: "unchanged" | "failed";
      plan: PlanSnapshot;
      reason: LongGapFailureReason;
      summary: LongGapEnrichmentSummary;
    };
type CandidateAttempt = {
  attraction: Attraction;
  day: 1 | 2;
  target: LongGapBlockMetric;
  addedTravelMinutes: number;
  completeTravel: boolean;
};
type Evaluation = {
  plan: PlanSnapshot;
  attempt: CandidateAttempt;
  metrics: LongGapPlanMetrics;
  moved: number;
  changedStartCount: number;
  movementMinutes: number;
  finalStartAt: string;
};

const time = (value: string) => Date.parse(`${value}:00+09:00`);
const midnight = (plan: PlanSnapshot) =>
  time(`${plan.input.startAt.slice(0, 10)}T00:00`);
const minuteOf = (plan: PlanSnapshot, value: string) =>
  (time(value) - midnight(plan)) / MINUTE;
const stamp = (plan: PlanSnapshot, minute: number) =>
  new Date(midnight(plan) + minute * MINUTE + 9 * 3600_000)
    .toISOString()
    .slice(0, 16);
export function longGapMetrics(plan: PlanSnapshot): LongGapPlanMetrics {
  const blocks = mergeFreeBlocks(
    plan.blocks
      .filter((block) => block.kind === "free")
      .map((block) => ({
        day: block.day,
        startAt: block.startAt,
        endAt: block.endAt,
        durationMinutes: block.durationMinutes,
      })),
  );
  return {
    totalFreeMinutes: blocks.reduce(
      (sum, block) => sum + block.durationMinutes,
      0,
    ),
    maxFreeMinutes: Math.max(
      0,
      ...blocks.map((block) => block.durationMinutes),
    ),
    excessFreeMinutes: blocks.reduce(
      (sum, block) =>
        sum + Math.max(0, block.durationMinutes - TARGET_THRESHOLD_MINUTES),
      0,
    ),
    blocks,
  };
}

export function longGapTargets(plan: PlanSnapshot): LongGapBlockMetric[] {
  return longGapMetrics(plan).blocks.filter(
    (block) => block.durationMinutes > TARGET_THRESHOLD_MINUTES,
  );
}

export function enrichLongGaps(plan: PlanSnapshot): LongGapEnrichmentResult {
  const started =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const before = longGapMetrics(plan);
  const targets = longGapTargets(plan);
  let evaluatedCandidates = 0;
  let capped = false;
  const consumeEvaluation = () => {
    if (evaluatedCandidates >= MAX_EVALUATIONS) {
      capped = true;
      return false;
    }
    evaluatedCandidates++;
    return true;
  };
  const finish = (
    status: LongGapEnrichmentResult["status"],
    current: PlanSnapshot,
    reason?: LongGapFailureReason,
  ): LongGapEnrichmentResult => {
    const elapsedNow =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
    const after = longGapMetrics(current);
    const summary: LongGapEnrichmentSummary = {
      addedAttractionCount:
        current.blocks.filter((block) => block.kind === "attraction").length -
        plan.blocks.filter((block) => block.kind === "attraction").length,
      movedAttractionCount: movedAttractions(plan, current),
      remainingLongGapCount: longGapTargets(current).length,
      before,
      after,
      preservedTargets: targets,
      performance: {
        evaluatedCandidates,
        elapsedMs: Math.max(0, elapsedNow - started),
        capped,
      },
    };
    if (status === "applied") {
      const applied = {
        ...current,
        longGapEnrichmentVersion: LONG_GAP_ENRICHMENT_VERSION,
        longGapEnrichmentSummary: summary,
      };
      return { status, plan: applied, summary };
    }
    return { status, plan, reason: reason ?? "no-improvement", summary };
  };
  if (!targets.length) return finish("unchanged", plan, "no-target-gap");
  let current = plan;
  const blockedDays = new Set<1 | 2>();
  let unchangedReason: LongGapFailureReason = "no-improvement";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const activeDay = firstTargetDay(current, blockedDays);
    if (!activeDay) break;
    const activeTargets = longGapTargets(current).filter(
      (target) => target.day === activeDay,
    );
    const preservedTargets = targets.filter(
      (target) => target.day === activeDay,
    );
    const relocation = bestRelocation(
      current,
      activeTargets,
      preservedTargets,
      consumeEvaluation,
    );
    if (relocation) {
      current = relocation.plan;
      blockedDays.clear();
      if (!longGapTargets(current).length) break;
      continue;
    }
    const attempts = insertionAttempts(current, activeDay).slice(
      0,
      MAX_TIME_CANDIDATES,
    );
    if (!attempts.length) {
      unchangedReason =
        current.blocks.filter((block) => block.kind === "attraction").length >=
          MAX_TOTAL_ATTRACTIONS ||
        current.blocks.filter(
          (block) => block.day === activeDay && block.kind === "attraction",
        ).length >= MAX_DAILY_ATTRACTIONS
          ? "limit-reached"
          : "candidate-missing";
      blockedDays.add(activeDay);
      continue;
    }
    let best: Evaluation | null = null;
    for (const attempt of attempts) {
      if (!consumeEvaluation()) break;
      const evaluation = evaluateInsertion(
        current,
        attempt,
        activeTargets,
        preservedTargets,
      );
      if (!evaluation) continue;
      if (!best || betterEvaluation(evaluation, best, current))
        best = evaluation;
    }
    if (!best) {
      unchangedReason = "no-improvement";
      blockedDays.add(activeDay);
      if (capped) break;
      continue;
    }
    current = best.plan;
    blockedDays.clear();
    if (!longGapTargets(current).length) break;
  }
  if (current === plan || !improvesAnyTargetDay(plan, current, targets))
    return finish("unchanged", plan, unchangedReason);
  return finish("applied", current);
}

function firstTargetDay(
  plan: PlanSnapshot,
  blockedDays = new Set<1 | 2>(),
): 1 | 2 | null {
  return (
    longGapTargets(plan)
      .filter((target) => !blockedDays.has(target.day))
      .sort((a, b) => a.day - b.day || a.startAt.localeCompare(b.startAt))[0]
      ?.day ?? null
  );
}

function bestRelocation(
  plan: PlanSnapshot,
  targets: LongGapBlockMetric[],
  preservedTargets: LongGapBlockMetric[],
  onEvaluate: () => boolean,
): Evaluation | null {
  let best: Evaluation | null = null;
  for (const target of targets) {
    const free = plan.blocks.find(
      (block) =>
        block.kind === "free" &&
        block.day === target.day &&
        block.startAt === target.startAt &&
        block.endAt === target.endAt,
    );
    if (!free) continue;
    const movable = plan.blocks.filter(
      (block): block is TimeBlock & { kind: "attraction" } =>
        block.kind === "attraction" &&
        block.day === target.day &&
        !block.fixedStartAt &&
        (block.endAt <= free.startAt || block.startAt >= free.endAt),
    );
    for (const block of movable) {
      if (!onEvaluate()) return best;
      const evaluation = evaluateDirectMove(
        plan,
        block,
        free,
        preservedTargets,
      );
      if (!evaluation) continue;
      if (!best || betterEvaluation(evaluation, best, plan)) best = evaluation;
    }
  }
  return best;
}

function mergeFreeBlocks(blocks: LongGapBlockMetric[]): LongGapBlockMetric[] {
  const ordered = [...blocks].sort((a, b) =>
    a.startAt.localeCompare(b.startAt),
  );
  const merged: LongGapBlockMetric[] = [];
  for (const block of ordered) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.day === block.day &&
      previous.endAt === block.startAt
    ) {
      previous.endAt = block.endAt;
      previous.durationMinutes += block.durationMinutes;
    } else merged.push({ ...block });
  }
  return merged;
}

function movedAttractions(before: PlanSnapshot, after: PlanSnapshot): number {
  const starts = new Map(
    before.blocks
      .filter((block) => block.kind === "attraction" && block.contentId)
      .map((block) => [block.contentId!, block.startAt]),
  );
  return after.blocks.filter(
    (block) =>
      block.kind === "attraction" &&
      block.contentId &&
      starts.has(block.contentId) &&
      starts.get(block.contentId) !== block.startAt,
  ).length;
}

function insertionAttempts(
  plan: PlanSnapshot,
  targetDay: 1 | 2,
): CandidateAttempt[] {
  if (
    plan.blocks.filter((block) => block.kind === "attraction").length >=
    MAX_TOTAL_ATTRACTIONS
  )
    return [];
  const usedIds = new Set(
    plan.blocks
      .filter((block) => block.kind === "attraction" && block.contentId)
      .map((block) => block.contentId!),
  );
  const groups = facilityGroups(plan.destination.attractions);
  const usedGroups = new Set(
    [...usedIds].map((id) => groups.get(id)).filter(Boolean),
  );
  const dailyCounts = new Map<1 | 2, number>();
  for (const day of [1, 2] as const)
    dailyCounts.set(
      day,
      plan.blocks.filter(
        (block) => block.day === day && block.kind === "attraction",
      ).length,
    );
  const candidates = plan.destination.attractions.filter(
    (attraction) =>
      !usedIds.has(attraction.contentId) &&
      attraction.coordinates &&
      attraction.categories.some((category) =>
        plan.input.interests.includes(category),
      ) &&
      !usedGroups.has(groups.get(attraction.contentId)),
  );
  const attempts: CandidateAttempt[] = [];
  for (const day of [targetDay] as const) {
    if ((dailyCounts.get(day) ?? 0) >= MAX_DAILY_ATTRACTIONS) continue;
    const targets = longGapTargets(plan)
      .filter((target) => target.day === day)
      .sort(
        (a, b) =>
          b.durationMinutes - a.durationMinutes ||
          a.startAt.localeCompare(b.startAt),
      );
    const dayBlocks = plan.blocks
      .filter((block) => block.day === day)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    for (const attraction of candidates) {
      for (const target of targets) {
        const before = [...dayBlocks]
          .filter(
            (block) => isLocalPlace(block) && block.endAt <= target.startAt,
          )
          .at(-1);
        const after = dayBlocks.find(
          (block) => isLocalPlace(block) && block.startAt >= target.endAt,
        );
        const travel = insertionTravelMinutes(attraction, before, after);
        if (!travel.near) continue;
        attempts.push({
          attraction,
          day,
          target,
          addedTravelMinutes: travel.minutes,
          completeTravel: travel.complete,
        });
      }
    }
  }
  return attempts
    .toSorted(
      (a, b) =>
        b.target.durationMinutes - a.target.durationMinutes ||
        a.target.startAt.localeCompare(b.target.startAt) ||
        Number(b.completeTravel) - Number(a.completeTravel) ||
        a.addedTravelMinutes - b.addedTravelMinutes ||
        Number(hasUnusedDetailType(plan, b.attraction, b.day)) -
          Number(hasUnusedDetailType(plan, a.attraction, a.day)) ||
        a.attraction.contentId.localeCompare(b.attraction.contentId) ||
        a.day - b.day ||
        a.target.startAt.localeCompare(b.target.startAt),
    )
    .slice(0, MAX_ATTRACTION_CANDIDATES);
}

function insertionTravelMinutes(
  attraction: Attraction,
  before: TimeBlock | undefined,
  after: TimeBlock | undefined,
): { minutes: number; complete: boolean; near: boolean } {
  const shell = {
    id: `candidate-${attraction.contentId}`,
    day: 1 as const,
    startAt: "",
    endAt: "",
    kind: "attraction" as const,
    title: attraction.title,
    durationMinutes: VISIT_MINUTES,
    contentId: attraction.contentId,
    attraction,
    fixed: false,
    reason: "",
  };
  const neighborDistances = [before, after].flatMap((place) => {
    const coordinates =
      place?.attraction?.coordinates ?? place?.restaurant?.coordinates ?? null;
    const km = distanceKm(attraction.coordinates, coordinates);
    return km === null ? [] : [km];
  });
  const beforeLeg = before ? localLeg(before, shell) : null;
  const afterLeg = after ? localLeg(shell, after) : null;
  const oldLeg = before && after ? localLeg(before, after) : null;
  const estimates = [beforeLeg, afterLeg].flatMap((leg) =>
    leg?.status === "estimated" ? [leg.reservedMinutes] : [],
  );
  const delta =
    (beforeLeg?.reservedMinutes ?? 0) +
    (afterLeg?.reservedMinutes ?? 0) -
    (oldLeg?.reservedMinutes ?? 0);
  return {
    minutes: Math.max(0, delta),
    complete:
      estimates.length > 0 &&
      (!beforeLeg || beforeLeg.status === "estimated") &&
      (!afterLeg || afterLeg.status === "estimated"),
    near: neighborDistances.some((km) => km <= 5),
  };
}

function hasUnusedDetailType(
  plan: PlanSnapshot,
  attraction: Attraction,
  day: 1 | 2,
): boolean {
  const type =
    attraction.lclsSystm3 ||
    attraction.lclsSystm2 ||
    attraction.cat3 ||
    attraction.cat2;
  return !plan.blocks.some(
    (block) =>
      block.day === day &&
      block.kind === "attraction" &&
      (block.attraction?.lclsSystm3 ||
        block.attraction?.lclsSystm2 ||
        block.attraction?.cat3 ||
        block.attraction?.cat2) === type,
  );
}

function boundaryMarker(block: TimeBlock): boolean {
  return (
    block.kind === "personal" ||
    (block.kind === "meal" && block.mealScope === "local") ||
    Boolean(block.fixedStartAt)
  );
}

function boundarySegment(
  plan: PlanSnapshot,
  block: Pick<TimeBlock, "day" | "id" | "startAt" | "endAt">,
): string | null {
  const start = minuteOf(plan, block.startAt);
  const end = minuteOf(plan, block.endAt);
  const boundaries = plan.blocks
    .filter(
      (candidate) =>
        candidate.day === block.day &&
        candidate.id !== block.id &&
        boundaryMarker(candidate),
    )
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  if (
    boundaries.some((candidate) => {
      const boundaryStart = minuteOf(plan, candidate.startAt);
      const boundaryEnd = minuteOf(plan, candidate.endAt);
      return boundaryStart < end && boundaryEnd > start;
    })
  )
    return null;
  const previous = boundaries
    .filter((candidate) => minuteOf(plan, candidate.endAt) <= start)
    .at(-1);
  const next = boundaries.find(
    (candidate) => minuteOf(plan, candidate.startAt) >= end,
  );
  return `${block.day}:${previous?.id ?? "start"}:${next?.id ?? "end"}`;
}

function sameBoundarySegment(
  plan: PlanSnapshot,
  left: TimeBlock,
  right: TimeBlock,
): boolean {
  const leftSegment = boundarySegment(plan, left);
  const rightSegment = boundarySegment(plan, right);
  return Boolean(leftSegment && rightSegment && leftSegment === rightSegment);
}

function evaluateInsertion(
  plan: PlanSnapshot,
  attempt: CandidateAttempt,
  _targets: LongGapBlockMetric[],
  preservedTargets: LongGapBlockMetric[],
): Evaluation | null {
  return evaluateDirectInsertion(plan, attempt, preservedTargets);
}

function evaluateDirectInsertion(
  plan: PlanSnapshot,
  attempt: CandidateAttempt,
  preservedTargets: LongGapBlockMetric[],
): Evaluation | null {
  const target = attempt.target;
  const free = plan.blocks.find(
    (block) =>
      block.kind === "free" &&
      block.day === target.day &&
      block.startAt === target.startAt &&
      block.endAt === target.endAt,
  );
  if (!free) return null;
  const ordered = plan.blocks
    .filter((block) => block.day === target.day)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const beforePlace = [...ordered]
    .filter((block) => isLocalPlace(block) && block.endAt <= free.startAt)
    .at(-1);
  const afterPlace = ordered.find(
    (block) => isLocalPlace(block) && block.startAt >= free.endAt,
  );
  if (!beforePlace && !afterPlace) return null;
  const neighborDistances = [beforePlace, afterPlace].flatMap((place) => {
    const coordinates =
      place?.attraction?.coordinates ?? place?.restaurant?.coordinates ?? null;
    const km = distanceKm(attempt.attraction.coordinates, coordinates);
    return km === null ? [] : [km];
  });
  if (!neighborDistances.some((km) => km <= 5)) return null;
  const addedShell: TimeBlock = {
    id: `long-gap-attraction-${attempt.attraction.contentId}`,
    day: attempt.day,
    startAt: free.startAt,
    endAt: free.startAt,
    kind: "attraction",
    title: attempt.attraction.title,
    durationMinutes: VISIT_MINUTES,
    contentId: attempt.attraction.contentId,
    attraction: attempt.attraction,
    fixed: false,
    reason: "긴 여유시간 보완으로 추가한 공식 관심사 관광지",
  };
  const beforeLeg = beforePlace ? localLeg(beforePlace, addedShell) : null;
  const afterLeg = afterPlace ? localLeg(addedShell, afterPlace) : null;
  const beforeTravel = beforeLeg?.reservedMinutes ?? 0;
  const afterTravel = afterLeg?.reservedMinutes ?? 0;
  const availableEnd = afterPlace
    ? minuteOf(plan, afterPlace.startAt)
    : minuteOf(plan, free.endAt);
  const needed =
    PRESERVED_FREE_MINUTES + beforeTravel + VISIT_MINUTES + afterTravel;
  if (availableEnd - minuteOf(plan, free.startAt) < needed) return null;
  const freeStart = minuteOf(plan, free.startAt);
  const firstFreeEnd = freeStart + PRESERVED_FREE_MINUTES;
  const attractionStart = firstFreeEnd + beforeTravel;
  const attractionEnd = attractionStart + VISIT_MINUTES;
  const afterTravelEnd = attractionEnd + afterTravel;
  const replacement: TimeBlock[] = [
    {
      ...free,
      id: `${free.id}-preserved`,
      endAt: stamp(plan, firstFreeEnd),
      durationMinutes: PRESERVED_FREE_MINUTES,
    },
  ];
  if (beforeLeg && beforeTravel > 0)
    replacement.push({
      id: `local-travel-${attempt.day}-${beforeLeg.fromId}-${addedShell.id}`,
      day: attempt.day,
      startAt: stamp(plan, firstFreeEnd),
      endAt: stamp(plan, attractionStart),
      kind: "travel",
      title:
        beforeLeg.status === "estimated"
          ? "장소 간 예상 이동"
          : "이동시간 확인 전 · 15분 확보",
      durationMinutes: beforeTravel,
      localTravel: { ...beforeLeg, toId: addedShell.id },
      reason:
        beforeLeg.status === "estimated"
          ? "직선거리 기준 추정 · 실제 도로 시간과 다를 수 있어요."
          : "장소 또는 좌표가 미확정이라 이동시간을 확인하지 못했어요. 15분은 임시로 확보한 시간이에요.",
    });
  replacement.push({
    ...addedShell,
    startAt: stamp(plan, attractionStart),
    endAt: stamp(plan, attractionEnd),
  });
  if (afterLeg && afterTravel > 0)
    replacement.push({
      id: `local-travel-${attempt.day}-${addedShell.id}-${afterLeg.toId}`,
      day: attempt.day,
      startAt: stamp(plan, attractionEnd),
      endAt: stamp(plan, afterTravelEnd),
      kind: "travel",
      title:
        afterLeg.status === "estimated"
          ? "장소 간 예상 이동"
          : "이동시간 확인 전 · 15분 확보",
      durationMinutes: afterTravel,
      localTravel: { ...afterLeg, fromId: addedShell.id },
      reason:
        afterLeg.status === "estimated"
          ? "직선거리 기준 추정 · 실제 도로 시간과 다를 수 있어요."
          : "장소 또는 좌표가 미확정이라 이동시간을 확인하지 못했어요. 15분은 임시로 확보한 시간이에요.",
    });
  if (afterTravelEnd < availableEnd)
    replacement.push({
      ...free,
      id: `${free.id}-remaining`,
      startAt: stamp(plan, afterTravelEnd),
      endAt: stamp(plan, availableEnd),
      durationMinutes: availableEnd - afterTravelEnd,
    });
  const removedConnection = new Set<string>();
  if (beforePlace && afterPlace) {
    for (const block of plan.blocks) {
      if (
        block.localTravel?.fromId === beforePlace.id &&
        block.localTravel.toId === afterPlace.id
      )
        removedConnection.add(block.id);
    }
  }
  const blocks = plan.blocks
    .flatMap((block) => {
      if (block.id === free.id) return replacement;
      if (removedConnection.has(block.id)) return [];
      return [block];
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const next: PlanSnapshot = {
    ...plan,
    blocks,
    metrics: planMetrics(
      plan.input,
      blocks,
      plan.metrics.arrivalAt,
      plan.metrics.returnDepartureAt,
    ),
    edited: true,
    updatedAt: new Date().toISOString(),
    itineraryRuleVersion: "e4-v2",
    localTravelVersion: "straight-line-v1",
  };
  const error = planTimeError(next, false);
  if (
    error ||
    !withinLongGapLimits(next) ||
    !preservesOriginalTargets(
      next,
      preservedTargets.filter((block) => block.day === attempt.day),
    )
  )
    return null;
  const metrics = longGapMetrics(next);
  if (!improvesDay(plan, next, attempt.day)) return null;
  return {
    plan: next,
    attempt,
    metrics,
    moved: movedAttractions(plan, next),
    ...evaluationDetails(plan, next, attempt),
  };
}

function evaluateDirectMove(
  plan: PlanSnapshot,
  source: TimeBlock & { kind: "attraction" },
  free: TimeBlock,
  targets: LongGapBlockMetric[],
): Evaluation | null {
  if (!source.attraction) return null;
  if (!sameBoundarySegment(plan, source, free)) return null;
  const shift = evaluateBoundaryShift(plan, source, free, targets);
  if (shift) return shift;
  const ordered = plan.blocks
    .filter((block) => block.day === free.day)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const withoutSource = ordered.filter((block) => block.id !== source.id);
  const beforePlace = [...withoutSource]
    .filter((block) => isLocalPlace(block) && block.endAt <= free.startAt)
    .at(-1);
  const afterPlace = withoutSource.find(
    (block) => isLocalPlace(block) && block.startAt >= free.endAt,
  );
  if (!beforePlace && !afterPlace) return null;
  const beforeLeg = beforePlace ? localLeg(beforePlace, source) : null;
  const afterLeg = afterPlace ? localLeg(source, afterPlace) : null;
  const beforeTravel = beforeLeg?.reservedMinutes ?? 0;
  const afterTravel = afterLeg?.reservedMinutes ?? 0;
  const availableEnd = afterPlace
    ? minuteOf(plan, afterPlace.startAt)
    : minuteOf(plan, free.endAt);
  const freeStart = minuteOf(plan, free.startAt);
  const earliestMovedStart = freeStart + PRESERVED_FREE_MINUTES + beforeTravel;
  const latestMovedStart =
    availableEnd -
    PRESERVED_FREE_MINUTES -
    afterTravel -
    source.durationMinutes;
  const originalStart = minuteOf(plan, source.startAt);
  const movedStart = [...new Set([earliestMovedStart, latestMovedStart])]
    .filter((start) => {
      const movedEnd = start + source.durationMinutes;
      const beforeFreeMinutes = start - beforeTravel - freeStart;
      const afterFreeMinutes = availableEnd - (movedEnd + afterTravel);
      return (
        start >= freeStart + beforeTravel &&
        movedEnd + afterTravel <= availableEnd &&
        Math.max(beforeFreeMinutes, afterFreeMinutes) >= PRESERVED_FREE_MINUTES
      );
    })
    .sort(
      (a, b) => Math.abs(a - originalStart) - Math.abs(b - originalStart),
    )[0];
  if (movedStart === undefined) return null;
  const firstFreeEnd = movedStart - beforeTravel;
  const movedEnd = movedStart + source.durationMinutes;
  const afterTravelEnd = movedEnd + afterTravel;
  const moved = {
    ...source,
    startAt: stamp(plan, movedStart),
    endAt: stamp(plan, movedEnd),
    reason: `${source.reason} · 긴 여유시간 보완으로 시간 조정`,
  };
  const replacement: TimeBlock[] = [];
  if (firstFreeEnd > freeStart)
    replacement.push({
      ...free,
      id: `${free.id}-preserved`,
      endAt: stamp(plan, firstFreeEnd),
      durationMinutes: firstFreeEnd - freeStart,
    });
  if (beforeLeg && beforeTravel > 0)
    replacement.push({
      id: `local-travel-${free.day}-${beforeLeg.fromId}-${source.id}`,
      day: free.day,
      startAt: stamp(plan, firstFreeEnd),
      endAt: stamp(plan, movedStart),
      kind: "travel",
      title:
        beforeLeg.status === "estimated"
          ? "장소 간 예상 이동"
          : "이동시간 확인 전 · 15분 확보",
      durationMinutes: beforeTravel,
      localTravel: { ...beforeLeg, toId: source.id },
      reason:
        beforeLeg.status === "estimated"
          ? "직선거리 기준 추정 · 실제 도로 시간과 다를 수 있어요."
          : "장소 또는 좌표가 미확정이라 이동시간을 확인하지 못했어요. 15분은 임시로 확보한 시간이에요.",
    });
  replacement.push(moved);
  if (afterLeg && afterTravel > 0)
    replacement.push({
      id: `local-travel-${free.day}-${source.id}-${afterLeg.toId}`,
      day: free.day,
      startAt: stamp(plan, movedEnd),
      endAt: stamp(plan, afterTravelEnd),
      kind: "travel",
      title:
        afterLeg.status === "estimated"
          ? "장소 간 예상 이동"
          : "이동시간 확인 전 · 15분 확보",
      durationMinutes: afterTravel,
      localTravel: { ...afterLeg, fromId: source.id },
      reason:
        afterLeg.status === "estimated"
          ? "직선거리 기준 추정 · 실제 도로 시간과 다를 수 있어요."
          : "장소 또는 좌표가 미확정이라 이동시간을 확인하지 못했어요. 15분은 임시로 확보한 시간이에요.",
    });
  if (afterTravelEnd < availableEnd)
    replacement.push({
      ...free,
      id: `${free.id}-remaining`,
      startAt: stamp(plan, afterTravelEnd),
      endAt: stamp(plan, availableEnd),
      durationMinutes: availableEnd - afterTravelEnd,
    });
  const removedIds = new Set<string>([source.id]);
  let removedStart = source.startAt;
  let removedEnd = source.endAt;
  for (const block of plan.blocks) {
    if (
      block.localTravel?.fromId === source.id ||
      block.localTravel?.toId === source.id
    ) {
      removedIds.add(block.id);
      if (block.endAt <= source.startAt) {
        if (block.startAt < removedStart) removedStart = block.startAt;
      }
      if (block.startAt < free.startAt && block.endAt > removedEnd)
        removedEnd = block.endAt;
    }
  }
  const freed: TimeBlock = {
    id: `free-relocated-${source.id}`,
    day: source.day,
    startAt: removedStart,
    endAt: removedEnd,
    kind: "free",
    title: "여유시간",
    durationMinutes: (time(removedEnd) - time(removedStart)) / MINUTE,
    reason: "긴 여유시간 보완으로 비운 시간",
  };
  let freedInserted = false;
  const blocks = plan.blocks
    .flatMap((block) => {
      if (block.id === free.id) return replacement;
      if (removedIds.has(block.id)) {
        if (freedInserted) return [];
        freedInserted = true;
        return [freed];
      }
      return [block];
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const next: PlanSnapshot = {
    ...plan,
    blocks,
    metrics: planMetrics(
      plan.input,
      blocks,
      plan.metrics.arrivalAt,
      plan.metrics.returnDepartureAt,
    ),
    edited: true,
    updatedAt: new Date().toISOString(),
    itineraryRuleVersion: "e4-v2",
    localTravelVersion: "straight-line-v1",
  };
  const error = planTimeError(next, false);
  if (
    error ||
    !withinLongGapLimits(next) ||
    !preservesOriginalTargets(
      next,
      targets.filter((block) => block.day === free.day),
    )
  )
    return null;
  const metrics = longGapMetrics(next);
  if (!improvesDay(plan, next, free.day)) return null;
  const attempt = {
    attraction: source.attraction,
    day: source.day,
    target: {
      day: free.day,
      startAt: free.startAt,
      endAt: free.endAt,
      durationMinutes: free.durationMinutes,
    },
    addedTravelMinutes: beforeTravel + afterTravel,
    completeTravel:
      (!beforeLeg || beforeLeg.status === "estimated") &&
      (!afterLeg || afterLeg.status === "estimated"),
  };
  return {
    plan: next,
    attempt,
    metrics,
    moved: movedAttractions(plan, next),
    ...evaluationDetails(plan, next, attempt),
  };
}

function evaluateBoundaryShift(
  plan: PlanSnapshot,
  source: TimeBlock & { kind: "attraction" },
  free: TimeBlock,
  targets: LongGapBlockMetric[],
): Evaluation | null {
  if (!source.attraction || source.endAt > free.startAt) return null;
  const between = plan.blocks.some(
    (block) =>
      block.day === source.day &&
      block.id !== source.id &&
      block.id !== free.id &&
      isLocalPlace(block) &&
      block.startAt >= source.endAt &&
      block.endAt <= free.startAt,
  );
  if (between) return null;
  const ordered = plan.blocks
    .filter((block) => block.day === source.day)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const beforePlace = [...ordered]
    .filter(
      (block) =>
        isLocalPlace(block) &&
        block.id !== source.id &&
        block.endAt <= source.startAt,
    )
    .at(-1);
  const afterPlace = ordered.find(
    (block) => isLocalPlace(block) && block.startAt >= free.endAt,
  );
  const beforeLeg = beforePlace ? localLeg(beforePlace, source) : null;
  const afterLeg = afterPlace ? localLeg(source, afterPlace) : null;
  const beforeTravel = beforeLeg?.reservedMinutes ?? 0;
  const afterTravel = afterLeg?.reservedMinutes ?? 0;
  const sourceStart = minuteOf(plan, source.startAt);
  const freeEnd = minuteOf(plan, free.endAt);
  const availableEnd = afterPlace
    ? minuteOf(plan, afterPlace.startAt)
    : freeEnd;
  const latestStart =
    availableEnd -
    afterTravel -
    PRESERVED_FREE_MINUTES -
    source.durationMinutes;
  if (latestStart <= sourceStart) return null;
  const candidates = new Set<number>([latestStart]);
  for (
    let start = Math.ceil((sourceStart + 1) / 15) * 15;
    start <= latestStart;
    start += 15
  )
    candidates.add(start);
  let best: Evaluation | null = null;
  for (const movedStart of [...candidates].sort((a, b) => a - b)) {
    const movedEnd = movedStart + source.durationMinutes;
    const afterTravelEnd = movedEnd + afterTravel;
    if (afterTravelEnd > availableEnd) continue;
    const preservedStart = Math.max(
      afterTravelEnd,
      minuteOf(plan, free.startAt),
    );
    if (availableEnd - preservedStart < PRESERVED_FREE_MINUTES) continue;
    const moved: TimeBlock = {
      ...source,
      startAt: stamp(plan, movedStart),
      endAt: stamp(plan, movedEnd),
      reason: `${source.reason} · 긴 여유시간 보완으로 시간 조정`,
    };
    const removedIds = new Set<string>([source.id, free.id]);
    let rangeStart = source.startAt;
    for (const block of plan.blocks) {
      if (
        block.localTravel?.fromId === source.id ||
        block.localTravel?.toId === source.id
      ) {
        removedIds.add(block.id);
        if (block.endAt <= source.startAt && block.startAt < rangeStart)
          rangeStart = block.startAt;
      }
    }
    for (const block of plan.blocks) {
      if (
        (block.kind === "free" || block.localTravel) &&
        block.day === source.day &&
        block.startAt < (afterPlace?.startAt ?? free.endAt) &&
        block.endAt > rangeStart
      )
        removedIds.add(block.id);
    }
    const replacement: TimeBlock[] = [];
    const replacementStart = minuteOf(plan, rangeStart);
    const beforeTravelStart = movedStart - beforeTravel;
    if (beforeTravelStart > replacementStart)
      replacement.push({
        id: `free-shifted-${source.id}`,
        day: source.day,
        startAt: stamp(plan, replacementStart),
        endAt: stamp(plan, beforeTravelStart),
        kind: "free",
        title: "여유시간",
        durationMinutes: beforeTravelStart - replacementStart,
        reason: "긴 여유시간 보완으로 비운 시간",
      });
    if (beforeLeg && beforeTravel > 0)
      replacement.push({
        id: `local-travel-${source.day}-${beforeLeg.fromId}-${source.id}`,
        day: source.day,
        startAt: stamp(plan, beforeTravelStart),
        endAt: stamp(plan, movedStart),
        kind: "travel",
        title:
          beforeLeg.status === "estimated"
            ? "장소 간 예상 이동"
            : "이동시간 확인 전 · 15분 확보",
        durationMinutes: beforeTravel,
        localTravel: { ...beforeLeg, toId: source.id },
        reason:
          beforeLeg.status === "estimated"
            ? "직선거리 기준 추정 · 실제 도로 시간과 다를 수 있어요."
            : "장소 또는 좌표가 미확정이라 이동시간을 확인하지 못했어요. 15분은 임시로 확보한 시간이에요.",
      });
    replacement.push(moved);
    if (afterLeg && afterTravel > 0)
      replacement.push({
        id: `local-travel-${source.day}-${source.id}-${afterLeg.toId}`,
        day: source.day,
        startAt: stamp(plan, movedEnd),
        endAt: stamp(plan, afterTravelEnd),
        kind: "travel",
        title:
          afterLeg.status === "estimated"
            ? "장소 간 예상 이동"
            : "이동시간 확인 전 · 15분 확보",
        durationMinutes: afterTravel,
        localTravel: { ...afterLeg, fromId: source.id },
        reason:
          afterLeg.status === "estimated"
            ? "직선거리 기준 추정 · 실제 도로 시간과 다를 수 있어요."
            : "장소 또는 좌표가 미확정이라 이동시간을 확인하지 못했어요. 15분은 임시로 확보한 시간이에요.",
      });
    if (afterTravelEnd < availableEnd)
      replacement.push({
        id: `${free.id}-remaining`,
        day: source.day,
        startAt: stamp(plan, afterTravelEnd),
        endAt: stamp(plan, availableEnd),
        kind: "free",
        title: "여유시간",
        durationMinutes: availableEnd - afterTravelEnd,
        reason: "긴 여유시간 보완 후 남긴 여유예요.",
      });
    let inserted = false;
    const blocks = plan.blocks
      .flatMap((block) => {
        if (removedIds.has(block.id)) {
          if (inserted) return [];
          inserted = true;
          return replacement;
        }
        return [block];
      })
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    const next: PlanSnapshot = {
      ...plan,
      blocks,
      metrics: planMetrics(
        plan.input,
        blocks,
        plan.metrics.arrivalAt,
        plan.metrics.returnDepartureAt,
      ),
      edited: true,
      updatedAt: new Date().toISOString(),
      itineraryRuleVersion: "e4-v2",
      localTravelVersion: "straight-line-v1",
    };
    if (
      planTimeError(next, false) ||
      !withinLongGapLimits(next) ||
      !preservesOriginalTargets(
        next,
        targets.filter((target) => target.day === free.day),
      ) ||
      !improvesDay(plan, next, free.day)
    )
      continue;
    const attempt: CandidateAttempt = {
      attraction: source.attraction,
      day: source.day,
      target: {
        day: free.day,
        startAt: free.startAt,
        endAt: free.endAt,
        durationMinutes: free.durationMinutes,
      },
      addedTravelMinutes: beforeTravel + afterTravel,
      completeTravel:
        (!beforeLeg || beforeLeg.status === "estimated") &&
        (!afterLeg || afterLeg.status === "estimated"),
    };
    const evaluation: Evaluation = {
      plan: next,
      attempt,
      metrics: longGapMetrics(next),
      moved: movedAttractions(plan, next),
      ...evaluationDetails(plan, next, attempt),
    };
    if (!best || betterEvaluation(evaluation, best, plan)) best = evaluation;
  }
  return best;
}

function withinLongGapLimits(plan: PlanSnapshot): boolean {
  if (
    plan.blocks.filter((block) => block.kind === "attraction").length >
    MAX_TOTAL_ATTRACTIONS
  )
    return false;
  return [1, 2].every(
    (day) =>
      plan.blocks.filter(
        (block) => block.day === day && block.kind === "attraction",
      ).length <= MAX_DAILY_ATTRACTIONS,
  );
}

function preservesOriginalTargets(
  plan: PlanSnapshot,
  targets: LongGapBlockMetric[],
): boolean {
  for (const target of targets) {
    const start = minuteOf(plan, target.startAt);
    const end = minuteOf(plan, target.endAt);
    const contained = mergeFreeBlocks(
      plan.blocks
        .filter((block) => block.kind === "free" && block.day === target.day)
        .flatMap((block) => {
          const blockStart = minuteOf(plan, block.startAt);
          const blockEnd = minuteOf(plan, block.endAt);
          const overlapStart = Math.max(start, blockStart);
          const overlapEnd = Math.min(end, blockEnd);
          return overlapEnd > overlapStart
            ? [
                {
                  day: target.day,
                  startAt: stamp(plan, overlapStart),
                  endAt: stamp(plan, overlapEnd),
                  durationMinutes: overlapEnd - overlapStart,
                },
              ]
            : [];
        }),
    );
    if (
      !contained.some(
        (block) => block.durationMinutes >= PRESERVED_FREE_MINUTES,
      )
    )
      return false;
  }
  return [1, 2].every((day) => {
    const hasTarget = targets.some((target) => target.day === day);
    if (!hasTarget) return true;
    return (
      plan.blocks
        .filter((block) => block.day === day && block.kind === "free")
        .reduce((sum, block) => sum + block.durationMinutes, 0) >=
      PRESERVED_FREE_MINUTES
    );
  });
}

function dayMetrics(plan: PlanSnapshot, day: 1 | 2): LongGapPlanMetrics {
  const blocks = longGapMetrics(plan).blocks.filter(
    (block) => block.day === day,
  );
  return {
    totalFreeMinutes: blocks.reduce(
      (sum, block) => sum + block.durationMinutes,
      0,
    ),
    maxFreeMinutes: Math.max(
      0,
      ...blocks.map((block) => block.durationMinutes),
    ),
    excessFreeMinutes: blocks.reduce(
      (sum, block) =>
        sum + Math.max(0, block.durationMinutes - TARGET_THRESHOLD_MINUTES),
      0,
    ),
    blocks,
  };
}

function improvesDay(
  before: PlanSnapshot,
  after: PlanSnapshot,
  day: 1 | 2,
): boolean {
  const beforeDay = dayMetrics(before, day);
  const afterDay = dayMetrics(after, day);
  return (
    afterDay.excessFreeMinutes < beforeDay.excessFreeMinutes ||
    (afterDay.excessFreeMinutes === beforeDay.excessFreeMinutes &&
      afterDay.maxFreeMinutes < beforeDay.maxFreeMinutes)
  );
}

function improvesAnyTargetDay(
  before: PlanSnapshot,
  after: PlanSnapshot,
  targets: LongGapBlockMetric[],
): boolean {
  return [...new Set(targets.map((target) => target.day))].some((day) =>
    improvesDay(before, after, day),
  );
}

function evaluationDetails(
  before: PlanSnapshot,
  after: PlanSnapshot,
  attempt: CandidateAttempt,
): Pick<Evaluation, "changedStartCount" | "movementMinutes" | "finalStartAt"> {
  let changedStartCount = 0;
  let movementMinutes = 0;
  for (const previous of before.blocks.filter(
    (block) => block.kind === "attraction" || block.kind === "personal",
  )) {
    const current = after.blocks.find((block) => block.id === previous.id);
    if (!current) continue;
    if (current.startAt === previous.startAt) continue;
    changedStartCount++;
    movementMinutes += Math.abs(
      minuteOf(before, current.startAt) - minuteOf(before, previous.startAt),
    );
  }
  const target =
    after.blocks.find(
      (block) =>
        block.kind === "attraction" &&
        block.contentId === attempt.attraction.contentId,
    ) ??
    after.blocks.find(
      (block) =>
        block.id === `long-gap-attraction-${attempt.attraction.contentId}`,
    );
  if (target && !before.blocks.some((block) => block.id === target.id))
    changedStartCount++;
  return {
    changedStartCount,
    movementMinutes,
    finalStartAt: target?.startAt ?? "",
  };
}

function betterEvaluation(
  left: Evaluation,
  right: Evaluation,
  base: PlanSnapshot,
): boolean {
  const before = dayMetrics(base, left.attempt.day);
  const leftDay = dayMetrics(left.plan, left.attempt.day);
  const rightDay = dayMetrics(right.plan, right.attempt.day);
  const leftDelta = before.excessFreeMinutes - leftDay.excessFreeMinutes;
  const rightDelta = before.excessFreeMinutes - rightDay.excessFreeMinutes;
  if (leftDelta !== rightDelta) return leftDelta > rightDelta;
  const leftMax = before.maxFreeMinutes - leftDay.maxFreeMinutes;
  const rightMax = before.maxFreeMinutes - rightDay.maxFreeMinutes;
  if (leftMax !== rightMax) return leftMax > rightMax;
  if (left.changedStartCount !== right.changedStartCount)
    return left.changedStartCount < right.changedStartCount;
  if (left.movementMinutes !== right.movementMinutes)
    return left.movementMinutes < right.movementMinutes;
  const timeOrder = left.finalStartAt.localeCompare(right.finalStartAt);
  if (timeOrder) return timeOrder < 0;
  const travel =
    left.attempt.addedTravelMinutes - right.attempt.addedTravelMinutes;
  if (travel) return travel < 0;
  return (
    left.attempt.attraction.contentId.localeCompare(
      right.attempt.attraction.contentId,
    ) < 0
  );
}

export function hasSuccessfulLongGapEnrichment(plan: PlanSnapshot): boolean {
  return (
    plan.longGapEnrichmentVersion === LONG_GAP_ENRICHMENT_VERSION &&
    Boolean(plan.longGapEnrichmentSummary)
  );
}
