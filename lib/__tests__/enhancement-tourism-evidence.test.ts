/** @jest-environment node */
import { describe, expect, it } from "@jest/globals";
import {
  computePurposeEvidence,
  hubEvidenceFor,
  hubRankForSelection,
  regionCentralStatus,
} from "@/lib/tourism-evidence";
import type { Attraction } from "@/lib/mvp-phase-two-types";
import type { MvpCategoryId } from "@/lib/mvp-region-data";

const value = (hubRank: number) => 1 / Math.log2(1 + hubRank);

function place(
  contentId: string,
  regionId: string,
  categories: MvpCategoryId[],
  overrides: Partial<Attraction> = {},
): Attraction {
  return {
    contentId,
    contentTypeId: "12",
    regionId,
    title: `place ${contentId}`,
    address: `주소 ${contentId}`,
    imageUrl: "",
    coordinates: null,
    categories,
    cat1: "",
    cat2: "",
    cat3: "",
    ...overrides,
  };
}

// 회귀 픽스처: data/tourism-evidence.json 정상본의 확정 연결 항목.
// 종로구(ktdb-zone-1) 역사 허브 순위: 126537=6, 126512=14, 126511=36, 126514=70.
// 서대문구(ktdb-zone-13): 127425=역사 r19, 130152=문화 r2.
// 광주 동구(ktdb-zone-61): 중심 자료 없음(empty).

describe("T5 목적 근거 점수 (D4)", () => {
  it("확정 연결·비-비일정 허브만 근거로 읽는다", () => {
    expect(hubEvidenceFor("ktdb-zone-1", "126537")?.hubRank).toBe(6);
    expect(
      hubRankForSelection(place("126537", "ktdb-zone-1", ["history"])),
    ).toBe(6);
    // 없는 contentId
    expect(hubEvidenceFor("ktdb-zone-1", "does-not-exist")).toBeNull();
    // 비일정(숙박·쇼핑·교통) 허브 매치는 null (더스테이힐링파크 118존)
    expect(hubEvidenceFor("ktdb-zone-118", "3079601")).toBeNull();
  });

  it("관심사별 상위 3개 값의 합 ÷ 3, 요청 관심사 평균이며 상한은 1이다", () => {
    const placed = [
      place("126537", "ktdb-zone-1", ["history"]),
      place("126512", "ktdb-zone-1", ["history"]),
      place("126511", "ktdb-zone-1", ["history"]),
      place("126514", "ktdb-zone-1", ["history"]), // r70: 상위 3개에서 탈락
    ];
    const result = computePurposeEvidence(placed, ["history"], ["ktdb-zone-1"]);
    const expected = (value(6) + value(14) + value(36)) / 3;
    expect(result.status).toBe("scored");
    expect(result.score).toBeCloseTo(expected, 10);
    expect(result.perInterest.history).toBeCloseTo(expected, 10);
    expect(result.score! <= 1).toBe(true);
    expect(result.contributingContentIds.sort()).toEqual([
      "126511",
      "126512",
      "126537",
    ]);
    expect(result.matchedHubCount).toBe(4);
  });

  it("여러 관심사는 관심사별 점수의 평균이고, 근거 없는 관심사는 0이다", () => {
    const placed = [
      place("127425", "ktdb-zone-13", ["history"]),
      place("130152", "ktdb-zone-13", ["culture"]),
    ];
    const result = computePurposeEvidence(
      placed,
      ["history", "culture", "leisure"],
      ["ktdb-zone-13"],
    );
    const expected = (value(19) / 3 + value(2) / 3 + 0) / 3;
    expect(result.score).toBeCloseTo(expected, 10);
    expect(result.perInterest.leisure).toBe(0);
  });

  it("초안 배치 관광지만 점수 근거다 — 미배치 명소는 반영하지 않는다", () => {
    const placedOnly = [place("126537", "ktdb-zone-1", ["history"])];
    const result = computePurposeEvidence(
      placedOnly,
      ["history"],
      ["ktdb-zone-1"],
    );
    expect(result.contributingContentIds).toEqual(["126537"]);
    expect(result.score).toBeCloseTo(value(6) / 3, 10);
  });

  it("같은 시설로 묶이는 배치 관광지는 가장 높은 순위 하나만 인정한다", () => {
    const shared = {
      address: "서울 종로구 같은길 1",
      coordinates: { latitude: 37.5796, longitude: 126.977 },
    };
    const placed = [
      place("126537", "ktdb-zone-1", ["history"], {
        ...shared,
        title: "경복궁 근정전",
      }),
      place("126514", "ktdb-zone-1", ["history"], {
        ...shared,
        title: "경복궁 향원정",
      }),
    ];
    const result = computePurposeEvidence(placed, ["history"], ["ktdb-zone-1"]);
    expect(result.contributingContentIds).toEqual(["126537"]); // r6 > r70
    expect(result.perInterest.history).toBeCloseTo(value(6) / 3, 10);
  });

  it("중심 자료가 없는 지역은 status를 보존하고 지역 매력 0으로 표현하지 않는다", () => {
    expect(regionCentralStatus("ktdb-zone-61")).toBe("empty");
    const result = computePurposeEvidence(
      [place("126537", "ktdb-zone-61", ["history"])],
      ["history"],
      ["ktdb-zone-61"],
    );
    expect(result.status).toBe("no-central-data");
    expect(result.score).toBe(0);
    expect(result.centralEmptyRegionIds).toEqual(["ktdb-zone-61"]);
  });

  it("일부 구성 지역만 empty면 scored이고 empty 지역을 별도 보존한다", () => {
    const result = computePurposeEvidence(
      [place("126537", "ktdb-zone-1", ["history"])],
      ["history"],
      ["ktdb-zone-1", "ktdb-zone-61"],
    );
    expect(result.status).toBe("scored");
    expect(result.centralEmptyRegionIds).toEqual(["ktdb-zone-61"]);
  });

  it("같은 데이터 버전에서 결정적이다", () => {
    const placed = [
      place("126512", "ktdb-zone-1", ["history"]),
      place("126537", "ktdb-zone-1", ["history"]),
    ];
    const a = computePurposeEvidence(placed, ["history"], ["ktdb-zone-1"]);
    const b = computePurposeEvidence(
      [...placed].reverse(),
      ["history"],
      ["ktdb-zone-1"],
    );
    expect(a).toEqual(b);
  });
});

describe("T7 목적 적합성 구간 (D4)", () => {
  const withType = (
    contentId: string,
    categories: MvpCategoryId[],
    lclsSystm3: string,
  ) =>
    place(contentId, "region-x", categories, {
      lclsSystm1: "HS",
      lclsSystm3,
      // 서로 다른 시설로 보이도록 주소를 다르게.
      address: `주소 ${contentId}`,
      coordinates: null,
    });

  it("관심사별 fit = min(시설,4) + min(유형,3), 평균으로 구간을 만든다", () => {
    const placed = [
      withType("a1", ["history"], "HS010100"),
      withType("a2", ["history"], "HS020100"),
      withType("a3", ["history"], "HS030100"),
    ];
    const r = computePurposeEvidence(placed, ["history"], ["region-x"]);
    expect(r.fitByInterest?.history).toEqual({
      facilities: 3,
      types: 3,
      fit: 6,
    });
    expect(r.fitAverage).toBe(6);
    expect(r.fitBand).toBe(1); // 4.5 <= 6 < 6.5
  });

  it("포화: 상한 이후 시설/유형을 늘려도 구간이 오르지 않는다", () => {
    const base = [
      withType("b1", ["history"], "HS010100"),
      withType("b2", ["history"], "HS020100"),
      withType("b3", ["history"], "HS030100"),
      withType("b4", ["history"], "HS040100"),
    ];
    const saturated = computePurposeEvidence(base, ["history"], ["region-x"]);
    expect(saturated.fitByInterest?.history).toEqual({
      facilities: 4,
      types: 4,
      fit: 7, // min(4,4) + min(4,3)
    });
    const more = computePurposeEvidence(
      [
        ...base,
        withType("b5", ["history"], "HS010200"),
        withType("b6", ["history"], "HS020200"),
      ],
      ["history"],
      ["region-x"],
    );
    expect(more.fitByInterest?.history?.fit).toBe(7);
    expect(more.fitBand).toBe(saturated.fitBand);
  });

  it("요청하지 않은 관심사 장소를 더해도 구간이 오르지 않는다", () => {
    const requested = [
      withType("c1", ["history"], "HS010100"),
      withType("c2", ["history"], "HS020100"),
      withType("c3", ["history"], "HS030100"),
    ];
    const baseline = computePurposeEvidence(
      requested,
      ["history"],
      ["region-x"],
    );
    const padded = computePurposeEvidence(
      [
        ...requested,
        place("pad1", "region-x", ["nature"], { lclsSystm1: "NA" }),
        place("pad2", "region-x", ["nature"], { lclsSystm1: "NA" }),
      ],
      ["history"],
      ["region-x"],
    );
    expect(padded.fitBand).toBe(baseline.fitBand);
    expect(padded.fitAverage).toBe(baseline.fitAverage);
  });

  it("분류 결측 시설은 독립 세부 유형으로 세지 않는다", () => {
    const placed = [
      place("d1", "region-x", ["history"], { address: "주소 d1" }),
      place("d2", "region-x", ["history"], { address: "주소 d2" }),
      place("d3", "region-x", ["history"], { address: "주소 d3" }),
    ];
    const r = computePurposeEvidence(placed, ["history"], ["region-x"]);
    expect(r.fitByInterest?.history?.types).toBe(0);
    expect(r.fitByInterest?.history?.facilities).toBe(3);
  });

  it("여러 관심사 시설은 관심사별 fit에 각각 기여한다", () => {
    const placed = [
      place("e1", "region-x", ["history", "culture"], {
        lclsSystm1: "HS",
        lclsSystm3: "HS010100",
        address: "주소 e1",
      }),
      place("e2", "region-x", ["history"], {
        lclsSystm1: "HS",
        lclsSystm3: "HS020100",
        address: "주소 e2",
      }),
      place("e3", "region-x", ["culture"], {
        lclsSystm1: "VE",
        lclsSystm2: "VE06",
        address: "주소 e3",
      }),
    ];
    const r = computePurposeEvidence(
      placed,
      ["history", "culture"],
      ["region-x"],
    );
    expect(r.fitByInterest?.history?.facilities).toBe(2); // e1, e2
    expect(r.fitByInterest?.culture?.facilities).toBe(2); // e1, e3
  });

  it("중심 자료가 없어도 구간은 실제 일정으로 계산하고 보조 근거만 0이다", () => {
    const placed = [
      withType("f1", ["history"], "HS010100"),
      withType("f2", ["history"], "HS020100"),
      withType("f3", ["history"], "HS030100"),
    ];
    const r = computePurposeEvidence(
      placed.map((p) => ({ ...p, regionId: "ktdb-zone-61" })),
      ["history"],
      ["ktdb-zone-61"],
    );
    expect(r.status).toBe("no-central-data");
    expect(r.fitBand).toBe(1);
    expect(r.matchedFacilityCount).toBe(0);
  });

  it("보조(중심 연결) 시설 수는 상한 4로 제한된다", () => {
    // 종로구(ktdb-zone-1) 확정 연결 역사 허브가 다수인 실제 정상본 사용.
    const placed = [
      place("126537", "ktdb-zone-1", ["history"], { address: "주소 1" }),
      place("126512", "ktdb-zone-1", ["history"], { address: "주소 2" }),
      place("126511", "ktdb-zone-1", ["history"], { address: "주소 3" }),
      place("126514", "ktdb-zone-1", ["history"], { address: "주소 4" }),
      place("126479", "ktdb-zone-1", ["nature"], { address: "주소 5" }),
    ];
    const r = computePurposeEvidence(
      placed,
      ["history", "nature"],
      ["ktdb-zone-1"],
    );
    expect(r.matchedFacilityCount).toBeLessThanOrEqual(4);
  });
});
