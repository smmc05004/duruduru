import type { Coordinates } from "./domain-data";
export type OfflineGeocodeRequest = {
  sourceId: string;
  address: string;
  provider: string;
  matchEvidence: string;
};
export function validateOfflineGeocodeRequest(r: OfflineGeocodeRequest) {
  return [r.sourceId, r.address, r.provider, r.matchEvidence].some(
    (v) => !v.trim(),
  )
    ? ["원천 ID·주소·제공자·단일 정확 일치 근거가 필요합니다."]
    : [];
}
export type CoordinateEvidence = {
  kind: "tourapi" | "offline-geocode" | "support-condition";
  source: string;
  sourceRecordId: string | null;
  collectedAt: string;
  dataVersion: string | null;
  rawAddress: string | null;
  query: string | null;
  selectedAddress: string | null;
  matchEvidence: string;
  coordinates: Coordinates | null;
  missingReason: string | null;
};

export type CollectionBatchEvidence = {
  id: string;
  termsCheckedAt: string;
  providerTermsUrl: string;
  routeRequestTemplate: string;
  callLimitEvidence: string;
  storagePolicyEvidence: string;
  displayPolicyEvidence: string;
  redistributionPolicyEvidence: string;
  rawResponseRetentionEvidence: string;
};
export type RouteCollectionManifest = {
  version: string;
  policyVersion: string;
  collectionBatch: CollectionBatchEvidence | null;
  routes: {
    fromId: string;
    toId: string;
    from: CoordinateEvidence;
    to: CoordinateEvidence;
    transport: "car";
    distanceKm: number | null;
    estimatedHours: number | null;
    dataStatus: "estimate" | "missing";
    estimate: true;
    reproductionId: string | null;
    provider: string | null;
    dataset: string | null;
    basisDate: string | null;
    dataVersion: string | null;
    missingReason: string | null;
  }[];
};
const valid = (c: Coordinates | null) =>
  !!c &&
  Number.isFinite(c.latitude) &&
  Number.isFinite(c.longitude) &&
  c.latitude >= -90 &&
  c.latitude <= 90 &&
  c.longitude >= -180 &&
  c.longitude <= 180;

const hasText = (value: string | null) => !!value?.trim();
const validDate = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const validCollectionBatch = (batch: CollectionBatchEvidence | null) =>
  !!batch &&
  hasText(batch.id) &&
  validDate(batch.termsCheckedAt) &&
  hasText(batch.providerTermsUrl) &&
  hasText(batch.routeRequestTemplate) &&
  hasText(batch.callLimitEvidence) &&
  hasText(batch.storagePolicyEvidence) &&
  hasText(batch.displayPolicyEvidence) &&
  hasText(batch.redistributionPolicyEvidence) &&
  hasText(batch.rawResponseRetentionEvidence);

export function validateRouteCollectionManifest(m: RouteCollectionManifest) {
  const issues: string[] = [];
  if (!hasText(m.version) || !hasText(m.policyVersion))
    issues.push("매니페스트 버전 결측");
  const keys = new Set<string>();
  for (const r of m.routes) {
    const k = `${r.fromId}:${r.toId}`;
    if (!hasText(r.fromId) || !hasText(r.toId))
      issues.push(`경로 끝점 ID 결측: ${k}`);
    if (keys.has(k)) issues.push(`중복 방향성 경로: ${k}`);
    keys.add(k);
    for (const p of [r.from, r.to]) {
      if (
        !hasText(p.source) ||
        !validDate(p.collectedAt) ||
        !hasText(p.matchEvidence)
      )
        issues.push(`provenance 결측: ${k}`);
      if (!hasText(p.sourceRecordId))
        issues.push(`좌표 원천 레코드 ID 결측: ${k}`);
      if (p.kind === "tourapi" && !hasText(p.dataVersion))
        issues.push(`TourAPI 좌표 데이터 버전 결측: ${k}`);
      if (p.kind === "tourapi" && !p.sourceRecordId)
        issues.push(`TourAPI 원천 레코드 ID 결측: ${k}`);
      if (
        p.kind === "offline-geocode" &&
        (!hasText(p.rawAddress) ||
          !hasText(p.query) ||
          !hasText(p.selectedAddress) ||
          !hasText(p.matchEvidence))
      )
        issues.push(`오프라인 지오코딩 provenance 결측: ${k}`);
      if (!valid(p.coordinates) && !hasText(p.missingReason))
        issues.push(`좌표 결측 사유: ${k}`);
      if (p.coordinates && !valid(p.coordinates))
        issues.push(`WGS84 범위 오류: ${k}`);
    }
    const hasDistance = r.distanceKm !== null;
    const hasHours = r.estimatedHours !== null;
    if (r.estimate !== true || !["estimate", "missing"].includes(r.dataStatus))
      issues.push(`경로 상태 값 오류: ${k}`);
    if (hasDistance !== hasHours) issues.push(`거리·시간 동시성 오류: ${k}`);
    if (
      r.dataStatus === "estimate" &&
      (!hasDistance || !hasHours || r.missingReason)
    )
      issues.push(`추정 경로 상태 오류: ${k}`);
    if (
      r.dataStatus === "missing" &&
      (hasDistance || hasHours || !hasText(r.missingReason))
    )
      issues.push(`결측 경로 상태 오류: ${k}`);
    if ((!hasDistance || !hasHours) && !hasText(r.missingReason))
      issues.push(`경로 결측 사유: ${k}`);
    if (
      !hasText(r.reproductionId) ||
      !hasText(r.provider) ||
      !hasText(r.dataset) ||
      !validDate(r.basisDate) ||
      !hasText(r.dataVersion) ||
      !validCollectionBatch(m.collectionBatch) ||
      (hasDistance &&
        (!(r.distanceKm! > 0) ||
          !(r.estimatedHours! > 0) ||
          !valid(r.from.coordinates) ||
          !valid(r.to.coordinates)))
    )
      issues.push(`경로 메타데이터 결측: ${k}`);
  }
  return issues;
}
