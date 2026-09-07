#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API_URL =
  "https://apis.data.go.kr/1741000/excellent_restaurant_info/info";
const PAGE_SIZE = 100;
const CONCURRENCY = 4;

function key() {
  const value = process.env.EXCELLENT_RESTAURANT_API_SERVICE_KEY;
  if (!value)
    throw new Error(
      "EXCELLENT_RESTAURANT_API_SERVICE_KEY가 설정되지 않았습니다.",
    );
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function list(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

async function page(pageNo) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    serviceKey: key(),
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
    returnType: "json",
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`모범음식점 API: HTTP ${response.status}`);
  const payload = await response.json();
  const header = payload?.response?.header;
  if (header?.resultCode !== "0" && header?.resultCode !== "0000")
    throw new Error(`모범음식점 API: ${header?.resultCode ?? "unknown"}`);
  return {
    items: list(payload?.response?.body?.items?.item),
    total: Number(payload?.response?.body?.totalCount ?? 0),
  };
}

function text(value) {
  return String(value ?? "").trim();
}
function normalized(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/gu, "");
}
function active(item) {
  return (
    item.SALS_STTS_CD === "01" &&
    !text(item.CLSBIZ_YMD) &&
    !text(item.DSGN_RTRCN_YMD)
  );
}

const outputPath =
  process.argv[2] ?? "data/excellent-restaurant-certifications.json";
const first = await page(1);
const pages = Math.ceil(first.total / PAGE_SIZE);
if (pages > 800)
  throw new Error(`필요 요청 ${pages}회가 안전 한도 800회를 넘습니다.`);
const records = [...first.items];
for (let start = 2; start <= pages; start += CONCURRENCY) {
  const batch = await Promise.all(
    Array.from(
      { length: Math.min(CONCURRENCY, pages - start + 1) },
      (_, index) => page(start + index),
    ),
  );
  for (const result of batch) records.push(...result.items);
}

const unique = new Map();
for (const item of records) {
  if (!active(item)) continue;
  const name = text(item.BSNSSP_NM),
    roadAddress = text(item.ROAD_NM_ADDR),
    lotAddress = text(item.LCTN_ADDR);
  if (!name || (!roadAddress && !lotAddress)) continue;
  const row = {
    managementId: text(item.MNG_NO),
    name,
    normalizedName: normalized(name),
    phone: text(item.TELNO).replace(/\D/gu, ""),
    roadAddress,
    normalizedRoadAddress: normalized(roadAddress),
    lotAddress,
    normalizedLotAddress: normalized(lotAddress),
    foodType: text(item.FD_OF_TYPE),
    primaryFood: text(item.PRINC_FD_KND),
    designationDate: text(item.DSGN_YMD),
    updatedAt: text(item.DAT_UPDT_PNT),
  };
  const id =
    row.managementId ||
    `${row.normalizedName}|${row.normalizedRoadAddress}|${row.normalizedLotAddress}`;
  if (!unique.get(id) || unique.get(id).updatedAt < row.updatedAt)
    unique.set(id, row);
}
const output = {
  schemaVersion: 1,
  source: {
    provider: "행정안전부",
    dataset: "모범음식점정보 조회서비스",
    endpoint: "1741000/excellent_restaurant_info/info",
    pageCount: pages,
    totalRecords: records.length,
    activeRule: "SALS_STTS_CD=01 and CLSBIZ_YMD empty and DSGN_RTRCN_YMD empty",
  },
  generatedAt: new Date().toISOString(),
  certifications: [...unique.values()],
};
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(
  `${output.certifications.length}개 유효 모범음식점 인증을 생성했습니다. ${pages}쪽 수집`,
);
