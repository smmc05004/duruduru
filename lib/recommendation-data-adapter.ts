import type {
  DataProvenance,
  DestinationRecord,
  DomainDataAdapter,
  OriginRecord,
} from "./domain-data";
import { supportConditionsV1 } from "./support-conditions";

/*
 * E4 추천용 내부 데이터 계층의 현재 읽기 구현.
 *
 * E3에서 확정한 지원 지역·기준점은 제공하지만, E2는 조사 경계만 만들었고 출발지↔목적지
 * 이동시간과 목적지 태그의 실측 수집은 끝내지 않았다. 그 결측을 반환해 PoC 목업 수치나
 * 태그를 정식 추천에 쓰지 않는다.
 */
const missingProvenance: DataProvenance = {
  source: "E2 데이터 품질 조사 경계 — 실측 추천 데이터 미수집",
  collectedAt: "2026-09-02T00:00:00.000Z",
  dataStatus: "missing",
};

const origins = (): OriginRecord[] =>
  supportConditionsV1.origins.map((origin) => ({
    id: origin.id,
    name: origin.name,
    region: origin.region,
    supportStatus: "supported",
    coordinates: {
      latitude: origin.representativePoint.latitude,
      longitude: origin.representativePoint.longitude,
    },
    provenance: { ...missingProvenance },
  }));

const destinations = (): DestinationRecord[] =>
  supportConditionsV1.destinations.map((destination) => ({
    id: destination.id,
    name: destination.name,
    region: destination.region,
    supportStatus: "supported",
    coordinates: {
      latitude: destination.representativePoint.latitude,
      longitude: destination.representativePoint.longitude,
    },
    summary: null,
    tags: [],
    tagProvenance: { ...missingProvenance },
    provenance: { ...missingProvenance },
  }));

export const recommendationDataAdapter: DomainDataAdapter = {
  listOrigins: origins,
  listDestinations: destinations,
  listPlaces: () => [],
  lookupOriginTravelTime: () => null,
  lookupPlaceTravelTime: () => null,
  listFestivals: () => [],
  listRepresentativeFoods: () => [],
  listRestaurants: () => [],
};
