import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../..");
const cycleScript = path.join(repositoryRoot, "scripts/work-cycle.mjs");

function runCycle(...arguments_) {
  return execFileSync(process.execPath, [cycleScript, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function runCycleExpectFailure(...arguments_) {
  try {
    runCycle(...arguments_);
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }

  throw new Error("작업 사이클 명령이 실패해야 합니다.");
}

let taskId;
let statePath;

beforeEach(() => {
  taskId = `cycle-test-${process.pid}-${Date.now()}`;
  statePath = path.join(repositoryRoot, ".work-cycles", `${taskId}.json`);
});

afterEach(async () => {
  await rm(statePath, { force: true });
});

describe("작업 사이클 그래프", () => {
  it("그래프와 검증·독립 리뷰 게이트를 표시한다", () => {
    const output = runCycle("graph");

    expect(output).toContain("context --> plan --> implement --> verify --> review --> handoff");
    expect(output).toContain("검증: npm run verify");
    expect(output).toContain("독립 reviewer 검토");
  });

  it("현재 다음 노드만 완료 처리하고 재작업은 reopen으로 후속 노드를 무효화한다", async () => {
    runCycle("start", taskId);
    runCycle("advance", taskId, "context", "--evidence", "문서 확인");
    runCycle("advance", taskId, "plan", "--evidence", "계획 작성");
    runCycle("advance", taskId, "implement", "--evidence", "구현 완료");

    expect(runCycleExpectFailure("advance", taskId, "context", "--evidence", "재실행")).toContain("현재 완료할 수 있는 노드가 아닙니다");

    runCycle("reopen", taskId, "implement", "--evidence", "수정 필요");
    const state = JSON.parse(await readFile(statePath, "utf8"));

    expect(state.stages.implement.status).toBe("pending");
    expect(state.stages.verify.status).toBe("pending");
  });

  it("기존 작업 ID 덮어쓰기와 다른 브랜치에서의 진행을 막는다", async () => {
    runCycle("start", taskId);

    expect(runCycleExpectFailure("start", taskId)).toContain("이미 있습니다");

    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.branch = "other-branch";
    await writeFile(statePath, JSON.stringify(state));

    expect(runCycleExpectFailure("status", taskId)).toContain("브랜치에서만 진행할 수 있습니다");
  });
});
