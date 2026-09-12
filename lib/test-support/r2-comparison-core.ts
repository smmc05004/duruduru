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
import centralAttractions from "@/data/central-attractions.json";
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

// ---------------------------------------------------------------------------
// R2 보완 (재작업 기준 문서 사용자 지적 1·2·3) — 허브 풀 크기, 장거리 셀 실질 판정,
// 최종 3장 구성 자체를 바꾸는 대안. 배포 코드는 여전히 수정하지 않는다.
// ---------------------------------------------------------------------------

type RawCentralRegion = {
  regionId: string;
  name: string;
  province: string;
  status: "ok" | "empty";
  totalCount: number;
};
// `data/central-attractions.json`의 `regions`는 배열이다(맵이 아님) — T4의
// `data/tourism-evidence.json`(regionId 키 맵)과 스키마가 다르다. regionId로
// 조회하려면 인덱스를 직접 만들어야 한다.
const centralRegionList =
  centralAttractions.regions as unknown as RawCentralRegion[];
const centralRegions = new Map<string, RawCentralRegion>(
  centralRegionList.map((row) => [row.regionId, row]),
);

export type HubPoolInfo = {
  regionId: string;
  name: string;
  status: "ok" | "empty" | "unknown";
  /** 해당 지역에서 실제 조회된 중심 관광지(허브) 총 개수. status가 ok가 아니면 0. */
  totalCount: number;
};

/**
 * 지적 1(hubRank 지역 내 순위 오기 정정) 후속 — "상위 N위 이내 개수"로 지표를
 * 바꿔도 지역 간 비교가 타당한지 확인하려면, 각 후보 지역이 실제로 조회한 허브
 * 풀 크기(`totalCount`, TourAPI `LocgoHubTarService1`이 그 지역 조회에서 돌려준
 * 총 항목 수, 최대 100)가 같은지부터 확인해야 한다. `data/central-attractions.json`
 * (T3 산출물)만 읽는다 — 새 API 호출 없음.
 */
export function hubPoolForRegion(regionId: string): HubPoolInfo | null {
  const row = centralRegions.get(regionId);
  if (!row) return null;
  return {
    regionId,
    name: row.name,
    status: row.status,
    totalCount: row.status === "ok" ? row.totalCount : 0,
  };
}

/**
 * 후보 그룹(광역시는 여러 구, 시·군은 보통 1개 지역)의 합산 허브 풀 크기.
 * 지역별 상세를 함께 반환해 어느 구성원이 얼마를 기여하는지 보존한다.
 */
export function hubPoolForGroup(candidate: DiagCandidate): {
  totalPool: number;
  memberCount: number;
  perRegion: HubPoolInfo[];
} {
  const perRegion = candidate.memberRegionIds
    .map((id) => hubPoolForRegion(id))
    .filter((row): row is HubPoolInfo => row !== null);
  return {
    totalPool: perRegion.reduce((sum, row) => sum + row.totalCount, 0),
    memberCount: candidate.memberRegionIds.length,
    perRegion,
  };
}

export type NationalHubPoolSummary = {
  regionCount: number;
  okCount: number;
  emptyCount: number;
  min: number;
  p10: number;
  median: number;
  p90: number;
  max: number;
  /** 광역시 그룹(시·도 전체) 합산 허브 풀 크기 — 개별 시·군의 풀 크기와 비교용. */
  metropolitanGroupSums: Record<string, number>;
};

/**
 * 전국 249개 매핑 지역 전체의 허브 풀 크기 분포. "익산·공주·경주 등 실제 비교
 * 대상 지역들의 허브 풀 크기를 표로 남겨서 이 문제가 실제로 존재하는지 데이터로
 * 확인한다"는 지시의 전국 배경값이다. 시·군 단위(최대 100~103)와 광역시 그룹
 * 합산(수백~수천)의 규모 차이를 함께 보여준다.
 */
export function nationalHubPoolSummary(): NationalHubPoolSummary {
  const rows = centralRegionList;
  const ok = rows.filter((row) => row.status === "ok");
  const counts = ok.map((row) => row.totalCount).toSorted((a, b) => a - b);
  const pick = (p: number) =>
    counts.length
      ? counts[Math.min(counts.length - 1, Math.floor(counts.length * p))]
      : 0;
  const metropolitanGroupSums: Record<string, number> = {};
  for (const row of rows) {
    if (!/(?:특별시|광역시|특별자치시)$/u.test(row.province)) continue;
    metropolitanGroupSums[row.province] =
      (metropolitanGroupSums[row.province] ?? 0) +
      (row.status === "ok" ? row.totalCount : 0);
  }
  return {
    regionCount: rows.length,
    okCount: ok.length,
    emptyCount: rows.length - ok.length,
    min: counts[0] ?? 0,
    p10: pick(0.1),
    median: pick(0.5),
    p90: pick(0.9),
    max: counts[counts.length - 1] ?? 0,
    metropolitanGroupSums,
  };
}

/**
 * 지적 2(편도 2h+ 단순 부작용 카운트 금지) — 장거리 후보 하나의 "실질" 판정.
 * 구성 가능성(왕복+식사+휴식+관광 시간 제약 충족)은 `diagnoseAll`이 `scheduleTrip`을
 * 실제 실행해 성공한 그룹만 `candidate` 단계로 넘기므로 **이미 보장**돼 있다(별도
 * 재확인 불필요, `lib/mvp-phase-two-planner.ts`의 `scheduleBaseTrip`/`scheduleTrip`
 * 참고). 이 함수는 그 다음 질문 — "선택한 관심사에 맞는 실질적 방문을 제공하는가,
 * 아니면 시간만 채우는 구색 맞추기 1곳뿐인가" — 만 판정한다.
 */
export type LongDistanceSubstance = {
  groupId: string;
  displayName: string;
  roundTripMinutes: number;
  requestedInterestCount: number;
  fulfilledInterestCount: number;
  /** 실제 배치 장소 중 요청 관심사 중 하나 이상과 일치하는 서로 다른 시설 수(E2 그룹 기준 근사: contentId 중복 없음). */
  interestRelevantPlacedCount: number;
  /** 그 시설들의 서로 다른 세부 유형 수(문서 D4-a `types_i`와 달리 그룹 대표 보정 없이 placed 배열 그대로 근사). */
  interestRelevantDetailTypeCount: number;
  matchedFacilityCount: number;
  localFreeMinutes: number;
  /** 구성 가능성: scheduleTrip이 이미 성공했으므로 항상 true(diagnoseAll 불변식). */
  itineraryConstructable: true;
  /** 요청 관심사를 전부 충족하지 못했거나, 관심사에 맞는 서로 다른 시설이 1곳 이하다. */
  isTokenOnly: boolean;
  /** 요청 관심사를 전부 충족하고 서로 다른 시설이 2곳 이상이다. */
  isSubstantive: boolean;
};

export function assessLongDistanceSubstance(
  candidate: DiagCandidate,
  interests: MvpCategoryId[],
): LongDistanceSubstance {
  const relevant = candidate.placed.filter((place) =>
    place.categories.some((category) => interests.includes(category)),
  );
  const detailTypes = new Set(
    relevant
      .map((place) => place.detailType)
      .filter((type): type is string => type !== null),
  );
  const fulfilledInterestCount = candidate.fulfilledInterestCount;
  const isTokenOnly =
    fulfilledInterestCount < interests.length || relevant.length <= 1;
  return {
    groupId: candidate.groupId,
    displayName: candidate.displayName,
    roundTripMinutes: candidate.roundTripMinutes,
    requestedInterestCount: interests.length,
    fulfilledInterestCount,
    interestRelevantPlacedCount: relevant.length,
    interestRelevantDetailTypeCount: detailTypes.size,
    matchedFacilityCount: candidate.matchedFacilityCount,
    localFreeMinutes: candidate.localFreeMinutes,
    itineraryConstructable: true,
    isTokenOnly,
    isSubstantive: !isTokenOnly,
  };
}

/**
 * 지적 3(최종 3장 "구성" 자체를 비교) — 추가 대안: 세 역할을 독립적으로 각각
 * 정렬하는 대신, **단일 관심사 적합성 순위에서 서로 다른 groupId 상위 3개**를
 * 그대로 뽑는다. easy/relaxed의 별도 정의를 없애고 "가장 목적에 맞는 순서대로
 * 3장"이라는 가장 단순한 구성 규칙과 비교하기 위함이다. 새 사용자 입력이나 거리
 * 하한/가점을 넣지 않는다 — 정렬 키는 `interest` 비교자를 그대로 재사용한다.
 */
export function selectTopThreeBySingleRanking(
  candidates: DiagCandidate[],
  compare: (a: DiagCandidate, b: DiagCandidate) => number,
): [DiagCandidate | null, DiagCandidate | null, DiagCandidate | null] {
  const ranked = [...candidates].toSorted(compare);
  const seen = new Set<string>();
  const picked: DiagCandidate[] = [];
  for (const candidate of ranked) {
    if (seen.has(candidate.groupId)) continue;
    seen.add(candidate.groupId);
    picked.push(candidate);
    if (picked.length === 3) break;
  }
  return [picked[0] ?? null, picked[1] ?? null, picked[2] ?? null];
}
