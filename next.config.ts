import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright webServer에서만 값이 주입된다. 일반 빌드/배포에는 빈 문자열이다.
  env: { NEXT_PUBLIC_E2E_FIXTURE: process.env.E2E_FIXTURE === "1" ? "1" : "" },
};

export default nextConfig;
