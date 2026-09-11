import {
  createPlan,
  editPlan,
  scheduleTrip,
} from "@/lib/mvp-phase-two-planner";
import {
  assignRestaurants,
  replaceRestaurant,
} from "@/lib/mvp-phase-two-meals";
import { planTimeError } from "@/lib/plan-time-constraints";
import { savePlan, readSavedPlans } from "@/lib/mvp-phase-two-storage";
import type {
  Attraction,
  Candidate,
  Restaurant,
  SearchInput,
} from "@/lib/mvp-phase-two-types";

const input: SearchInput = {
  originId: "seoul",
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
  transport: "car",
  interests: ["history"],
};
function fixture() {
  const attractions: Attraction[] = Array.from({ length: 6 }, (_, i) => ({
    contentId: `p${i}`,
    contentTypeId: "12",
    regionId: "region",
    title: `관광 ${i}`,
    address: `장소${i}`,
    imageUrl: "",
    coordinates: { latitude: 36.4 + i * 0.01, longitude: 127.1 },
    categories: ["history"],
    cat1: "A02",
    cat2: "A0201",
    cat3: `A02010${i}`,
  }));
  const result = scheduleTrip(input, 120, attractions);
  if (!result.ok) throw Error(result.reason);
  const destination: Candidate = {
    groupId: "group",
    memberRegionIds: ["region"],
    representativeZoneId: "zone",
    displayName: "공주",
    name: "공주",
    province: "충남",
    oneWayMinutes: 120,
    attractions,
    preview: result,
    metadata: {
      profileGeneratedAt: "2026-09-01T00:00:00Z",
      travelTimeGeneratedAt: "2026-09-01T00:00:00Z",
      networkYear: 2024,
      travelTimeSource: "KTDB",
      representativePoint: "대표점",
      searchedAt: "2026-09-01T00:00:00Z",
    },
    reasons: [],
  };
  return createPlan(input, destination, "local-plan-test");
}
const food = (id: string, latitude = 36.43): Restaurant => ({
  contentId: id,
  regionId: "region",
  name: id,
  address: "주소",
  phone: "",
  imageUrl: "",
  coordinates: { latitude, longitude: 127.1 },
  certified: false,
  foodCultureMatch: false,
  fetchedAt: "2026-09-09T00:00:00Z",
});
afterEach(() => localStorage.clear());
describe("현지 이동 공통 엔진·식사·저장 통합", () => {
  it("초안에 실제 운전과 미확정/추정 이동을 보존하고 저장 왕복한다", () => {
    const plan = fixture();
    expect(planTimeError(plan)).toBeUndefined();
    expect(
      plan.blocks
        .filter((b) => b.direction)
        .reduce((s, b) => s + b.durationMinutes, 0),
    ).toBe(240);
    expect(
      plan.blocks.some((b) => b.localTravel?.status === "unavailable"),
    ).toBe(true);
    expect(savePlan(plan).error).toBeUndefined();
    const restored = readSavedPlans().plans[0];
    expect(restored.blocks).toEqual(plan.blocks);
    expect(restored.localTravelVersion).toBe("straight-line-v1");
  });
  it("이동 구간 distanceKm의 엔진 간 1 ULP 차이는 저장을 막지 않는다", () => {
    // 서버(Node)가 만든 계획을 브라우저(Chromium)가 검증할 때 Math.sin/asin
    // 결과가 최대 1 ULP 다를 수 있어 저장이 거부되던 회귀.
    const plan = fixture();
    const perturbed = {
      ...plan,
      blocks: plan.blocks.map((block, index) =>
        block.localTravel && block.localTravel.distanceKm !== null
          ? {
              ...block,
              localTravel: {
                ...block.localTravel,
                distanceKm:
                  block.localTravel.distanceKm +
                  (index % 2 ? 1 : -1) * 4e-16 * block.localTravel.distanceKm,
              },
            }
          : block,
      ),
    };
    expect(perturbed.blocks).not.toEqual(plan.blocks);
    expect(planTimeError(perturbed)).toBeUndefined();
    expect(savePlan(perturbed).error).toBeUndefined();
    // 실제로 어긋난 거리(1mm 초과)는 여전히 거부한다.
    const broken = {
      ...plan,
      blocks: plan.blocks.map((block) =>
        block.localTravel && block.localTravel.distanceKm !== null
          ? {
              ...block,
              localTravel: {
                ...block.localTravel,
                distanceKm: block.localTravel.distanceKm + 0.5,
              },
            }
          : block,
      ),
    };
    expect(planTimeError(broken)).toBe(
      "장소 간 이동시간과 일정이 일치하지 않아요.",
    );
  });
  it("식당 배정 후 양쪽 이동이 재계산되고 끼니별 식당이 다르다", () => {
    const original = fixture();
    const plan = assignRestaurants(original, [
      food("f1"),
      food("f2"),
      food("f3"),
      food("f4"),
    ]);
    expect(planTimeError(plan)).toBeUndefined();
    const meals = plan.blocks.filter((b) => b.restaurant);
    expect(meals.length).toBeGreaterThan(1);
    expect(new Set(meals.map((b) => b.restaurant!.contentId)).size).toBe(
      meals.length,
    );
    expect(
      plan.blocks
        .filter((b) => b.localTravel)
        .every((b) => b.localTravel!.status === "estimated"),
    ).toBe(true);
    expect(
      plan.blocks.filter((b) => b.attraction).map((b) => b.contentId),
    ).toEqual(
      original.blocks.filter((b) => b.attraction).map((b) => b.contentId),
    );
  });
  it("먼 식당 실패는 관광을 삭제하지 않고 빈 식사나 기존 식당을 유지한다", () => {
    const plan = fixture();
    const unavailable = assignRestaurants(plan, [food("far", -60)]);
    expect(unavailable.blocks.filter((b) => b.restaurant)).toHaveLength(0);
    expect(unavailable.blocks.filter((b) => b.attraction)).toEqual(
      plan.blocks.filter((b) => b.attraction),
    );
    const meal = plan.blocks.find((b) => b.mealScope === "local")!;
    expect(replaceRestaurant(plan, meal.id, food("far", -60))).toBe(plan);
  });
  it("관광 편집 후 연결과 저장이 일치하며 변조 이동은 거절한다", () => {
    const plan = fixture();
    const visit = plan.blocks.find((b) => b.attraction)!;
    const result = editPlan(plan, {
      type: "duration",
      blockId: visit.id,
      durationMinutes: 90,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(planTimeError(result.plan)).toBeUndefined();
    expect(savePlan(result.plan).error).toBeUndefined();
    const broken = JSON.parse(
      JSON.stringify(result.plan),
    ) as typeof result.plan;
    broken.blocks.find((b) => b.localTravel)!.localTravel!.reservedMinutes++;
    expect(planTimeError(broken)).toBeDefined();
    expect(savePlan(broken).error).toBeDefined();
  });
});
