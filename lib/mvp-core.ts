import profiles from "@/data/region-profiles.json";
import mapping from "@/data/region-mapping.json";
import travelTimes from "@/data/ktdb/interregional-travel-times-2024.json";
import { formatHoursAndMinutes } from "@/lib/format-duration";
import type {
  MvpCategoryId,
  RegionAttraction,
  RegionMapping,
  RegionProfile,
} from "@/lib/mvp-region-data";

export const INTERESTS: Array<{ id: MvpCategoryId; label: string }> = [
  { id: "nature", label: "자연" },
  { id: "history", label: "역사" },
  { id: "rest", label: "휴양" },
  { id: "culture", label: "문화" },
  { id: "leisure", label: "레저" },
];
export const ORIGINS = [
  { id: "seoul", label: "서울특별시", zoneId: "ktdb-zone-2" },
  { id: "busan", label: "부산광역시", zoneId: "ktdb-zone-26" },
] as const;
export type MvpOriginId = (typeof ORIGINS)[number]["id"];
const HOUR = 3_600_000;
const kstDate = (value: string) => new Date(`${value}:00+09:00`);

/**
 * 1박 2일 참고 계획의 고정 시간 경계.
 * TRAVEL_RECOMMENDATION.md 「시간 경계」: 매일 21:00~다음날 07:00은 휴식으로 고정하고,
 * 관광지·음식점 체류는 각각 1시간이다.
 */
const REST_START_HOUR = 21;
const DAY_RESUME_HOUR = 7;
const STAY_MINUTES = 60;
/** 정상 예외 판정용 최소치: 점심 1시간 + 저녁 1시간 + 관광 최소 1곳 1시간. */
const MIN_LOCAL_MINUTES = STAY_MINUTES * 3;

const kstClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const kstDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `base`가 속한 KST 날짜의 `hour`시 정각을 반환한다. */
function atKstHour(base: Date, hour: number): Date {
  return new Date(
    `${kstDay.format(base)}T${String(hour).padStart(2, "0")}:00:00+09:00`,
  );
}

const METROPOLITAN_SUFFIX = /(?:특별시|광역시|특별자치시)$/u;

/** 도 지역 후보의 짧은 표시명. "경상북도 경주시" 대신 "경주"처럼 지명만 남긴다. */
export function municipalityDisplayName(district: string): string {
  const tokens = district.trim().split(/\s+/u);
  if (tokens.length === 1) return tokens[0].replace(/(?:시|군)$/u, "");
  return `${tokens[0].replace(/시$/u, "")} ${tokens[tokens.length - 1]}`;
}

/**
 * 표시명 받침에 맞춰 방향 조사(로/으로)를 붙인다.
 * 받침이 없거나 ㄹ 받침이면 "로", 그 외에는 "으로"를 쓴다.
 */
export function withDirectionParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (Number.isNaN(last) || last < 0xac00 || last > 0xd7a3) return `${word}로`;
  const jongseong = (last - 0xac00) % 28;
  return jongseong === 0 || jongseong === 8 ? `${word}로` : `${word}으로`;
}
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
  originId: MvpOriginId;
  startAt: string;
  returnBy: string;
  interests: MvpCategoryId[];
};
export type Candidate = {
  regionId: string;
  /** 카드·일정 제목에 쓰는 짧은 표시명. 광역시는 시도명, 도 지역은 지명만. */
  displayName: string;
  /** 표시명 아래 행정구역 줄에 쓰는 전체 행정명. 광역시는 표시명과 같다. */
  name: string;
  province: string;
  oneWayMinutes: number;
  localMinutes: number;
  attractions: RegionAttraction[];
  interestLabels: string[];
};
type CandidateGroup = {
  key: string;
  displayName: string;
  name: string;
  province: string;
};
type CandidateAccumulator = Candidate & {
  attractionMap: Map<string, RegionAttraction>;
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
    ORIGINS.some((origin) => origin.id === input.originId) &&
    input.interests.length > 0
  );
}

function candidateGroup(mapping: RegionMapping): CandidateGroup {
  const isMetropolitan = METROPOLITAN_SUFFIX.test(mapping.province);
  return isMetropolitan
    ? {
        key: `metropolitan:${mapping.province}`,
        displayName: mapping.province,
        name: mapping.province,
        province: mapping.province,
      }
    : {
        key: `municipality:${mapping.province}:${mapping.district}`,
        displayName: municipalityDisplayName(mapping.district),
        name: mapping.name,
        province: mapping.province,
      };
}

export function searchCandidates(input: SearchInput): Candidate[] {
  if (!validOneNight(input)) return [];
  const start = kstDate(input.startAt),
    end = kstDate(input.returnBy);
  const origin = ORIGINS.find((item) => item.id === input.originId);
  const from = origin ? zoneIndex.get(origin.zoneId) : undefined;
  if (from === undefined) return [];
  const candidates = new Map<string, CandidateAccumulator>();
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
    const localMinutes =
      Math.floor((end.getTime() - start.getTime()) / 60_000) - minutes * 2;
    if (localMinutes < 8 * 60) continue;
    const group = candidateGroup(row);
    const existing = candidates.get(group.key);
    if (existing) {
      for (const [contentId, attraction] of attractionMap)
        existing.attractionMap.set(contentId, attraction);
      if (minutes < existing.oneWayMinutes) {
        existing.regionId = regionId;
        existing.oneWayMinutes = minutes;
        existing.localMinutes = localMinutes;
      }
      continue;
    }
    candidates.set(group.key, {
      regionId,
      displayName: group.displayName,
      name: group.name,
      province: group.province,
      oneWayMinutes: minutes,
      localMinutes,
      attractions: [],
      attractionMap,
      interestLabels: input.interests.map(
        (id) => INTERESTS.find((item) => item.id === id)?.label ?? id,
      ),
    });
  }
  return [...candidates.values()]
    .map(({ attractionMap, ...candidate }) => ({
      ...candidate,
      attractions: [...attractionMap.values()],
    }))
    .filter((candidate) => candidate.attractions.length >= 3)
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

export type ItineraryShortfall = {
  /** "지금은 계획을 만들 수 없어요" 아래에 붙는 한 줄 사유. */
  reason: string;
  /** 왕복 일반 예상 이동시간(시간, 소수 첫째 자리). */
  roundTripHours: number;
  /** 1·2일차별 시간 경계 산술 근거. 관광지 근거 부족이면 비어 있다. */
  days: Array<{ day: 1 | 2; note: string }>;
};

export type ItineraryAssessment =
  { feasible: true } | ({ feasible: false } & ItineraryShortfall);

/**
 * 선택 후보로 최소 시간표를 만들 수 있는지 산술로 판정한다.
 *
 * 데이터·API 장애가 아니라 정상 예외다(DESIGN_TOKENS.md 「결과 없음 · 일정 생성 불가 · 데이터 장애」).
 * `복귀 - 출발 - 왕복 이동시간`에서 고정 휴식(21:00~07:00)을 뺀 현지 가용시간이
 * 점심·저녁·관광 최소 1곳(각 1시간)을 겹치지 않게 담지 못하면 `feasible: false`를 반환한다.
 * 여기서는 식사 시간대(11:30~13:30·17:30~19:30) 배치까지 검사하지 않는다.
 * 그 블록 배치 엔진은 MVP 구현계획 6단계(`lib/itinerary-scheduler.ts`)의 범위다.
 */
export function assessItinerary(
  input: SearchInput,
  candidate: Pick<Candidate, "oneWayMinutes" | "attractions">,
): ItineraryAssessment {
  const oneWay = candidate.oneWayMinutes;
  const roundTripHours = Math.round((oneWay * 2) / 6) / 10;
  const attractions = new Map(
    candidate.attractions.map((item) => [item.contentId, item]),
  );
  if (attractions.size < 3)
    return {
      feasible: false,
      roundTripHours,
      reason:
        "이 지역에서 참고 계획에 넣을 공식 분류 관광지를 3곳 이상 찾지 못했어요.",
      days: [],
    };

  const start = kstDate(input.startAt);
  const end = kstDate(input.returnBy);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return {
      feasible: false,
      roundTripHours,
      reason: "출발·복귀 시각을 다시 확인해 주세요.",
      days: [],
    };

  const arrival = new Date(start.getTime() + oneWay * 60_000);
  const departure = new Date(end.getTime() - oneWay * 60_000);
  const restStart = atKstHour(start, REST_START_HOUR);
  const resume = atKstHour(end, DAY_RESUME_HOUR);

  const day1Local = Math.max(
    0,
    Math.round((restStart.getTime() - arrival.getTime()) / 60_000),
  );
  const day2Local = Math.max(
    0,
    Math.round((departure.getTime() - resume.getTime()) / 60_000),
  );
  if (day1Local + day2Local >= MIN_LOCAL_MINUTES) return { feasible: true };

  const day1Note =
    arrival.getTime() >= restStart.getTime()
      ? `${kstClock.format(start)} 출발 → ${kstClock.format(arrival)} 도착. 도착 시각이 이미 휴식 시작(21:00)을 지나 관광·식사를 넣지 못해요.`
      : `${kstClock.format(start)} 출발 → ${kstClock.format(arrival)} 도착. 휴식 시작(21:00)까지 ${formatHoursAndMinutes(day1Local / 60)}만 남아 관광·식사를 다 넣지 못해요.`;
  const day2Note =
    departure.getTime() <= resume.getTime()
      ? "2일차 07:00 전에 복귀를 시작해야 해 현지에서 쓸 시간이 없어요."
      : `07:00 재개 → ${kstClock.format(departure)} 복귀 출발. 관광 1시간과 점심·저녁을 넣을 여유가 없어요.`;

  return {
    feasible: false,
    roundTripHours,
    reason: `왕복 이동에 약 ${roundTripHours}시간이 들어, 이 출발·복귀 시각 사이에는 관광 한 곳과 점심·저녁을 겹치지 않게 넣을 시간이 부족해요.`,
    days: [
      { day: 1, note: day1Note },
      { day: 2, note: day2Note },
    ],
  };
}

export function createSchedule(
  input: SearchInput,
  candidate: Candidate,
  restaurants: Restaurant[],
): ScheduleItem[] | null {
  if (!assessItinerary(input, candidate).feasible) return null;
  const attractions = [
    ...new Map(
      candidate.attractions.map((item) => [item.contentId, item]),
    ).values(),
  ];
  if (attractions.length < 3) return null;
  const distinctRestaurants = [
    ...new Map(
      restaurants.map((restaurant) => [restaurant.contentId, restaurant]),
    ).values(),
  ];
  const origin = ORIGINS.find((item) => item.id === input.originId);
  if (!origin) return null;
  const pick = (index: number) => attractions[index % attractions.length];
  const mealRestaurant = (index: number) =>
    distinctRestaurants[index]?.name ?? "추천할 식당을 더 찾지 못했어요";
  return [
    {
      day: 1,
      time: input.startAt.slice(11),
      type: "이동",
      title: `${withDirectionParticle(candidate.displayName)} 출발`,
    },
    { day: 1, time: "11:30", type: "점심", title: mealRestaurant(0) },
    { day: 1, time: "13:30", type: "관광", title: pick(0).title },
    { day: 1, time: "15:00", type: "관광", title: pick(1).title },
    { day: 1, time: "17:30", type: "저녁", title: mealRestaurant(1) },
    { day: 2, time: "09:00", type: "관광", title: pick(2).title },
    { day: 2, time: "11:30", type: "점심", title: mealRestaurant(2) },
    { day: 2, time: "13:30", type: "관광", title: pick(3).title },
    { day: 2, time: "17:30", type: "저녁", title: mealRestaurant(3) },
    {
      day: 2,
      time: input.returnBy.slice(11),
      type: "이동",
      title: `${withDirectionParticle(origin.label)} 복귀`,
    },
  ];
}
