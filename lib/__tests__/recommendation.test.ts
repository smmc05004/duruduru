import { describe, expect, it } from "@jest/globals";
import {
  destinationsFrom,
  evaluateCandidates,
  resolveTripDuration,
} from "@/lib/recommendation";
import {
  recommendationPolicyV1,
  type RecommendationPolicy,
} from "@/lib/trip-policy";
import type { TravelTimeAdapter, TravelTimeEstimate } from "@/lib/travel-time";
import { supportConditionsV1 } from "@/lib/support-conditions";
import { pocDataAdapter } from "@/lib/poc-data-adapter";
import { validateTripConditions } from "@/lib/trip-conditions";

/*
 * F-02·F-03 판정·점수의 도메인 규칙 검증.
 * 근거: FUNCTIONAL_SPEC.md 8.1절, DECISIONS.md 6.1·6.3·7.1·7.2·7.4절.
 */

function conditions(startAt: string, returnBy: string, interests: string[]) {
  const result = validateTripConditions(
    { originId: "seoul", startAt, returnBy, transport: "car", interests },
    supportConditionsV1,
  );
  if (!result.ok)
    throw new Error(
      `테스트 조건이 검증을 통과하지 못했습니다: ${JSON.stringify(result.errors)}`,
    );
  return result.conditions;
}

/** 후보별 편도 이동시간을 그대로 돌려주는 테스트용 어댑터. */
function adapterOf(oneWayHours: Record<string, number>): TravelTimeAdapter {
  return {
    lookup(_originId, destinationId): TravelTimeEstimate | null {
      const hours = oneWayHours[destinationId];
      if (hours === undefined) return null;
      return {
        destinationId,
        oneWayHours: hours,
        kind: "estimate",
        source: "테스트 고정값",
        basisDate: "2026-08-31",
        provisional: true,
      };
    },
  };
}

const gyeongju = {
  id: "gyeongju",
  name: "경주",
  region: "경상북도",
  tags: ["역사", "문화"],
};
const gangneung = {
  id: "gangneung",
  name: "강릉",
  region: "강원특별자치도",
  tags: ["자연", "미식"],
};
const both = {
  id: "both",
  name: "둘다",
  region: "어딘가",
  tags: ["역사", "자연"],
};

describe("여행 유형 판별 (DECISIONS 7.4 · 6.3 일반화)", () => {
  it("같은 KST 달력일이면 당일치기이고 최소 체류시간은 4시간이다", () => {
    const duration = resolveTripDuration(
      conditions("2026-09-12T08:00", "2026-09-12T22:00", ["역사"]),
      recommendationPolicyV1,
    );
    expect(duration.days).toBe(1);
    expect(duration.nights).toBe(0);
    expect(duration.label).toBe("당일치기");
    expect(duration.minimumLocalStayHours).toBe(4);
  });

  it("달력일이 하나 넘어가면 1박 2일이고 8시간이다", () => {
    const duration = resolveTripDuration(
      conditions("2026-09-12T08:00", "2026-09-13T20:00", ["역사"]),
      recommendationPolicyV1,
    );
    expect(duration.label).toBe("1박 2일");
    expect(duration.minimumLocalStayHours).toBe(8);
  });

  it("달력일이 둘 넘어가면 2박 3일이고 12시간이다", () => {
    const duration = resolveTripDuration(
      conditions("2026-09-12T08:00", "2026-09-14T20:00", ["역사"]),
      recommendationPolicyV1,
    );
    expect(duration.label).toBe("2박 3일");
    expect(duration.minimumLocalStayHours).toBe(12);
  });

  it("밤을 새워 달력일만 넘어가는 일정도 달력일 규칙대로 1박 2일로 센다 (무박은 별도 유형이 아니다)", () => {
    const duration = resolveTripDuration(
      conditions("2026-09-12T08:00", "2026-09-13T02:00", ["역사"]),
      recommendationPolicyV1,
    );
    expect(duration.label).toBe("1박 2일");
    expect(duration.minimumLocalStayHours).toBe(8);
  });
});

describe("통과·탈락 판정 (FUNCTIONAL_SPEC 8.1 딱 충족 / 1분 미달)", () => {
  // 당일치기 08:00~20:00 = 12시간. 최소 체류 4시간이므로 왕복 8시간(편도 4시간)이 경계다.
  const trip = conditions("2026-09-12T08:00", "2026-09-12T20:00", ["역사"]);

  it("딱 충족하는 후보는 통과한다", () => {
    const outcome = evaluateCandidates(
      {
        conditions: trip,
        destinations: [gyeongju],
        travelTime: adapterOf({ gyeongju: 4 }),
      },
      recommendationPolicyV1,
    );
    expect(outcome.passed.map((item) => item.id)).toEqual(["gyeongju"]);
    expect(outcome.passed[0].localAvailableHours).toBeCloseTo(4, 10);
  });

  it("1분 미달하는 후보는 제외된다", () => {
    const outcome = evaluateCandidates(
      {
        conditions: trip,
        destinations: [gyeongju],
        travelTime: adapterOf({ gyeongju: 4 + 0.5 / 60 }),
      },
      recommendationPolicyV1,
    );
    expect(outcome.passed).toHaveLength(0);
    expect(outcome.rejected.map((item) => item.id)).toEqual(["gyeongju"]);
    expect(outcome.rejected[0].rejectionReason).toContain("최소");
  });

  it("이동시간 데이터가 없는 후보는 값을 지어내지 않고 제외한다", () => {
    const outcome = evaluateCandidates(
      { conditions: trip, destinations: [gyeongju], travelTime: adapterOf({}) },
      recommendationPolicyV1,
    );
    expect(outcome.passed).toHaveLength(0);
    expect(outcome.rejected[0].rejectionReason).toContain("이동시간");
    expect(outcome.rejected[0].travel).toBeNull();
  });
});

describe("점수 구성요소 산식 (DECISIONS 7.1 · 7.2)", () => {
  const trip = conditions("2026-09-12T08:00", "2026-09-13T20:00", [
    "역사",
    "자연",
  ]);

  it("관심사 일치는 일치 태그 수 / 선택 관심사 수다", () => {
    const outcome = evaluateCandidates(
      {
        conditions: trip,
        destinations: [gyeongju, both],
        travelTime: adapterOf({ gyeongju: 3.5, both: 3.5 }),
      },
      recommendationPolicyV1,
    );
    const interestOf = (id: string) =>
      outcome.passed
        .find((item) => item.id === id)!
        .components.find((c) => c.id === "interestFit")!.raw;
    expect(interestOf("gyeongju")).toBeCloseTo(0.5, 10);
    expect(interestOf("both")).toBeCloseTo(1, 10);
  });

  it("시간 적합성은 현지 이용 가능 시간 / (복귀 − 출발)이며 후보 집합이 바뀌어도 같다", () => {
    const timeFitOf = (destinations: (typeof gyeongju)[]) => {
      const outcome = evaluateCandidates(
        {
          conditions: trip,
          destinations,
          travelTime: adapterOf({ gyeongju: 3.5, both: 1.6, gangneung: 2.8 }),
        },
        recommendationPolicyV1,
      );
      return outcome.candidates
        .find((item) => item.id === "gyeongju")!
        .components.find((c) => c.id === "timeFit")!.raw;
    };
    // 36시간 − 왕복 7시간 = 29시간, 29/36
    expect(timeFitOf([gyeongju])).toBeCloseTo(29 / 36, 10);
    expect(timeFitOf([gyeongju, both, gangneung])).toBeCloseTo(29 / 36, 10);
  });

  it("축제 미구현 구간에서는 시간 0.60 / 관심사 0.40으로 재정규화한다", () => {
    const outcome = evaluateCandidates(
      {
        conditions: trip,
        destinations: [gyeongju],
        travelTime: adapterOf({ gyeongju: 3.5 }),
      },
      recommendationPolicyV1,
    );
    const candidate = outcome.passed[0];
    expect(candidate.usedWeights).toEqual({ timeFit: 0.6, interestFit: 0.4 });
    expect(candidate.score).toBeCloseTo(0.6 * (29 / 36) + 0.4 * 0.5, 10);
  });
});

describe("관심사 0개 안전장치 (DECISIONS 6.1 · 7.3)", () => {
  it("관심사가 0개면 관심사 항을 제외하고 남은 항을 재정규화한다", () => {
    // 화면 검증은 관심사 1개 이상을 요구하지만, 엔진은 임의값으로 대체하지 않고 항을 제외한다.
    const trip = conditions("2026-09-12T08:00", "2026-09-13T20:00", ["역사"]);
    const outcome = evaluateCandidates(
      {
        conditions: { ...trip, interests: [] },
        destinations: [gyeongju],
        travelTime: adapterOf({ gyeongju: 3.5 }),
      },
      recommendationPolicyV1,
    );
    const candidate = outcome.passed[0];
    expect(candidate.usedWeights).toEqual({ timeFit: 1 });
    expect(
      candidate.components.find((c) => c.id === "interestFit")!.available,
    ).toBe(false);
    expect(candidate.score).toBeCloseTo(29 / 36, 10);
  });
});

describe("정렬·동점 규칙 (DECISIONS 6.1)", () => {
  const trip = conditions("2026-09-12T08:00", "2026-09-13T20:00", ["역사"]);
  const near = { id: "b-near", name: "가까운곳", region: "가", tags: ["역사"] };
  const far = { id: "a-far", name: "먼곳", region: "나", tags: ["역사"] };

  it("점수가 다르면 점수 내림차순이다", () => {
    const outcome = evaluateCandidates(
      {
        conditions: trip,
        destinations: [far, near],
        travelTime: adapterOf({ "a-far": 3.5, "b-near": 1.6 }),
      },
      recommendationPolicyV1,
    );
    expect(outcome.passed.map((item) => item.id)).toEqual(["b-near", "a-far"]);
  });

  it("점수가 같으면 현지 이용 가능 시간 → 왕복 이동 → 안정 식별자 순으로 가르고 갈린 단계를 남긴다", () => {
    const sameA = { id: "z-same", name: "지", region: "가", tags: ["역사"] };
    const sameB = { id: "a-same", name: "에이", region: "나", tags: ["역사"] };
    const outcome = evaluateCandidates(
      {
        conditions: trip,
        destinations: [sameA, sameB],
        travelTime: adapterOf({ "z-same": 2, "a-same": 2 }),
      },
      recommendationPolicyV1,
    );
    expect(outcome.passed.map((item) => item.id)).toEqual(["a-same", "z-same"]);
    expect(outcome.tiebreaks).toEqual([
      { winnerId: "a-same", loserId: "z-same", stepId: "destinationId" },
    ]);
  });

  it("같은 입력이면 입력 배열 순서가 달라도 같은 순서가 나온다", () => {
    const build = (destinations: (typeof gyeongju)[]) =>
      evaluateCandidates(
        {
          conditions: trip,
          destinations,
          travelTime: adapterOf({ "a-far": 3.5, "b-near": 1.6, gyeongju: 3.5 }),
        },
        recommendationPolicyV1,
      ).passed.map((item) => item.id);
    expect(build([far, near, gyeongju])).toEqual(build([gyeongju, near, far]));
  });
});

describe("정책 주입 (DECISIONS 6.1 세 가지 요구)", () => {
  const trip = conditions("2026-09-12T08:00", "2026-09-13T20:00", ["역사"]);

  it("정책이 주입되지 않으면 임의값으로 대체하지 않고 실패한다", () => {
    expect(() =>
      evaluateCandidates(
        {
          conditions: trip,
          destinations: [gyeongju],
          travelTime: adapterOf({ gyeongju: 3.5 }),
        },
        undefined as unknown as RecommendationPolicy,
      ),
    ).toThrow(/정책/);
  });

  it("결과에 정책 버전과 구성요소별 점수가 남는다", () => {
    const outcome = evaluateCandidates(
      {
        conditions: trip,
        destinations: [gyeongju],
        travelTime: adapterOf({ gyeongju: 3.5 }),
      },
      recommendationPolicyV1,
    );
    expect(outcome.policyVersion).toBe(recommendationPolicyV1.version);
    expect(outcome.passed[0].policyVersion).toBe(
      recommendationPolicyV1.version,
    );
    expect(outcome.passed[0].components.map((c) => c.id)).toEqual([
      "timeFit",
      "interestFit",
    ]);
    expect(outcome.passed[0].components[0].weighted).toBeCloseTo(
      0.6 * (29 / 36),
      10,
    );
  });

  it("동점 단계 목록은 코드 분기가 아니라 정책의 순서 있는 데이터다", () => {
    expect(recommendationPolicyV1.tiebreakSteps.map((step) => step.id)).toEqual(
      ["localAvailableHours", "roundTripHours", "destinationId"],
    );
  });
});

describe("목업 목적지 어댑터", () => {
  it("PoC 목업 목적지를 후보 형태로 바꿔 준다", () => {
    const list = destinationsFrom(pocDataAdapter);
    expect(list.map((item) => item.id)).toEqual([
      "gyeongju",
      "gongju",
      "gangneung",
    ]);
    expect(list[0].tags).toContain("역사");
  });
});
