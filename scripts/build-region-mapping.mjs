#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const TOUR_API_BASE_URL = "https://apis.data.go.kr/B551011/KorService2";
const REQUEST_TIMEOUT_MS = 20_000;

function serviceKey() {
  const value = process.env.TOUR_API_SERVICE_KEY;
  if (!value) throw new Error("TOUR_API_SERVICE_KEY가 설정되지 않았습니다.");
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function asList(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

async function requestLegalCodePage(pageNo) {
  const url = new URL(`${TOUR_API_BASE_URL}/ldongCode2`);
  url.search = new URLSearchParams({
    serviceKey: serviceKey(),
    MobileOS: "ETC",
    MobileApp: "DURUDURU_MVP",
    _type: "json",
    numOfRows: "1000",
    pageNo: String(pageNo),
    lDongListYn: "Y",
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ldongCode2: HTTP ${response.status}`);
  const payload = await response.json();
  const header = payload?.response?.header;
  if (header?.resultCode !== "0000") {
    throw new Error(
      `ldongCode2: ${header?.resultCode ?? "unknown"} ${header?.resultMsg ?? "응답을 확인할 수 없습니다."}`,
    );
  }
  return {
    items: asList(payload?.response?.body?.items?.item),
    totalCount: Number(payload?.response?.body?.totalCount ?? 0),
  };
}

async function requestLegalCodes() {
  const first = await requestLegalCodePage(1);
  const pageCount = Math.ceil(first.totalCount / 1_000);
  const codes = [...first.items];
  for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) {
    const page = await requestLegalCodePage(pageNo);
    codes.push(...page.items);
  }
  return codes;
}

function normalizedProvince(value) {
  return String(value ?? "")
    .replaceAll("강원도", "강원특별자치도")
    .replaceAll("전라북도", "전북특별자치도")
    .replaceAll("광주광역시", "전남광주통합특별시")
    .replaceAll("전라남도", "전남광주통합특별시")
    .replace(/\s+/gu, "")
    .trim();
}

function normalizedDistrict(province, district) {
  const normalized = String(district ?? "")
    .replace(/\s+/gu, "")
    .trim();
  return normalizedProvince(province) === "세종특별자치시" &&
    normalized === "세종시"
    ? "세종특별자치시"
    : normalized;
}

function keyFor(province, district) {
  return `${normalizedProvince(province)}|${normalizedDistrict(province, district)}`;
}

const outputPath = process.argv[2] ?? "data/region-mapping.json";
if (process.argv.length > 3) {
  throw new Error("사용법: npm run build:region-mapping [-- 출력.json]");
}

const timeTable = JSON.parse(
  await readFile("data/ktdb/interregional-travel-times-2024.json", "utf8"),
);
if (!Array.isArray(timeTable.regions) || timeTable.regions.length !== 252) {
  throw new Error("KTDB 252존 시간 테이블을 읽지 못했습니다.");
}

const codesByName = new Map();
for (const code of await requestLegalCodes()) {
  const province = String(code.lDongRegnNm ?? "");
  const district = String(code.lDongSignguNm ?? "");
  const regionCode = String(code.lDongRegnCd ?? "");
  const signguCode = String(code.lDongSignguCd ?? "");
  if (!province || !district || !regionCode || !signguCode) continue;
  const key = keyFor(province, district);
  const records = codesByName.get(key) ?? [];
  records.push({ province, district, regionCode, signguCode });
  codesByName.set(key, records);
}

const mappings = [];
const review = [];
for (const zone of timeTable.regions) {
  const matches = codesByName.get(keyFor(zone.province, zone.district)) ?? [];
  if (matches.length === 1) {
    const [match] = matches;
    mappings.push({
      regionId: zone.id,
      name: zone.name,
      province: zone.province,
      district: zone.district,
      lDongRegnCd: match.regionCode,
      lDongSignguCd: match.signguCode,
      lDongRegnNm: match.province,
      lDongSignguNm: match.district,
    });
  } else {
    review.push({
      regionId: zone.id,
      name: zone.name,
      reason: matches.length === 0 ? "no-exact-match" : "ambiguous-match",
      matches,
    });
  }
}

const output = {
  schemaVersion: 1,
  source: {
    ktdb: "data/ktdb/interregional-travel-times-2024.json",
    tourApi: "KorService2/ldongCode2",
  },
  generatedAt: new Date().toISOString(),
  mappings,
  review,
};

await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(
  `지역 매핑 ${mappings.length}개, 검토 필요 ${review.length}개를 ${outputPath}에 생성했습니다.`,
);
