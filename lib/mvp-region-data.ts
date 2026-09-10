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
   * 공통 해석기 `classifyInterests`가 판정한 관심사 목록. schemaVersion 2 수집본의
   * 정본 필드다. 검색·후보 판정은 저장값을 신뢰하지 않고 다시 해석하지만, 수집
   * 시점의 판정 근거를 보존한다.
   */
  categories: MvpCategoryId[];
  /** 어느 분류 경로로 판정했는지(`lcls` 우선, `legacy` 하위 호환). */
  classificationBasis?: "lcls" | "legacy";
  contentTypeId: string;
  address: string;
  imageUrl: string;
  /** TourAPI `cpyrhtDivCd`. 이미지 존재로 사용권한을 추정하지 않는다. */
  imageCopyright?: string;
  mapX: string;
  mapY: string;
  cat1: string;
  cat2: string;
  cat3: string;
  /** 새 공식 분류(`lclsSystmCode2`). 구 수집본에는 없어 선택 필드다. */
  lclsSystm1?: string;
  lclsSystm2?: string;
  lclsSystm3?: string;
  /** 공식 목록에 없는 `lclsSystm*` 코드. 임의로 덮지 않고 보존한다. */
  unresolvedLcls?: string[];
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
  schemaVersion: 2;
  classificationVersion: string;
  source: {
    tourApi: "KorService2/areaBasedList2";
    querySpecs: string[];
    mappingGeneratedAt: string;
    requestCount: number;
    retryCount: number;
    failedRequestCount: number;
    runId: string;
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
    if (!attraction.categories.includes(categoryId)) continue;
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
