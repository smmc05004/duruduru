import { expect, test } from "@playwright/test";

/*
 * F-01 조건 입력 화면의 핵심 흐름. 추천 결과·일정 결과 화면은 아직 범위 밖이라
 * 이 스펙은 조건 입력과 검증까지만 확인한다.
 */

test("유효한 여행 조건을 제출하면 제출한 조건이 요약으로 남는다", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /알려주면 갈 곳부터 골라줄게요/ })).toBeVisible();

  await page.getByLabel("어디서 출발해요?").selectOption("seoul");
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("복귀 가능 일시").fill("2026-09-13T20:00");
  await page.getByRole("checkbox", { name: "역사" }).click();

  await expect(page.getByText("쓸 수 있는 시간 36시간")).toBeVisible();

  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();

  const summary = page.getByRole("region", { name: "제출한 여행 조건" });
  await expect(summary).toBeVisible();
  await expect(summary.getByText("서울 출발")).toBeVisible();
  await expect(summary.getByText("역사")).toBeVisible();
});

test("복귀가 출발보다 이른 입력은 제출되지 않는다", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("어디서 출발해요?").selectOption("seoul");
  await page.getByLabel("출발 일시").fill("2026-09-12T08:00");
  await page.getByLabel("복귀 가능 일시").fill("2026-09-12T06:00");

  await page.getByRole("button", { name: "갈 수 있는 곳 찾기" }).click();

  await expect(page.getByText("복귀 시각이 출발보다 빨라요. 출발 이후로 맞춰 주세요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "갈 수 있는 곳 찾기" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "제출한 여행 조건" })).toHaveCount(0);
});

test("대중교통은 고를 수 없다", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("radio", { name: "대중교통" })).toBeDisabled();
  await expect(page.getByText("대중교통은 아직 준비 중이라 고를 수 없어요.")).toBeVisible();
});
