import profiles from "@/data/region-profiles.json";
import mapping from "@/data/region-mapping.json";
import travelTimes from "@/data/ktdb/interregional-travel-times-2024.json";
import type {
  MvpCategoryId,
  RegionAttraction,
  RegionProfile,
} from "@/lib/mvp-region-data";

export const INTERESTS: Array<{ id: MvpCategoryId; label: string }> = [
  { id: "nature", label: "자연" },
  { id: "history", label: "역사" },
  { id: "rest", label: "휴양" },
  { id: "culture", label: "문화" },
  { id: "leisure", label: "레저" },
];
export const SEOUL_ZONE_ID = "ktdb-zone-2";
const HOUR = 3_600_000;
const kstDate = (value: string) => new Date(`${value}:00+09:00`);
const zoneIndex = new Map(
  travelTimes.regions.map((region, index) => [region.id, index]),
);
const profileById = new Map(
  (profiles.profiles as RegionProfile[]).map((profile) => [
    profile.regionId,
    profile,
  ]),
);
const mappingById = new Map(
  mapping.mappings.map((item) => [item.regionId, item]),
);

export type SearchInput = {
  startAt: string;
  returnBy: string;
  interests: MvpCategoryId[];
};
export type Candidate = {
  regionId: string;
  name: string;
  province: string;
  oneWayMinutes: number;
  localMinutes: number;
  attractions: RegionAttraction[];
  interestLabels: string[];
};
export type Restaurant = {
  contentId: string;
  name: string;
  address: string;
  phone: string;
  certified: boolean;
  foodCultureMatch: boolean;
};
export type ScheduleItem = {
  day: 1 | 2;
  time: string;
  type: "이동" | "관광" | "점심" | "저녁";
  title: string;
};

export function validOneNight(input: SearchInput) {
  const start = kstDate(input.startAt),
    end = kstDate(input.returnBy);
  const days =
    Math.floor((end.getTime() + 9 * HOUR) / 86_400_000) -
    Math.floor((start.getTime() + 9 * HOUR) / 86_400_000) +
    1;
  return (
    !Number.isNaN(start.getTime()) &&
    end > start &&
    days === 2 &&
    input.interests.length > 0
  );
}

export function searchCandidates(input: SearchInput): Candidate[] {
  if (!validOneNight(input)) return [];
  const start = kstDate(input.startAt),
    end = kstDate(input.returnBy);
  const from = zoneIndex.get(SEOUL_ZONE_ID);
  if (from === undefined) return [];
  const candidates: Candidate[] = [];
  for (const [regionId, profile] of profileById) {
    const row = mappingById.get(regionId),
      to = zoneIndex.get(regionId),
      minutes = to === undefined ? null : travelTimes.minutes[from]?.[to];
    if (!row || typeof minutes !== "number" || minutes <= 0) continue;
    const attractionMap = new Map<string, RegionAttraction>();
    for (const interest of input.interests)
      for (const attraction of profile.attractions)
        if (attraction.categoryId === interest)
          attractionMap.set(attraction.contentId, attraction);
    if (attractionMap.size < 3) continue;
    const localMinutes =
      Math.floor((end.getTime() - start.getTime()) / 60_000) - minutes * 2;
    if (localMinutes < 8 * 60) continue;
    candidates.push({
      regionId,
      name: profile.name,
      province: profile.province,
      oneWayMinutes: minutes,
      localMinutes,
      attractions: [...attractionMap.values()],
      interestLabels: input.interests.map(
        (id) => INTERESTS.find((item) => item.id === id)?.label ?? id,
      ),
    });
  }
  return candidates
    .toSorted(
      (a, b) =>
        b.attractions.length - a.attractions.length ||
        a.oneWayMinutes - b.oneWayMinutes ||
        a.regionId.localeCompare(b.regionId),
    )
    .slice(0, 3);
}

export function profileFor(regionId: string) {
  return profileById.get(regionId) ?? null;
}
export function regionMappingFor(regionId: string) {
  return mappingById.get(regionId) ?? null;
}

export function createSchedule(
  input: SearchInput,
  candidate: Candidate,
  restaurants: Restaurant[],
): ScheduleItem[] | null {
  if (restaurants.length < 1) return null;
  const attractions = [
    ...new Map(
      candidate.attractions.map((item) => [item.contentId, item]),
    ).values(),
  ];
  if (attractions.length < 3) return null;
  const pick = (index: number) => attractions[index % attractions.length];
  const restaurant = restaurants[0];
  return [
    {
      day: 1,
      time: input.startAt.slice(11),
      type: "이동",
      title: `${candidate.name}으로 출발`,
    },
    { day: 1, time: "11:30", type: "점심", title: restaurant.name },
    { day: 1, time: "13:30", type: "관광", title: pick(0).title },
    { day: 1, time: "15:00", type: "관광", title: pick(1).title },
    { day: 1, time: "17:30", type: "저녁", title: restaurant.name },
    { day: 2, time: "09:00", type: "관광", title: pick(2).title },
    { day: 2, time: "11:30", type: "점심", title: restaurant.name },
    { day: 2, time: "13:30", type: "관광", title: pick(3).title },
    { day: 2, time: "17:30", type: "저녁", title: restaurant.name },
    {
      day: 2,
      time: input.returnBy.slice(11),
      type: "이동",
      title: "서울특별시로 복귀",
    },
  ];
}
