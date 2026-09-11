/**
 * 결함 1·2 를 **실제 CLI 프로세스 경로**로 검증한다. 메모리 객체 재사용이 아니라
 * `child_process` 로 `scripts/build-region-profile.mjs`·`scripts/build-central-attractions.mjs`
 * 를 직접 돌리고, 통제된 fetch(`scripts/test-support/scenario-fetch.mjs`)를
 * `DURUDURU_TEST_FETCH_MODULE` 로 주입한다.
 *
 *  T1(중심) — 정상 1·2페이지 저장 후 3페이지에서 하드 크래시 → 재실행 시 3페이지부터,
 *             fetch 로그로 1·2 미호출 확인, 최종 data/*.json 교체, 실패 중 정상본 보존.
 *  T2(중심) — 총건수 드리프트로 단위 재시작 → 폐기 상태가 즉시 디스크에 반영되고,
 *             재실행이 폐기 페이지를 재사용하지 않고 1페이지부터 다시 받는다.
 *  T3(프로필) — ID 누락 페이지는 체크포인트에 저장되지 않고, --resume 에서 정상 응답으로
 *             복구된 뒤 --promote 로 정상본이 교체된다.
 */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const profileScript = path.join(repoRoot, "scripts/build-region-profile.mjs");
const centralScript = path.join(
  repoRoot,
  "scripts/build-central-attractions.mjs",
);
const fetchFixture = path.join(
  repoRoot,
  "scripts/test-support/scenario-fetch.mjs",
);

let ws;

beforeEach(() => {
  ws = mkdtempSync(path.join(os.tmpdir(), "collector-cli-"));
  mkdirSync(path.join(ws, "data"), { recursive: true });
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

const dataPath = (name) => path.join(ws, "data", name);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

function logEntries(logFile, fromLine = 0) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(fromLine)
    .map((l) => JSON.parse(l));
}
const lineCount = (logFile) =>
  existsSync(logFile)
    ? readFileSync(logFile, "utf8").split("\n").filter(Boolean).length
    : 0;

function runCli(script, args, { scenario, logFile }) {
  const env = {
    ...process.env,
    TOUR_API_SERVICE_KEY: "decoded-test-key",
    CENTRAL_ATTRACTION_API_SERVICE_KEY: "decoded-test-key",
    DURUDURU_TEST_FETCH_MODULE: fetchFixture,
    DURUDURU_TEST_FETCH_SCENARIO: scenario,
    DURUDURU_TEST_FETCH_LOG: logFile,
  };
  try {
    const stdout = execFileSync(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        script,
        ...args,
      ],
      { cwd: ws, env, encoding: "utf8", stdio: "pipe" },
    );
    return { ok: true, code: 0, out: stdout };
  } catch (error) {
    return {
      ok: false,
      code: error.status ?? null,
      out: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

// ---- 매핑·시나리오 빌더 ------------------------------------------------

function centralMappings() {
  const districts = [
    "공주시",
    "익산시",
    "경주시",
    "과천시",
    "광명시",
    "파주시",
  ];
  const mappings = [];
  for (let i = 0; i < 216; i += 1) {
    const sig = String(150 + i); // 3자리, "150".. — "12" 스킴 회피
    const district = districts[i] ?? `더미${i}시`;
    mappings.push({
      regionId: `ktdb-zone-${i}`,
      name: `충청남도 ${district}`,
      province: "충청남도",
      district,
      lDongRegnCd: "44",
      lDongSignguCd: sig,
    });
  }
  return { generatedAt: "2026-09-10T00:00:00.000Z", mappings };
}

const GONGJU_SIGNGU = "44150"; // regionId ktdb-zone-0

function centralScenario({ gongjuOverrides }) {
  return {
    keyBy: "signguCd",
    pageSize: 100,
    units: {
      [GONGJU_SIGNGU]: {
        paginate: {
          total: 250,
          idPrefix: "g",
          idField: "hubTatsCd",
          fields: {
            hubTatsNm: "곳",
            hubRank: "$n1",
            hubCtgryLclsNm: "관광지",
            mapX: "127.1",
            mapY: "36.4",
          },
          prependPage1: [
            {
              hubTatsCd: "cd-gongsan",
              hubTatsNm: "공산성",
              hubRank: "2",
              hubCtgryLclsNm: "관광지",
              mapX: "127.1",
              mapY: "36.4",
            },
          ],
          pageOverrides: gongjuOverrides ?? {},
        },
      },
      "*": {
        paginate: {
          total: 35,
          idPrefix: "h",
          idField: "hubTatsCd",
          fields: {
            hubTatsNm: "곳",
            hubRank: "$n1",
            hubCtgryLclsNm: "관광지",
            mapX: "127.0",
            mapY: "36.5",
          },
        },
      },
    },
  };
}

function profileMappings() {
  const mappings = [];
  const regn = [];
  const signgu = [];
  for (let i = 0; i < 210; i += 1) {
    const sig = String(101 + i);
    regn.push("44");
    signgu.push(sig);
    mappings.push({
      regionId: `ktdb-zone-${i}`,
      name: `권역 ${i}`,
      province: "충청남도",
      district: `시군 ${i}`,
      lDongRegnCd: "44",
      lDongSignguCd: sig,
    });
  }
  return {
    document: { generatedAt: "2026-09-10T00:00:00.000Z", mappings },
    regn,
    signgu,
  };
}

const LANDMARKS = ["125949", "126166", "126207", "127977"];

function profileScenario({ regn, signgu, hsOverrides }) {
  const prependPage1 = LANDMARKS.map((id, i) => ({
    contentid: id,
    title: `명소 ${id}`,
    lclsSystm1: "HS",
    lDongRegnCd: regn[i],
    lDongSignguCd: signgu[i],
  }));
  return {
    keyBy: "profileSpec",
    pageSize: 1000,
    units: {
      "lclsSystm1=HS": {
        paginate: {
          total: 8200,
          idPrefix: "hs",
          idField: "contentid",
          fields: {
            title: "곳",
            lclsSystm1: "HS",
            lDongRegnCd: regn,
            lDongSignguCd: signgu,
          },
          prependPage1,
          pageOverrides: hsOverrides ?? {},
        },
      },
      "*": { pages: { "*": { totalCount: 0, items: [] } } },
    },
  };
}

// ---- T1: 중심 — 하드 크래시 후 재개 --------------------------------------

it("중심 CLI: 3페이지 크래시 → --resume 시 3페이지부터, 1·2 미호출, 정상본 교체·보존", () => {
  writeJson(dataPath("region-mapping.json"), centralMappings());
  writeJson(dataPath("central-attractions.json"), { sentinel: "keep" });
  const logFile = path.join(ws, "central.log");
  const scen1 = path.join(ws, "central-1.json");
  const scen2 = path.join(ws, "central-2.json");
  writeJson(
    scen1,
    centralScenario({ gongjuOverrides: { 3: { crashOnCall: 1 } } }),
  );
  writeJson(scen2, centralScenario({ gongjuOverrides: {} }));

  // 1차: 공주(첫 지역) 3페이지에서 하드 크래시.
  const run1 = runCli(centralScript, [], { scenario: scen1, logFile });
  expect(run1.ok).toBe(false);

  const cp1 = readJson(dataPath("central-attractions.checkpoint.json"));
  const gongju1 = cp1.regions["ktdb-zone-0"];
  expect(gongju1.status).toBe("failed");
  expect(Object.keys(gongju1.pages).sort()).toEqual(["1", "2"]);
  // 실패 중 기존 정상본 보존.
  expect(readJson(dataPath("central-attractions.json"))).toEqual({
    sentinel: "keep",
  });

  // 하드 크래시는 잠금 파일을 남긴다(운영자가 정리하는 상황을 흉내낸다).
  rmSync(dataPath("central-attractions.lock"), { force: true });
  const lineAfter1 = lineCount(logFile);

  // 2차: --resume --promote. 공주 3페이지만 다시 받아야 한다.
  const run2 = runCli(centralScript, ["--resume", "--promote"], {
    scenario: scen2,
    logFile,
  });
  expect(run2.ok).toBe(true);

  const run2Gongju = logEntries(logFile, lineAfter1).filter(
    (e) => e.key === GONGJU_SIGNGU,
  );
  expect(run2Gongju.map((e) => e.pageNo)).toEqual([3]); // 1·2 재호출 없음

  const live = readJson(dataPath("central-attractions.json"));
  expect(live.schemaVersion).toBe(1);
  expect(live.summary.failed).toBe(0);
  expect(live.summary.ok).toBeGreaterThanOrEqual(210);
  const liveGongju = live.regions.find((r) => r.regionId === "ktdb-zone-0");
  expect(liveGongju.status).toBe("ok");
  expect(liveGongju.hubs.some((h) => h.hubTatsName === "공산성")).toBe(true);

  const cp2 = readJson(dataPath("central-attractions.checkpoint.json"));
  expect(cp2.regions["ktdb-zone-0"].status).toBe("ok");
  expect(cp2.regions["ktdb-zone-0"].pages).toBeUndefined();
}, 60000);

// ---- T2: 중심 — 재시작 폐기 상태의 즉시 영속 ---------------------------

it("중심 CLI: 총건수 드리프트 재시작 → 폐기 상태가 디스크에 남고, 재실행이 1페이지부터 다시 받는다", () => {
  writeJson(dataPath("region-mapping.json"), centralMappings());
  writeJson(dataPath("central-attractions.json"), { sentinel: "keep" });
  const logFile = path.join(ws, "central.log");
  const scen1 = path.join(ws, "central-drift.json");
  const scen2 = path.join(ws, "central-fixed.json");
  // 공주 2페이지가 매번 다른 totalCount(240) → 일관성 붕괴 → 재시작 소진.
  writeJson(
    scen1,
    centralScenario({ gongjuOverrides: { 2: { totalCount: 240 } } }),
  );
  writeJson(scen2, centralScenario({ gongjuOverrides: {} }));

  const run1 = runCli(centralScript, [], { scenario: scen1, logFile });
  expect(run1.ok).toBe(false); // 공주 failed → 정상본 교체 차단

  const cp1 = readJson(dataPath("central-attractions.checkpoint.json"));
  const gongju1 = cp1.regions["ktdb-zone-0"];
  expect(gongju1.status).toBe("failed");
  // 재시작으로 폐기된 페이지는 체크포인트에 남지 않는다.
  expect(gongju1.pages ?? {}).toEqual({});
  expect(readJson(dataPath("central-attractions.json"))).toEqual({
    sentinel: "keep",
  });

  const lineAfter1 = lineCount(logFile);
  const run2 = runCli(centralScript, ["--resume", "--promote"], {
    scenario: scen2,
    logFile,
  });
  expect(run2.ok).toBe(true);

  // 폐기된 페이지를 재사용하지 않고 1페이지부터 다시 받았다.
  const run2Gongju = logEntries(logFile, lineAfter1)
    .filter((e) => e.key === GONGJU_SIGNGU)
    .map((e) => e.pageNo);
  expect(run2Gongju).toContain(1);
  expect(run2Gongju).toEqual([1, 2, 3]);

  const live = readJson(dataPath("central-attractions.json"));
  expect(live.summary.failed).toBe(0);
}, 60000);

// ---- T3: 프로필 — ID 누락 페이지 재조회 후 복구 ------------------------

it("프로필 CLI: contentId 누락 페이지는 미저장, --resume 에서 복구되고 --promote 로 교체", () => {
  const { document: mappingDoc, regn, signgu } = profileMappings();
  writeJson(dataPath("region-mapping.json"), mappingDoc);
  writeJson(dataPath("region-profiles.json"), { sentinel: "keep" });
  const logFile = path.join(ws, "profile.log");
  const scen1 = path.join(ws, "profile-hole.json");
  const scen2 = path.join(ws, "profile-clean.json");
  writeJson(
    scen1,
    profileScenario({ regn, signgu, hsOverrides: { 3: { dropIdCount: 1 } } }),
  );
  writeJson(scen2, profileScenario({ regn, signgu, hsOverrides: {} }));

  // 1차: HS 3페이지 한 항목의 contentId 가 비어 있음 → 그 페이지 미저장, 완전성 실패.
  const run1 = runCli(profileScript, [], { scenario: scen1, logFile });
  expect(run1.ok).toBe(false);

  const cp1 = readJson(dataPath("region-profiles.checkpoint.json"));
  const hs1 = cp1.specs["history/new lclsSystm1=HS"];
  expect(hs1.done).toBe(false);
  // 검증 실패한 3페이지만 빠지고 나머지 검증 통과 페이지는 저장된다.
  expect(Object.keys(hs1.pages)).not.toContain("3");
  expect(Object.keys(hs1.pages).sort((a, b) => a - b)).toEqual([
    "1",
    "2",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
  ]);
  expect(readJson(dataPath("region-profiles.json"))).toEqual({
    sentinel: "keep",
  });

  const lineAfter1 = lineCount(logFile);

  // 2차: --resume --promote. HS 3페이지부터 정상 응답으로 복구.
  const run2 = runCli(profileScript, ["--resume", "--promote"], {
    scenario: scen2,
    logFile,
  });
  expect(run2.ok).toBe(true);

  const run2Hs = [
    ...new Set(
      logEntries(logFile, lineAfter1)
        .filter((e) => e.key === "lclsSystm1=HS")
        .map((e) => e.pageNo),
    ),
  ].sort((a, b) => a - b);
  expect(run2Hs).toEqual([3]); // 검증 통과 페이지(1·2·4~9)는 재호출 없음

  const live = readJson(dataPath("region-profiles.json"));
  expect(live.schemaVersion).toBe(2);
  expect(live.profiles.length).toBe(210);
  expect(live.completeness.blockers).toEqual([]);
  const all = live.profiles.flatMap((p) => p.attractions);
  expect(all.length).toBeGreaterThanOrEqual(8000);
  expect(all.some((a) => a.contentId === "125949")).toBe(true);

  const cp2 = readJson(dataPath("region-profiles.checkpoint.json"));
  expect(cp2.specs["history/new lclsSystm1=HS"].done).toBe(true);
}, 90000);
