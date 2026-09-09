export type PlacementActivity = {
  duration: number;
  /** Absent for newly added activities: no invented prior time to preserve. */
  originalStart?: number;
  preserveStart: boolean;
  fixedStart?: number;
};
export type PlacementInterval = { start: number; end: number };
type State = {
  end: number;
  interval: number;
  retained: number;
  movement: number;
  starts: number[];
};

function better(
  left: State | undefined,
  right: State | undefined,
): State | undefined {
  if (!left) return right;
  if (!right) return left;
  if (left.retained !== right.retained)
    return left.retained > right.retained ? left : right;
  if (left.movement !== right.movement)
    return left.movement < right.movement ? left : right;
  for (let index = 0; index < left.starts.length; index++) {
    if (left.starts[index] !== right.starts[index])
      return left.starts[index] < right.starts[index] ? left : right;
  }
  return left;
}

/** Exact minute-resolution DP. For each activity/end minute we keep the best
 * prefix: all future feasibility depends only on that end and its interval.
 * Prefix maxima reduce transitions to O(activity count × available minutes),
 * rather than enumerating Cartesian products of every possible start. */
export function placeActivities(
  activities: PlacementActivity[],
  intervals: PlacementInterval[],
): number[] | null {
  if (!activities.length) return [];
  if (
    intervals.reduce(
      (sum, interval) => sum + interval.end - interval.start,
      0,
    ) -
      activities.reduce((sum, activity) => sum + activity.duration, 0) <
    30
  )
    return null;
  let states: State[] = [];
  for (let index = 0; index < activities.length; index++) {
    const activity = activities[index];
    const next: State[] = [];
    let earlier: State | undefined;
    for (
      let intervalIndex = 0;
      intervalIndex < intervals.length;
      intervalIndex++
    ) {
      if (intervalIndex > 0)
        for (const state of states.filter(
          (state) => state.interval === intervalIndex - 1,
        ))
          earlier = better(earlier, state);
      const previous = states.filter(
        (state) => state.interval === intervalIndex,
      );
      let cursor = 0;
      let prefix = earlier;
      const interval = intervals[intervalIndex];
      for (
        let start = Math.ceil(interval.start);
        start + activity.duration <= interval.end;
        start++
      ) {
        while (cursor < previous.length && previous[cursor].end + 15 <= start)
          prefix = better(prefix, previous[cursor++]);
        if (activity.fixedStart !== undefined && start !== activity.fixedStart)
          continue;
        if (index > 0 && !prefix) continue;
        next.push({
          end: start + activity.duration,
          interval: intervalIndex,
          starts: [...(prefix?.starts ?? []), start],
          retained:
            (prefix?.retained ?? 0) +
            Number(activity.preserveStart && activity.originalStart === start),
          movement:
            (prefix?.movement ?? 0) +
            (activity.originalStart === undefined
              ? 0
              : Math.abs(activity.originalStart - start)),
        });
      }
    }
    states = next;
    if (!states.length) return null;
  }
  return (
    states.reduce<State | undefined>(
      (best, state) => better(best, state),
      undefined,
    )?.starts ?? null
  );
}
