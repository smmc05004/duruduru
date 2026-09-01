import { describe, expect, it } from "@jest/globals";
import { provisionalSupportSet } from "../support-conditions";
import {
  validateTripConditions,
  type TripConditionsDraft,
} from "../trip-conditions";

const draft = (
  overrides: Partial<TripConditionsDraft> = {},
): TripConditionsDraft => ({
  originId: "seoul",
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
  transport: "car",
  interests: ["역사"],
  ...overrides,
});

const messagesFor = (
  result: ReturnType<typeof validateTripConditions>,
  field: string,
) =>
  result.ok
    ? []
    : result.errors
        .filter((error) => error.field === field)
        .map((error) => error.message);

describe("validateTripConditions", () => {
  it("유효한 조건은 통과하고 정규화된 조건을 돌려준다", () => {
    const result = validateTripConditions(draft(), provisionalSupportSet);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conditions.originId).toBe("seoul");
    expect(result.conditions.transport).toBe("car");
    expect(result.conditions.interests).toEqual(["역사"]);
    // 시간 계산은 하나의 명시적 시간대(KST) 기준이다. 실행 환경의 로컬 시간대에 의존하지 않는다.
    expect(result.conditions.startAt.toISOString()).toBe(
      "2026-09-11T23:00:00.000Z",
    );
    expect(result.conditions.returnBy.toISOString()).toBe(
      "2026-09-13T11:00:00.000Z",
    );
    expect(result.conditions.availableHours).toBe(36);
  });

  /*
   * 이 자리에는 "관심사는 0개여도 통과한다"가 있었다. 2026-08-31 F-01이 관심사 1개 이상
   * 필수로 바뀌어(DECISIONS.md 7.3절) 기대가 뒤집혔다. 새 단정은 아래 "관심사 필수 검증"에 있다.
   */
  it("관심사를 여러 개 골라도 통과하고 원문 순서를 유지한다", () => {
    const result = validateTripConditions(
      draft({ interests: ["역사", "자연"] }),
      provisionalSupportSet,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conditions.interests).toEqual(["역사", "자연"]);
  });

  it("복귀가 출발보다 이른 입력은 차단하고 복귀 항목에 오류를 붙인다", () => {
    const result = validateTripConditions(
      draft({ startAt: "2026-09-12T08:00", returnBy: "2026-09-12T06:00" }),
      provisionalSupportSet,
    );

    expect(result.ok).toBe(false);
    expect(messagesFor(result, "returnBy")).toEqual([
      "복귀 시각이 출발보다 빨라요. 출발 이후로 맞춰 주세요.",
    ]);
  });

  it("복귀와 출발이 같은 시각이면 차단하지 않는다", () => {
    const result = validateTripConditions(
      draft({ startAt: "2026-09-12T08:00", returnBy: "2026-09-12T08:00" }),
      provisionalSupportSet,
    );

    expect(result.ok).toBe(true);
  });

  it("필수값이 비면 항목별 오류를 만든다", () => {
    const result = validateTripConditions(
      draft({ originId: "", startAt: "", returnBy: "", transport: "" }),
      provisionalSupportSet,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.field).sort()).toEqual([
      "originId",
      "returnBy",
      "startAt",
      "transport",
    ]);
  });

  it("파싱할 수 없는 일시는 해당 항목의 오류가 된다", () => {
    const result = validateTripConditions(
      draft({ startAt: "2026-09-99T99:99" }),
      provisionalSupportSet,
    );

    expect(result.ok).toBe(false);
    expect(messagesFor(result, "startAt")).toEqual([
      "날짜와 시각을 읽을 수 없어요. 다시 골라 주세요.",
    ]);
  });

  it("일시를 읽을 수 없으면 복귀 순서 검사를 대신 주장하지 않는다", () => {
    const result = validateTripConditions(
      draft({ returnBy: "" }),
      provisionalSupportSet,
    );

    expect(messagesFor(result, "returnBy")).toEqual([
      "복귀 가능 일시를 골라 주세요.",
    ]);
  });

  it("지원하지 않는 출발지는 차단한다", () => {
    const result = validateTripConditions(
      draft({ originId: "cheongju" }),
      provisionalSupportSet,
    );

    expect(result.ok).toBe(false);
    expect(messagesFor(result, "originId")).toEqual([
      "아직 지원하지 않는 출발지예요. 목록에서 골라 주세요.",
    ]);
  });

  it("지원하지 않는 이동수단은 차단한다", () => {
    const result = validateTripConditions(
      draft({ transport: "public" }),
      provisionalSupportSet,
    );

    expect(result.ok).toBe(false);
    expect(messagesFor(result, "transport")).toEqual([
      "아직 지원하지 않는 이동수단이에요. 자차로 골라 주세요.",
    ]);
  });

  it("여러 항목이 동시에 잘못되면 오류를 모두 모아 준다", () => {
    const result = validateTripConditions(
      draft({ originId: "cheongju", returnBy: "2026-09-12T06:00" }),
      provisionalSupportSet,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
  });
});

/*
 * 관심사 1개 이상 필수 (2026-08-31 확정 — DECISIONS.md 7.3절, FUNCTIONAL_SPEC.md F-01).
 * 명세가 앞서 있고 구현이 따라오지 않았던 구간이다.
 */
describe("관심사 필수 검증", () => {
  it("관심사를 하나도 고르지 않으면 필수값 누락으로 제출을 막는다", () => {
    const result = validateTripConditions(
      draft({ interests: [] }),
      provisionalSupportSet,
    );
    expect(result.ok).toBe(false);
    expect(messagesFor(result, "interests")).toHaveLength(1);
  });

  it("관심사를 하나 이상 고르면 통과한다", () => {
    const result = validateTripConditions(
      draft({ interests: ["역사"] }),
      provisionalSupportSet,
    );
    expect(result.ok).toBe(true);
  });
});
