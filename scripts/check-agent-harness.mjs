import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredSources = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/agent/SOURCE_ORDER.md",
  "docs/agent/WORKFLOW.md",
  "docs/agent/WORK_CYCLE.md",
  "docs/agent/TECH_STACK.md",
  "docs/product/PRD.md",
  "docs/product/DECISIONS.md",
  "docs/product/FUNCTIONAL_SPEC.md",
  "docs/development/BRANCH_WORKFLOW.md",
  ".agents/pm/AGENT.md",
  ".agents/employee/AGENT.md",
  ".agents/reviewer/AGENT.md",
  ".agents/designer/AGENT.md",
  "docs/design/DESIGN_DIRECTION.md",
  "docs/design/DESIGN_TOKENS.md",
  ".claude/settings.json",
];

const claudeEntrypoint = "CLAUDE.md";

// 백틱 경로를 검사할 문서. 아래 목록에 더해 docs/agent/ 와 docs/product/ 아래 전부를 본다.
const referenceDocuments = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/development/BRANCH_WORKFLOW.md",
  ".agents/pm/AGENT.md",
  ".agents/employee/AGENT.md",
  ".agents/reviewer/AGENT.md",
  ".github/pull_request_template.md",
];

// 백틱 경로를 검사할 문서를 찾을 디렉터리.
const referenceDirectories = ["docs/agent", "docs/product", "docs/design"];

// 디렉터리 없이 파일명만 쓴 참조(`PRD.md`)를 찾아볼 위치. 저장소 루트가 먼저다.
const filenameSearchDirectories = [
  "",
  "docs/product",
  "docs/agent",
  "docs/development",
  ".github",
  "scripts",
  "lib",
  "app",
];

// 저장소 루트 기준으로 해석하는 접두사. 이 중 하나로 시작하거나 확장자가 있어야 경로로 본다.
const rootPrefixes = [
  ".agents/",
  ".claude/",
  ".github/",
  "app/",
  "design/",
  "docs/",
  "e2e/",
  "lib/",
  "scripts/",
];

// 저장소 상태로 판정할 수 없어 검사하지 않는 접두사.
// - node_modules/: 의존성 설치 산출물이다. 설치 여부에 따라 결과가 흔들린다.
// - .work-cycles/: 작업 사이클이 만드는 로컬 상태 디렉터리이며 커밋하지 않는다.
const ignoredPrefixes = ["node_modules/", ".work-cycles/"];

// 경로처럼 생겼지만 경로가 아닌 토큰. 검사 범위를 넓히면 오탐이 함께 늘어나므로,
// 예외는 이 목록에 이유와 함께 모아 두고 판정 규칙 자체를 느슨하게 만들지 않는다.
// 여기에 토큰을 추가할 때는 왜 경로가 아닌지 주석으로 남긴다.
const ignoredTokens = new Set([
  // .gitignore 대상이라 저장소에 존재할 수 없다. 예시 파일은 .env.local.example 이 따로 있다.
  ".env.local",
]);

async function exists(relativePath) {
  try {
    await access(path.join(repositoryRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function isPathLike(token) {
  if (ignoredTokens.has(token)) return false;
  if (ignoredPrefixes.some((prefix) => token.startsWith(prefix))) return false;
  if (token.startsWith("@")) return false; // 패키지 이름·경로 별칭
  if (token.includes(" ")) return false; // 명령어
  if (token.includes("*")) return false; // 글롭
  if (token.includes("<") || token.includes(">")) return false; // 자리표시자
  if (/^https?:/.test(token)) return false;

  // 확장자는 영문자만으로 본다. 숫자를 허용하면 `v1.0.2` 같은 버전 문자열이
  // 확장자 `.2` 를 가진 파일로 잡힌다.
  const hasExtension = /\.[a-z]{1,5}$/i.test(token);

  // 슬래시가 없는 토큰은 확장자가 있을 때만 파일명으로 본다.
  // `PRD.md` 처럼 디렉터리를 생략한 표기를 놓치지 않기 위한 것이다.
  if (!token.includes("/")) return hasExtension;

  // 확장자가 있는 파일 경로이거나, 루트 접두사로 시작하고 슬래시로 끝나는 디렉터리만 본다.
  // 이 조건이 없으면 `feat/추천-엔진` 같은 브랜치 이름 예시가 경로로 잡힌다.
  const hasRootPrefix = rootPrefixes.some((prefix) => token.startsWith(prefix));
  return hasExtension || (hasRootPrefix && token.endsWith("/"));
}

// 디렉터리를 생략한 파일명은 알려진 문서 위치에서 찾는다. 한 곳이라도 있으면 실존으로 본다.
async function referenceExists(token) {
  const normalized = token.replace(/\/$/, "");

  if (normalized.includes("/")) {
    return exists(normalized);
  }

  for (const directory of filenameSearchDirectories) {
    if (await exists(directory ? path.posix.join(directory, normalized) : normalized)) {
      return true;
    }
  }

  return false;
}

async function collectReferenceDocuments() {
  const documents = [...referenceDocuments];

  for (const directory of referenceDirectories) {
    for (const entry of (await readdir(path.join(repositoryRoot, directory))).sort()) {
      if (entry.endsWith(".md")) {
        documents.push(path.posix.join(directory, entry));
      }
    }
  }

  return documents;
}

const missingSources = [];

for (const source of requiredSources) {
  if (!(await exists(source))) {
    missingSources.push(source);
  }
}

const claudeContents = await readFile(path.join(repositoryRoot, claudeEntrypoint), "utf8");
const importedSources = [...claudeContents.matchAll(/^@(.+)$/gm)].map((match) => match[1]);
const missingImports = [];

for (const source of importedSources) {
  if (!(await exists(source))) {
    missingImports.push(source);
  }
}

// 문서가 백틱으로 가리키는 경로가 실제로 존재하는지 검사한다.
// 코드에는 lint·타입 검사 게이트가 있지만 문서에는 없어서, 파일이 사라져도
// 문서만 남아 에이전트를 없는 경로로 유도하는 상태가 조용히 유지된다.
const brokenReferences = [];
let checkedReferenceCount = 0;

for (const document of await collectReferenceDocuments()) {
  if (!(await exists(document))) continue;

  const contents = await readFile(path.join(repositoryRoot, document), "utf8");
  const withoutCodeBlocks = contents.replace(/```[\s\S]*?```/g, "");
  const firstSeenLine = new Map();

  withoutCodeBlocks.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const token = match[1].trim();
      if (isPathLike(token) && !firstSeenLine.has(token)) {
        firstSeenLine.set(token, index + 1);
      }
    }
  });

  for (const [token, line] of firstSeenLine) {
    checkedReferenceCount += 1;
    if (!(await referenceExists(token))) {
      brokenReferences.push(`${document}:${line} \`${token}\``);
    }
  }
}

if (missingSources.length > 0 || missingImports.length > 0 || brokenReferences.length > 0) {
  if (missingSources.length > 0) {
    console.error("필수 에이전트 문서가 없습니다:");
    missingSources.forEach((source) => console.error(`- ${source}`));
  }

  if (missingImports.length > 0) {
    console.error("CLAUDE.md가 참조하는 문서가 없습니다:");
    missingImports.forEach((source) => console.error(`- ${source}`));
  }

  if (brokenReferences.length > 0) {
    console.error("문서가 가리키는 경로가 실제로 없습니다:");
    brokenReferences.forEach((reference) => console.error(`- ${reference}`));
    console.error("문서를 현재 코드에 맞게 고치거나, 경로가 아니면 백틱을 제거하세요.");
  }

  process.exitCode = 1;
} else {
  console.log(
    `에이전트 하네스 검사 통과: 필수 문서 ${requiredSources.length}개, Claude 참조 ${importedSources.length}개, 문서 경로 참조 ${checkedReferenceCount}개`,
  );
}
