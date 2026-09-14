/**
 * R1 진단 표 생성.
 *
 * 입력: `lib/__tests__/enhancement-r1-diagnosis.test.ts`가 `R1_OUT`으로 덤프한 JSON.
 *   R1_OUT=/tmp/r1.json npx jest enhancement-r1-diagnosis --runInBand
 *   node scripts/report-r1-diagnosis.mjs /tmp/r1.json [--md]
 * 출력: 고정 진단 입력의 전국 후보 탈락 단계 집계, 실제 최종 3곳, 6개 지정 지역
 * 진단, 목적 적합성 구간 분포, interest 상위 20위. 외부 호출 0. 결정적.
 */
import { readFileSync } from "node:fs";

const [path, flag] = process.argv.slice(2);
if (!path) {
  console.error("usage: report-r1-diagnosis.mjs <r1-dump.json> [--md]");
  process.exit(1);
}
const d = JSON.parse(readFileSync(path, "utf8"));
const md = flag === "--md";

const bandName = ["보통", "충실", "매우 충실"];

console.log(`# R1 진단 결과\n`);
console.log(`입력: ${JSON.stringify(d.input)} · 조회 시각 ${d.searchedAt}\n`);

console.log(`## 전국 후보 탈락 단계 집계\n`);
for (const [stage, count] of Object.entries(d.stageCounts))
  console.log(`- ${stage}: ${count}`);
console.log(`- 시간 적합 통과(candidate) 총계: ${d.candidateCount}\n`);

console.log(`## 실제 최종 3곳 (searchPhaseTwo 실제 출력)\n`);
if (md) {
  console.log("| 역할 | 지역 | 왕복(분) | 구간 | 보조연결 | 배치 장소 |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const c of d.real)
    console.log(
      `| ${c.role} | ${c.displayName} | ${c.roundTripMinutes} | ${bandName[c.fitBand] ?? c.fitBand} | ${c.matchedFacilityCount} | ${c.placed.join(", ")} |`,
    );
} else {
  for (const c of d.real)
    console.log(
      `- ${c.role} · ${c.displayName} · 왕복 ${c.roundTripMinutes}분 · 구간 ${bandName[c.fitBand] ?? c.fitBand} · 배치 ${c.placed.join(", ")}`,
    );
}

console.log(
  `\n## 목적 적합성 구간 분포 (전체 ${d.candidateCount}개 시간 적합 후보)\n`,
);
const byBand = { 0: [], 1: [], 2: [] };
for (const c of d.allCandidates) byBand[c.fitBand].push(c);
for (const b of [0, 1, 2]) {
  const arr = byBand[b].sort((x, y) => x.roundTripMinutes - y.roundTripMinutes);
  const rts = arr.map((c) => c.roundTripMinutes);
  console.log(
    `- 구간 ${bandName[b]}: ${arr.length}개 (${((arr.length / d.candidateCount) * 100).toFixed(0)}%)` +
      (rts.length
        ? ` · 왕복 min/중앙/max = ${rts[0]}/${rts[Math.floor(rts.length / 2)]}/${rts[rts.length - 1]}분`
        : ""),
  );
}

console.log(`\n## 지정 6개 지역 진단\n`);
if (md) {
  console.log(
    "| 지역 | 단계 | 왕복(분) | 구간 | fitAverage | 보조연결 | interest 순위 | easy 순위 | relaxed 순위 | 배치 장소 |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
}
for (const [label, info] of Object.entries(d.focus)) {
  const row = info.row;
  if (row.stage !== "candidate") {
    console.log(
      md
        ? `| ${label} | ${row.stage} | - | - | - | - | - | - | - | - |`
        : `- ${label}: ${row.stage}`,
    );
    continue;
  }
  const placed = row.placed.map((p) => p.title).join(", ");
  if (md)
    console.log(
      `| ${label} | candidate(${d.candidateCount}개 중) | ${row.roundTripMinutes} | ${bandName[row.fitBand]} | ${row.purpose.fitAverage} | ${row.matchedFacilityCount} | ${info.ranks.interest} | ${info.ranks.easy} | ${info.ranks.relaxed} | ${placed} |`,
    );
  else
    console.log(
      `- ${label}: 왕복 ${row.roundTripMinutes}분 · 구간 ${bandName[row.fitBand]}(avg ${row.purpose.fitAverage}) · 보조연결 ${row.matchedFacilityCount} · 순위(interest/easy/relaxed) ${info.ranks.interest}/${info.ranks.easy}/${info.ranks.relaxed} of ${d.candidateCount} · 배치: ${placed}`,
    );
}

console.log(`\n## interest 역할 정렬 상위 20위\n`);
if (md) {
  console.log("| 순위 | 지역 | 왕복(분) | 구간 | 보조연결 | 충족 |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  d.interestRankedTop20.forEach((c, i) =>
    console.log(
      `| ${i + 1} | ${c.displayName} | ${c.roundTripMinutes} | ${bandName[c.fitBand]} | ${c.matchedFacilityCount} | ${c.fulfilledInterestCount} |`,
    ),
  );
} else {
  d.interestRankedTop20.forEach((c, i) =>
    console.log(
      `${i + 1}. ${c.displayName} · 왕복 ${c.roundTripMinutes}분 · 구간 ${bandName[c.fitBand]} · 보조연결 ${c.matchedFacilityCount}`,
    ),
  );
}
