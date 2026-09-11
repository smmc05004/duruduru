import { expect, test, type Page, type Locator } from "@playwright/test";
import type { PlanSnapshot } from "../lib/mvp-phase-two-types";

async function setup(page: Page, origin: "서울특별시" | "부산광역시") {
  const calls = { meals: 0, details: 0 };
  let response: { candidates: PlanSnapshot["destination"][] };
  page.on("response", async (result) => {
    if (result.url().endsWith("/api/search") && result.ok())
      response = await result.json();
  });
  await page.route("**/api/phase-two/restaurants", async (route) => {
    calls.meals++;
    const body = route.request().postDataJSON();
    const candidate = response.candidates.find(
      (candidate) => candidate.groupId === body.groupId,
    )!;
    await route.fulfill({
      json: {
        kind: "success",
        restaurants: Array.from({ length: 8 }, (_, index) => ({
          contentId: `restaurant-${index}`,
          regionId: candidate.memberRegionIds[0],
          name: `검증 식당 ${index + 1}`,
          address: `${candidate.displayName} 음식점 주소 ${index}`,
          phone: "",
          imageUrl: "",
          coordinates: candidate.attractions[0].coordinates,
          certified: false,
          foodCultureMatch: false,
          fetchedAt: "2026-09-09T00:00:00Z",
        })),
        queriedRegionIds: candidate.memberRegionIds.slice(0, 1),
        failedRegionIds: [],
        truncated: false,
        fetchedAt: "2026-09-09T00:00:00Z",
        message: "목록 확인",
      },
    });
  });
  await page.route("**/api/attractions/**", async (route) => {
    calls.details++;
    await route.fulfill({
      json: {
        kind: "success",
        detail: {
          title: { status: "confirmed", value: "관광지 정보" },
          address: { status: "unknown" },
          overview: { status: "confirmed", value: "공공데이터 소개" },
          openingHours: { status: "unknown" },
          closedDays: { status: "unknown" },
          fees: { status: "unknown" },
          phone: { status: "unknown" },
          imageUrl: "",
          fetchedAt: "2026-09-09T00:00:00Z",
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("radio", { name: origin }).check();
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("다음날 귀가 완료 일시").fill("2026-09-13T20:00");
  const history = page.getByRole("checkbox", { name: "역사" });
  if ((await history.getAttribute("aria-checked")) !== "true")
    await history.click();
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();
  const results = page.getByRole("region", { name: "목적지 추천" });
  // 실제 검색 엔진이 전국 프로필을 도는 첫 요청이라 dev 서버에서 수 초 걸릴 수 있다.
  await expect(results.locator(".dd-candidate").first()).toBeVisible({
    timeout: 20_000,
  });
  expect(calls).toEqual({ meals: 0, details: 0 });
  await results
    .getByRole("button", { name: /일정 보기$/ })
    .first()
    .click();
  await expect(page.locator(".p2-block--restaurant").first()).toBeVisible();
  const count = await page.locator(".p2-block--attraction").count();
  await expect.poll(() => calls.details).toBe(count);
  await expect.poll(() => calls.meals).toBe(1);
  return calls;
}
async function tools(row: Locator) {
  const details = row.locator("details.p2-edit-tools");
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").click();
  return details;
}
async function stored(page: Page): Promise<PlanSnapshot> {
  await page.getByRole("button", { name: "이 기기에 저장" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("duruduru.plans.v3")))
    .not.toBeNull();
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("duruduru.plans.v3")!).plans[0],
  );
}
async function restore(page: Page, expected: PlanSnapshot) {
  await page.reload();
  await page.getByRole("button", { name: "저장한 여행" }).click();
  await page.getByRole("button", { name: "불러오기" }).click();
  await expect(page.getByRole("region", { name: "여행 계획" })).toBeVisible();
  for (const block of expected.blocks.filter((b) =>
    ["attraction", "personal", "meal"].includes(b.kind),
  )) {
    const row = page.locator(`[data-block-id="${block.id}"]`);
    await expect(row.locator("time")).toHaveAttribute(
      "datetime",
      block.startAt,
    );
    if (block.contentId)
      await expect(row).toHaveAttribute("data-content-id", block.contentId);
    if (block.fixed) await expect(row).toContainText("장소 고정됨");
    if (block.personal) await expect(row).toContainText(block.personal.name);
  }
  const raw = await page.evaluate(
    () => JSON.parse(localStorage.getItem("duruduru.plans.v3")!).plans[0],
  );
  expect(raw).toEqual(expected);
}

test("R6 서울 실제 검색→식당→관광 날짜/시간/순서 편집→저장·복원", async ({
  page,
}) => {
  const calls = await setup(page, "서울특별시");
  const original = await stored(page);
  const target = original.blocks.find(
    (b) => b.kind === "attraction" && b.day === 1,
  )!;
  const remove = original.blocks
    .filter((b) => b.kind === "attraction" && b.day === 2)
    .at(-1)!;
  const row = page.locator(`[data-block-id="${target.id}"]`);
  await (
    await tools(row)
  )
    .getByRole("button", { name: "장소 고정", exact: true })
    .click();
  await (
    await tools(row)
  )
    .getByRole("combobox", { name: "방문시간", exact: true })
    .selectOption("30");
  page.once("dialog", (dialog) => dialog.accept());
  await (
    await tools(page.locator(`[data-block-id="${remove.id}"]`))
  )
    .getByRole("button", { name: "삭제", exact: true })
    .click();
  await expect(page.locator(`[data-block-id="${remove.id}"]`)).toHaveCount(0);
  await (await tools(row)).getByLabel(/삽입 위치/).selectOption("1");
  await (
    await tools(row)
  )
    .getByRole("button", { name: "2일차로 이동" })
    .click();
  await expect(row.locator("time")).toHaveAttribute("datetime", /^2026-09-13/);
  await (await tools(row)).getByRole("button", { name: "아래로 이동" }).click();
  const final = await stored(page);
  expect(final.blocks.find((b) => b.id === target.id)).toMatchObject({
    day: 2,
    fixed: true,
    durationMinutes: 30,
  });
  expect(
    final.blocks.filter((b) => b.kind === "attraction" && b.day === 2).at(-1)
      ?.id,
  ).toBe(target.id);
  expect(
    final.blocks.filter((b) => b.restaurant).map((b) => b.restaurant),
  ).toEqual(
    original.blocks.filter((b) => b.restaurant).map((b) => b.restaurant),
  );
  expect(calls).toEqual({
    meals: 1,
    details: original.metrics.attractionCount,
  });
  await restore(page, final);
  expect(calls).toEqual({
    meals: 1,
    details: original.metrics.attractionCount,
  });
});

test("R6 부산 개인 일정 날짜/시간·14시 고정·숙소 메모·불가 편집 rollback→저장·복원", async ({
  page,
}) => {
  const calls = await setup(page, "부산광역시");
  const original = await stored(page);
  const plan = page.getByRole("region", { name: "여행 계획" });
  await plan.getByRole("button", { name: "개인 일정 추가" }).click();
  const editor = page.getByRole("region", { name: "개인 일정 추가" });
  await editor.getByRole("textbox").first().fill("부산 출발 친구 약속");
  await editor.getByRole("button", { name: "개인 일정 추가" }).click();
  const row = page.locator(".p2-block--personal");
  await (
    await tools(row)
  )
    .getByRole("combobox", { name: "일정 시간", exact: true })
    .selectOption("90");
  await (await tools(row)).getByLabel(/삽입 위치/).selectOption("3");
  await (
    await tools(row)
  )
    .getByRole("button", { name: "2일차로 이동" })
    .click();
  await expect(row.locator("time")).toHaveAttribute("datetime", /^2026-09-13/);
  await (
    await tools(row)
  )
    .getByLabel("시작 시각 고정", { exact: true })
    .fill("2026-09-13T14:00");
  await expect(row.locator("time")).toHaveAttribute(
    "datetime",
    "2026-09-13T14:00",
  );
  await (
    await tools(page.locator(".p2-block--attraction").first())
  )
    .getByRole("combobox", { name: "방문시간", exact: true })
    .selectOption("30");
  await expect(row.locator("time")).toHaveAttribute(
    "datetime",
    "2026-09-13T14:00",
  );
  await plan.getByRole("button", { name: "숙소 메모", exact: true }).click();
  const lodging = page.getByRole("region", { name: "숙소 메모" });
  await lodging.getByRole("textbox").nth(0).fill("여행 숙소");
  await lodging.getByRole("textbox").nth(1).fill("선택 지역 숙소 주소");
  await lodging.getByRole("textbox").nth(2).fill("체크인 연락하기");
  await lodging.getByRole("button", { name: "숙소 메모 저장" }).click();
  const final = await stored(page);
  const before = await page.evaluate(() =>
    localStorage.getItem("duruduru.plans.v3"),
  );
  await (
    await tools(row)
  )
    .getByLabel("시작 시각 고정", { exact: true })
    .fill("2026-09-13T22:00");
  await expect(plan).toContainText(/현지 체류 범위 밖|휴식/);
  await expect(row.locator("time")).toHaveAttribute(
    "datetime",
    "2026-09-13T14:00",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("duruduru.plans.v3")),
  ).toBe(before);
  expect(final.blocks.find((b) => b.kind === "personal")).toMatchObject({
    day: 2,
    durationMinutes: 90,
    fixedStartAt: "2026-09-13T14:00",
    personal: { day: 2, durationMinutes: 90, name: "부산 출발 친구 약속" },
  });
  await restore(page, final);
  await expect(page.getByRole("region", { name: "여행 계획" })).toContainText(
    "체크인 연락하기",
  );
  expect(calls).toEqual({
    meals: 1,
    details: original.metrics.attractionCount,
  });
});

test("T7 카드의 목적 적합성 구간·확정 연결 시설 수가 실제 초안 배치와 맞고 시간표 제약을 지킨다", async ({
  page,
}) => {
  let response: { candidates: PlanSnapshot["destination"][] };
  page.on("response", async (result) => {
    if (result.url().endsWith("/api/search") && result.ok())
      response = await result.json();
  });
  await page.route("**/api/phase-two/restaurants", async (route) => {
    const body = route.request().postDataJSON();
    const candidate = response.candidates.find(
      (c) => c.groupId === body.groupId,
    )!;
    await route.fulfill({
      json: {
        kind: "success",
        restaurants: Array.from({ length: 8 }, (_, index) => ({
          contentId: `restaurant-${index}`,
          regionId: candidate.memberRegionIds[0],
          name: `검증 식당 ${index + 1}`,
          address: `${candidate.displayName} 음식점 주소 ${index}`,
          phone: "",
          imageUrl: "",
          coordinates: candidate.attractions[0]?.coordinates ?? null,
          certified: false,
          foodCultureMatch: false,
          fetchedAt: "2026-09-09T00:00:00Z",
        })),
        queriedRegionIds: candidate.memberRegionIds.slice(0, 1),
        failedRegionIds: [],
        truncated: false,
        fetchedAt: "2026-09-09T00:00:00Z",
        message: "목록 확인",
      },
    });
  });
  await page.route("**/api/attractions/**", async (route) => {
    await route.fulfill({
      json: {
        kind: "success",
        detail: {
          title: { status: "confirmed", value: "관광지 정보" },
          address: { status: "unknown" },
          overview: { status: "confirmed", value: "공공데이터 소개" },
          openingHours: { status: "unknown" },
          closedDays: { status: "unknown" },
          fees: { status: "unknown" },
          phone: { status: "unknown" },
          imageUrl: "",
          fetchedAt: "2026-09-09T00:00:00Z",
        },
      },
    });
  });

  await page.goto("/");
  await page.getByRole("radio", { name: "서울특별시" }).check();
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("다음날 귀가 완료 일시").fill("2026-09-13T20:00");
  for (const name of ["역사", "문화"]) {
    const box = page.getByRole("checkbox", { name });
    if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
  }
  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();

  const results = page.getByRole("region", { name: "목적지 추천" });
  const interestCard = results.locator(".dd-candidate").first();
  await expect(interestCard).toBeVisible({ timeout: 20_000 });

  const basis = interestCard.locator("details.p2-basis");
  await basis.locator("summary").click();
  const basisText = (await basis.innerText()).replace(/\s+/gu, " ");
  // 목적 점수는 노출하되 과장 표현("전국 1위"·"가장 인기")은 없어야 한다(D4).
  // 면책 문구 "…평점·영업 보장이 아니에요"는 허용한다.
  expect(basisText).not.toMatch(/전국 역사 1위|가장 인기 있는/);
  // T7(D4): 원점수 대신 목적 적합성 구간을 노출한다.
  expect(basisText).toMatch(/목적 적합성 구간/);
  const hubMatch = basisText.match(
    /확정 연결 시설 (\d+)곳|(\d+)곳이 중심 관광지에 확정 연결/,
  );
  const claimedHubCount = hubMatch ? Number(hubMatch[1] ?? hubMatch[2]) : 0;

  await interestCard.getByRole("button", { name: /일정 보기$/ }).click();
  const plan = page.getByRole("region", { name: "여행 계획" });
  await expect(page.locator(".p2-block--restaurant").first()).toBeVisible();

  // 중심 근거로 주장한 관광지 수 ≤ 실제 초안에 배치된 관광지 수.
  const attractionCount = await page.locator(".p2-block--attraction").count();
  expect(attractionCount).toBeGreaterThanOrEqual(claimedHubCount);
  expect(attractionCount).toBeGreaterThan(0);

  // 시간표 제약: 야간 휴식 고정, 점심·저녁 식사, 출발·복귀 블록.
  await expect(page.locator(".p2-block--rest").first()).toBeVisible();
  expect(
    await page.locator(".p2-block--restaurant").count(),
  ).toBeGreaterThanOrEqual(2);
  await expect(plan).toContainText("출발");
  await expect(plan).toContainText(/복귀|귀가/);

  // 저장 → 새로고침 → 복원.
  await page.getByRole("button", { name: "이 기기에 저장" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("duruduru.plans.v3")))
    .not.toBeNull();
  await page.reload();
  await page.getByRole("button", { name: "저장한 여행" }).click();
  await page.getByRole("button", { name: "불러오기" }).click();
  await expect(page.getByRole("region", { name: "여행 계획" })).toBeVisible();
});
