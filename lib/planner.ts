import type { Attraction, Destination } from "./mock-data";

export type TripInput = { origin: string; start: string; end: string; transport: "car" | "public"; interests: string[] };
export type Recommendation = { destination: Destination; score: number; reason: string };
export type ScheduleItem = { day: string; time: string; type: string; title: string; description: string; note?: string };

const hour = (date: Date) => date.getHours() + date.getMinutes() / 60;
const dateLabel = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;
const clock = (date: Date) => date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
const addHours = (date: Date, value: number) => new Date(date.getTime() + value * 3_600_000);

export function recommendDestinations(input: TripInput, data: Destination[]): Recommendation[] {
  const totalHours = (new Date(input.end).getTime() - new Date(input.start).getTime()) / 3_600_000;
  return data.map((destination) => {
    const travel = input.transport === "car" ? destination.driveHours : destination.publicHours;
    const matching = destination.tags.filter((tag) => input.interests.includes(tag)).length;
    const possible = totalHours >= travel * 2 + 7;
    const score = Math.max(40, Math.round(62 + matching * 13 + (possible ? 8 : -20) + Math.min(8, totalHours / 8)));
    const reason = matching ? `${input.interests.filter((item) => destination.tags.includes(item)).join("·")} 여행에 잘 맞고, 왕복 약 ${(travel * 2).toFixed(1)}시간으로 충분히 둘러볼 수 있어요.` : `왕복 약 ${(travel * 2).toFixed(1)}시간으로, 주어진 일정 안에 여유 있게 다녀올 수 있어요.`;
    return { destination, score, reason };
  }).filter((item) => item.score >= 55).sort((a, b) => b.score - a.score);
}

function isOpen(attraction: Attraction, date: Date) {
  return !(attraction.closedDays?.includes(date.getDay())) && hour(date) >= attraction.open && hour(date) < attraction.close;
}

export function buildItinerary(destination: Destination, input: TripInput): ScheduleItem[] {
  const start = new Date(input.start);
  const end = new Date(input.end);
  const travel = input.transport === "car" ? destination.driveHours : destination.publicHours;
  let cursor = addHours(start, travel);
  const items: ScheduleItem[] = [{ day: dateLabel(start), time: clock(start), type: "이동", title: `${input.origin}에서 ${destination.name}으로 출발`, description: input.transport === "car" ? `평균 예상 이동 ${travel}시간 · 자차 기준` : `평균 예상 이동 ${travel}시간 · 대중교통 기준` }];
  const sorted = [...destination.attractions].sort((a, b) => Number(input.interests.includes(b.category)) - Number(input.interests.includes(a.category)));
  for (const attraction of sorted) {
    if (cursor.getDate() !== start.getDate()) cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), Math.max(9, attraction.open), 0);
    if (!isOpen(attraction, cursor) || hour(cursor) + attraction.stayHours > attraction.close) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, Math.max(9, attraction.open), 0);
    }
    if (cursor > end || !isOpen(attraction, cursor)) continue;
    items.push({ day: dateLabel(cursor), time: clock(cursor), type: attraction.category, title: attraction.name, description: attraction.description, note: `추천 체류 ${attraction.stayHours}시간 · 운영 ${attraction.open}:00–${attraction.close}:00` });
    cursor = addHours(cursor, attraction.stayHours + 0.5);
  }
  if (destination.festival && new Date(destination.festival.start) <= end && new Date(destination.festival.end) >= start) items.splice(1, 0, { day: dateLabel(addHours(start, travel)), time: "도착 후", type: "축제", title: destination.festival.name, description: "여행 기간 중 열리는 지역 축제를 함께 들러보세요.", note: `${destination.festival.start} ~ ${destination.festival.end}` });
  items.push({ day: dateLabel(end), time: clock(addHours(end, -travel)), type: "이동", title: `${destination.name}에서 ${input.origin}으로 복귀`, description: `복귀 시간에 맞춰 평균 ${travel}시간 이동을 반영했어요.` });
  return items;
}
