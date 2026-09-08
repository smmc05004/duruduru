import profiles from "@/data/region-profiles.json";
import mapping from "@/data/region-mapping.json";
import travelTimes from "@/data/ktdb/interregional-travel-times-2024.json";
import type {
  MvpCategoryId,
  RegionAttraction,
  RegionMapping,
  RegionProfile,
} from "@/lib/mvp-region-data";
import { groupForMapping } from "@/lib/mvp-phase-two-regions";
import {
  distinctAttractions,
  scheduleTrip,
  validateSearchInput,
  type SchedulingCache,
} from "@/lib/mvp-phase-two-planner";
import {
  ORIGINS,
  type Attraction,
  type Candidate,
  type SearchInput,
  type SearchResponse,
} from "@/lib/mvp-phase-two-types";

export { groupForMapping } from "@/lib/mvp-phase-two-regions";
const zoneIndices = new Map(
  travelTimes.regions.map((zone, index) => [zone.id, index]),
);
const mappings = new Map<string, RegionMapping>(
  mapping.mappings.map((row) => [row.regionId, row]),
);
const profileIndex = new Map<string, RegionProfile>(
  (profiles.profiles as RegionProfile[]).map((profile) => [
    profile.regionId,
    profile,
  ]),
);
export function regionMappingFor(regionId: string): RegionMapping | null {
  return mappings.get(regionId) ?? null;
}
function categoriesFor(place: RegionAttraction): MvpCategoryId[] {
  const result: MvpCategoryId[] = [];
  if (place.cat1 === "A01") result.push("nature");
  if (place.cat2 === "A0201") result.push("history");
  if (place.cat2 === "A0202") result.push("rest");
  if (place.cat2 === "A0206" || place.contentTypeId === "14")
    result.push("culture");
  if (place.cat1 === "A03" || place.contentTypeId === "28")
    result.push("leisure");
  return result;
}
function normalizedAttraction(
  place: RegionAttraction,
  regionId: string,
): Attraction {
  const latitude = Number(place.mapY),
    longitude = Number(place.mapX);
  const coordinates =
    place.mapX.trim() &&
    place.mapY.trim() &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude > 0 &&
    latitude <= 90 &&
    longitude > 0 &&
    longitude <= 180
      ? { latitude, longitude }
      : null;
  return {
    contentId: place.contentId,
    contentTypeId: place.contentTypeId,
    regionId,
    title: place.title,
    address: place.address,
    imageUrl: "",
    coordinates,
    categories: categoriesFor(place),
    cat1: place.cat1,
    cat2: place.cat2,
    cat3: place.cat3,
  };
}
export function attractionFor(
  contentId: string,
  regionId: string,
): Attraction | null {
  const place = profileIndex
    .get(regionId)
    ?.attractions.find((item) => item.contentId === contentId);
  return place ? normalizedAttraction(place, regionId) : null;
}
export function searchPhaseTwo(
  input: SearchInput,
  searchId: string,
  searchedAt = new Date().toISOString(),
): SearchResponse {
  const validated = validateSearchInput(input);
  if (!validated.ok) return { kind: "input-error", message: validated.reason };
  const origin = ORIGINS.find((item) => item.id === input.originId)!;
  const originIndex = zoneIndices.get(origin.zoneId),
    originMapping = mappings.get(origin.zoneId);
  if (originIndex === undefined || !originMapping)
    return {
      kind: "data-error",
      message: "출발 지역의 매핑 또는 일반 예상시간 데이터를 읽지 못했어요.",
    };
  const originGroup = groupForMapping(originMapping).groupId;
  type Group = ReturnType<typeof groupForMapping> & {
    representativeZoneId: string;
    oneWayMinutes: number;
    memberRegionIds: string[];
    places: Map<string, Attraction>;
  };
  const groups = new Map<string, Group>();
  for (const [regionId, row] of mappings) {
    const to = zoneIndices.get(regionId),
      minutes =
        to === undefined ? null : travelTimes.minutes[originIndex]?.[to];
    const descriptor = groupForMapping(row);
    if (
      descriptor.groupId === originGroup ||
      typeof minutes !== "number" ||
      minutes <= 0 ||
      !Number.isFinite(minutes)
    )
      continue;
    let group = groups.get(descriptor.groupId);
    if (!group) {
      group = {
        ...descriptor,
        representativeZoneId: regionId,
        oneWayMinutes: minutes,
        memberRegionIds: [],
        places: new Map(),
      };
      groups.set(group.groupId, group);
    }
    group.memberRegionIds.push(regionId);
    if (
      minutes < group.oneWayMinutes ||
      (minutes === group.oneWayMinutes && regionId < group.representativeZoneId)
    ) {
      group.oneWayMinutes = minutes;
      group.representativeZoneId = regionId;
    }
    for (const item of profileIndex.get(regionId)?.attractions ?? []) {
      const attraction = normalizedAttraction(item, regionId);
      if (!attraction.categories.some((id) => input.interests.includes(id)))
        continue;
      const previous = group.places.get(attraction.contentId);
      if (!previous || attraction.regionId < previous.regionId)
        group.places.set(attraction.contentId, attraction);
    }
  }
  const candidates: Candidate[] = [];
  const timingCache: SchedulingCache = new Map();
  let classifiedGroups = 0,
    timingFailures = 0;
  for (const group of groups.values()) {
    const attractions = distinctAttractions([...group.places.values()]);
    if (attractions.length < 3) continue;
    classifiedGroups++;
    const preview = scheduleTrip(
      input,
      group.oneWayMinutes,
      attractions,
      undefined,
      [],
      timingCache,
    );
    if (!preview.ok) {
      timingFailures++;
      continue;
    }
    candidates.push({
      groupId: group.groupId,
      memberRegionIds: group.memberRegionIds.sort(),
      representativeZoneId: group.representativeZoneId,
      displayName: group.displayName,
      name: group.name,
      province: group.province,
      oneWayMinutes: group.oneWayMinutes,
      attractions,
      preview: { blocks: preview.blocks, metrics: preview.metrics },
      metadata: {
        profileGeneratedAt: profiles.generatedAt,
        travelTimeGeneratedAt: travelTimes.generatedAt,
        networkYear: travelTimes.source.networkYear,
        travelTimeSource: `${travelTimes.source.provider} · ${travelTimes.source.dataset}`,
        representativePoint: travelTimes.source.representativePoint,
        searchedAt,
      },
      reasons: [
        `선택 관심사 ${preview.metrics.fulfilledInterests.length}/${input.interests.length}개 · 관광 ${preview.metrics.attractionCount}곳`,
        "공식 분류와 좌표를 바탕으로 주변 장소를 함께 구성",
        "대표 존은 출발지에서 일반 예상시간이 가장 짧은 존이며 실제 장소 주소까지의 시간이 아니에요.",
        "지역 내부 이동시간과 실제 운영 여부는 반영하지 않은 참고 계획이에요.",
      ],
    });
  }
  candidates.sort(
    (a, b) =>
      b.preview.metrics.fulfilledInterests.length -
        a.preview.metrics.fulfilledInterests.length ||
      b.preview.metrics.attractionCount - a.preview.metrics.attractionCount ||
      b.preview.metrics.categoryDiversity -
        a.preview.metrics.categoryDiversity ||
      (a.preview.metrics.averageDistanceKm ?? Infinity) -
        (b.preview.metrics.averageDistanceKm ?? Infinity) ||
      a.oneWayMinutes - b.oneWayMinutes ||
      (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0),
  );
  if (!candidates.length)
    return {
      kind: "no-results",
      message:
        classifiedGroups && timingFailures
          ? "왕복 이동·여행 중 식사·낮 관광과 여유시간을 함께 확보할 수 있는 지역이 없어요. 출발을 앞당기거나 복귀를 늦춰 주세요."
          : "선택 관심사의 서로 다른 관광지를 3곳 이상 확인할 수 있는 지역이 없어요. 관심사를 바꿔 주세요.",
    };
  return {
    kind: "success",
    searchId,
    candidates: candidates.slice(0, 3),
    profileGeneratedAt: profiles.generatedAt,
  };
}
