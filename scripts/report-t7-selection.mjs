/**
 * T7-5 선정 비교 표 생성.
 *
 * 입력: `enhancement-t7-comparison.test.ts`가 `T7_OUT`으로 덤프한 JSON.
 *   T7_OUT=/tmp/t7.json npx jest enhancement-t7-comparison --runInBand
 *   node scripts/report-t7-selection.mjs /tmp/t7.json [--md]
 * 출력: 48개 입력별 interest/easy/relaxed 후보의 구간·관심사별 시설/유형/보조 근거·
 *   왕복/현지시간·실제 배치 장소. 외부 호출 0. 결정적.
 */
import { readFileSync } from "node:fs";

const [path, flag] = process.argv.slice(2);
if (!path) {
  console.error("usage: report-t7-selection.mjs <t7-dump.json> [--md]");
  process.exit(1);
}
const rows = JSON.parse(readFileSync(path, "utf8"));
const md = flag === "--md";

const bandName = ["보통", "충실", "매우 충실"];
const cell = (c) => {
  const per = Object.entries(c.perInterest)
    .map(
      ([k, v]) =>
        `${k} 시설${v.facilities}·유형${v.types}·연결${v.matchedCentral}`,
    )
    .join(" / ");
  const places = c.placedTitles.slice(0, 4).join(", ");
  return `**${c.role}** ${c.displayName} · 구간 ${bandName[c.fitBand] ?? c.fitBand}(avg ${
    c.fitAverage?.toFixed(1) ?? "-"
  }) · 왕복 ${c.roundTripMinutes}분 · 현지자유 ${c.localFreeMinutes}분 · 보조연결 ${
    c.matchedFacilityCount ?? "-"
  }<br>${per}<br>배치: ${places || "-"}`;
};

const rt = [];
const bandCount = [0, 0, 0];
let far = 0;

for (const r of rows) {
  console.log(`\n## ${r.origin} · ${r.interests} · ${r.time}\n`);
  if (r.kind !== "success") {
    console.log(`- ${r.kind}: ${r.message ?? ""}`);
    continue;
  }
  const interest = r.candidates.find((c) => c.role === "interest");
  rt.push(interest.roundTripMinutes);
  bandCount[interest.fitBand ?? 0]++;
  if (interest.roundTripMinutes > 240) far++;
  if (md) {
    console.log("| 역할 | 후보 |");
    console.log("| --- | --- |");
    for (const c of r.candidates) console.log(`| ${c.role} | ${cell(c)} |`);
  } else {
    for (const c of r.candidates)
      console.log(`- ${cell(c).replace(/<br>/g, " | ")}`);
  }
}

rt.sort((a, b) => a - b);
console.log(`\n---\n## 요약`);
console.log(`- 성공 셀: ${rows.filter((r) => r.kind === "success").length}`);
console.log(
  `- \`interest\` 왕복시간 min/중앙/max: ${rt[0]} / ${rt[Math.floor(rt.length / 2)]} / ${rt[rt.length - 1]}분`,
);
console.log(`- \`interest\` 왕복 > 240분 셀: ${far}`);
console.log(
  `- \`interest\` 구간 분포: 보통 ${bandCount[0]} · 충실 ${bandCount[1]} · 매우 충실 ${bandCount[2]}`,
);
