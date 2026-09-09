import {
  placeActivities,
  type PlacementActivity,
  type PlacementInterval,
} from "@/lib/activity-placement";

/** Deliberately independent oracle: enumerate every complete placement and
 * sort explicit score tuples, without using the production DP/comparator. */
function exhaustive(
  activities: PlacementActivity[],
  intervals: PlacementInterval[],
): number[] | null {
  if (
    intervals.reduce(
      (sum, interval) => sum + interval.end - interval.start,
      0,
    ) -
      activities.reduce((sum, activity) => sum + activity.duration, 0) <
    30
  )
    return null;
  const solutions: { starts: number[]; cost: number[] }[] = [];
  const visit = (starts: number[], previousInterval: number) => {
    if (starts.length === activities.length) {
      let retained = 0,
        movement = 0;
      activities.forEach((activity, index) => {
        if (activity.preserveStart && activity.originalStart === starts[index])
          retained++;
        if (activity.originalStart !== undefined)
          movement += Math.abs(starts[index] - activity.originalStart);
      });
      solutions.push({
        starts: [...starts],
        cost: [-retained, movement, ...starts],
      });
      return;
    }
    const index = starts.length,
      activity = activities[index];
    intervals.forEach((interval, intervalIndex) => {
      if (intervalIndex < previousInterval) return;
      for (
        let start = interval.start;
        start + activity.duration <= interval.end;
        start++
      ) {
        if (activity.fixedStart !== undefined && start !== activity.fixedStart)
          continue;
        if (
          index &&
          intervalIndex === previousInterval &&
          start < starts[index - 1] + activities[index - 1].duration + 15
        )
          continue;
        visit([...starts, start], intervalIndex);
      }
    });
  };
  visit([], 0);
  solutions.sort((a, b) => {
    for (let i = 0; i < a.cost.length; i++)
      if (a.cost[i] !== b.cost[i]) return a.cost[i] - b.cost[i];
    return 0;
  });
  return solutions[0]?.starts ?? null;
}

describe("R4 분 단위 배치 최적성", () => {
  it("일반·고정·편집대상·새 항목과 식사로 분리한 구간을 독립 전수 탐색과 비교한다", () => {
    for (let seed = 0; seed < 32; seed++) {
      const intervals =
        seed % 2
          ? [
              { start: 421, end: 501 },
              { start: 561, end: 611 },
            ]
          : [{ start: 421, end: 561 }];
      const activities: PlacementActivity[] = [
        {
          duration: 30,
          originalStart: 430 + (seed % 9),
          preserveStart: seed % 3 !== 0,
        },
        {
          duration: 30,
          originalStart: seed % 5 === 0 ? undefined : 476 + (seed % 7),
          preserveStart: true,
        },
      ];
      if (seed % 4 === 0) activities[1].fixedStart = 491 + (seed % 3);
      if (seed % 4 === 1)
        activities.push({
          duration: 30,
          originalStart: 575,
          preserveStart: true,
        });
      expect({ seed, starts: placeActivities(activities, intervals) }).toEqual({
        seed,
        starts: exhaustive(activities, intervals),
      });
    }
  });

  it("새 항목의 임시 시각은 보존 점수나 이동 비용을 만들지 않는다", () => {
    const activities: PlacementActivity[] = [
      { duration: 30, preserveStart: false },
      { duration: 30, originalStart: 510, preserveStart: true },
    ];
    expect(placeActivities(activities, [{ start: 420, end: 570 }])).toEqual([
      420, 510,
    ]);
  });

  it("관광 3개와 개인 4개의 최악 크기도 분 단위 고정을 유지하며 제한 시간 안에 탐색한다", () => {
    const activities = Array.from({ length: 7 }, (_, index) => ({
      duration: 30,
      originalStart: 450 + index * 45,
      preserveStart: index !== 0,
      fixedStart: index === 6 ? 901 : undefined,
    }));
    const started = performance.now();
    const result = placeActivities(activities, [
      { start: 420, end: 690 },
      { start: 750, end: 1050 },
      { start: 1110, end: 1260 },
    ]);
    expect(result).not.toBeNull();
    expect(result![6]).toBe(901);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
