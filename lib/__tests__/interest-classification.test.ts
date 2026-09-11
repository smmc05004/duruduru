import { describe, expect, it } from "@jest/globals";
import lclsCodes from "@/data/tourapi-lcls-systm-codes.json";
import {
  CLASSIFICATION_VERSION,
  classifyInterests,
  detailClassification,
  hasOfficialClassification,
  INTEREST_CLASSIFICATION_RULES,
  KNOWN_LCLS_CODES,
  MVP_CATEGORY_IDS,
  OFFICIAL_LCLS1_NAMES,
} from "@/lib/interest-classification";
import { LANDMARK_CLASSIFICATION_SAMPLES } from "@/lib/test-support/landmark-classification-fixture";

describe("공식 분류 목록 동기화", () => {
  const jsonCodes = new Set<string>();
  for (const row of lclsCodes.rows) {
    for (const code of [row.lclsSystm1Cd, row.lclsSystm2Cd, row.lclsSystm3Cd]) {
      if (code) jsonCodes.add(code);
    }
  }

  it("KNOWN_LCLS_CODES 는 data/tourapi-lcls-systm-codes.json 과 정확히 일치한다", () => {
    expect([...KNOWN_LCLS_CODES].sort()).toEqual([...jsonCodes].sort());
  });

  it("OFFICIAL_LCLS1_NAMES 는 원본의 L1 코드·명칭을 그대로 담는다", () => {
    const fromJson: Record<string, string> = {};
    for (const row of lclsCodes.rows)
      fromJson[row.lclsSystm1Cd] = row.lclsSystm1Nm;
    expect(OFFICIAL_LCLS1_NAMES).toEqual(fromJson);
  });

  it("분류 버전은 원본 조회일과 맞물린다", () => {
    expect(CLASSIFICATION_VERSION).toBe(`lcls-${lclsCodes.retrievedAt}`);
  });

  it("규칙이 참조하는 lcls 코드는 모두 공식 목록에 있다", () => {
    for (const id of MVP_CATEGORY_IDS) {
      const rule = INTEREST_CLASSIFICATION_RULES[id];
      for (const code of rule.lcls ?? []) {
        expect(KNOWN_LCLS_CODES.has(code)).toBe(true);
      }
    }
  });
});

describe("classifyInterests — 새 분류 존재", () => {
  it.each(LANDMARK_CLASSIFICATION_SAMPLES)(
    "$title 은 새 HS 분류로 역사로 판정된다",
    (sample) => {
      const result = classifyInterests(sample);
      expect(result.categories).toEqual(["history"]);
      expect(result.basis).toBe("lcls");
      expect(result.unresolvedLcls).toEqual([]);
      expect(hasOfficialClassification(sample)).toBe(true);
    },
  );

  it("새 분류가 있으면 구 cat 은 무시한다(레저 LS)", () => {
    const result = classifyInterests({
      lclsSystm1: "LS",
      lclsSystm2: "LS01",
      lclsSystm3: "LS010400",
      contentTypeId: "28",
      cat1: "A01",
      cat2: "A0101",
    });
    expect(result.categories).toEqual(["leisure"]);
    expect(result.basis).toBe("lcls");
  });

  it("새 문화 분류는 의미 보존 하위 코드만 문화로 본다", () => {
    expect(
      classifyInterests({ lclsSystm1: "VE", lclsSystm2: "VE07" }).categories,
    ).toEqual(["culture"]);
    // 랜드마크·테마공원·교통시설은 문화로 보지 않는다.
    expect(
      classifyInterests({ lclsSystm1: "VE", lclsSystm2: "VE11" }).categories,
    ).toEqual([]);
  });

  it("휴양은 새 분류 EX05 웰니스관광으로 판정된다(2026-09-10 PM 결정)", () => {
    const result = classifyInterests({
      lclsSystm1: "EX",
      lclsSystm2: "EX05",
      lclsSystm3: "EX050100",
    });
    expect(result.categories).toEqual(["rest"]);
    expect(result.basis).toBe("lcls");
  });

  it("NA04 자연공원은 자연이면서 휴양으로 판정된다", () => {
    const result = classifyInterests({
      lclsSystm1: "NA",
      lclsSystm2: "NA04",
      lclsSystm3: "NA040600",
    });
    expect(result.categories).toEqual(["nature", "rest"]);
    expect(result.basis).toBe("lcls");
  });

  it("VE03 도시공원은 휴양으로 판정되고 문화로는 판정되지 않는다", () => {
    const result = classifyInterests({
      lclsSystm1: "VE",
      lclsSystm2: "VE03",
      lclsSystm3: "VE030400",
    });
    expect(result.categories).toEqual(["rest"]);
  });

  it("VE02 테마파크·VE05 복합관광시설은 휴양으로 보지 않는다", () => {
    expect(
      classifyInterests({ lclsSystm1: "VE", lclsSystm2: "VE02" }).categories,
    ).toEqual([]);
    expect(
      classifyInterests({ lclsSystm1: "VE", lclsSystm2: "VE05" }).categories,
    ).toEqual([]);
  });
});

describe("classifyInterests — 새 분류 없음(하위 호환)", () => {
  it("구 cat1=A01 은 자연으로 판정된다", () => {
    const result = classifyInterests({
      cat1: "A01",
      cat2: "A0101",
      cat3: "A01010400",
      contentTypeId: "12",
    });
    expect(result.categories).toEqual(["nature"]);
    expect(result.basis).toBe("legacy");
  });

  it("구 cat2=A0202 는 휴양으로 판정된다", () => {
    expect(
      classifyInterests({ cat2: "A0202", contentTypeId: "12" }).categories,
    ).toEqual(["rest"]);
  });

  it("contentTypeId 14/28 은 새 분류가 없을 때 문화·레저 신호로 쓰인다", () => {
    expect(classifyInterests({ contentTypeId: "14" }).categories).toEqual([
      "culture",
    ]);
    expect(classifyInterests({ contentTypeId: "28" }).categories).toEqual([
      "leisure",
    ]);
  });

  it("분류가 전혀 없으면 basis 는 none 이다", () => {
    const result = classifyInterests({});
    expect(result.categories).toEqual([]);
    expect(result.basis).toBe("none");
  });
});

describe("classifyInterests — 미해석 코드", () => {
  it("공식 목록에 없는 lcls 코드는 기존 코드로 덮지 않고 분리 집계한다", () => {
    const result = classifyInterests({
      lclsSystm1: "ZZ",
      lclsSystm2: "ZZ99",
      cat1: "A01",
      cat2: "A0201",
    });
    expect(result.categories).toEqual([]);
    expect(result.basis).toBe("lcls");
    expect(result.unresolvedLcls).toEqual(["ZZ", "ZZ99"]);
  });

  it("공식이지만 5개 관심사에 매핑되지 않는 코드는 미해석이 아니다(정상 제외)", () => {
    const result = classifyInterests({
      lclsSystm1: "AC",
      lclsSystm2: "AC01",
      lclsSystm3: "AC010100",
    });
    expect(result.categories).toEqual([]);
    expect(result.unresolvedLcls).toEqual([]);
  });

  it("공식 L1이 숙박(AC)이면 contentTypeId=28 신호가 있어도 레저로 보지 않는다", () => {
    const result = classifyInterests({
      lclsSystm1: "AC",
      lclsSystm2: "AC05",
      lclsSystm3: "AC050100",
      contentTypeId: "28",
    });
    expect(result.categories).toEqual([]);
    expect(result.basis).toBe("lcls");
  });

  it("공식 L1이 쇼핑(SH)이면 contentTypeId 신호가 있어도 관심사로 보지 않는다", () => {
    expect(
      classifyInterests({
        lclsSystm1: "SH",
        lclsSystm2: "SH01",
        contentTypeId: "14",
      }).categories,
    ).toEqual([]);
  });

  it("공식 L1이 관심사 버킷(LS)이면 contentTypeId=28 신호는 그대로 유지된다", () => {
    expect(
      classifyInterests({
        lclsSystm1: "LS",
        lclsSystm2: "LS01",
        contentTypeId: "28",
      }).categories,
    ).toEqual(["leisure"]);
  });
});

describe("classifyInterests — 구 분류 충돌", () => {
  it("새 분류(HS)와 구 분류(A0206 문화)가 다르면 새 분류가 이긴다", () => {
    const result = classifyInterests({
      lclsSystm1: "HS",
      lclsSystm2: "HS01",
      lclsSystm3: "HS010200",
      cat1: "A02",
      cat2: "A0206",
      cat3: "A02060100",
      contentTypeId: "12",
    });
    expect(result.categories).toEqual(["history"]);
    expect(result.categories).not.toContain("culture");
  });

  it("구 분류 충돌이 있어도 contentTypeId 14 는 두 경로 공통 신호라 유지된다", () => {
    const result = classifyInterests({
      lclsSystm1: "HS",
      lclsSystm2: "HS02",
      contentTypeId: "14",
      cat2: "A0201",
    });
    expect(result.categories).toEqual(["history", "culture"]);
  });
});

describe("detailClassification — 결함 2 (새 세부 분류 우선)", () => {
  it("새 분류만 있고 구 cat 이 빈 서로 다른 역사 명소가 다른 값을 갖는다", () => {
    // 공산성 HS010200 vs 불국사 HS030100 — 실측 회귀 표본.
    const gongsanseong = detailClassification({
      lclsSystm2: "HS01",
      lclsSystm3: "HS010200",
      cat2: "",
      cat3: "",
      categories: ["history"],
    });
    const bulguksa = detailClassification({
      lclsSystm2: "HS03",
      lclsSystm3: "HS030100",
      cat2: "",
      cat3: "",
      categories: ["history"],
    });
    expect(gongsanseong).toBe("HS010200");
    expect(bulguksa).toBe("HS030100");
    expect(gongsanseong).not.toBe(bulguksa);
  });

  it("lclsSystm3 → lclsSystm2 → cat3 → cat2 → 관심사 조합 순으로 물러난다", () => {
    expect(
      detailClassification({ lclsSystm3: "HS010200", lclsSystm2: "HS01" }),
    ).toBe("HS010200");
    expect(detailClassification({ lclsSystm2: "HS01" })).toBe("HS01");
    expect(detailClassification({ cat3: "A02010100", cat2: "A0201" })).toBe(
      "A02010100",
    );
    expect(detailClassification({ cat2: "A0201" })).toBe("A0201");
    expect(detailClassification({ categories: ["history", "culture"] })).toBe(
      "history+culture",
    );
  });

  it("구 수집본(새 분류 없음)은 구 cat 기준을 그대로 쓴다", () => {
    expect(
      detailClassification({
        cat2: "A0201",
        cat3: "A02010200",
        categories: ["history"],
      }),
    ).toBe("A02010200");
  });
});
