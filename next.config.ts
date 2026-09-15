import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright webServer에서만 값이 주입된다. 일반 빌드/배포에는 빈 문자열이다.
  env: { NEXT_PUBLIC_E2E_FIXTURE: process.env.E2E_FIXTURE === "1" ? "1" : "" },
  // 사용 중인 로컬 개발 서버의 .next 잠금 파일과 분리해 E2E 전용 서버를 실행한다.
  ...(process.env.E2E_FIXTURE === "1" ? { distDir: ".next-e2e" } : {}),
  // React Compiler로 컴포넌트 리렌더링을 자동 메모이제이션한다. Next 16은 dev/build 모두
  // Turbopack이 기본이므로 babel-plugin-react-compiler 없이 네이티브 Rust 컴파일러를 쓴다.
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
  },
};

export default nextConfig;
