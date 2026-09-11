/** @jest-environment node */
/**
 * R1 진단(재작업 기준 문서 `docs/product/RECOMMENDATION_QUALITY_RECOVERY.md`,
 * 작업 계획 `docs/development/TOURISM_RECOMMENDATION_WORK_PLAN.md` R1 행).
 *
 * 고정 진단 입력(서울 빠른 선택 · 관심사 역사 단일 · 연속 이틀 08:00→익일 20:00)에서
 * **전국 모든 후보 그룹**의 탈락 단계(출발지 제외/시간 데이터 없음/관심사 시설
 * 부족/시간 불가/후보로 계산됨)와, 시간 적합 통과 후보의 배치 시설·세부 유형·중심
 * 연결·목적 적합성 구간·왕복/현지시간·interest·easy·relaxed 각 역할 순위를
 * 추출한다.
 *
 * **코드 로직은 바꾸지 않는다.** 이 파일은 배포 코드
 * (`lib/mvp-phase-two-search.ts` 등, main과 동일)의 **export된 순수 함수**
 * (`attractionFor`·`selectCandidateRoles`·`searchPhaseTwo`,
 * `lib/mvp-phase-two-regions.ts`의 `groupForMapping`,
 * `lib/interest-classification.ts`의 `classifyInterests`/`detailClassificationStrict`,
 * `lib/tourism-evidence.ts`의 `computePurposeEvidence`/`hubEvidenceFor`/
 * `hubRankForSelection`, `lib/mvp-phase-two-planner.ts`의 `distinctAttractions`/
 * `scheduleTrip`/`validateSearchInput`)와 원본 JSON만 읽어 "최종 3곳으로 좁혀지기
 * 전의 전체 후보 목록"을 재구성한다. 그룹 순회·대표존 선정·풀 구성 자체는 이
 * export들과 원본 JSON만으로 만들어 독립 판정 로직이 없다(기계적 집계).
 *
 * `interest`/`easy`/`relaxed` 정렬 비교자(`compareByRole`)와 거리 지표
 * (`actualDistanceMetrics`)는 비공개(미export)라 소스 코드를 그대로 옮겨 적었다
 * (아래 주석에 원본 위치 표기). 옮겨 적은 부분이 실제 배포 코드와 어긋나면 이
 * 파일의 두 정합성 검증이 실패해 드러난다:
 *  1) 재구성한 전체 후보 배열을 **실제 export `selectCandidateRoles`**에 넘겨 얻은
 *     최종 3곳이 `searchPhaseTwo`의 실제 출력과 완전히 같은지 확인한다.
 *  2) 이 파일이 옮겨 적은 비교자로 직접 정렬한 승자가 같은 실제 출력과 같은지
 *     확인한다.
 *
 * 외부 fetch 없음. 검색 로직 미변경이므로 이 테스트가 실패하면 그 자체가
 * 이상 신호다(회귀가 아니라 이 파일의 재구성이 배포 코드와 어긋났다는 뜻).
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import mapping from "@/data/region-mapping.json";
import profiles from "@/data/region-profiles.json";
import travelTimes from "@/data/ktdb/interregional-travel-times-2024.json";
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

/**
 * R1 고정 진단 입력. 재작업 기준 문서가 지정한 서울 빠른 선택(`originId:"seoul"`
 * → KTDB 서울 중구 존)·관심사 역사 단일·연속 이틀 08:00→익일 20:00이다. 오늘
 * (2026-09-11) 기준 실제 유효한 다음 1박 2일 날짜(9/12 토 08:00 → 9/13 일 20:00)를
 * 쓴다. 사용자 관찰 입력(남양주·하남·과천, 관심사·날짜·시간·출발 ID 미확보)과는
 * 별개다 — 재현 성공으로 단정하지 않는다.
 */
export const R1_FIXED_INPUT: SearchInput = {
  originId: "seoul",
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
  transport: "car",
  interests: ["history"],
};
const SEARCHED_AT = "2026-09-11T00:00:00.000Z";

/** 재작업 기준 문서가 명시한 6개 지역의 groupId. 전부 광역시가 아닌 도(道) 소속
 * 시·군이라 각각 독립 groupId다(`groupForMapping`). */
const FOCUS_GROUPS: Record<string, string> = {
  남양주: "municipality:경기도:남양주시",
  하남: "municipality:경기도:하남시",
  과천: "municipality:경기도:과천시",
  공주: "municipality:충청남도:공주시",
  익산: "municipality:전북특별자치도:익산시",
  경주: "municipality:경상북도:경주시",
};

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
const dataMetadata: DataMetadata = {
  profileGeneratedAt: profiles.generatedAt,
  travelTimeGeneratedAt: travelTimes.generatedAt,
  networkYear: travelTimes.source.networkYear,
  travelTimeSource: `${travelTimes.source.provider} · ${travelTimes.source.dataset}`,
  representativePoint: travelTimes.source.representativePoint,
  searchedAt: SEARCHED_AT,
};

/** `mvp-phase-two-search.ts`의 비공개 `categoriesFor`와 동일한 한 줄 결선이다.
 * 실제 판정 로직은 전부 재사용한 `classifyInterests`(D1)에 있다. */
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

type DiagCandidate = {
  groupId: string;
  displayName: string;
  province: string;
  memberRegionIds: string[];
  representativeZoneId: string;
  oneWayMinutes: number;
  roundTripMinutes: number;
  poolSize: number;
  preview: { blocks: TimeBlock[]; metrics: Candidate["preview"]["metrics"] };
  placed: Array<{
    contentId: string;
    title: string;
    categories: MvpCategoryId[];
    detailType: string | null;
    hub: { hubRank: number; method: string } | null;
  }>;
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

type DiagRow =
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

const compareNumber = (a: number, b: number) => a - b;
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `recommendationFor`의 비공개 `actualDistanceMetrics`(`lib/mvp-phase-two-search.ts`
 * 117~154행)를 그대로 옮겼다. 당일 연속 관광지 블록 간 직선거리만 쓰고 지역
 * 내부 이동시간은 계산하지 않는다(제품 정책). 아래 정합성 검증이 실제 출력과
 * 대조한다.
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

/** D4-a `interest` 정렬 키(문서 그대로, `lib/mvp-phase-two-search.ts` 221~229행):
 * 충족 관심사 수 ↓ → fitBand ↓ → 왕복시간 ↑ → matchedFacilityCount ↓ → groupId ↑. */
function interestCompare(a: DiagCandidate, b: DiagCandidate) {
  return (
    compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
    compareNumber(b.fitBand, a.fitBand) ||
    compareNumber(a.roundTripMinutes, b.roundTripMinutes) ||
    compareNumber(b.matchedFacilityCount, a.matchedFacilityCount) ||
    compareText(a.groupId, b.groupId)
  );
}
/** `compareByRole`의 `easy` 분기(215~220행) 그대로. */
function easyCompare(a: DiagCandidate, b: DiagCandidate) {
  return (
    compareNumber(a.roundTripMinutes, b.roundTripMinutes) ||
    compareNumber(b.fulfilledInterestCount, a.fulfilledInterestCount) ||
    compareNumber(b.attractionCount, a.attractionCount) ||
    compareNumber(b.categoryDiversity, a.categoryDiversity) ||
    compareText(a.groupId, b.groupId)
  );
}
/** `compareByRole`의 `relaxed` 분기(230~241행) 그대로. */
function relaxedCompare(a: DiagCandidate, b: DiagCandidate) {
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

/**
 * `searchPhaseTwo`의 비공개 그룹 순회 루프(`lib/mvp-phase-two-search.ts`
 * 380~481행)를 그대로 재구성한다. 그룹핑·대표존 선정·풀 구성 자체는 export된
 * `groupForMapping`/`attractionFor`/원본 JSON만으로 만들어 독립 로직이 없다.
 * 반환값은 스테이지별 진단 행 전체와, "시간 적합 통과"(candidate) 후보 배열이다.
 */
function diagnoseAll(input: SearchInput): {
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

/** 재구성한 후보 배열을 실제 export `selectCandidateRoles`에 넘기기 위한 변환. */
function toSearchCandidates(
  candidates: DiagCandidate[],
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
    metadata: dataMetadata,
    itineraryAlgorithmVersion: "e2-v3",
  }));
}

describe("R1 진단 — 고정 입력(서울·역사·08:00→익일20:00) 전국 후보 분석", () => {
  const { rows, candidates } = diagnoseAll(R1_FIXED_INPUT);
  const real = searchPhaseTwo(R1_FIXED_INPUT, "r1-diagnosis", SEARCHED_AT);

  it("실제 검색이 성공한다(전제 조건)", () => {
    expect(real.kind).toBe("success");
  });

  it("정합성 검증 1: 재구성한 전체 후보를 실제 export selectCandidateRoles에 넘긴 결과가 searchPhaseTwo 출력과 완전히 같다", () => {
    if (real.kind !== "success") throw new Error("전제 실패");
    const purposeByGroupId = new Map(
      candidates.map((c) => [c.groupId, c.purpose]),
    );
    const reconstructed = selectCandidateRoles(
      toSearchCandidates(candidates),
      R1_FIXED_INPUT.interests,
      purposeByGroupId,
    );
    expect(
      reconstructed.map((c) => [c.recommendation.role, c.groupId]),
    ).toEqual(real.candidates.map((c) => [c.recommendation!.role, c.groupId]));
    for (const rc of real.candidates) {
      const mine = candidates.find((c) => c.groupId === rc.groupId)!;
      expect(mine.roundTripMinutes).toBe(rc.recommendation!.roundTripMinutes);
      expect(mine.fitBand).toBe(rc.recommendation!.purpose?.fitBand ?? 0);
      expect(mine.matchedFacilityCount).toBe(
        rc.recommendation!.purpose?.matchedFacilityCount ?? 0,
      );
      expect(mine.fulfilledInterestCount).toBe(
        rc.recommendation!.fulfilledInterestCount,
      );
      expect(mine.localFreeMinutes).toBe(rc.recommendation!.localFreeMinutes);
      expect(mine.averageDistanceKm).toBe(rc.recommendation!.averageDistanceKm);
      expect(mine.proximityComparable).toBe(
        rc.recommendation!.proximityComparable,
      );
    }
  });

  it("정합성 검증 2: 이 파일이 옮겨 적은 interest/easy/relaxed 비교자로 직접 정렬한 승자가 실제 출력과 같다", () => {
    if (real.kind !== "success") throw new Error("전제 실패");
    const interestWinner = [...candidates].sort(interestCompare)[0];
    const easyWinner = [...candidates]
      .filter((c) => c.groupId !== interestWinner.groupId)
      .sort(easyCompare)[0];
    const relaxedWinner = [...candidates]
      .filter(
        (c) =>
          c.groupId !== interestWinner.groupId &&
          c.groupId !== easyWinner?.groupId,
      )
      .sort(relaxedCompare)[0];
    const expected = {
      interest: real.candidates.find(
        (c) => c.recommendation!.role === "interest",
      )!.groupId,
      easy: real.candidates.find((c) => c.recommendation!.role === "easy")
        ?.groupId,
      relaxed: real.candidates.find((c) => c.recommendation!.role === "relaxed")
        ?.groupId,
    };
    expect(interestWinner.groupId).toBe(expected.interest);
    expect(easyWinner?.groupId).toBe(expected.easy);
    expect(relaxedWinner?.groupId).toBe(expected.relaxed);
  });

  it("6개 지정 지역이 전부 지역 매핑에 존재한다(매핑 실패 사례가 아니다)", () => {
    for (const [label, groupId] of Object.entries(FOCUS_GROUPS)) {
      const found = rows.some(
        (row) => "groupId" in row && row.groupId === groupId,
      );
      if (!found) console.error(`${label}(${groupId}) 진단 행 없음`);
      expect(found).toBe(true);
    }
  });

  it("데이터 덤프", () => {
    if (process.env.R1_OUT) {
      const interestRanked = [...candidates].sort(interestCompare);
      const easyRankedAll = [...candidates].sort(easyCompare);
      const relaxedRankedAll = [...candidates].sort(relaxedCompare);
      const rankOf = (arr: DiagCandidate[], groupId: string) =>
        arr.findIndex((c) => c.groupId === groupId) + 1;
      const focus = Object.fromEntries(
        Object.entries(FOCUS_GROUPS).map(([label, groupId]) => {
          const row = rows.find((r) => "groupId" in r && r.groupId === groupId);
          const candidate = candidates.find((c) => c.groupId === groupId);
          return [
            label,
            {
              groupId,
              row,
              ranks: candidate
                ? {
                    interest: rankOf(interestRanked, groupId),
                    easy: rankOf(easyRankedAll, groupId),
                    relaxed: rankOf(relaxedRankedAll, groupId),
                  }
                : null,
              candidateCountTotal: candidates.length,
            },
          ];
        }),
      );
      const stageCounts = rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.stage] = (acc[row.stage] ?? 0) + 1;
        return acc;
      }, {});
      writeFileSync(
        process.env.R1_OUT,
        JSON.stringify(
          {
            input: R1_FIXED_INPUT,
            searchedAt: SEARCHED_AT,
            real:
              real.kind === "success"
                ? real.candidates.map((c) => ({
                    role: c.recommendation!.role,
                    groupId: c.groupId,
                    displayName: c.displayName,
                    roundTripMinutes: c.recommendation!.roundTripMinutes,
                    fitBand: c.recommendation!.purpose?.fitBand ?? null,
                    matchedFacilityCount:
                      c.recommendation!.purpose?.matchedFacilityCount ?? null,
                    placed: c.preview.blocks
                      .filter((b) => b.kind === "attraction" && b.attraction)
                      .map((b) => b.attraction!.title),
                  }))
                : real,
            stageCounts,
            candidateCount: candidates.length,
            focus,
            interestRankedTop20: interestRanked.slice(0, 20).map((c) => ({
              groupId: c.groupId,
              displayName: c.displayName,
              roundTripMinutes: c.roundTripMinutes,
              fitBand: c.fitBand,
              matchedFacilityCount: c.matchedFacilityCount,
              fulfilledInterestCount: c.fulfilledInterestCount,
              placedTitles: c.placed.map((p) => p.title),
            })),
            allCandidates: candidates.map((c) => ({
              groupId: c.groupId,
              displayName: c.displayName,
              province: c.province,
              oneWayMinutes: c.oneWayMinutes,
              roundTripMinutes: c.roundTripMinutes,
              poolSize: c.poolSize,
              fitBand: c.fitBand,
              fitAverage: c.purpose.fitAverage,
              matchedFacilityCount: c.matchedFacilityCount,
              matchedHubCount: c.purpose.matchedHubCount,
              purposeStatus: c.purpose.status,
              fulfilledInterestCount: c.fulfilledInterestCount,
              attractionCount: c.attractionCount,
              categoryDiversity: c.categoryDiversity,
              localFreeMinutes: c.localFreeMinutes,
              averageDistanceKm: c.averageDistanceKm,
              proximityComparable: c.proximityComparable,
              placed: c.placed,
            })),
            dropped: rows.filter((r) => r.stage !== "candidate"),
          },
          null,
          2,
        ),
      );
    }
    expect(true).toBe(true);
  });
});
