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
  E2_ITINERARY_ALGORITHM_VERSION,
  scheduleTrip,
  validateSearchInput,
  type SchedulingCache,
} from "@/lib/mvp-phase-two-planner";
import {
  type Attraction,
  type Candidate,
  type CandidateRecommendation,
  type RecommendedCandidate,
  type RecommendationRole,
  type SearchInput,
  type SearchResponse,
} from "@/lib/mvp-phase-two-types";
import { originRegion } from "@/lib/origin-regions";

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

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;
const compareNumber = (left: number, right: number) => left - right;
const categoryLabels = new Map<MvpCategoryId, string>([
  ["nature", "자연"],
  ["history", "역사"],
  ["rest", "휴양"],
  ["culture", "문화"],
  ["leisure", "레저"],
]);

function actualDistanceMetrics(
  candidate: Omit<Candidate, "recommendation" | "reasons">,
) {
  let distancePairCount = 0;
  let validDistancePairCount = 0;
  let distanceTotal = 0;
  for (const day of [1, 2] as const) {
    const attractions = candidate.preview.blocks
      .filter((block) => block.kind === "attraction" && block.day === day)
      .toSorted((left, right) => compareText(left.startAt, right.startAt));
    for (let index = 1; index < attractions.length; index++) {
      distancePairCount++;
      const first = attractions[index - 1].attraction?.coordinates ?? null;
      const second = attractions[index].attraction?.coordinates ?? null;
      if (!first || !second) continue;
      const latitude = Math.PI / 180;
      const h =
        Math.sin(((second.latitude - first.latitude) * latitude) / 2) ** 2 +
        Math.cos(first.latitude * latitude) *
          Math.cos(second.latitude * latitude) *
          Math.sin(((second.longitude - first.longitude) * latitude) / 2) ** 2;
      const distance = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
      if (!Number.isFinite(distance)) continue;
      validDistancePairCount++;
      distanceTotal += distance;
    }
  }
  return {
    distancePairCount,
    validDistancePairCount,
    averageDistanceKm:
      validDistancePairCount > 0
        ? distanceTotal / validDistancePairCount
        : null,
    proximityComparable:
      distancePairCount > 0 && distancePairCount === validDistancePairCount,
  };
}

function recommendationFor(
  candidate: Omit<Candidate, "recommendation" | "reasons">,
  role: RecommendationRole,
  requestedInterests: MvpCategoryId[],
): CandidateRecommendation {
  const { metrics } = candidate.preview;
  const fulfilled = requestedInterests.filter((interest) =>
    metrics.fulfilledInterests.includes(interest),
  );
  const distance = actualDistanceMetrics(candidate);
  return {
    role,
    algorithmVersion: "e1-v1",
    roundTripMinutes: candidate.oneWayMinutes * 2,
    fulfilledInterestCount: fulfilled.length,
    attractionCount: metrics.attractionCount,
    categoryDiversity: metrics.categoryDiversity,
    localFreeMinutes: metrics.freeMinutes,
    ...distance,
    requestedInterests: [...requestedInterests],
    missingInterests: requestedInterests.filter(
      (interest) => !fulfilled.includes(interest),
    ),
  };
}

function compareByRole(
  role: RecommendationRole,
  left: RecommendedCandidate,
  right: RecommendedCandidate,
) {
  const a = left.recommendation;
  const b = right.recommendation;
  let result = 0;
  if (role === "easy")
    result =
      compareNumber(a.roundTripMinutes, b.roundTripMinutes) ||
      compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
      compareNumber(b.attractionCount, a.attractionCount) ||
      compareNumber(b.categoryDiversity, a.categoryDiversity);
  if (role === "interest")
    result =
      compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
      compareNumber(b.categoryDiversity, a.categoryDiversity) ||
      compareNumber(b.attractionCount, a.attractionCount) ||
      compareNumber(a.roundTripMinutes, b.roundTripMinutes);
  if (role === "relaxed") {
    result =
      compareNumber(
        Number(b.proximityComparable),
        Number(a.proximityComparable),
      ) || compareNumber(b.localFreeMinutes, a.localFreeMinutes);
    if (!result && a.proximityComparable && b.proximityComparable)
      result = compareNumber(a.averageDistanceKm!, b.averageDistanceKm!);
    result ||=
      compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
      compareNumber(a.roundTripMinutes, b.roundTripMinutes);
  }
  return result || compareText(left.groupId, right.groupId);
}

function reasonsFor(recommendation: CandidateRecommendation): string[] {
  const roleTitle: Record<RecommendationRole, string> = {
    easy: "이동 부담을 줄인 여행",
    interest: "관심사를 깊게 즐기는 여행",
    relaxed: "여유롭게 머무는 여행",
  };
  const fulfilled = recommendation.requestedInterests.filter(
    (interest) => !recommendation.missingInterests.includes(interest),
  );
  const included = fulfilled
    .map((interest) => categoryLabels.get(interest))
    .join(" · ");
  const missing = recommendation.missingInterests
    .map((interest) => categoryLabels.get(interest))
    .join(" · ");
  return [
    `${roleTitle[recommendation.role]} · 왕복 자동차 일반 예상시간 ${recommendation.roundTripMinutes}분`,
    `${included || "선택 관심사 없음"} 포함 · 관광 ${recommendation.attractionCount}곳 · 현지 낮 자유시간 ${recommendation.localFreeMinutes}분${missing ? ` · ${missing} 미포함` : ""}`,
    ...(recommendation.proximityComparable
      ? [
          `당일 연속 관광지 ${recommendation.distancePairCount}쌍의 직선거리 근거를 확인했어요. 지역 내부 이동시간은 계산하지 않아요.`,
        ]
      : ["장소 간 근접성은 확인하지 못했어요."]),
    "대표 존은 출발지에서 일반 예상시간이 가장 짧은 존이며 실제 장소 주소까지의 시간이 아니에요.",
    "지역 내부 이동시간과 실제 운영 여부는 반영하지 않은 참고 계획이에요.",
  ];
}

export function selectCandidateRoles(
  candidates: Array<Omit<Candidate, "recommendation" | "reasons">>,
  requestedInterests: MvpCategoryId[],
): RecommendedCandidate[] {
  const prepared = candidates.map((candidate) => {
    const recommendation = recommendationFor(
      candidate,
      "easy",
      requestedInterests,
    );
    return {
      ...candidate,
      recommendation,
      reasons: reasonsFor(recommendation),
    };
  });
  const selected: RecommendedCandidate[] = [];
  for (const role of ["easy", "interest", "relaxed"] as const) {
    const winner = prepared
      .filter(
        (candidate) =>
          !selected.some((item) => item.groupId === candidate.groupId),
      )
      .map((candidate) => {
        const recommendation = { ...candidate.recommendation, role };
        return {
          ...candidate,
          recommendation,
          reasons: reasonsFor(recommendation),
        };
      })
      .toSorted((left, right) => compareByRole(role, left, right))[0];
    if (winner) selected.push(winner);
  }
  return selected;
}
export function searchPhaseTwo(
  input: SearchInput,
  searchId: string,
  searchedAt = new Date().toISOString(),
): SearchResponse {
  const validated = validateSearchInput(input);
  if (!validated.ok) return { kind: "input-error", message: validated.reason };
  const origin = originRegion(input.originId)!;
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
  const candidates: Array<Omit<Candidate, "recommendation" | "reasons">> = [];
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
      itineraryAlgorithmVersion: E2_ITINERARY_ALGORITHM_VERSION,
    });
  }
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
    candidates: selectCandidateRoles(candidates, input.interests),
    profileGeneratedAt: profiles.generatedAt,
  };
}
