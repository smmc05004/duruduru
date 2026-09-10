#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CLASSIFICATION_VERSION,
  classifyInterests,
} from "../lib/interest-classification.ts";

const TOUR_API_BASE_URL = "https://apis.data.go.kr/B551011/KorService2";
const REQUEST_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 1_000;
const DEFAULT_MAX_REQUESTS = 900;

const categories = [
  { id: "nature", filters: [{ cat1: "A01" }] },
  { id: "history", filters: [{ cat2: "A0201" }] },
  { id: "rest", filters: [{ cat2: "A0202" }] },
  {
    id: "culture",
    filters: [{ cat2: "A0206" }, { contentTypeId: "14" }],
  },
  {
    id: "leisure",
    filters: [{ cat1: "A03" }, { contentTypeId: "28" }],
  },
];

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

function legalKey(regionCode, signguCode) {
  return `${regionCode}|${signguCode}`;
}

const maxRequests = Number(
  process.env.TOUR_API_PROFILE_MAX_REQUESTS ?? DEFAULT_MAX_REQUESTS,
);
if (!Number.isInteger(maxRequests) || maxRequests < 1) {
  throw new Error("TOUR_API_PROFILE_MAX_REQUESTS는 1 이상의 정수여야 합니다.");
}
let requestCount = 0;

async function requestPage(parameters, pageNo) {
  requestCount += 1;
  if (requestCount > maxRequests) {
    throw new Error(
      `TourAPI 지역 프로필 수집 요청이 안전 한도 ${maxRequests}회를 넘었습니다. 출력 파일은 만들지 않았습니다. 운영 키 한도를 확인하거나 수집 범위를 조정하세요.`,
    );
  }

  const url = new URL(`${TOUR_API_BASE_URL}/areaBasedList2`);
  url.search = new URLSearchParams({
    serviceKey: serviceKey(),
    MobileOS: "ETC",
    MobileApp: "DURUDURU_MVP",
    _type: "json",
    numOfRows: String(PAGE_SIZE),
    pageNo: String(pageNo),
    ...parameters,
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`areaBasedList2: HTTP ${response.status}`);
  const payload = await response.json();
  const header = payload?.response?.header;
  if (header?.resultCode !== "0000") {
    throw new Error(
      `areaBasedList2: ${header?.resultCode ?? "unknown"} ${header?.resultMsg ?? "응답을 확인할 수 없습니다."}`,
    );
  }
  return {
    items: asList(payload?.response?.body?.items?.item),
    totalCount: Number(payload?.response?.body?.totalCount ?? 0),
  };
}

async function collectAll(parameters) {
  const first = await requestPage(parameters, 1);
  const pageCount = Math.ceil(first.totalCount / PAGE_SIZE);
  const items = [...first.items];
  for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) {
    const page = await requestPage(parameters, pageNo);
    items.push(...page.items);
  }
  return items;
}

function toAttraction(item, categoryId) {
  const contentId = String(item.contentid ?? "").trim();
  const title = String(item.title ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const lDongRegnCd = String(item.lDongRegnCd ?? "").trim();
  const lDongSignguCd = String(item.lDongSignguCd ?? "").trim();
  if (!contentId || !title || !lDongRegnCd || !lDongSignguCd) return null;
  const contentTypeId = String(item.contenttypeid ?? "").trim();
  const lclsSystm1 = String(item.lclsSystm1 ?? "").trim();
  const lclsSystm2 = String(item.lclsSystm2 ?? "").trim();
  const lclsSystm3 = String(item.lclsSystm3 ?? "").trim();
  const cat1 = String(item.cat1 ?? "").trim();
  const cat2 = String(item.cat2 ?? "").trim();
  const cat3 = String(item.cat3 ?? "").trim();
  // 공통 해석기로 판정한다. 필터가 걸어 온 관심사가 해석 결과에 없으면
  // (새 분류가 그 관심사에 매핑되지 않으면) 그 레코드는 이 관심사에서 제외한다.
  const { categories } = classifyInterests({
    lclsSystm1,
    lclsSystm2,
    lclsSystm3,
    cat1,
    cat2,
    cat3,
    contentTypeId,
  });
  if (!categories.includes(categoryId)) return null;
  const stored = {
    lDongRegnCd,
    lDongSignguCd,
    contentId,
    title,
    categoryId,
    contentTypeId,
    address: String(item.addr1 ?? "").trim(),
    imageUrl: String(item.firstimage ?? item.firstimage2 ?? "").trim(),
    mapX: String(item.mapx ?? "").trim(),
    mapY: String(item.mapy ?? "").trim(),
    cat1,
    cat2,
    cat3,
    classificationVersion: CLASSIFICATION_VERSION,
  };
  if (lclsSystm1) stored.lclsSystm1 = lclsSystm1;
  if (lclsSystm2) stored.lclsSystm2 = lclsSystm2;
  if (lclsSystm3) stored.lclsSystm3 = lclsSystm3;
  const modifiedAt = String(item.modifiedtime ?? "").trim();
  if (modifiedAt) stored.sourceModifiedAt = modifiedAt;
  return stored;
}

function createProfiles(mappings) {
  return mappings.map((mapping) => ({
    regionId: mapping.regionId,
    name: mapping.name,
    province: mapping.province,
    district: mapping.district,
    lDongRegnCd: mapping.lDongRegnCd,
    lDongSignguCd: mapping.lDongSignguCd,
    attractions: [],
  }));
}

const [
  mappingPath = "data/region-mapping.json",
  outputPath = "data/region-profiles.json",
] = process.argv.slice(2);
if (process.argv.length > 4) {
  throw new Error(
    "사용법: npm run build:region-profiles [-- 매핑.json 출력.json]",
  );
}

const mappingDocument = JSON.parse(await readFile(mappingPath, "utf8"));
if (
  !Array.isArray(mappingDocument.mappings) ||
  mappingDocument.mappings.length === 0
) {
  throw new Error("검증된 지역 매핑이 없어 지역 프로필을 만들 수 없습니다.");
}

const profiles = createProfiles(mappingDocument.mappings);
const profilesByLegalCode = new Map(
  profiles.map((profile) => [
    legalKey(profile.lDongRegnCd, profile.lDongSignguCd),
    profile,
  ]),
);

for (const category of categories) {
  for (const filter of category.filters) {
    const records = await collectAll(filter);
    for (const record of records) {
      const attraction = toAttraction(record, category.id);
      if (!attraction) continue;
      const profile = profilesByLegalCode.get(
        legalKey(attraction.lDongRegnCd, attraction.lDongSignguCd),
      );
      if (!profile) continue;
      if (
        profile.attractions.some(
          (existing) =>
            existing.contentId === attraction.contentId &&
            existing.categoryId === attraction.categoryId,
        )
      ) {
        continue;
      }
      const { lDongRegnCd, lDongSignguCd, ...storedAttraction } = attraction;
      profile.attractions.push(storedAttraction);
    }
  }
}

const output = {
  schemaVersion: 1,
  source: {
    tourApi: "KorService2/areaBasedList2",
    mappingGeneratedAt: mappingDocument.generatedAt ?? "",
    categories,
    classificationVersion: CLASSIFICATION_VERSION,
    requestCount,
  },
  generatedAt: new Date().toISOString(),
  profiles,
};

await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(
  `${profiles.length}개 지역 프로필을 ${outputPath}에 생성했습니다. TourAPI 요청 ${requestCount}회`,
);
