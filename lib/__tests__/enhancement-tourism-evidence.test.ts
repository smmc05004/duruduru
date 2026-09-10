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
