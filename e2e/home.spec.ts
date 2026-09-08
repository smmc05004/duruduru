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
  await expect(page.getByRole("region", { name: "여행 계획" })).toBeVisible();
  await expect.poll(() => restaurantCalls).toBe(1);
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
