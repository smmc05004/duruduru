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
const normalizeFacilityAddress = (text: string) =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .replace(/\s*-\s*/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
export const E2_ITINERARY_ALGORITHM_VERSION = "e2-v1" as const;
const GENERIC_FACILITY_TOKENS = new Set(
  [
    "관광지",
    "박물관",
    "미술관",
    "문화재",
    "기념관",
    "전시관",
    "공원",
    "유적지",
    "전망대",
    "체험관",
    "문화센터",
  ].map(normalize),
);
export type FacilityCorrection = {
  contentIds: readonly [string, string];
  disposition: "same-facility" | "independent";
  evidence: string;
  verifiedAt: string;
};
/** Only reviewed pairs belong here. An empty list is intentionally the default. */
export const FACILITY_CORRECTIONS: readonly FacilityCorrection[] = [];
const isConfirmedFacilityGroup = (groupId: string | undefined) =>
  groupId?.startsWith("facility-confirmed-") ?? false;

function facilityTokens(title: string): string[] {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .split(/[^\p{L}\p{N}]+/gu)
    .map(normalize)
    .filter(
      (token) =>
        Array.from(token).length >= 3 && !GENERIC_FACILITY_TOKENS.has(token),
    );
}
function facilitySignal(left: Attraction, right: Attraction): boolean {
  const leftAddress = normalizeFacilityAddress(left.address);
  const rightAddress = normalizeFacilityAddress(right.address);
  const distance = distanceKm(left.coordinates, right.coordinates);
  if (
    !leftAddress ||
    leftAddress !== rightAddress ||
    distance === null ||
    distance > 0.3
  )
    return false;
  const rightTokens = new Set(facilityTokens(right.title));
  return facilityTokens(left.title).some((token) => rightTokens.has(token));
}
/**
 * Conservative, client-safe grouping signal. It keeps original attractions and
 * checks a new member against the representative and every current member.
 */
export function facilityGroups(
  places: Attraction[],
  corrections: readonly FacilityCorrection[] = FACILITY_CORRECTIONS,
): Map<string, string> {
  const groups: Attraction[][] = [];
  for (const place of [...places].toSorted((a, b) =>
    compareId(a.contentId, b.contentId),
  )) {
    const group = groups.find(
      (members) =>
        facilitySignal(place, members[0]) &&
        members.every((member) => facilitySignal(place, member)),
    );
    if (group) group.push(place);
    else groups.push([place]);
  }
  const result = new Map<string, string>();
  for (const members of groups) {
    const id = `facility-${members[0].contentId}`;
    members.forEach((member) => result.set(member.contentId, id));
  }
  for (const correction of corrections) {
    const [first, second] = [...correction.contentIds].toSorted(compareId);
    if (!result.has(first) || !result.has(second)) continue;
    if (correction.disposition === "same-facility") {
      const id = `facility-confirmed-${first}-${second}`;
      result.set(first, id);
      result.set(second, id);
    } else {
      result.set(first, `facility-independent-${first}`);
      result.set(second, `facility-independent-${second}`);
    }
  }
  return result;
}
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
type ScheduledVisit = Visit;
export function selectPlaces(
  places: Attraction[],
  interests: SearchInput["interests"],
  slots: [Interval[], Interval[]],
  corrections: readonly FacilityCorrection[] = FACILITY_CORRECTIONS,
): ScheduledVisit[] {
  const selected: ScheduledVisit[] = [],
    used = new Set<string>(),
    covered = new Set<string>();
  const groups = facilityGroups(places, corrections);
  const usedGroups = new Set<string>();
  for (const day of [0, 1] as const) {
    const dayCategories = new Set<string>();
    const sessions = new Map<string, Interval[]>();
    for (const slot of slots[day]) {
      const sessionId = `day-${day + 1}-${slot.start % 1440 < 720 ? "morning" : "afternoon"}`;
      sessions.set(sessionId, [...(sessions.get(sessionId) ?? []), slot]);
    }
    for (const [sessionId, sessionSlots] of sessions) {
      let first: Attraction | undefined;
      let previous: Attraction | undefined;
      for (let slotIndex = 0; slotIndex < sessionSlots.length; slotIndex++) {
        const missing = (place: Attraction) =>
          place.categories.filter(
            (id) => interests.includes(id) && !covered.has(id),
          ).length;
        const unused = places.filter(
          (place) =>
            !used.has(place.contentId) &&
            !(
              isConfirmedFacilityGroup(groups.get(place.contentId)) &&
              usedGroups.has(groups.get(place.contentId)!)
            ),
        );
        const sessionFirst = first;
        const nearby = sessionFirst?.coordinates
          ? unused.filter((place) => {
              const distance = distanceKm(
                sessionFirst.coordinates,
                place.coordinates,
              );
              return distance !== null && distance <= 5;
            })
          : [];
        const useNearby = Boolean(previous && nearby.length);
        const fallbackByDistance = Boolean(
          previous &&
          !useNearby &&
          sessionFirst?.coordinates &&
          unused.some((candidate) => candidate.coordinates),
        );
        const candidates = useNearby ? nearby : unused;
        const ordered = candidates.toSorted((a, b) => {
          const groupDifference =
            Number(usedGroups.has(groups.get(a.contentId)!)) -
            Number(usedGroups.has(groups.get(b.contentId)!));
          if (groupDifference) return groupDifference;
          if (fallbackByDistance) {
            const distanceDifference =
              (distanceKm(sessionFirst!.coordinates, a.coordinates) ??
                Infinity) -
              (distanceKm(sessionFirst!.coordinates, b.coordinates) ??
                Infinity);
            if (distanceDifference) return distanceDifference;
          }
          const interest = missing(b) - missing(a);
          if (interest) return interest;
          const categoryDifference =
            Number(dayCategories.has(detailCategory(a))) -
            Number(dayCategories.has(detailCategory(b)));
          if (categoryDifference) return categoryDifference;
          if (!previous) return compareId(a.contentId, b.contentId);
          return (
            (distanceKm(previous.coordinates, a.coordinates) ?? Infinity) -
              (distanceKm(previous.coordinates, b.coordinates) ?? Infinity) ||
            compareId(a.contentId, b.contentId)
          );
        });
        const place = ordered[0];
        if (!place) break;
        const groupId = groups.get(place.contentId)!;
        const repeat = usedGroups.has(groupId);
        const locationNotice =
          previous && !useNearby
            ? fallbackByDistance
              ? "장소가 떨어져 있어 위치 확인이 필요해요"
              : "장소 간 근접성은 확인하지 못했어요"
            : undefined;
        selected.push({
          attraction: place,
          durationMinutes: 60,
          fixed: false,
          facilityGroupId: groupId,
          sessionId,
          selectionNotice:
            [
              ...(repeat ? ["같은 시설 안 장소가 포함될 수 있어요"] : []),
              ...(locationNotice ? [locationNotice] : []),
            ].join(" · ") || undefined,
        });
        used.add(place.contentId);
        usedGroups.add(groupId);
        place.categories.forEach((id) => covered.add(id));
        dayCategories.add(detailCategory(place));
        first ??= place;
        previous = place;
      }
    }
  }
  return selected;
}
function retainedVisitsForSlots(
  retained: Visit[],
  slots: [Interval[], Interval[]],
  pool: Attraction[],
): Visit[] {
  const groups = facilityGroups(pool);
  const usedGroups = new Set<string>();
  let index = 0;
  return slots.flatMap((daySlots, day) =>
    daySlots.map((slot) => {
      const visit = retained[index++]!;
      const facilityGroupId = groups.get(visit.attraction.contentId);
      const repeat = facilityGroupId && usedGroups.has(facilityGroupId);
      if (facilityGroupId) usedGroups.add(facilityGroupId);
      return {
        ...visit,
        facilityGroupId,
        sessionId: `day-${day + 1}-${slot.start % 1440 < 720 ? "morning" : "afternoon"}`,
        selectionNotice: repeat
          ? "같은 시설 안 장소가 포함될 수 있어요"
          : undefined,
      };
    }),
  );
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
  for (let index = 0; index < durations.length; index++) {
    const duration = durations[index];
    while (gapIndex < gaps.length && cursor + duration > gaps[gapIndex].end) {
      gapIndex++;
      cursor = gaps[gapIndex]?.start ?? 0;
    }
    if (gapIndex >= gaps.length) return null;
    result.push({ start: cursor, end: cursor + duration });
    cursor += duration;
    if (index === durations.length - 1) continue;
    if (cursor + 15 <= gaps[gapIndex].end) cursor += 15;
    else {
      gapIndex++;
      cursor = gaps[gapIndex]?.start ?? 0;
    }
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
          block.kind === "personal" ||
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
        const visits: Visit[] = retained
          ? retainedVisitsForSlots(retained, [firstSlots, secondSlots], places)
          : selectPlaces(places, input.interests, [firstSlots, secondSlots]);
        if (visits.length !== count) continue;
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
          facilityGroupId: visit.facilityGroupId,
          sessionId: visit.sessionId,
          reason: `${visit.selectionNotice ? `${visit.selectionNotice} · ` : ""}공식 관심사 분류 · 반일별 주변 장소를 함께 구성 · 내부 이동시간 미계산`,
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
                title: "여유시간",
                reason:
                  "이동·주차·대기 등에 사용할 수 있는 여유예요. 실제 이동시간을 계산한 값은 아니에요.",
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
              title: "여유시간",
              reason:
                "이동·주차·대기 등에 사용할 수 있는 여유예요. 실제 이동시간을 계산한 값은 아니에요.",
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
    schemaVersion: 3,
    id: `${searchId}:${candidate.groupId}`,
    searchId,
    createdAt: now,
    updatedAt: now,
    edited: false,
    input,
    destination: candidate,
    blocks: candidate.preview.blocks.map((block) => ({ ...block })),
    metrics: { ...candidate.preview.metrics },
    itineraryRuleVersion: "e4-v1",
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
  const groups = facilityGroups(plan.destination.attractions);
  const usedGroups = new Set(
    plan.blocks
      .filter((block) => block.kind === "attraction" && block.contentId)
      .map((block) => groups.get(block.contentId!)!)
      .filter(Boolean),
  );
  return plan.destination.attractions
    .filter(
      (place) =>
        !used.has(place.contentId) &&
        place.categories.some((interest) =>
          plan.input.interests.includes(interest),
        ),
    )
    .toSorted(
      (left, right) =>
        Number(usedGroups.has(groups.get(left.contentId)!)) -
          Number(usedGroups.has(groups.get(right.contentId)!)) ||
        compareId(left.contentId, right.contentId),
    );
}
type EditableActivity = TimeBlock & { kind: "attraction" | "personal" };
type MinuteInterval = Interval & { index: number };
const isDuration = (value: number): value is Visit["durationMinutes"] =>
  [30, 60, 90, 120].includes(value);
const isActivity = (
  block: TimeBlock,
): block is TimeBlock & {
  kind: "attraction" | "personal";
} => block.kind === "attraction" || block.kind === "personal";
function planMidnight(input: SearchInput): number {
  return parseLocalDate(`${input.startAt.slice(0, 10)}T00:00`)!;
}
function blockMinute(input: SearchInput, value: string): number {
  return Math.round((parseLocalDate(value)! - planMidnight(input)) / MINUTE);
}
function editedAvailability(plan: PlanSnapshot, day: 1 | 2): MinuteInterval[] {
  const lower = (day - 1) * 1440 + 420;
  const upper = (day - 1) * 1440 + 1260;
  const blockers = plan.blocks
    .filter((block) => !isActivity(block) && block.kind !== "free")
    .map((block) => ({
      start: blockMinute(plan.input, block.startAt),
      end: blockMinute(plan.input, block.endAt),
    }))
    .filter((block) => block.end > lower && block.start < upper)
    .toSorted((left, right) => left.start - right.start);
  const result: MinuteInterval[] = [];
  let cursor = lower;
  for (const blocker of blockers) {
    if (blocker.start > cursor)
      result.push({
        start: cursor,
        end: Math.min(blocker.start, upper),
        index: result.length,
      });
    cursor = Math.max(cursor, blocker.end);
  }
  if (cursor < upper)
    result.push({ start: cursor, end: upper, index: result.length });
  return result.filter((interval) => interval.end > interval.start);
}
function activityStart(block: EditableActivity, input: SearchInput) {
  return blockMinute(input, block.startAt);
}
function compareMinuteArrays(left: number[], right: number[]): number {
  for (let index = 0; index < left.length; index++) {
    const difference = left[index] - right[index];
    if (difference) return difference;
  }
  return 0;
}
function arrangeDay(
  plan: PlanSnapshot,
  activities: EditableActivity[],
  day: 1 | 2,
): { slots: Map<string, Interval>; reason?: string } {
  const available = editedAvailability(plan, day);
  if (!activities.length) return { slots: new Map() };
  let best: {
    slots: Map<string, Interval>;
    retained: number;
    movement: number;
    starts: number[];
  } | null = null;
  const recurse = (
    index: number,
    previous: { end: number; interval: number } | null,
    slots: Map<string, Interval>,
  ) => {
    if (index === activities.length) {
      const free =
        available.reduce(
          (sum, interval) => sum + interval.end - interval.start,
          0,
        ) -
        activities.reduce((sum, activity) => sum + activity.durationMinutes, 0);
      if (free < 30) return;
      const starts = activities.map(
        (activity) => slots.get(activity.id)!.start,
      );
      const retained = activities.filter(
        (activity) =>
          activityStart(activity, plan.input) === slots.get(activity.id)!.start,
      ).length;
      const movement = activities.reduce(
        (sum, activity) =>
          sum +
          Math.abs(
            activityStart(activity, plan.input) - slots.get(activity.id)!.start,
          ),
        0,
      );
      if (
        !best ||
        retained > best.retained ||
        (retained === best.retained &&
          (movement < best.movement ||
            (movement === best.movement &&
              compareMinuteArrays(starts, best.starts) < 0)))
      )
        best = { slots: new Map(slots), retained, movement, starts };
      return;
    }
    const activity = activities[index];
    const fixed = activity.fixedStartAt
      ? blockMinute(plan.input, activity.fixedStartAt)
      : null;
    const candidates: Array<{ start: number; interval: number }> = [];
    for (const interval of available) {
      if (previous && interval.index < previous.interval) continue;
      const requiredStart = Math.max(
        interval.start,
        previous && previous.interval === interval.index
          ? previous.end + 15
          : interval.start,
      );
      const preferred = activityStart(activity, plan.input);
      // A later fixed activity constrains every preceding flexible activity,
      // not only its direct neighbour. Propagate the required durations and
      // 15-minute activity gaps backwards through the whole intervening chain.
      const nextFixedBoundaries = activities.flatMap((next, fixedIndex) => {
        if (fixedIndex <= index || !next.fixedStartAt) return [];
        const requiredMinutes = activities
          .slice(index, fixedIndex)
          .reduce((sum, preceding) => sum + preceding.durationMinutes, 0);
        return [
          blockMinute(plan.input, next.fixedStartAt) -
            requiredMinutes -
            15 * (fixedIndex - index),
        ];
      });
      const starts =
        fixed === null
          ? [preferred, requiredStart, ...nextFixedBoundaries]
          : [fixed];
      for (const start of starts)
        if (
          start >= requiredStart &&
          start + activity.durationMinutes <= interval.end
        )
          candidates.push({ start, interval: interval.index });
    }
    for (const candidate of candidates.toSorted(
      (left, right) =>
        left.start - right.start || left.interval - right.interval,
    )) {
      if (
        candidate.start < (day - 1) * 1440 + 420 ||
        candidate.start + activity.durationMinutes > (day - 1) * 1440 + 1260
      )
        continue;
      slots.set(activity.id, {
        start: candidate.start,
        end: candidate.start + activity.durationMinutes,
      });
      recurse(
        index + 1,
        {
          end: candidate.start + activity.durationMinutes,
          interval: candidate.interval,
        },
        slots,
      );
      slots.delete(activity.id);
    }
  };
  recurse(0, null, new Map());
  const selected = best as {
    slots: Map<string, Interval>;
    retained: number;
    movement: number;
    starts: number[];
  } | null;
  return selected
    ? { slots: selected.slots }
    : {
        slots: new Map(),
        reason: "식사와 겹치거나 여유시간을 확보할 수 없어요.",
      };
}
function rebuildActivities(
  plan: PlanSnapshot,
  activities: EditableActivity[],
): EditResult {
  const fail = (reason: string): EditResult => ({ ok: false, plan, reason });
  if (
    activities.filter((activity) => activity.kind === "attraction").length > 6
  )
    return fail("관광지는 여행 전체 최대 6곳까지 추가할 수 있어요.");
  if (activities.filter((activity) => activity.kind === "personal").length > 4)
    return fail("개인 일정은 여행 전체 최대 4개까지 추가할 수 있어요.");
  for (const day of [1, 2] as const) {
    const daily = activities.filter((activity) => activity.day === day);
    if (daily.filter((activity) => activity.kind === "attraction").length > 3)
      return fail("해당 날짜 관광 3곳 한도예요.");
    for (const activity of daily) {
      if (!activity.fixedStartAt) continue;
      const fixed = parseLocalDate(activity.fixedStartAt);
      if (
        fixed === null ||
        activity.fixedStartAt.slice(0, 10) !==
          (day === 1
            ? plan.input.startAt.slice(0, 10)
            : plan.input.returnBy.slice(0, 10))
      )
        return fail("고정 시각 충돌이 있어 날짜를 바꿀 수 없어요.");
    }
    const arranged = arrangeDay(plan, daily, day);
    if (arranged.reason) return fail(arranged.reason);
    for (const activity of daily) {
      const slot = arranged.slots.get(activity.id)!;
      activity.startAt = stamp(plan.input, slot.start);
      activity.endAt = stamp(plan.input, slot.end);
    }
  }
  const staticBlocks = plan.blocks.filter(
    (block) => !isActivity(block) && block.kind !== "free",
  );
  const freeBlocks: TimeBlock[] = [];
  for (const day of [1, 2] as const) {
    const daily = activities
      .filter((activity) => activity.day === day)
      .toSorted((a, b) => a.startAt.localeCompare(b.startAt));
    for (const available of editedAvailability(plan, day)) {
      let cursor = available.start;
      for (const activity of daily) {
        const start = blockMinute(plan.input, activity.startAt),
          end = blockMinute(plan.input, activity.endAt);
        if (start < available.start || end > available.end) continue;
        if (cursor < start)
          freeBlocks.push({
            id: `free-${cursor}`,
            day,
            startAt: stamp(plan.input, cursor),
            endAt: stamp(plan.input, start),
            kind: "free",
            title: "여유시간",
            durationMinutes: start - cursor,
            reason:
              "이동·주차·대기 등에 사용할 수 있는 여유예요. 실제 이동시간을 계산한 값은 아니에요.",
          });
        cursor = end;
      }
      if (cursor < available.end)
        freeBlocks.push({
          id: `free-${cursor}`,
          day,
          startAt: stamp(plan.input, cursor),
          endAt: stamp(plan.input, available.end),
          kind: "free",
          title: "여유시간",
          durationMinutes: available.end - cursor,
          reason:
            "이동·주차·대기 등에 사용할 수 있는 여유예요. 실제 이동시간을 계산한 값은 아니에요.",
        });
    }
  }
  const blocks = [...staticBlocks, ...activities, ...freeBlocks].toSorted(
    (a, b) => a.startAt.localeCompare(b.startAt),
  );
  return {
    ok: true,
    plan: {
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
      itineraryRuleVersion: "e4-v1",
    },
  };
}
export function planAccommodation(
  plan: PlanSnapshot,
  accommodation: { name: string; address: string; note: string },
): EditResult {
  const valid = [
    accommodation.name,
    accommodation.address,
    accommodation.note,
  ].every(
    (value, index) =>
      typeof value === "string" && value.trim().length <= [80, 200, 500][index],
  );
  if (!valid || !accommodation.name.trim())
    return {
      ok: false,
      plan,
      reason: "숙소 이름·주소·메모 길이를 확인해 주세요.",
    };
  return {
    ok: true,
    plan: {
      ...plan,
      accommodation: {
        name: accommodation.name.trim(),
        address: accommodation.address.trim(),
        note: accommodation.note.trim(),
      },
      edited: true,
      updatedAt: new Date().toISOString(),
    },
  };
}
export function editPlan(plan: PlanSnapshot, command: EditCommand): EditResult {
  const fail = (reason: string): EditResult => ({ ok: false, plan, reason });
  const activities = plan.blocks.filter(isActivity).map((block) => ({
    ...block,
    personal: block.personal ? { ...block.personal } : undefined,
  })) as EditableActivity[];
  const target =
    "blockId" in command
      ? activities.find((block) => block.id === command.blockId)
      : undefined;
  if ("blockId" in command && !target)
    return fail("수정할 일정을 찾지 못했어요.");
  if (command.type === "toggle-fixed") {
    if (target!.kind !== "attraction")
      return fail("관광지만 장소 유지로 고정할 수 있어요.");
    target!.fixed = !target!.fixed;
    return rebuildActivities(plan, activities);
  }
  if (command.type === "set-fixed-start") {
    if (
      command.fixedStartAt !== null &&
      parseLocalDate(command.fixedStartAt) === null
    )
      return fail("고정 시각을 올바르게 입력해 주세요.");
    target!.fixedStartAt = command.fixedStartAt ?? undefined;
    return rebuildActivities(plan, activities);
  }
  if (command.type === "move-activity" || command.type === "reorder-activity") {
    if (target!.fixedStartAt)
      return fail("시각 고정을 해제한 뒤 날짜나 순서를 바꿔 주세요.");
    const from = activities.filter((block) => block.day === target!.day);
    const index = from.indexOf(target!);
    const nextDay =
      command.type === "move-activity" ? command.day : target!.day;
    const targetList = activities.filter(
      (block) => block.day === nextDay && block.id !== target!.id,
    );
    const position =
      command.type === "move-activity"
        ? command.position
        : index + (command.direction === "up" ? -1 : 1);
    if (position < 0 || position > targetList.length)
      return fail("더 이상 순서를 바꿀 수 없어요.");
    target!.day = nextDay;
    const reordered = [
      ...targetList.slice(0, position),
      target!,
      ...targetList.slice(position),
    ];
    const others = activities.filter(
      (block) => block.day !== nextDay && block.id !== target!.id,
    );
    return rebuildActivities(plan, [...others, ...reordered]);
  }
  if (command.type === "add-attraction") {
    if (!isDuration(command.durationMinutes))
      return fail("방문시간은 30/60/90/120분 중 선택해 주세요.");
    if (
      activities.some(
        (block) => block.attraction?.contentId === command.contentId,
      )
    )
      return fail("같은 관광지를 두 번 추가할 수 없어요.");
    const attraction = plan.destination.attractions.find(
      (place) =>
        place.contentId === command.contentId &&
        place.categories.some((category) =>
          plan.input.interests.includes(category),
        ),
    );
    if (!attraction)
      return fail("같은 선택 지역의 미사용 관광 후보만 추가할 수 있어요.");
    activities.push({
      id: `activity-${attraction.contentId}`,
      day: command.day,
      startAt: stamp(plan.input, (command.day - 1) * 1440 + 420),
      endAt: stamp(
        plan.input,
        (command.day - 1) * 1440 + 420 + command.durationMinutes,
      ),
      kind: "attraction",
      title: attraction.title,
      durationMinutes: command.durationMinutes,
      contentId: attraction.contentId,
      attraction,
      fixed: false,
      reason: "사용자가 추가한 공식 관심사 관광지 · 내부 이동시간 미계산",
    });
    return rebuildActivities(plan, activities);
  }
  if (command.type === "add-personal") {
    const personal = command.personal;
    if (
      !isDuration(personal.durationMinutes) ||
      !/^[\s\S]{1,80}$/.test(personal.name.trim()) ||
      !["appointment", "place"].includes(personal.category) ||
      personal.address.length > 200 ||
      !/^[\p{L}\p{N}:_-]{1,160}$/u.test(personal.id) ||
      activities.some((block) => block.id === personal.id)
    )
      return fail("개인 일정의 이름·종류·주소·시간을 확인해 주세요.");
    activities.push({
      id: personal.id,
      day: personal.day,
      startAt: stamp(plan.input, (personal.day - 1) * 1440 + 420),
      endAt: stamp(
        plan.input,
        (personal.day - 1) * 1440 + 420 + personal.durationMinutes,
      ),
      kind: "personal",
      title: personal.name.trim(),
      durationMinutes: personal.durationMinutes,
      personal: {
        ...personal,
        name: personal.name.trim(),
        address: personal.address.trim(),
      },
      reason:
        "사용자가 직접 입력한 개인 일정 · 여행 지역 안 장소인지 확인해 주세요.",
    });
    return rebuildActivities(plan, activities);
  }
  if (command.type === "delete-personal") {
    if (target!.fixedStartAt)
      return fail("시각 고정을 해제한 뒤 삭제해 주세요.");
    if (target!.kind !== "personal")
      return fail("개인 일정만 이 동작으로 삭제할 수 있어요.");
    return rebuildActivities(
      plan,
      activities.filter((block) => block.id !== target!.id),
    );
  }
  if (target!.kind !== "attraction" || !target!.attraction)
    return fail("수정할 관광지를 찾지 못했어요.");
  if (
    target!.fixed &&
    (command.type === "replace-attraction" ||
      command.type === "delete-attraction")
  )
    return fail("장소 고정을 해제한 뒤 교체하거나 삭제해 주세요.");
  if (command.type === "delete-attraction")
    return rebuildActivities(
      plan,
      activities.filter((block) => block.id !== target!.id),
    );
  if (command.type === "duration") {
    if (!isDuration(command.durationMinutes))
      return fail("방문시간은 30/60/90/120분 중 선택해 주세요.");
    target!.durationMinutes = command.durationMinutes;
    return rebuildActivities(plan, activities);
  }
  const replacement = attractionAlternatives(plan, target!.id).find(
    (place) => place.contentId === command.contentId,
  );
  if (!replacement)
    return fail("같은 지역의 미사용 대체 관광지를 선택해 주세요.");
  target!.attraction = replacement;
  target!.contentId = replacement.contentId;
  target!.title = replacement.title;
  return rebuildActivities(plan, activities);
}
