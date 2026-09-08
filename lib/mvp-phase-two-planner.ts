import { INTERESTS, ORIGINS } from "@/lib/mvp-phase-two-types";
import type {
  Attraction,
  Candidate,
  Coordinates,
  EditCommand,
  EditResult,
  PlanMetrics,
  PlanSnapshot,
  ScheduleResult,
  SearchInput,
  TimeBlock,
  Visit,
} from "@/lib/mvp-phase-two-types";

const MINUTE = 60_000;
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .replace(/[^\p{L}\p{N}]/gu, "");
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function parseLocalDate(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
  )
    return null;
  const time = Date.parse(`${value}:00+09:00`);
  if (
    !Number.isFinite(time) ||
    new Date(time + 9 * 60 * MINUTE).toISOString().slice(0, 16) !== value
  )
    return null;
  return time;
}
export function validateSearchInput(
  value: unknown,
): { ok: true; input: SearchInput } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("출발지, 자차, 1박 2일 일정과 관심사를 입력해 주세요.");
  const input = value as Record<string, unknown>;
  if (
    !ORIGINS.some((origin) => origin.id === input.originId) ||
    input.transport !== "car"
  )
    return fail("서울 또는 부산 출발·자차 여행만 지원해요.");
  if (
    !Array.isArray(input.interests) ||
    input.interests.length < 1 ||
    input.interests.length > 5 ||
    !input.interests.every((id) =>
      INTERESTS.some((interest) => interest.id === id),
    ) ||
    new Set(input.interests).size !== input.interests.length
  )
    return fail("지원하는 관심사를 한 개 이상 선택해 주세요.");
  const start = parseLocalDate(input.startAt),
    end = parseLocalDate(input.returnBy);
  if (start === null || end === null)
    return fail("올바른 출발·복귀 날짜와 시각을 입력해 주세요.");
  const startDay = Math.floor((start + 9 * 60 * MINUTE) / (1440 * MINUTE));
  const endDay = Math.floor((end + 9 * 60 * MINUTE) / (1440 * MINUTE));
  if (endDay - startDay !== 1)
    return fail("복귀 날짜는 출발 날짜의 다음날로 입력해 주세요.");
  return {
    ok: true,
    input: {
      originId: input.originId as SearchInput["originId"],
      startAt: input.startAt as string,
      returnBy: input.returnBy as string,
      transport: "car",
      interests: input.interests as SearchInput["interests"],
    },
  };
}

export function distanceKm(
  a: Coordinates | null,
  b: Coordinates | null,
): number | null {
  if (!a || !b) return null;
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
const detailCategory = (place: Attraction) =>
  place.cat3 || place.cat2 || place.categories.join("+");
export function distinctAttractions(places: Attraction[]): Attraction[] {
  const result: Attraction[] = [],
    seen = new Set<string>();
  const groups = new Map<string, Attraction[]>();
  for (const place of [...places].sort((a, b) =>
    compareId(a.contentId, b.contentId),
  )) {
    if (seen.has(place.contentId)) continue;
    seen.add(place.contentId);
    const title = normalize(place.title),
      address = normalize(place.address);
    const key = `${title}|${address}`;
    const similar = groups.get(key) ?? [];
    if (
      title &&
      address &&
      similar.some((other) => {
        const distance = distanceKm(place.coordinates, other.coordinates);
        return distance !== null && distance <= 0.1;
      })
    )
      continue;
    result.push(place);
    similar.push(place);
    groups.set(key, similar);
  }
  return result;
}
function weakDuplicate(a: Attraction, b: Attraction): number {
  const distance = distanceKm(a.coordinates, b.coordinates);
  const first = normalize(a.title),
    second = normalize(b.title);
  const commonWord = a.title
    .split(/\s|[()[\]]/u)
    .some((word) => normalize(word).length >= 2 && b.title.includes(word));
  return distance !== null &&
    distance <= 0.3 &&
    !!normalize(a.address) &&
    normalize(a.address) === normalize(b.address) &&
    ((first.length >= 2 && second.includes(first)) ||
      (second.length >= 2 && first.includes(second)) ||
      commonWord)
    ? 1
    : 0;
}
function selectPlaces(
  places: Attraction[],
  interests: SearchInput["interests"],
  counts: [number, number],
): Attraction[] {
  const selected: Attraction[] = [],
    used = new Set<string>(),
    covered = new Set<string>();
  const rarity = new Map<string, number>();
  places.forEach((place) =>
    rarity.set(
      detailCategory(place),
      (rarity.get(detailCategory(place)) ?? 0) + 1,
    ),
  );
  for (const count of counts) {
    const dayCategories = new Set<string>();
    let previous: Attraction | undefined;
    for (let index = 0; index < count; index++) {
      const missing = (place: Attraction) =>
        place.categories.filter(
          (id) => interests.includes(id) && !covered.has(id),
        ).length;
      const ordered = places
        .filter((place) => !used.has(place.contentId))
        .sort((a, b) => {
          const interest = missing(b) - missing(a);
          if (interest) return interest;
          if (!previous)
            return (
              (rarity.get(detailCategory(a)) ?? 0) -
                (rarity.get(detailCategory(b)) ?? 0) ||
              compareId(a.contentId, b.contentId)
            );
          return (
            weakDuplicate(previous, a) - weakDuplicate(previous, b) ||
            Number(dayCategories.has(detailCategory(a))) -
              Number(dayCategories.has(detailCategory(b))) ||
            (distanceKm(previous.coordinates, a.coordinates) ?? Infinity) -
              (distanceKm(previous.coordinates, b.coordinates) ?? Infinity) ||
            compareId(a.contentId, b.contentId)
          );
        });
      const place = ordered[0];
      if (!place) break;
      selected.push(place);
      used.add(place.contentId);
      place.categories.forEach((id) => covered.add(id));
      dayCategories.add(detailCategory(place));
      previous = place;
    }
  }
  return selected;
}

type Interval = { start: number; end: number };
type Meal = Interval & { day: 1 | 2; type: "lunch" | "dinner"; id: string };
type Layout = {
  meals: Meal[];
  arrival: number;
  departure: number;
  drives: Array<Interval & { direction: "outbound" | "return" }>;
  gaps: [Interval[], Interval[]];
  localMeals: Set<string>;
};
/** Request-owned: identical input/one-way layouts are reused across regional candidates. */
export type SchedulingCache = Map<string, Layout[]>;
function minuteOf(value: string): number {
  return Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
}
function stamp(input: SearchInput, minute: number): string {
  return new Date(
    Date.parse(`${input.startAt.slice(0, 10)}T00:00:00+09:00`) +
      (minute + 540) * MINUTE,
  )
    .toISOString()
    .slice(0, 16);
}
// A meal is required only when a complete hour in its window is in the trip.
export function tripMealWindows(input: SearchInput) {
  const start = minuteOf(input.startAt),
    end = 1440 + minuteOf(input.returnBy);
  return [690, 1050, 2130, 2490].flatMap((base, index) => {
    const starts = [base, base + 30, base + 60].filter(
      (time) => time >= start && time + 60 <= end,
    );
    return starts.length
      ? [
          {
            starts,
            day: (index < 2 ? 1 : 2) as 1 | 2,
            type: (index % 2 === 0 ? "lunch" : "dinner") as "lunch" | "dinner",
            id: `meal-${index < 2 ? 1 : 2}-${index % 2 === 0 ? "lunch" : "dinner"}`,
          },
        ]
      : [];
  });
}

export function localRestIntervals(
  arrival: number,
  departure: number,
): Interval[] {
  return [
    { start: 0, end: 420 },
    { start: 1260, end: 1860 },
    { start: 2700, end: 2880 },
  ]
    .map((period) => ({
      start: Math.max(arrival, period.start),
      end: Math.min(departure, period.end),
    }))
    .filter((period) => period.end > period.start);
}
function driveBoundary(
  anchor: number,
  minutes: number,
  meals: Meal[],
  backward: boolean,
): { boundary: number; intervals: Interval[] } {
  let cursor = anchor,
    remaining = minutes;
  const intervals: Interval[] = [];
  const ordered = backward ? [...meals].reverse() : meals;
  for (const meal of ordered) {
    if ((!backward && meal.end <= cursor) || (backward && meal.start >= cursor))
      continue;
    const available = backward ? cursor - meal.end : meal.start - cursor;
    if (available >= remaining) break;
    if (available > 0) {
      intervals.push(
        backward
          ? { start: meal.end, end: cursor }
          : { start: cursor, end: meal.start },
      );
      remaining -= available;
    }
    cursor = backward ? meal.start : meal.end;
  }
  if (remaining > 0)
    intervals.push(
      backward
        ? { start: cursor - remaining, end: cursor }
        : { start: cursor, end: cursor + remaining },
    );
  return { boundary: cursor + (backward ? -remaining : remaining), intervals };
}
function layouts(input: SearchInput, oneWay: number): Layout[] {
  const start = minuteOf(input.startAt),
    end = 1440 + minuteOf(input.returnBy),
    result: Layout[] = [];
  const combinations = tripMealWindows(input).reduce<Meal[][]>(
    (previous, window) =>
      previous.flatMap((meals) =>
        window.starts.map((time) => [
          ...meals,
          {
            start: time,
            end: time + 60,
            day: window.day,
            type: window.type,
            id: window.id,
          },
        ]),
      ),
    [[]],
  );
  for (const meals of combinations) {
    const outgoing = driveBoundary(start, oneWay, meals, false),
      returning = driveBoundary(end, oneWay, meals, true);
    const arrival = outgoing.boundary,
      departure = returning.boundary;
    if (arrival >= departure) continue;
    const localMeals = new Set(
      meals
        .filter((meal) => meal.start >= arrival && meal.end <= departure)
        .map((meal) => meal.id),
    );
    const gaps: [Interval[], Interval[]] = [[], []];
    for (const day of [0, 1] as const) {
      const lower = Math.max(arrival, day * 1440 + 420),
        upper = Math.min(departure, day * 1440 + 1260);
      let cursor = lower;
      for (const meal of meals.filter(
        (item) =>
          item.day === day + 1 &&
          localMeals.has(item.id) &&
          item.start >= lower &&
          item.end <= upper,
      )) {
        if (meal.start > cursor)
          gaps[day].push({ start: cursor, end: meal.start });
        cursor = meal.end;
      }
      if (upper > cursor) gaps[day].push({ start: cursor, end: upper });
    }
    result.push({
      meals,
      arrival,
      departure,
      localMeals,
      gaps,
      drives: [
        ...outgoing.intervals.map((interval) => ({
          ...interval,
          direction: "outbound" as const,
        })),
        ...returning.intervals.map((interval) => ({
          ...interval,
          direction: "return" as const,
        })),
      ],
    });
  }
  return result;
}
function fit(gaps: Interval[], durations: number[]): Interval[] | null {
  if (durations.length === 0) return [];
  if (
    gaps.reduce((sum, gap) => sum + gap.end - gap.start, 0) -
      durations.reduce((sum, duration) => sum + duration, 0) <
    30
  )
    return null;
  const result: Interval[] = [];
  let gapIndex = 0,
    cursor = gaps[0]?.start ?? 0;
  for (const duration of durations) {
    while (gapIndex < gaps.length && cursor + duration > gaps[gapIndex].end) {
      gapIndex++;
      cursor = gaps[gapIndex]?.start ?? 0;
    }
    if (gapIndex >= gaps.length) return null;
    result.push({ start: cursor, end: cursor + duration });
    cursor += duration;
  }
  return result;
}
export function planMetrics(
  input: SearchInput,
  blocks: TimeBlock[],
  arrivalAt: string,
  returnDepartureAt: string,
): PlanMetrics {
  const attractions = blocks.filter((block) => block.kind === "attraction");
  const distances: number[] = [];
  for (const day of [1, 2]) {
    const daily = attractions.filter((block) => block.day === day);
    for (let i = 1; i < daily.length; i++) {
      const distance = distanceKm(
        daily[i - 1].attraction?.coordinates ?? null,
        daily[i].attraction?.coordinates ?? null,
      );
      if (distance !== null) distances.push(distance);
    }
  }
  return {
    arrivalAt,
    returnDepartureAt,
    localMinutes: blocks
      .filter(
        (block) =>
          block.kind === "attraction" ||
          block.kind === "free" ||
          (block.kind === "meal" && block.mealScope === "local"),
      )
      .reduce((sum, block) => sum + block.durationMinutes, 0),
    freeMinutes: blocks
      .filter((block) => block.kind === "free")
      .reduce((sum, block) => sum + block.durationMinutes, 0),
    attractionCount: attractions.length,
    localMealCount: blocks.filter((block) => block.mealScope === "local")
      .length,
    fulfilledInterests: input.interests.filter((interest) =>
      attractions.some((block) =>
        block.attraction?.categories.includes(interest),
      ),
    ),
    categoryDiversity: new Set(
      attractions.map((block) =>
        block.attraction ? detailCategory(block.attraction) : "",
      ),
    ).size,
    averageDistanceKm: distances.length
      ? distances.reduce((a, b) => a + b, 0) / distances.length
      : null,
  };
}

/** The same layout engine serves search, previews and retained-place editing. */
export function scheduleTrip(
  input: SearchInput,
  oneWay: number,
  pool: Attraction[],
  retained?: Visit[],
  requiredLocalMeals: string[] = [],
  timingCache?: SchedulingCache,
): ScheduleResult {
  if (!validateSearchInput(input).ok || !Number.isFinite(oneWay) || oneWay <= 0)
    return {
      ok: false,
      reason: "출발·복귀 입력과 지역 간 일반 예상시간을 확인해 주세요.",
    };
  const places = distinctAttractions(pool);
  if (!retained && places.length < 3)
    return {
      ok: false,
      reason: "선택 관심사의 서로 다른 관광지를 3곳 이상 찾지 못했어요.",
    };
  const selections = new Map<string, Attraction[]>();
  const timingKey = `${input.startAt}|${input.returnBy}|${oneWay}`;
  const timingLayouts = timingCache?.get(timingKey) ?? layouts(input, oneWay);
  timingCache?.set(timingKey, timingLayouts);
  let best: {
    layout: Layout;
    slots: [Interval[], Interval[]];
    visits: Visit[];
    count: number;
  } | null = null;
  for (const layout of timingLayouts) {
    if (requiredLocalMeals.some((id) => !layout.localMeals.has(id))) continue;
    for (let first = 0; first <= 3; first++)
      for (let second = 0; second <= 3; second++) {
        const count = first + second;
        if (
          retained
            ? count !== retained.length
            : count < 3 || count > places.length
        )
          continue;
        if (
          best &&
          (count < best.count ||
            (count === best.count &&
              layout.localMeals.size <= best.layout.localMeals.size))
        )
          continue;
        const firstDurations = retained
          ? retained.slice(0, first).map((visit) => visit.durationMinutes)
          : Array<number>(first).fill(60);
        const secondDurations = retained
          ? retained.slice(first).map((visit) => visit.durationMinutes)
          : Array<number>(second).fill(60);
        const firstSlots = fit(layout.gaps[0], firstDurations),
          secondSlots = fit(layout.gaps[1], secondDurations);
        if (!firstSlots || !secondSlots) continue;
        const key = `${first}:${second}`;
        let selected = selections.get(key);
        if (!retained && !selected) {
          selected = selectPlaces(places, input.interests, [first, second]);
          selections.set(key, selected);
        }
        const visits: Visit[] =
          retained ??
          (selected ?? []).map((attraction) => ({
            attraction,
            durationMinutes: 60,
            fixed: false,
          }));
        best = { layout, slots: [firstSlots, secondSlots], visits, count };
      }
  }
  if (!best)
    return {
      ok: false,
      reason:
        "왕복 이동과 여행 중 식사, 07:00~21:00 관광 및 관광하는 날의 30분 여유를 함께 확보할 수 없어요. 출발을 앞당기거나 복귀를 늦춰 주세요.",
    };
  const { layout, slots, visits } = best,
    blocks: TimeBlock[] = [];
  const block = (
    interval: Interval,
    props: Omit<TimeBlock, "day" | "startAt" | "endAt" | "durationMinutes">,
  ): TimeBlock => ({
    ...props,
    day: interval.start < 1440 ? 1 : 2,
    startAt: stamp(input, interval.start),
    endAt: stamp(input, interval.end),
    durationMinutes: interval.end - interval.start,
  });
  layout.drives.forEach((interval, index) =>
    blocks.push(
      block(interval, {
        id: `travel-${interval.direction}-${index}`,
        kind: "travel",
        title:
          interval.direction === "outbound" ? "여행지로 이동" : "출발지로 복귀",
        direction: interval.direction,
        reason: "KTDB 자동차 일반 예상 이동시간 · 식사 시간 별도",
      }),
    ),
  );
  layout.meals.forEach((meal) =>
    blocks.push(
      block(meal, {
        id: meal.id,
        kind: "meal",
        title: layout.localMeals.has(meal.id)
          ? "추천할 식당을 더 찾지 못했어요"
          : "이동 중 자유 식사",
        mealScope: layout.localMeals.has(meal.id) ? "local" : "transit",
        mealType: meal.type,
        reason: layout.localMeals.has(meal.id)
          ? "현지 식사 60분 · 운영정보 방문 전 확인"
          : "운전을 멈추고 식사하는 60분 · 식당 추천 대상 밖",
      }),
    ),
  );
  localRestIntervals(layout.arrival, layout.departure).forEach(
    (interval, index) =>
      blocks.push(
        block(interval, {
          id: `overnight-rest-${index}`,
          kind: "rest",
          title: "휴식",
          reason: "관광하지 않는 야간 현지 휴식 · 지역 간 이동은 야간에도 가능",
        }),
      ),
  );
  let visitIndex = 0;
  for (const day of [0, 1] as const) {
    for (const slot of slots[day]) {
      const visit = visits[visitIndex++];
      blocks.push(
        block(slot, {
          id: `attraction-${visit.attraction.contentId}`,
          kind: "attraction",
          title: visit.attraction.title,
          contentId: visit.attraction.contentId,
          attraction: visit.attraction,
          fixed: visit.fixed,
          reason:
            "공식 관심사 분류 · 주변 장소를 함께 구성 · 내부 이동시간 미계산",
        }),
      );
    }
    for (const gap of layout.gaps[day]) {
      let cursor = gap.start;
      for (const slot of slots[day].filter(
        (slot) => slot.start >= gap.start && slot.end <= gap.end,
      )) {
        if (slot.start > cursor)
          blocks.push(
            block(
              { start: cursor, end: slot.start },
              {
                id: `free-${cursor}`,
                kind: "free",
                title: "자유시간",
                reason: "현지 여유시간",
              },
            ),
          );
        cursor = slot.end;
      }
      if (cursor < gap.end)
        blocks.push(
          block(
            { start: cursor, end: gap.end },
            {
              id: `free-${cursor}`,
              kind: "free",
              title: "자유시간",
              reason: "현지 여유시간",
            },
          ),
        );
    }
  }
  blocks.sort((a, b) => compareId(a.startAt, b.startAt));
  return {
    ok: true,
    blocks,
    metrics: planMetrics(
      input,
      blocks,
      stamp(input, layout.arrival),
      stamp(input, layout.departure),
    ),
  };
}
export function createPlan(
  input: SearchInput,
  candidate: Candidate,
  searchId: string,
): PlanSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id: `${searchId}:${candidate.groupId}`,
    searchId,
    createdAt: now,
    updatedAt: now,
    edited: false,
    input,
    destination: candidate,
    blocks: candidate.preview.blocks.map((block) => ({ ...block })),
    metrics: { ...candidate.preview.metrics },
  };
}
export function attractionAlternatives(
  plan: PlanSnapshot,
  blockId: string,
): Attraction[] {
  const target = plan.blocks.find((block) => block.id === blockId);
  if (!target || target.kind !== "attraction" || target.fixed) return [];
  const used = new Set(
    plan.blocks
      .filter((block) => block.kind === "attraction")
      .map((block) => block.contentId),
  );
  return plan.destination.attractions.filter(
    (place) =>
      !used.has(place.contentId) &&
      place.categories.some((interest) =>
        plan.input.interests.includes(interest),
      ),
  );
}
export function editPlan(plan: PlanSnapshot, command: EditCommand): EditResult {
  const fail = (reason: string): EditResult => ({ ok: false, plan, reason });
  const target = plan.blocks.find((block) => block.id === command.blockId);
  if (!target || target.kind !== "attraction" || !target.attraction)
    return fail("수정할 관광지를 찾지 못했어요.");
  if (
    target.fixed &&
    (command.type === "replace-attraction" ||
      command.type === "delete-attraction")
  )
    return fail("고정을 해제한 뒤 교체하거나 삭제해 주세요.");
  let blocks: TimeBlock[],
    metrics = plan.metrics;
  if (command.type === "toggle-fixed")
    blocks = plan.blocks.map((block) =>
      block.id === target.id ? { ...block, fixed: !block.fixed } : block,
    );
  else if (command.type === "delete-attraction") {
    blocks = plan.blocks.map((block) =>
      block.id === target.id
        ? {
            id: `deleted-${block.id}`,
            day: block.day,
            startAt: block.startAt,
            endAt: block.endAt,
            kind: "free",
            title: "자유시간",
            durationMinutes: block.durationMinutes,
            reason: "관광지 삭제로 남겨 둔 자유시간",
          }
        : block,
    );
    metrics = planMetrics(
      plan.input,
      blocks,
      metrics.arrivalAt,
      metrics.returnDepartureAt,
    );
  } else {
    if (
      command.type === "duration" &&
      ![30, 60, 90, 120].includes(command.durationMinutes)
    )
      return fail("방문시간은 30/60/90/120분 중 선택해 주세요.");
    const replacement =
      command.type === "replace-attraction"
        ? attractionAlternatives(plan, target.id).find(
            (place) => place.contentId === command.contentId,
          )
        : undefined;
    if (command.type === "replace-attraction" && !replacement)
      return fail("같은 지역의 미사용 대체 관광지를 선택해 주세요.");
    const visits: Visit[] = plan.blocks
      .filter((block) => block.kind === "attraction" && block.attraction)
      .map((block) => ({
        attraction:
          block.id === target.id && replacement
            ? replacement
            : block.attraction!,
        durationMinutes: (block.id === target.id && command.type === "duration"
          ? command.durationMinutes
          : block.durationMinutes) as Visit["durationMinutes"],
        fixed: block.fixed ?? false,
      }));
    const selectedMeals = plan.blocks.filter((block) => block.restaurant);
    const result = scheduleTrip(
      plan.input,
      plan.destination.oneWayMinutes,
      plan.destination.attractions,
      visits,
      selectedMeals.map((block) => block.id),
    );
    if (!result.ok) return fail(result.reason);
    blocks = result.blocks.map((block) => {
      const previous = selectedMeals.find((meal) => meal.id === block.id);
      return previous && block.mealScope === "local"
        ? {
            ...block,
            restaurant: previous.restaurant,
            contentId: previous.contentId,
            title: previous.title,
          }
        : block;
    });
    metrics = result.metrics;
  }
  return {
    ok: true,
    plan: {
      ...plan,
      blocks,
      metrics,
      edited: true,
      updatedAt: new Date().toISOString(),
    },
  };
}
