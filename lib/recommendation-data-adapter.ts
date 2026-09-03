import type {
  DataProvenance,
  DestinationRecord,
  DomainDataAdapter,
  OriginRecord,
} from "./domain-data";
import { supportConditionsV1 } from "./support-conditions";
import {
  createStaticTravelTimeAdapter,
  staticTravelTimeManifestV1,
} from "./static-travel-time-data";

/*
 * E4 추천용 내부 데이터 계층의 현재 읽기 구현.
 *
 * E3에서 확정한 지원 지역·기준점은 제공하지만, E2는 조사 경계만 만들었고 출발지↔목적지
 * 이동시간과 목적지 태그의 실측 수집은 끝내지 않았다. 그 결측을 반환해 PoC 목업 수치나
 * 태그를 정식 추천에 쓰지 않는다.
 */
const tourApiProvenance: DataProvenance = {
  source: "한국관광공사 TourAPI KorService2 searchKeyword2 실제 응답",
  collectedAt: "2026-09-03",
  dataStatus: "normal",
  dataVersion: "tourapi-2026-09-03",
};

const tagsByDestination: Record<string, readonly string[]> = {
  gyeongju: ["역사"],
  gongju: ["역사"],
  gangneung: ["역사"],
} as const;

const staticTravelTimeAdapter = createStaticTravelTimeAdapter(
  staticTravelTimeManifestV1,
);

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
    provenance: {
      source: "지원 조건 기준점(DECISIONS.md 7.5절 사용자 승인)",
      collectedAt: "2026-09-03",
      dataStatus: "normal",
      dataVersion: "support-conditions-v1",
    },
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
    summary: "TourAPI 실제 장소 앵커를 바탕으로 한 초기 참고 여행 지역",
    tags: tagsByDestination[destination.id].map((tag) => ({
      destinationId: destination.id,
      tag,
      evidence: `${destination.name}의 TourAPI 실제 역사 장소명·contentId 앵커`,
      provenance: { ...tourApiProvenance },
    })),
    tagProvenance: { ...tourApiProvenance },
    provenance: { ...tourApiProvenance },
  }));

export const recommendationDataAdapter: DomainDataAdapter = {
  listOrigins: origins,
  listDestinations: destinations,
  listPlaces: () => [],
  lookupOriginTravelTime: staticTravelTimeAdapter.lookupOriginTravelTime,
  lookupPlaceTravelTime: staticTravelTimeAdapter.lookupPlaceTravelTime,
  listFestivals: () => [],
  listRepresentativeFoods: () => [],
  listRestaurants: () => [],
};
