export {
  MVP_CATEGORY_IDS,
  type MvpCategoryId,
  CLASSIFICATION_VERSION,
} from "@/lib/interest-classification";
import type { MvpCategoryId } from "@/lib/interest-classification";

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
  /**
   * 하위 호환용 단일 관심사 태그. 구 수집본(schemaVersion 1)에서 나온 값이며,
   * 새 판정은 공통 해석기 `classifyInterests`로 `categories`를 계산한다.
   */
  categoryId: MvpCategoryId;
  contentTypeId: string;
  address: string;
  imageUrl: string;
  mapX: string;
  mapY: string;
  cat1: string;
  cat2: string;
  cat3: string;
  /** 새 공식 분류(`lclsSystmCode2`). 구 수집본에는 없어 선택 필드다. */
  lclsSystm1?: string;
  lclsSystm2?: string;
  lclsSystm3?: string;
  /** TourAPI 원천 수정일(`modifiedtime`). 구 수집본에는 없다. */
  sourceModifiedAt?: string;
  /** 이 레코드를 판정한 공식 분류 목록 버전. 구 수집본에는 없다. */
  classificationVersion?: string;
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
