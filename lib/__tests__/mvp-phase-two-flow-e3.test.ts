/** @jest-environment node */

import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { createPlan } from "@/lib/mvp-phase-two-planner";

let search: typeof import("@/app/api/search/route").POST;
let restaurants: typeof import("@/app/api/phase-two/restaurants/route").POST;
let attraction: typeof import("@/app/api/attractions/[contentId]/route").GET;
let requestTourApi: jest.Mock;

beforeAll(async () => {
  jest.resetModules();
  jest.doMock("@/lib/tour-api", () => {
    const actual =
      jest.requireActual<typeof import("@/lib/tour-api")>("@/lib/tour-api");
    requestTourApi = jest.fn(async (endpoint: string) => ({
      items:
        endpoint === "detailCommon2"
          ? [
              {
                title: "<b>안전한 관광지</b>",
                overview: "<b>안전한 관광지</b>",
                cpyrhtDivCd: "Type1",
                firstimage: "https://tong.visitkorea.or.kr/photo.jpg",
              },
            ]
          : endpoint === "detailIntro2"
            ? [{ restdate: "매주 월요일 휴무", usetime: "09:00" }]
            : [],
      totalCount: 1,
    }));
    return { ...actual, requestTourApi };
  });
  ({ POST: search } = await import("@/app/api/search/route"));
  ({ POST: restaurants } =
    await import("@/app/api/phase-two/restaurants/route"));
  ({ GET: attraction } =
    await import("@/app/api/attractions/[contentId]/route"));
});

const input = {
  originId: "seoul" as const,
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
  transport: "car" as const,
  interests: ["history", "culture"],
};

describe("E3 실제 검색 → 계획 → 음식 → 제한 상세 흐름", () => {
  it("검색은 관광 상세을 호출하지 않고, 선택 계획의 프로필 소속 장소만 두 원천으로 정규화한다", async () => {
    const response = await search(
      new Request("http://localhost/api/search", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    const result = (await response.json()) as Awaited<
      ReturnType<
        (typeof import("@/lib/mvp-phase-two-search"))["searchPhaseTwo"]
      >
    >;
    expect(result.kind).toBe("success");
    expect(requestTourApi).not.toHaveBeenCalled();
    if (result.kind !== "success") return;

    const plan = createPlan(input, result.candidates[0], result.searchId);
    await restaurants(
      new Request("http://localhost/api/phase-two/restaurants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: plan.destination.groupId, visits: [] }),
      }),
    );
    const visit = plan.blocks.find((block) => block.attraction)?.attraction;
    expect(visit).toBeDefined();
    if (!visit) return;
    requestTourApi.mockClear();
    const detailRequest = new Request(
      `http://localhost/api/attractions/${visit.contentId}?contentTypeId=${visit.contentTypeId}`,
    );
    const detailResponse = await attraction(detailRequest, {
      params: Promise.resolve({ contentId: visit.contentId }),
    });
    const detail = await detailResponse.json();
    expect(detailResponse.status).toBe(200);
    expect(requestTourApi).toHaveBeenCalledTimes(2);
    // KorService2 common accepts contentId alone; intro still requires type.
    expect(
      requestTourApi.mock.calls.map(([endpoint, params]) => [endpoint, params]),
    ).toEqual([
      ["detailCommon2", { contentId: visit.contentId }],
      [
        "detailIntro2",
        { contentId: visit.contentId, contentTypeId: visit.contentTypeId },
      ],
    ]);
    for (const call of requestTourApi.mock.calls)
      expect(call[2]).toBe(detailRequest.signal);
    expect(detail).toMatchObject({
      kind: "success",
      detail: {
        overview: { value: "안전한 관광지" },
        image: { license: "Type1", source: "한국관광공사 TourAPI" },
      },
    });
  });

  it("지원하지 않는 유형과 프로필 밖 ID는 외부 상세를 호출하지 않는다", async () => {
    requestTourApi.mockClear();
    for (const [contentId, contentTypeId, status] of [
      ["809190", "39", 400],
      ["999999999999", "12", 404],
    ] as const) {
      const response = await attraction(
        new Request(
          `http://localhost/api/attractions/${contentId}?contentTypeId=${contentTypeId}`,
        ),
        { params: Promise.resolve({ contentId }) },
      );
      expect(response.status).toBe(status);
    }
    expect(requestTourApi).not.toHaveBeenCalled();
  });
});
