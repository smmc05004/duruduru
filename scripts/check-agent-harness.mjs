import { access, readFile } from "node:fs/promises";
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
];

const claudeEntrypoint = "CLAUDE.md";

async function exists(relativePath) {
  try {
    await access(path.join(repositoryRoot, relativePath));
    return true;
  } catch {
    return false;
  }
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

if (missingSources.length > 0 || missingImports.length > 0) {
  if (missingSources.length > 0) {
    console.error("필수 에이전트 문서가 없습니다:");
    missingSources.forEach((source) => console.error(`- ${source}`));
  }

  if (missingImports.length > 0) {
    console.error("CLAUDE.md가 참조하는 문서가 없습니다:");
    missingImports.forEach((source) => console.error(`- ${source}`));
  }

  process.exitCode = 1;
} else {
  console.log(`에이전트 하네스 검사 통과: 필수 문서 ${requiredSources.length}개, Claude 참조 ${importedSources.length}개`);
}
