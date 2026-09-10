import { readFile, writeFile } from "node:fs/promises";
const read = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const mapping = await read("../data/region-mapping.json");
const times = await read("../data/ktdb/interregional-travel-times-2024.json");
const zones = new Map(times.regions.map((region, index) => [region.id, index]));
const regions = mapping.mappings
  .filter((row) => zones.has(row.regionId))
  .map((row) => ({
    id: row.regionId,
    zoneId: row.regionId,
    label: row.province === "세종특별자치시" ? row.province : row.name,
    province: row.province,
    district: row.district,
    aliases: [
      ...new Set([row.name, `${row.lDongRegnNm} ${row.lDongSignguNm}`]),
    ],
    supported: times.minutes[zones.get(row.regionId)].some(
      (value) => Number.isFinite(value) && value > 0,
    ),
  }));
await writeFile(
  new URL("../data/origin-regions.json", import.meta.url),
  JSON.stringify(
    {
      schemaVersion: 1,
      mappingGeneratedAt: mapping.generatedAt,
      networkYear: 2024,
      regions,
      excluded: mapping.review.map((row) => ({
        id: row.regionId,
        label: row.name,
        reason: row.reason,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `출발 지역 ${regions.length}개, 검토 제외 ${mapping.review.length}개`,
);
