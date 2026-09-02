import type { DomainDataAdapter } from "./domain-data";
import { pocDataAdapter } from "./poc-data-adapter";
import type { TransportMode } from "./support-conditions";

/*
 * 출발지→목적지 이동시간 어댑터.
 *
 * ⚠ 이 값은 **PoC 목업이며 정식 정책으로 승격하지 않는다.**
 *   docs/product/DECISIONS.md 1절 표의 `장소 간 이동시간 산출 방식`이 `제안` 상태이고,
 *   같은 표의 "PoC의 목업 값·숫자는 정식 정책으로 승격하지 않는다"가 이 값을 직접 가리킨다.
 *   5.4절도 "출발지→목적지 이동시간의 출처·산출 방식(미정)"을 F-02의 남은 데이터 차단으로 적었다.
 *
 * 그래서 판정·점수 함수는 lib/mock-data.ts를 직접 읽지 않고 이 어댑터를 통해서만 값을 받는다
 * (FUNCTIONAL_SPEC.md 7장 E1의 "PoC 목업 어댑터"). 정식 데이터 계층이 생기면 이 모듈만 교체된다.
 *
 * 값이 추정치라는 사실은 결과 객체(`kind: "estimate"`, `provisional`)에 남고 화면이 그대로 표시한다
 * (F-05 신뢰도 표시). 안전 여유를 값에 더하지 않는다(복귀 버퍼 미도입 — DECISIONS 2.3절).
 */

export type TravelTimeEstimate = {
  destinationId: string;
  /** 편도 예상 이동시간(시간 단위) */
  oneWayHours: number;
  /** 실시간값이 아니라 평균·추정값임을 보존한다(F-02 처리 규칙) */
  kind: "estimate";
  source: string;
  basisDate: string;
  /** 정식 정책이 아닌 임시값인가 */
  provisional: boolean;
};

export type TravelTimeAdapter = {
  /** 값을 만들 수 없으면 null이다. 임의값으로 채우지 않는다. */
  lookup(
    originId: string,
    destinationId: string,
    transport: TransportMode,
  ): TravelTimeEstimate | null;
  source: string;
  basisDate: string;
  provisional: boolean;
};

const POC_SOURCE = "PoC 목업(lib/mock-data.ts) — 출처·산출 방식 미정";
const POC_BASIS_DATE = "2026-08-30";

/*
 * PoC 목업은 출발지를 구분하지 않는다(목적지마다 값 하나뿐이다). 그 한계를 감추지 않기 위해
 * originId를 받지만 쓰지 않는다는 사실을 여기 적어 둔다. 정식 데이터가 오면 출발지별로 갈린다.
 */
export function travelTimeAdapterFrom(
  data: Pick<DomainDataAdapter, "lookupOriginTravelTime">,
): TravelTimeAdapter {
  const provenance = data.lookupOriginTravelTime(
    "__metadata__",
    "gyeongju",
    "car",
  )?.provenance;
  return {
    source: provenance?.source ?? POC_SOURCE,
    basisDate: provenance?.collectedAt ?? POC_BASIS_DATE,
    provisional: provenance?.dataStatus !== "normal",
    lookup(originId, destinationId, transport) {
      const record = data.lookupOriginTravelTime(
        originId,
        destinationId,
        transport,
      );
      if (!record || record.oneWayHours === null) return null;
      return {
        destinationId,
        oneWayHours: record.oneWayHours,
        kind:
          record.provenance.dataStatus === "normal" ? "estimate" : "estimate",
        source: record.provenance.source,
        basisDate: record.basisDate,
        provisional: record.provenance.dataStatus !== "normal",
      };
    },
  };
}

/** E1의 명시적 PoC 어댑터. E2에서 실제 내부 데이터 어댑터로 교체한다. */
export const provisionalTravelTimeAdapter =
  travelTimeAdapterFrom(pocDataAdapter);
