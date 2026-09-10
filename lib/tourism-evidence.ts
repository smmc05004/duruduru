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
import type { Attraction, PurposeEvidence } from "@/lib/mvp-phase-two-types";
import type { MvpCategoryId } from "@/lib/mvp-region-data";
import { MVP_CATEGORY_IDS } from "@/lib/mvp-region-data";
import { facilityGroups } from "@/lib/mvp-phase-two-planner";

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

/** 초안 선정 시 사용하는 가벼운 신호: 배치 후보의 최적 hubRank 또는 null. */
export function hubRankForSelection(attraction: Attraction): number | null {
  return (
    hubEvidenceFor(attraction.regionId, attraction.contentId)?.hubRank ?? null
  );
}

const scoreValue = (hubRank: number) => 1 / Math.log2(1 + hubRank);

/**
 * D4 목적 근거 점수. `placed`는 **실제 초안에 배치된 관광지**만 넘긴다.
 * 요청 관심사별로 중복 시설을 제거한 상위 3개 값의 합 ÷ 3, 전체 평균이 점수(0~1)다.
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
  const withEvidence = placed
    .map((attraction) => ({
      attraction,
      hub: hubEvidenceFor(attraction.regionId, attraction.contentId),
    }))
    .filter(
      (entry): entry is { attraction: Attraction; hub: HubEvidence } =>
        entry.hub !== null,
    );

  const perInterest: Partial<Record<MvpCategoryId, number>> = {};
  const contributing = new Set<string>();
  for (const interest of requestedInterests) {
    // 이 관심사의 근거가 될 수 있는, 초안에 배치된 관광지만.
    const relevant = withEvidence.filter((entry) =>
      entry.attraction.categories.includes(interest),
    );
    // 중복 시설 제거: 같은 시설 그룹은 가장 높은(작은 hubRank) 값 하나만 인정.
    const bestByGroup = new Map<string, { contentId: string; value: number }>();
    for (const { attraction, hub } of relevant) {
      const groupId = groups.get(attraction.contentId) ?? attraction.contentId;
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

  const score = requestedInterests.length
    ? requestedInterests.reduce(
        (sum, interest) => sum + (perInterest[interest] ?? 0),
        0,
      ) / requestedInterests.length
    : 0;

  return {
    version: TOURISM_EVIDENCE_VERSION,
    baseYm: TOURISM_EVIDENCE_BASE_YM,
    status:
      !anyCentral && centralEmptyRegionIds.length > 0
        ? "no-central-data"
        : "scored",
    score,
    perInterest,
    contributingContentIds: [...contributing].sort(),
    centralEmptyRegionIds,
    matchedHubCount: withEvidence.length,
  };
}
