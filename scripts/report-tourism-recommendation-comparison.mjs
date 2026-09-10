/**
 * T6 변경 전/후 비교 표 생성.
 *
 * 입력: `enhancement-t6-comparison.test.ts`가 `T6_OUT`으로 덤프한 두 JSON.
 *   node scripts/report-tourism-recommendation-comparison.mjs <before.json> <after.json>
 * 출력: 마크다운 표(입력별 변경 전/후 후보 3곳·대표 명소·목적 점수·왕복/현지 시간·배제 사유).
 * 외부 호출 0. 결정적.
 */
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: report-...mjs <before.json> <after.json>");
  process.exit(1);
}
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));
const key = (r) => `${r.originId}|${r.interests}|${r.time}`;
const B = new Map(before.map((r) => [key(r), r]));

const cell = (candidate) => {
  const places = candidate.placedAttractions
    .map((a) => a.title)
    .slice(0, 4)
    .join(", ");
  const ps =
    candidate.purposeScore != null
      ? ` · 목적 ${candidate.purposeScore.toFixed(2)}(${candidate.purposeStatus}, 기여 ${candidate.purposeContributingCount})`
      : "";
  return (
    `**${candidate.role}** ${candidate.displayName} · 왕복 ${candidate.roundTripMinutes}분 · 현지자유 ${candidate.localFreeMinutes}분 · 관광 ${candidate.attractionCount}${ps}` +
    `<br>배치 명소: ${places || "-"}`
  );
};

console.log("# T6 변경 전/후 비교 (searchPhaseTwo, 정상본 JSON, 네트워크 0)\n");
console.log(
  "기준 시각 `2026-09-10T00:00Z`. day=`08:00→익일20:00`, night=`18:00→익일20:00`.\n",
);

let unchanged = 0;
let farAfter = 0;
let farBefore = 0;
let total = 0;

for (const a of after) {
  const b = B.get(key(a));
  console.log(`\n## ${a.origin} · 관심사 ${a.interests} · ${a.time}\n`);
  if (a.kind !== "success" || (b && b.kind !== "success")) {
    console.log(`- 변경 전: ${b ? b.kind : "?"} ${b?.message ?? ""}`);
    console.log(`- 변경 후: ${a.kind} ${a.message ?? ""}`);
    continue;
  }
  total++;
  const ai = a.candidates.find((c) => c.role === "interest");
  const bi = b.candidates.find((c) => c.role === "interest");
  if (ai && bi && ai.displayName === bi.displayName) unchanged++;
  if (ai && ai.roundTripMinutes > 240) farAfter++;
  if (bi && bi.roundTripMinutes > 240) farBefore++;

  console.log("| 역할 | 변경 전 | 변경 후 |");
  console.log("| --- | --- | --- |");
  for (const role of ["interest", "easy", "relaxed"]) {
    const bc = b.candidates.find((c) => c.role === role);
    const ac = a.candidates.find((c) => c.role === role);
    console.log(
      `| ${role} | ${bc ? cell(bc) : "-"} | ${ac ? cell(ac) : "-"} |`,
    );
  }
}

console.log(`\n---\n## 요약`);
console.log(`- 성공 셀: ${total}`);
console.log(`- \`interest\` 후보가 그대로인 셀: ${unchanged} / ${total}`);
console.log(
  `- \`interest\` 왕복 > 240분(편도 2h+) 셀: 변경 전 ${farBefore} → 변경 후 ${farAfter}`,
);
