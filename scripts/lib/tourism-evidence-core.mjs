/**
 * 보수적 원천 연결(T4)의 순수 로직.
 *
 * `data/central-attractions.json`(중심 관광지, `hubTatsCd`)와
 * `data/region-profiles.json`(관광지 프로필, `contentId`)을 **행정지역이 동일한**
 * 후보 안에서만 대조해, 자동 확정할 수 있는 연결만 사전 인덱스로 만든다.
 *
 * 네트워크·파일 IO 없음. `scripts/build-tourism-evidence.mjs`(CLI)와
 * `scripts/__tests__/build-tourism-evidence.test.js`(Jest)가 함께 import 한다.
 *
 * 설계 원칙(기획서 D3):
 *   - `hubTatsCd`(32자리 해시)와 `contentId`(숫자)는 다른 ID다. 두 값을 분리해 보존한다.
 *   - 자동 확정은 ① 정규화 이름이 **동일**(부분 문자열 매칭 금지) ② 좌표가 500m 이내
 *     ③ 유일 후보 — 세 조건을 모두 충족할 때만.
 *   - 500m는 이번 제품 휴리스틱이며 **공식 동일 장소 보증이 아니다**.
 *   - 일반 괄호 내용은 무조건 삭제하지 않는다. `천마총(대릉원)`과 `대릉원`,
 *     `공산성`과 `공산성연지` 같은 본체/부분 차이를 보존한다.
 *   - 좌표 결측은 자동 확정하지 않는다.
 *   - 같은 `contentId`에 여러 중심 항목이 연결되면 가장 높은 순위(작은 hubRank)
 *     하나만 인정한다.
 */

import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;

/** 두 원천이 함께 검증돼야 하는 기준월·버전. 다르면 섞지 않는다. */
export const EXPECTED_BASE_YM = "202608";
export const EXPECTED_CLASSIFICATION_VERSION = "lcls-2026-09-10";
export const EXPECTED_MAPPING_VERSION = "2026-09-06T23:46:42.853Z";
export const EXPECTED_PROFILE_SCHEMA_VERSION = 2;
export const EXPECTED_CENTRAL_SCHEMA_VERSION = 1;
export const EXPECTED_MAPPING_SCHEMA_VERSION = 1;

/**
 * 자동 확정 좌표 상한(m). **제품 휴리스틱이지 공식 동일 장소 보증이 아니다.**
 * 중심 관광지 좌표(티맵 대표점)와 TourAPI 좌표(콘텐츠 대표점)의 기준이 다를 수 있어
 * 완전 일치를 기대하지 않고, 유일성·이름 동일과 함께 볼 때만 신뢰한다.
 */
export const DISTANCE_HEURISTIC_M = 500;

/**
 * 이름 정규화에서 **제거하는** 명시적 표기.
 * 유네스코 세계유산 병기는 TourAPI 프로필에만 붙고 중심 목록엔 없어, 제거해야 대조된다.
 * 임의의 일반 괄호는 제거하지 않는다.
 */
export const UNESCO_TOKENS = [
  "[유네스코세계유산]",
  "[유네스코세계문화유산]",
  "[유네스코세계자연유산]",
  "(유네스코세계유산)",
  "(유네스코세계문화유산)",
  "유네스코세계유산",
];

/** 정규화에서 제거하는 구분 기호(공백 포함). 괄호·대괄호는 제거하지 않는다. */
const SEPARATOR_RE = /[\s/·ㆍ|,~\-–—]/gu;

/** 도(道) 정식 명칭 ↔ 흔한 축약. 접두/괄호 접미 토큰 후보로만 쓴다. */
const PROVINCE_ALIASES = {
  강원특별자치도: ["강원", "강원도"],
  강원도: ["강원"],
  전북특별자치도: ["전북", "전라북도"],
  전라북도: ["전북"],
  전라남도: ["전남"],
  경상북도: ["경북"],
  경상남도: ["경남"],
  충청북도: ["충북"],
  충청남도: ["충남"],
  제주특별자치도: ["제주", "제주도"],
  세종특별자치시: ["세종"],
};

const text = (value) => String(value ?? "").trim();

/**
 * 이름의 기본 정규화: 유네스코 병기 제거 → 구분 기호·공백 제거.
 * 괄호·대괄호와 그 안의 내용은 그대로 둔다(본체/부분 구분 보존).
 */
export function normalizeName(raw) {
  let s = text(raw);
  // 유네스코 토큰은 공백을 없앤 뒤 정확히 일치하는 것만 제거한다.
  let collapsed = s.replace(SEPARATOR_RE, "");
  for (const token of UNESCO_TOKENS) {
    collapsed = collapsed.split(token).join("");
  }
  return collapsed;
}

/** 지역명 접두/괄호 접미 토큰 후보(정식 명칭·시군구명·축약). 긴 것부터. */
export function regionTokens({ province, district }) {
  const set = new Set();
  const prov = text(province);
  const dist = text(district).split(/\s+/u)[0];
  if (prov) {
    set.add(prov);
    for (const alias of PROVINCE_ALIASES[prov] ?? []) set.add(alias);
  }
  if (dist) {
    set.add(dist);
    const noSuffix = dist.replace(/[시군구]$/u, "");
    if (noSuffix && noSuffix !== dist) set.add(noSuffix);
  }
  return [...set].filter(Boolean).sort((a, b) => b.length - a.length);
}

/**
 * 정규화 이름의 파생형과 각 파생형을 얻는 데 쓴 규칙의 "느슨함" 등급을 만든다.
 * 등급이 낮을수록(0) 원문에 가깝다.
 *   0 exact             — 공백·구분 기호만 정리
 *   1 unesco-normalized — 유네스코 병기까지 제거해야 일치
 *   2 region-paren       — 끝의 `(지역명)` 괄호를 떼야 일치
 *   3 region-prefix      — 앞의 지역명 접두를 떼야 일치
 *
 * 반환: Map<form, tightness>. 부분 문자열 매칭은 하지 않는다(정확 일치 전용).
 */
export function nameForms(raw, tokens = []) {
  const forms = new Map();
  const add = (form, tightness) => {
    const f = text(form);
    if (f.length < 2) return;
    if (!forms.has(f) || forms.get(f) > tightness) forms.set(f, tightness);
  };

  const rawCollapsed = text(raw).replace(SEPARATOR_RE, "");
  const base = normalizeName(raw);
  // 유네스코 토큰 제거 여부로 exact / unesco 등급을 가른다.
  const baseTightness = rawCollapsed === base ? 0 : 1;
  add(base, baseTightness);

  // 끝의 `(지역명)` 또는 `[지역명]` 괄호 제거 — 지역명과 정확히 일치할 때만.
  for (const token of tokens) {
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
    ]) {
      const suffix = `${open}${token}${close}`;
      if (base.endsWith(suffix)) {
        add(
          base.slice(0, base.length - suffix.length),
          Math.max(2, baseTightness),
        );
      }
    }
  }

  // 앞의 지역명 접두 제거(공백은 이미 없앰 → 붙어 있든 떨어져 있든 동일).
  for (const token of tokens) {
    if (base.startsWith(token)) {
      add(base.slice(token.length), 3);
    }
  }

  return forms;
}

const TIGHTNESS_METHOD = [
  "exact",
  "unesco-normalized",
  "region-paren-stripped",
  "region-prefix-stripped",
];
export const methodForTightness = (t) => TIGHTNESS_METHOD[t] ?? "unknown";

/** 한국 육상 좌표 대략 경계. 벗어나면 좌표 결측으로 취급한다. */
export function parseCoordinate({ mapX, mapY }) {
  const lon = Number(text(mapX));
  const lat = Number(text(mapY));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < 124 || lon > 132) return null;
  if (lat < 33 || lat > 43) return null;
  return { lat, lon };
}

/** 두 좌표의 대권 거리(m). */
export function haversineMeters(a, b) {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(Math.min(1, h))));
}

/** 중심 항목이 관광 일정 배치에서 제외돼야 하는 카테고리인지(실제 제외는 T5). */
export function isNonItineraryCategory(hub) {
  return (
    text(hub.categoryLcls) === "숙박" ||
    text(hub.categoryMcls) === "쇼핑" ||
    text(hub.categoryMcls) === "숙박"
  );
}

/**
 * 한 행정지역(동일 `regionId`)의 중심 항목 ↔ 프로필 관광지 연결.
 *
 * 반환: { matched, unmatched, ambiguous, rejected, superseded }
 *   - matched: contentId 기준으로 유일. 같은 시설 중복은 최고순위만 남기고 나머지는 superseded.
 */
export function matchRegion(hubs, attractions, tokens) {
  const attrForms = attractions.map((attr) => ({
    attr,
    forms: nameForms(attr.title, tokens),
    coord: parseCoordinate(attr),
  }));

  const matchedRaw = [];
  const unmatched = [];
  const ambiguous = [];
  const rejected = [];

  const sortedHubs = [...hubs].sort((a, b) => {
    const ra = Number.isFinite(a.hubRank) ? a.hubRank : Number.MAX_SAFE_INTEGER;
    const rb = Number.isFinite(b.hubRank) ? b.hubRank : Number.MAX_SAFE_INTEGER;
    return ra - rb || text(a.hubTatsCd).localeCompare(text(b.hubTatsCd));
  });

  for (const hub of sortedHubs) {
    const hubForms = nameForms(hub.hubTatsName, tokens);
    const hubCoord = parseCoordinate(hub);
    const stub = {
      hubTatsCd: text(hub.hubTatsCd),
      hubTatsName: text(hub.hubTatsName),
      hubRank: Number.isFinite(hub.hubRank) ? hub.hubRank : null,
      categoryLcls: text(hub.categoryLcls),
      categoryMcls: text(hub.categoryMcls),
      nonItineraryCategory: isNonItineraryCategory(hub),
    };

    // 이름이 정확히 일치하는(파생형 기준) 프로필 후보를 모은다.
    const candidates = [];
    for (const entry of attrForms) {
      let best = null;
      for (const [form, hubT] of hubForms) {
        if (!entry.forms.has(form)) continue;
        const tightness = Math.max(hubT, entry.forms.get(form));
        if (best === null || tightness < best) best = tightness;
      }
      if (best !== null) candidates.push({ ...entry, tightness: best });
    }

    if (candidates.length === 0) {
      // 정확 일치 후보는 없다. 이름 접두/접미 포함 + 근접 좌표면 사유를 남긴다.
      // (자동 확정은 절대 하지 않는다. 부분 문자열 포함만으로는 연결 금지.)
      const hubBases = [...hubForms.keys()];
      let hit = null;
      for (const entry of attrForms) {
        if (!entry.coord || !hubCoord) continue;
        if (haversineMeters(hubCoord, entry.coord) > DISTANCE_HEURISTIC_M)
          continue;
        const attrBases = [...entry.forms.keys()];
        for (const hb of hubBases) {
          for (const ab of attrBases) {
            if (hb === ab) continue;
            if (!ab.startsWith(hb) && !hb.startsWith(ab)) continue;
            const hubIsLonger = hb.length > ab.length;
            const extra = hubIsLonger
              ? hb.slice(ab.length)
              : ab.slice(hb.length);
            const extraIsRegion =
              hubIsLonger &&
              tokens.some((t) => extra === t || extra.startsWith(t));
            hit ??= {
              entry,
              distanceM: haversineMeters(hubCoord, entry.coord),
              reason: extraIsRegion
                ? "region-affix-not-normalized"
                : "main-part-distinction",
            };
          }
        }
      }
      if (hit) {
        rejected.push({
          ...stub,
          contentId: hit.entry.attr.contentId,
          contentTitle: hit.entry.attr.title,
          reason: hit.reason,
          distanceM: hit.distanceM,
          note:
            hit.reason === "main-part-distinction"
              ? "이름 접두/접미 포함·근접 좌표뿐이라 본체/부분 구분을 위해 연결하지 않음"
              : "허브 이름의 지역 접미가 정규화 규칙 밖이라 보수적으로 연결하지 않음",
        });
      } else {
        unmatched.push({
          hubTatsCd: stub.hubTatsCd,
          hubTatsName: stub.hubTatsName,
          hubRank: stub.hubRank,
          reason: "no-name-match",
        });
      }
      continue;
    }

    if (!hubCoord) {
      ambiguous.push({
        ...stub,
        reason: "hub-coord-missing",
        candidateContentIds: candidates.map((c) => c.attr.contentId),
      });
      continue;
    }

    const withDist = candidates.map((c) => ({
      ...c,
      distanceM: c.coord ? haversineMeters(hubCoord, c.coord) : null,
    }));

    if (candidates.length === 1) {
      const c = withDist[0];
      if (!c.coord) {
        ambiguous.push({
          ...stub,
          reason: "candidate-coord-missing",
          contentId: c.attr.contentId,
          contentTitle: c.attr.title,
        });
        continue;
      }
      if (c.distanceM > DISTANCE_HEURISTIC_M) {
        rejected.push({
          ...stub,
          contentId: c.attr.contentId,
          contentTitle: c.attr.title,
          reason: "distance-over-heuristic",
          distanceM: c.distanceM,
        });
        continue;
      }
      matchedRaw.push({
        stub,
        attr: c.attr,
        method: methodForTightness(c.tightness),
        distanceM: c.distanceM,
      });
      continue;
    }

    // 후보가 여럿이면 원문 이름(exact 등급)·좌표로 유일성이 확인될 때만 연결한다.
    const exactAll = withDist.filter((c) => c.tightness === 0);
    const exactGeo = exactAll.filter(
      (c) => c.coord && c.distanceM <= DISTANCE_HEURISTIC_M,
    );
    if (exactAll.length === 1 && exactGeo.length === 1) {
      matchedRaw.push({
        stub,
        attr: exactGeo[0].attr,
        method: "exact-unique",
        distanceM: exactGeo[0].distanceM,
      });
      continue;
    }
    ambiguous.push({
      ...stub,
      reason: "multiple-candidates",
      candidateContentIds: candidates.map((c) => c.attr.contentId),
    });
  }

  // 같은 contentId(확인된 동일 시설)에 여러 중심 항목 → 최고순위(작은 hubRank) 하나만.
  const byContentId = new Map();
  for (const m of matchedRaw) {
    const list = byContentId.get(m.attr.contentId) ?? [];
    list.push(m);
    byContentId.set(m.attr.contentId, list);
  }
  const matched = {};
  const superseded = [];
  for (const [contentId, list] of byContentId) {
    list.sort((a, b) => {
      const ra = a.stub.hubRank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.stub.hubRank ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.stub.hubTatsCd.localeCompare(b.stub.hubTatsCd);
    });
    const kept = list[0];
    matched[contentId] = {
      contentId,
      contentTitle: kept.attr.title,
      hubTatsCd: kept.stub.hubTatsCd,
      hubTatsName: kept.stub.hubTatsName,
      hubRank: kept.stub.hubRank,
      method: kept.method,
      distanceM: kept.distanceM,
      categoryLcls: kept.stub.categoryLcls,
      categoryMcls: kept.stub.categoryMcls,
      nonItineraryCategory: kept.stub.nonItineraryCategory,
      interestCategories: Array.isArray(kept.attr.categories)
        ? [...kept.attr.categories]
        : [],
    };
    for (const dropped of list.slice(1)) {
      superseded.push({
        contentId,
        keptHubTatsCd: kept.stub.hubTatsCd,
        keptHubRank: kept.stub.hubRank,
        droppedHubTatsCd: dropped.stub.hubTatsCd,
        droppedHubTatsName: dropped.stub.hubTatsName,
        droppedHubRank: dropped.stub.hubRank,
        reason: "same-facility-lower-rank",
      });
    }
  }

  return { matched, unmatched, ambiguous, rejected, superseded };
}

/** 원천 세 개의 버전이 함께 쓸 수 있는지 검증한다. 다르면 섞지 않는다. */
export function validateBundle({ profiles, central, mapping }) {
  const blockers = [];
  if (profiles?.schemaVersion !== EXPECTED_PROFILE_SCHEMA_VERSION) {
    blockers.push(
      `region-profiles.schemaVersion=${profiles?.schemaVersion} (기대 ${EXPECTED_PROFILE_SCHEMA_VERSION})`,
    );
  }
  if (profiles?.classificationVersion !== EXPECTED_CLASSIFICATION_VERSION) {
    blockers.push(
      `region-profiles.classificationVersion=${profiles?.classificationVersion} (기대 ${EXPECTED_CLASSIFICATION_VERSION})`,
    );
  }
  if (profiles?.source?.mappingGeneratedAt !== EXPECTED_MAPPING_VERSION) {
    blockers.push(
      `region-profiles.source.mappingGeneratedAt=${profiles?.source?.mappingGeneratedAt} (기대 ${EXPECTED_MAPPING_VERSION})`,
    );
  }
  if (central?.schemaVersion !== EXPECTED_CENTRAL_SCHEMA_VERSION) {
    blockers.push(
      `central-attractions.schemaVersion=${central?.schemaVersion} (기대 ${EXPECTED_CENTRAL_SCHEMA_VERSION})`,
    );
  }
  if (central?.baseYm !== EXPECTED_BASE_YM) {
    blockers.push(
      `central-attractions.baseYm=${central?.baseYm} (기대 ${EXPECTED_BASE_YM})`,
    );
  }
  if (central?.classificationVersion !== EXPECTED_CLASSIFICATION_VERSION) {
    blockers.push(
      `central-attractions.classificationVersion=${central?.classificationVersion} (기대 ${EXPECTED_CLASSIFICATION_VERSION})`,
    );
  }
  if (central?.mappingVersion !== EXPECTED_MAPPING_VERSION) {
    blockers.push(
      `central-attractions.mappingVersion=${central?.mappingVersion} (기대 ${EXPECTED_MAPPING_VERSION})`,
    );
  }
  if (mapping?.schemaVersion !== EXPECTED_MAPPING_SCHEMA_VERSION) {
    blockers.push(
      `region-mapping.schemaVersion=${mapping?.schemaVersion} (기대 ${EXPECTED_MAPPING_SCHEMA_VERSION})`,
    );
  }
  if (mapping?.generatedAt !== EXPECTED_MAPPING_VERSION) {
    blockers.push(
      `region-mapping.generatedAt=${mapping?.generatedAt} (기대 ${EXPECTED_MAPPING_VERSION})`,
    );
  }
  if (!Array.isArray(profiles?.profiles) || profiles.profiles.length < 200) {
    blockers.push(
      `region-profiles.profiles 개수 비정상: ${profiles?.profiles?.length}`,
    );
  }
  if (!Array.isArray(central?.regions) || central.regions.length < 200) {
    blockers.push(
      `central-attractions.regions 개수 비정상: ${central?.regions?.length}`,
    );
  }
  return blockers;
}

function dataVersionHash(parts) {
  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * 연결 인덱스 문서를 만든다.
 *
 * `regions[regionId].matched`는 `contentId → 근거` 객체라, 런타임 검색은 실제 초안에
 * 배치된 관광지 `contentId`로 O(1) 조회만 하면 된다(전체 비교 없음).
 */
export function buildEvidenceDocument(
  { profiles, central, mapping },
  now = new Date(),
) {
  const bundleBlockers = validateBundle({ profiles, central, mapping });
  if (bundleBlockers.length) {
    throw new Error(
      `원천 버전이 맞지 않아 묶을 수 없습니다:\n  - ${bundleBlockers.join("\n  - ")}`,
    );
  }

  const centralByRegion = new Map(
    central.regions.map((region) => [region.regionId, region]),
  );

  const regions = {};
  const summary = {
    regionsWithProfile: 0,
    regionsWithCentral: 0,
    regionsWithoutCentral: 0,
    centralEmptyRegions: 0,
    hubsConsidered: 0,
    matched: 0,
    unmatched: 0,
    ambiguous: 0,
    rejected: 0,
    superseded: 0,
    matchMethods: {},
    rejectReasons: {},
    ambiguousReasons: {},
    unmatchedReasons: {},
    nonItineraryMatched: 0,
  };

  const sortedProfiles = [...profiles.profiles].sort((a, b) =>
    a.regionId.localeCompare(b.regionId, "en", { numeric: true }),
  );

  for (const profile of sortedProfiles) {
    summary.regionsWithProfile += 1;
    const centralRegion = centralByRegion.get(profile.regionId) ?? null;
    const tokens = regionTokens(profile);
    const hubs = centralRegion?.hubs ?? [];
    const centralStatus = centralRegion?.status ?? "missing";

    if (!centralRegion) summary.regionsWithoutCentral += 1;
    else summary.regionsWithCentral += 1;
    if (centralStatus === "empty") summary.centralEmptyRegions += 1;

    const result = matchRegion(hubs, profile.attractions, tokens);
    summary.hubsConsidered += hubs.length;

    const matchedCount = Object.keys(result.matched).length;
    summary.matched += matchedCount;
    summary.unmatched += result.unmatched.length;
    summary.ambiguous += result.ambiguous.length;
    summary.rejected += result.rejected.length;
    summary.superseded += result.superseded.length;
    for (const m of Object.values(result.matched)) {
      summary.matchMethods[m.method] =
        (summary.matchMethods[m.method] ?? 0) + 1;
      if (m.nonItineraryCategory) summary.nonItineraryMatched += 1;
    }
    for (const r of result.rejected)
      summary.rejectReasons[r.reason] =
        (summary.rejectReasons[r.reason] ?? 0) + 1;
    for (const a of result.ambiguous)
      summary.ambiguousReasons[a.reason] =
        (summary.ambiguousReasons[a.reason] ?? 0) + 1;
    for (const u of result.unmatched)
      summary.unmatchedReasons[u.reason] =
        (summary.unmatchedReasons[u.reason] ?? 0) + 1;

    regions[profile.regionId] = {
      regionId: profile.regionId,
      name: profile.name,
      province: profile.province,
      district: profile.district,
      centralStatus,
      hubCount: hubs.length,
      profileAttractionCount: profile.attractions.length,
      matchedCount,
      matched: result.matched,
      unmatched: result.unmatched,
      ambiguous: result.ambiguous,
      rejected: result.rejected,
      superseded: result.superseded,
    };
  }

  const dataVersion = dataVersionHash([
    `schema:${SCHEMA_VERSION}`,
    `profiles:${profiles.generatedAt}`,
    `central:${central.generatedAt}`,
    `baseYm:${central.baseYm}`,
    `mapping:${EXPECTED_MAPPING_VERSION}`,
    `classification:${EXPECTED_CLASSIFICATION_VERSION}`,
  ]);

  return {
    schemaVersion: SCHEMA_VERSION,
    dataVersion,
    baseYm: central.baseYm,
    generatedAt: now.toISOString(),
    distanceHeuristicM: DISTANCE_HEURISTIC_M,
    distanceHeuristicNote:
      "500m는 제품 휴리스틱이며 공식 동일 장소 보증이 아니다. 이름 동일·유일성과 함께 볼 때만 신뢰한다.",
    idNote:
      "hubTatsCd(티맵 기반 해시)와 contentId(TourAPI 숫자)는 다른 ID다. matched 항목에 두 값을 분리 보존한다.",
    nameNormalization: {
      removedSeparators: "공백 / · ㆍ | , ~ - – —",
      removedTokens: UNESCO_TOKENS,
      allowedPrefixes:
        "지역 도(道) 정식 명칭·축약, 시군구명, 시군구명에서 끝의 시/군/구를 뗀 형태. 접두는 한 번만 제거한다.",
      allowedParenSuffix:
        "끝의 (지역명) 또는 [지역명] — 괄호 안이 위 지역명과 정확히 같을 때만 제거한다.",
      forbidden:
        "임의의 일반 괄호 삭제, 부분 문자열 매칭, 지역명이 아닌 접미 토큰 제거",
    },
    bundle: {
      consistent: true,
      versionRefs: {
        mappingVersion: EXPECTED_MAPPING_VERSION,
        classificationVersion: EXPECTED_CLASSIFICATION_VERSION,
        baseYm: central.baseYm,
      },
      sources: {
        regionProfiles: {
          schemaVersion: profiles.schemaVersion,
          generatedAt: profiles.generatedAt,
          classificationVersion: profiles.classificationVersion,
          mappingGeneratedAt: profiles.source?.mappingGeneratedAt,
        },
        centralAttractions: {
          schemaVersion: central.schemaVersion,
          generatedAt: central.generatedAt,
          baseYm: central.baseYm,
          mappingVersion: central.mappingVersion,
          classificationVersion: central.classificationVersion,
        },
        regionMapping: {
          schemaVersion: mapping.schemaVersion,
          generatedAt: mapping.generatedAt,
        },
      },
    },
    summary,
    regions,
  };
}

/** 정상본 교체를 막을 사유. */
export function validateDocument(doc) {
  const blockers = [];
  if (doc?.schemaVersion !== SCHEMA_VERSION) {
    blockers.push(
      `schemaVersion=${doc?.schemaVersion} (기대 ${SCHEMA_VERSION})`,
    );
  }
  if (doc?.baseYm !== EXPECTED_BASE_YM) {
    blockers.push(`baseYm=${doc?.baseYm} (기대 ${EXPECTED_BASE_YM})`);
  }
  if (doc?.bundle?.consistent !== true) {
    blockers.push("bundle.consistent 가 true 가 아님");
  }
  const regions = doc?.regions ? Object.values(doc.regions) : [];
  if (regions.length < 200) {
    blockers.push(`지역 수 비정상: ${regions.length}`);
  }
  if ((doc?.summary?.matched ?? 0) < 1) {
    blockers.push("matched 가 0 — 연결이 전혀 없음");
  }
  // 회귀: 알려진 본체/부분·별칭 쌍이 matched 로 새어 들어가면 차단한다.
  const forbidden = [
    ["ktdb-zone-154", "공산성", "2916020", "공주 '공산성' → '공산성연지'"],
    [
      "ktdb-zone-154",
      "무령왕릉",
      "126681",
      "공주 '무령왕릉'(별칭/부분) → 무령왕릉과왕릉원",
    ],
    ["ktdb-zone-207", "천마총", "126214", "경주 '천마총' → '천마총(대릉원)'"],
    ["ktdb-zone-207", "천마총", "1492402", "경주 '천마총' → '대릉원 일원'"],
  ];
  for (const [regionId, hubName, contentId, label] of forbidden) {
    const region = doc?.regions?.[regionId];
    if (!region) continue;
    const hit = Object.values(region.matched ?? {}).some(
      (m) => m.hubTatsName === hubName && m.contentId === contentId,
    );
    if (hit) blockers.push(`회귀: ${label} 연결이 matched 에 들어감`);
  }
  return blockers;
}
