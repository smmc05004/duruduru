import { expect, test } from "@playwright/test";

const candidates = ["경주", "공주", "강릉"].map((name, index) => ({
  groupId: `group-${index}`,
  memberRegionIds: [`region-${index}`],
  representativeZoneId: `zone-${index}`,
  displayName: name,
  name: `검증 지역 ${name}`,
  province: "검증 지역",
  oneWayMinutes: 120,
  attractions: [0, 1, 2].map((item) => ({
    contentId: `${name}-${item}`,
    contentTypeId: "12",
    regionId: `region-${index}`,
    title: `${name} 관광지 ${item + 1}`,
    address: `${name} 관광지 주소`,
    imageUrl: "",
    coordinates: null,
    categories: ["history"],
    cat1: "A02",
    cat2: "A0201",
    cat3: "A0201",
  })),
  preview: {
    blocks: [],
    metrics: {
      arrivalAt: "2026-09-12T10:00",
      returnDepartureAt: "2026-09-13T18:00",
      localMinutes: 1800,
      freeMinutes: 600,
      attractionCount: 3,
      localMealCount: 4,
      fulfilledInterests: ["history"],
      categoryDiversity: 1,
      averageDistanceKm: null,
    },
  },
  metadata: {
    profileGeneratedAt: "2026-09-07",
    travelTimeGeneratedAt: "2026-09-07",
    networkYear: 2024,
    travelTimeSource: "KTDB",
    representativePoint: "KTDB 존 중심",
    searchedAt: "2026-09-08T00:00:00.000Z",
  },
  reasons: ["관심사에 맞는 관광지를 담을 수 있어요."],
}));

async function fillRequired(page: import("@playwright/test").Page) {
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("다음날 귀가 완료 일시").fill("2026-09-13T20:00");
  const history = page.getByRole("checkbox", { name: "역사" });
  if ((await history.getAttribute("aria-checked")) !== "true")
    await history.click();
  await expect(history).toHaveAttribute("aria-checked", "true");
}

function mockSearch(page: import("@playwright/test").Page, seen: string[]) {
  return page.route("**/api/search", async (route) => {
    seen.push(JSON.parse(route.request().postData() ?? "{}").originId);
    await route.fulfill({
      json: {
        kind: "success",
        searchId: "e2e-search",
        profileGeneratedAt: "2026-09-07",
        candidates,
      },
    });
  });
}

test("서울 출발 검색은 음식점 조회 없이 후보를 보여준다", async ({ page }) => {
  const origins: string[] = [];
  await mockSearch(page, origins);
  let restaurantCalls = 0;
  await page.route("**/api/phase-two/restaurants", async (route) => {
    restaurantCalls += 1;
    await route.fulfill({
      json: {
        kind: "success",
        restaurants: [],
        failedRegionIds: [],
        truncated: false,
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("radio", { name: "서울특별시" })).toBeChecked();
  await fillRequired(page);
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
  expect(origins).toEqual(["seoul"]);
  expect(restaurantCalls).toBe(0);
});

test("실제 검색 엔진의 역할 후보를 선택한 뒤에만 음식점 API를 요청한다", async ({
  page,
}) => {
  let restaurantCalls = 0;
  await page.route("**/api/phase-two/restaurants", async (route) => {
    restaurantCalls += 1;
    await route.fulfill({
      json: {
        kind: "success",
        restaurants: [],
        queriedRegionIds: [],
        failedRegionIds: [],
        truncated: false,
        fetchedAt: "2026-09-08T00:00:00.000Z",
        message: "",
      },
    });
  });

  await page.goto("/");
  await fillRequired(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();

  const results = page.getByRole("region", { name: "목적지 추천" });
  await expect(results.locator(".dd-candidate").first()).toBeVisible();
  await expect(results).toContainText("이동 부담을 줄인 여행");
  expect(restaurantCalls).toBe(0);

  await results
    .getByRole("button", { name: /일정 보기$/ })
    .first()
    .click();
  const plan = page.getByRole("region", { name: "여행 계획" });
  await expect(plan).toBeVisible();
  await expect(plan).toContainText("여유시간");
  await expect(plan).toContainText("실제 이동시간을 계산한 값은 아니에요");
  await expect.poll(() => restaurantCalls).toBe(1);
});

test("선택 계획의 관광지만 비차단 방문 정보로 보강하고 검색에서는 상세를 호출하지 않는다", async ({
  page,
}) => {
  await page.route("**/api/phase-two/restaurants", async (route) => {
    await route.fulfill({
      json: {
        kind: "success",
        restaurants: [],
        queriedRegionIds: [],
        failedRegionIds: [],
        truncated: false,
        fetchedAt: "2026-09-09T00:00:00.000Z",
        message: "",
      },
    });
  });
  let detailCalls = 0;
  await page.route("**/api/attractions/**", async (route) => {
    detailCalls += 1;
    await route.fulfill({
      json: {
        kind: "success",
        detail: {
          title: { status: "confirmed", value: "관광지" },
          address: { status: "confirmed", value: "서울특별시 중구 세종대로 1" },
          overview: { status: "confirmed", value: "안전한 방문 소개" },
          openingHours: { status: "unknown" },
          closedDays: { status: "confirmed", value: "매주 월요일 휴무" },
          fees: { status: "unknown" },
          phone: { status: "unknown" },
          imageUrl: "",
          fetchedAt: "2026-09-09T00:00:00.000Z",
        },
      },
    });
  });
  await page.goto("/");
  await fillRequired(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  const results = page.getByRole("region", { name: "목적지 추천" });
  await expect(results.locator(".dd-candidate").first()).toBeVisible();
  expect(detailCalls).toBe(0);

  await results
    .getByRole("button", { name: /일정 보기$/ })
    .first()
    .click();
  const plan = page.getByRole("region", { name: "여행 계획" });
  await expect(plan).toBeVisible();
  await expect(plan.getByText("안전한 방문 소개").first()).toBeVisible();
  await expect(
    plan.getByRole("link", { name: "지도에서 장소 찾기" }).first(),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await expect.poll(() => detailCalls).toBeGreaterThan(0);
  expect(detailCalls).toBeLessThanOrEqual(6);
});

test("부산 출발 선택은 부산을 검색 입력으로 전송한다", async ({ page }) => {
  const origins: string[] = [];
  await mockSearch(page, origins);
  await page.goto("/");
  await page.getByRole("radio", { name: "부산광역시" }).click();
  await fillRequired(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await expect(
    page.getByRole("heading", { name: "부산광역시에서 갈 수 있는 곳" }),
  ).toBeVisible();
  expect(origins).toEqual(["busan"]);
});

test("당일 입력은 검색 요청 없이 1박 2일 오류를 표시한다", async ({ page }) => {
  const origins: string[] = [];
  await mockSearch(page, origins);
  await page.goto("/");
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("다음날 귀가 완료 일시").fill("2026-09-12T20:00");
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await expect(page.getByRole("status")).toContainText("다음날");
  expect(origins).toHaveLength(0);
});
