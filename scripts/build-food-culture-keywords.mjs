#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function province(value) {
  return String(value ?? "")
    .replaceAll("강원도", "강원특별자치도")
    .replaceAll("전라북도", "전북특별자치도")
    .replaceAll("광주광역시", "전남광주통합특별시")
    .replaceAll("전라남도", "전남광주통합특별시")
    .replace(/\s+/gu, "")
    .trim();
}

function key(provinceName, districtName) {
  const district = String(districtName ?? "")
    .replace(/\s+/gu, "")
    .trim();
  return `${province(provinceName)}|${province(provinceName) === "세종특별자치시" && district === "세종시" ? "세종특별자치시" : district}`;
}

const [sourcePath, outputPath = "data/food-culture-keywords.json"] =
  process.argv.slice(2);
if (!sourcePath || process.argv.length > 4) {
  throw new Error(
    "사용법: npm run build:food-culture -- <지역N문화.json> [출력.json]",
  );
}

const [source, mapping] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile("data/region-mapping.json", "utf8"),
]);
const records = JSON.parse(source);
const mappings = JSON.parse(mapping).mappings;
if (!Array.isArray(records) || !Array.isArray(mappings)) {
  throw new Error("지역N문화 원본 또는 지역 매핑 형식을 읽지 못했습니다.");
}

const regionIds = new Map(
  mappings.map((row) => [key(row.province, row.district), row.regionId]),
);
const keywordsByRegion = new Map();
for (const record of records) {
  const regionId = regionIds.get(key(record.ctprvn_nm, record.signgu_nm));
  if (!regionId) continue;
  const keywords = keywordsByRegion.get(regionId) ?? new Set();
  for (const keyword of String(record.core_kwrd_cn ?? "").split(/[,·/]/gu)) {
    if (keyword.trim()) keywords.add(keyword.trim());
  }
  keywordsByRegion.set(regionId, keywords);
}

const output = {
  schemaVersion: 1,
  source: {
    provider: "지역N문화",
    dataset: "향토음식과 지역이야기",
    snapshot: "2023-12",
    usage: "지역 향토음식 문화 키워드만 사용; 관련 음식점 필드는 포함하지 않음",
  },
  generatedAt: new Date().toISOString(),
  regions: [...keywordsByRegion].map(([regionId, keywords]) => ({
    regionId,
    keywords: [...keywords].toSorted(),
  })),
};

await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(
  `${output.regions.length}개 지역의 음식 문화 키워드를 생성했습니다.`,
);
