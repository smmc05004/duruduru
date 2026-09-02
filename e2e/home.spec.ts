import { expect, test } from "@playwright/test";

/*
 * F-01 조건 입력 → F-02·F-03 추천 계산·추천 결과·결과 없음의 핵심 흐름.
 * 일정 결과 화면(F-04)은 아직 범위 밖이라 목적지 선택 상태까지만 확인한다.
 */

/** 유효한 조건을 채운다. 관심사는 1개 이상 필수다(DECISIONS.md 7.3절). */
async function fillConditions(
  page: import("@playwright/test").Page,
  startAt: string,
  returnBy: string,
  interest = "역사",
) {
  await page.getByLabel("어디서 출발해요?").selectOption("seoul");
  await page.getByLabel("출발 일시").fill(startAt);
  await page.getByLabel("복귀 가능 일시").fill(returnBy);
  await page.getByRole("checkbox", { name: interest }).click();
}

test("유효한 여행 조건을 제출하면 제출한 조건이 요약으로 남는다", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /알려주면 갈 곳부터 골라줄게요/ }),
  ).toBeVisible();

  await page.getByLabel("어디서 출발해요?").selectOption("seoul");
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("복귀 가능 일시").fill("2026-09-13T20:00");
  await page.getByRole("checkbox", { name: "역사" }).click();

  await expect(page.getByText("쓸 수 있는 시간 36시간")).toBeVisible();

  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();

  const summary = page.getByRole("region", { name: "제출한 여행 조건" });
  await expect(summary).toBeVisible();
  await expect(summary.getByText("서울특별시 출발")).toBeVisible();
  await expect(summary.getByText("역사")).toBeVisible();
  await expect(summary.getByText("1박 2일")).toBeVisible();
  await expect(
    summary.getByText("Asia/Seoul · 지원 조건 2026-09-02"),
  ).toBeVisible();
});

test("복귀가 출발보다 이른 입력은 제출되지 않는다", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("어디서 출발해요?").selectOption("seoul");
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("복귀 가능 일시").fill("2026-09-12T06:00");
  await page.getByRole("checkbox", { name: "역사" }).click();

  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();

  await expect(
    page.getByText("복귀 시각이 출발보다 빨라요. 출발 이후로 맞춰 주세요."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "제출한 여행 조건" }),
  ).toHaveCount(0);
});

test("자차만 정식 이동수단으로 보이고 대중교통 선택지는 없다", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("radio", { name: "자차" })).toBeEnabled();
  await expect(page.getByRole("radio", { name: "대중교통" })).toHaveCount(0);
  await expect(page.getByText("현재는 자차 여행만 지원해요.")).toBeVisible();
});

test("출발과 복귀가 동시에 비어 있으면 두 오류가 모두 보이고 배너 개수와 일치한다", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();

  await expect(page.getByText("출발지를 골라 주세요.")).toBeVisible();
  await expect(page.getByText("출발 일시를 골라 주세요.")).toBeVisible();
  await expect(page.getByText("복귀 가능 일시를 골라 주세요.")).toBeVisible();
  await expect(page.getByText("관심사를 하나 이상 골라 주세요.")).toBeVisible();
  await expect(page.getByText("고쳐야 할 항목이 4개 있어요")).toBeVisible();
  await expect(page.locator(".dd-field-error__text")).toHaveCount(4);

  // 각 오류 메시지가 자기 입력에 연결된다.
  await expect(page.getByLabel("출발 일시")).toHaveAttribute(
    "aria-describedby",
    "start-at-error",
  );
  await expect(page.getByLabel("복귀 가능 일시")).toHaveAttribute(
    "aria-describedby",
    "return-by-error",
  );
});

test("관심사를 고르지 않으면 제출을 막고 항목 오류를 보인다", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByLabel("어디서 출발해요?").selectOption("seoul");
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("복귀 가능 일시").fill("2026-09-13T20:00");

  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();

  await expect(page.getByText("관심사를 하나 이상 골라 주세요.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
  ).toBeDisabled();
  await expect(page.getByRole("region", { name: "결과 없음" })).toHaveCount(0);
  await expect(page.getByText(/다녀올 수 있는 곳 \d+군데/)).toHaveCount(0);
});

test("유효한 조건을 제출하면 계산 중을 거쳐 추천 결과가 보인다", async ({
  page,
}) => {
  await page.goto("/");
  await fillConditions(page, "2026-09-12T08:00", "2026-09-13T20:00");

  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();

  // 계산 중에도 조건 요약이 남는다(FUNCTIONAL_SPEC.md 4장).
  await expect(page.getByRole("status")).toContainText("계산하고 있어요");
  await expect(
    page.getByRole("region", { name: "제출한 여행 조건" }),
  ).toBeVisible();

  await expect(page.getByText(/다녀올 수 있는 곳 \d+군데/)).toBeVisible();
  await expect(page.getByText("시간 적합순")).toBeVisible();
  // 왕복이 가장 짧은 공주가 첫 후보다.
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(
    "공주",
  );
  await expect(page.getByText("가장 잘 맞아요")).toBeVisible();

  // F-03 근거와 F-05 신뢰도 표시
  await expect(
    page.getByText(/쓸 수 있는 시간 중 이동에 쓰이지 않은 비율/).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/고른 관심사 중 겹친 개수/).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/이동시간 추정 · PoC 목업/).first(),
  ).toBeVisible();

  // 목적지 선택은 선택 상태까지만 간다(일정 결과 화면은 범위 밖).
  await page.getByRole("button", { name: "공주 일정 보기" }).click();
  await expect(page.getByText(/일정 결과 화면은 아직 준비 중/)).toBeVisible();
});

test("모든 후보가 시간 제약에 걸리면 결과 없음을 정상 상태로 보인다", async ({
  page,
}) => {
  await page.goto("/");
  await fillConditions(page, "2026-09-12T09:00", "2026-09-12T14:00");

  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();

  const empty = page.getByRole("region", { name: "결과 없음" });
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("최소로 머물러야 하는 4시간(당일치기)");
  await expect(page.getByText("더 이른 시간에 출발하기")).toBeVisible();
  await expect(page.getByText("복귀 시간을 늦춰보기")).toBeVisible();
  await expect(page.getByText("지원하는 다른 출발지로 바꾸기")).toBeVisible();
  // 후보를 지어내지 않는다.
  await expect(page.getByText(/다녀올 수 있는 곳 \d+군데/)).toHaveCount(0);

  await page.getByRole("button", { name: "조건 수정하기" }).click();
  await expect(
    page.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
  ).toBeVisible();
});
