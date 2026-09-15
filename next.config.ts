import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright webServer에서만 값이 주입된다. 일반 빌드/배포에는 빈 문자열이다.
  env: { NEXT_PUBLIC_E2E_FIXTURE: process.env.E2E_FIXTURE === "1" ? "1" : "" },
  // 사용 중인 로컬 개발 서버의 .next 잠금 파일과 분리해 E2E 전용 서버를 실행한다.
  ...(process.env.E2E_FIXTURE === "1" ? { distDir: ".next-e2e" } : {}),
  // React Compiler로 컴포넌트 리렌더링을 자동 메모이제이션한다.
  // experimental.turbopackRustReactCompiler(네이티브 Rust 컴파일러)는 Turbopack 실행
  // 여부를 next.config 검증 단계에서 확인하는데, next/jest가 next.config를 로드할 때는
  // Turbopack 플래그가 없어 "Turbopack에서만 지원" 에러로 Jest 전체가 죽는다. 그래서
  // babel-plugin-react-compiler를 쓰는 표준 경로만 켠다.
  reactCompiler: true,
};

export default nextConfig;
