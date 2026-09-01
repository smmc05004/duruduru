import type { Attraction, Destination } from "./mock-data";

export type TripInput = {
  origin: string;
  start: string;
  end: string;
  transport: "car" | "public";
  interests: string[];
};
export type Recommendation = {
  destination: Destination;
  score: number;
  reason: string;
};
export type ScheduleItem = {
  day: string;
  time: string;
  type: string;
  title: string;
  description: string;
  note?: string;
};

const hour = (date: Date) => date.getHours() + date.getMinutes() / 60;
const dateLabel = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;
const clock = (date: Date) =>
  date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
// 소수 시간(17.5, 9)을 17:30, 09:00 형태로 표기한다. clock()은 Date만 받으므로 별개다.
const clockFromHours = (value: number) => {
  const totalMinutes = Math.round(value * 60);
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
};
const dayKey = (date: Date) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const openingTime = (date: Date, attraction: Attraction, dayOffset = 0) =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset,
    Math.max(9, attraction.open),
    0,
  );
const addHours = (date: Date, value: number) =>
  new Date(date.getTime() + value * 3_600_000);

export function recommendDestinations(
  input: TripInput,
  data: Destination[],
): Recommendation[] {
  const totalHours =
    (new Date(input.end).getTime() - new Date(input.start).getTime()) /
    3_600_000;
  return data
    .map((destination) => {
      const travel =
        input.transport === "car"
          ? destination.driveHours
          : destination.publicHours;
      const matching = destination.tags.filter((tag) =>
        input.interests.includes(tag),
      ).length;
      const possible = totalHours >= travel * 2 + 7;
      const score = Math.max(
        40,
        Math.round(
          62 +
            matching * 13 +
            (possible ? 8 : -20) +
            Math.min(8, totalHours / 8),
        ),
      );
      const reason = matching
        ? `${input.interests.filter((item) => destination.tags.includes(item)).join("·")} 여행에 잘 맞고, 왕복 약 ${(travel * 2).toFixed(1)}시간으로 충분히 둘러볼 수 있어요.`
        : `왕복 약 ${(travel * 2).toFixed(1)}시간으로, 주어진 일정 안에 여유 있게 다녀올 수 있어요.`;
      return { destination, score, reason };
    })
    .filter((item) => item.score >= 55)
    .sort((a, b) => b.score - a.score);
}

function isOpen(attraction: Attraction, date: Date) {
  return (
    !attraction.closedDays?.includes(date.getDay()) &&
    hour(date) >= attraction.open &&
    hour(date) < attraction.close
  );
}

export function buildItinerary(
  destination: Destination,
  input: TripInput,
): ScheduleItem[] {
  const start = new Date(input.start);
  const end = new Date(input.end);
  const travel =
    input.transport === "car"
      ? destination.driveHours
      : destination.publicHours;
  let cursor = addHours(start, travel);
  const items: ScheduleItem[] = [
    {
      day: dateLabel(start),
      time: clock(start),
      type: "이동",
      title: `${input.origin}에서 ${destination.name}으로 출발`,
      description:
        input.transport === "car"
          ? `평균 예상 이동 ${travel}시간 · 자차 기준`
          : `평균 예상 이동 ${travel}시간 · 대중교통 기준`,
    },
  ];
  // 식사 시간 블록을 만들지 않는다 — 이것도 알려진 구현 한계다. F-04는 P0에서 식사 시간
  // 블록 확보를 요구하지만, 식사 시간대와 소요시간이 정책으로 정해지지 않았다.
  const sorted = [...destination.attractions].sort(
    (a, b) =>
      Number(input.interests.includes(b.category)) -
      Number(input.interests.includes(a.category)),
  );
  // 하루를 새로 시작할 때만 커서를 개장 시각으로 리셋한다. 이미 리셋한 날에는
  // 앞 항목의 체류시간 + 30분 간격을 유지해야 하므로 다시 리셋하지 않는다.
  let openedDay = dayKey(cursor);
  for (const attraction of sorted) {
    if (dayKey(cursor) !== openedDay) {
      cursor = openingTime(cursor, attraction);
      openedDay = dayKey(cursor);
    }
    if (
      !isOpen(attraction, cursor) ||
      hour(cursor) + attraction.stayHours > attraction.close
    ) {
      cursor = openingTime(cursor, attraction, 1);
      openedDay = dayKey(cursor);
    }
    // 복귀 초과는 검사하지 않는다 — 알려진 구현 한계다.
    // 여기서 비교하는 것은 **항목의 시작 시각**뿐이다(`cursor > end`). 항목의 체류시간과
    // 목적지→출발지 복귀 이동시간을 더한 실제 종료 시각이 복귀 가능 시각을 넘는지는
    // 검사하지 않는다. 그래서 복귀 직전에 시작만 걸치는 항목이 일정에 남을 수 있다.
    // FUNCTIONAL_SPEC.md의 F-04는 "마지막 항목 종료 + 목적지→출발지 이동 + 복귀 버퍼는
    // 복귀 가능 일시 이하"를 요구하지만, 그 검사에 필요한 최소 현지 체류시간과 복귀 버퍼
    // 기준이 docs/product/DECISIONS.md에서 미확정이다. 기준을 임의로 정하면 그 상수가
    // 사실상 제품 결정이 되므로 지금 고치지 않는다. 정책이 확정되면 F-04 규칙대로 구현한다.
    if (cursor > end || !isOpen(attraction, cursor)) continue;
    items.push({
      day: dateLabel(cursor),
      time: clock(cursor),
      type: attraction.category,
      title: attraction.name,
      description: attraction.description,
      note: `추천 체류 ${attraction.stayHours}시간 · 운영 ${clockFromHours(attraction.open)}–${clockFromHours(attraction.close)}`,
    });
    cursor = addHours(cursor, attraction.stayHours + 0.5);
  }
  if (
    destination.festival &&
    new Date(destination.festival.start) <= end &&
    new Date(destination.festival.end) >= start
  )
    items.splice(1, 0, {
      day: dateLabel(addHours(start, travel)),
      time: "도착 후",
      type: "축제",
      title: destination.festival.name,
      description: "여행 기간 중 열리는 지역 축제를 함께 들러보세요.",
      note: `${destination.festival.start} ~ ${destination.festival.end}`,
    });
  items.push({
    day: dateLabel(end),
    time: clock(addHours(end, -travel)),
    type: "이동",
    title: `${destination.name}에서 ${input.origin}으로 복귀`,
    description: `복귀 시간에 맞춰 평균 ${travel}시간 이동을 반영했어요.`,
  });
  return items;
}
