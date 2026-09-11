/**
 * R2 오프라인 비교 하네스 (작업 계획 `docs/development/TOURISM_RECOMMENDATION_WORK_PLAN.md`
 * R2 행, 제품 재작업 기준 `docs/product/RECOMMENDATION_QUALITY_RECOVERY.md`).
 *
 * **배포 코드(`lib/tourism-evidence.ts`·`lib/mvp-phase-two-search.ts`·
 * `lib/mvp-phase-two-planner.ts`)는 이번에 수정하지 않는다.** 이 모듈은
 * `lib/__tests__/enhancement-r1-diagnosis.test.ts`가 만든 재구성 방식을 임의
 * `SearchInput`으로 일반화해, "최종 3곳으로 좁혀지기 전의 전체 시간 적합 후보
 * 목록"을 만든다. 그 위에서만 대안 정렬/역할 전략을 오프라인으로 비교한다.
 *
 * 대안은 전부 **이미 계산된 값만 재조합**한다 — 새 API 호출, 새 데이터 수집,
 * `scheduleTrip`/`selectPlaces` 재실행(재선정)은 하지 않는다. `computePurposeEvidence`가
 * 이미 만든 `fitByInterest[interest].facilities`/`.types`(원시, 상한 적용 전)와
 * `placed[].hub`(확정 연결 hubRank)를 그대로 재사용해 새 지표를 계산한다.
 */
import {
  attractionFor,
  searchPhaseTwo,
  selectCandidateRoles,
} from "@/lib/mvp-phase-two-search";
import { groupForMapping } from "@/lib/mvp-phase-two-regions";
import {
  distinctAttractions,
  scheduleTrip,
  validateSearchInput,
  type SchedulingCache,
} from "@/lib/mvp-phase-two-planner";
import {
  classifyInterests,
  detailClassificationStrict,
} from "@/lib/interest-classification";
import {
  computePurposeEvidence,
  hubEvidenceFor,
  hubRankForSelection,
} from "@/lib/tourism-evidence";
import { originRegion } from "@/lib/origin-regions";
import mapping from "@/data/region-mapping.json";
import profiles from "@/data/region-profiles.json";
import travelTimes from "@/data/ktdb/interregional-travel-times-2024.json";
import type {
  MvpCategoryId,
  RegionAttraction,
  RegionMapping,
  RegionProfile,
} from "@/lib/mvp-region-data";
import type {
  Attraction,
  Candidate,
  DataMetadata,
  PurposeEvidence,
  SearchInput,
  TimeBlock,
} from "@/lib/mvp-phase-two-types";

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
export const R2_DATA_METADATA: DataMetadata = {
  profileGeneratedAt: profiles.generatedAt,
  travelTimeGeneratedAt: travelTimes.generatedAt,
  networkYear: travelTimes.source.networkYear,
  travelTimeSource: `${travelTimes.source.provider} · ${travelTimes.source.dataset}`,
  representativePoint: travelTimes.source.representativePoint,
  searchedAt: "",
};

function categoriesFor(place: RegionAttraction): MvpCategoryId[] {
  return classifyInterests({
    lclsSystm1: place.lclsSystm1,
    lclsSystm2: place.lclsSystm2,
    lclsSystm3: place.lclsSystm3,
    cat1: place.cat1,
    cat2: place.cat2,
    cat3: place.cat3,
    contentTypeId: place.contentTypeId,
  }).categories;
}

type DiagGroup = {
  groupId: string;
  displayName: string;
  province: string;
  representativeZoneId: string;
  oneWayMinutes: number;
  memberRegionIds: string[];
  poolContentIds: Set<string>;
  poolRegionOf: Map<string, string>;
};

export type PlacedInfo = {
  contentId: string;
  title: string;
  categories: MvpCategoryId[];
  detailType: string | null;
  hub: { hubRank: number; method: string } | null;
};

export type DiagCandidate = {
  groupId: string;
  displayName: string;
  province: string;
  isMetropolitanGroup: boolean;
  memberRegionIds: string[];
  representativeZoneId: string;
  oneWayMinutes: number;
  roundTripMinutes: number;
  poolSize: number;
  preview: { blocks: TimeBlock[]; metrics: Candidate["preview"]["metrics"] };
  placed: PlacedInfo[];
  purpose: PurposeEvidence;
  fitBand: number;
  matchedFacilityCount: number;
  fulfilledInterestCount: number;
  attractionCount: number;
  categoryDiversity: number;
  localFreeMinutes: number;
  distancePairCount: number;
  averageDistanceKm: number | null;
  proximityComparable: boolean;
};

export type DiagRow =
  | {
      stage: "origin-excluded" | "no-time-data";
      groupId: string;
      memberRegionIds: string[];
    }
  | {
      stage: "insufficient-attractions";
      groupId: string;
      displayName: string;
      province: string;
      poolSize: number;
    }
  | {
      stage: "time-infeasible";
      groupId: string;
      displayName: string;
      province: string;
      poolSize: number;
      reason: string;
    }
  | ({ stage: "candidate" } & DiagCandidate);

export const compareNumber = (a: number, b: number) => a - b;
export const compareText = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * `recommendationFor`의 비공개 `actualDistanceMetrics`(`lib/mvp-phase-two-search.ts`)를
 * 그대로 옮겼다(R1 진단과 동일 사본).
 */
function actualDistanceMetrics(blocks: TimeBlock[]) {
  let distancePairCount = 0;
  let validDistancePairCount = 0;
  let distanceTotal = 0;
  for (const day of [1, 2] as const) {
    const attractions = blocks
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
    averageDistanceKm:
      validDistancePairCount > 0
        ? distanceTotal / validDistancePairCount
        : null,
    proximityComparable:
      distancePairCount > 0 && distancePairCount === validDistancePairCount,
  };
}

/**
 * `searchPhaseTwo`의 비공개 그룹 순회 루프를 임의 `SearchInput`으로 일반화한 사본
 * (R1 진단과 동일 로직, 원본 위치는 `lib/mvp-phase-two-search.ts`).
 * 그룹핑·대표존 선정·풀 구성은 export된 함수와 원본 JSON만으로 만든 기계적
 * 집계라 독립 판정 로직이 없다. 반환값은 스테이지별 전체 행과, "시간 적합 통과"
 * (candidate) 후보 배열(최종 3곳으로 좁혀지기 전 전체)이다.
 */
export function diagnoseAll(input: SearchInput): {
  rows: DiagRow[];
  candidates: DiagCandidate[];
} {
  const validated = validateSearchInput(input);
  if (!validated.ok) throw new Error(validated.reason);
  const origin = originRegion(input.originId)!;
  const originIndex = zoneIndices.get(origin.zoneId);
  const originMapping = mappings.get(origin.zoneId);
  if (originIndex === undefined || !originMapping)
    throw new Error("출발 지역 매핑/시간 데이터 없음");
  const originGroup = groupForMapping(originMapping).groupId;

  const groups = new Map<string, DiagGroup>();
  const rows: DiagRow[] = [];

  for (const [regionId, row] of mappings) {
    const to = zoneIndices.get(regionId);
    const minutes =
      to === undefined ? null : travelTimes.minutes[originIndex]?.[to];
    const descriptor = groupForMapping(row);
    if (descriptor.groupId === originGroup) {
      rows.push({
        stage: "origin-excluded",
        groupId: descriptor.groupId,
        memberRegionIds: [regionId],
      });
      continue;
    }
    if (
      typeof minutes !== "number" ||
      minutes <= 0 ||
      !Number.isFinite(minutes)
    ) {
      rows.push({
        stage: "no-time-data",
        groupId: descriptor.groupId,
        memberRegionIds: [regionId],
      });
      continue;
    }
    let group = groups.get(descriptor.groupId);
    if (!group) {
      group = {
        ...descriptor,
        representativeZoneId: regionId,
        oneWayMinutes: minutes,
        memberRegionIds: [],
        poolContentIds: new Set(),
        poolRegionOf: new Map(),
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
      const cats = categoriesFor(item);
      if (!cats.some((id) => input.interests.includes(id))) continue;
      const previousRegion = group.poolRegionOf.get(item.contentId);
      if (!previousRegion || regionId < previousRegion) {
        group.poolContentIds.add(item.contentId);
        group.poolRegionOf.set(item.contentId, regionId);
      }
    }
  }

  const timingCache: SchedulingCache = new Map();
  const candidates: DiagCandidate[] = [];

  for (const group of groups.values()) {
    const pool = [...group.poolContentIds]
      .map((contentId) =>
        attractionFor(contentId, group.poolRegionOf.get(contentId)!),
      )
      .filter((a): a is Attraction => a !== null);
    const distinct = distinctAttractions(pool);
    if (distinct.length < 3) {
      rows.push({
        stage: "insufficient-attractions",
        groupId: group.groupId,
        displayName: group.displayName,
        province: group.province,
        poolSize: distinct.length,
      });
      continue;
    }
    const scheduled = scheduleTrip(
      input,
      group.oneWayMinutes,
      distinct,
      undefined,
      [],
      timingCache,
      hubRankForSelection,
    );
    if (!scheduled.ok) {
      rows.push({
        stage: "time-infeasible",
        groupId: group.groupId,
        displayName: group.displayName,
        province: group.province,
        poolSize: distinct.length,
        reason: scheduled.reason,
      });
      continue;
    }
    const placedAttractions = scheduled.blocks.flatMap((block) =>
      block.kind === "attraction" && block.attraction ? [block.attraction] : [],
    );
    const purpose = computePurposeEvidence(
      placedAttractions,
      input.interests,
      group.memberRegionIds,
    );
    const distance = actualDistanceMetrics(scheduled.blocks);
    const candidate: DiagCandidate = {
      groupId: group.groupId,
      displayName: group.displayName,
      province: group.province,
      isMetropolitanGroup: group.groupId.startsWith("metropolitan:"),
      memberRegionIds: [...group.memberRegionIds].sort(),
      representativeZoneId: group.representativeZoneId,
      oneWayMinutes: group.oneWayMinutes,
      roundTripMinutes: group.oneWayMinutes * 2,
      poolSize: distinct.length,
      preview: { blocks: scheduled.blocks, metrics: scheduled.metrics },
      placed: placedAttractions.map((attraction) => ({
        contentId: attraction.contentId,
        title: attraction.title,
        categories: attraction.categories,
        detailType: detailClassificationStrict(attraction),
        hub: (() => {
          const evidence = hubEvidenceFor(
            attraction.regionId,
            attraction.contentId,
          );
          return evidence
            ? { hubRank: evidence.hubRank, method: evidence.method }
            : null;
        })(),
      })),
      purpose,
      fitBand: purpose.fitBand ?? 0,
      matchedFacilityCount: purpose.matchedFacilityCount ?? 0,
      fulfilledInterestCount: input.interests.filter((interest) =>
        scheduled.metrics.fulfilledInterests.includes(interest),
      ).length,
      attractionCount: scheduled.metrics.attractionCount,
      categoryDiversity: scheduled.metrics.categoryDiversity,
      localFreeMinutes: scheduled.metrics.freeMinutes,
      distancePairCount: distance.distancePairCount,
      averageDistanceKm: distance.averageDistanceKm,
      proximityComparable: distance.proximityComparable,
    };
    candidates.push(candidate);
    rows.push({ stage: "candidate", ...candidate });
  }
  return { rows, candidates };
}

/** 재구성한 후보 배열을 실제 export `selectCandidateRoles`에 넘기기 위한 변환(정합성 검증용). */
export function toSearchCandidates(
  candidates: DiagCandidate[],
  searchedAt: string,
): Array<Omit<Candidate, "recommendation" | "reasons">> {
  return candidates.map((c) => ({
    groupId: c.groupId,
    memberRegionIds: c.memberRegionIds,
    representativeZoneId: c.representativeZoneId,
    displayName: c.displayName,
    name: c.displayName,
    province: c.province,
    oneWayMinutes: c.oneWayMinutes,
    attractions: [],
    preview: c.preview,
    metadata: { ...R2_DATA_METADATA, searchedAt },
    itineraryAlgorithmVersion: "e2-v3",
  }));
}

/**
 * 재구성한 후보 배열이 실제 배포 `searchPhaseTwo` 출력과 일치하는지 확인한다
 * (R1의 정합성 검증 1을 임의 입력으로 일반화). 불일치 시 그 자체가 이 하네스의
 * 재구성 오류를 뜻하며, 대안 비교의 기준선(baseline)이 신뢰할 수 없다는 신호다.
 */
export function verifyReconstruction(
  input: SearchInput,
  candidates: DiagCandidate[],
  searchedAt: string,
): { ok: true } | { ok: false; reason: string } {
  const real = searchPhaseTwo(input, "r2-verify", searchedAt);
  if (real.kind !== "success")
    return { ok: false, reason: `real=${real.kind}` };
  const purposeByGroupId = new Map(
    candidates.map((c) => [c.groupId, c.purpose]),
  );
  const reconstructed = selectCandidateRoles(
    toSearchCandidates(candidates, searchedAt),
    input.interests,
    purposeByGroupId,
  );
  const a = reconstructed.map((c) => [c.recommendation.role, c.groupId]);
  const b = real.candidates.map((c) => [c.recommendation!.role, c.groupId]);
  if (JSON.stringify(a) !== JSON.stringify(b))
    return {
      ok: false,
      reason: `역할/지역 불일치: 재구성=${JSON.stringify(a)} 실제=${JSON.stringify(b)}`,
    };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 기준선(baseline) 비교자 — `lib/mvp-phase-two-search.ts`의 `compareByRole` 사본.
// ---------------------------------------------------------------------------

export function baselineInterestCompare(a: DiagCandidate, b: DiagCandidate) {
  return (
    compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
    compareNumber(b.fitBand, a.fitBand) ||
    compareNumber(a.roundTripMinutes, b.roundTripMinutes) ||
    compareNumber(b.matchedFacilityCount, a.matchedFacilityCount) ||
    compareText(a.groupId, b.groupId)
  );
}
export function baselineEasyCompare(a: DiagCandidate, b: DiagCandidate) {
  return (
    compareNumber(a.roundTripMinutes, b.roundTripMinutes) ||
    compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
    compareNumber(b.attractionCount, a.attractionCount) ||
    compareNumber(b.categoryDiversity, a.categoryDiversity) ||
    compareText(a.groupId, b.groupId)
  );
}
export function baselineRelaxedCompare(a: DiagCandidate, b: DiagCandidate) {
  let result =
    compareNumber(
      Number(b.proximityComparable),
      Number(a.proximityComparable),
    ) || compareNumber(b.localFreeMinutes, a.localFreeMinutes);
  if (!result && a.proximityComparable && b.proximityComparable)
    result = compareNumber(a.averageDistanceKm!, b.averageDistanceKm!);
  result ||=
    compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
    compareNumber(a.roundTripMinutes, b.roundTripMinutes);
  return result || compareText(a.groupId, b.groupId);
}

export type FinalThree = {
  interest: DiagCandidate | null;
  easy: DiagCandidate | null;
  relaxed: DiagCandidate | null;
};

/** 기준선 3장 선택: `selectCandidateRoles`와 동일한 순서(interest→easy→relaxed,
 * 이미 선택된 groupId 제외)로 각 비교자의 승자를 고른다. */
export function selectFinalThree(
  candidates: DiagCandidate[],
  compares: {
    interest: (a: DiagCandidate, b: DiagCandidate) => number;
    easy: (a: DiagCandidate, b: DiagCandidate) => number;
    relaxed: (a: DiagCandidate, b: DiagCandidate) => number;
  },
): FinalThree {
  const chosen = new Set<string>();
  const pick = (
    compare: (a: DiagCandidate, b: DiagCandidate) => number,
  ): DiagCandidate | null => {
    const winner = candidates
      .filter((c) => !chosen.has(c.groupId))
      .toSorted(compare)[0];
    if (winner) chosen.add(winner.groupId);
    return winner ?? null;
  };
  const interest = pick(compares.interest);
  const easy = pick(compares.easy);
  const relaxed = pick(compares.relaxed);
  return { interest, easy, relaxed };
}

// ---------------------------------------------------------------------------
// 대안 지표 — 기존 `purpose`/`placed` 필드만 재조합한다. 재선정(scheduleTrip 재실행)
// 없음.
// ---------------------------------------------------------------------------

const hubScoreValue = (hubRank: number) => 1 / Math.log2(1 + hubRank);

/** 대안 1: 이전(T5/T6, e1-v2) 방식 — 관심사별 상위 3개 시설의 hubRank 점수 평균을
 * 다시 평균한 `purpose.score`(이미 계산되어 저장됨, [0,1])를 fitBand 다음·왕복시간
 * 이전에 재도입한다. T6가 원거리 대도시 쏠림을 일으켰던 바로 그 지표다. */
export function alt1InterestCompare(a: DiagCandidate, b: DiagCandidate) {
  return (
    compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
    compareNumber(b.fitBand, a.fitBand) ||
    compareNumber(b.purpose.score ?? 0, a.purpose.score ?? 0) ||
    compareNumber(a.roundTripMinutes, b.roundTripMinutes) ||
    compareNumber(b.matchedFacilityCount, a.matchedFacilityCount) ||
    compareText(a.groupId, b.groupId)
  );
}

/** 배치된 관심사 시설 중 확정 연결된 것들의 **단일 최고**(가장 작은 hubRank) 점수.
 * 여러 시설을 평균·합산하지 않는다 — 후보 풀 크기(대도시 그룹의 많은 소속 지역)가
 * 커질수록 유리해지는 합산·평균 방식과 달리, "그 지역이 확보한 가장 강한 확정
 * 연결 근거 하나"만 본다. [0,1] 범위, 확정 연결이 없으면 0. */
function bestHubScore(candidate: DiagCandidate, interests: MvpCategoryId[]) {
  let best = 0;
  for (const place of candidate.placed) {
    if (!place.hub) continue;
    if (!place.categories.some((c) => interests.includes(c))) continue;
    const value = hubScoreValue(place.hub.hubRank);
    if (value > best) best = value;
  }
  return best;
}

/** 대안 2: 단일 최고 확정 연결 순위(정규화, 상한 없음이지만 [0,1] 유계)를 fitBand
 * 다음·왕복시간 이전의 보조 근거로 쓴다. 익산(hub1)·공주(hub2)·경주(hub4) 같은
 * "전국적으로 매우 강한 단일 지점"을 근거리 후보(약한 순위)와 구별하되, 합산이
 * 아니므로 후보 풀이 큰 지역이 구조적으로 유리해지지 않는다(재작업 기준 원칙 4). */
export function makeAlt2InterestCompare(interests: MvpCategoryId[]) {
  return (a: DiagCandidate, b: DiagCandidate) =>
    compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
    compareNumber(b.fitBand, a.fitBand) ||
    compareNumber(bestHubScore(b, interests), bestHubScore(a, interests)) ||
    compareNumber(a.roundTripMinutes, b.roundTripMinutes) ||
    compareNumber(b.matchedFacilityCount, a.matchedFacilityCount) ||
    compareText(a.groupId, b.groupId);
}

/** 대안 3용 재계산 fitBand: `fitByInterest[interest].facilities`/`.types`(원시,
 * T7 상한 적용 전 값)를 새 상한으로 다시 캡핑해 평균·구간을 계산한다.
 * `computePurposeEvidence`를 재실행하지 않고 이미 저장된 원시 값만 재사용한다. */
export function recomputeFitBand(
  candidate: DiagCandidate,
  interests: MvpCategoryId[],
  facilityCap: number,
  typeCap: number,
  bandBoundaries: readonly [number, number],
): number {
  const requested = interests.length;
  if (!requested) return 0;
  const total = interests.reduce((sum, interest) => {
    const fit = candidate.purpose.fitByInterest?.[interest];
    if (!fit) return sum;
    return (
      sum + Math.min(fit.facilities, facilityCap) + Math.min(fit.types, typeCap)
    );
  }, 0);
  const average = total / requested;
  return bandBoundaries.filter((bound) => average >= bound).length;
}

/** 대안 3: 포화 상한 상향(시설 4→6·유형 3→4). `interest` 비교자는 그대로이며
 * fitBand 계산에만 새 상한을 쓴다. */
export function makeAlt3InterestCompare(
  interests: MvpCategoryId[],
  facilityCap: number,
  typeCap: number,
  // 원래 상수(cap 4+3=7)의 경계 [4.5, 6.5] = [max-2.5, max-0.5] 비율을 유지한다.
  bandBoundaries: readonly [number, number] = [
    facilityCap + typeCap - 2.5,
    facilityCap + typeCap - 0.5,
  ],
) {
  const bandOf = (c: DiagCandidate) =>
    recomputeFitBand(c, interests, facilityCap, typeCap, bandBoundaries);
  return (a: DiagCandidate, b: DiagCandidate) =>
    compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
    compareNumber(bandOf(b), bandOf(a)) ||
    compareNumber(a.roundTripMinutes, b.roundTripMinutes) ||
    compareNumber(b.matchedFacilityCount, a.matchedFacilityCount) ||
    compareText(a.groupId, b.groupId);
}

/** 대안 4: `relaxed` 역할 재정의 — "동일(잔여 후보 중 최고) 목적 적합성 구간 안에서
 * 가장 먼 후보"(재작업 기준 원칙 3의 역할 재정의). 근접성·현지 자유시간 우선 대신,
 * 시간상 가능한 후보 중 목적 적합성이 떨어지지 않는 한 더 먼 곳도 보여준다.
 * interest·easy는 기준선 그대로 두고 relaxed만 바꾼 효과를 분리해서 본다. */
export function alt4RelaxedCompare(a: DiagCandidate, b: DiagCandidate) {
  return (
    compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
    compareNumber(b.fitBand, a.fitBand) ||
    compareNumber(b.roundTripMinutes, a.roundTripMinutes) || // 왕복시간 내림차순(먼 곳 우선)
    compareNumber(b.matchedFacilityCount, a.matchedFacilityCount) ||
    compareText(a.groupId, b.groupId)
  );
}

export type MvpCategoryIdList = MvpCategoryId[];
