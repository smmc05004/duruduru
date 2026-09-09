import { afterEach, expect, it, jest } from "@jest/globals";
import {
  createPlan,
  editPlan,
  planAccommodation,
} from "@/lib/mvp-phase-two-planner";
import { searchPhaseTwo } from "@/lib/mvp-phase-two-search";
import {
  deleteSavedPlan,
  isSavedPlan,
  readSavedPlans,
  savePlan,
} from "@/lib/mvp-phase-two-storage";
import {
  fixture,
  personalPlan,
  saved,
} from "@/lib/test-support/enhancement-fixture";
import type { EditCommand, PlanSnapshot } from "@/lib/mvp-phase-two-types";

it.each([
  ["2026-09-12T07:00", "2026-09-13T21:00"],
  ["2026-09-12T22:00", "2026-09-13T23:00"],
  ["2026-09-12T08:00", "2026-09-13T14:00"],
  ["2026-09-12T18:00", "2026-09-13T20:00"],
])(
  "R1 야간/낮 경계 %s부터 %s까지 성공 편집도 현지 범위와 저장을 유지한다",
  (startAt, returnBy) => {
    for (const originId of ["seoul", "busan"] as const) {
      const input = {
        originId,
        startAt,
        returnBy,
        transport: "car" as const,
        interests: ["history" as const],
      };
      const result = searchPhaseTwo(input, `boundary-${originId}`);
      if (result.kind !== "success") throw new Error(result.message);
      const plan = createPlan(input, result.candidates[0], result.searchId);
      expect(isSavedPlan(saved(plan))).toBe(true);
      const target = plan.blocks.find((b) => b.kind === "attraction")!;
      const edited = editPlan(freeze(plan), {
        type: "duration",
        blockId: target.id,
        durationMinutes: 30,
      });
      if (!edited.ok) throw new Error(edited.reason);
      roundTrip(edited.plan);
    }
  },
);

it("R4 시설 의심 추가는 안내 확인 후 허용하고 근거·식당·시각을 보존한다", () => {
  const plan = fixture();
  for (const place of plan.destination.attractions.filter((a) =>
    ["A", "D"].includes(a.contentId),
  )) {
    place.title = `공산성 ${place.contentId}`;
    place.address = "충남 공주시 공산성길 1";
    place.coordinates = { latitude: 36.46, longitude: 127.12 };
  }
  for (const block of plan.blocks.filter((b) => b.attraction))
    block.attraction = plan.destination.attractions.find(
      (a) => a.contentId === block.contentId,
    );
  const meal = plan.blocks.find(
    (b) => b.kind === "meal" && b.mealScope === "local",
  )!;
  meal.restaurant = {
    contentId: "food-A",
    regionId: "region",
    name: "기존 식당",
    address: "공주",
    phone: "",
    imageUrl: "",
    coordinates: null,
    certified: false,
    foodCultureMatch: false,
    fetchedAt: "2026-09-09T00:00:00Z",
  };
  meal.contentId = meal.restaurant.contentId;
  expect(isSavedPlan(saved(plan))).toBe(true);
  const command = {
    type: "add-attraction" as const,
    contentId: "D",
    day: 1 as const,
    durationMinutes: 60 as const,
  };
  expect(editPlan(plan, command).ok).toBe(false);
  const added = editPlan(plan, { ...command, allowFacilityRepeat: true });
  if (!added.ok) throw new Error(added.reason);
  expect(added.plan.blocks.find((b) => b.id === meal.id)?.restaurant).toEqual(
    meal.restaurant,
  );
  expect(added.plan.blocks.find((b) => b.id === meal.id)?.startAt).toBe(
    meal.startAt,
  );
  expect(added.plan.blocks.some((b) => b.reason.includes("같은 시설"))).toBe(
    true,
  );
  expect(added.plan.blocks.find((b) => b.id === meal.id)?.reason).toContain(
    "식당 위치를 확인",
  );
  for (const activity of added.plan.blocks.filter((b) => b.attraction))
    expect(activity.sessionId).toBe(
      `day-${activity.day}-${Number(activity.startAt.slice(11, 13)) < 12 ? "morning" : "afternoon"}`,
    );
  roundTrip(added.plan);
});

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
});

it.each([false, true])(
  "R3 장소 유지 %s와 시각 고정은 별개이며 해제 뒤에만 삭제·교체한다",
  (keepPlace) => {
    let plan = fixture();
    const id = plan.blocks.filter((b) => b.attraction).at(-1)!.id;
    if (keepPlace)
      plan = editPlan(plan, { type: "toggle-fixed", blockId: id }).plan;
    const fixed = editPlan(plan, {
      type: "set-fixed-start",
      blockId: id,
      fixedStartAt: "2026-09-13T14:00",
    });
    expect(fixed.ok).toBe(true);
    for (const command of [
      { type: "delete-attraction", blockId: id },
      { type: "replace-attraction", blockId: id, contentId: "D" },
      { type: "move-activity", blockId: id, day: 1, position: 0 },
      { type: "reorder-activity", blockId: id, direction: "up" },
    ] satisfies EditCommand[]) {
      const rejected = editPlan(freeze(fixed.plan), command);
      expect(rejected.ok).toBe(false);
      expect(rejected.plan).toEqual(fixed.plan);
    }
    plan = editPlan(fixed.plan, {
      type: "set-fixed-start",
      blockId: id,
      fixedStartAt: null,
    }).plan;
    if (keepPlace) {
      expect(
        editPlan(plan, { type: "delete-attraction", blockId: id }).ok,
      ).toBe(false);
      plan = editPlan(plan, { type: "toggle-fixed", blockId: id }).plan;
    }
    const replaced = editPlan(plan, {
      type: "replace-attraction",
      blockId: id,
      contentId: "D",
    });
    expect(replaced.ok).toBe(true);
    roundTrip(replaced.plan);
    const deleted = editPlan(replaced.plan, {
      type: "delete-attraction",
      blockId: id,
    });
    expect(deleted.ok).toBe(true);
    roundTrip(deleted.plan);
  },
);

it("R2 유효 계획과 손상 항목이 섞인 저장본은 오류를 알리고 원래 raw를 덮어쓰지 않는다", () => {
  const plan = fixture();
  const raw = JSON.stringify({
    version: 3,
    migratedFromV2: false,
    plans: [saved(plan), { id: "broken" }],
  });
  localStorage.setItem("duruduru.plans.v3", raw);
  expect(readSavedPlans().error).toBeDefined();
  expect(savePlan(plan).error).toBeDefined();
  expect(localStorage.getItem("duruduru.plans.v3")).toBe(raw);
});
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function roundTrip(plan: PlanSnapshot) {
  expect(isSavedPlan(saved(plan))).toBe(true);
  expect(savePlan(plan).error).toBeUndefined();
  const restored = readSavedPlans().plans.find((p) => p.id === plan.id)!;
  expect(restored.blocks).toEqual(plan.blocks);
  expect(restored.accommodation).toEqual(plan.accommodation);
  return restored;
}

it("R2 개인 일정의 날짜·시간·순서·시각 고정·해제·삭제를 매번 저장하고 복원한다", () => {
  let plan = personalPlan();
  const accommodation = planAccommodation(plan, {
    name: "약속 숙소",
    address: "공주",
    note: "늦은 도착",
  });
  expect(accommodation.ok).toBe(true);
  plan = accommodation.plan;
  const rest = plan.blocks.filter((b) => b.kind === "rest");
  const commands: EditCommand[] = [
    { type: "duration", blockId: "personal-one", durationMinutes: 90 },
    { type: "move-activity", blockId: "personal-one", day: 2, position: 0 },
    { type: "reorder-activity", blockId: "personal-one", direction: "down" },
    {
      type: "set-fixed-start",
      blockId: "personal-one",
      fixedStartAt: "2026-09-13T14:00",
    },
    { type: "set-fixed-start", blockId: "personal-one", fixedStartAt: null },
    { type: "delete-personal", blockId: "personal-one" },
  ];
  for (const command of commands) {
    const original = JSON.stringify(plan);
    const result = editPlan(freeze(plan), command);
    if (!result.ok) throw new Error(`${command.type}: ${result.reason}`);
    expect(JSON.stringify(plan)).toBe(original);
    expect(result.plan.blocks.filter((b) => b.kind === "rest")).toEqual(rest);
    plan = roundTrip(result.plan);
  }
  expect(plan.blocks.some((b) => b.id === "personal-one")).toBe(false);
});

it("R3 14시 고정은 다른 시간 변경에도 유지하고 야간 충돌은 메모리·저장본을 보존한다", () => {
  const original = fixture();
  const targets = original.blocks.filter((b) => b.kind === "attraction");
  const fixed = editPlan(original, {
    type: "set-fixed-start",
    blockId: targets.at(-1)!.id,
    fixedStartAt: "2026-09-13T14:00",
  });
  expect(fixed.ok).toBe(true);
  const changed = editPlan(fixed.plan, {
    type: "duration",
    blockId: targets[0].id,
    durationMinutes: 90,
  });
  expect(changed.ok).toBe(true);
  expect(
    changed.plan.blocks.find((b) => b.id === targets.at(-1)!.id)?.startAt,
  ).toBe("2026-09-13T14:00");
  roundTrip(changed.plan);
  const raw = localStorage.getItem("duruduru.plans.v3");
  const before = JSON.stringify(changed.plan);
  const rejected = editPlan(freeze(changed.plan), {
    type: "set-fixed-start",
    blockId: targets.at(-1)!.id,
    fixedStartAt: "2026-09-13T21:00",
  });
  expect(rejected.ok).toBe(false);
  if (!rejected.ok) expect(rejected.reason).toMatch(/현지|휴식/);
  expect(JSON.stringify(rejected.plan)).toBe(before);
  expect(localStorage.getItem("duruduru.plans.v3")).toBe(raw);
});

it("R2 저장 확인 불일치는 이전 raw를 복원하며 성공으로 표시하지 않는다", () => {
  const plan = fixture();
  roundTrip(plan);
  const before = localStorage.getItem("duruduru.plans.v3");
  const setItem = Storage.prototype.setItem;
  let firstWrite = true;
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key === "duruduru.plans.v3" && firstWrite) {
      firstWrite = false;
      return setItem.call(this, key, "{}");
    }
    return setItem.call(this, key, value);
  });
  expect(
    savePlan({
      ...plan,
      accommodation: { name: "변경", address: "", note: "" },
    }).error,
  ).toBeDefined();
  expect(localStorage.getItem("duruduru.plans.v3")).toBe(before);
});

it("R2 삭제 준비 중 저장소 읽기 차단도 throw 없이 오류를 반환하고 원본을 보존한다", () => {
  const plan = fixture();
  roundTrip(plan);
  const before = localStorage.getItem("duruduru.plans.v3");
  const getItem = Storage.prototype.getItem;
  let reads = 0;
  const spy = jest
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(function (this: Storage, key) {
      if (++reads === 2) throw new Error("blocked");
      return getItem.call(this, key);
    });
  expect(deleteSavedPlan(plan.id).error).toBeDefined();
  spy.mockRestore();
  expect(localStorage.getItem("duruduru.plans.v3")).toBe(before);
});

it("R2 용량 부족은 이전 정상 저장본을 지우지 않는다", () => {
  const plan = fixture();
  roundTrip(plan);
  const before = localStorage.getItem("duruduru.plans.v3");
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  expect(savePlan(plan).error).toBeDefined();
  expect(localStorage.getItem("duruduru.plans.v3")).toBe(before);
});
