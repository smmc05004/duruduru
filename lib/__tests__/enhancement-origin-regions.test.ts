import {
  ORIGIN_REGIONS,
  originRegion,
  searchOriginRegions,
} from "@/lib/origin-regions";
import catalog from "@/data/origin-regions.json";
import times from "@/data/ktdb/interregional-travel-times-2024.json";
import { searchPhaseTwo } from "@/lib/mvp-phase-two-search";
import { createPlan, validateSearchInput } from "@/lib/mvp-phase-two-planner";
import { planTimeError } from "@/lib/plan-time-constraints";
import { savePlan, readSavedPlans } from "@/lib/mvp-phase-two-storage";
const input = {
  originId: "seoul",
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
  transport: "car" as const,
  interests: ["culture" as const],
};
afterEach(() => localStorage.clear());
describe("표준 출발 목록과 KTDB 재계산", () => {
  it("검증 목록 모든 ID가 원천 존에 있고 미연결 출발과 미매핑을 구분한다", () => {
    expect(ORIGIN_REGIONS).toHaveLength(249);
    for (const origin of ORIGIN_REGIONS) {
      const index = times.regions.findIndex((z) => z.id === origin.zoneId);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(origin.supported).toBe(
        times.minutes[index].some((v) => typeof v === "number" && v > 0),
      );
    }
    expect(catalog.excluded).toHaveLength(3);
    expect(
      ORIGIN_REGIONS.filter((o) => !o.supported)
        .map((o) => o.district)
        .sort(),
    ).toEqual(["서귀포시", "울릉군", "제주시"]);
  });
  it("일반구·세종·동명 검색·기존 출발 의미를 보존한다", () => {
    expect(
      searchOriginRegions("수원").every((o) => o.district.includes("구")),
    ).toBe(true);
    expect(searchOriginRegions("강남")[0].label).toBe("서울특별시 강남구");
    expect(searchOriginRegions("해운대")[0].label).toBe("부산광역시 해운대구");
    expect(searchOriginRegions("세종")).toHaveLength(1);
    expect(searchOriginRegions("중구").length).toBeGreaterThan(1);
    expect(originRegion("seoul")?.zoneId).toBe("ktdb-zone-2");
    expect(originRegion("busan")?.zoneId).toBe("ktdb-zone-26");
    expect(validateSearchInput({ ...input, originId: "수원" }).ok).toBe(false);
    expect(
      validateSearchInput({
        ...input,
        originId: searchOriginRegions("울릉")[0].id,
      }).ok,
    ).toBe(false);
  });
  it.each(["수원", "세종", "해운대"])(
    "%s 출발은 해당 KTDB 행·그룹 제외·새 시간표로 저장된다",
    (query) => {
      const origin = searchOriginRegions(query)[0];
      const request = { ...input, originId: origin.id };
      const result = searchPhaseTwo(
        request,
        `origin-${query}`,
        "2026-09-09T00:00:00Z",
      );
      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      const from = times.regions.findIndex((z) => z.id === origin.zoneId);
      for (const candidate of result.candidates) {
        const to = times.regions.findIndex(
          (z) => z.id === candidate.representativeZoneId,
        );
        expect(candidate.oneWayMinutes).toBe(times.minutes[from][to]);
        expect(candidate.memberRegionIds).not.toContain(origin.zoneId);
        const plan = createPlan(request, candidate, `origin-${query}`);
        expect(planTimeError(plan)).toBeUndefined();
        expect(savePlan(plan).error).toBeUndefined();
        expect(
          readSavedPlans().plans.some((p) => p.input.originId === origin.id),
        ).toBe(true);
      }
    },
  );
});
