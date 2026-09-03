import type {
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

const supportCoordinateEvidence = (
  sourceRecordId: string,
  coordinates: { latitude: number; longitude: number },
): CoordinateEvidence => ({
  kind: "support-condition",
  source: "지원 조건 기준점(DECISIONS.md 7.5절 사용자 승인)",
  sourceRecordId,
  collectedAt: "2026-09-03",
  dataVersion: "support-conditions-v1",
  rawAddress: null,
  query: null,
  selectedAddress: null,
  matchEvidence: "승인된 지원 조건의 대표 시청 기준점",
  coordinates,
  missingReason: null,
});

const osrmManualCollectionBatch: CollectionBatchEvidence = {
  id: "osrm-manual-2026-09-03",
  termsCheckedAt: "2026-09-03",
  providerTermsUrl: "https://map.project-osrm.org/about.html",
  routeRequestTemplate:
    "GET https://router.project-osrm.org/route/v1/driving/{from.longitude},{from.latitude};{to.longitude},{to.latitude}?overview=false",
  callLimitEvidence:
    "OSRM 공개 데모 사용 정책을 확인하고 3×3 및 표시 순서에 필요한 12건만 수동으로 1초 이상 간격을 두고 조회했다. 런타임·대량 배치 호출은 하지 않는다.",
  storagePolicyEvidence:
    "도로 경로 거리·시간과 재현 식별자만 정적 매니페스트에 보존하고 원시 응답은 저장하지 않는다.",
  displayPolicyEvidence:
    "결과 UI에 일반 예상 이동시간·출처·기준일·추정 상태와 실시간 교통 아님을 표시한다.",
  redistributionPolicyEvidence:
    "OpenStreetMap 데이터는 ODbL 조건과 필요한 귀속을 따른다. 이 매니페스트는 계산된 거리·시간만 보존한다.",
  rawResponseRetentionEvidence: "OSRM 응답 본문은 저장·배포하지 않는다.",
};

const supportPoint = (id: string) => {
  const origin = supportConditionsV1.origins.find((item) => item.id === id);
  const destination = supportConditionsV1.destinations.find(
    (item) => item.id === id,
  );
  const point = origin?.representativePoint ?? destination?.representativePoint;
  if (!point) throw new Error(`지원 기준점이 없습니다: ${id}`);
  return supportCoordinateEvidence(point.id, point);
};

const originRoute = (
  originId: string,
  destinationId: string,
  distanceKm: number,
  estimatedHours: number,
): StaticOriginDestinationTravelTime => {
  const fromCoordinate = supportPoint(originId);
  const toCoordinate = supportPoint(destinationId);
  return {
    originId,
    destinationId,
    transport: "car",
    distanceKm,
    estimatedHours,
    estimate: true,
    source: "OSRM 공개 데모 서버 수동 경로 조회 (OpenStreetMap 도로 데이터)",
    dataset: "OSRM car profile / OpenStreetMap",
    basisDate: "2026-09-03",
    dataVersion: "osrm-osm-2026-09-03",
    policyVersion: "2026-09-03",
    reproductionId: `osrm-v1-driving:${fromCoordinate.coordinates!.longitude},${fromCoordinate.coordinates!.latitude};${toCoordinate.coordinates!.longitude},${toCoordinate.coordinates!.latitude}:overview=false`,
    dataStatus: "estimate",
    missingReason: null,
    fromCoordinate,
    toCoordinate,
  };
};

/** 2026-09-03 소량 수동 조회값. 시간은 분 단위로 반올림했다. */
const collectedOriginDestinationRecords: StaticOriginDestinationTravelTime[] = [
  originRoute("seoul", "gyeongju", 331.2, 4 + 10 / 60),
  originRoute("seoul", "gongju", 138.5, 1 + 50 / 60),
  originRoute("seoul", "gangneung", 216.2, 2 + 55 / 60),
  originRoute("daejeon", "gyeongju", 220, 2 + 50 / 60),
  originRoute("daejeon", "gongju", 33.1, 35 / 60),
  originRoute("daejeon", "gangneung", 277.4, 3 + 35 / 60),
  originRoute("busan", "gyeongju", 84.6, 1 + 10 / 60),
  originRoute("busan", "gongju", 294.1, 3 + 40 / 60),
  originRoute("busan", "gangneung", 348.3, 5 + 5 / 60),
];

const tourApiCoordinate = (
  sourceRecordId: string,
  latitude: number,
  longitude: number,
): CoordinateEvidence => ({
  kind: "tourapi",
  source: "한국관광공사 TourAPI KorService2 searchKeyword2 실제 응답",
  sourceRecordId,
  collectedAt: "2026-09-03",
  dataVersion: "tourapi-2026-09-03",
  rawAddress: null,
  query: null,
  selectedAddress: null,
  matchEvidence: "TourAPI contentId와 원천 WGS84 좌표 일치",
  coordinates: { latitude, longitude },
  missingReason: null,
});

const placePoints = {
  "tourapi:place:126166": tourApiCoordinate(
    "126166",
    35.7923023161,
    129.3317253913,
  ),
  "tourapi:place:126207": tourApiCoordinate(
    "126207",
    35.8343303427,
    129.2185345378,
  ),
  "tourapi:place:3038480": tourApiCoordinate("3038480", 36.460302, 127.129498),
  "tourapi:place:3038487": tourApiCoordinate("3038487", 36.462237, 127.125634),
  "tourapi:place:125769": tourApiCoordinate(
    "125769",
    37.7072681694,
    128.8918046506,
  ),
  "tourapi:place:125790": tourApiCoordinate(
    "125790",
    37.7955136762197,
    128.896483966593,
  ),
} as const;

const placeRoute = (
  fromPlaceId: keyof typeof placePoints,
  toPlaceId: keyof typeof placePoints,
  distanceKm: number,
  estimatedHours: number,
): StaticPlaceTravelTime => ({
  fromPlaceId,
  toPlaceId,
  transport: "car",
  distanceKm,
  estimatedHours,
  estimate: true,
  source: "OSRM 공개 데모 서버 수동 경로 조회 (OpenStreetMap 도로 데이터)",
  dataset: "OSRM car profile / OpenStreetMap",
  basisDate: "2026-09-03",
  dataVersion: "osrm-osm-2026-09-03",
  policyVersion: "2026-09-03",
  reproductionId: `osrm-v1-driving:${placePoints[fromPlaceId].coordinates!.longitude},${placePoints[fromPlaceId].coordinates!.latitude};${placePoints[toPlaceId].coordinates!.longitude},${placePoints[toPlaceId].coordinates!.latitude}:overview=false`,
  dataStatus: "estimate",
  missingReason: null,
  fromCoordinate: placePoints[fromPlaceId],
  toCoordinate: placePoints[toPlaceId],
});

const collectedPlaceTravelTimeRecords: StaticPlaceTravelTime[] = [
  placeRoute("tourapi:place:126166", "tourapi:place:126207", 16.96, 19 / 60),
  placeRoute("tourapi:place:3038480", "tourapi:place:3038487", 0.643, 1 / 60),
  placeRoute("tourapi:place:125769", "tourapi:place:125790", 11.75, 18 / 60),
];

/**
 * E4/E6 정적 이동시간 수집 매니페스트.
 *
 * 공개 OSRM 서버의 소량 수동 조회로 수집한 3×3 값과, 참고 계획 표시에 필요한 장소 쌍을
 * 보존한다. 앱은 이 정적 값만 읽고 외부 요청을 하지 않는다.
 */
export const staticTravelTimeManifestV1: StaticTravelTimeManifest = {
  version: "2026-09-03",
  policyVersion: "2026-09-03",
  collectionBatch: osrmManualCollectionBatch,
  originDestinationTargets: originDestinationTargets(),
  originDestinationRecords: collectedOriginDestinationRecords,
  placeTravelTimeRecords: collectedPlaceTravelTimeRecords,
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
  for (const expected of originDestinationTargets()) {
    const key = `${expected.originId}:${expected.destinationId}:${expected.transport}`;
    if (!originRecordKeys.has(key))
      issues.push(`필수 3×3 이동시간 레코드가 없습니다: ${key}`);
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

export type ProvenancedOriginTravelTime = OriginDestinationTravelTime & {
  dataVersion: string;
  policyVersion: string;
  reproductionId: string;
};

export type ProvenancedPlaceTravelTime = PlaceTravelTime & {
  distanceKm: number;
  dataVersion: string;
  policyVersion: string;
  reproductionId: string;
};

/**
 * 런타임 경로 요청을 하지 않는 정적 내부 데이터 어댑터다.
 * 유효하지 않은 매니페스트는 데이터 준비 오류이므로 호출 전에 명시적으로 중단한다.
 */
export type StaticTravelTimeAdapter = {
  lookupOriginTravelTime(
    originId: string,
    destinationId: string,
    transport: TransportMode,
  ): ProvenancedOriginTravelTime | null;
  lookupPlaceTravelTime(
    fromPlaceId: string,
    toPlaceId: string,
    transport: TransportMode,
  ): ProvenancedPlaceTravelTime | null;
};

export function createStaticTravelTimeAdapter(
  manifest: StaticTravelTimeManifest,
): StaticTravelTimeAdapter {
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
