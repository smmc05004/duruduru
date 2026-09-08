import { expect, test } from "@playwright/test";

const candidates = [
  { displayName: "경주", name: "경상북도 경주시" },
  { displayName: "공주", name: "충청남도 공주시" },
  { displayName: "강릉", name: "강원특별자치도 강릉시" },
].map(({ displayName, name }, index) => ({
  regionId: `region-${index}`,
  displayName,
  name,
  province: "검증 지역",
  oneWayMinutes: 120,
  localMinutes: 1800,
  attractions: [0, 1, 2, 3].map((item) => ({
    contentId: `${displayName}-${item}`,
    title: `${displayName} 관광지 ${item + 1}`,
    categoryId: "history",
  })),
  interestLabels: ["역사"],
}));
async function fill(page: import("@playwright/test").Page) {
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("복귀 가능 일시").fill("2026-09-13T20:00");
  await page.getByRole("checkbox", { name: "역사" }).click();
  // 제출 클릭이 관심사 상태 커밋보다 앞서면 search()가 errorCount>0으로 읽혀
  // searching 뷰로 넘어가지 않는다. 커밋이 반영될 때까지 기다린다.
  await expect(page.getByRole("checkbox", { name: "역사" })).toBeChecked();
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

test("광역시 내부 구는 하나의 후보 권역으로 묶는다", async ({ page }) => {
  const response = await page.request.post("/api/search", {
    data: {
      originId: "busan",
      startAt: "2026-09-12T08:00",
      returnBy: "2026-09-13T20:00",
      interests: ["culture"],
    },
  });
  expect(response.ok()).toBeTruthy();
  const result = (await response.json()) as {
    kind: string;
    candidates: Array<{ name: string; province: string }>;
  };
  expect(result.kind).toBe("success");
  const seoul = result.candidates.filter(
    (candidate) => candidate.province === "서울특별시",
  );
  expect(seoul).toHaveLength(1);
  expect(seoul[0]?.name).toBe("서울특별시");
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
  await expect(page.locator(".dd-error-summary")).toContainText(
    "고쳐야 할 항목이 1개",
  );
  await expect(page.locator(".dd-field-error__text")).toContainText("1박 2일");
  expect(searches).toBe(0);
});

test("검증 오류를 항목별로 표시하고 고치면 제출을 허용한다", async ({
  page,
}) => {
  let searches = 0;
  await page.route("**/api/search", async (route) => {
    searches += 1;
    await route.fulfill({ json: { kind: "success", candidates } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await expect(page.locator(".dd-error-summary")).toContainText(
    "고쳐야 할 항목이 2개",
  );
  await expect(page.locator(".dd-field-error__text")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
  ).toBeDisabled();
  await expect(page.locator(".dd-button-note")).toContainText(
    "아직 찾을 수 없어요",
  );
  expect(searches).toBe(0);
  await fill(page);
  await expect(page.locator(".dd-error-summary")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await expect(
    page.getByRole("button", { name: "경주 일정 보기" }),
  ).toBeVisible();
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

test("검색 로딩 중에도 입력한 조건 요약을 실제 값으로 유지한다", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/search", async (route) => {
    await gate;
    await route.fulfill({ json: { kind: "success", candidates } });
  });
  await page.goto("/");
  await fill(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await expect(page.getByRole("status")).toContainText(
    "갈 수 있는 곳을 찾고 있어요",
  );
  const summary = page.getByRole("region", { name: "입력한 여행 조건" });
  await expect(summary).toContainText("서울특별시");
  await expect(summary).toContainText("9/12 08:00 출발");
  await expect(summary).toContainText("9/13 20:00 복귀");
  await expect(summary).toContainText("역사");
  await expect(
    page.getByRole("button", { name: "검색을 멈추고 조건 수정하기" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("button", { name: "경주 일정 보기" }),
  ).toBeVisible();
});

test("검색을 멈추면 조건 화면으로 돌아가고 늦게 온 응답은 무시한다", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/search", async (route) => {
    await gate;
    await route.fulfill({ json: { kind: "success", candidates } });
  });
  await page.goto("/");
  await fill(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await page
    .getByRole("button", { name: "검색을 멈추고 조건 수정하기" })
    .click();
  await expect(
    page.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("button", { name: "경주 일정 보기" }),
  ).toHaveCount(0);
});

test("음식점 조회 로딩 중에는 선택 후보와 관광 블록을 실제 값으로 유지한다", async ({
  page,
}) => {
  await page.route("**/api/search", (route) =>
    route.fulfill({ json: { kind: "success", candidates } }),
  );
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/destinations/**/restaurants", async (route) => {
    await gate;
    await route.fulfill({ json: { kind: "success", restaurants: [] } });
  });
  await page.goto("/");
  await fill(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await page.getByRole("button", { name: "경주 일정 보기" }).click();
  const summary = page.getByRole("region", { name: "입력한 여행 조건" });
  await expect(summary).toContainText("경주");
  await expect(page.getByRole("status")).toContainText(
    "음식점을 불러오고 있어요",
  );
  await expect(page.getByText("경주 관광지 1")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "조회를 멈추고 다른 지역 보기" }),
  ).toBeVisible();
  release();
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

test("음식점 목록 수집이 실패해도 관광 계획은 유지하고 식사 섹션만 재시도 상태로 보인다", async ({
  page,
}) => {
  await page.route("**/api/search", (route) =>
    route.fulfill({ json: { kind: "success", candidates } }),
  );
  let calls = 0;
  await page.route("**/api/destinations/**/restaurants", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 502,
        json: {
          kind: "data-error",
          message: "음식점 목록을 불러오지 못했어요. 다시 시도해 주세요.",
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        kind: "success",
        restaurants: [
          {
            contentId: "food-1",
            name: "재시도 식당",
            address: "서울",
            phone: "",
            certified: false,
            foodCultureMatch: false,
          },
          {
            contentId: "food-2",
            name: "재시도 식당 둘",
            address: "서울",
            phone: "",
            certified: false,
            foodCultureMatch: false,
          },
        ],
      },
    });
  });
  await page.goto("/");
  await fill(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await page.getByRole("button", { name: "경주 일정 보기" }).click();

  // 관광 계획은 그대로 렌더된다.
  await expect(page.getByText("경주 참고용 여행 계획")).toBeVisible();
  await expect(page.getByText("경주 관광지 1")).toBeVisible();
  await expect(page.getByText("경주 관광지 4")).toBeVisible();

  // 식사 섹션만 자적색 재시도 상태다. 수집 실패는 "식당 부족" 안내와 구분한다.
  const mealBanner = page.locator(".dd-meal-failure");
  await expect(mealBanner).toHaveAttribute("role", "alert");
  await expect(mealBanner).toContainText("식사 정보를 불러오지 못했어요");
  await expect(mealBanner).toContainText("임의 음식점으로 대체");
  await expect(
    page.getByText("식사 정보를 다시 불러오면 채워져요"),
  ).toHaveCount(4);
  await expect(page.getByText("추천할 식당을 더 찾지 못했어요")).toHaveCount(0);

  // 재시도는 음식점 목록만 다시 부른다. 성공하면 이름이 채워지고
  // 부족한 칸은 안내 문구(재시도 UI 아님)로 남는다.
  await page.getByRole("button", { name: "식사 정보 다시 불러오기" }).click();
  const meals = page.locator(".dd-summary-card p");
  await expect(
    meals.filter({ hasText: /^11:30 · 점심 · 재시도 식당$/u }),
  ).toHaveCount(1);
  await expect(
    meals.filter({ hasText: /^17:30 · 저녁 · 재시도 식당 둘$/u }),
  ).toHaveCount(1);
  await expect(page.getByText("추천할 식당을 더 찾지 못했어요")).toHaveCount(2);
  await expect(page.locator(".dd-meal-failure")).toHaveCount(0);
  expect(calls).toBe(2);
});
