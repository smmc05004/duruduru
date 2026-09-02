import { describe, expect, it } from "@jest/globals";

import {
  buildDataQualityReport,
  type SurveyDataset,
} from "@/lib/data-quality-survey";
import { e2SurveyFixtures } from "@/lib/data-quality-fixtures";

const restaurantDataset: SurveyDataset = {
  kind: "restaurant",
  requiredFields: ["coordinates", "operatingHours", "closedDays", "menuText"],
  evidence: {
    source: "fixture: TourAPI 음식점 조사",
    sourceUrl: "https://example.invalid/tourapi-fixture",
    collectedAt: "2026-09-02T00:00:00.000Z",
    updatedAt: null,
    dataStatus: "normal",
    populationCount: 2,
    sampleCount: 2,
    limitations: ["운영시간은 자유 서식이므로 파싱 성공을 뜻하지 않는다."],
  },
  records: [
    {
      sourceRecordId: "tourapi:restaurant:gyeongju:1",
      fields: {
        coordinates: "129.2,35.8",
        operatingHours: "10:00-20:00",
        closedDays: "월요일",
        menuText: "메뉴 원문",
      },
    },
    {
      sourceRecordId: "tourapi:restaurant:gyeongju:2",
      fields: {
        coordinates: "129.3,35.9",
        operatingHours: "",
        closedDays: null,
        menuText: "메뉴 원문",
      },
    },
  ],
};

describe("E2 데이터 품질 조사", () => {
  it("안정 ID·출처·수집/갱신 시각·상태를 보존하고 필수 필드 충족률을 계산한다", () => {
    const report = buildDataQualityReport(restaurantDataset);

    expect(report.evidence).toEqual(restaurantDataset.evidence);
    expect(report.records[0]).toMatchObject({
      id: "tourapi:restaurant:gyeongju:1",
      updatedAt: null,
      provenance: {
        source: "fixture: TourAPI 음식점 조사",
        collectedAt: "2026-09-02T00:00:00.000Z",
        dataStatus: "normal",
      },
    });
    expect(report.fieldCoverage).toEqual([
      { field: "coordinates", present: 2, missing: 0, rate: 1 },
      { field: "operatingHours", present: 1, missing: 1, rate: 0.5 },
      { field: "closedDays", present: 1, missing: 1, rate: 0.5 },
      { field: "menuText", present: 2, missing: 0, rate: 1 },
    ]);
  });

  it("미달 필드를 기본값으로 채우지 않고 missing 상태와 제외 후보로 남긴다", () => {
    const report = buildDataQualityReport(restaurantDataset);

    expect(report.records[1]).toMatchObject({
      fields: { operatingHours: null, closedDays: null },
      provenance: { dataStatus: "missing" },
    });
    expect(report.records[1].exclusionReasons).toEqual([
      "operatingHours 결측",
      "closedDays 결측",
    ]);
  });

  it("표본이 모집단보다 작을 때 조사 한계를 보고서에 남긴다", () => {
    const report = buildDataQualityReport({
      ...restaurantDataset,
      evidence: { ...restaurantDataset.evidence, populationCount: 211 },
    });

    expect(report.limitations).toContain("표본 2건은 모집단 211건의 일부다.");
    expect(report.limitations).toContain(
      "운영시간은 자유 서식이므로 파싱 성공을 뜻하지 않는다.",
    );
  });

  it("관광지·축제·음식점·대표음식 fixture를 외부 연결 없이 모두 재현한다", () => {
    const reports = e2SurveyFixtures.map(buildDataQualityReport);

    expect(reports.map((report) => report.kind)).toEqual([
      "attraction",
      "festival",
      "restaurant",
      "representative-food",
    ]);
    expect(reports.every((report) => report.records.length > 0)).toBe(true);
    expect(
      reports.find((report) => report.kind === "representative-food")
        ?.records[0].provenance.dataStatus,
    ).toBe("missing");
  });

  it("교차 대조 전 대표음식 필드는 확인된 값처럼 채우지 않는다", () => {
    const food = e2SurveyFixtures.find(
      (fixture) => fixture.kind === "representative-food",
    );

    expect(food?.evidence.dataStatus).toBe("missing");
    expect(food?.records[0].fields).toMatchObject({
      destinationId: null,
      provider: null,
      dataset: null,
      sourceUrl: null,
      evidence: null,
    });
  });
});
