/**
 * E2의 고정 조사 fixture를 API 키 없이 계약 기반 보고서로 재현한다.
 * 사용: npm run check:data-quality
 */
import fixture from "./fixtures/e2-data-quality.json" with { type: "json" };

const missing = (value) =>
  value === null || value === undefined || String(value).trim().length === 0;

const reports = fixture.map((dataset) => {
  const records = dataset.records.map((record) => {
    const fields = Object.fromEntries(
      Object.entries(record.fields).map(([field, value]) => [
        field,
        missing(value) ? null : String(value).trim(),
      ]),
    );
    const exclusionReasons = dataset.requiredFields
      .filter((field) => missing(fields[field]))
      .map((field) => `${field} 결측`);
    return {
      id: record.sourceRecordId,
      fields,
      exclusionReasons,
      updatedAt: dataset.evidence.updatedAt,
      provenance: {
        source: dataset.evidence.source,
        collectedAt: dataset.evidence.collectedAt,
        dataStatus:
          exclusionReasons.length > 0 ? "missing" : dataset.evidence.dataStatus,
      },
    };
  });
  return {
    kind: dataset.kind,
    evidence: dataset.evidence,
    records,
    fieldCoverage: dataset.requiredFields.map((field) => {
      const present = records.filter(
        (record) => !missing(record.fields[field]),
      ).length;
      return {
        field,
        present,
        missing: records.length - present,
        rate: records.length === 0 ? 0 : present / records.length,
      };
    }),
    limitations: [
      ...dataset.evidence.limitations,
      ...(dataset.evidence.sampleCount < dataset.evidence.populationCount
        ? [
            `표본 ${dataset.evidence.sampleCount}건은 모집단 ${dataset.evidence.populationCount}건의 일부다.`,
          ]
        : []),
    ],
  };
});

console.log(JSON.stringify(reports, null, 2));
