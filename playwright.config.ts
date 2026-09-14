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
  // GitHub runners에서 Next 개발 서버 초기 컴파일·검색 응답이 느릴 수 있어
  // 로컬과 동일한 상호작용을 기다리되 회귀 자체는 그대로 실패시킨다.
  // 지역 프로필 전체를 순회하는 검색은 GitHub의 저사양 러너에서 초기 캐시
  // 생성까지 수십 초가 걸릴 수 있다. 기능별 제한은 유지하고 공통 대기만 넉넉히 둔다.
  expect: { timeout: 60_000 },
  use: {
    baseURL: e2eUrl,
    trace: "on-first-retry",
    actionTimeout: 60_000,
  },
  timeout: 120_000,
  webServer: {
    command: `E2E_FIXTURE=1 npm run dev -- --hostname 127.0.0.1 --port ${e2ePort}`,
    url: e2eUrl,
    // E2E_FIXTURE=1 결과 계약과 다른 기존 dev 서버를 재사용하면 success 시나리오가
    // data-unavailable로 바뀔 수 있다. fixture 검증은 항상 전용 서버에서 한다.
    reuseExistingServer: false,
  },
});
