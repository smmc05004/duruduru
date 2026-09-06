export const MVP_CATEGORY_IDS = [
  "nature",
  "history",
  "rest",
  "culture",
  "leisure",
] as const;

export type MvpCategoryId = (typeof MVP_CATEGORY_IDS)[number];

export type RegionMapping = {
  regionId: string;
  name: string;
  province: string;
  district: string;
  lDongRegnCd: string;
  lDongSignguCd: string;
  lDongRegnNm: string;
  lDongSignguNm: string;
};

export type RegionAttraction = {
  contentId: string;
  title: string;
  categoryId: MvpCategoryId;
  contentTypeId: string;
  address: string;
  imageUrl: string;
  mapX: string;
  mapY: string;
  cat1: string;
  cat2: string;
  cat3: string;
};

export type RegionProfile = Pick<
  RegionMapping,
  | "regionId"
  | "name"
  | "province"
  | "district"
  | "lDongRegnCd"
  | "lDongSignguCd"
> & {
  attractions: RegionAttraction[];
};

export type RegionProfileDocument = {
  schemaVersion: 1;
  source: {
    tourApi: "KorService2/areaBasedList2";
    mappingGeneratedAt: string;
    categories: Array<{
      id: MvpCategoryId;
      filters: Array<{
        cat1?: string;
        cat2?: string;
        contentTypeId?: string;
      }>;
    }>;
    requestCount: number;
  };
  generatedAt: string;
  profiles: RegionProfile[];
};

export const MINIMUM_ATTRACTIONS_PER_CATEGORY = 3;

export function attractionsForCategory(
  profile: RegionProfile,
  categoryId: MvpCategoryId,
): RegionAttraction[] {
  const byContentId = new Map<string, RegionAttraction>();
  for (const attraction of profile.attractions) {
    if (attraction.categoryId !== categoryId) continue;
    byContentId.set(attraction.contentId, attraction);
  }
  return [...byContentId.values()];
}

export function supportsCategory(
  profile: RegionProfile,
  categoryId: MvpCategoryId,
): boolean {
  return (
    attractionsForCategory(profile, categoryId).length >=
    MINIMUM_ATTRACTIONS_PER_CATEGORY
  );
}
