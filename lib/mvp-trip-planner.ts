import travelTimeTable from "@/data/ktdb/interregional-travel-times-2024.json";
import { supportedRegions } from "@/lib/region-config";
import type {
  ItineraryItem,
  PlannerPlace,
  SearchRequest,
} from "@/lib/trip-planner-contract";

export type {
  ItineraryItem,
  PlannerCandidate,
  PlannerPlace,
  SearchFailure,
  SearchRequest,
  SearchResponse,
  SearchSuccess,
} from "@/lib/trip-planner-contract";
export {
  destinationRegions,
  originRegions,
  supportedRegions,
} from "@/lib/region-config";

const MINUTE = 60_000;
const KST = "+09:00";

function parseKst(value: string) {
  return new Date(`${value}:00${KST}`);
}

function localParts(date: Date) {
  const shifted = new Date(date.getTime() + 9 * 60 * MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function dateAt(day: Date, hour: number, minute = 0) {
  const parts = localParts(day);
  return new Date(
    Date.UTC(parts.year, parts.month, parts.date, hour - 9, minute),
  );
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * MINUTE);
}

function toClock(date: Date) {
  const parts = localParts(date);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function zoneIndex(zoneId: string) {
  return travelTimeTable.regions.findIndex((region) => region.id === zoneId);
}

export function lookupOneWayMinutes(originId: string, destinationId: string) {
  const origin = supportedRegions.find((region) => region.id === originId);
  const destination = supportedRegions.find(
    (region) => region.id === destinationId,
  );
  if (!origin || !destination) return null;
  const from = zoneIndex(origin.zoneId);
  const to = zoneIndex(destination.zoneId);
  if (from < 0 || to < 0) return null;
  const value = travelTimeTable.minutes[from]?.[to];
  return typeof value === "number" && value > 0 ? value : null;
}

function distinctAttractions(attractions: PlannerPlace[]) {
  const seen = new Set<string>();
  return attractions.filter((place) => {
    const key = place.name.replace(/\s*(관광지|유적|박물관|공원)$/u, "").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 장소 사이 이동시간을 전혀 넣지 않는 고정 시간 블록 엔진이다. 식사 두 종류는 모든 날짜에
 * 배치하고, 남은 블록에 서로 다른 관광지를 순환 배치한다.
 */
export function buildItinerary(
  request: SearchRequest,
  oneWayMinutes: number,
  attractions: PlannerPlace[],
  lunch: PlannerPlace,
  dinner: PlannerPlace,
): ItineraryItem[] | null {
  const start = parseKst(request.startAt);
  const returnBy = parseKst(request.returnBy);
  if (Number.isNaN(start.getTime()) || Number.isNaN(returnBy.getTime()))
    return null;
  const dayOneEnd = dateAt(start, 21);
  const dayTwoStart = dateAt(addMinutes(start, 24 * 60), 7);
  const departureArrival = addMinutes(start, oneWayMinutes);
  const returnDeparture = addMinutes(returnBy, -oneWayMinutes);
  if (departureArrival >= dayOneEnd || returnDeparture <= dayTwoStart)
    return null;

  const places = distinctAttractions(attractions);
  if (places.length < 3) return null;
  let cursor = 0;
  const result: ItineraryItem[] = [];
  const add = (day: 1 | 2, startsAt: Date, place: PlannerPlace) => {
    result.push({
      ...place,
      day,
      startsAt: toClock(startsAt),
      endsAt: toClock(addMinutes(startsAt, 60)),
    });
  };
  const fill = (day: 1 | 2, from: Date, until: Date) => {
    let current = from;
    while (addMinutes(current, 60) <= until && cursor < places.length) {
      add(day, current, places[cursor]);
      cursor += 1;
      current = addMinutes(current, 60);
    }
  };
  const lunchOne = dateAt(start, 11, 30);
  const dinnerOne = dateAt(start, 17, 30);
  fill(1, departureArrival, lunchOne);
  if (lunchOne >= departureArrival && addMinutes(lunchOne, 60) <= dayOneEnd)
    add(1, lunchOne, lunch);
  fill(1, addMinutes(lunchOne, 60), dinnerOne);
  if (dinnerOne >= departureArrival && addMinutes(dinnerOne, 60) <= dayOneEnd)
    add(1, dinnerOne, dinner);
  fill(1, addMinutes(dinnerOne, 60), dayOneEnd);

  const secondDay = addMinutes(start, 24 * 60);
  const lunchTwo = dateAt(secondDay, 11, 30);
  const dinnerTwo = dateAt(secondDay, 17, 30);
  fill(2, dayTwoStart, lunchTwo);
  if (addMinutes(lunchTwo, 60) <= returnDeparture) add(2, lunchTwo, lunch);
  fill(2, addMinutes(lunchTwo, 60), dinnerTwo);
  if (addMinutes(dinnerTwo, 60) <= returnDeparture) add(2, dinnerTwo, dinner);
  fill(2, addMinutes(dinnerTwo, 60), returnDeparture);

  const meals = result.filter(
    (item) => item.category === "점심" || item.category === "저녁",
  );
  const sightseeing = result.filter((item) => item.category === "관광");
  return meals.length >= 4 && sightseeing.length >= 3 ? result : null;
}
