import { defineConfig, globalIgnores } from "eslint/config";
import nextTs from "eslint-config-next/typescript";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // `**/.next/**`와 `.claude/**`까지 무시한다. 루트 상대 패턴(`.next/**`)은 중첩 경로를 걸러내지
  // 못해서, 에이전트 워크트리(`.claude/worktrees/*`) 안의 빌드 산출물이 lint 대상으로 들어왔다.
  globalIgnores([
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
  ]),
]);
