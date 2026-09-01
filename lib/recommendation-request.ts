import {
  destinationsFrom,
  evaluateCandidates,
  type RecommendationOutcome,
} from "./recommendation";
import { recommendationPolicyV1 } from "./trip-policy";
import { provisionalTravelTimeAdapter } from "./travel-time";
import type { ValidTripConditions } from "./trip-conditions";

/*
 * 화면이 추천 계산을 요청하는 경계.
 *
 * 지금은 목업 어댑터를 그 자리에서 호출하지만, FUNCTIONAL_SPEC.md 5장이 정한 대로 실제 데이터는
 * "공공 API를 주기 수집·정규화한 내부 데이터 계층"에서 온다. 그 계층은 비동기이므로 화면도
 * 처음부터 비동기 경계로 만들어 로딩 상태(4장 "추천 계산")를 정상 흐름으로 다룬다.
 *
 * ⚠ MOCK_LATENCY_MS는 그 계층을 대신하는 **목업 지연**이다. 제품 정책이 아니며 승격 대상도 아니다.
 *   실제 데이터 계층이 붙으면 이 상수는 사라진다.
 */
const MOCK_LATENCY_MS = 450;

export function requestRecommendations(
  conditions: ValidTripConditions,
): Promise<RecommendationOutcome> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        evaluateCandidates(
          {
            conditions,
            destinations: destinationsFrom(),
            travelTime: provisionalTravelTimeAdapter,
          },
          recommendationPolicyV1,
        ),
      );
    }, MOCK_LATENCY_MS);
  });
}
