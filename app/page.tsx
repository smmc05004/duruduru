"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
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
    setView("searching");
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = (await response.json()) as SearchResponse;
      if (result.kind !== "success") throw new Error(result.message);
      setCandidates(result.candidates);
      setView("candidates");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "검색을 시작하지 못했어요.",
      );
      setView("error");
    }
  }
  async function choose(candidate: Candidate) {
    setSelected(candidate);
    setView("restaurants");
    try {
      const response = await fetch(
        `/api/destinations/${candidate.regionId}/restaurants`,
      );
      const result = await response.json();
      if (result.kind !== "success") throw new Error(result.message);
      setRestaurants(result.restaurants);
      const items = createSchedule(input, candidate, result.restaurants);
      if (!items) throw new Error("식사 정보를 준비하지 못했어요.");
      setSchedule(items);
      setView("schedule");
    } catch (error) {
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
  if (view === "searching" || view === "restaurants")
    return (
      <main className="dd-screen">
        <Header />
        <section className="dd-calculating" role="status">
          <p>
            {view === "searching"
              ? "갈 수 있는 곳을 찾고 있어요"
              : "선택한 지역의 음식점을 불러오고 있어요"}
          </p>
        </section>
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
