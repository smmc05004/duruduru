import type {
  DomainDataAdapter,
  OriginDestinationTravelTime,
  PlaceTravelTime,
} from "./domain-data";
import { supportConditionsV1, type TransportMode } from "./support-conditions";

/** 사전 수집된 도로 경로 값에만 허용하는 신뢰도 상태다. */
export type StaticTravelTimeStatus = "estimate";

export type StaticTravelTimeRecord = {
  transport: TransportMode;
  distanceKm: number;
  estimatedHours: number;
  /** 정적 일반 이동시간은 실시간 교통값이 아니므로 항상 추정값이다. */
  estimate: true;
  source: string;
  basisDate: string;
  policyVersion: string;
  /** 제공자 요청/내보내기/수동 수집을 다시 찾을 수 있는 공개 식별자다. */
  reproductionId: string;
  dataStatus: StaticTravelTimeStatus;
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

/**
 * E4/E6 정적 이동시간 수집 매니페스트.
 *
 * 숫자가 없다는 것은 아직 허용된 출처·재현 방법이 확보되지 않았다는 뜻이다. 이 파일은
 * 수집 대상을 보존하지만 PoC 값이나 임의 추정값을 넣어 결측을 감추지 않는다.
 */
export const staticTravelTimeManifestV1: StaticTravelTimeManifest = {
  version: "2026-09-03",
  policyVersion: "2026-09-03",
  originDestinationTargets: originDestinationTargets(),
  originDestinationRecords: [],
  placeTravelTimeRecords: [],
};

const hasText = (value: string) => value.trim().length > 0;
const hasIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function validateRecord(
  record: StaticTravelTimeRecord,
  label: string,
): string[] {
  const issues: string[] = [];
  if (!(Number.isFinite(record.distanceKm) && record.distanceKm > 0))
    issues.push(`${label}.distanceKm은 0보다 큰 유한 수여야 합니다.`);
  if (!(Number.isFinite(record.estimatedHours) && record.estimatedHours > 0))
    issues.push(`${label}.estimatedHours는 0보다 큰 유한 수여야 합니다.`);
  if (!record.estimate)
    issues.push(`${label}.estimate는 정적 일반 이동시간의 true여야 합니다.`);
  if (record.dataStatus !== "estimate")
    issues.push(`${label}.dataStatus는 estimate여야 합니다.`);
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
  }
  const placeRecordKeys = new Set<string>();
  for (const record of manifest.placeTravelTimeRecords) {
    const key = `${record.fromPlaceId}:${record.toPlaceId}:${record.transport}`;
    if (placeRecordKeys.has(key))
      issues.push(`중복된 place 이동시간 레코드: ${key}`);
    placeRecordKeys.add(key);
    issues.push(...validateRecord(record, `placeTravelTimeRecords(${key})`));
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
      const result: ProvenancedOriginTravelTime = {
        originId: record.originId,
        destinationId: record.destinationId,
        transport: record.transport,
        oneWayHours: record.estimatedHours,
        distanceKm: record.distanceKm,
        method: "정적 사전 수집 도로 경로",
        basisDate: record.basisDate,
        dataVersion: manifest.version,
        policyVersion: record.policyVersion,
        reproductionId: record.reproductionId,
        provenance: {
          source: record.source,
          collectedAt: record.basisDate,
          dataStatus: record.dataStatus,
          dataVersion: manifest.version,
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
      const result: ProvenancedPlaceTravelTime = {
        fromPlaceId: record.fromPlaceId,
        toPlaceId: record.toPlaceId,
        transport: record.transport,
        estimatedHours: record.estimatedHours,
        distanceKm: record.distanceKm,
        method: "정적 사전 수집 도로 경로",
        basisDate: record.basisDate,
        dataVersion: manifest.version,
        policyVersion: record.policyVersion,
        reproductionId: record.reproductionId,
        provenance: {
          source: record.source,
          collectedAt: record.basisDate,
          dataStatus: record.dataStatus,
          dataVersion: manifest.version,
        },
      };
      return result;
    },
  };
}
