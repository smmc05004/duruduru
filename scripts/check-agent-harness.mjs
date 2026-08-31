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
  ".claude/settings.json",
];

const claudeEntrypoint = "CLAUDE.md";

// 백틱 경로를 검사할 문서. 필수 문서에 더해 docs/agent/ 아래 전부를 본다.
const referenceDocuments = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/development/BRANCH_WORKFLOW.md",
  ".agents/pm/AGENT.md",
  ".agents/employee/AGENT.md",
  ".agents/reviewer/AGENT.md",
];

// 저장소 루트 기준으로 해석하는 접두사. 이 중 하나로 시작하거나 확장자가 있어야 경로로 본다.
const rootPrefixes = [
  ".agents/",
  ".claude/",
  ".github/",
  "app/",
  "docs/",
  "e2e/",
  "lib/",
  "scripts/",
];

// 저장소 상태로 판정할 수 없어 검사하지 않는 토큰.
// - node_modules/: 의존성 설치 산출물이다. 설치 여부에 따라 결과가 흔들린다.
// - .work-cycles/: 작업 사이클이 만드는 로컬 상태 디렉터리이며 커밋하지 않는다.
const ignoredTokens = ["node_modules/", ".work-cycles/"];

async function exists(relativePath) {
  try {
    await access(path.join(repositoryRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function isPathLike(token) {
  if (!token.includes("/")) return false;
  if (ignoredTokens.some((ignored) => token.startsWith(ignored))) return false;
  if (token.startsWith("@")) return false; // 패키지 이름·경로 별칭
  if (token.includes(" ")) return false; // 명령어
  if (token.includes("*")) return false; // 글롭
  if (token.includes("<") || token.includes(">")) return false; // 자리표시자
  if (/^https?:/.test(token)) return false;

  // 확장자가 있는 파일 경로이거나, 루트 접두사로 시작하고 슬래시로 끝나는 디렉터리만 본다.
  // 이 조건이 없으면 `feat/추천-엔진` 같은 브랜치 이름 예시가 경로로 잡힌다.
  const hasRootPrefix = rootPrefixes.some((prefix) => token.startsWith(prefix));
  const hasExtension = /\.[a-z0-9]+$/i.test(token);
  return hasExtension || (hasRootPrefix && token.endsWith("/"));
}

async function collectReferenceDocuments() {
  const documents = [...referenceDocuments];
  const agentDocumentDirectory = "docs/agent";

  for (const entry of (await readdir(path.join(repositoryRoot, agentDocumentDirectory))).sort()) {
    if (entry.endsWith(".md")) {
      documents.push(path.posix.join(agentDocumentDirectory, entry));
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
    if (!(await exists(token.replace(/\/$/, "")))) {
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
