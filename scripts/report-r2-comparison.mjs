/**
 * R2 오프라인 대안 비교 표 생성.
 *
 * 입력: `lib/__tests__/enhancement-r2-comparison.test.ts`가 `R2_OUT`/`R2_OUT_FOCUS`로
 * 덤프한 JSON.
 *   R2_OUT=/tmp/r2-matrix.json R2_OUT_FOCUS=/tmp/r2-focus.json \
 *     npx jest enhancement-r2-comparison --runInBand
 *   node scripts/report-r2-comparison.mjs /tmp/r2-matrix.json /tmp/r2-focus.json [--md]
 *
 * 출력: 48개 입력 매트릭스의 대안별 interest/relaxed 요약 통계, 셀별 전/후 표,
 * R1 지정 6개 지역의 대안별 순위 표. 외부 호출 0. 결정적.
 */
import { readFileSync } from "node:fs";

const [matrixPath, focusPath, flag] = process.argv.slice(2);
if (!matrixPath || !focusPath) {
  console.error(
    "usage: report-r2-comparison.mjs <matrix-dump.json> <focus-dump.json> [--md]",
  );
  process.exit(1);
}
const md = flag === "--md";
const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
const focus = JSON.parse(readFileSync(focusPath, "utf8"));

const ALTS = [
  "baseline",
  "alt1ScoreReintroduced",
  "alt2BestHubBounded",
  "alt3RaisedCaps",
  "alt4FarRelaxed",
  "alt5Combined",
];
const ALT_LABEL = {
  baseline: "기준선(배포)",
  alt1ScoreReintroduced: "대안1 평균점수 재도입",
  alt2BestHubBounded: "대안2 단일최고순위",
  alt3RaisedCaps: "대안3 상한상향(6/4)",
  alt4FarRelaxed: "대안4 relaxed=최장거리",
  alt5Combined: "대안5 (2+4) 조합",
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? null,
    median: percentile(sorted, 0.5),
    max: sorted[sorted.length - 1] ?? null,
  };
}

console.log(`# R2 오프라인 대안 비교 결과\n`);

console.log(`## 48개 입력 매트릭스 — 역할별 집계 (전체 ${matrix.length}셀)\n`);
if (md) {
  console.log(
    "| 대안 | interest 왕복 min/중앙/max | interest 왕복>240분 | interest 광역시그룹픽 | relaxed 왕복 min/중앙/max | relaxed 왕복>240분 | relaxed 현지자유 min/중앙 |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
}
for (const alt of ALTS) {
  const rows = matrix.filter((r) => r.candidateCount > 0 && r[alt]);
  const interestRt = stats(rows.map((r) => r[alt].interest.roundTripMinutes));
  const interestFar = rows.filter(
    (r) => r[alt].interest.roundTripMinutes > 240,
  ).length;
  const interestMetro = rows.filter(
    (r) => r[alt].interest.isMetropolitanGroup,
  ).length;
  const relaxedRt = stats(rows.map((r) => r[alt].relaxed.roundTripMinutes));
  const relaxedFar = rows.filter(
    (r) => r[alt].relaxed.roundTripMinutes > 240,
  ).length;
  const relaxedFree = stats(rows.map((r) => r[alt].relaxed.localFreeMinutes));
  if (md)
    console.log(
      `| ${ALT_LABEL[alt]} | ${interestRt.min}/${interestRt.median}/${interestRt.max} | ${interestFar}/${rows.length} | ${interestMetro}/${rows.length} | ${relaxedRt.min}/${relaxedRt.median}/${relaxedRt.max} | ${relaxedFar}/${rows.length} | ${relaxedFree.min}/${relaxedFree.median} |`,
    );
  else
    console.log(
      `- ${ALT_LABEL[alt]}: interest 왕복 ${interestRt.min}/${interestRt.median}/${interestRt.max}분, >240분 ${interestFar}/${rows.length}, 광역시픽 ${interestMetro}/${rows.length} · relaxed 왕복 ${relaxedRt.min}/${relaxedRt.median}/${relaxedRt.max}분, >240분 ${relaxedFar}/${rows.length}, 현지자유 min/중앙 ${relaxedFree.min}/${relaxedFree.median}분`,
    );
}

console.log(`\n## 48개 셀 전체 — interest 역할 전/후 (기준선 vs 각 대안)\n`);
if (md) {
  console.log(
    "| 출발 | 관심사 | 시간 | 기준선 | 대안1 | 대안2 | 대안3 | 대안4 | 대안5 |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of matrix) {
    if (!r.candidateCount) continue;
    const cell = (alt) =>
      `${r[alt].interest.displayName}(${r[alt].interest.roundTripMinutes}분)`;
    console.log(
      `| ${r.origin} | ${r.interests} | ${r.time} | ${cell("baseline")} | ${cell("alt1ScoreReintroduced")} | ${cell("alt2BestHubBounded")} | ${cell("alt3RaisedCaps")} | ${cell("alt4FarRelaxed")} | ${cell("alt5Combined")} |`,
    );
  }
} else {
  for (const r of matrix) {
    if (!r.candidateCount) continue;
    console.log(
      `- ${r.origin}·${r.interests}·${r.time}: 기준선 ${r.baseline.interest.displayName}(${r.baseline.interest.roundTripMinutes}분) / 대안1 ${r.alt1ScoreReintroduced.interest.displayName}(${r.alt1ScoreReintroduced.interest.roundTripMinutes}분) / 대안2 ${r.alt2BestHubBounded.interest.displayName}(${r.alt2BestHubBounded.interest.roundTripMinutes}분) / 대안3 ${r.alt3RaisedCaps.interest.displayName}(${r.alt3RaisedCaps.interest.roundTripMinutes}분)`,
    );
  }
}

console.log(`\n## 48개 셀 전체 — relaxed 역할 전/후 (기준선 vs 대안4/5)\n`);
if (md) {
  console.log(
    "| 출발 | 관심사 | 시간 | 기준선 relaxed | 대안4 relaxed | 대안4 현지자유(분) | 대안4 보조연결 |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of matrix) {
    if (!r.candidateCount) continue;
    const b = r.baseline.relaxed;
    const a = r.alt4FarRelaxed.relaxed;
    console.log(
      `| ${r.origin} | ${r.interests} | ${r.time} | ${b.displayName}(${b.roundTripMinutes}분) | ${a.displayName}(${a.roundTripMinutes}분) | ${a.localFreeMinutes} | ${a.matchedFacilityCount} |`,
    );
  }
}

console.log(
  `\n## R1 지정 6개 지역 — 대안별 순위 (서울·역사·주간, 전체 ${focus.candidateCount}개 후보 중)\n`,
);
if (md) {
  console.log(
    "| 지역 | 기준선 interest | 대안1 | 대안2 | 대안3 | 기준선 relaxed | 대안4 relaxed | 대안5 relaxed |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
}
const labels = Object.keys(focus.focus.baseline);
for (const label of labels) {
  const f = (alt, field) => focus.focus[alt][label][field];
  if (md)
    console.log(
      `| ${label} | ${f("baseline", "interestRank")} | ${f("alt1ScoreReintroduced", "interestRank")} | ${f("alt2BestHubBounded", "interestRank")} | ${f("alt3RaisedCaps", "interestRank")} | ${f("baseline", "relaxedRank")} | ${f("alt4FarRelaxed", "relaxedRank")} | ${f("alt5Combined", "relaxedRank")} |`,
    );
  else
    console.log(
      `- ${label}: interest 순위 기준선 ${f("baseline", "interestRank")} → 대안1 ${f("alt1ScoreReintroduced", "interestRank")} / 대안2 ${f("alt2BestHubBounded", "interestRank")} / 대안3 ${f("alt3RaisedCaps", "interestRank")} · relaxed 순위 기준선 ${f("baseline", "relaxedRank")} → 대안4 ${f("alt4FarRelaxed", "relaxedRank")}`,
    );
}
