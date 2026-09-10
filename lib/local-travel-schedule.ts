import { placeActivities } from "./activity-placement";
import { estimateLocalTravel, type LocalTravelLeg } from "./local-travel-time";
import { localActivityWindow } from "./plan-time-constraints";
import type { SearchInput, TimeBlock } from "./mvp-phase-two-types";

const epoch = (s: string) => Date.parse(`${s}:00+09:00`);
const base = (input: SearchInput) =>
  epoch(`${input.startAt.slice(0, 10)}T00:00`);
const minute = (input: SearchInput, s: string) =>
  (epoch(s) - base(input)) / 60_000;
const stamp = (input: SearchInput, m: number) =>
  new Date(base(input) + m * 60_000 + 9 * 3600_000).toISOString().slice(0, 16);
export const isLocalPlace = (b: TimeBlock) =>
  b.kind === "attraction" ||
  b.kind === "personal" ||
  (b.kind === "meal" && b.mealScope === "local");
const coords = (b: TimeBlock) =>
  b.attraction?.coordinates ?? b.restaurant?.coordinates ?? null;
export function localLeg(from: TimeBlock, to: TimeBlock): LocalTravelLeg {
  return {
    ...estimateLocalTravel(coords(from), coords(to)),
    fromId: from.id,
    toId: to.id,
  };
}
function merges(activities: TimeBlock[], meals: TimeBlock[]): TimeBlock[][] {
  if (!activities.length) return [meals];
  if (!meals.length) return [activities];
  return [
    ...merges(activities.slice(1), meals).map((rest) => [
      activities[0],
      ...rest,
    ]),
    ...merges(activities, meals.slice(1)).map((rest) => [meals[0], ...rest]),
  ];
}
function less(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** Meals stay fixed. Ordered activities may move around them, but are never
 * deleted/replaced. Every adjacent same-day place reserves one connection. */
export function scheduleLocalDay(
  input: SearchInput,
  blocks: TimeBlock[],
  day: 1 | 2,
  arrivalAt: string,
  departureAt: string,
  options: { original?: TimeBlock[]; targetId?: string; fast?: boolean } = {},
): TimeBlock[] | null {
  const window = localActivityWindow(
    day,
    minute(input, arrivalAt),
    minute(input, departureAt),
  );
  if (window.end <= window.start) return [];
  const activities = blocks.filter(
    (b) => b.day === day && (b.kind === "attraction" || b.kind === "personal"),
  );
  const meals = blocks
    .filter(
      (b) => b.day === day && b.kind === "meal" && b.mealScope === "local",
    )
    .toSorted((a, b) => a.startAt.localeCompare(b.startAt));
  const free = activities.length ? 30 : 0;
  let best:
    | {
        sequence: TimeBlock[];
        starts: number[];
        legs: LocalTravelLeg[];
        score: number[];
      }
    | undefined;
  for (const sequence of merges(activities, meals)) {
    const legs = sequence.slice(1).map((b, i) => localLeg(sequence[i], b));
    const travelMinutes = legs.reduce((sum, l) => sum + l.reservedMinutes, 0);
    if (
      window.end -
        window.start -
        sequence.reduce((sum, b) => sum + b.durationMinutes, 0) -
        travelMinutes <
      free
    )
      continue;
    const placement = sequence.map((b, i) => {
      const previous = options.original?.find((item) => item.id === b.id);
      return {
        duration: b.durationMinutes,
        originalStart: previous ? minute(input, previous.startAt) : undefined,
        preserveStart: Boolean(
          previous && b.id !== options.targetId && b.kind !== "meal",
        ),
        fixedStart:
          b.kind === "meal"
            ? minute(input, b.startAt)
            : b.fixedStartAt
              ? minute(input, b.fixedStartAt)
              : undefined,
        gapBefore: i ? legs[i - 1].reservedMinutes : 0,
      };
    });
    let starts: number[] | null;
    if (options.fast) {
      starts = [];
      let cursor = window.start;
      for (const p of placement) {
        cursor += p.gapBefore;
        const start = p.fixedStart ?? cursor;
        if (start < cursor || start + p.duration > window.end) {
          starts = null;
          break;
        }
        starts.push(start);
        cursor = start + p.duration;
      }
    } else starts = placeActivities(placement, [window], free + travelMinutes);
    if (!starts) continue;
    let retained = 0,
      movement = 0;
    placement.forEach((p, i) => {
      if (p.preserveStart && p.originalStart === starts![i]) retained++;
      if (p.originalStart !== undefined)
        movement += Math.abs(p.originalStart - starts![i]);
    });
    const score = [-retained, movement, ...starts];
    if (!best || less(score, best.score))
      best = { sequence, starts, legs, score };
  }
  if (!best) return null;
  const result: TimeBlock[] = [];
  let cursor = window.start;
  const addFree = (end: number) => {
    if (end > cursor)
      result.push({
        id: `free-${day}-${cursor}`,
        day,
        startAt: stamp(input, cursor),
        endAt: stamp(input, end),
        kind: "free",
        title: "여유시간",
        durationMinutes: end - cursor,
        reason: "이동시간과 별도로 사용할 수 있는 여유예요.",
      });
    cursor = end;
  };
  best.sequence.forEach((b, i) => {
    const start = best.starts[i],
      leg = i ? best.legs[i - 1] : undefined;
    addFree(start - (leg?.reservedMinutes ?? 0));
    if (leg && leg.reservedMinutes > 0)
      result.push({
        id: `local-travel-${day}-${leg.fromId}-${leg.toId}`,
        day,
        startAt: stamp(input, cursor),
        endAt: stamp(input, start),
        kind: "travel",
        title:
          leg.status === "estimated"
            ? "장소 간 예상 이동"
            : "이동시간 확인 전 · 15분 확보",
        durationMinutes: leg.reservedMinutes,
        localTravel: leg,
        reason:
          leg.status === "estimated"
            ? "직선거리 기준 추정 · 실제 도로 시간과 다를 수 있어요."
            : "장소 또는 좌표가 미확정이라 이동시간을 확인하지 못했어요. 15분은 임시로 확보한 시간이에요.",
      });
    result.push({
      ...b,
      startAt: stamp(input, start),
      endAt: stamp(input, start + b.durationMinutes),
    });
    cursor = start + b.durationMinutes;
  });
  addFree(window.end);
  return result;
}
