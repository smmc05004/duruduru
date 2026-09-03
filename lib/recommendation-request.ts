import type { DomainDataAdapter } from "./domain-data";
import {
  destinationsFrom,
  evaluateCandidates,
  type RecommendationOutcome,
} from "./recommendation";
import { recommendationDataAdapter } from "./recommendation-data-adapter";
import {
  recommendationPolicyV1,
  type RecommendationPolicy,
} from "./trip-policy";
import type { ValidTripConditions } from "./trip-conditions";
import { travelTimeAdapterFrom } from "./travel-time";

/*
 * 화면이 추천 계산을 요청하는 경계.
 *
 * FUNCTIONAL_SPEC.md 5장이 정한 "공공 API 수집 → 정규화 → 내부 데이터 계층"만 읽는다.
 * 실제 저장소 전까지의 어댑터는 결측을 명시하며 PoC 목업을 추천 결과로 승격하지 않는다.
 */
export type RecommendationDataSource = Pick<
  DomainDataAdapter,
  "listDestinations" | "lookupOriginTravelTime"
>;

/** E3 유효 조건과 E1 계약 데이터를 도메인 결과로 결합한다. */
export function evaluateRecommendationRequest(
  conditions: ValidTripConditions,
  data: RecommendationDataSource,
  policy: RecommendationPolicy,
): RecommendationOutcome {
  return evaluateCandidates(
    {
      conditions,
      destinations: destinationsFrom(data),
      travelTime: travelTimeAdapterFrom(data),
    },
    policy,
  );
}

export function requestRecommendations(
  conditions: ValidTripConditions,
): Promise<RecommendationOutcome> {
  return Promise.resolve(
    evaluateRecommendationRequest(
      conditions,
      recommendationDataAdapter,
      recommendationPolicyV1,
    ),
  );
}
