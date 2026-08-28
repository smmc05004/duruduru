import { expect, test } from "@playwright/test";

test("여행 조건을 제출하면 추천 결과를 확인할 수 있다", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /시간이 생기면/ })).toBeVisible();
  await page.getByRole("button", { name: /갈 수 있는 곳 찾기/ }).click();

  await expect(page.getByRole("heading", { name: "이번 여행에 갈 수 있는 곳" })).toBeVisible();
});
