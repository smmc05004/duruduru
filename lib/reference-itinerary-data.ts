import type { DataProvenance } from "./domain-data";
import type {
  ReferenceItineraryDataSource,
  ReferenceItineraryPlace,
} from "./reference-itinerary";

const tourApiProvenance: DataProvenance = {
  source: "한국관광공사 TourAPI KorService2 searchKeyword2 실제 응답",
  collectedAt: "2026-09-03",
  dataStatus: "normal",
};

const missingProvenance: DataProvenance = {
  source: "한국관광공사 TourAPI KorService2 searchKeyword2 실제 응답",
  collectedAt: "2026-09-03",
  dataStatus: "missing",
};

/**
 * E6 참고 계획의 최소 실제 장소 앵커.
 *
 * 각 레코드는 2026-09-03 TourAPI 검색 응답의 contentId·원문명·좌표만 쓴다. 관심사 분류,
 * 방문시간, 운영·휴무와 도로 경로는 수집하지 않았으므로 명시적 결측이며 PoC 값으로 채우지 않는다.
 */
const places: ReferenceItineraryPlace[] = [
  {
    id: "tourapi:place:126166",
    destinationId: "gyeongju",
    name: "경주 불국사 [유네스코 세계유산]",
    category: "관광지",
    coordinates: { latitude: 35.7923023161, longitude: 129.3317253913 },
    interestEvidence: [],
    interestEvidenceProvenance: missingProvenance,
    visit: { estimatedHours: null, provenance: missingProvenance },
    operation: null,
    provenance: { ...tourApiProvenance },
  },
  {
    id: "tourapi:place:126207",
    destinationId: "gyeongju",
    name: "경주 첨성대",
    category: "관광지",
    coordinates: { latitude: 35.8343303427, longitude: 129.2185345378 },
    interestEvidence: [],
    interestEvidenceProvenance: missingProvenance,
    visit: { estimatedHours: null, provenance: missingProvenance },
    operation: null,
    provenance: { ...tourApiProvenance },
  },
  {
    id: "tourapi:place:3038480",
    destinationId: "gongju",
    name: "공산성 광복루",
    category: "관광지",
    coordinates: { latitude: 36.460302, longitude: 127.129498 },
    interestEvidence: [],
    interestEvidenceProvenance: missingProvenance,
    visit: { estimatedHours: null, provenance: missingProvenance },
    operation: null,
    provenance: { ...tourApiProvenance },
  },
  {
    id: "tourapi:place:3038487",
    destinationId: "gongju",
    name: "공산성 쌍수정",
    category: "관광지",
    coordinates: { latitude: 36.462237, longitude: 127.125634 },
    interestEvidence: [],
    interestEvidenceProvenance: missingProvenance,
    visit: { estimatedHours: null, provenance: missingProvenance },
    operation: null,
    provenance: { ...tourApiProvenance },
  },
  {
    id: "tourapi:place:125769",
    destinationId: "gangneung",
    name: "강릉 굴산사지",
    category: "관광지",
    coordinates: { latitude: 37.7072681694, longitude: 128.8918046506 },
    interestEvidence: [],
    interestEvidenceProvenance: missingProvenance,
    visit: { estimatedHours: null, provenance: missingProvenance },
    operation: null,
    provenance: { ...tourApiProvenance },
  },
  {
    id: "tourapi:place:125790",
    destinationId: "gangneung",
    name: "강릉 경포대",
    category: "관광지",
    coordinates: { latitude: 37.7955136762197, longitude: 128.896483966593 },
    interestEvidence: [],
    interestEvidenceProvenance: missingProvenance,
    visit: { estimatedHours: null, provenance: missingProvenance },
    operation: null,
    provenance: { ...tourApiProvenance },
  },
];

export const referenceItineraryDataSource: ReferenceItineraryDataSource = {
  listPlaces: (destinationId) =>
    places
      .filter((place) => place.destinationId === destinationId)
      .map((place) => ({
        ...place,
        coordinates: place.coordinates ? { ...place.coordinates } : null,
        interestEvidence: [...place.interestEvidence],
        interestEvidenceProvenance: { ...place.interestEvidenceProvenance },
        visit: { ...place.visit, provenance: { ...place.visit.provenance } },
        operation: place.operation
          ? {
              ...place.operation,
              regularIntervals: place.operation.regularIntervals.map(
                (interval) => ({ ...interval }),
              ),
              closedWeekdays: place.operation.closedWeekdays
                ? [...place.operation.closedWeekdays]
                : null,
              dateExceptions: place.operation.dateExceptions.map(
                (exception) => ({
                  ...exception,
                  intervals: exception.intervals.map((interval) => ({
                    ...interval,
                  })),
                }),
              ),
              provenance: { ...place.operation.provenance },
            }
          : null,
        provenance: { ...place.provenance },
      })),
  lookupTravel: () => null,
};
