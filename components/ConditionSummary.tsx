import {
  INTERESTS,
  ORIGINS,
  type Candidate,
  type MvpOriginId,
} from "@/lib/mvp-core";
import type { MvpCategoryId } from "@/lib/mvp-region-data";

/*
 * 로딩 화면에서 제출한 여행 조건을 실제 값으로 유지하는 요약 카드.
 * 시안: design/screens/Loading.dc.html · design/screens/RestaurantLoading.dc.html
 * 규칙: docs/design/DESIGN_TOKENS.md 「로딩 상태」 — 조건 요약은 스켈레톤으로 바꾸지 않는다.
 *
 * 이 컴포넌트는 표시 전용이다. 값 계산이나 규칙 판단을 하지 않는다.
 */

type ConditionInput = {
  originId: MvpOriginId;
  startAt: string;
  returnBy: string;
  interests: MvpCategoryId[];
};

type Props = {
  input: ConditionInput;
  /** 목적지를 고른 뒤(음식점 조회 중) 화면이면 선택한 후보를 함께 보인다. */
  destination?: Candidate | null;
  /** 비목적지 화면의 카드 제목을 바꾼다. 기본값은 "OO에서\n갈 수 있는 곳". */
  title?: string;
  /** 목적지 화면 변형. "itinerary"는 참고 계획 화면의 20px 지역명 + 조회일 줄. */
  variant?: "default" | "itinerary";
  /** "itinerary" 변형에서 카드 오른쪽 위에 적는 조회일. */
  fetchedAtLabel?: string;
};

/** "2026-09-12T08:00" → "9/12 08:00". 표시 전용 포맷이며 계산에 쓰지 않는다. */
function formatTripMoment(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/u.exec(value);
  if (!match) return value;
  const [, , month, day, time] = match;
  return `${Number(month)}/${Number(day)} ${time}`;
}

export function ConditionSummary({
  input,
  destination,
  title,
  variant = "default",
  fetchedAtLabel,
}: Props) {
  const originLabel =
    ORIGINS.find((origin) => origin.id === input.originId)?.label ?? "출발지";
  const interestLabels = input.interests.map(
    (id) => INTERESTS.find((interest) => interest.id === id)?.label ?? id,
  );
  const start = formatTripMoment(input.startAt);
  const end = formatTripMoment(input.returnBy);

  const interestPills = interestLabels.map((label) => (
    <span key={label} className="dd-pill dd-pill--interest">
      {label}
    </span>
  ));

  if (destination) {
    return (
      <section className="dd-summary-card" aria-label="입력한 여행 조건">
        {variant === "itinerary" ? (
          <div className="dd-summary-card__head">
            <p className="dd-summary-card__region-title">{destination.name}</p>
            {fetchedAtLabel ? (
              <span className="dd-summary-card__fetched">
                조회 {fetchedAtLabel}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="dd-candidate__head">
            <h1 className="dd-candidate__name">{destination.displayName}</h1>
            {destination.name !== destination.displayName ? (
              <span className="dd-candidate__region">{destination.name}</span>
            ) : null}
          </div>
        )}
        <div className="dd-summary-card__chips">
          <span className="dd-pill">{originLabel} 출발 · 자차</span>
          <span className="dd-pill">
            {start} → {end}
          </span>
          {interestPills}
        </div>
      </section>
    );
  }

  return (
    <section className="dd-summary-card" aria-label="입력한 여행 조건">
      <h1 className="dd-summary-card__title">
        {title ?? `${originLabel}에서\n갈 수 있는 곳`}
      </h1>
      <div className="dd-summary-card__chips">
        <span className="dd-pill">{start} 출발</span>
        <span className="dd-pill">{end} 복귀</span>
        <span className="dd-pill">자차</span>
        {interestPills}
      </div>
    </section>
  );
}
