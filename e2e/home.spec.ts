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
  await expect(
    plan.getByRole("region", { name: "이동시간 안내" }),
  ).toBeVisible();
  await expect(
    plan.getByRole("region", { name: "이동시간 안내" }),
  ).toContainText("장소 간 이동시간은 직선거리를 기준으로 추정했어요.");
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
    page.getByRole("heading", { name: "부산광역시 중구에서 갈 수 있는 곳" }),
  ).toBeVisible();
  expect(origins).toEqual(["busan"]);
});

test("표준 출발 검색은 선택 후 제출하며 지역 간 시간과 현지 이동 계획을 만든다", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/search"))
      requests.push(request.postDataJSON().originId);
  });
  await page.route("**/api/phase-two/restaurants", (route) =>
    route.fulfill({
      json: {
        kind: "success",
        restaurants: [],
        queriedRegionIds: [],
        failedRegionIds: [],
        truncated: false,
        fetchedAt: "2026-09-09T00:00:00Z",
      },
    }),
  );
  await page.route("**/api/attractions/**", (route) =>
    route.fulfill({
      status: 502,
      json: { kind: "data-error", message: "검증용 상세 결측" },
    }),
  );
  await page.goto("/");
  await fillRequired(page);
  await page.getByLabel("출발 지역 검색", { exact: true }).fill("수원");
  expect(requests).toEqual([]);
  const select = page.getByLabel("출발 지역 선택", { exact: true });
  const value = await select.locator("option").nth(1).getAttribute("value");
  await select.selectOption(value!);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await expect(
    page.getByRole("heading", { name: /수원시 .*구에서 갈 수 있는 곳/ }),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "목적지 추천" })
    .getByRole("button", { name: /일정 보기$/ })
    .first()
    .click();
  const plan = page.getByRole("region", { name: "여행 계획" });
  await expect(plan).toBeVisible();
  await expect(
    plan.getByRole("region", { name: "이동시간 안내" }),
  ).toBeVisible();
  expect(requests).toEqual([value]);
  await page
    .getByRole("button", { name: "조건 수정하기", exact: true })
    .click();
  await page
    .getByLabel("출발 시도", { exact: true })
    .selectOption("세종특별자치시");
  const sejong = page.getByLabel("출발 지역 선택", { exact: true });
  await sejong.selectOption({ label: "세종특별자치시" });
  await page.route("**/api/search", (route) =>
    route.fulfill({
      status: 502,
      json: { kind: "data-error", message: "검증용 검색 실패" },
    }),
  );
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await expect(plan).toBeVisible();
  await expect(plan).toContainText("수원시");
});

test("당일 입력은 검색 요청 없이 1박 2일 오류를 표시한다", async ({ page }) => {
  const origins: string[] = [];
  await mockSearch(page, origins);
  await page.goto("/");
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("다음날 귀가 완료 일시").fill("2026-09-12T20:00");
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "복귀 날짜" }),
  ).toContainText("다음날");
  expect(origins).toHaveLength(0);
});

test("선택한 계획에 개인 일정을 추가해도 음식점 조회를 다시 시작하지 않는다", async ({
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
        fetchedAt: "2026-09-09T00:00:00.000Z",
        message: "",
      },
    });
  });
  await page.route("**/api/attractions/**", async (route) => {
    await route.fulfill({ status: 503, body: "unavailable" });
  });
  await page.goto("/");
  await fillRequired(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  const results = page.getByRole("region", { name: "목적지 추천" });
  await results
    .getByRole("button", { name: /일정 보기$/ })
    .first()
    .click();
  const plan = page.getByRole("region", { name: "여행 계획" });
  await expect(plan).toBeVisible();
  await expect.poll(() => restaurantCalls).toBe(1);
  await plan.getByRole("button", { name: "개인 일정 추가" }).click();
  const editor = page.getByRole("region", { name: "개인 일정 추가" });
  await editor.getByRole("textbox").first().fill("친구와 만남");
  await editor.getByRole("button", { name: "개인 일정 추가" }).click();
  await expect(plan).toContainText("친구와 만남");
  expect(restaurantCalls).toBe(1);
});

test("날짜 이동은 대상 날짜의 삽입 위치를 키보드 선택으로 지정한다", async ({
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
  await page.route("**/api/attractions/**", async (route) => {
    await route.fulfill({ status: 503, body: "unavailable" });
  });
  await page.goto("/");
  await fillRequired(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  const results = page.getByRole("region", { name: "목적지 추천" });
  await results
    .getByRole("button", { name: /일정 보기$/ })
    .first()
    .click();
  const plan = page.getByRole("region", { name: "여행 계획" });
  await expect(plan).toBeVisible();
  await page
    .locator("details.p2-edit-tools")
    .first()
    .locator("summary")
    .click();
  const insertion = plan.getByLabel(/삽입 위치/).first();
  await expect(insertion).toBeVisible();
  await insertion.selectOption("0");
  await expect(insertion).toHaveValue("0");
});

test("숙소 메모는 야간 휴식에 보이고 저장 후 불러오기에도 남는다", async ({
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
  await page.route("**/api/attractions/**", async (route) => {
    await route.fulfill({ status: 503, body: "unavailable" });
  });
  await page.goto("/");
  await fillRequired(page);
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  const results = page.getByRole("region", { name: "목적지 추천" });
  await results
    .getByRole("button", { name: /일정 보기$/ })
    .first()
    .click();
  const plan = page.getByRole("region", { name: "여행 계획" });
  await expect(plan).toBeVisible();
  await plan.getByRole("button", { name: "숙소 메모" }).click();
  const editor = page.getByRole("region", { name: "숙소 메모" });
  await editor.getByRole("textbox").nth(0).fill("한옥 숙소");
  await editor.getByRole("textbox").nth(1).fill("공주 시내");
  await editor.getByRole("textbox").nth(2).fill("문 앞에 주차");
  await editor.getByRole("button", { name: "숙소 메모 저장" }).click();
  await expect(plan).toContainText("한옥 숙소");
  await plan.getByRole("button", { name: "이 기기에 저장" }).click();
  await page.reload();
  await page.getByRole("button", { name: "저장한 여행" }).click();
  await page.getByRole("button", { name: "불러오기" }).click();
  await expect(page.getByRole("region", { name: "여행 계획" })).toContainText(
    "한옥 숙소",
  );
});
