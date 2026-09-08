"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { ConditionSummary } from "@/components/ConditionSummary";
import { FieldCard, fieldErrorId } from "@/components/FieldCard";
import { InputField } from "@/components/InputField";
import { SegmentedControl } from "@/components/SegmentedControl";
import {
  RestaurantDetailSheet,
  type RestaurantDetailState,
} from "@/components/RestaurantDetailSheet";
import { formatHoursAndMinutes } from "@/lib/format-duration";
import {
  INTERESTS,
  ORIGINS,
  assessItinerary,
  createSchedule,
  withDirectionParticle,
  type Candidate,
  type ItineraryShortfall,
  type MvpOriginId,
  type Restaurant,
  type ScheduleItem,
} from "@/lib/mvp-core";
import type { MvpCategoryId } from "@/lib/mvp-region-data";

type View =
  | "input"
  | "searching"
  | "candidates"
  | "restaurants"
  | "schedule"
  | "no-itinerary"
  | "error";
type SearchResponse =
  | { kind: "success"; candidates: Candidate[] }
  | {
      kind: "input-error" | "no-results" | "data-error";
      message: string;
    };
// 식사 정보 실패 배너에 적는 "시도 시각"용. 실시간 교통·조회 시각과 무관한 표시 전용.
const kstClock = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
// 음식점 상세 시트의 "조회 시각"용. 표시 전용이며 일정·시간표에 영향을 주지 않는다.
const detailClockParts = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function formatDetailFetchedAt(date: Date) {
  const parts = detailClockParts.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

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
  // 음식점 목록 수집 실패(재시도 가능)와 "정상 응답인데 식당이 부족함"을 구분한다.
  // mealFailed=true는 목록 API 장애·네트워크 오류로, 식사 섹션만 재시도 상태로 보인다.
  const [mealFailed, setMealFailed] = useState(false);
  const [mealRetrying, setMealRetrying] = useState(false);
  const [mealAttemptAt, setMealAttemptAt] = useState("");
  const [schedule, setSchedule] = useState<ScheduleItem[] | null>(null);
  const [shortfall, setShortfall] = useState<ItineraryShortfall | null>(null);
  // 음식점 상세 시트. 상세 조회 실패는 시트 안에서만 재시도하며 schedule·식사 배치는 건드리지 않는다.
  const [openedRestaurant, setOpenedRestaurant] = useState<Restaurant | null>(
    null,
  );
  const [detailState, setDetailState] = useState<RestaurantDetailState | null>(
    null,
  );
  const [detailFetchedAt, setDetailFetchedAt] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  // 진행 중인 검색·조회를 취소·수정으로 중단할 때 늦게 도착한 응답이 화면을 되돌리지 못하게 막는다.
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const startRun = () => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    // 화면 전환 때 이전 음식점 상세 시트를 닫는다(다른 음식점·다른 지역으로 상태가 새지 않게).
    setOpenedRestaurant(null);
    setDetailState(null);
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
    setMealRetrying(false);
    const { runId, signal } = startRun();
    setView("restaurants");
    // 음식점 목록 조회는 관광 일정 생성과 분리한다. 목록 API가 실패해도
    // 목적지 추천·관광 계획은 유지하고 식사 섹션만 재시도 상태로 보인다.
    // (docs/product/FOOD_DATA_POLICY.md·API_FETCH_FLOW.md 실패 처리 절)
    let fetched: Restaurant[] = [];
    let failed = false;
    try {
      const response = await fetch(
        `/api/destinations/${candidate.regionId}/restaurants`,
        { signal },
      );
      const result = await response.json();
      if (runIdRef.current !== runId) return;
      // route.ts는 실패 시 kind:"data-error"(502), 정상이면 kind:"success"이며
      // restaurants가 빈 배열일 수 있다. 전자만 재시도 대상으로 구분한다.
      if (result.kind === "success")
        fetched = result.restaurants as Restaurant[];
      else failed = true;
    } catch {
      if (runIdRef.current !== runId || signal.aborted) return;
      failed = true;
    }
    // 시간 경계 산술로 최소 시간표가 나오지 않으면 데이터 장애가 아니라
    // 정상 예외(일정 생성 불가)로 보낸다. DESIGN_TOKENS.md 「결과 없음 · 일정 생성 불가 · 데이터 장애」.
    // 음식점 실패는 이 판정보다 뒤 단계다.
    const assessment = assessItinerary(input, candidate);
    if (!assessment.feasible) {
      setShortfall(assessment);
      setView("no-itinerary");
      return;
    }
    const items = createSchedule(input, candidate, fetched);
    if (!items) {
      // assessment가 feasible이면 여기 오지 않지만, 방어적으로 정상 예외로 처리한다.
      setShortfall({
        reason: "이 조건으로는 겹치지 않는 최소 시간표를 만들지 못했어요.",
        roundTripHours: Math.round((candidate.oneWayMinutes * 2) / 6) / 10,
        days: [],
      });
      setView("no-itinerary");
      return;
    }
    setRestaurants(fetched);
    setMealFailed(failed);
    if (failed) setMealAttemptAt(kstClock.format(new Date()));
    setSchedule(items);
    setView("schedule");
  }
  async function retryMeals() {
    if (!selected) return;
    const candidate = selected;
    const { runId, signal } = startRun();
    setMealRetrying(true);
    try {
      const response = await fetch(
        `/api/destinations/${candidate.regionId}/restaurants`,
        { signal },
      );
      const result = await response.json();
      if (runIdRef.current !== runId) return;
      if (result.kind !== "success") throw new Error();
      const fetched = result.restaurants as Restaurant[];
      const items = createSchedule(input, candidate, fetched);
      setRestaurants(fetched);
      setMealFailed(false);
      setMealRetrying(false);
      if (items) setSchedule(items);
    } catch {
      if (runIdRef.current !== runId || signal.aborted) return;
      setMealFailed(true);
      setMealRetrying(false);
      setMealAttemptAt(kstClock.format(new Date()));
    }
  }
  async function loadRestaurantDetail(restaurant: Restaurant) {
    setDetailState({ status: "loading" });
    try {
      const response = await fetch(`/api/restaurants/${restaurant.contentId}`);
      const result = await response.json();
      // route.ts는 정규화한 detail을 kind:"success"로, 상세 조회 실패는 kind:"data-error"(502)로 준다.
      // 상세 실패는 시트 안 재시도로만 처리하고 일정 전체를 장애로 만들지 않는다.
      if (result.kind === "success") {
        setDetailFetchedAt(formatDetailFetchedAt(new Date()));
        setDetailState({ status: "success", detail: result.detail });
      } else {
        setDetailState({ status: "error" });
      }
    } catch {
      setDetailState({ status: "error" });
    }
  }
  async function openRestaurant(restaurant: Restaurant) {
    setOpenedRestaurant(restaurant);
    await loadRestaurantDetail(restaurant);
  }
  function closeRestaurantDetail() {
    setOpenedRestaurant(null);
    setDetailState(null);
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
  if (view === "no-itinerary" && selected && shortfall)
    return (
      <main className="dd-screen">
        <Header />
        <ConditionSummary input={input} destination={selected} />
        <section className="dd-no-itinerary" aria-label="일정 생성 불가">
          <svg
            className="dd-no-itinerary__icon"
            width="92"
            height="72"
            viewBox="0 0 116 90"
            fill="none"
            stroke="var(--line-dashed)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="12" y="16" width="92" height="62" />
            <path d="M12 32h92M32 8v14M84 8v14" />
            <path d="M30 48h20M30 62h34" stroke="var(--track-move)" />
            <path d="M68 46l18 18M86 46l-18 18" />
          </svg>
          <p className="dd-no-itinerary__title">
            {"지금은 계획을\n만들 수 없어요"}
          </p>
          <p className="dd-no-itinerary__reason">{shortfall.reason}</p>
          <p className="dd-no-itinerary__note">
            문제가 생긴 게 아니라, 조건과 시간표가 서로 맞지 않는 거예요. 어설픈
            계획을 억지로 만들지 않았어요.
          </p>
        </section>
        {shortfall.days.length > 0 ? (
          <>
            <p className="dd-no-itinerary__breakdown-title">
              시간이 어떻게 모자랐는지
            </p>
            <div className="dd-no-itinerary__breakdown">
              {shortfall.days.map((entry) => (
                <div key={entry.day} className="dd-shortfall-day">
                  <p className="dd-shortfall-day__label">{entry.day}일차</p>
                  <p className="dd-shortfall-day__note">{entry.note}</p>
                </div>
              ))}
            </div>
          </>
        ) : null}
        <div className="dd-result-actions dd-no-itinerary__actions">
          <Button variant="primary" onClick={() => stopRun("input")}>
            조건 수정하기
          </Button>
          <Button variant="secondary" onClick={() => stopRun("candidates")}>
            더 가까운 다른 곳 보기
          </Button>
        </div>
        <p className="dd-screen__footnote">
          머무는 시간과 복귀 여유 시간의 기준은 아직 확정되지 않았어요. 확정되면
          이 판단도 달라질 수 있어요. 시스템·데이터 장애와는 다른 정상 상태예요.
        </p>
      </main>
    );
  if (view === "schedule" && selected && schedule)
    return (
      <main className="dd-screen">
        <Header />
        <h1 className="dd-screen__title">
          {selected.displayName} 참고용 여행 계획
        </h1>
        {mealFailed ? (
          <MealFailureNotice
            destinationName={selected.displayName}
            attemptAt={mealAttemptAt}
            retrying={mealRetrying}
            onRetry={retryMeals}
          />
        ) : null}
        {([1, 2] as const).map((day) => (
          <section key={day} className="dd-summary-card">
            <h2>{day}일차</h2>
            {schedule
              .filter((item) => item.day === day)
              .map((item) => {
                const isMeal = item.type === "점심" || item.type === "저녁";
                const title =
                  mealFailed && isMeal
                    ? "식사 정보를 다시 불러오면 채워져요"
                    : item.title;
                return (
                  <p key={`${item.day}-${item.time}-${item.type}`}>
                    {item.time} · {item.type} · {title}
                  </p>
                );
              })}
          </section>
        ))}
        {mealFailed ? null : (
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
          </section>
        )}
        <Button variant="secondary" onClick={() => setView("candidates")}>
          다른 지역 보기
        </Button>
        {openedRestaurant && detailState ? (
          <RestaurantDetailSheet
            restaurantName={openedRestaurant.name}
            regionLabel={`${selected.name} · TourAPI 콘텐츠 ID 기준`}
            fetchedAt={detailFetchedAt}
            state={detailState}
            onRetry={() => loadRestaurantDetail(openedRestaurant)}
            onClose={closeRestaurantDetail}
          />
        ) : null}
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

/*
 * 식사 정보 부분 실패 배너 (이슈 #55).
 * 선택 지역의 음식점 목록만 못 받은 상태다. 추천 지역·관광 계획은 그대로 렌더하고
 * 식사 섹션만 --alert 2px 실선으로 막는다. 상단 8px 띠·3px 이중 테두리는 쓰지 않는다
 * (부분 실패이지 화면 전체 데이터 장애가 아님). DESIGN_TOKENS.md
 * 「결과 없음 · 일정 생성 불가 · 식사 정보 실패 · 데이터 장애」.
 */
function MealFailureNotice({
  destinationName,
  attemptAt,
  retrying,
  onRetry,
}: {
  destinationName: string;
  attemptAt: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <section className="dd-meal-failure" role="alert">
      <div className="dd-meal-failure__head">
        <svg
          className="dd-meal-failure__icon"
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
          <p className="dd-meal-failure__title">
            식사 정보를 불러오지 못했어요
          </p>
          <p className="dd-meal-failure__text">
            {destinationName} 음식점 목록을 받지 못해 점심·저녁을 채우지
            못했어요. 추천 지역과 관광 계획은 그대로예요. 임의 음식점으로
            대체하지 않았어요.
            {attemptAt ? ` (${attemptAt} 시도)` : ""}
          </p>
        </div>
      </div>
      <button
        type="button"
        className="dd-button dd-button--recover"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "식사 정보 다시 불러오는 중" : "식사 정보 다시 불러오기"}
      </button>
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
