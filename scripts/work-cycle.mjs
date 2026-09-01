import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 기본값은 이 스크립트가 속한 저장소다. WORK_CYCLE_ROOT 는 테스트가 임시 저장소를
// 대상으로 명령을 실행하기 위한 것이다. 사이클 게이트는 현재 git 브랜치를 근거로
// 판정하므로, 이 통로가 없으면 테스트 결과가 테스트를 돌리는 브랜치에 따라 달라진다.
const repositoryRoot = process.env.WORK_CYCLE_ROOT
  ? path.resolve(process.env.WORK_CYCLE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDirectory = path.join(repositoryRoot, ".work-cycles");

const stages = [
  { id: "context", label: "컨텍스트 확인", requires: [] },
  { id: "plan", label: "작업 계획", requires: ["context"] },
  { id: "implement", label: "구현", requires: ["plan"] },
  { id: "verify", label: "검증", requires: ["implement"] },
  { id: "review", label: "독립 리뷰", requires: ["verify"] },
  { id: "handoff", label: "커밋·PR 인계", requires: ["review"] },
];

function usage() {
  console.log(`사용법:
  npm run cycle -- graph
  npm run cycle -- start <작업-id>
  npm run cycle -- status <작업-id>
  npm run cycle -- advance <작업-id> <context|plan|implement|review|handoff> --evidence <근거>
  npm run cycle -- verify <작업-id> [--e2e]
  npm run cycle -- reopen <작업-id> <노드> --evidence <재작업 사유>`);
}

function currentBranch() {
  return execFileSync("git", ["branch", "--show-current"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function validateTaskId(taskId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(taskId ?? "")) {
    throw new Error(
      "작업 ID는 영문 소문자, 숫자, 하이픈만 사용한 케밥 표기여야 합니다.",
    );
  }
}

function statePath(taskId) {
  validateTaskId(taskId);
  return path.join(stateDirectory, `${taskId}.json`);
}

async function loadState(taskId) {
  const contents = await readFile(statePath(taskId), "utf8");
  return JSON.parse(contents);
}

async function stateExists(taskId) {
  try {
    await readFile(statePath(taskId), "utf8");
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function saveState(state) {
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(statePath(state.id), `${JSON.stringify(state, null, 2)}\n`);
}

function nextStage(state) {
  return stages.find((stage) => state.stages[stage.id].status !== "complete");
}

function assertReady(state, stage) {
  const incomplete = stage.requires.filter(
    (required) => state.stages[required].status !== "complete",
  );

  if (incomplete.length > 0) {
    throw new Error(
      `${stage.label} 단계의 선행 조건이 완료되지 않았습니다: ${incomplete.join(", ")}`,
    );
  }
}

function assertCurrentStage(state, stage) {
  const next = nextStage(state);

  if (!next || next.id !== stage.id) {
    throw new Error(
      `현재 완료할 수 있는 노드가 아닙니다. 다음 노드: ${next?.id ?? "없음"}`,
    );
  }
}

function assertStateBranch(state) {
  const branch = currentBranch();

  if (branch !== state.branch) {
    throw new Error(
      `작업 사이클은 ${state.branch} 브랜치에서만 진행할 수 있습니다. 현재 브랜치: ${branch || "detached HEAD"}`,
    );
  }
}

function completeStage(state, stage, evidence) {
  assertCurrentStage(state, stage);
  assertReady(state, stage);
  state.stages[stage.id] = {
    status: "complete",
    completedAt: new Date().toISOString(),
    evidence,
  };
}

function printGraph() {
  console.log(`작업 사이클 그래프

\`\`\`mermaid
flowchart LR
  context[컨텍스트] --> plan[계획] --> implement[구현] --> verify[검증] --> review[독립 리뷰] --> handoff[커밋·PR]
\`\`\`

context --> plan --> implement --> verify --> review --> handoff

- 검증: npm run verify (필요하면 --e2e로 Playwright 포함)
- 리뷰: 독립 reviewer 검토의 근거를 기록
- 각 노드는 모든 선행 노드가 완료되어야 진행할 수 있습니다.`);
}

function runNpm(script) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npmCommand, ["run", script], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
}

async function main() {
  const [command, taskId, stageId, ...options] = process.argv.slice(2);

  if (command === "graph") {
    printGraph();
    return;
  }

  if (command === "start") {
    validateTaskId(taskId);
    const branch = currentBranch();

    if (!branch || branch === "main") {
      throw new Error(
        "작업 사이클은 main이 아닌 작업 브랜치에서 시작해야 합니다.",
      );
    }

    if (await stateExists(taskId)) {
      throw new Error(
        "같은 작업 ID의 사이클이 이미 있습니다. 재작업은 reopen 명령을 사용하세요.",
      );
    }

    const state = {
      version: 1,
      id: taskId,
      branch,
      createdAt: new Date().toISOString(),
      stages: Object.fromEntries(
        stages.map((stage) => [stage.id, { status: "pending" }]),
      ),
    };

    await saveState(state);
    console.log(`작업 사이클을 시작했습니다: ${taskId} (${branch})`);
    return;
  }

  if (command === "status") {
    const state = await loadState(taskId);
    assertStateBranch(state);
    console.log(`작업: ${state.id} (${state.branch})`);
    stages.forEach((stage) =>
      console.log(`- ${stage.id}: ${state.stages[stage.id].status}`),
    );
    const next = nextStage(state);
    console.log(
      next
        ? `다음 노드: ${next.id} (${next.label})`
        : "모든 노드가 완료되었습니다.",
    );
    return;
  }

  if (command === "advance") {
    const state = await loadState(taskId);
    assertStateBranch(state);
    const stage = stages.find((candidate) => candidate.id === stageId);
    const evidenceIndex = options.indexOf("--evidence");
    const evidence =
      evidenceIndex >= 0 ? options[evidenceIndex + 1] : undefined;

    if (!stage || stage.id === "verify" || !evidence) {
      throw new Error(
        "verify는 verify 명령으로 처리하고, 다른 단계는 --evidence <근거>가 필요합니다.",
      );
    }

    completeStage(state, stage, evidence);
    await saveState(state);
    console.log(`${stage.id} 노드를 완료했습니다.`);
    return;
  }

  if (command === "verify") {
    const state = await loadState(taskId);
    assertStateBranch(state);
    const stage = stages.find((candidate) => candidate.id === "verify");
    assertReady(state, stage);
    runNpm("verify");

    if (options.includes("--e2e")) {
      runNpm("test:e2e");
    }

    completeStage(
      state,
      stage,
      options.includes("--e2e")
        ? "npm run verify, npm run test:e2e"
        : "npm run verify",
    );
    await saveState(state);
    console.log("verify 노드를 완료했습니다.");
    return;
  }

  if (command === "reopen") {
    const state = await loadState(taskId);
    assertStateBranch(state);
    const stage = stages.find((candidate) => candidate.id === stageId);
    const evidenceIndex = options.indexOf("--evidence");
    const evidence =
      evidenceIndex >= 0 ? options[evidenceIndex + 1] : undefined;

    if (!stage || !evidence || state.stages[stage.id].status !== "complete") {
      throw new Error("완료된 노드와 --evidence <재작업 사유>가 필요합니다.");
    }

    const stageIndex = stages.findIndex(
      (candidate) => candidate.id === stage.id,
    );
    stages.slice(stageIndex).forEach((candidate) => {
      state.stages[candidate.id] = {
        status: "pending",
        reopenedAt: new Date().toISOString(),
        evidence,
      };
    });
    await saveState(state);
    console.log(`${stage.id} 노드부터 후속 게이트를 다시 열었습니다.`);
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`작업 사이클 실패: ${error.message}`);
  process.exitCode = 1;
});
