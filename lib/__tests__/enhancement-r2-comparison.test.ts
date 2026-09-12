/** @jest-environment node */
/**
 * R2 오프라인 대안 비교(작업 계획 `docs/development/TOURISM_RECOMMENDATION_WORK_PLAN.md`
 * R2 행, 제품 재작업 기준 `docs/product/RECOMMENDATION_QUALITY_RECOVERY.md`).
 *
 * **배포 코드는 이번에 수정하지 않는다.** T6/T7과 같은 48개 입력 매트릭스(출발지 4 ×
 * 관심사 6 × 시간 2)와 R1이 지정한 고정 입력(서울·역사·주간, 남양주·하남·과천·공주·
 * 익산·경주 6개 지역)에서, `lib/test-support/r2-comparison-core.ts`의 재구성 후보
 * 목록 위에 기준선(현재 배포 정렬)과 4개 대안(+조합 1개)을 각각 적용해 최종 3곳을
 * 비교한다. `R2_OUT` 환경변수가 있으면 JSON을 덤프해 `scripts/report-r2-comparison.mjs`가
 * 표로 만든다.
 *
 * 각 셀에서 재구성 결과가 실제 배포 `searchPhaseTwo` 출력과 완전히 같음을 먼저
 * 검증한다(정합성 검증, R1과 동일 방식을 48개 셀 전체로 확장) — 이 검증이 실패하면
 * 기준선 자체가 틀렸다는 뜻이므로 대안 비교보다 먼저 드러나야 한다.
 *
 * 모든 비교자는 실수(real-valued)·정수 키의 사전식(lexicographic) 비교만 쓴다.
 * 사전식 비교는 각 키가 전순서(total order)이면 그 조합도 항상 전순서라 구조적으로
 * 비추이적일 수 없다(불리언 단독 비교나 "다른 후보와의 직접 비교" 같은 상대적 규칙만
 * 비추이성 위험이 있다 — 이 파일은 그런 키를 쓰지 않는다). 큰 후보군(경주 포함 셀)에서
 * 무작위 표본 삼중항으로 이를 실측 확인한다(§"정렬은 비추이적이지 않다").
 *
 * 외부 fetch 0회(정상본 JSON만 읽음, `enhancement-t6-search-no-network.test.ts`의
 * 모듈 그래프 안).
 */
import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "@jest/globals";
import type { MvpCategoryId } from "@/lib/mvp-region-data";
import type { SearchInput } from "@/lib/mvp-phase-two-types";
import {
  alt1InterestCompare,
  alt4RelaxedCompare,
  assessLongDistanceSubstance,
  baselineEasyCompare,
  baselineInterestCompare,
  baselineRelaxedCompare,
  diagnoseAll,
  hubPoolForGroup,
  makeAlt2InterestCompare,
  makeAlt3InterestCompare,
  nationalHubPoolSummary,
  selectFinalThree,
  selectTopThreeBySingleRanking,
  verifyReconstruction,
  type DiagCandidate,
  type FinalThree,
} from "@/lib/test-support/r2-comparison-core";

const ORIGINS = [
  { key: "seoul", originId: "seoul" },
  { key: "busan", originId: "busan" },
  { key: "gangneung", originId: "ktdb-zone-122" },
  { key: "suwon", originId: "ktdb-zone-78" },
];
const INTEREST_SETS: Array<{ key: string; interests: MvpCategoryId[] }> = [
  { key: "history", interests: ["history"] },
  { key: "nature", interests: ["nature"] },
  { key: "culture", interests: ["culture"] },
  { key: "leisure", interests: ["leisure"] },
  { key: "rest", interests: ["rest"] },
  { key: "history+culture", interests: ["history", "culture"] },
];
const TIME_CASES = [
  { key: "day", startAt: "2026-09-12T08:00", returnBy: "2026-09-13T20:00" },
  { key: "night", startAt: "2026-09-12T18:00", returnBy: "2026-09-13T20:00" },
];
const SEARCHED_AT = "2026-09-11T00:00:00.000Z";

/** R1이 지정한 6개 지역의 groupId(재작업 기준 문서 배경 사례). */
const FOCUS_GROUPS: Record<string, string> = {
  남양주: "municipality:경기도:남양주시",
  하남: "municipality:경기도:하남시",
  과천: "municipality:경기도:과천시",
  공주: "municipality:충청남도:공주시",
  익산: "municipality:전북특별자치도:익산시",
  경주: "municipality:경상북도:경주시",
};
const R1_FIXED_INPUT: SearchInput = {
  originId: "seoul",
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
  transport: "car",
  interests: ["history"],
};

/** 대안 3(포화 상한 상향)의 구체 캡 — 시설 4→6·유형 3→4. */
const ALT3_FACILITY_CAP = 6;
const ALT3_TYPE_CAP = 4;

function makeCompares(interests: MvpCategoryId[]) {
  const alt2Interest = makeAlt2InterestCompare(interests);
  const alt3Interest = makeAlt3InterestCompare(
    interests,
    ALT3_FACILITY_CAP,
    ALT3_TYPE_CAP,
  );
  return {
    baseline: {
      interest: baselineInterestCompare,
      easy: baselineEasyCompare,
      relaxed: baselineRelaxedCompare,
    },
    alt1ScoreReintroduced: {
      interest: alt1InterestCompare,
      easy: baselineEasyCompare,
      relaxed: baselineRelaxedCompare,
    },
    alt2BestHubBounded: {
      interest: alt2Interest,
      easy: baselineEasyCompare,
      relaxed: baselineRelaxedCompare,
    },
    alt3RaisedCaps: {
      interest: alt3Interest,
      easy: baselineEasyCompare,
      relaxed: baselineRelaxedCompare,
    },
    alt4FarRelaxed: {
      interest: baselineInterestCompare,
      easy: baselineEasyCompare,
      relaxed: alt4RelaxedCompare,
    },
    alt5Combined: {
      interest: alt2Interest,
      easy: baselineEasyCompare,
      relaxed: alt4RelaxedCompare,
    },
  } as const;
}

function summarizeCandidate(
  c: DiagCandidate | null,
  interests: MvpCategoryId[],
) {
  if (!c) return null;
  const bestHub = (() => {
    let best: { hubRank: number; title: string } | null = null;
    for (const place of c.placed) {
      if (!place.hub) continue;
      if (!place.categories.some((cat) => interests.includes(cat))) continue;
      if (!best || place.hub.hubRank < best.hubRank)
        best = { hubRank: place.hub.hubRank, title: place.title };
    }
    return best;
  })();
  // R2 보완(지적 2·1) — 구성 가능성은 diagnoseAll의 scheduleTrip 성공으로 이미
  // 보장됨(itineraryConstructable: true). 여기서는 실질(구색맞추기 여부)과 허브
  // 풀 크기만 추가한다. 새 API 호출 없음, 이미 계산된 필드만 재조합한다.
  const substance = assessLongDistanceSubstance(c, interests);
  const hubPool = hubPoolForGroup(c);
  return {
    groupId: c.groupId,
    displayName: c.displayName,
    province: c.province,
    isMetropolitanGroup: c.isMetropolitanGroup,
    memberRegionCount: c.memberRegionIds.length,
    roundTripMinutes: c.roundTripMinutes,
    fitBand: c.fitBand,
    matchedFacilityCount: c.matchedFacilityCount,
    purposeScore: c.purpose.score,
    bestHubRank: bestHub?.hubRank ?? null,
    bestHubTitle: bestHub?.title ?? null,
    localFreeMinutes: c.localFreeMinutes,
    placedTitles: c.placed.map((p) => p.title),
    fulfilledInterestCount: substance.fulfilledInterestCount,
    interestRelevantPlacedCount: substance.interestRelevantPlacedCount,
    interestRelevantDetailTypeCount: substance.interestRelevantDetailTypeCount,
    isTokenOnly: substance.isTokenOnly,
    isSubstantive: substance.isSubstantive,
    hubPoolTotal: hubPool.totalPool,
    hubPoolMemberCount: hubPool.memberCount,
  };
}

function summarizeFinalThree(three: FinalThree, interests: MvpCategoryId[]) {
  return {
    interest: summarizeCandidate(three.interest, interests),
    easy: summarizeCandidate(three.easy, interests),
    relaxed: summarizeCandidate(three.relaxed, interests),
  };
}

describe("R2 오프라인 대안 비교 — 48개 입력 매트릭스", () => {
  const rows: unknown[] = [];

  for (const origin of ORIGINS) {
    for (const set of INTEREST_SETS) {
      for (const time of TIME_CASES) {
        it(`${origin.key} · ${set.key} · ${time.key}`, () => {
          const input: SearchInput = {
            originId: origin.originId,
            startAt: time.startAt,
            returnBy: time.returnBy,
            transport: "car",
            interests: set.interests,
          };
          const { candidates } = diagnoseAll(input);
          if (candidates.length === 0) {
            rows.push({
              origin: origin.key,
              interests: set.key,
              time: time.key,
              candidateCount: 0,
            });
            return;
          }
          const verification = verifyReconstruction(
            input,
            candidates,
            SEARCHED_AT,
          );
          expect(verification.ok).toBe(true);

          const compares = makeCompares(set.interests);
          const byAlt: Record<
            string,
            ReturnType<typeof summarizeFinalThree>
          > = {};
          for (const [altKey, roleCompares] of Object.entries(compares)) {
            const three = selectFinalThree(candidates, roleCompares);
            byAlt[altKey] = summarizeFinalThree(three, set.interests);
          }

          // 결정성: 같은 후보 배열을 다시 정렬해도 같은 결과.
          const repeat = selectFinalThree(candidates, compares.baseline);
          expect(
            JSON.stringify(summarizeFinalThree(repeat, set.interests)),
          ).toBe(JSON.stringify(byAlt.baseline));

          // R2 보완(지적 3) — 최종 3장 "구성" 자체를 바꾼 대안: 역할을 나누지
          // 않고 단일 관심사 적합성 순위(기준선 interest 비교자)에서 서로 다른
          // groupId 상위 3개를 그대로 뽑는다. 새 사용자 입력·거리 하한/가점 없음.
          const composeSingleRankingRaw = selectTopThreeBySingleRanking(
            candidates,
            baselineInterestCompare,
          );
          const composeGroupIds = composeSingleRankingRaw
            .filter((c): c is DiagCandidate => c !== null)
            .map((c) => c.groupId);
          expect(new Set(composeGroupIds).size).toBe(composeGroupIds.length);
          const composeSingleRanking = composeSingleRankingRaw.map((c) =>
            summarizeCandidate(c, set.interests),
          );

          rows.push({
            origin: origin.key,
            interests: set.key,
            time: time.key,
            candidateCount: candidates.length,
            ...byAlt,
            composeSingleRanking,
          });
        });
      }
    }
  }

  afterAll(() => {
    if (process.env.R2_OUT)
      writeFileSync(process.env.R2_OUT, JSON.stringify(rows, null, 2));
  });

  it("정렬은 비추이적이지 않다(경주 포함 대형 후보군 무작위 삼중항 표본)", () => {
    const { candidates } = diagnoseAll(R1_FIXED_INPUT);
    expect(candidates.length).toBeGreaterThan(100);
    const compares = makeCompares(R1_FIXED_INPUT.interests);
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pickThree = () => {
      const pick = () => candidates[Math.floor(rand() * candidates.length)];
      return [pick(), pick(), pick()] as const;
    };
    for (const [, roleCompares] of Object.entries(compares)) {
      for (const compare of Object.values(roleCompares)) {
        for (let sample = 0; sample < 300; sample++) {
          const [a, b, c] = pickThree();
          const ab = compare(a, b);
          const bc = compare(b, c);
          const ac = compare(a, c);
          if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0);
          if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe("R2 오프라인 대안 비교 — R1 고정 입력의 6개 지정 지역", () => {
  const { candidates } = diagnoseAll(R1_FIXED_INPUT);
  const compares = makeCompares(R1_FIXED_INPUT.interests);

  it("6개 지역이 전부 시간 적합 후보(candidate)다(전제 조건)", () => {
    for (const groupId of Object.values(FOCUS_GROUPS))
      expect(candidates.some((c) => c.groupId === groupId)).toBe(true);
  });

  const focusDump: Record<string, unknown> = {};
  for (const [altKey, roleCompares] of Object.entries(compares)) {
    it(`대안 ${altKey}: 재구성이 유효한 최종 3곳을 만든다`, () => {
      const three = selectFinalThree(candidates, roleCompares);
      expect(three.interest).not.toBeNull();
      expect(three.easy).not.toBeNull();
      expect(three.relaxed).not.toBeNull();
      expect(
        new Set([
          three.interest!.groupId,
          three.easy!.groupId,
          three.relaxed!.groupId,
        ]).size,
      ).toBe(3);
    });
    const rankOf = (
      compare: (a: DiagCandidate, b: DiagCandidate) => number,
    ) => {
      const ranked = [...candidates].toSorted(compare);
      return (groupId: string) =>
        ranked.findIndex((c) => c.groupId === groupId) + 1;
    };
    const interestRank = rankOf(roleCompares.interest);
    const easyRank = rankOf(roleCompares.easy);
    const relaxedRank = rankOf(roleCompares.relaxed);
    focusDump[altKey] = Object.fromEntries(
      Object.entries(FOCUS_GROUPS).map(([label, groupId]) => [
        label,
        {
          groupId,
          interestRank: interestRank(groupId),
          easyRank: easyRank(groupId),
          relaxedRank: relaxedRank(groupId),
          of: candidates.length,
        },
      ]),
    );
  }

  // R2 보완(지적 1) — 허브 풀 크기. `data/central-attractions.json`(T3 산출물)의
  // 실제 `totalCount`(그 지역 중심 관광지 API 조회에서 돌려준 총 개수)를 6개
  // 지정 지역과 전국 분포로 확인한다. 값은 정상본 데이터의 실측이며, 아래
  // 구체값이 바뀌면 정상본이 갱신됐다는 뜻이므로 문서 재검증이 필요하다.
  const hubPoolByFocus = Object.fromEntries(
    Object.entries(FOCUS_GROUPS).map(([label, groupId]) => {
      const candidate = candidates.find((c) => c.groupId === groupId)!;
      return [label, hubPoolForGroup(candidate)];
    }),
  );
  const nationalPool = nationalHubPoolSummary();

  it("허브 풀 크기 — 5개 시·군은 100(또는 API 원본 상한), 과천만 63으로 더 작다", () => {
    expect(hubPoolByFocus["남양주"].totalPool).toBe(100);
    expect(hubPoolByFocus["하남"].totalPool).toBe(100);
    expect(hubPoolByFocus["과천"].totalPool).toBe(63);
    expect(hubPoolByFocus["공주"].totalPool).toBe(100);
    expect(hubPoolByFocus["익산"].totalPool).toBe(100);
    expect(hubPoolByFocus["경주"].totalPool).toBe(100);
    // 6개 전부 단일 시·군(구 분할 없음)이라 memberCount는 1이다 — 광역시 그룹과
    // 달리 이 6개 지역 사이에서는 "구성원 수가 다른 풀 합산" 문제가 없다.
    for (const info of Object.values(hubPoolByFocus))
      expect(info.memberCount).toBe(1);
  });

  it("허브 풀 크기 — 전국적으로는 지역마다 실제 조회 개수가 다르다(30~103)", () => {
    expect(nationalPool.min).toBeLessThan(50);
    expect(nationalPool.max).toBeGreaterThanOrEqual(100);
    expect(nationalPool.median).toBe(100);
  });

  it("허브 풀 크기 — 광역시 그룹 합산은 단일 시·군보다 자릿수가 다르게 크다", () => {
    // 광역시 그룹은 소속 구 전부의 풀을 합산한다(groupForMapping). 6개 지정
    // 지역(단일 시·군, 최대 100~103)과 비교해 최소 한 자릿수 이상 크다는 것을
    // 확인해, "풀이 큰 지역이 상위 N위 이내 개수에서 구조적으로 유리하다"는
    // 우려가 데이터로 실재하는지 검증한다.
    const busanSum = nationalPool.metropolitanGroupSums["부산광역시"];
    expect(busanSum).toBeGreaterThan(1000);
    expect(busanSum).toBeGreaterThan(hubPoolByFocus["경주"].totalPool * 10);
  });

  // R2 보완(지적 3) — 역할을 나누지 않는 단일 순위 top-3 구성을, 이 고정 입력
  // (서울·역사·주간)에서도 계산해 6개 지정 지역과의 관계를 함께 남긴다.
  const composeSingleRanking = selectTopThreeBySingleRanking(
    candidates,
    baselineInterestCompare,
  );

  // R2 보완(지적 4) — 근거리 vs 공주/익산/경주의 실제 방문 시각. R1/R2는 배치
  // 장소 목록만 보존했고 방문 시각은 없었다. `preview.blocks`(scheduleTrip이
  // 실제로 만든 시간표, diagnoseAll이 이미 계산해 둔 값)에서 그대로 추출한다 —
  // 재선정 없음.
  const focusSchedules = Object.fromEntries(
    Object.entries(FOCUS_GROUPS).map(([label, groupId]) => {
      const candidate = candidates.find((c) => c.groupId === groupId)!;
      return [
        label,
        candidate.preview.blocks
          .toSorted((a, b) => a.day - b.day || (a.startAt < b.startAt ? -1 : 1))
          .map((block) => ({
            day: block.day,
            startAt: block.startAt,
            endAt: block.endAt,
            kind: block.kind,
            title: block.title,
            reason: block.reason,
          })),
      ];
    }),
  );

  it("구성 대안(단일 순위 top-3) — 서로 다른 groupId 3개를 만든다", () => {
    const ids = composeSingleRanking
      .filter((c): c is DiagCandidate => c !== null)
      .map((c) => c.groupId);
    expect(new Set(ids).size).toBe(3);
  });

  it("데이터 덤프(R2_OUT)", () => {
    if (process.env.R2_OUT_FOCUS)
      writeFileSync(
        process.env.R2_OUT_FOCUS,
        JSON.stringify(
          {
            input: R1_FIXED_INPUT,
            candidateCount: candidates.length,
            focus: focusDump,
            hubPoolByFocus,
            nationalHubPoolSummary: nationalPool,
            composeSingleRanking: composeSingleRanking.map((c) =>
              summarizeCandidate(c, R1_FIXED_INPUT.interests),
            ),
            focusSchedules,
          },
          null,
          2,
        ),
      );
    expect(true).toBe(true);
  });
});
