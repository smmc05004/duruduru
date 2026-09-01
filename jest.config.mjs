import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

export default createJestConfig({
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // `.claude/`는 에이전트 워크트리가 저장소 안에 생기는 자리다. 무시하지 않으면 같은 테스트가
  // 중복 실행되고, 그 안의 Playwright 스펙까지 Jest가 집어 들어 실패한다.
  testPathIgnorePatterns: [
    "<rootDir>/e2e/",
    "<rootDir>/.next/",
    "<rootDir>/.claude/",
  ],
  modulePathIgnorePatterns: ["<rootDir>/.claude/"],
});
