import { afterEach, describe, expect, it } from "@jest/globals";
import { createPlan, scheduleTrip } from "@/lib/mvp-phase-two-planner";
import {
  deleteSavedPlan,
  readSavedPlans,
  savePlan,
} from "@/lib/mvp-phase-two-storage";
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
  regionId: "region",
  title: contentId,
  address: "충남 공주시 테스트로 1",
  imageUrl: "",
  coordinates: null,
  categories: ["history"],
  cat1: "A02",
  cat2: "A0201",
  cat3: "A02010100",
});
function savedPlan() {
  const attractions = ["A", "B", "C"].map(attraction);
  const result = scheduleTrip(input, 120, attractions);
  if (!result.ok) throw new Error(result.reason);
  return createPlan(
    input,
    {
      groupId: "group",
      memberRegionIds: ["region"],
      representativeZoneId: "zone",
      displayName: "공주",
      name: "공주",
      province: "충남",
      oneWayMinutes: 120,
      attractions,
      preview: { blocks: result.blocks, metrics: result.metrics },
      metadata: {
        profileGeneratedAt: "2026-09-01T00:00:00Z",
        travelTimeGeneratedAt: "2026-09-01T00:00:00Z",
        networkYear: 2024,
        travelTimeSource: "KTDB",
        representativePoint: "대표점",
        searchedAt: "2026-09-01T00:00:00Z",
      },
      reasons: [],
    } as Candidate,
    "storage-test",
  );
}
afterEach(() => localStorage.clear());

describe("E4 v3 저장 이관", () => {
  it("유효 v2는 메모리에서 v3로 읽고 첫 저장 뒤에도 원본 키를 보존한다", () => {
    const plan = savedPlan();
    const v2 = { ...plan, schemaVersion: 2, savedAt: "2026-09-01T00:00:00Z" };
    delete (v2 as Partial<typeof v2>).itineraryRuleVersion;
    localStorage.setItem(
      "duruduru.plans.v2",
      JSON.stringify({ version: 2, plans: [v2] }),
    );
    const migrated = readSavedPlans();
    expect(migrated.plans).toHaveLength(1);
    expect(migrated.plans[0].schemaVersion).toBe(3);
    expect(localStorage.getItem("duruduru.plans.v3")).toBeNull();
    expect(savePlan(migrated.plans[0]).error).toBeUndefined();
    expect(localStorage.getItem("duruduru.plans.v2")).not.toBeNull();
    expect(readSavedPlans().plans[0].schemaVersion).toBe(3);
  });

  it("빈 v3과 손상 v3은 v2를 다시 수입해 삭제한 계획을 부활시키지 않는다", () => {
    const plan = savedPlan();
    const v2 = { ...plan, schemaVersion: 2, savedAt: "2026-09-01T00:00:00Z" };
    delete (v2 as Partial<typeof v2>).itineraryRuleVersion;
    localStorage.setItem(
      "duruduru.plans.v2",
      JSON.stringify({ version: 2, plans: [v2] }),
    );
    localStorage.setItem(
      "duruduru.plans.v3",
      JSON.stringify({ version: 3, migratedFromV2: true, plans: [] }),
    );
    expect(readSavedPlans().plans).toEqual([]);
    localStorage.setItem("duruduru.plans.v3", "{");
    expect(readSavedPlans()).toEqual(
      expect.objectContaining({ plans: [], error: expect.any(String) }),
    );
  });

  it("v3 삭제는 빈 컨테이너를 기록해 다음 새로고침에도 v2가 나타나지 않는다", () => {
    const plan = savedPlan();
    const v2 = { ...plan, schemaVersion: 2, savedAt: "2026-09-01T00:00:00Z" };
    delete (v2 as Partial<typeof v2>).itineraryRuleVersion;
    localStorage.setItem(
      "duruduru.plans.v2",
      JSON.stringify({ version: 2, plans: [v2] }),
    );
    expect(deleteSavedPlan(plan.id).plans).toEqual([]);
    expect(readSavedPlans().plans).toEqual([]);
  });
});
