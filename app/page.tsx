"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import {
  FieldCard,
  fieldErrorId,
  fieldHintId,
  type FieldCardError,
} from "@/components/FieldCard";
import { InputField } from "@/components/InputField";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Select } from "@/components/Select";
import { CandidateCard } from "@/components/CandidateCard";
import { formatHoursAndMinutes } from "@/lib/format-duration";
import type { RecommendationOutcome } from "@/lib/recommendation";
import { requestRecommendations } from "@/lib/recommendation-request";
import {
  provisionalInterestTags,
  provisionalSupportSet,
} from "@/lib/support-conditions";
import {
  errorsByField,
  validateTripConditions,
  type TripConditionsDraft,
  type TripConditionsField,
  type ValidTripConditions,
} from "@/lib/trip-conditions";

/*
 * F-01 조건 입력 → F-02·F-03 추천 계산·추천 결과·결과 없음 화면.
 * 시안: design/screens/Input.dc.html, InputError.dc.html, Loading.dc.html, Main.dc.html,
 *       NoResult.dc.html.
 *
 * 규칙은 이 컴포넌트에 없다. lib/trip-conditions.ts가 검증하고 lib/recommendation.ts가
 * 판정·점수를 낸다. 화면은 그 결과와 근거만 표시한다.
 *
 * 범위 밖: 일정 결과 화면(F-04). 그래서 목적지 선택은 "선택 상태"까지만 간다.
 */

const emptyDraft: TripConditionsDraft = {
  // 출발지·일시는 기본값을 넣지 않는다. 임의 기본값은 사용자가 고르지 않은 조건을
  // 고른 것처럼 만들고, 검증이 통과하는 이유를 감춘다.
  originId: "",
  startAt: "",
  returnBy: "",
  // 이동수단은 지원 목록에서 유일하게 정식 지원되는 값을 초기 선택으로 둔다(시안과 같다).
  transport:
    provisionalSupportSet.transports.find((transport) => transport.supported)
      ?.id ?? "",
  interests: [],
};

const carIcon = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 12.5h14M4.5 12.5V9.2l1.8-3.4h7.4l1.8 3.4v3.3" />
    <circle cx="6.6" cy="14.4" r="1.4" />
    <circle cx="13.4" cy="14.4" r="1.4" />
  </svg>
);

function formatHours(value: number) {
  return Number.isInteger(value) ? `${value}시간` : `${value.toFixed(1)}시간`;
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

type Phase =
  | { kind: "input" }
  | { kind: "calculating"; conditions: ValidTripConditions }
  | {
      kind: "result";
      conditions: ValidTripConditions;
      outcome: RecommendationOutcome;
    };

const spinnerIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M10 2.8a7.2 7.2 0 1 1-6.9 5.1" />
  </svg>
);

const emptyIllustration = (
  <svg
    width="96"
    height="72"
    viewBox="0 0 120 90"
    fill="none"
    stroke="var(--line-dashed)"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 22l32-10 32 10 32-10v56l-32 10-32-10-32 10z" />
    <path d="M44 12v56M76 22v56" />
    <path d="M52 44h16M60 36v16" stroke="var(--track-move)" />
  </svg>
);

const earlierIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="var(--olive-ink)"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="10" cy="10" r="7.2" />
    <path d="M10 6.2V10l-2.6 1.8" />
  </svg>
);

const laterIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="var(--olive-ink)"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="10" cy="10" r="7.2" />
    <path d="M10 6.2V10l2.6 1.8" />
  </svg>
);

const placeIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="var(--olive-ink)"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 17.2s5.6-5 5.6-9.2A5.6 5.6 0 0 0 4.4 8c0 4.2 5.6 9.2 5.6 9.2z" />
    <circle cx="10" cy="8" r="2" />
  </svg>
);

/** 조건 요약. 계산 중·결과·결과 없음 세 상태가 같은 요약을 유지한다(4장). */
function originName(originId: string) {
  return (
    provisionalSupportSet.origins.find((origin) => origin.id === originId)
      ?.name ?? originId
  );
}

function ConditionSummary({
  conditions,
  title,
}: {
  conditions: ValidTripConditions;
  title: string;
}) {
  const transportName =
    provisionalSupportSet.transports.find(
      (transport) => transport.id === conditions.transport,
    )?.name ?? conditions.transport;
  return (
    <section className="dd-summary-card" aria-label="제출한 여행 조건">
      <p className="dd-summary-card__title">{title}</p>
      <div className="dd-summary-card__chips">
        <span className="dd-pill">{originName(conditions.originId)} 출발</span>
        <span className="dd-pill">
          {formatDateTime(conditions.startAt)} 출발
        </span>
        <span className="dd-pill">
          {formatDateTime(conditions.returnBy)} 복귀
        </span>
        <span className="dd-pill">{transportName}</span>
        {conditions.interests.map((interest) => (
          <span key={interest} className="dd-pill--interest">
            {interest}
          </span>
        ))}
      </div>
    </section>
  );
}

function ResultHeader({ conditions }: { conditions: ValidTripConditions }) {
  return (
    <div className="dd-screen__header">
      <span className="dd-screen__logo">두루두루</span>
      <span className="dd-badge-hours">
        {formatHoursAndMinutes(conditions.availableHours)}
      </span>
    </div>
  );
}

export default function TripConditionsPage() {
  const [draft, setDraft] = useState<TripConditionsDraft>(emptyDraft);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "input" });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const result = useMemo(
    () => validateTripConditions(draft, provisionalSupportSet),
    [draft],
  );
  const fieldErrors =
    result.ok || !attempted ? {} : errorsByField(result.errors);
  const errorCount = result.ok || !attempted ? 0 : result.errors.length;

  /*
   * 계산은 비동기 경계 뒤에 있다(lib/recommendation-request.ts). 조건이 바뀌면 이전 결과는
   * 새 조건의 결과로 오인되지 않게 버려진다(4장 — 조건 수정 시 기존 추천 무효화).
   */
  useEffect(() => {
    if (phase.kind !== "calculating") return;
    let cancelled = false;
    const conditions = phase.conditions;
    requestRecommendations(conditions).then((outcome) => {
      if (!cancelled) setPhase({ kind: "result", conditions, outcome });
    });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  /*
   * 항목 하나가 입력 하나에 대응하지 않는다(출발·복귀는 한 카드를 쓴다). 그래서 오류를
   * 카드 단위로 고르지 않고 입력 단위로 모아 넘긴다. 요약 배너가 세는 개수와 화면에
   * 보이는 메시지 수가 어긋나면 사용자는 무엇을 더 고쳐야 하는지 알 수 없다.
   */
  function cardErrors(
    ...fields: [TripConditionsField, string][]
  ): FieldCardError[] {
    return fields
      .filter(([field]) => fieldErrors[field])
      .map(([field, inputId]) => ({
        inputId,
        message: fieldErrors[field] as string,
      }));
  }

  /** 오류가 있으면 오류 텍스트를, 없으면 안내 문구를 가리킨다. */
  function describedBy(
    field: TripConditionsField,
    inputId: string,
    hasHint = false,
  ) {
    if (fieldErrors[field]) return fieldErrorId(inputId);
    return hasHint ? fieldHintId(inputId) : undefined;
  }

  const transportOptions = provisionalSupportSet.transports.map(
    (transport) => ({
      value: transport.id,
      label: transport.name,
      icon: transport.id === "car" ? carIcon : undefined,
      disabled: !transport.supported,
    }),
  );
  const transportHint = provisionalSupportSet.transports.find(
    (transport) => !transport.supported && transport.unsupportedReason,
  )?.unsupportedReason;

  function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!result.ok) {
      // 검증을 통과하지 못한 조건은 추천 엔진으로 넘어가지 않는다(F-01 수용 기준).
      setPhase({ kind: "input" });
      return;
    }
    setSelectedId(null);
    setPhase({ kind: "calculating", conditions: result.conditions });
  }

  function update(patch: Partial<TripConditionsDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setPhase({ kind: "input" });
    setSelectedId(null);
  }

  function toggleInterest(tag: string) {
    update({
      interests: draft.interests.includes(tag)
        ? draft.interests.filter((item) => item !== tag)
        : [...draft.interests, tag],
    });
  }

  const availableHours = result.ok ? result.conditions.availableHours : null;

  if (phase.kind !== "input") {
    const { conditions } = phase;
    // 판정에 실제로 쓰인 여행 유형·최소 체류시간을 결과에서 그대로 읽는다. 화면이 다시 계산하지 않는다.
    const duration = phase.kind === "result" ? phase.outcome.duration : null;
    const passed = phase.kind === "result" ? phase.outcome.passed : [];
    const noResult = phase.kind === "result" && passed.length === 0;

    return (
      <main className="dd-screen">
        <ResultHeader conditions={conditions} />
        <ConditionSummary
          conditions={conditions}
          title={
            noResult
              ? "이번 시간에는\n다녀올 수 있는 곳이 없어요"
              : `${originName(conditions.originId)}에서 출발해서\n다시 돌아올 수 있는 곳`
          }
        />

        {phase.kind === "calculating" ? (
          <>
            <div className="dd-calculating" role="status">
              {spinnerIcon}
              <p>시간 안에 다녀올 수 있는 곳을 계산하고 있어요</p>
            </div>
            <div className="dd-candidates" aria-hidden="true">
              {[0, 1].map((index) => (
                <div className="dd-skeleton-card" key={index}>
                  <div className="dd-skeleton-card__head">
                    <div className="dd-skeleton dd-skeleton--title" />
                    <div className="dd-skeleton dd-skeleton--region" />
                  </div>
                  <div className="dd-skeleton dd-skeleton--bar" />
                  <div className="dd-skeleton dd-skeleton--line" />
                  <div className="dd-skeleton dd-skeleton--line-short" />
                </div>
              ))}
            </div>
          </>
        ) : null}

        {noResult ? (
          <>
            {/* 오류가 아니라 정상 결과다(4장). 장애 화면과 달리 경고색·재시도 버튼을 쓰지 않는다. */}
            <section className="dd-empty" aria-label="결과 없음">
              {emptyIllustration}
              <p className="dd-empty__title">
                쓸 수 있는 시간이{" "}
                {formatHoursAndMinutes(conditions.availableHours)}라, 왕복
                이동과 최소로 머물러야 하는 {duration?.minimumLocalStayHours}
                시간({duration?.label})을 함께 넣을 수 있는 곳이 없었어요.
              </p>
              <p className="dd-empty__note">
                억지로 채우지 않고 그대로 알려드려요. 아래처럼 조건을 조금만
                바꾸면 다시 찾아볼 수 있어요.
              </p>
            </section>
            <ul className="dd-suggestions">
              <li className="dd-suggestions__item">
                {earlierIcon}
                <span>더 이른 시간에 출발하기</span>
              </li>
              <li className="dd-suggestions__item">
                {laterIcon}
                <span>복귀 시간을 늦춰보기</span>
              </li>
              <li className="dd-suggestions__item">
                {placeIcon}
                <span>지원하는 다른 출발지로 바꾸기</span>
              </li>
            </ul>
          </>
        ) : null}

        {phase.kind === "result" && passed.length > 0 ? (
          <>
            <div className="dd-list-head">
              <span className="dd-list-head__count">
                다녀올 수 있는 곳 {passed.length}군데
              </span>
              <span className="dd-list-head__order">시간 적합순</span>
            </div>
            <ul className="dd-candidates">
              {passed.map((candidate, index) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  selectedInterestCount={conditions.interests.length}
                  best={index === 0}
                  selected={selectedId === candidate.id}
                  onSelect={() => setSelectedId(candidate.id)}
                />
              ))}
            </ul>
          </>
        ) : null}

        <div className="dd-result-actions">
          <Button
            variant={noResult ? "primary" : "secondary"}
            onClick={() => setPhase({ kind: "input" })}
          >
            조건 수정하기
          </Button>
        </div>

        <p className="dd-screen__footnote">
          이동시간은 평균값 기반 추정치예요. 실시간 교통 상황은 반영하지 않아요.
          지금 쓰는 이동시간과 목적지 목록은 확정 데이터가 아니라 임시값이라,
          정식 데이터가 붙으면 결과가 달라질 수 있어요. 시간 제약을 통과하지
          못한 곳은 아예 보여주지 않아요.
          {phase.kind === "result"
            ? ` (${duration?.label} 기준 최소 ${duration?.minimumLocalStayHours}시간 · 점수 정책 ${phase.outcome.policyVersion})`
            : ""}
        </p>
      </main>
    );
  }

  return (
    <main className="dd-screen">
      <div className="dd-screen__header">
        <span className="dd-screen__logo">두루두루</span>
        <span className="dd-screen__data-basis">
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="7.2" />
            <path d="M10 6.2V10l2.6 1.8" />
          </svg>
          지원 조건 {provisionalSupportSet.basisDate} 기준
        </span>
      </div>

      <h1 className="dd-screen__title">
        쓸 수 있는 시간을
        <br />
        알려주면 갈 곳부터 골라줄게요
      </h1>

      {errorCount > 0 ? (
        <div className="dd-error-summary" role="alert">
          <svg
            className="dd-error-summary__icon"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="var(--alert)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 3.2l7 12.4H3z" />
            <path d="M10 7.8v3.4M10 13.6v.2" />
          </svg>
          <div>
            <p className="dd-error-summary__title">
              고쳐야 할 항목이 {errorCount}개 있어요
            </p>
            <p className="dd-error-summary__text">
              아래 표시된 곳을 고치면 바로 찾아볼 수 있어요.
            </p>
          </div>
        </div>
      ) : null}

      <form onSubmit={submit}>
        <div className="dd-screen__fields">
          <FieldCard
            label="어디서 출발해요?"
            htmlFor="origin"
            hint="지금은 주요 도시 단위로만 고를 수 있어요."
            hintFor="origin"
            errors={cardErrors(["originId", "origin"])}
          >
            <Select
              id="origin"
              options={provisionalSupportSet.origins.map((origin) => ({
                value: origin.id,
                label: origin.name,
              }))}
              placeholder="출발지를 골라 주세요"
              value={draft.originId}
              invalid={Boolean(fieldErrors.originId)}
              aria-describedby={describedBy("originId", "origin", true)}
              onChange={(event) => update({ originId: event.target.value })}
            />
          </FieldCard>

          <FieldCard
            label="언제 나가서 언제까지 돌아와요?"
            errors={cardErrors(
              ["startAt", "start-at"],
              ["returnBy", "return-by"],
            )}
          >
            <div className="dd-datetime-pair">
              <InputField
                id="start-at"
                type="datetime-local"
                prefix="출발"
                aria-label="출발 일시"
                value={draft.startAt}
                invalid={Boolean(fieldErrors.startAt)}
                aria-describedby={describedBy("startAt", "start-at")}
                onChange={(event) => update({ startAt: event.target.value })}
              />
              <InputField
                id="return-by"
                type="datetime-local"
                prefix="복귀 가능"
                aria-label="복귀 가능 일시"
                value={draft.returnBy}
                invalid={Boolean(fieldErrors.returnBy)}
                aria-describedby={describedBy("returnBy", "return-by")}
                onChange={(event) => update({ returnBy: event.target.value })}
              />
            </div>
            {availableHours !== null ? (
              <div className="dd-notice">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="10" cy="10" r="7.2" />
                  <path d="M10 6.4v.2M10 9.2v4.4" />
                </svg>
                <span>쓸 수 있는 시간 {formatHours(availableHours)}</span>
              </div>
            ) : null}
          </FieldCard>

          <FieldCard
            label="무엇으로 이동해요?"
            hint={transportHint}
            hintFor="transport"
            errors={cardErrors(["transport", "transport"])}
          >
            <SegmentedControl
              label="이동수단"
              options={transportOptions}
              value={draft.transport}
              invalid={Boolean(fieldErrors.transport)}
              describedBy={describedBy(
                "transport",
                "transport",
                Boolean(transportHint),
              )}
              onChange={(value) => update({ transport: value })}
            />
          </FieldCard>

          {/* 관심사는 1개 이상 필수다(2026-08-31 확정 — DECISIONS.md 7.3절). */}
          <FieldCard
            label="어떤 걸 좋아해요?"
            labelAside="· 하나 이상 골라 주세요"
            errors={cardErrors(["interests", "interests"])}
          >
            <div
              className="dd-chip-group"
              role="group"
              aria-label="관심사"
              aria-describedby={
                fieldErrors.interests ? fieldErrorId("interests") : undefined
              }
            >
              {provisionalInterestTags.map((tag) => (
                <Chip
                  key={tag}
                  variant="selectable"
                  label={tag}
                  selected={draft.interests.includes(tag)}
                  onToggle={() => toggleInterest(tag)}
                />
              ))}
            </div>
          </FieldCard>
        </div>

        <div className="dd-screen__actions">
          <Button type="submit" variant="primary" disabled={errorCount > 0}>
            갈 수 있는 곳 찾기
          </Button>
          {errorCount > 0 ? (
            <p className="dd-button-note">
              고쳐야 할 항목이 남아 있어 아직 찾을 수 없어요
            </p>
          ) : null}
        </div>
      </form>

      <p className="dd-screen__footnote">
        이동시간은 평균값 기반 추정치예요. 실시간 교통 상황은 반영하지 않아요.
      </p>
    </main>
  );
}
