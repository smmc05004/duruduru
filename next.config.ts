import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright webServer에서만 값이 주입된다. 일반 빌드/배포에는 빈 문자열이다.
  env: { NEXT_PUBLIC_E2E_FIXTURE: process.env.E2E_FIXTURE === "1" ? "1" : "" },
  // 사용 중인 로컬 개발 서버의 .next 잠금 파일과 분리해 E2E 전용 서버를 실행한다.
  ...(process.env.E2E_FIXTURE === "1" ? { distDir: ".next-e2e" } : {}),
};

export default nextConfig;
