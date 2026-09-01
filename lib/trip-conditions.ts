/*
 * F-01 여행 조건 입력·검증의 도메인 규칙.
 *
 * UI와 분리해 Jest로 검증한다. 화면은 이 결과를 표시만 하고 규칙을 다시 판단하지 않는다.
 * 수용 기준: 복귀가 출발보다 빠른 입력은 추천 엔진에 전달되지 않는다.
 */

import type { SupportSet, TransportMode } from "./support-conditions";

/** 사용자가 폼에 입력한 원문. 정규화되지 않은 문자열 그대로다. */
export type TripConditionsDraft = {
  originId: string;
  /** `datetime-local` 원문 (`YYYY-MM-DDTHH:mm`) */
  startAt: string;
  returnBy: string;
  transport: string;
  interests: string[];
};

export type TripConditionsField =
  "originId" | "startAt" | "returnBy" | "transport" | "interests";

export type TripConditionsError = {
  field: TripConditionsField;
  message: string;
};

/** 검증을 통과한 조건. 원문과 정규화값을 함께 유지한다(F-01 처리 규칙). */
export type ValidTripConditions = {
  originId: string;
  startAt: Date;
  returnBy: Date;
  transport: TransportMode;
  interests: string[];
  /** 복귀 − 출발. 표시용 값이며 최소 여행 기간 판정에는 쓰지 않는다. */
  availableHours: number;
  raw: TripConditionsDraft;
};

export type TripConditionsResult =
  | { ok: true; conditions: ValidTripConditions }
  | { ok: false; errors: TripConditionsError[] };

/*
 * 시간 계산은 하나의 명시적 시간대 기준으로 수행한다(F-01 처리 규칙).
 * `new Date("2026-09-12T08:00")`은 실행 환경의 로컬 시간대로 해석되므로 서버·클라이언트·CI에서
 * 값이 갈린다. 그래서 KST(+09:00) 오프셋을 명시해 파싱한다.
 */
export const TRIP_TIME_ZONE = "Asia/Seoul";
const TRIP_TIME_ZONE_OFFSET = "+09:00";
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function parseInTripTimeZone(value: string): Date | null {
  if (!LOCAL_DATE_TIME.test(value)) return null;
  const parsed = new Date(`${value}:00${TRIP_TIME_ZONE_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) return null;
  // "2026-09-31" 같은 존재하지 않는 날짜가 다음 달로 넘어가 조용히 통과하는 것을 막는다.
  // KST 기준 달력 값으로 되돌려 입력 원문과 같은지 확인한다.
  const inZone = new Date(parsed.getTime() + 9 * 3_600_000);
  const roundTrip = `${inZone.toISOString().slice(0, 10)}T${inZone.toISOString().slice(11, 16)}`;
  return roundTrip === value ? parsed : null;
}

/*
 * 의도적으로 검증하지 않는 것 —
 * · 과거 일시 허용 여부
 * · 최소 여행 기간(복귀 − 출발의 하한)
 * FUNCTIONAL_SPEC.md의 F-01이 "별도 정책 없이는 고정하지 않는다"고 명시한다. 정책이 없는데
 * 임의 하한을 넣으면 그 상수가 사실상 제품 결정이 된다. 그래서 출발과 복귀가 같은 시각인
 * 입력도 차단하지 않는다("출발 이상이 아닌 복귀"만 오류다).
 */
export function validateTripConditions(
  draft: TripConditionsDraft,
  support: SupportSet,
): TripConditionsResult {
  const errors: TripConditionsError[] = [];

  const origin = support.origins.find(
    (candidate) => candidate.id === draft.originId,
  );
  if (!draft.originId) {
    errors.push({ field: "originId", message: "출발지를 골라 주세요." });
  } else if (!origin) {
    errors.push({
      field: "originId",
      message: "아직 지원하지 않는 출발지예요. 목록에서 골라 주세요.",
    });
  }

  let startAt: Date | null = null;
  if (!draft.startAt) {
    errors.push({ field: "startAt", message: "출발 일시를 골라 주세요." });
  } else {
    startAt = parseInTripTimeZone(draft.startAt);
    if (!startAt)
      errors.push({
        field: "startAt",
        message: "날짜와 시각을 읽을 수 없어요. 다시 골라 주세요.",
      });
  }

  let returnBy: Date | null = null;
  if (!draft.returnBy) {
    errors.push({
      field: "returnBy",
      message: "복귀 가능 일시를 골라 주세요.",
    });
  } else {
    returnBy = parseInTripTimeZone(draft.returnBy);
    if (!returnBy)
      errors.push({
        field: "returnBy",
        message: "날짜와 시각을 읽을 수 없어요. 다시 골라 주세요.",
      });
  }

  // 두 값을 모두 읽을 수 있을 때만 순서를 판정한다. 읽을 수 없는 값으로 순서를 주장하지 않는다.
  if (startAt && returnBy && returnBy.getTime() < startAt.getTime()) {
    errors.push({
      field: "returnBy",
      message: "복귀 시각이 출발보다 빨라요. 출발 이후로 맞춰 주세요.",
    });
  }

  const transport = support.transports.find(
    (candidate) => candidate.id === draft.transport,
  );
  if (!draft.transport) {
    errors.push({ field: "transport", message: "이동수단을 골라 주세요." });
  } else if (!transport || !transport.supported) {
    errors.push({
      field: "transport",
      message: "아직 지원하지 않는 이동수단이에요. 자차로 골라 주세요.",
    });
  }

  /*
   * 관심사 1개 이상 필수 (2026-08-31 확정 — DECISIONS.md 7.3절).
   * 두 가지 이유가 있다. (1) 층 ①의 관심사 일치 산식이 선택 관심사 개수를 분모로 쓰므로
   * 0개는 정의되지 않는다(7.2절). (2) 관심사는 사용자가 준 유일한 취향 신호이고, 0개를
   * 허용하면 추천이 "가장 가까운 목적지 나열"에 가까워진다.
   * 엔진 쪽 안전장치(0개면 관심사 항 제외 후 재정규화)는 그대로 남아 있다.
   */
  if (draft.interests.length === 0) {
    errors.push({
      field: "interests",
      message: "관심사를 하나 이상 골라 주세요.",
    });
  }

  if (errors.length > 0 || !startAt || !returnBy || !transport)
    return { ok: false, errors };

  return {
    ok: true,
    conditions: {
      originId: draft.originId,
      startAt,
      returnBy,
      transport: transport.id,
      interests: [...draft.interests],
      availableHours: (returnBy.getTime() - startAt.getTime()) / 3_600_000,
      raw: { ...draft, interests: [...draft.interests] },
    },
  };
}

/** 항목별 오류를 화면이 바로 쓸 수 있는 형태로 모은다. */
export function errorsByField(
  errors: TripConditionsError[],
): Partial<Record<TripConditionsField, string>> {
  const map: Partial<Record<TripConditionsField, string>> = {};
  for (const error of errors) {
    if (!map[error.field]) map[error.field] = error.message;
  }
  return map;
}
