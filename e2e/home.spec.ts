import { expect, test } from "@playwright/test";

const candidates = ["경주", "공주", "강릉"].map((name, index) => ({
  regionId: `region-${index}`,
  name,
  province: "검증 지역",
  oneWayMinutes: 120,
  localMinutes: 1800,
  attractions: [0, 1, 2, 3].map((item) => ({
    contentId: `${name}-${item}`,
    title: `${name} 관광지 ${item + 1}`,
    categoryId: "history",
  })),
  interestLabels: ["역사"],
}));
async function fill(page: import("@playwright/test").Page) {
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("복귀 가능 일시").fill("2026-09-13T20:00");
  await page.getByRole("checkbox", { name: "역사" }).click();
}

test("서울 고정 1박2일 검색은 음식점 호출 없이 최대 세 후보를 보인다", async ({
  page,
}) => {
  let restaurants = 0;
  let originId = "";
  await page.route("**/api/search", async (route) => {
    originId = JSON.parse(route.request().postData() ?? "{}").originId;
    await route.fulfill({ json: { kind: "success", candidates } });
  });
  await page.route("**/api/destinations/**/restaurants", async (route) => {
    restaurants += 1;
    await route.fulfill({ json: { kind: "success", restaurants: [] } });
  });
  await page.goto("/");
  await expect(page.getByRole("radio", { name: "서울특별시" })).toBeChecked();
  await fill(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await expect(
    page.getByRole("button", { name: "경주 일정 보기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "공주 일정 보기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "강릉 일정 보기" }),
  ).toBeVisible();
  expect(restaurants).toBe(0);
  expect(originId).toBe("seoul");
});

test("부산 출발을 선택하면 부산 기준으로 후보를 검색한다", async ({ page }) => {
  let originId = "";
  await page.route("**/api/search", async (route) => {
    originId = JSON.parse(route.request().postData() ?? "{}").originId;
    await route.fulfill({ json: { kind: "success", candidates } });
  });
  await page.goto("/");
  await page.getByRole("radio", { name: "부산광역시" }).click();
  await fill(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await expect(
    page.getByRole("heading", { name: "부산광역시에서 갈 수 있는 곳" }),
  ).toBeVisible();
  expect(originId).toBe("busan");
});

test("당일치기는 검색 요청 없이 거절한다", async ({ page }) => {
  let searches = 0;
  await page.route("**/api/search", async (route) => {
    searches += 1;
    await route.fulfill({ json: { kind: "success", candidates } });
  });
  await page.goto("/");
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("복귀 가능 일시").fill("2026-09-12T20:00");
  await page.getByRole("checkbox", { name: "역사" }).click();
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await expect(page.locator(".dd-error-summary")).toContainText("1박 2일");
  expect(searches).toBe(0);
});

test("선택 뒤 한 지역 음식점과 클릭한 상세만 조회한다", async ({ page }) => {
  const calls: string[] = [];
  await page.route("**/api/search", (route) =>
    route.fulfill({ json: { kind: "success", candidates } }),
  );
  await page.route("**/api/destinations/**/restaurants", async (route) => {
    calls.push(route.request().url());
    await route.fulfill({
      json: {
        kind: "success",
        restaurants: [
          {
            contentId: "food-1",
            name: "검증 식당",
            address: "서울",
            phone: "",
            certified: true,
            foodCultureMatch: true,
          },
          {
            contentId: "food-2",
            name: "검증 식당 둘",
            address: "서울",
            phone: "",
            certified: false,
            foodCultureMatch: false,
          },
          {
            contentId: "food-3",
            name: "검증 식당 셋",
            address: "서울",
            phone: "",
            certified: false,
            foodCultureMatch: false,
          },
          {
            contentId: "food-4",
            name: "검증 식당 넷",
            address: "서울",
            phone: "",
            certified: false,
            foodCultureMatch: false,
          },
        ],
      },
    });
  });
  await page.route("**/api/restaurants/**", async (route) => {
    calls.push(route.request().url());
    await route.fulfill({
      json: { kind: "success", detail: { menu: "검증 메뉴" } },
    });
  });
  await page.goto("/");
  await fill(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await page.getByRole("button", { name: "경주 일정 보기" }).click();
  await expect(page.getByText("1일차")).toBeVisible();
  await expect(page.getByText("2일차")).toBeVisible();
  await expect(page.getByText("점심")).toHaveCount(2);
  await expect(page.getByText("저녁")).toHaveCount(2);
  const meals = page.locator(".dd-summary-card p");
  await expect(
    meals.filter({ hasText: /^11:30 · 점심 · 검증 식당$/u }),
  ).toHaveCount(1);
  await expect(
    meals.filter({ hasText: /^17:30 · 저녁 · 검증 식당 둘$/u }),
  ).toHaveCount(1);
  await expect(
    meals.filter({ hasText: /^11:30 · 점심 · 검증 식당 셋$/u }),
  ).toHaveCount(1);
  await expect(
    meals.filter({ hasText: /^17:30 · 저녁 · 검증 식당 넷$/u }),
  ).toHaveCount(1);
  expect(calls.filter((url) => url.includes("/destinations/")).length).toBe(1);
  await page.getByRole("button", { name: "검증 식당" }).first().click();
  await expect(page.getByText(/검증 메뉴/)).toBeVisible();
  expect(calls.filter((url) => url.includes("/api/restaurants/")).length).toBe(
    1,
  );
});

test("음식점이 네 곳보다 적으면 남은 식사 칸에 안내를 표시한다", async ({
  page,
}) => {
  await page.route("**/api/search", (route) =>
    route.fulfill({ json: { kind: "success", candidates } }),
  );
  await page.route("**/api/destinations/**/restaurants", (route) =>
    route.fulfill({
      json: {
        kind: "success",
        restaurants: [
          {
            contentId: "food-1",
            name: "첫 식당",
            address: "서울",
            phone: "",
            certified: false,
            foodCultureMatch: false,
          },
          {
            contentId: "food-2",
            name: "둘째 식당",
            address: "서울",
            phone: "",
            certified: false,
            foodCultureMatch: false,
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await fill(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await page.getByRole("button", { name: "경주 일정 보기" }).click();
  const meals = page.locator(".dd-summary-card p");
  await expect(
    meals.filter({ hasText: /^11:30 · 점심 · 첫 식당$/u }),
  ).toHaveCount(1);
  await expect(
    meals.filter({ hasText: /^17:30 · 저녁 · 둘째 식당$/u }),
  ).toHaveCount(1);
  await expect(page.getByText("추천할 식당을 더 찾지 못했어요")).toHaveCount(2);
});
