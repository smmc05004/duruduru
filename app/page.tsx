"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { ConditionSummary } from "@/components/ConditionSummary";
import { FieldCard, fieldErrorId } from "@/components/FieldCard";
import { InputField } from "@/components/InputField";
import { SegmentedControl } from "@/components/SegmentedControl";
import { formatHoursAndMinutes } from "@/lib/format-duration";
import {
  INTERESTS,
  ORIGINS,
  withDirectionParticle,
  type Candidate,
  type MvpOriginId,
  type Restaurant,
  type ScheduleItem,
} from "@/lib/mvp-core";
import type { MvpCategoryId } from "@/lib/mvp-region-data";

type View =
  "input" | "searching" | "candidates" | "restaurants" | "schedule" | "error";
type SearchResponse =
  | { kind: "success"; candidates: Candidate[] }
  | {
      kind: "input-error" | "no-results" | "data-error";
      message: string;
    };
const initial = {
  originId: "seoul" as MvpOriginId,
  startAt: "",
  returnBy: "",
  interests: [] as MvpCategoryId[],
};

export default function Page() {
  const [input, setInput] = useState(initial);
  const [view, setView] = useState<View>("input");
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[] | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  // 진행 중인 검색·조회를 취소·수정으로 중단할 때 늦게 도착한 응답이 화면을 되돌리지 못하게 막는다.
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const startRun = () => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    return { runId: runIdRef.current, signal: abortRef.current.signal };
  };
  const stopRun = (next: View) => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setView(next);
  };
  const origin = ORIGINS.find((item) => item.id === input.originId)!;
  const toggle = (id: MvpCategoryId) =>
    setInput((current) => ({
      ...current,
      interests: current.interests.includes(id)
        ? current.interests.filter((item) => item !== id)
        : [...current.interests, id],
    }));
  const isOneNight = () => {
    const start = new Date(`${input.startAt}:00+09:00`);
    const end = new Date(`${input.returnBy}:00+09:00`);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    )
      return false;
    return (
      Math.floor((end.getTime() + 32_400_000) / 86_400_000) -
        Math.floor((start.getTime() + 32_400_000) / 86_400_000) +
        1 ===
      2
    );
  };
  // 항목별 검증. 출발지는 세그먼티드라 항상 값이 있어 오류가 없다.
  const fieldErrors: { tripDates?: string; interests?: string } = {};
  if (!isOneNight())
    fieldErrors.tripDates =
      "1박 2일 일정만 만들 수 있어요. 복귀 날짜를 출발 다음날로 맞춰 주세요.";
  if (input.interests.length === 0)
    fieldErrors.interests =
      "관심사를 하나 이상 골라 주세요. 고른 관심사의 공식 분류 관광지로 후보를 걸러요.";
  const errorCount = Object.keys(fieldErrors).length;
  const visibleErrors = showErrors ? fieldErrors : {};
  const visibleErrorCount = showErrors ? errorCount : 0;
  useEffect(() => {
    if (visibleErrorCount > 0) errorSummaryRef.current?.focus();
  }, [visibleErrorCount]);
  async function search(event: FormEvent) {
    event.preventDefault();
    if (errorCount > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    const { runId, signal } = startRun();
    setView("searching");
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });
      const result = (await response.json()) as SearchResponse;
      if (runIdRef.current !== runId) return;
      if (result.kind !== "success") throw new Error(result.message);
      setCandidates(result.candidates);
      setView("candidates");
    } catch (error) {
      if (runIdRef.current !== runId || signal.aborted) return;
      setMessage(
        error instanceof Error ? error.message : "검색을 시작하지 못했어요.",
      );
      setView("error");
    }
  }
  async function choose(candidate: Candidate) {
    setSelected(candidate);
    const { runId, signal } = startRun();
    setView("restaurants");
    try {
      const response = await fetch(
        `/api/destinations/${candidate.regionId}/restaurants`,
        { signal },
      );
      const result = await response.json();
      if (runIdRef.current !== runId) return;
      if (result.kind !== "success") throw new Error(result.message);
      setRestaurants(result.restaurants);
      const items = createSchedule(input, candidate, result.restaurants);
      if (!items) throw new Error("식사 정보를 준비하지 못했어요.");
      setSchedule(items);
      setView("schedule");
    } catch (error) {
      if (runIdRef.current !== runId || signal.aborted) return;
      setMessage(
        error instanceof Error
          ? error.message
          : "음식점 목록을 불러오지 못했어요.",
      );
      setView("error");
    }
  }
  async function openRestaurant(restaurant: Restaurant) {
    setDetail("불러오는 중");
    try {
      const response = await fetch(`/api/restaurants/${restaurant.contentId}`);
      const result = await response.json();
      setDetail(
        result.kind === "success"
          ? JSON.stringify(result.detail)
          : result.message,
      );
    } catch {
      setDetail("음식점 상세 정보를 불러오지 못했어요. 다시 시도해 주세요.");
    }
  }
  if (view === "searching")
    return (
      <main className="dd-screen">
        <Header />
        <ConditionSummary input={input} />
        <ProgressNotice title="갈 수 있는 곳을 찾고 있어요" />
        <div className="dd-loading-cards">
          <SkeletonCandidateCard />
          <SkeletonCandidateCard />
        </div>
        <div className="dd-result-actions">
          <Button variant="secondary" onClick={() => stopRun("input")}>
            검색을 멈추고 조건 수정하기
          </Button>
        </div>
        <p className="dd-screen__footnote">
          이동시간은 국가교통DB 기반 지역 간 자동차 일반 예상값이에요. 실시간
          교통 상황은 반영하지 않아요.
        </p>
      </main>
    );
  if (view === "restaurants" && selected)
    return (
      <main className="dd-screen">
        <Header />
        <ConditionSummary input={input} destination={selected} />
        <ProgressNotice
          title="선택한 지역의 음식점을 불러오고 있어요"
          detail={`${selected.displayName} 음식점 목록을 받아 점심·저녁을 채우는 중이에요.`}
        />
        <PlanPreview input={input} destination={selected} />
        <div className="dd-result-actions">
          <Button variant="secondary" onClick={() => stopRun("candidates")}>
            조회를 멈추고 다른 지역 보기
          </Button>
        </div>
        <p className="dd-screen__footnote">
          음식점은 선택한 한 지역에서만 목록 기본 정보를 조회해요.
          운영시간·메뉴는 나중에 음식점을 열 때 확인해요.
        </p>
      </main>
    );
  if (view === "error")
    return (
      <main className="dd-screen">
        <Header />
        <section className="dd-error-summary" role="alert">
          <p className="dd-error-summary__title">지금은 준비하지 못했어요</p>
          <p>{message}</p>
        </section>
        <Button
          variant="primary"
          onClick={() => (selected ? choose(selected) : setView("input"))}
        >
          다시 시도하기
        </Button>
      </main>
    );
  if (view === "schedule" && selected && schedule)
    return (
      <main className="dd-screen">
        <Header />
        <h1 className="dd-screen__title">
          {selected.displayName} 참고용 여행 계획
        </h1>
        {([1, 2] as const).map((day) => (
          <section key={day} className="dd-summary-card">
            <h2>{day}일차</h2>
            {schedule
              .filter((item) => item.day === day)
              .map((item) => (
                <p key={`${item.time}-${item.title}`}>
                  {item.time} · {item.type} · {item.title}
                </p>
              ))}
          </section>
        ))}
        <section className="dd-summary-card">
          <h2>식사 장소</h2>
          {restaurants.map((restaurant) => (
            <button
              className="dd-button dd-button--secondary"
              key={restaurant.contentId}
              onClick={() => openRestaurant(restaurant)}
            >
              {restaurant.name}
            </button>
          ))}
          {detail ? <p>{detail}</p> : null}
        </section>
        <Button variant="secondary" onClick={() => setView("candidates")}>
          다른 지역 보기
        </Button>
      </main>
    );
  if (view === "candidates")
    return (
      <main className="dd-screen">
        <Header />
        <h1 className="dd-screen__title">{origin.label}에서 갈 수 있는 곳</h1>
        <ol className="dd-candidates">
          {candidates.map((candidate) => (
            <li className="dd-candidate" key={candidate.regionId}>
              <h2 className="dd-candidate__name">{candidate.displayName}</h2>
              {candidate.name !== candidate.displayName ? (
                <p className="dd-candidate__region">{candidate.name}</p>
              ) : null}
              <p>
                왕복 일반 예상{" "}
                {formatHoursAndMinutes((candidate.oneWayMinutes * 2) / 60)} ·
                현지 이용 가능{" "}
                {formatHoursAndMinutes(candidate.localMinutes / 60)}
              </p>
              <p>
                관심사 {candidate.interestLabels.join(" · ")} · 관광지{" "}
                {candidate.attractions.length}곳
              </p>
              <Button variant="primary" onClick={() => choose(candidate)}>
                {candidate.displayName} 일정 보기
              </Button>
            </li>
          ))}
        </ol>
        <Button variant="secondary" onClick={() => setView("input")}>
          조건 수정하기
        </Button>
      </main>
    );
  return (
    <main className="dd-screen">
      <Header />
      <h1 className="dd-screen__title">
        쓸 수 있는 시간을 알려주면
        <br />갈 곳부터 골라줄게요
      </h1>
      {visibleErrorCount > 0 ? (
        <div
          className="dd-error-summary"
          role="alert"
          tabIndex={-1}
          ref={errorSummaryRef}
        >
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
              고쳐야 할 항목이 {visibleErrorCount}개 있어요
            </p>
            <p className="dd-error-summary__text">
              아래 표시된 곳을 고치면 바로 찾아볼 수 있어요.
            </p>
          </div>
        </div>
      ) : null}
      <form onSubmit={search}>
        <div className="dd-screen__fields">
          <FieldCard label="어디서 출발해요?">
            <SegmentedControl
              label="출발지"
              options={ORIGINS.map(({ id, label }) => ({ value: id, label }))}
              value={input.originId}
              onChange={(originId) =>
                setInput({ ...input, originId: originId as MvpOriginId })
              }
            />
          </FieldCard>
          <FieldCard
            label="언제 나가서 언제까지 돌아와요?"
            errors={
              visibleErrors.tripDates
                ? [
                    {
                      inputId: "trip-dates",
                      message: visibleErrors.tripDates,
                    },
                  ]
                : undefined
            }
          >
            <div className="dd-datetime-pair">
              <InputField
                id="start"
                aria-label="출발 일시"
                aria-describedby={
                  visibleErrors.tripDates
                    ? fieldErrorId("trip-dates")
                    : undefined
                }
                invalid={Boolean(visibleErrors.tripDates)}
                prefix="출발"
                type="datetime-local"
                value={input.startAt}
                onChange={(event) =>
                  setInput({ ...input, startAt: event.target.value })
                }
              />
              <InputField
                id="return"
                aria-label="복귀 가능 일시"
                aria-describedby={
                  visibleErrors.tripDates
                    ? fieldErrorId("trip-dates")
                    : undefined
                }
                invalid={Boolean(visibleErrors.tripDates)}
                prefix="복귀"
                type="datetime-local"
                value={input.returnBy}
                onChange={(event) =>
                  setInput({ ...input, returnBy: event.target.value })
                }
              />
            </div>
          </FieldCard>
          <FieldCard
            label="무엇으로 이동해요?"
            hint="현재는 자차 여행만 지원해요."
          >
            <SegmentedControl
              label="이동수단"
              options={[{ value: "car", label: "자차" }]}
              value="car"
              onChange={() => undefined}
            />
          </FieldCard>
          <FieldCard
            label="어떤 걸 좋아해요?"
            labelAside="· 하나 이상 골라 주세요"
            invalid={Boolean(visibleErrors.interests)}
            errors={
              visibleErrors.interests
                ? [{ inputId: "interests", message: visibleErrors.interests }]
                : undefined
            }
          >
            <div
              className="dd-chip-group"
              role="group"
              aria-label="관심사"
              aria-describedby={
                visibleErrors.interests ? fieldErrorId("interests") : undefined
              }
            >
              {INTERESTS.map((interest) => (
                <Chip
                  key={interest.id}
                  variant="selectable"
                  label={interest.label}
                  selected={input.interests.includes(interest.id)}
                  onToggle={() => toggle(interest.id)}
                />
              ))}
            </div>
          </FieldCard>
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={visibleErrorCount > 0}
        >
          갈 수 있는 곳 찾기
        </Button>
        {visibleErrorCount > 0 ? (
          <p className="dd-button-note">
            고쳐야 할 항목이 남아 있어 아직 찾을 수 없어요
          </p>
        ) : null}
      </form>
    </main>
  );
}
function Header() {
  return (
    <div className="dd-screen__header">
      <span className="dd-screen__logo">두루두루</span>
      <span>1박 2일</span>
    </div>
  );
}

/* 진행 상태를 정상 안내 배너(--olive-soft/--olive)로 알린다. DESIGN_TOKENS.md 「로딩 상태」. */
function ProgressNotice({ title, detail }: { title: string; detail?: string }) {
  return (
    <section className="dd-calculating" role="status">
      <svg
        width="22"
        height="22"
        viewBox="0 0 20 20"
        fill="none"
        stroke="var(--olive-ink)"
        strokeWidth="1.9"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M10 2.8a7.2 7.2 0 1 1-6.9 5.1" />
      </svg>
      <div className="dd-calculating__body">
        <p>{title}</p>
        {detail ? <p className="dd-calculating__sub">{detail}</p> : null}
      </div>
    </section>
  );
}

/* 아직 나오지 않은 후보 카드. 껍데기(2px --line + 하드 섀도)는 유지하고 내용만 스켈레톤으로 둔다. */
function SkeletonCandidateCard() {
  return (
    <div className="dd-skeleton-card" aria-hidden="true">
      <div className="dd-skeleton-card__head">
        <div className="dd-skeleton dd-skeleton--title" />
        <div className="dd-skeleton dd-skeleton--region" />
      </div>
      <div className="dd-skeleton dd-skeleton--bar" />
      <div className="dd-skeleton dd-skeleton--line" />
      <div className="dd-skeleton dd-skeleton--line-short" />
      <div className="dd-skeleton-card__tags">
        <div className="dd-skeleton dd-skeleton--tag" />
        <div className="dd-skeleton dd-skeleton--tag" />
        <div className="dd-skeleton dd-skeleton--tag" />
      </div>
    </div>
  );
}

type PreviewRow =
  | { key: string; kind: "이동"; title: string; meta?: string }
  | { key: string; kind: "관광"; title: string | null }
  | { key: string; kind: "점심" | "저녁" };

const skeletonBody = (
  <>
    <div className="dd-skeleton dd-skeleton--inline" />
    <div className="dd-skeleton dd-skeleton--meta" />
  </>
);

function PlanPreviewRow({ row }: { row: PreviewRow }) {
  let kindClass = "dd-timeline-row__kind";
  let kindLabel: string;
  let stay: boolean;
  let body: ReactNode;
  if (row.kind === "이동") {
    kindLabel = "이동";
    stay = false;
    body = (
      <>
        <p className="dd-timeline-row__title">{row.title}</p>
        {row.meta ? <p className="dd-timeline-row__meta">{row.meta}</p> : null}
      </>
    );
  } else if (row.kind === "관광") {
    kindClass += " dd-timeline-row__kind--visit";
    kindLabel = "방문";
    stay = true;
    body = row.title ? (
      <>
        <p className="dd-timeline-row__title">{row.title}</p>
        <p className="dd-timeline-row__meta">체류 1시간</p>
      </>
    ) : (
      skeletonBody
    );
  } else {
    kindClass += " dd-timeline-row__kind--meal";
    kindLabel = row.kind;
    stay = true;
    body = skeletonBody;
  }
  return (
    <div className="dd-timeline-row">
      <div className="dd-timeline-row__time">
        <div className="dd-skeleton" />
      </div>
      <div
        className={
          stay
            ? "dd-timeline-row__card dd-timeline-row__card--stay"
            : "dd-timeline-row__card"
        }
      >
        <span className={kindClass}>{kindLabel}</span>
        {body}
      </div>
    </div>
  );
}

/*
 * 음식점 조회 중 계획 미리보기.
 * 관광·이동 블록은 선택한 후보의 실제 값을 유지하고, 아직 못 받은 식사 칸과
 * 아직 계산 전인 시각 열만 스켈레톤으로 둔다(이슈 #53).
 */
function PlanPreview({
  input,
  destination,
}: {
  input: typeof initial;
  destination: Candidate;
}) {
  const originLabel =
    ORIGINS.find((item) => item.id === input.originId)?.label ?? "출발지";
  const attraction = (index: number) =>
    destination.attractions[index]?.title ?? null;
  const days: Array<{ day: 1 | 2; rows: PreviewRow[] }> = [
    {
      day: 1,
      rows: [
        {
          key: "d1-depart",
          kind: "이동",
          title: `${withDirectionParticle(destination.displayName)} 출발`,
          meta: `일반 예상 이동 ${formatHoursAndMinutes(
            destination.oneWayMinutes / 60,
          )} · 자차 기준`,
        },
        { key: "d1-lunch", kind: "점심" },
        { key: "d1-a0", kind: "관광", title: attraction(0) },
        { key: "d1-a1", kind: "관광", title: attraction(1) },
        { key: "d1-dinner", kind: "저녁" },
      ],
    },
    {
      day: 2,
      rows: [
        { key: "d2-a2", kind: "관광", title: attraction(2) },
        { key: "d2-lunch", kind: "점심" },
        { key: "d2-a3", kind: "관광", title: attraction(3) },
        { key: "d2-dinner", kind: "저녁" },
        {
          key: "d2-return",
          kind: "이동",
          title: `${withDirectionParticle(originLabel)} 복귀`,
          meta: "자차 기준",
        },
      ],
    },
  ];
  return (
    <div className="dd-plan-preview">
      {days.map(({ day, rows }) => (
        <div key={day} className="dd-plan-preview__group">
          <p className="dd-plan-preview__day">{day}일차</p>
          {rows.map((row) => (
            <PlanPreviewRow key={row.key} row={row} />
          ))}
        </div>
      ))}
    </div>
  );
}

function createSchedule(
  input: typeof initial,
  candidate: Candidate,
  restaurants: Restaurant[],
): ScheduleItem[] | null {
  const distinctRestaurants = [
    ...new Map(
      restaurants.map((restaurant) => [restaurant.contentId, restaurant]),
    ).values(),
  ];
  if (candidate.attractions.length < 3) return null;
  const place = (index: number) =>
    candidate.attractions[index % candidate.attractions.length].title;
  const mealRestaurant = (index: number) =>
    distinctRestaurants[index]?.name ?? "추천할 식당을 더 찾지 못했어요";
  return [
    {
      day: 1,
      time: input.startAt.slice(11),
      type: "이동",
      title: `${withDirectionParticle(candidate.displayName)} 출발`,
    },
    { day: 1, time: "11:30", type: "점심", title: mealRestaurant(0) },
    { day: 1, time: "13:30", type: "관광", title: place(0) },
    { day: 1, time: "15:00", type: "관광", title: place(1) },
    { day: 1, time: "17:30", type: "저녁", title: mealRestaurant(1) },
    { day: 2, time: "09:00", type: "관광", title: place(2) },
    { day: 2, time: "11:30", type: "점심", title: mealRestaurant(2) },
    { day: 2, time: "13:30", type: "관광", title: place(3) },
    { day: 2, time: "17:30", type: "저녁", title: mealRestaurant(3) },
    {
      day: 2,
      time: input.returnBy.slice(11),
      type: "이동",
      title: `${withDirectionParticle(
        ORIGINS.find((item) => item.id === input.originId)?.label ?? "출발지",
      )} 복귀`,
    },
  ];
}
