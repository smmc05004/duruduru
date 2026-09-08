import { readFile } from "node:fs/promises";
import path from "node:path";
import mappings from "@/data/region-mapping.json";
import { attractionFor } from "@/lib/mvp-phase-two-search";
import { groupForMapping } from "@/lib/mvp-phase-two-regions";
import type { RegionMapping } from "@/lib/mvp-region-data";
import type { Restaurant } from "@/lib/mvp-phase-two-types";
import { licensedTourImage, safeDetailText } from "@/lib/attraction-detail";
import { asRecord, requestTourApi } from "@/lib/tour-api";

export type RestaurantRequest = {
  groupId: string;
  visits: Array<{ contentId: string; regionId: string }>;
};
export type RestaurantResponse = {
  kind: "success" | "partial" | "data-error";
  restaurants: Restaurant[];
  queriedRegionIds: string[];
  failedRegionIds: string[];
  truncated: boolean;
  fetchedAt: string;
  message: string;
};

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^0-9a-z가-힣]/gu, "");
const digits = (value: unknown) => safeDetailText(value).replace(/\D/g, "");
const regionMappings: RegionMapping[] = mappings.mappings;

/** Resolve untrusted visit references against the server snapshot and canonical group. */
export function validateRestaurantRequest(
  raw: unknown,
): { regions: RegionMapping[]; truncated: boolean } | null {
  const source = asRecord(raw);
  if (
    typeof source.groupId !== "string" ||
    source.groupId.length > 160 ||
    !Array.isArray(source.visits) ||
    source.visits.length > 6
  )
    return null;
  const members = regionMappings.filter(
    (region) => groupForMapping(region).groupId === source.groupId,
  );
  if (!members.length) return null;
  const memberIds = new Set(members.map((region) => region.regionId));
  const contentIds = new Set<string>();
  const frequency = new Map<string, { count: number; first: number }>();
  for (const [index, value] of source.visits.entries()) {
    const visit = asRecord(value);
    if (
      typeof visit.contentId !== "string" ||
      !/^\d{1,12}$/.test(visit.contentId) ||
      typeof visit.regionId !== "string" ||
      !memberIds.has(visit.regionId) ||
      contentIds.has(visit.contentId) ||
      !attractionFor(visit.contentId, visit.regionId)
    )
      return null;
    contentIds.add(visit.contentId);
    const existing = frequency.get(visit.regionId);
    frequency.set(visit.regionId, {
      count: (existing?.count ?? 0) + 1,
      first: existing?.first ?? index,
    });
  }
  const relevant = members
    .filter((region) => !frequency.size || frequency.has(region.regionId))
    .toSorted(
      (a, b) =>
        (frequency.get(b.regionId)?.count ?? 0) -
          (frequency.get(a.regionId)?.count ?? 0) ||
        (frequency.get(a.regionId)?.first ?? 0) -
          (frequency.get(b.regionId)?.first ?? 0) ||
        a.regionId.localeCompare(b.regionId),
    );
  return { regions: relevant.slice(0, 3), truncated: relevant.length > 3 };
}

type FoodEvidence = {
  keywords: Map<string, string[]>;
  phones: Set<string>;
  identities: Set<string>;
  phonelessIdentities: Set<string>;
};
async function optionalJson(file: string): Promise<Record<string, unknown>> {
  try {
    return asRecord(
      JSON.parse(
        await readFile(path.join(process.cwd(), "data", file), "utf8"),
      ),
    );
  } catch {
    return {};
  }
}
async function loadFoodEvidence(): Promise<FoodEvidence> {
  const [culture, certificates] = await Promise.all([
    optionalJson("food-culture-keywords.json"),
    optionalJson("excellent-restaurant-certifications.json"),
  ]);
  const keywords = new Map<string, string[]>();
  for (const value of Array.isArray(culture.regions) ? culture.regions : []) {
    const record = asRecord(value);
    if (typeof record.regionId === "string" && Array.isArray(record.keywords)) {
      keywords.set(
        record.regionId,
        record.keywords
          .filter(
            (word): word is string =>
              typeof word === "string" && Boolean(word.trim()),
          )
          .map(normalize)
          .filter(Boolean),
      );
    }
  }
  const phones = new Set<string>(),
    identities = new Set<string>(),
    phonelessIdentities = new Set<string>();
  for (const value of Array.isArray(certificates.certifications)
    ? certificates.certifications
    : []) {
    const record = asRecord(value),
      phone = digits(record.phone),
      name = normalize(safeDetailText(record.name));
    if (phone) phones.add(phone);
    if (!name) continue;
    for (const addressValue of [record.roadAddress, record.lotAddress]) {
      const address = normalize(safeDetailText(addressValue));
      if (!address) continue;
      const identity = `${name}|${address}`;
      identities.add(identity);
      if (!phone) phonelessIdentities.add(identity);
    }
  }
  return { keywords, phones, identities, phonelessIdentities };
}

function restaurantFrom(
  item: Record<string, unknown>,
  regionId: string,
  fetchedAt: string,
  evidence: FoodEvidence,
): Restaurant | null {
  const contentId = safeDetailText(item.contentid),
    name = safeDetailText(item.title);
  if (
    !/^\d{1,12}$/.test(contentId) ||
    !name ||
    (item.contenttypeid && String(item.contenttypeid) !== "39")
  )
    return null;
  const address = [safeDetailText(item.addr1), safeDetailText(item.addr2)]
    .filter(Boolean)
    .join(" ");
  const phone = digits(item.tel),
    normalizedName = normalize(name);
  const identities = [safeDetailText(item.addr1), address]
    .filter(Boolean)
    .map((value) => `${normalizedName}|${normalize(value)}`);
  const certified =
    Boolean(phone && evidence.phones.has(phone)) ||
    identities.some((identity) =>
      (phone ? evidence.phonelessIdentities : evidence.identities).has(
        identity,
      ),
    );
  const latitude = Number(item.mapy),
    longitude = Number(item.mapx);
  const coordinates =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= 33 &&
    latitude <= 39 &&
    longitude >= 124 &&
    longitude <= 132
      ? { latitude, longitude }
      : null;
  return {
    contentId,
    regionId,
    name,
    address,
    phone,
    coordinates,
    certified,
    foodCultureMatch: (evidence.keywords.get(regionId) ?? []).some((word) =>
      normalizedName.includes(word),
    ),
    imageUrl: licensedTourImage(item),
    fetchedAt,
  };
}

export async function collectRestaurants(
  selection: { regions: RegionMapping[]; truncated: boolean },
  requestSignal?: AbortSignal,
): Promise<RestaurantResponse> {
  const fetchedAt = new Date().toISOString();
  const budget = AbortSignal.timeout(28_000);
  const signal = requestSignal
    ? AbortSignal.any([budget, requestSignal])
    : budget;
  const evidence = await loadFoodEvidence();
  const results: Array<{
    items: Restaurant[];
    failed: boolean;
    truncated: boolean;
  }> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < selection.regions.length) {
      const index = cursor++,
        region = selection.regions[index];
      const result = {
        items: [] as Restaurant[],
        failed: false,
        truncated: false,
      };
      results[index] = result;
      for (let page = 1; page <= 3; page++) {
        try {
          signal.throwIfAborted();
          const response = await requestTourApi(
            "areaBasedList2",
            {
              lDongRegnCd: region.lDongRegnCd,
              lDongSignguCd: region.lDongSignguCd,
              contentTypeId: "39",
              numOfRows: "100",
              pageNo: String(page),
              arrange: "A",
            },
            signal,
          );
          result.items.push(
            ...response.items.slice(0, 100).flatMap((item) => {
              const restaurant = restaurantFrom(
                item,
                region.regionId,
                fetchedAt,
                evidence,
              );
              return restaurant ? [restaurant] : [];
            }),
          );
          const more =
            response.totalCount === null
              ? response.items.length >= 100
              : response.totalCount > page * 100;
          if (!more) break;
          if (page === 3) result.truncated = true;
        } catch {
          result.failed = true;
          break;
        }
      }
    }
  }
  await Promise.all([worker(), worker()]);
  const unique = new Map<string, Restaurant>();
  for (const result of results)
    for (const item of result.items)
      if (!unique.has(item.contentId)) unique.set(item.contentId, item);
  const restaurants = [...unique.values()];
  const failedRegionIds = selection.regions
    .filter((_, index) => results[index].failed)
    .map((region) => region.regionId);
  const allFailed =
    results.every((result) => result.failed) && restaurants.length === 0;
  const truncated =
    selection.truncated || results.some((result) => result.truncated);
  const kind = allFailed
    ? "data-error"
    : failedRegionIds.length
      ? "partial"
      : "success";
  return {
    kind,
    restaurants,
    queriedRegionIds: selection.regions.map((region) => region.regionId),
    failedRegionIds,
    truncated,
    fetchedAt,
    message: allFailed
      ? "음식점 정보를 불러오지 못했어요. 관광 일정은 유지되며 다시 시도할 수 있어요."
      : failedRegionIds.length
        ? "일부 지역의 음식점 정보를 불러오지 못했어요. 찾은 식당은 유지했으며 다시 시도할 수 있어요."
        : truncated
          ? "조회 상한에 따라 일부 지역·페이지의 음식점만 확인했어요."
          : restaurants.length
            ? "관광 장소 주변 지역의 음식점을 확인했어요."
            : "추천할 식당을 더 찾지 못했어요",
  };
}
