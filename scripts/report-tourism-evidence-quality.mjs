/**
 * T6 품질 보고 — 전국 지역별 (프로필 원천 건수 / 중심 허브 건수 / 연결 matched 건수).
 *
 * 외부 호출 0. `data/region-profiles.json`·`data/central-attractions.json`·
 * `data/tourism-evidence.json` 정상본만 읽어 표를 만든다. 특정 도시 순위를 통과
 * 조건으로 하드코딩하지 않는다. `--md`면 마크다운 표, 아니면 요약만 출력한다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

const evidence = read("data/tourism-evidence.json");
const regions = Object.values(evidence.regions);

const SAMPLE = {
  "ktdb-zone-154": "공주시",
  "ktdb-zone-171": "익산시",
  "ktdb-zone-122": "강릉시(참고: 출발지)",
  "ktdb-zone-97": "과천시",
  "ktdb-zone-89": "광명시",
  "ktdb-zone-108": "파주시",
};
// 경주는 origin-regions/evidence에서 zoneId 확인
const gyeongju = regions.find((r) => r.district === "경주시");
if (gyeongju) SAMPLE[gyeongju.regionId] = "경주시";

const totalProfile = regions.reduce(
  (s, r) => s + (r.profileAttractionCount ?? 0),
  0,
);
const totalHub = regions.reduce((s, r) => s + (r.hubCount ?? 0), 0);
const totalMatched = regions.reduce((s, r) => s + (r.matchedCount ?? 0), 0);
const emptyRegions = regions.filter((r) => r.centralStatus === "empty");
const okRegions = regions.filter((r) => r.centralStatus === "ok");

const connRate = (r) => (r.hubCount ? r.matchedCount / r.hubCount : null);

console.log("## 전국 집계");
console.log(
  `- 지역 수: ${regions.length} (중심 ok ${okRegions.length} · empty ${emptyRegions.length})`,
);
console.log(`- 프로필 관광지 총합: ${totalProfile}`);
console.log(`- 중심 허브 총합: ${totalHub} (숙박·쇼핑 포함)`);
console.log(
  `- 연결 matched 총합: ${totalMatched} · 전체 연결률 ${(totalMatched / totalHub).toFixed(3)}`,
);
console.log(
  `- ok 지역만의 연결률: ${(totalMatched / okRegions.reduce((s, r) => s + r.hubCount, 0)).toFixed(3)}`,
);

const rates = okRegions.map(connRate).sort((a, b) => a - b);
const q = (p) => rates[Math.floor(p * (rates.length - 1))];
console.log(
  `- ok 지역 연결률 분포 p10/p50/p90: ${q(0.1).toFixed(2)} / ${q(0.5).toFixed(2)} / ${q(0.9).toFixed(2)}`,
);

console.log("\n## no-central-data 28개 지역 (목적 점수 0 처리 대상)");
console.log(
  emptyRegions
    .map((r) => `${r.name}`)
    .sort()
    .join(", "),
);
console.log(
  `프로필 관광지는 정상 보유(합 ${emptyRegions.reduce((s, r) => s + r.profileAttractionCount, 0)}). ` +
    `중심 근거만 없어 D4상 목적 점수 0(지역 매력 0 아님).`,
);

console.log("\n## 표본 지역");
console.log(
  "| regionId | 지역 | 프로필 관광지 | 중심 허브 | matched | 연결률 | 중심상태 |",
);
console.log("| --- | --- | ---: | ---: | ---: | ---: | --- |");
for (const [regionId, label] of Object.entries(SAMPLE)) {
  const r = evidence.regions[regionId];
  if (!r) {
    console.log(`| ${regionId} | ${label} | (없음) | | | | |`);
    continue;
  }
  const rate = connRate(r);
  console.log(
    `| ${regionId} | ${label} | ${r.profileAttractionCount} | ${r.hubCount} | ${r.matchedCount} | ${rate === null ? "-" : rate.toFixed(2)} | ${r.centralStatus} |`,
  );
}

if (process.argv.includes("--md")) {
  console.log("\n## 전국 전체 표 (연결률 오름차순)");
  console.log("| 지역 | 프로필 | 허브 | matched | 연결률 | 중심 |");
  console.log("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const r of [...regions].sort(
    (a, b) => (connRate(a) ?? -1) - (connRate(b) ?? -1),
  )) {
    const rate = connRate(r);
    console.log(
      `| ${r.name} | ${r.profileAttractionCount} | ${r.hubCount} | ${r.matchedCount} | ${rate === null ? "-" : rate.toFixed(2)} | ${r.centralStatus} |`,
    );
  }
}
