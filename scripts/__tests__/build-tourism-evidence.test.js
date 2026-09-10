import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DISTANCE_HEURISTIC_M,
  buildEvidenceDocument,
  haversineMeters,
  isNonItineraryCategory,
  matchRegion,
  nameForms,
  normalizeName,
  parseCoordinate,
  regionTokens,
  validateBundle,
  validateDocument,
} from "../lib/tourism-evidence-core.mjs";

// ---- 이름 정규화 -------------------------------------------------------

describe("normalizeName", () => {
  it("공백·구분 기호를 제거하고 유네스코 병기를 뗀다", () => {
    expect(normalizeName("공주 공산성 [유네스코 세계유산]")).toBe("공주공산성");
    expect(normalizeName("경주 동궁과 월지")).toBe("경주동궁과월지");
    expect(normalizeName("라한셀렉트/경주")).toBe("라한셀렉트경주");
  });

  it("일반 괄호와 그 내용은 그대로 둔다(본체/부분 보존)", () => {
    expect(normalizeName("천마총(대릉원)")).toBe("천마총(대릉원)");
    expect(normalizeName("보광사(과천)")).toBe("보광사(과천)");
  });
});

describe("nameForms — 허용 접두/접미 규칙", () => {
  const tokens = regionTokens({ province: "충청남도", district: "공주시" });

  it("지역 도·시군구·시군구(접미 제거) 토큰을 만든다", () => {
    expect(tokens).toEqual(
      expect.arrayContaining(["충청남도", "충남", "공주시", "공주"]),
    );
  });

  it("지역명 접두를 한 번 떼는 파생형을 만든다(등급 3)", () => {
    const forms = nameForms("공주 공산성 [유네스코 세계유산]", tokens);
    expect(forms.get("공주공산성")).toBe(1); // 유네스코 제거
    expect(forms.get("공산성")).toBe(3); // 접두 제거
  });

  it("끝의 (지역명) 괄호는 지역명과 정확히 같을 때만 뗀다(등급 2)", () => {
    const forms = nameForms("동학사(공주)", tokens);
    expect(forms.get("동학사")).toBe(2);
  });

  it("지역명이 아닌 괄호는 떼지 않는다", () => {
    const forms = nameForms("천마총(대릉원)", tokens);
    expect(forms.has("천마총")).toBe(false);
    expect(forms.has("천마총(대릉원)")).toBe(true);
  });

  it("한 글자 파생형은 버린다", () => {
    const forms = nameForms("공주역", tokens); // 접두 '공주' 제거 시 '역'
    expect(forms.has("역")).toBe(false);
  });
});

// ---- 좌표·거리 -------------------------------------------------------

describe("parseCoordinate / haversineMeters", () => {
  it("한국 육상 경계 밖·비수치는 null", () => {
    expect(parseCoordinate({ mapX: "127.1", mapY: "36.4" })).toEqual({
      lat: 36.4,
      lon: 127.1,
    });
    expect(parseCoordinate({ mapX: "", mapY: "" })).toBeNull();
    expect(parseCoordinate({ mapX: "0", mapY: "0" })).toBeNull();
    expect(parseCoordinate({ mapX: "127.1", mapY: "51.5" })).toBeNull();
  });

  it("거리 계산이 대략 맞다", () => {
    const d = haversineMeters(
      { lat: 36.4645, lon: 127.1253 },
      { lat: 36.463, lon: 127.1268 },
    );
    expect(d).toBeGreaterThan(150);
    expect(d).toBeLessThan(300);
  });
});

describe("isNonItineraryCategory", () => {
  it("숙박·쇼핑은 관광 일정 비대상으로 표시한다(실제 제외는 T5)", () => {
    expect(
      isNonItineraryCategory({ categoryLcls: "숙박", categoryMcls: "숙박" }),
    ).toBe(true);
    expect(
      isNonItineraryCategory({ categoryLcls: "관광지", categoryMcls: "쇼핑" }),
    ).toBe(true);
    expect(
      isNonItineraryCategory({
        categoryLcls: "관광지",
        categoryMcls: "역사관광",
      }),
    ).toBe(false);
  });
});

// ---- matchRegion 단위 -------------------------------------------------

const hub = (rank, name, mapX, mapY, extra = {}) => ({
  hubTatsCd: `hub-${rank}-${name}`,
  hubTatsName: name,
  hubRank: rank,
  categoryLcls: "관광지",
  categoryMcls: "역사관광",
  mapX: String(mapX),
  mapY: String(mapY),
  ...extra,
});
const attr = (contentId, title, mapX, mapY, categories = ["history"]) => ({
  contentId,
  title,
  categories,
  mapX: String(mapX),
  mapY: String(mapY),
});
const GONGJU = regionTokens({ province: "충청남도", district: "공주시" });

describe("matchRegion — 자동 확정 3조건(이름 동일·500m·유일)", () => {
  it("이름 동일 + 근접 + 유일 → matched", () => {
    const r = matchRegion(
      [hub(1, "국립공주박물관", 127.1122, 36.4655)],
      [attr("129787", "국립공주박물관", 127.1123, 36.4653)],
      GONGJU,
    );
    expect(Object.keys(r.matched)).toEqual(["129787"]);
    expect(r.matched["129787"].method).toBe("exact");
    expect(r.matched["129787"].distanceM).toBeLessThan(DISTANCE_HEURISTIC_M);
  });

  it("이름은 같아도 500m 초과 → rejected(distance-over-heuristic)", () => {
    const r = matchRegion(
      [hub(1, "아차산", 127.1, 37.55)],
      [attr("1", "아차산", 127.11, 37.56)],
      GONGJU,
    );
    expect(Object.keys(r.matched)).toHaveLength(0);
    expect(r.rejected[0].reason).toBe("distance-over-heuristic");
    expect(r.rejected[0].distanceM).toBeGreaterThan(DISTANCE_HEURISTIC_M);
  });

  it("이름 후보가 없으면 unmatched(no-name-match)", () => {
    const r = matchRegion(
      [hub(1, "완전히다른곳", 127.1, 36.46)],
      [attr("1", "국립공주박물관", 127.1, 36.46)],
      GONGJU,
    );
    expect(r.unmatched[0].reason).toBe("no-name-match");
  });

  it("접두 제거로만 일치 → method region-prefix-stripped", () => {
    const r = matchRegion(
      [hub(1, "공산성", 127.1253, 36.4645)],
      [attr("125949", "공주 공산성 [유네스코 세계유산]", 127.1268, 36.463)],
      GONGJU,
    );
    expect(r.matched["125949"].method).toBe("region-prefix-stripped");
  });
});

describe("matchRegion — 본체/부분 구분", () => {
  it("허브가 본체(짧은 이름), 프로필이 부분(긴 이름)이면 연결하지 않고 rejected(main-part-distinction)", () => {
    const r = matchRegion(
      [hub(2, "공산성", 127.1253, 36.4645)],
      [attr("2916020", "공산성연지", 127.1253, 36.4644)],
      GONGJU,
    );
    expect(Object.keys(r.matched)).toHaveLength(0);
    expect(r.rejected[0].reason).toBe("main-part-distinction");
    expect(r.rejected[0].contentId).toBe("2916020");
  });

  it("천마총(대릉원) 같은 괄호 본체는 허브 '천마총'과 연결하지 않는다", () => {
    const tokens = regionTokens({ province: "경상북도", district: "경주시" });
    const r = matchRegion(
      [hub(26, "천마총", 129.2105, 35.8386)],
      [
        attr("126214", "천마총(대릉원)", 129.2105, 35.8387),
        attr("1492402", "경주 대릉원 일원", 129.2128, 35.8382),
      ],
      tokens,
    );
    expect(Object.keys(r.matched)).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toContain("main-part-distinction");
  });

  it("동학사 ↔ 동학사계곡은 연결 금지, 동학사 본체는 동학사(공주)에 연결", () => {
    const r = matchRegion(
      [
        hub(8, "동학사", 127.2201, 36.3533),
        hub(15, "동학사계곡", 127.232, 36.3566),
      ],
      [
        attr("125893", "동학사(공주)", 127.22, 36.3532, ["history"]),
        attr("129558", "동학사계곡", 127.2209, 36.3529, ["nature"]),
      ],
      GONGJU,
    );
    expect(r.matched["125893"].hubTatsName).toBe("동학사");
    // 동학사계곡 허브는 500m 밖이라 rejected, 절대 125893/129558 본체로 새지 않는다.
    expect(r.matched["129558"]).toBeUndefined();
    expect(Object.keys(r.matched)).toEqual(["125893"]);
  });
});

describe("matchRegion — 좌표 결측·복수 후보", () => {
  it("허브 좌표 결측 → 자동 확정 안 함(ambiguous)", () => {
    const r = matchRegion(
      [hub(1, "국립공주박물관", "", "")],
      [attr("1", "국립공주박물관", 127.1, 36.46)],
      GONGJU,
    );
    expect(r.ambiguous[0].reason).toBe("hub-coord-missing");
  });

  it("프로필 후보 좌표 결측 → 자동 확정 안 함(ambiguous)", () => {
    const r = matchRegion(
      [hub(1, "국립공주박물관", 127.1, 36.46)],
      [attr("1", "국립공주박물관", "", "")],
      GONGJU,
    );
    expect(r.ambiguous[0].reason).toBe("candidate-coord-missing");
  });

  it("정규화 이름이 같은 후보가 둘이고 원문 exact 유일성이 없으면 ambiguous", () => {
    const r = matchRegion(
      [hub(1, "계남근린공원", 126.86, 37.53)],
      [
        attr("A", "계남 근린공원", 126.861, 37.531),
        attr("B", "계남근린공원", 126.859, 37.529),
      ],
      GONGJU,
    );
    // 둘 다 정규화 시 '계남근린공원' → exact 등급 후보 2개 → 유일성 실패
    expect(r.ambiguous[0].reason).toBe("multiple-candidates");
    expect(Object.keys(r.matched)).toHaveLength(0);
  });

  it("정규화 후보가 둘이어도 원문 exact 후보가 유일하면 그것에 matched(exact-unique)", () => {
    // '옥산서원'(exact)와 '충청남도 옥산서원'(접두 제거로만 일치) 둘이 같은 정규화형을 공유.
    const r = matchRegion(
      [hub(1, "옥산서원", 129.0, 36.0)],
      [
        attr("126212", "옥산서원", 129.0001, 36.0001),
        attr("999", "충청남도 옥산서원", 129.0002, 36.0002),
      ],
      GONGJU,
    );
    expect(r.matched["126212"].method).toBe("exact-unique");
    expect(r.matched["999"]).toBeUndefined();
  });
});

describe("matchRegion — 동일 시설 중복은 최고순위 하나만", () => {
  it("두 허브가 같은 contentId에 걸리면 작은 hubRank만 인정, 나머지는 superseded", () => {
    const r = matchRegion(
      [
        hub(10, "청송 송소고택", 129.05, 36.43),
        hub(31, "청송송소고택", 129.0501, 36.4301),
      ],
      [attr("129051", "송소고택", 129.05, 36.43)],
      regionTokens({ province: "경상북도", district: "청송군" }),
    );
    expect(Object.keys(r.matched)).toEqual(["129051"]);
    expect(r.matched["129051"].hubRank).toBe(10);
    expect(r.superseded).toHaveLength(1);
    expect(r.superseded[0].droppedHubRank).toBe(31);
    expect(r.superseded[0].reason).toBe("same-facility-lower-rank");
  });
});

// ---- 데이터 묶음 버전 정합 -------------------------------------------

const goodSources = () => ({
  profiles: {
    schemaVersion: 2,
    classificationVersion: "lcls-2026-09-10",
    generatedAt: "2026-09-10T04:56:22.175Z",
    source: { mappingGeneratedAt: "2026-09-06T23:46:42.853Z" },
    profiles: Array.from({ length: 210 }, (_, i) => ({
      regionId: `z-${i}`,
      name: `n${i}`,
      province: "충청남도",
      district: "공주시",
      attractions: [],
    })),
  },
  central: {
    schemaVersion: 1,
    baseYm: "202608",
    classificationVersion: "lcls-2026-09-10",
    mappingVersion: "2026-09-06T23:46:42.853Z",
    generatedAt: "2026-09-10T05:32:17.230Z",
    regions: Array.from({ length: 210 }, (_, i) => ({
      regionId: `z-${i}`,
      status: "ok",
      hubs: [],
    })),
  },
  mapping: { schemaVersion: 1, generatedAt: "2026-09-06T23:46:42.853Z" },
});

describe("validateBundle — 버전이 안 맞으면 섞지 않는다", () => {
  it("정합하면 차단 없음", () => {
    expect(validateBundle(goodSources())).toEqual([]);
  });

  it("baseYm 불일치 차단", () => {
    const s = goodSources();
    s.central.baseYm = "202607";
    expect(validateBundle(s).some((b) => b.includes("baseYm"))).toBe(true);
  });

  it("classificationVersion 불일치 차단", () => {
    const s = goodSources();
    s.profiles.classificationVersion = "lcls-2026-08-01";
    expect(
      validateBundle(s).some((b) => b.includes("classificationVersion")),
    ).toBe(true);
  });

  it("mappingVersion 불일치 차단", () => {
    const s = goodSources();
    s.central.mappingVersion = "2026-01-01T00:00:00.000Z";
    expect(validateBundle(s).some((b) => b.includes("mappingVersion"))).toBe(
      true,
    );
  });

  it("buildEvidenceDocument 는 버전 불일치면 throw(섞지 않음)", () => {
    const s = goodSources();
    s.mapping.generatedAt = "2020-01-01T00:00:00.000Z";
    expect(() => buildEvidenceDocument(s)).toThrow(/맞지 않아/);
  });
});

describe("buildEvidenceDocument — 상태별 집계·동명 지역 격리", () => {
  function withRegions(regionDefs) {
    const s = goodSources();
    s.profiles.profiles = regionDefs.map((d) => ({
      regionId: d.regionId,
      name: d.name,
      province: d.province,
      district: d.district,
      attractions: d.attractions,
    }));
    s.central.regions = regionDefs.map((d) => ({
      regionId: d.regionId,
      status: d.status ?? "ok",
      hubs: d.hubs,
    }));
    // 최소 개수 검증 우회를 위해 더미 지역을 채운다.
    while (s.profiles.profiles.length < 210) {
      const i = s.profiles.profiles.length;
      s.profiles.profiles.push({
        regionId: `dummy-${i}`,
        name: `d${i}`,
        province: "충청남도",
        district: "공주시",
        attractions: [],
      });
      s.central.regions.push({
        regionId: `dummy-${i}`,
        status: "ok",
        hubs: [],
      });
    }
    return buildEvidenceDocument(s);
  }

  it("동명 장소라도 다른 regionId 끼리는 연결하지 않는다", () => {
    const doc = withRegions([
      {
        regionId: "r-A",
        name: "A시",
        province: "충청남도",
        district: "A시",
        hubs: [hub(1, "장미공원", 127.0, 36.0)],
        attractions: [attr("A-rose", "장미공원", 127.0001, 36.0001)],
      },
      {
        regionId: "r-B",
        name: "B시",
        province: "충청남도",
        district: "B시",
        hubs: [hub(1, "장미공원", 128.0, 37.0)],
        attractions: [attr("B-rose", "장미공원", 128.0001, 37.0001)],
      },
    ]);
    expect(Object.keys(doc.regions["r-A"].matched)).toEqual(["A-rose"]);
    expect(Object.keys(doc.regions["r-B"].matched)).toEqual(["B-rose"]);
    expect(doc.summary.matched).toBe(2);
  });

  it("summary 에 matched/unmatched/ambiguous/rejected/superseded 를 집계한다", () => {
    const doc = withRegions([
      {
        regionId: "r-1",
        name: "테스트시",
        province: "충청남도",
        district: "공주시",
        hubs: [
          hub(1, "국립공주박물관", 127.11, 36.46), // matched
          hub(2, "없는곳", 127.11, 36.46), // unmatched
          hub(3, "공산성", 127.1253, 36.4645), // main-part → rejected
          hub(4, "박물관", "", ""), // hub-coord-missing → ambiguous (이름 후보 있음)
        ],
        attractions: [
          attr("129787", "국립공주박물관", 127.111, 36.461),
          attr("2916020", "공산성연지", 127.1253, 36.4644),
          attr("999", "박물관", 127.11, 36.46),
        ],
      },
    ]);
    const s = doc.summary;
    expect(s.matched).toBe(1);
    expect(s.unmatched).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.ambiguous).toBe(1);
    expect(s.rejectReasons["main-part-distinction"]).toBe(1);
  });

  it("연결 인덱스는 contentId 로 O(1) 조회 가능한 형태다", () => {
    const doc = withRegions([
      {
        regionId: "r-1",
        name: "테스트시",
        province: "충청남도",
        district: "공주시",
        hubs: [hub(1, "국립공주박물관", 127.11, 36.46)],
        attractions: [attr("129787", "국립공주박물관", 127.111, 36.461)],
      },
    ]);
    expect(doc.regions["r-1"].matched["129787"]).toMatchObject({
      contentId: "129787",
      hubRank: 1,
    });
    expect(doc.bundle.consistent).toBe(true);
    expect(validateDocument(doc)).toEqual([]);
  });
});

// ---- 실제 원천 회귀(네트워크 없음, 커밋된 JSON만) --------------------

describe("실제 원천 회귀", () => {
  const load = (name) =>
    JSON.parse(readFileSync(resolve(process.cwd(), "data", name), "utf8"));
  const doc = buildEvidenceDocument({
    profiles: load("region-profiles.json"),
    central: load("central-attractions.json"),
    mapping: load("region-mapping.json"),
  });
  const gongju = doc.regions["ktdb-zone-154"];
  const gyeongju = doc.regions["ktdb-zone-207"];

  it("공주 '공산성'(허브)은 125949(공주 공산성)에 연결되고 공산성연지(2916020)에는 연결되지 않는다", () => {
    const m = Object.values(gongju.matched).find(
      (x) => x.hubTatsName === "공산성",
    );
    expect(m.contentId).toBe("125949");
    expect(gongju.matched["2916020"]?.hubTatsName).not.toBe("공산성");
  });

  it("공주 '무령왕릉'(허브 rank 3)은 matched 가 아니고, 126681은 rank 7 허브 하나만 인정", () => {
    expect(
      Object.values(gongju.matched).some((x) => x.hubTatsName === "무령왕릉"),
    ).toBe(false);
    expect(gongju.matched["126681"].hubRank).toBe(7);
  });

  it("공주 '동학사'는 동학사(공주)에 연결되고 동학사계곡에는 연결되지 않는다", () => {
    const m = Object.values(gongju.matched).find(
      (x) => x.hubTatsName === "동학사",
    );
    expect(m.contentId).toBe("125893");
    expect(gongju.matched["129558"]).toBeUndefined();
  });

  it("경주 '천마총'은 천마총(대릉원)·대릉원 일원 어디에도 연결되지 않는다", () => {
    expect(gyeongju.matched["126214"]).toBeUndefined();
    expect(gyeongju.matched["1492402"]).toBeUndefined();
    expect(
      gyeongju.rejected.some(
        (x) =>
          x.hubTatsName === "천마총" && x.reason === "main-part-distinction",
      ),
    ).toBe(true);
  });

  it("전국 집계가 존재하고 정상본 검증을 통과한다", () => {
    expect(doc.summary.matched).toBeGreaterThan(1000);
    expect(doc.summary.regionsWithProfile).toBe(249);
    expect(validateDocument(doc)).toEqual([]);
  });
});
