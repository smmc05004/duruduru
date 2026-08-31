"use client";

import { FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { FieldCard, fieldErrorId, fieldHintId, type FieldCardError } from "@/components/FieldCard";
import { InputField } from "@/components/InputField";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Select } from "@/components/Select";
import { provisionalInterestTags, provisionalSupportSet } from "@/lib/support-conditions";
import {
  errorsByField,
  validateTripConditions,
  type TripConditionsDraft,
  type TripConditionsField,
  type ValidTripConditions,
} from "@/lib/trip-conditions";

/*
 * F-01 여행 조건 입력·검증 화면(design/screens/Input.dc.html, InputError.dc.html).
 *
 * 검증 규칙은 이 컴포넌트에 없다. lib/trip-conditions.ts가 판정하고 화면은 결과만 보여 준다.
 * 다음 화면(추천 결과)은 이번 범위가 아니다. 최소 현지 체류시간과 데이터 결측 처리가
 * docs/product/DECISIONS.md에서 `보류`라서 결과 화면을 확정하지 않는다.
 */

const emptyDraft: TripConditionsDraft = {
  // 출발지·일시는 기본값을 넣지 않는다. 임의 기본값은 사용자가 고르지 않은 조건을
  // 고른 것처럼 만들고, 검증이 통과하는 이유를 감춘다.
  originId: "",
  startAt: "",
  returnBy: "",
  // 이동수단은 지원 목록에서 유일하게 정식 지원되는 값을 초기 선택으로 둔다(시안과 같다).
  transport: provisionalSupportSet.transports.find((transport) => transport.supported)?.id ?? "",
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

export default function TripConditionsPage() {
  const [draft, setDraft] = useState<TripConditionsDraft>(emptyDraft);
  const [attempted, setAttempted] = useState(false);
  const [submitted, setSubmitted] = useState<ValidTripConditions | null>(null);

  const result = useMemo(() => validateTripConditions(draft, provisionalSupportSet), [draft]);
  const fieldErrors = result.ok || !attempted ? {} : errorsByField(result.errors);
  const errorCount = result.ok || !attempted ? 0 : result.errors.length;

  /*
   * 항목 하나가 입력 하나에 대응하지 않는다(출발·복귀는 한 카드를 쓴다). 그래서 오류를
   * 카드 단위로 고르지 않고 입력 단위로 모아 넘긴다. 요약 배너가 세는 개수와 화면에
   * 보이는 메시지 수가 어긋나면 사용자는 무엇을 더 고쳐야 하는지 알 수 없다.
   */
  function cardErrors(...fields: [TripConditionsField, string][]): FieldCardError[] {
    return fields
      .filter(([field]) => fieldErrors[field])
      .map(([field, inputId]) => ({ inputId, message: fieldErrors[field] as string }));
  }

  /** 오류가 있으면 오류 텍스트를, 없으면 안내 문구를 가리킨다. */
  function describedBy(field: TripConditionsField, inputId: string, hasHint = false) {
    if (fieldErrors[field]) return fieldErrorId(inputId);
    return hasHint ? fieldHintId(inputId) : undefined;
  }

  const transportOptions = provisionalSupportSet.transports.map((transport) => ({
    value: transport.id,
    label: transport.name,
    icon: transport.id === "car" ? carIcon : undefined,
    disabled: !transport.supported,
  }));
  const transportHint = provisionalSupportSet.transports.find(
    (transport) => !transport.supported && transport.unsupportedReason,
  )?.unsupportedReason;

  function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!result.ok) {
      // 검증을 통과하지 못한 조건은 추천 엔진으로 넘어가지 않는다(F-01 수용 기준).
      setSubmitted(null);
      return;
    }
    // 통과한 조건을 정규화된 형태로 보관한다. 추천 계산 연결은 다음 작업 범위다.
    setSubmitted(result.conditions);
  }

  function update(patch: Partial<TripConditionsDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSubmitted(null);
  }

  function toggleInterest(tag: string) {
    update({
      interests: draft.interests.includes(tag)
        ? draft.interests.filter((item) => item !== tag)
        : [...draft.interests, tag],
    });
  }

  const availableHours = result.ok ? result.conditions.availableHours : null;

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
            <p className="dd-error-summary__title">고쳐야 할 항목이 {errorCount}개 있어요</p>
            <p className="dd-error-summary__text">아래 표시된 곳을 고치면 바로 찾아볼 수 있어요.</p>
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
            errors={cardErrors(["startAt", "start-at"], ["returnBy", "return-by"])}
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
              describedBy={describedBy("transport", "transport", Boolean(transportHint))}
              onChange={(value) => update({ transport: value })}
            />
          </FieldCard>

          <FieldCard label="어떤 걸 좋아해요?" labelAside="· 안 골라도 괜찮아요">
            <div className="dd-chip-group">
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
            <p className="dd-button-note">고쳐야 할 항목이 남아 있어 아직 찾을 수 없어요</p>
          ) : null}
        </div>
      </form>

      {submitted ? (
        <section className="dd-submitted" aria-label="제출한 여행 조건">
          <p className="dd-submitted__title">이 조건으로 찾아볼게요</p>
          <div className="dd-chip-group">
            <Chip
              variant="summary"
              label={`${provisionalSupportSet.origins.find((origin) => origin.id === submitted.originId)?.name ?? submitted.originId} 출발`}
            />
            <Chip variant="summary" label={`${formatDateTime(submitted.startAt)} 출발`} />
            <Chip variant="summary" label={`${formatDateTime(submitted.returnBy)} 복귀`} />
            <Chip variant="summary" label={`쓸 수 있는 시간 ${formatHours(submitted.availableHours)}`} />
            {submitted.interests.map((interest) => (
              <Chip key={interest} variant="summary" label={interest} />
            ))}
          </div>
          <p className="dd-submitted__note">
            추천 결과는 아직 준비 중이에요. 최소 현지 체류시간과 데이터 결측 처리 정책이 정해지면
            이어서 보여 드릴게요.
          </p>
          <div className="dd-submitted__actions">
            <Button variant="secondary" onClick={() => setSubmitted(null)}>
              조건 수정하기
            </Button>
          </div>
        </section>
      ) : null}

      <p className="dd-screen__footnote">
        이동시간은 평균값 기반 추정치예요. 실시간 교통 상황은 반영하지 않아요.
      </p>
    </main>
  );
}
