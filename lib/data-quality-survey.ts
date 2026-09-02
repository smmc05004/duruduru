import type { DataProvenance, DomainDataStatus } from "./domain-data";

/** E2에서 조사하는 데이터 묶음. 정식 수집·저장소 선택을 뜻하지 않는다. */
export type SurveyDatasetKind =
  "attraction" | "festival" | "restaurant" | "representative-food";

export type SurveyEvidence = {
  source: string;
  sourceUrl: string;
  collectedAt: string;
  updatedAt: string | null;
  dataStatus: DomainDataStatus;
  /** 조사 대상 전체 수. API 페이지·키 제한으로 표본만 조사했으면 표본보다 크다. */
  populationCount: number;
  sampleCount: number;
  limitations: string[];
};

export type SurveyRecordInput = {
  /** 외부 소스의 안정 식별자를 소스 이름과 함께 보존한다. */
  sourceRecordId: string;
  /** 빈 문자열도 결측이다. 조사 단계에서 임의 기본값을 넣지 않는다. */
  fields: Record<string, string | null>;
};

export type SurveyDataset = {
  kind: SurveyDatasetKind;
  requiredFields: string[];
  evidence: SurveyEvidence;
  records: SurveyRecordInput[];
};

export type SurveyRecord = {
  id: string;
  fields: Record<string, string | null>;
  exclusionReasons: string[];
  /** 외부 원문이 제공한 마지막 갱신 시각. 모르면 null을 보존한다. */
  updatedAt: string | null;
  provenance: DataProvenance;
};

export type FieldCoverage = {
  field: string;
  present: number;
  missing: number;
  rate: number;
};

export type DataQualityReport = {
  kind: SurveyDatasetKind;
  evidence: SurveyEvidence;
  records: SurveyRecord[];
  fieldCoverage: FieldCoverage[];
  limitations: string[];
};

const asMissing = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim().length === 0;

const normalizedValue = (value: string | null | undefined) =>
  asMissing(value) ? null : (value?.trim() ?? null);

function normalizeRecord(
  record: SurveyRecordInput,
  dataset: SurveyDataset,
): SurveyRecord {
  const fields = Object.fromEntries(
    Object.entries(record.fields).map(([field, value]) => [
      field,
      normalizedValue(value),
    ]),
  );
  const exclusionReasons = dataset.requiredFields
    .filter((field) => asMissing(fields[field]))
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
}

/**
 * fixture 또는 선택적 외부 프로브의 원문을 재현 가능한 품질 보고서로 바꾼다.
 * 이 함수는 운영시간을 해석하거나 누락값을 보정하지 않는다.
 */
export function buildDataQualityReport(
  dataset: SurveyDataset,
): DataQualityReport {
  const records = dataset.records.map((record) =>
    normalizeRecord(record, dataset),
  );
  const fieldCoverage = dataset.requiredFields.map((field) => {
    const present = records.filter(
      (record) => !asMissing(record.fields[field]),
    ).length;
    const missing = records.length - present;
    return {
      field,
      present,
      missing,
      rate: records.length === 0 ? 0 : present / records.length,
    };
  });
  const limitations = [...dataset.evidence.limitations];
  if (dataset.evidence.sampleCount < dataset.evidence.populationCount) {
    limitations.push(
      `표본 ${dataset.evidence.sampleCount}건은 모집단 ${dataset.evidence.populationCount}건의 일부다.`,
    );
  }

  return {
    kind: dataset.kind,
    evidence: dataset.evidence,
    records,
    fieldCoverage,
    limitations,
  };
}
