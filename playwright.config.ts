import { defineConfig } from "@playwright/test";

const e2ePort = Number(process.env.E2E_PORT ?? "3000");
const e2eUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  reporter: [["list"], ["html", { open: "never" }]],
  // CI 러너에서 React 커밋 타이밍에 민감한 검사가 간헐적으로 실패한다.
  // 재시도는 실패 케이스만 다시 돌리므로 실제 회귀는 그대로 드러난다.
  // 기존 `trace: "on-first-retry"` 설정도 재시도가 있어야 의미가 있다.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: e2eUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: `E2E_FIXTURE=1 npm run dev -- --hostname 127.0.0.1 --port ${e2ePort}`,
    url: e2eUrl,
    // E2E_FIXTURE=1 결과 계약과 다른 기존 dev 서버를 재사용하면 success 시나리오가
    // data-unavailable로 바뀔 수 있다. fixture 검증은 항상 전용 서버에서 한다.
    reuseExistingServer: false,
  },
});
