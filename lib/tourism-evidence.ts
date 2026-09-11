/**
 * 중심 관광지 근거 소비 (T5 / 기획 D4).
 *
 * `data/tourism-evidence.json`(T4 산출물, schemaVersion 1)의 지역별
 * `matched[contentId]` 인덱스를 런타임에 O(1)로 조회한다. 전체 비교는 T4 수집기가
 * 이미 끝냈고, 여기서는 **실제 초안에 배치된 관광지**에 한해서만 근거를 읽는다.
 *
 * 규칙:
 * - `nonItineraryCategory`(숙박·쇼핑·교통) 허브 매치는 일정 근거·점수에서 제외한다.
 * - 점수의 근거 장소는 초안에 배치된 관광지여야 한다. 이 모듈은 후보 지역의 모든
 *   원천 명소를 훑지 않는다. 호출자가 배치된 관광지 목록만 넘긴다.
 * - 중심 자료가 없는 지역은 점수 0의 사유를 보존하고 지역 매력 0으로 표현하지 않는다.
 */
import evidence from "@/data/tourism-evidence.json";
import type {
  Attraction,
  PurposeEvidence,
  PurposeFitInterest,
} from "@/lib/mvp-phase-two-types";
import type { MvpCategoryId } from "@/lib/mvp-region-data";
import { MVP_CATEGORY_IDS } from "@/lib/mvp-region-data";
import { facilityGroups } from "@/lib/mvp-phase-two-planner";
import { detailClassificationStrict } from "@/lib/interest-classification";

/**
 * T7 / D4 목적 적합성 지표의 고정 상수. 공식 API가 주는 수치가 아니라 T7-1에서
 * 기존 48개 사례로 제한 비교해 확정한 제품 휴리스틱이다. 선정 근거는
 * `docs/product/TOURISM_RECOMMENDATION_UPGRADE.md` D4와
 * `docs/development/TOURISM_RECOMMENDATION_T6_REPORT.md` T7 절에 있다.
 *
 * - `facilityCap`/`typeCap`: 관심사별 `fit = min(시설 수, facilityCap) + min(세부 유형 수, typeCap)`.
 *   요청하지 않은 관심사·장소를 늘려 점수를 못 올리게 하는 포화 상한. 세부 유형 수는
 *   시설(`facilityGroups`) 그룹당 대표 유형 하나만 기여한 뒤 그 대표들을 다시 중복
 *   제거해 계산한다 — 같은 시설의 세부 항목을 늘리는 것만으로 유형 수·구간이 오르지
 *   않게 하는 결함 수정(2026-09-11)이다.
 * - `bandBoundaries`: 요청 관심사 평균 `fit`를 3개 고정 구간(0·1·2)으로 나눈다.
 *   `band = bandBoundaries.filter((b) => avg >= b).length`.
 * - `matchedFacilityCap`: 보조(중심 연결) 근거 시설 수 상한.
 */
export const PURPOSE_FIT_METRIC = {
  facilityCap: 4,
  typeCap: 3,
  bandBoundaries: [4.5, 6.5] as const,
  matchedFacilityCap: 4,
} as const;

export function purposeFitBand(average: number): number {
  return PURPOSE_FIT_METRIC.bandBoundaries.filter((bound) => average >= bound)
    .length;
}

type RawMatched = {
  contentId: string;
  hubTatsCd: string;
  hubRank: number;
  method: string;
  distanceM: number;
  nonItineraryCategory: boolean;
  interestCategories: string[];
};
type RawRegion = {
  regionId: string;
  centralStatus: "ok" | "empty";
  matched: Record<string, RawMatched>;
};

const regions = evidence.regions as unknown as Record<string, RawRegion>;

export const TOURISM_EVIDENCE_VERSION = String(
  (evidence as { dataVersion?: unknown }).dataVersion ?? "",
);
export const TOURISM_EVIDENCE_BASE_YM = String(
  (evidence as { baseYm?: unknown }).baseYm ?? "",
);

const INTEREST_SET = new Set<string>(MVP_CATEGORY_IDS);
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export type HubEvidence = {
  contentId: string;
  regionId: string;
  /** 지역 내 연계 방문 중심성 순위(1~100). 전국 인기·역사적 가치·평점이 아니다. */
  hubRank: number;
  hubTatsCd: string;
  method: string;
  distanceM: number;
  interestCategories: MvpCategoryId[];
};

/**
 * 배치된 관광지 하나의 확정 연결 중심 근거. `nonItineraryCategory` 또는 순위 범위
 * 밖(hubRank ∉ [1,100])이면 null이다(연결 없음과 동일 취급).
 */
export function hubEvidenceFor(
  regionId: string,
  contentId: string,
): HubEvidence | null {
  const row = regions[regionId]?.matched?.[contentId];
  if (!row || row.nonItineraryCategory) return null;
  if (!Number.isFinite(row.hubRank) || row.hubRank < 1 || row.hubRank > 100)
    return null;
  return {
    contentId,
    regionId,
    hubRank: row.hubRank,
    hubTatsCd: row.hubTatsCd,
    method: row.method,
    distanceM: row.distanceM,
    interestCategories: (row.interestCategories ?? []).filter(
      (code): code is MvpCategoryId => INTEREST_SET.has(code),
    ),
  };
}

export function regionCentralStatus(
  regionId: string,
): "ok" | "empty" | "unknown" {
  return regions[regionId]?.centralStatus ?? "unknown";
}

/**
 * 초안 선정 시 사용하는 가벼운 신호: 배치 후보의 최적 hubRank 또는 null.
 *
 * `selectPlaces`의 정렬 비교자가 후보마다 반복 호출한다(그룹·슬롯·비교마다). 정상본
 * JSON은 불변이라 (regionId, contentId)별 결과를 메모이즈해도 결정성이 유지된다.
 */
const selectionRankCache = new Map<string, number | null>();
export function hubRankForSelection(attraction: Attraction): number | null {
  const key = `${attraction.regionId} ${attraction.contentId}`;
  if (selectionRankCache.has(key)) return selectionRankCache.get(key) ?? null;
  const rank =
    hubEvidenceFor(attraction.regionId, attraction.contentId)?.hubRank ?? null;
  selectionRankCache.set(key, rank);
  return rank;
}

const scoreValue = (hubRank: number) => 1 / Math.log2(1 + hubRank);

/**
 * D4 목적 적합성 근거. `placed`는 **실제 초안에 배치된 관광지**만 넘긴다.
 *
 * 정렬에 쓰는 값은 `fitBand`(요청 관심사별 서로 다른 시설 수·세부 유형 수에 포화
 * 상한을 적용한 지표의 고정 구간)와 `matchedFacilityCount`(보조: 확정 연결 시설 수,
 * 상한 적용)뿐이다. `score`(이전 `1/log2(1+hubRank)` 평균)는 참고용으로 보존한다.
 */
export function computePurposeEvidence(
  placed: Attraction[],
  requestedInterests: MvpCategoryId[],
  memberRegionIds: string[],
): PurposeEvidence {
  const centralEmptyRegionIds = memberRegionIds
    .filter((id) => regionCentralStatus(id) === "empty")
    .sort();
  const anyCentral = memberRegionIds.some(
    (id) => regionCentralStatus(id) === "ok",
  );

  const groups = facilityGroups(placed);
  const groupOf = (attraction: Attraction) =>
    groups.get(attraction.contentId) ?? attraction.contentId;
  const withEvidence = placed
    .map((attraction) => ({
      attraction,
      hub: hubEvidenceFor(attraction.regionId, attraction.contentId),
    }))
    .filter(
      (entry): entry is { attraction: Attraction; hub: HubEvidence } =>
        entry.hub !== null,
    );

  const { facilityCap, typeCap, matchedFacilityCap } = PURPOSE_FIT_METRIC;
  const fitByInterest: Partial<Record<MvpCategoryId, PurposeFitInterest>> = {};
  const perInterest: Partial<Record<MvpCategoryId, number>> = {};
  const contributing = new Set<string>();
  /** 보조 근거: 확정 연결된, 초안 배치 관심사 시설의 서로 다른 시설 그룹. */
  const matchedFacilityGroups = new Set<string>();

  for (const interest of requestedInterests) {
    const relevantPlaced = placed.filter((attraction) =>
      attraction.categories.includes(interest),
    );
    // 서로 다른 시설 수: E2 시설 그룹으로 중복 제거.
    const facilityGroupIds = new Set(relevantPlaced.map(groupOf));
    // 세부 유형 수: 시설 그룹당 대표 유형 하나만 기여한다(D4 결함 수정). 그룹 내
    // 대표는 유효한 세부 분류(D1 새 분류 우선, 분류 결측 제외)가 있는 장소 중
    // 안정적인 콘텐츠 ID 순서로 고른다. 유효 분류가 없는 그룹은 시설 수에는
    // 포함되지만 대표가 없어 유형 수에는 기여하지 않는다. 대표 유형을 그룹 간에
    // 다시 중복 제거해 다양성을 계산한다.
    const relevantByGroup = new Map<string, Attraction[]>();
    for (const attraction of relevantPlaced) {
      const groupId = groupOf(attraction);
      const members = relevantByGroup.get(groupId);
      if (members) members.push(attraction);
      else relevantByGroup.set(groupId, [attraction]);
    }
    const typeKeys = new Set<string>();
    for (const members of relevantByGroup.values()) {
      const representative = members
        .filter((attraction) => detailClassificationStrict(attraction) !== null)
        .toSorted((a, b) => compareId(a.contentId, b.contentId))[0];
      if (representative)
        typeKeys.add(detailClassificationStrict(representative)!);
    }
    const facilities = facilityGroupIds.size;
    const types = typeKeys.size;
    fitByInterest[interest] = {
      facilities,
      types,
      fit: Math.min(facilities, facilityCap) + Math.min(types, typeCap),
    };

    // 참고 원점수(이전 e1-v2 의미): 관심사별 상위 3개 1/log2(1+hubRank) 합 ÷ 3.
    const relevantWithHub = withEvidence.filter((entry) =>
      entry.attraction.categories.includes(interest),
    );
    const bestByGroup = new Map<string, { contentId: string; value: number }>();
    for (const { attraction, hub } of relevantWithHub) {
      const groupId = groupOf(attraction);
      matchedFacilityGroups.add(groupId);
      const value = scoreValue(hub.hubRank);
      const current = bestByGroup.get(groupId);
      if (!current || value > current.value)
        bestByGroup.set(groupId, { contentId: attraction.contentId, value });
    }
    const top3 = [...bestByGroup.values()]
      .sort((left, right) => right.value - left.value)
      .slice(0, 3);
    perInterest[interest] =
      top3.reduce((sum, entry) => sum + entry.value, 0) / 3;
    for (const entry of top3) contributing.add(entry.contentId);
  }

  const requested = requestedInterests.length;
  const score = requested
    ? requestedInterests.reduce(
        (sum, interest) => sum + (perInterest[interest] ?? 0),
        0,
      ) / requested
    : 0;
  const fitAverage = requested
    ? requestedInterests.reduce(
        (sum, interest) => sum + (fitByInterest[interest]?.fit ?? 0),
        0,
      ) / requested
    : 0;

  return {
    version: TOURISM_EVIDENCE_VERSION,
    baseYm: TOURISM_EVIDENCE_BASE_YM,
    status:
      !anyCentral && centralEmptyRegionIds.length > 0
        ? "no-central-data"
        : "scored",
    fitBand: purposeFitBand(fitAverage),
    fitAverage,
    fitByInterest,
    matchedFacilityCount: Math.min(
      matchedFacilityGroups.size,
      matchedFacilityCap,
    ),
    score,
    perInterest,
    contributingContentIds: [...contributing].sort(),
    centralEmptyRegionIds,
    matchedHubCount: withEvidence.length,
  };
}
