/** @jest-environment node */

import { beforeAll, describe, expect, it, jest } from "@jest/globals";

import { createPlan } from "@/lib/mvp-phase-two-planner";

let search: typeof import("@/app/api/search/route").POST;
let restaurants: typeof import("@/app/api/phase-two/restaurants/route").POST;
let requestTourApi: jest.Mock;

beforeAll(async () => {
  jest.resetModules();
  jest.doMock("@/lib/tour-api", () => {
    const actual =
      jest.requireActual<typeof import("@/lib/tour-api")>("@/lib/tour-api");
    requestTourApi = jest.fn(async () => ({ items: [], totalCount: 0 }));
    return { ...actual, requestTourApi };
  });
  ({ POST: search } = await import("@/app/api/search/route"));
  ({ POST: restaurants } =
    await import("@/app/api/phase-two/restaurants/route"));
});

const input = {
  originId: "seoul" as const,
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
  transport: "car" as const,
  interests: ["history", "culture"],
};

describe("E2 검색 → 계획 → 음식 목록 Route Handler 흐름", () => {
  it("검색과 공통 E2 엔진은 실제로 실행하고 음식 TourAPI만 mock한다", async () => {
    const searchResponse = await search(
      new Request("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    expect(searchResponse.status).toBe(200);
    const searchResult = (await searchResponse.json()) as Awaited<
      ReturnType<
        (typeof import("@/lib/mvp-phase-two-search"))["searchPhaseTwo"]
      >
    >;
    expect(searchResult.kind).toBe("success");
    if (searchResult.kind !== "success") return;

    const plan = createPlan(
      input,
      searchResult.candidates[0],
      searchResult.searchId,
    );
    const foodResponse = await restaurants(
      new Request("http://localhost/api/phase-two/restaurants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId: plan.destination.groupId,
          visits: plan.blocks.flatMap((block) =>
            block.attraction
              ? [
                  {
                    contentId: block.attraction.contentId,
                    regionId: block.attraction.regionId,
                  },
                ]
              : [],
          ),
        }),
      }),
    );

    const foodResult = await foodResponse.json();
    expect(requestTourApi).toHaveBeenCalled();
    expect({ status: foodResponse.status, foodResult }).toMatchObject({
      status: 200,
      foodResult: { kind: "success" },
    });
    expect(plan.destination.itineraryAlgorithmVersion).toBe("e2-v1");
    expect(plan.blocks.some((block) => block.sessionId)).toBe(true);
  });
});
