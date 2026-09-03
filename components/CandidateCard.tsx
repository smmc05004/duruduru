import type { ReactNode } from "react";
import { Button } from "./Button";
import {
  formatClockDuration,
  formatHoursAndMinutes,
  formatPercent,
} from "@/lib/format-duration";
import type { DomainDataStatus } from "@/lib/domain-data";
import type { CandidateEvaluation } from "@/lib/recommendation";

/*
 * F-02 출력/표시 + F-03 근거 + F-05 신뢰도 표시.
 * 시안: design/screens/Main.dc.html의 후보 카드.
 *
 * 이 컴포넌트는 규칙을 다시 판단하지 않는다. lib/recommendation.ts가 낸 값과 근거만 표시한다
 * (F-03 수용 기준 — 화면의 근거와 엔진의 점수 로그가 일치해야 한다).
 */

const checkIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M3.4 13.6l4-5 3.2 3 5.9-7" />
  </svg>
);

function BasisItem({ children }: { children: ReactNode }) {
  return (
    <span className="dd-basis__item">
      {checkIcon}
      {children}
    </span>
  );
}

const dataStatusLabel: Record<DomainDataStatus, string> = {
  normal: "정상",
  estimate: "추정",
  fallback: "대체값",
  missing: "결측",
  stale: "오래됨",
};

const dataStatusIcon: Record<DomainDataStatus, ReactNode> = {
  normal: checkIcon,
  estimate: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 7.5c2-3 4 3 6 0s4-3 6 0 2 3 3.5 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M2.5 12.5c2-3 4 3 6 0s4-3 6 0 2 3 3.5 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  ),
  fallback: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M10 6.2v4l2.7 1.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  ),
  stale: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M10 6.2v4l2.7 1.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  ),
  missing: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 10h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  ),
};

/**
 * E4가 남긴 provenance를 그대로 읽는다. 화면이 출처나 상태를 추론하지 않도록
 * 목적지·태그·이동시간의 근거를 분리해 표시한다(F-05).
 */
function DataEvidence({
  label,
  source,
  collectedAt,
  dataStatus,
}: {
  label: string;
  source: string;
  collectedAt: string;
  dataStatus: DomainDataStatus;
}) {
  return (
    <span
      className={`dd-basis__item dd-data-status dd-data-status--${dataStatus}`}
    >
      {dataStatusIcon[dataStatus]}
      {label} · 출처 {source} · 수집 {collectedAt || "시각 미기록"} · 상태{" "}
      {dataStatusLabel[dataStatus]}
    </span>
  );
}

/** 근거 문장. 실제로 계산된 항목만 쓴다(F-03 처리 규칙). */
function reasonSentence(candidate: CandidateEvaluation): string {
  const roundTrip = (candidate.roundTripHours ?? 0).toFixed(1);
  if (candidate.interestMatches.length > 0) {
    return `${candidate.interestMatches.join("·")} 여행에 잘 맞고, 왕복 약 ${roundTrip}시간으로 충분히 둘러볼 수 있어요.`;
  }
  return `왕복 약 ${roundTrip}시간으로, 주어진 일정 안에 다녀올 수 있어요. 다만 고른 관심사와는 겹치지 않아요.`;
}

type Props = {
  candidate: CandidateEvaluation;
  /** 선택 관심사 개수. 관심사 근거를 "2개 중 1개"로 쓰기 위해 필요하다. */
  selectedInterestCount: number;
  best: boolean;
  selected: boolean;
  onSelect: () => void;
};

export function CandidateCard({
  candidate,
  selectedInterestCount,
  best,
  selected,
  onSelect,
}: Props) {
  // 관심사와 겹치지 않는 후보는 시안대로 흐린 카드로 구분한다. 통과 여부와는 무관하다.
  const muted = candidate.interestMatches.length === 0;
  const oneWay = candidate.oneWayHours ?? 0;
  const local = candidate.localAvailableHours ?? 0;
  const total = oneWay * 2 + local;
  const movePercent = total > 0 ? (oneWay / total) * 100 : 0;

  const timeFit = candidate.components.find(
    (component) => component.id === "timeFit",
  );
  const interestFit = candidate.components.find(
    (component) => component.id === "interestFit",
  );

  return (
    <li
      className={[
        "dd-candidate",
        muted ? "dd-candidate--muted" : "",
        selected ? "dd-candidate--selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {best ? <span className="dd-candidate__best">가장 잘 맞아요</span> : null}

      <div
        className="dd-candidate__head"
        style={best ? { marginTop: 5 } : undefined}
      >
        <h2 className="dd-candidate__name">{candidate.name}</h2>
        <span className="dd-candidate__region">{candidate.region}</span>
      </div>

      <div className="dd-timebar">
        <div className="dd-timebar__track">
          <div
            className="dd-timebar__move"
            style={{ width: `${movePercent}%` }}
          />
          <div className="dd-timebar__stay" />
          <div
            className="dd-timebar__move"
            style={{ width: `${movePercent}%` }}
          />
        </div>
        <div className="dd-timebar__labels">
          <span>이동 {formatClockDuration(oneWay)}</span>
          <span className="dd-timebar__stay-label">
            머무는 시간 {formatHoursAndMinutes(local)}
          </span>
          <span>이동 {formatClockDuration(oneWay)}</span>
        </div>
      </div>

      <p className="dd-candidate__reason">{reasonSentence(candidate)}</p>

      <div className="dd-tag-row">
        {candidate.tags.map((tag) => (
          <span
            key={tag}
            className={
              candidate.interestMatches.includes(tag)
                ? "dd-tag"
                : "dd-tag dd-tag--plain"
            }
          >
            {tag}
          </span>
        ))}
      </div>

      {/*
        점수 숫자를 표시하므로 항목과 계산 원칙을 함께 보인다(F-03 출력/표시).
        문장은 DECISIONS.md 7.1·7.2절의 산식을 그대로 옮긴 것이다.
      */}
      <div className="dd-basis">
        {timeFit?.available ? (
          <BasisItem>
            시간 적합성 {formatPercent(timeFit.raw ?? 0)} · 쓸 수 있는 시간 중
            이동에 쓰이지 않은 비율
          </BasisItem>
        ) : null}
        {interestFit?.available ? (
          <BasisItem>
            관심사 일치 {candidate.interestMatches.length}/
            {selectedInterestCount} · 고른 관심사 중 겹친 개수
          </BasisItem>
        ) : (
          <BasisItem>
            {interestFit?.unavailableReason ?? "관심사 근거 없음"}
          </BasisItem>
        )}
        {/* F-05 신뢰도 표시 — 계산에 실제로 쓰인 계약 데이터의 provenance를 감추지 않는다. */}
        <DataEvidence
          label="목적지"
          source={candidate.data.destination.source}
          collectedAt={candidate.data.destination.collectedAt}
          dataStatus={candidate.data.destination.dataStatus}
        />
        <DataEvidence
          label="관심사 태그"
          source={candidate.data.tags.provenance.source}
          collectedAt={candidate.data.tags.provenance.collectedAt}
          dataStatus={candidate.data.tags.provenance.dataStatus}
        />
        {candidate.travel?.provenance ? (
          <DataEvidence
            label={`이동시간 추정 (${candidate.travel.basisDate} 기준)`}
            source={candidate.travel.provenance.source}
            collectedAt={candidate.travel.provenance.collectedAt}
            dataStatus={candidate.travel.provenance.dataStatus}
          />
        ) : (
          <BasisItem>
            이동시간 추정 · {candidate.travel?.source ?? "출처 미기록"} ·{" "}
            {candidate.travel?.basisDate ?? "기준일 미기록"} 기준 · 상태 미기록
          </BasisItem>
        )}
      </div>

      <div className="dd-candidate__action">
        <Button
          variant={best ? "primary" : "secondary"}
          onClick={onSelect}
          aria-pressed={selected}
        >
          {candidate.name} 일정 보기
        </Button>
      </div>

      {selected ? (
        <p className="dd-candidate__selected-note">
          {candidate.name}을(를) 골랐어요. 일정 결과 화면은 아직 준비 중이라
          여기까지만 보여 드려요.
        </p>
      ) : null}
    </li>
  );
}
