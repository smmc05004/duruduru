import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import {
  INTERESTS,
  ORIGINS,
  type Candidate,
  type SearchInput,
  type TimeBlock,
} from "@/lib/mvp-phase-two-types";

export const notebookDuration = (minutes: number) =>
  minutes < 60
    ? `${minutes}분`
    : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ""}`;
export const notebookDate = (value: string) =>
  `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))} ${value.slice(11, 16)}`;

export function NotebookIcon({
  kind,
}: {
  kind: TimeBlock["kind"] | "back" | "warning" | "map";
}) {
  const paths = {
    travel: "M3 12.5h14M4.5 12.5V9.2l1.8-3.4h7.4l1.8 3.4v3.3M5 14h3M12 14h3",
    attraction:
      "M3 16.5h14M5.5 16.5V8.2L10 4.5l4.5 3.7v8.3M8.4 16.5v-4.2h3.2v4.2",
    meal: "M6.5 3v6a2 2 0 0 0 4 0V3M8.5 11v6M14 3c1.4 1.2 1.4 4.4 0 5.6V17",
    rest: "M7 3.5a6.5 6.5 0 1 0 9.5 8A5.2 5.2 0 0 1 7 3.5z",
    free: "M10 3v3M10 14v3M3 10h3M14 10h3M5 5l2 2M13 13l2 2M5 15l2-2M13 7l2-2",
    back: "M12 5l-5 5 5 5",
    warning: "M10 3.2l7 12.4H3zM10 7.8v3.4M10 13.6v.2",
    map: "M2 5l5-2 6 2 5-2v12l-5 2-6-2-5 2zM7 3v12M13 5v12",
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

export function NotebookConditions({
  input,
  title,
}: {
  input: SearchInput;
  title: string;
}) {
  return (
    <section className="p2-panel p2-summary" aria-label="여행 조건">
      <h1>{title}</h1>
      <div className="p2-summary-chips">
        <Chip
          variant="summary"
          label={`${ORIGINS.find((origin) => origin.id === input.originId)?.label} 출발 · 자차`}
        />
        <Chip variant="summary" label={`${notebookDate(input.startAt)} 출발`} />
        <Chip
          variant="summary"
          label={`${notebookDate(input.returnBy)} 귀가`}
        />
        {INTERESTS.filter((interest) =>
          input.interests.includes(interest.id),
        ).map((interest) => (
          <span className="p2-interest-label" key={interest.id}>
            {interest.label}
          </span>
        ))}
      </div>
    </section>
  );
}

export function NotebookCandidate({
  candidate,
  best,
  onChoose,
}: {
  candidate: Candidate;
  best: boolean;
  onChoose: () => void;
}) {
  const { metrics, blocks } = candidate.preview;
  const moveRatio =
    (100 * candidate.oneWayMinutes) /
    (2 * candidate.oneWayMinutes + metrics.localMinutes);
  const move = `${Math.floor(candidate.oneWayMinutes / 60)}:${String(candidate.oneWayMinutes % 60).padStart(2, "0")}`;
  return (
    <article className="dd-candidate">
      {best ? <span className="dd-candidate__best">가장 잘 맞아요</span> : null}
      <div className="dd-candidate__head">
        <h2 className="dd-candidate__name">{candidate.displayName}</h2>
        {candidate.name !== candidate.displayName ? (
          <span className="dd-candidate__region">{candidate.name}</span>
        ) : null}
      </div>
      <div
        className="dd-timebar"
        aria-label={`왕복 이동 ${notebookDuration(candidate.oneWayMinutes * 2)}, 현지 활동 ${notebookDuration(metrics.localMinutes)}`}
      >
        <div className="dd-timebar__track" aria-hidden="true">
          <span
            className="dd-timebar__move"
            style={{ width: `${moveRatio}%` }}
          />
          <span className="dd-timebar__stay" />
          <span
            className="dd-timebar__move"
            style={{ width: `${moveRatio}%` }}
          />
        </div>
        <div className="dd-timebar__labels">
          <span>이동 {move}</span>
          <span className="dd-timebar__stay-label">
            활동 {notebookDuration(metrics.localMinutes)}
          </span>
          <span>이동 {move}</span>
        </div>
      </div>
      <p className="dd-candidate__reason">
        {INTERESTS.filter((interest) =>
          metrics.fulfilledInterests.includes(interest.id),
        )
          .map((interest) => interest.label)
          .join(" · ")}{" "}
        여행으로 {metrics.attractionCount}곳을 둘러보고, 자유시간{" "}
        {notebookDuration(metrics.freeMinutes)}을 남겼어요.
      </p>
      <p className="p2-muted">
        활동시간은 현지 식사·관광·자유시간이며, 야간 휴식은 제외해요.
      </p>
      <div className="p2-place-tags">
        {blocks
          .filter((block) => block.attraction)
          .map((block) => (
            <span key={block.id}>{block.title}</span>
          ))}
      </div>
      <details className="p2-basis">
        <summary>방문 미리보기·추천 근거</summary>
        <ol className="p2-preview">
          {blocks
            .filter((block) => block.attraction)
            .map((block) => (
              <li key={block.id}>
                {block.day}일차 {block.startAt.slice(11, 16)} · {block.title}
              </li>
            ))}
        </ol>
        <ul>
          {candidate.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </details>
      <div className="dd-candidate__action">
        <Button variant={best ? "primary" : "secondary"} onClick={onChoose}>
          {candidate.displayName} 일정 보기
        </Button>
      </div>
    </article>
  );
}
