import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { AttractionVisitInfoCoordinator } from "@/lib/attraction-visit-info";
import { createPlan, editPlan } from "@/lib/mvp-phase-two-planner";
import { searchPhaseTwo } from "@/lib/mvp-phase-two-search";
import {
  isSavedPlan,
  readSavedPlans,
  savePlan,
} from "@/lib/mvp-phase-two-storage";
import { INTERESTS } from "@/lib/mvp-phase-two-types";

import {
  input,
  attraction,
  saved,
  fixture,
  placed,
  personalPlan,
} from "@/lib/test-support/enhancement-fixture";

afterEach(() => localStorage.clear());

describe("R0 수정 전 실패 재현: 실제 생성과 편집·저장 연결", () => {
  it.each(INTERESTS.map((interest) => [interest.id] as const))(
    "R1 서울/부산 %s 후보 모두 장소 유지 뒤 시간표를 보존하고 저장·복원한다",
    (interest) => {
      for (const originId of ["seoul", "busan"] as const) {
        const searchInput = {
          ...input,
          originId,
          interests: [interest],
          startAt: "2026-09-12T08:00",
          returnBy: "2026-09-13T20:00",
        };
        const search = searchPhaseTwo(
          searchInput,
          `r1-${originId}-${interest}`,
        );
        expect(search.kind).toBe("success");
        if (search.kind !== "success") throw new Error(search.message);
        expect(search.candidates).toHaveLength(3);
        for (const candidate of search.candidates) {
          const original = createPlan(searchInput, candidate, search.searchId);
          expect(isSavedPlan(saved(original))).toBe(true);
          const target = original.blocks.find((b) => b.kind === "attraction")!;
          const edited = editPlan(original, {
            type: "toggle-fixed",
            blockId: target.id,
          });
          expect(edited.ok).toBe(true);
          expect(isSavedPlan(saved(edited.plan))).toBe(true);
          expect(
            edited.plan.blocks.map((b) => [b.id, b.startAt, b.endAt]),
          ).toEqual(original.blocks.map((b) => [b.id, b.startAt, b.endAt]));
          expect(savePlan(edited.plan).error).toBeUndefined();
          expect(
            readSavedPlans().plans.find((p) => p.id === original.id)?.blocks,
          ).toEqual(edited.plan.blocks);
        }
      }
    },
  );

  it("R2 개인 날짜 이동은 블록·개인 필드 날짜가 같고 저장된다", () => {
    const plan = personalPlan();
    const result = editPlan(plan, {
      type: "move-activity",
      blockId: "personal-one",
      day: 2,
      position: 0,
    });
    expect(result.ok).toBe(true);
    const moved = result.plan.blocks.find((b) => b.id === "personal-one")!;
    expect(moved.day).toBe(2);
    expect(moved.personal?.day).toBe(2);
    expect(savePlan(result.plan).error).toBeUndefined();
    expect(
      readSavedPlans().plans[0].blocks.find((b) => b.id === moved.id),
    ).toEqual(moved);
  });

  it("R2 개인 30분을 90분으로 변경해 저장·복원한다", () => {
    const plan = personalPlan();
    const result = editPlan(plan, {
      type: "duration",
      blockId: "personal-one",
      durationMinutes: 90,
    });
    expect(result.ok).toBe(true);
    const changed = result.plan.blocks.find((b) => b.id === "personal-one")!;
    expect(changed.durationMinutes).toBe(90);
    expect(changed.personal?.durationMinutes).toBe(90);
    expect(savePlan(result.plan).error).toBeUndefined();
    expect(
      readSavedPlans().plans[0].blocks.find((b) => b.id === changed.id),
    ).toEqual(changed);
  });

  it.each(["delete-attraction", "replace-attraction"] as const)(
    "R3 시각 고정 관광지 %s는 해제 전 거절한다",
    (type) => {
      const plan = fixture();
      const target = plan.blocks.find((b) => b.kind === "attraction")!;
      target.fixedStartAt = target.startAt;
      expect(isSavedPlan(saved(plan))).toBe(true);
      expect(savePlan(plan).error).toBeUndefined();
      const before = JSON.stringify(plan);
      const stored = localStorage.getItem("duruduru.plans.v3");
      const result = editPlan(
        plan,
        type === "replace-attraction"
          ? { type, blockId: target.id, contentId: "D" }
          : { type, blockId: target.id },
      );
      expect(result.ok).toBe(false);
      expect(result.plan).toEqual(plan);
      expect(JSON.stringify(plan)).toBe(before);
      expect(localStorage.getItem("duruduru.plans.v3")).toBe(stored);
    },
  );

  it("R4 뒤 일반 활동 10:15를 유지하면서 90분 활동을 08:30에 배치한다", () => {
    const plan = fixture();
    const [a, b, c] = plan.blocks.filter(
      (block) => block.kind === "attraction",
    );
    const baseline = placed(plan, [
      { ...a, day: 1, startAt: "2026-09-12T09:00", endAt: "2026-09-12T10:00" },
      { ...b, day: 1, startAt: "2026-09-12T10:15", endAt: "2026-09-12T11:15" },
      { ...c, day: 2, startAt: "2026-09-13T09:00", endAt: "2026-09-13T10:00" },
    ]);
    const result = editPlan(baseline, {
      type: "duration",
      blockId: a.id,
      durationMinutes: 90,
    });
    expect(result.ok).toBe(true);
    expect(result.plan.blocks.find((block) => block.id === a.id)?.startAt).toBe(
      "2026-09-12T08:30",
    );
    expect(result.plan.blocks.find((block) => block.id === b.id)?.startAt).toBe(
      "2026-09-12T10:15",
    );
    expect(isSavedPlan(saved(result.plan))).toBe(true);
  });
});

describe("R0 관광 상세 경계 실패 재현", () => {
  it("R5 실패 후 31초씩 지나도 명시적 요청은 항목당 두 번까지만 원천을 호출한다", async () => {
    let now = 0;
    const fetcher = jest.fn(async () => {
      throw new Error("upstream unavailable");
    });
    const coordinator = new AttractionVisitInfoCoordinator(fetcher, {
      now: () => now,
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      await coordinator
        .request(attraction("A"), "manual")
        .catch(() => undefined);
      now += 31_000;
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("R5 취소를 무시하고 늦게 성공한 응답은 캐시에 저장되지 않는다", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const coordinator = new AttractionVisitInfoCoordinator(async () => {
      await hold;
      return {
        kind: "success",
        detail: {
          title: { status: "confirmed", value: "늦은 응답" },
          address: { status: "unknown" },
          overview: { status: "unknown" },
          openingHours: { status: "unknown" },
          closedDays: { status: "unknown" },
          fees: { status: "unknown" },
          phone: { status: "unknown" },
          imageUrl: "",
          fetchedAt: "2026-09-09T00:00:00Z",
        },
      };
    });
    const pending = coordinator.request(attraction("A"), "automatic");
    coordinator.cancelAll();
    release();
    await pending.catch(() => undefined);
    expect(coordinator.current(attraction("A")).status).toBe("not-requested");
  });
});
