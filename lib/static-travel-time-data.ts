import type {
  DomainDataAdapter,
  OriginDestinationTravelTime,
  PlaceTravelTime,
} from "./domain-data";
import {
  validateRouteCollectionManifest,
  type CollectionBatchEvidence,
  type CoordinateEvidence,
} from "./route-collection";
import { supportConditionsV1, type TransportMode } from "./support-conditions";

/** 사전 수집된 도로 경로 값에만 허용하는 신뢰도 상태다. */
export type StaticTravelTimeStatus = "estimate" | "missing";

export type StaticTravelTimeRecord = {
  transport: TransportMode;
  distanceKm: number | null;
  estimatedHours: number | null;
  /** 정적 일반 이동시간은 실시간 교통값이 아니므로 항상 추정값이다. */
  estimate: true;
  source: string;
  dataset: string;
  basisDate: string;
  dataVersion: string;
  policyVersion: string;
  /** 제공자 요청/내보내기/수동 수집을 다시 찾을 수 있는 공개 식별자다. */
  reproductionId: string;
  dataStatus: StaticTravelTimeStatus;
  missingReason: string | null;
  fromCoordinate: CoordinateEvidence;
  toCoordinate: CoordinateEvidence;
};

export type StaticOriginDestinationTravelTime = StaticTravelTimeRecord & {
  originId: string;
  destinationId: string;
};

export type StaticPlaceTravelTime = StaticTravelTimeRecord & {
  fromPlaceId: string;
  toPlaceId: string;
};

export type OriginDestinationTarget = {
  originId: string;
  destinationId: string;
  transport: "car";
};

export type StaticTravelTimeManifest = {
  version: string;
  policyVersion: string;
  collectionBatch: CollectionBatchEvidence | null;
  originDestinationTargets: OriginDestinationTarget[];
  originDestinationRecords: StaticOriginDestinationTravelTime[];
  placeTravelTimeRecords: StaticPlaceTravelTime[];
};

const originDestinationTargets = (): OriginDestinationTarget[] =>
  supportConditionsV1.origins.flatMap((origin) =>
    supportConditionsV1.destinations.map((destination) => ({
      originId: origin.id,
      destinationId: destination.id,
      transport: "car" as const,
    })),
  );

const pendingCoordinateEvidence = (
  sourceRecordId: string,
): CoordinateEvidence => ({
  kind: "tourapi",
  source: "지원 조건 기준점 수집 대상",
  sourceRecordId,
  collectedAt: "2026-09-03",
  dataVersion: "support-conditions-v1",
  rawAddress: null,
  query: null,
  selectedAddress: null,
  matchEvidence: "승인된 지원 조건의 기준점",
  coordinates: null,
  missingReason: "WGS84 좌표 수집 전",
});

const pendingCollectionBatch: CollectionBatchEvidence = {
  id: "pending-2026-09-03",
  termsCheckedAt: "2026-09-03",
  callLimitEvidence: "경로 제공자 선정 전: 호출 없음",
  storagePolicyEvidence: "경로 제공자 선정 전: 저장 없음",
  displayPolicyEvidence: "경로 제공자 선정 전: 표시 없음",
  redistributionPolicyEvidence: "경로 제공자 선정 전: 재배포 없음",
  rawResponseRetentionEvidence: "경로 제공자 선정 전: 원시 응답 없음",
};

const pendingOriginDestinationRecords =
  (): StaticOriginDestinationTravelTime[] =>
    originDestinationTargets().map((target) => ({
      ...target,
      distanceKm: null,
      estimatedHours: null,
      estimate: true,
      source: "수집 전",
      dataset: "수집 대상 매니페스트",
      basisDate: "2026-09-03",
      dataVersion: "pending-2026-09-03",
      policyVersion: "2026-09-03",
      reproductionId: `missing:${target.originId}:${target.destinationId}:car`,
      dataStatus: "missing",
      missingReason: "허용된 도로 경로 수집 전",
      fromCoordinate: pendingCoordinateEvidence(target.originId),
      toCoordinate: pendingCoordinateEvidence(target.destinationId),
    }));

/**
 * E4/E6 정적 이동시간 수집 매니페스트.
 *
 * 숫자가 없다는 것은 아직 허용된 출처·재현 방법이 확보되지 않았다는 뜻이다. 이 파일은
 * 수집 대상을 보존하지만 PoC 값이나 임의 추정값을 넣어 결측을 감추지 않는다.
 */
export const staticTravelTimeManifestV1: StaticTravelTimeManifest = {
  version: "2026-09-03",
  policyVersion: "2026-09-03",
  collectionBatch: pendingCollectionBatch,
  originDestinationTargets: originDestinationTargets(),
  originDestinationRecords: pendingOriginDestinationRecords(),
  placeTravelTimeRecords: [],
};

const hasText = (value: string) => value.trim().length > 0;
const hasIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function validateRecord(
  record: StaticTravelTimeRecord,
  label: string,
): string[] {
  const issues: string[] = [];
  if (record.transport !== "car")
    issues.push(`${label}.transport는 car여야 합니다.`);
  if (
    record.dataStatus === "estimate" &&
    !(Number.isFinite(record.distanceKm) && (record.distanceKm ?? 0) > 0)
  )
    issues.push(`${label}.distanceKm은 0보다 큰 유한 수여야 합니다.`);
  if (
    record.dataStatus === "estimate" &&
    !(
      Number.isFinite(record.estimatedHours) && (record.estimatedHours ?? 0) > 0
    )
  )
    issues.push(`${label}.estimatedHours는 0보다 큰 유한 수여야 합니다.`);
  if (!record.estimate)
    issues.push(`${label}.estimate는 정적 일반 이동시간의 true여야 합니다.`);
  if (record.dataStatus === "missing") {
    if (record.distanceKm !== null || record.estimatedHours !== null)
      issues.push(`${label}.missing 레코드는 거리·시간이 null이어야 합니다.`);
    if (!hasText(record.missingReason ?? ""))
      issues.push(`${label}.missingReason이 필요합니다.`);
  }
  if (!hasText(record.source)) issues.push(`${label}.source가 필요합니다.`);
  if (!hasIsoDate(record.basisDate))
    issues.push(`${label}.basisDate는 YYYY-MM-DD여야 합니다.`);
  if (!hasText(record.policyVersion))
    issues.push(`${label}.policyVersion이 필요합니다.`);
  if (!hasText(record.reproductionId))
    issues.push(`${label}.reproductionId가 필요합니다.`);
  return issues;
}

/** 수집 전·후 매니페스트가 날짜/출처/재현 근거 없이 값만 보관하지 않게 한다. */
export function validateStaticTravelTimeManifest(
  manifest: StaticTravelTimeManifest,
): string[] {
  const issues: string[] = [];
  if (!hasText(manifest.version)) issues.push("manifest.version이 필요합니다.");
  if (!hasText(manifest.policyVersion))
    issues.push("manifest.policyVersion이 필요합니다.");

  const targetKeys = new Set<string>();
  for (const target of manifest.originDestinationTargets) {
    const key = `${target.originId}:${target.destinationId}:${target.transport}`;
    if (targetKeys.has(key)) issues.push(`중복된 3×3 수집 대상: ${key}`);
    targetKeys.add(key);
  }

  for (const expected of originDestinationTargets()) {
    const key = `${expected.originId}:${expected.destinationId}:${expected.transport}`;
    if (!targetKeys.has(key))
      issues.push(`필수 3×3 수집 대상이 없습니다: ${key}`);
  }

  const originRecordKeys = new Set<string>();
  for (const record of manifest.originDestinationRecords) {
    const key = `${record.originId}:${record.destinationId}:${record.transport}`;
    if (originRecordKeys.has(key))
      issues.push(`중복된 origin-destination 이동시간 레코드: ${key}`);
    originRecordKeys.add(key);
    if (!targetKeys.has(key))
      issues.push(`3×3 수집 대상에 없는 이동시간 레코드: ${key}`);
    issues.push(...validateRecord(record, `originDestinationRecords(${key})`));
    issues.push(
      ...validateRouteCollectionManifest({
        version: manifest.version,
        policyVersion: manifest.policyVersion,
        collectionBatch: manifest.collectionBatch,
        routes: [
          {
            fromId: record.originId,
            toId: record.destinationId,
            from: record.fromCoordinate,
            to: record.toCoordinate,
            transport: "car",
            distanceKm: record.distanceKm,
            estimatedHours: record.estimatedHours,
            dataStatus: record.dataStatus,
            estimate: record.estimate,
            reproductionId: record.reproductionId,
            provider: record.source,
            dataset: record.dataset,
            basisDate: record.basisDate,
            dataVersion: record.dataVersion,
            missingReason: record.missingReason,
          },
        ],
      }),
    );
  }
  const placeRecordKeys = new Set<string>();
  for (const record of manifest.placeTravelTimeRecords) {
    const key = `${record.fromPlaceId}:${record.toPlaceId}:${record.transport}`;
    if (placeRecordKeys.has(key))
      issues.push(`중복된 place 이동시간 레코드: ${key}`);
    placeRecordKeys.add(key);
    issues.push(...validateRecord(record, `placeTravelTimeRecords(${key})`));
    issues.push(
      ...validateRouteCollectionManifest({
        version: manifest.version,
        policyVersion: manifest.policyVersion,
        collectionBatch: manifest.collectionBatch,
        routes: [
          {
            fromId: record.fromPlaceId,
            toId: record.toPlaceId,
            from: record.fromCoordinate,
            to: record.toCoordinate,
            transport: "car",
            distanceKm: record.distanceKm,
            estimatedHours: record.estimatedHours,
            dataStatus: record.dataStatus,
            estimate: record.estimate,
            reproductionId: record.reproductionId,
            provider: record.source,
            dataset: record.dataset,
            basisDate: record.basisDate,
            dataVersion: record.dataVersion,
            missingReason: record.missingReason,
          },
        ],
      }),
    );
  }
  return issues;
}

type ProvenancedOriginTravelTime = OriginDestinationTravelTime & {
  dataVersion: string;
  policyVersion: string;
  reproductionId: string;
};

type ProvenancedPlaceTravelTime = PlaceTravelTime & {
  distanceKm: number;
  dataVersion: string;
  policyVersion: string;
  reproductionId: string;
};

/**
 * 런타임 경로 요청을 하지 않는 정적 내부 데이터 어댑터다.
 * 유효하지 않은 매니페스트는 데이터 준비 오류이므로 호출 전에 명시적으로 중단한다.
 */
export function createStaticTravelTimeAdapter(
  manifest: StaticTravelTimeManifest,
): Pick<DomainDataAdapter, "lookupOriginTravelTime" | "lookupPlaceTravelTime"> {
  const issues = validateStaticTravelTimeManifest(manifest);
  if (issues.length)
    throw new Error(`정적 이동시간 매니페스트 오류: ${issues.join(" ")}`);

  return {
    lookupOriginTravelTime(originId, destinationId, transport) {
      const record = manifest.originDestinationRecords.find(
        (item) =>
          item.originId === originId &&
          item.destinationId === destinationId &&
          item.transport === transport,
      );
      if (!record) return null;
      if (record.dataStatus === "missing") return null;
      const result: ProvenancedOriginTravelTime = {
        originId: record.originId,
        destinationId: record.destinationId,
        transport: record.transport,
        oneWayHours: record.estimatedHours!,
        distanceKm: record.distanceKm!,
        method: "정적 사전 수집 도로 경로",
        basisDate: record.basisDate,
        dataVersion: record.dataVersion,
        policyVersion: record.policyVersion,
        reproductionId: record.reproductionId,
        provenance: {
          source: record.source,
          collectedAt: record.basisDate,
          dataStatus: record.dataStatus,
          dataVersion: record.dataVersion,
        },
      };
      return result;
    },
    lookupPlaceTravelTime(fromPlaceId, toPlaceId, transport) {
      const record = manifest.placeTravelTimeRecords.find(
        (item) =>
          item.fromPlaceId === fromPlaceId &&
          item.toPlaceId === toPlaceId &&
          item.transport === transport,
      );
      if (!record) return null;
      if (record.dataStatus === "missing") return null;
      const result: ProvenancedPlaceTravelTime = {
        fromPlaceId: record.fromPlaceId,
        toPlaceId: record.toPlaceId,
        transport: record.transport,
        estimatedHours: record.estimatedHours!,
        distanceKm: record.distanceKm!,
        method: "정적 사전 수집 도로 경로",
        basisDate: record.basisDate,
        dataVersion: record.dataVersion,
        policyVersion: record.policyVersion,
        reproductionId: record.reproductionId,
        provenance: {
          source: record.source,
          collectedAt: record.basisDate,
          dataStatus: record.dataStatus,
          dataVersion: record.dataVersion,
        },
      };
      return result;
    },
  };
}
