import { expect, test, type Page } from "@playwright/test";
import type {
  Candidate,
  PlanSnapshot,
  TimeBlock,
} from "../lib/mvp-phase-two-types";

// 검색은 실제 서버/사전 데이터로 실행한다. 외부 음식·상세 응답만 통제하여
// 보완·예산·늦은 응답·저장 흐름을 네트워크 가용성과 독립적으로 검증한다.
async function searchHistory(page: Page) {
  await page.goto("/");
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("다음날 귀가 완료 일시").fill("2026-09-13T20:00");
  for (const [name, selected] of [
    ["역사", true],
    ["자연", false],
  ] as const) {
    const box = page.getByRole("checkbox", { name, exact: true });
    if (((await box.getAttribute("aria-checked")) === "true") !== selected)
      await box.click();
  }
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/search") && r.ok(),
  );
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  const data = (await (await response).json()) as { candidates: Candidate[] };
  await expect(page.getByRole("region", { name: "목적지 추천" })).toBeVisible();
  return data.candidates;
}

async function save(page: Page): Promise<PlanSnapshot> {
  await page
    .getByRole("button", { name: "이 기기에 저장", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("duruduru.plans.v3")))
    .not.toBeNull();
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("duruduru.plans.v3")!).plans[0],
  );
}

const excess = (blocks: TimeBlock[]) =>
  blocks
    .filter((b) => b.kind === "free")
    .reduce((sum, b) => sum + Math.max(0, b.durationMinutes - 120), 0);

async function mockDetails(
  page: Page,
  calls: { meals: number; details: number },
) {
  await page.route("**/api/attractions/**", async (route) => {
    calls.details++;
    await route.fulfill({
      status: 503,
      json: { kind: "data-error", message: "점검용 상세 미확인" },
    });
  });
}

for (const mealMode of ["empty", "data-error", "http-error"] as const) {
  test(`LG 최초 식당 ${mealMode} 종료 후 실제 문경 긴 구간 보완·자동 상세 6개 유지`, async ({
    page,
  }) => {
    const calls = { meals: 0, details: 0 };
    await mockDetails(page, calls);
    await page.route("**/api/phase-two/restaurants", async (route) => {
      calls.meals++;
      await route.fulfill(
        mealMode === "empty"
          ? {
              json: {
                kind: "success",
                restaurants: [],
                queriedRegionIds: [],
                failedRegionIds: [],
                truncated: false,
                fetchedAt: "2026-09-14T00:00:00Z",
                message: "",
              },
            }
          : {
              status: mealMode === "http-error" ? 503 : 200,
              json: {
                kind: "data-error",
                message: "점검용 식당 미확인",
                restaurants: [],
                queriedRegionIds: [],
                failedRegionIds: [],
                truncated: false,
                fetchedAt: "2026-09-14T00:00:00Z",
              },
            },
      );
    });
    const candidates = await searchHistory(page);
    expect(candidates.map((c) => c.displayName)).toEqual([
      "고양",
      "문경",
      "순창",
    ]);
    expect(calls).toEqual({ meals: 0, details: 0 });
    const selected = candidates.find((c) => c.displayName === "문경")!;
    await page
      .getByRole("button", { name: "문경 일정 보기", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: /긴 여유시간.*보완했어요/ }),
    ).toBeVisible();
    const plan = await save(page);
    expect(plan.longGapEnrichmentVersion).toBe("long-gap-v1");
    expect(excess(plan.blocks)).toBeLessThan(excess(selected.preview.blocks));
    expect(plan.destination.preview).toEqual(selected.preview);
    for (const block of selected.preview.blocks.filter(
      (b) => b.kind === "attraction",
    ))
      expect(
        plan.blocks.some(
          (b) =>
            b.contentId === block.contentId &&
            b.durationMinutes === block.durationMinutes,
        ),
      ).toBe(true);
    await expect.poll(() => calls.details).toBe(6);
    expect(calls.meals).toBe(1);
    await page.reload();
    await page
      .getByRole("button", { name: "저장한 여행", exact: true })
      .click();
    await page.getByRole("button", { name: "불러오기", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "여행 계획", exact: true }),
    ).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "긴 여유시간 보완", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("duruduru.plans.v3")!).plans[0],
      ),
    ).toEqual(plan);
    expect(calls).toEqual({ meals: 1, details: 6 });
  });
}

test("LG 저장 후 도착한 최초 식당 응답은 계획과 보완 상태를 덮어쓰지 않는다", async ({
  page,
}) => {
  const calls = { meals: 0, details: 0 };
  await mockDetails(page, calls);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/phase-two/restaurants", async (route) => {
    calls.meals++;
    await gate;
    await route.fulfill({
      json: {
        kind: "success",
        restaurants: [],
        queriedRegionIds: [],
        failedRegionIds: [],
        truncated: false,
        fetchedAt: "2026-09-14T00:00:00Z",
        message: "",
      },
    });
  });
  await searchHistory(page);
  await page
    .getByRole("button", { name: "문경 일정 보기", exact: true })
    .click();
  const original = await save(page);
  expect(original.longGapEnrichmentVersion).toBeUndefined();
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/phase-two/restaurants"),
  );
  release();
  await response;
  await expect.poll(() => calls.details).toBe(6);
  const later = await save(page);
  expect(later.blocks).toEqual(original.blocks);
  expect(later.longGapEnrichmentVersion).toBeUndefined();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "긴 여유시간 보완", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /긴 여유시간.*보완했어요/ }),
  ).toBeVisible();
  const explicit = await save(page);
  expect(explicit.longGapEnrichmentVersion).toBe("long-gap-v1");
  expect(calls).toEqual({ meals: 1, details: 6 });
});

test("LG 식당 좌표 배정 후 관광 추가·끼니 유지·추가 상세 예산 제한", async ({
  page,
}) => {
  const calls = { meals: 0, details: 0 };
  await mockDetails(page, calls);
  const selected = (await searchHistory(page)).find(
    (c) => c.displayName === "고양",
  )!;
  await page.route("**/api/phase-two/restaurants", async (route) => {
    calls.meals++;
    await route.fulfill({
      json: {
        kind: "success",
        restaurants: Array.from({ length: 8 }, (_, index) => ({
          contentId: `gap-restaurant-${index}`,
          regionId: selected.memberRegionIds[0],
          name: `보완 점검 식당 ${index + 1}`,
          address: `${selected.displayName} 점검 주소`,
          phone: "",
          imageUrl: "",
          coordinates: selected.attractions.find((a) => a.coordinates)
            ?.coordinates,
          certified: false,
          foodCultureMatch: false,
          fetchedAt: "2026-09-14T00:00:00Z",
        })),
        queriedRegionIds: selected.memberRegionIds.slice(0, 1),
        failedRegionIds: [],
        truncated: false,
        fetchedAt: "2026-09-14T00:00:00Z",
        message: "",
      },
    });
  });
  await page
    .getByRole("button", { name: "고양 일정 보기", exact: true })
    .click();
  const region = page.getByRole("region", { name: "여행 계획", exact: true });
  await expect(
    page.getByRole("status").filter({ hasText: /긴 여유시간.*보완했어요/ }),
  ).toBeVisible();
  const plan = await save(page);
  expect(plan.metrics.attractionCount).toBeGreaterThan(
    selected.preview.metrics.attractionCount,
  );
  expect(plan.metrics.attractionCount).toBeLessThanOrEqual(8);
  for (const day of [1, 2])
    expect(
      plan.blocks.filter((b) => b.day === day && b.kind === "attraction")
        .length,
    ).toBeLessThanOrEqual(4);
  const meals = plan.blocks.filter((b) => b.kind === "meal");
  expect(
    meals.map(({ id, startAt, endAt }) => ({ id, startAt, endAt })),
  ).toEqual(
    selected.preview.blocks
      .filter((b) => b.kind === "meal")
      .map(({ id, startAt, endAt }) => ({ id, startAt, endAt })),
  );
  expect(
    new Set(
      meals.flatMap((b) => (b.restaurant ? [b.restaurant.contentId] : [])),
    ).size,
  ).toBe(4);
  await expect.poll(() => calls.details).toBe(6);
  expect(calls.meals).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "저장한 여행", exact: true }).click();
  await page.getByRole("button", { name: "불러오기", exact: true }).click();
  await expect(region.locator(".p2-block--attraction")).toHaveCount(
    plan.metrics.attractionCount,
  );
  expect(calls).toEqual({ meals: 1, details: 6 });
});
