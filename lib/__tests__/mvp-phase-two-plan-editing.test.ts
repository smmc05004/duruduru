import { describe, expect, it } from "@jest/globals";
import {
  createPlan,
  editPlan,
  planAccommodation,
  scheduleTrip,
} from "@/lib/mvp-phase-two-planner";
import type {
  Attraction,
  Candidate,
  SearchInput,
} from "@/lib/mvp-phase-two-types";

const input: SearchInput = {
  originId: "seoul",
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
  transport: "car",
  interests: ["history"],
};
const attraction = (contentId: string): Attraction => ({
  contentId,
  contentTypeId: "12",
  regionId: "fixture-region",
  title: `관광 ${contentId}`,
  address: "충남 공주시 테스트로 1",
  imageUrl: "",
  coordinates: { latitude: 36.46, longitude: 127.12 },
  categories: ["history"],
  cat1: "A02",
  cat2: "A0201",
  cat3: "A02010100",
});
function plan() {
  const attractions = ["A", "B", "C", "D"].map(attraction);
  const scheduled = scheduleTrip(input, 120, attractions.slice(0, 3));
  if (!scheduled.ok) throw new Error(scheduled.reason);
  const candidate = {
    groupId: "fixture-group",
    memberRegionIds: ["fixture-region"],
    representativeZoneId: "fixture-zone",
    displayName: "공주",
    name: "공주",
    province: "충남",
    oneWayMinutes: 120,
    attractions,
    metadata: {
      profileGeneratedAt: "2026-09-01T00:00:00Z",
      travelTimeGeneratedAt: "2026-09-01T00:00:00Z",
      networkYear: 2024,
      travelTimeSource: "KTDB",
      representativePoint: "대표점",
      searchedAt: "2026-09-01T00:00:00Z",
    },
    preview: { blocks: scheduled.blocks, metrics: scheduled.metrics },
    reasons: [],
  } as unknown as Candidate;
  return createPlan(input, candidate, "editing-test");
}

describe("E4 내 계획 편집", () => {
  it("다음 고정 시각 직전의 15분 여유 경계도 탐색해 기존 시각 이동을 최소화한다", () => {
    const original = plan();
    const [first, second] = original.blocks.filter(
      (block) => block.kind === "attraction",
    );
    const prepared = {
      ...original,
      blocks: [
        ...original.blocks.filter(
          (block) =>
            block.kind !== "attraction" &&
            !(block.day === 1 && block.kind === "travel"),
        ),
        {
          ...first,
          day: 1 as const,
          startAt: "2026-09-12T09:00",
          endAt: "2026-09-12T10:00",
        },
        {
          ...second,
          day: 1 as const,
          startAt: "2026-09-12T10:00",
          endAt: "2026-09-12T11:00",
          fixedStartAt: "2026-09-12T10:00",
        },
      ],
    };
    const result = editPlan(prepared, {
      type: "duration",
      blockId: first.id,
      durationMinutes: 60,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.plan.blocks.find((block) => block.id === first.id)?.startAt,
    ).toBe("2026-09-12T08:45");
  });

  it("날짜 이동·순서 변경·같은 그룹 후보 추가는 식당과 무관한 선택을 보존한다", () => {
    const original = plan();
    const first = original.blocks.find((block) => block.kind === "attraction")!;
    const moved = editPlan(original, {
      type: "move-activity",
      blockId: first.id,
      day: 2,
      position: 0,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.plan.blocks.find((block) => block.id === first.id)?.day).toBe(
      2,
    );
    const added = editPlan(moved.plan, {
      type: "add-attraction",
      contentId: "D",
      day: 1,
      durationMinutes: 90,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(
      added.plan.blocks.filter((block) => block.kind === "attraction"),
    ).toHaveLength(4);
  });

  it("날짜 이동의 삽입 위치는 대상 날짜 활동 순서에 그대로 반영한다", () => {
    const original = plan();
    const target = original.blocks
      .filter((block) => block.kind === "attraction")
      .at(-1)!;
    const moved = editPlan(original, {
      type: "move-activity",
      blockId: target.id,
      day: 2,
      position: 0,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(
      moved.plan.blocks
        .filter(
          (block) =>
            block.day === 2 &&
            (block.kind === "attraction" || block.kind === "personal"),
        )
        .toSorted((left, right) => left.startAt.localeCompare(right.startAt))[0]
        .id,
    ).toBe(target.id);
  });

  it("고정 시각은 날짜까지 고정하며 식사·야간·날짜 이동 충돌은 원자적으로 거절한다", () => {
    const original = plan();
    const target = original.blocks.find(
      (block) => block.kind === "attraction",
    )!;
    const fixed = editPlan(original, {
      type: "set-fixed-start",
      blockId: target.id,
      fixedStartAt: "2026-09-13T14:00",
    });
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;
    expect(
      fixed.plan.blocks.find((block) => block.id === target.id)?.startAt,
    ).toBe("2026-09-13T14:00");
    const conflict = editPlan(fixed.plan, {
      type: "move-activity",
      blockId: target.id,
      day: 2,
      position: 0,
    });
    expect(conflict).toEqual(
      expect.objectContaining({ ok: false, plan: fixed.plan }),
    );
    const night = editPlan(fixed.plan, {
      type: "set-fixed-start",
      blockId: target.id,
      fixedStartAt: "2026-09-13T21:00",
    });
    expect(night).toEqual(
      expect.objectContaining({ ok: false, plan: fixed.plan }),
    );
  });

  it("개인 일정은 최대 네 개이며 관광 수나 숙소 야간 휴식을 바꾸지 않는다", () => {
    let edited = plan();
    const rest = edited.blocks
      .filter((block) => block.kind === "rest")
      .map((block) => [block.startAt, block.endAt]);
    for (let index = 0; index < 4; index++) {
      const result = editPlan(edited, {
        type: "add-personal",
        personal: {
          id: `personal-${index}`,
          name: `약속 ${index}`,
          category: "appointment",
          day: 1,
          durationMinutes: 30,
          address: "",
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      edited = result.plan;
    }
    const fifth = editPlan(edited, {
      type: "add-personal",
      personal: {
        id: "personal-4",
        name: "다섯째",
        category: "place",
        day: 2,
        durationMinutes: 30,
        address: "",
      },
    });
    expect(fifth).toEqual(expect.objectContaining({ ok: false, plan: edited }));
    expect(
      planAccommodation(edited, {
        name: "숙소",
        address: "공주",
        note: "늦게 도착",
      }).ok,
    ).toBe(true);
    expect(
      edited.blocks
        .filter((block) => block.kind === "rest")
        .map((block) => [block.startAt, block.endAt]),
    ).toEqual(rest);
  });
});
