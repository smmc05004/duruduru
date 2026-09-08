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
import {
  formatClockDuration,
  formatHoursAndMinutes,
} from "@/lib/format-duration";
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
  | "no-result"
  | "no-itinerary"
  | "error";
type SearchResponse =
  | { kind: "success"; candidates: Candidate[]; profileGeneratedAt?: string }
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
// 음식점 목록·프로필 조회일(날짜만). 표시 전용이며 일정 계산에 쓰지 않는다.
const kstDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" });
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

const kstMonthDay = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
});
const kstWeekday = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  weekday: "long",
});
/** "2026-09-12T08:00", offset 0|1 → { date: "9월 12일", weekday: "토요일" } */
function dayHeading(startAt: string, offset: 0 | 1) {
  const base = new Date(`${startAt}:00+09:00`);
  if (Number.isNaN(base.getTime())) return null;
  const day = new Date(base.getTime() + offset * 86_400_000);
  return { date: kstMonthDay.format(day), weekday: kstWeekday.format(day) };
}

/* ── 인라인 SVG 아이콘 (이모지 금지, 44px 규칙은 클릭 요소에만) ───────── */

const iconCar = (
  <svg
    width="17"
    height="17"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 12.5h14M4.5 12.5V9.2l1.8-3.4h7.4l1.8 3.4v3.3" />
    <circle cx="6.6" cy="14.4" r="1.4" />
    <circle cx="13.4" cy="14.4" r="1.4" />
  </svg>
);
const iconVisit = (
  <svg
    width="17"
    height="17"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 16.5h14M5.5 16.5V8.2L10 4.5l4.5 3.7v8.3" />
    <path d="M8.4 16.5v-4.2h3.2v4.2" />
  </svg>
);
const iconMeal = (
  <svg
    width="17"
    height="17"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6.5 3v6a2 2 0 0 0 4 0V3M8.5 11v6M14 3c1.4 1.2 1.4 4.4 0 5.6V17" />
  </svg>
);
const iconMoon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M7 3.5a6.5 6.5 0 1 0 9.5 8A5.2 5.2 0 0 1 7 3.5z" />
  </svg>
);
const iconCheck = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 10.4l3.6 3.4L16 5.6" />
  </svg>
);
const iconCheckSmall = (
  <svg
    width="19"
    height="19"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 10.4l3.6 3.4L16 5.6" />
  </svg>
);
const iconChevronDown = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 8l5 5 5-5" />
  </svg>
);
const iconBack = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M11.6 5L6.6 10l5 5" />
  </svg>
);
const iconWarning = (
  <svg
    width="26"
    height="26"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 2.6l7.6 13.6H2.4z" />
    <path d="M10 7.6v3.8M10 13.8v.2" />
  </svg>
);
const iconWarningSm = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 3.2l7 12.4H3z" />
    <path d="M10 7.8v3.4M10 13.6v.2" />
  </svg>
);
const iconXCircleSm = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="10" cy="10" r="7.2" />
    <path d="M7.4 7.4l5.2 5.2M12.6 7.4l-5.2 5.2" />
  </svg>
);
const iconInfoCircleSm = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="10" cy="10" r="7.2" />
    <path d="M10 6.2v.2M10 8.8v4.6" />
  </svg>
);
const iconRetry = (
  <svg
    width="19"
    height="19"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M16.4 10a6.4 6.4 0 1 1-2-4.6" />
    <path d="M16.6 3.4v3.2h-3.2" />
  </svg>
);

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
  const [profileGeneratedAt, setProfileGeneratedAt] = useState<string>("");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [listFetchedAt, setListFetchedAt] = useState("");
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
      // 정상 응답이지만 조건에 맞는 지역이 없는 경우와 API 장애를 형태로 구분한다.
      // (DESIGN_TOKENS.md 「결과 없음 · 일정 생성 불가 · 식사 정보 실패 · 데이터 장애」)
      if (result.kind === "no-results") {
        setMessage(result.message);
        setView("no-result");
        return;
      }
      if (result.kind !== "success") throw new Error(result.message);
      setCandidates(result.candidates);
      setProfileGeneratedAt(result.profileGeneratedAt ?? "");
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
    setListFetchedAt(kstDay.format(new Date()));
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
      setListFetchedAt(kstDay.format(new Date()));
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
        <Header onBack={() => stopRun("candidates")} />
        <ConditionSummary input={input} destination={selected} />
        <ProgressNotice
          title="선택한 지역의 음식점을 불러오고 있어요"
          detail={`${selected.displayName} 음식점 목록을 받아 점심·저녁을 채우는 중이에요.`}
        />
        <p className="dd-day-heading">곧 1박 2일 계획이 완성돼요</p>
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
        <div className="dd-alert-band" />
        <div className="dd-screen__header">
          <span className="dd-screen__logo">두루두루</span>
          <span className="dd-screen__badge dd-screen__badge--alert">
            {iconWarningSm}
            데이터 장애
          </span>
        </div>
        <section className="dd-failure" role="alert">
          <div className="dd-failure__head">
            <span style={{ color: "var(--alert)" }}>{iconWarning}</span>
            <p className="dd-failure__title">정보를 불러오지 못했어요</p>
          </div>
          <p className="dd-failure__text">
            {message} 임의의 출발지·이동수단·이동시간으로 바꿔서 계산하지
            않았어요.
          </p>
          <div className="dd-failure__diag">
            <span className="dd-failure__diag-item">
              <span style={{ color: "var(--alert)" }}>{iconXCircleSm}</span>
              {selected
                ? `${selected.displayName} 음식점 목록 — 응답 없음`
                : "지원 조건·후보 데이터 — 응답 없음"}
              {mealAttemptAt ? ` (${mealAttemptAt} 시도)` : ""}
            </span>
            <span className="dd-failure__diag-item">
              <span style={{ color: "var(--alert)" }}>{iconInfoCircleSm}</span>
              마지막으로 정상이던 시점 — 확인할 수 없어요
            </span>
          </div>
        </section>
        <div className="dd-screen__actions">
          <button
            type="button"
            className="dd-button dd-button--recover"
            onClick={() => (selected ? choose(selected) : setView("input"))}
          >
            {iconRetry}
            다시 시도하기
          </button>
        </div>
        <p className="dd-failure-note">복구되면 아래 입력이 다시 열려요</p>
        <div className="dd-failure-preview" aria-hidden="true">
          <div className="dd-failure-preview__field">
            <span className="dd-failure-preview__label">어디서 출발해요?</span>
            <div className="dd-failure-preview__value">
              <span className="dd-skeleton" />
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5.5 8L10 12.5 14.5 8" />
              </svg>
            </div>
          </div>
          <div className="dd-failure-preview__field">
            <span className="dd-failure-preview__label">
              언제 나가서 언제까지 돌아와요?
            </span>
            <div className="dd-failure-preview__value">
              <span className="dd-skeleton" />
            </div>
          </div>
        </div>
        <p className="dd-screen__footnote">
          이 화면은 시스템·데이터 쪽 문제예요. 조건에 맞는 곳이 없는 경우,
          계획을 못 만든 경우, 음식점 목록만 못 받은 경우와는 다른 상태예요.
        </p>
      </main>
    );
  if (view === "no-result")
    return (
      <main className="dd-screen">
        <Header />
        <section className="dd-summary-card" aria-label="입력한 여행 조건">
          <h1 className="dd-summary-card__title">
            {"이번 조건에 맞는\n곳을 찾지 못했어요"}
          </h1>
          <ConditionChips input={input} />
        </section>
        <div className="dd-empty" aria-label="결과 없음">
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
          <p className="dd-empty__title">
            왕복 시간 안에 들어오는 지역 중에서, 고른 관심사의 공식 분류
            관광지가 3곳 이상인 곳을 찾지 못했어요.
          </p>
          <p className="dd-empty__note">
            억지로 후보를 만들지 않고 그대로 알려드려요. 아래처럼 조건을 조금만
            바꾸면 다시 찾아볼 수 있어요.
          </p>
        </div>
        <ul className="dd-suggestions">
          <li className="dd-suggestions__item">
            {suggestionIconPlus}
            관심사를 더 고르기 (예: 역사·문화)
          </li>
          <li className="dd-suggestions__item">
            {suggestionIconClock}
            복귀 시간을 늦춰보기
          </li>
          <li className="dd-suggestions__item">
            {suggestionIconPin}
            {input.originId === "seoul"
              ? "부산광역시 출발로 바꿔보기"
              : "서울특별시 출발로 바꿔보기"}
          </li>
        </ul>
        <div className="dd-result-actions">
          <Button variant="primary" onClick={() => setView("input")}>
            조건 수정하기
          </Button>
        </div>
        <p className="dd-screen__footnote">
          이동시간은 국가교통DB 기반 일반 예상값이에요. 최소로 머물러야 하는
          시간 기준은 아직 확정되지 않아, 이 화면의 판단 기준은 확정 후 달라질
          수 있어요. 시스템·데이터 장애와는 다른 정상 상태예요.
        </p>
      </main>
    );
  if (view === "no-itinerary" && selected && shortfall)
    return (
      <main className="dd-screen">
        <Header onBack={() => stopRun("candidates")} />
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
        <Header onBack={() => setView("candidates")} />
        <h1 className="dd-screen__title">
          {selected.displayName} 참고용 여행 계획
        </h1>
        <ConditionSummary
          input={input}
          destination={selected}
          variant="itinerary"
          fetchedAtLabel={listFetchedAt}
        />
        {mealFailed ? (
          <MealFailureNotice
            destinationName={selected.displayName}
            attemptAt={mealAttemptAt}
            retrying={mealRetrying}
            onRetry={retryMeals}
          />
        ) : (
          <section className="dd-plan-notice">
            <span style={{ color: "var(--olive-ink)" }}>{iconCheck}</span>
            <p>
              1일차 08:00 출발, 2일차 20:00 복귀에 맞춰 점심·저녁 네 칸과 관광
              네 곳을 배치했어요.
            </p>
          </section>
        )}
        {([1, 2] as const).map((day) => {
          const heading = dayHeading(input.startAt, day === 1 ? 0 : 1);
          return (
            <div key={day}>
              <p className="dd-day-heading">
                {heading ? heading.date : `${day}일차`}
                {heading ? <span>{heading.weekday}</span> : null}
              </p>
              <ScheduleTimeline
                items={schedule}
                day={day}
                destination={selected}
                restaurants={restaurants}
                profileGeneratedAt={profileGeneratedAt}
                listFetchedAt={listFetchedAt}
                mealFailed={mealFailed}
                onOpenRestaurant={openRestaurant}
              />
            </div>
          );
        })}
        <p className="dd-screen__footnote">
          이동시간과 체류시간은 국가교통DB·카테고리 기본값 기반 추정치예요.
          여행지 안에서의 장소 사이 이동시간은 계산하거나 표시하지 않아요. 방문
          전 운영·휴무·예약 정보를 다시 확인하세요.
        </p>
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
        <ConditionSummary
          input={input}
          title={`${origin.label}에서\n갈 수 있는 곳`}
        />
        <div className="dd-list-head">
          <span className="dd-list-head__count">
            다녀올 수 있는 곳 {candidates.length}군데
          </span>
          <span className="dd-list-head__order">시간 적합순</span>
        </div>
        <ol className="dd-candidates">
          {candidates.map((candidate, index) => {
            const roundTrip =
              Math.round((candidate.oneWayMinutes * 2) / 6) / 10;
            const oneWay = candidate.oneWayMinutes;
            const local = candidate.localMinutes;
            const total = oneWay * 2 + local;
            const movePercent = total > 0 ? (oneWay / total) * 100 : 0;
            const best = index === 0;
            return (
              <li className="dd-candidate" key={candidate.regionId}>
                {best ? (
                  <span className="dd-candidate__best">가장 잘 맞아요</span>
                ) : null}
                <div
                  className="dd-candidate__head"
                  style={best ? { marginTop: 5 } : undefined}
                >
                  <h2 className="dd-candidate__name">
                    {candidate.displayName}
                  </h2>
                  {candidate.name !== candidate.displayName ? (
                    <span className="dd-candidate__region">
                      {candidate.name}
                    </span>
                  ) : null}
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
                    <span>
                      이동 {formatClockDuration(candidate.oneWayMinutes / 60)}
                    </span>
                    <span className="dd-timebar__stay-label">
                      현지 이용 가능{" "}
                      {formatHoursAndMinutes(candidate.localMinutes / 60)}
                    </span>
                    <span>
                      이동 {formatClockDuration(candidate.oneWayMinutes / 60)}
                    </span>
                  </div>
                </div>
                <p className="dd-candidate__reason">
                  {candidate.interestLabels.join("·")} 여행에 잘 맞고, 왕복 약{" "}
                  {roundTrip}시간이라 이틀을 쓸 수 있어요.
                </p>
                <p className="dd-candidate__meta">
                  관심사 {candidate.interestLabels.join(" · ")} · 관광지{" "}
                  {candidate.attractions.length}곳
                </p>
                <div className="dd-tag-row">
                  {candidate.attractions.slice(0, 3).map((attraction) => (
                    <span className="dd-tag" key={attraction.contentId}>
                      {attraction.title}
                    </span>
                  ))}
                </div>
                <Button
                  variant={best ? "primary" : "secondary"}
                  onClick={() => choose(candidate)}
                >
                  {best ? iconCheckSmall : null}
                  {candidate.displayName} 일정 보기
                </Button>
              </li>
            );
          })}
        </ol>
        <div className="dd-result-actions">
          <Button variant="secondary" onClick={() => setView("input")}>
            조건 수정하기
          </Button>
        </div>
        <p className="dd-screen__footnote">
          왕복 이동시간은 국가교통DB 2024 기반 지역 간 자동차 일반 예상값이에요.
          실시간 교통은 반영하지 않아요. 시간 안에 다녀오기 어려운 곳은 목록에
          넣지 않았어요.
        </p>
      </main>
    );
  return (
    <main className="dd-screen">
      <Header />
      <h1 className="dd-screen__title">
        쓸 수 있는 시간을
        <br />
        알려주면 갈 곳부터 골라줄게요
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
          <FieldCard
            label="어디서 출발해요?"
            hint="지금은 서울·부산 두 곳에서만 출발할 수 있어요."
          >
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
            hint="1박 2일 일정만 만들 수 있어요. 당일치기와 2박 이상은 아직 지원하지 않아요."
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
              options={[
                {
                  value: "car",
                  label: "자차",
                  icon: iconCar,
                },
              ]}
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
        <div className="dd-screen__actions">
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
        </div>
        <p className="dd-screen__footnote">
          이동시간은 국가교통DB 기반 지역 간 자동차 일반 예상값이에요. 실시간
          교통 상황은 반영하지 않아요.
        </p>
      </form>
    </main>
  );
}

const suggestionIconPlus = (
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
    <circle cx="10" cy="10" r="7.2" />
    <path d="M10 6.4v7.2M6.4 10h7.2" />
  </svg>
);
const suggestionIconClock = (
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
    <circle cx="10" cy="10" r="7.2" />
    <path d="M10 6.2V10l2.6 1.8" />
  </svg>
);
const suggestionIconPin = (
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

function Header({ onBack }: { onBack?: () => void }) {
  return (
    <div className="dd-screen__header">
      {onBack ? (
        <button type="button" className="dd-screen__back" onClick={onBack}>
          {iconBack}
          추천 목록
        </button>
      ) : (
        <span className="dd-screen__logo">두루두루</span>
      )}
      <span className="dd-screen__badge">1박 2일</span>
    </div>
  );
}

function ConditionChips({ input }: { input: typeof initial }) {
  const originLabel =
    ORIGINS.find((item) => item.id === input.originId)?.label ?? "출발지";
  const interestLabels = input.interests.map(
    (id) => INTERESTS.find((interest) => interest.id === id)?.label ?? id,
  );
  const start = formatTripMoment(input.startAt);
  const end = formatTripMoment(input.returnBy);
  return (
    <div className="dd-summary-card__chips">
      <span className="dd-pill">{originLabel} 출발</span>
      <span className="dd-pill">
        {start} → {end}
      </span>
      {interestLabels.map((label) => (
        <span key={label} className="dd-pill dd-pill--interest">
          {label}
        </span>
      ))}
    </div>
  );
}

/** "2026-09-12T08:00" → "9/12 08:00". 표시 전용 포맷이며 계산에 쓰지 않는다. */
function formatTripMoment(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/u.exec(value);
  if (!match) return value || "미입력";
  const [, , month, day, time] = match;
  return `${Number(month)}/${Number(day)} ${time}`;
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

const categoryLabelById = new Map(
  INTERESTS.map((interest) => [interest.id, interest.label] as const),
);

/*
 * 참고 계획 타임라인. 엔진이 낸 ScheduleItem[]을 그대로 표시한다.
 * 시안: design/screens/Itinerary.dc.html · MealDataFailure.dc.html.
 * 규칙은 재판단하지 않는다. 여행지 내부 이동시간은 계산·표시하지 않는다.
 */
function ScheduleTimeline({
  items,
  day,
  destination,
  restaurants,
  profileGeneratedAt,
  listFetchedAt,
  mealFailed,
  onOpenRestaurant,
}: {
  items: ScheduleItem[];
  day: 1 | 2;
  destination: Candidate;
  restaurants: Restaurant[];
  profileGeneratedAt: string;
  listFetchedAt: string;
  mealFailed: boolean;
  onOpenRestaurant: (restaurant: Restaurant) => void;
}) {
  const rows = items.filter((item) => item.day === day);
  const profileBasis = profileGeneratedAt
    ? ` · ${profileGeneratedAt} 지역 프로필`
    : "";
  const listBasis = listFetchedAt ? ` · ${listFetchedAt} 조회` : "";
  const attractionCategory = new Map(
    destination.attractions.map(
      (attraction) => [attraction.title, attraction.categoryId] as const,
    ),
  );
  return (
    <ol className="dd-timeline">
      {rows.map((item, index) => {
        const last = index === rows.length - 1 && day === 2;
        if (item.type === "이동") {
          const depart = item.day === 1;
          return (
            <li className="dd-tl-row" key={`${item.day}-${item.time}-이동`}>
              <div className="dd-tl-time">
                <span className="dd-tl-time__label">{item.time}</span>
                {last ? null : <span className="dd-tl-time__rail" />}
              </div>
              <div className="dd-tl-card">
                <span className="dd-tl-head__label">
                  {iconCar}
                  {depart ? "이동" : "복귀 이동"}
                </span>
                <p className="dd-tl-title">{item.title}</p>
                <p className="dd-tl-meta">
                  {depart
                    ? `국가교통DB 일반 예상 이동 약 ${formatHoursAndMinutes(
                        destination.oneWayMinutes / 60,
                      )} · 자차 기준`
                    : `복귀 시각 ${item.time}에 맞춰 일반 예상 이동 약 ${formatHoursAndMinutes(
                        destination.oneWayMinutes / 60,
                      )}을 반영했어요`}
                </p>
              </div>
            </li>
          );
        }
        if (item.type === "관광") {
          const label = categoryLabelById.get(
            attractionCategory.get(item.title) ?? ("" as MvpCategoryId),
          );
          return (
            <li className="dd-tl-row" key={`${item.day}-${item.time}-관광`}>
              <div className="dd-tl-time">
                <span className="dd-tl-time__label">{item.time}</span>
                {last ? null : <span className="dd-tl-time__rail" />}
              </div>
              <div className="dd-tl-card dd-tl-card--stay">
                <div className="dd-tl-head">
                  <span className="dd-tl-head__label dd-tl-head__label--stay">
                    {iconVisit}
                    {label ? `방문 · ${label}` : "방문"}
                  </span>
                  <span className="dd-tl-head__dur">1시간</span>
                </div>
                <p className="dd-tl-title">{item.title}</p>
                <p className="dd-tl-basis">
                  TourAPI 공식 분류 관광지{profileBasis}
                </p>
              </div>
            </li>
          );
        }
        // 점심 · 저녁
        const meal = restaurants.find(
          (restaurant) => restaurant.name === item.title,
        );
        const unfilled =
          mealFailed ||
          !meal ||
          item.title === "추천할 식당을 더 찾지 못했어요";
        if (unfilled) {
          return (
            <li className="dd-tl-row" key={`${item.day}-${item.time}-식사`}>
              <div className="dd-tl-time">
                <span className="dd-tl-time__label">{item.time}</span>
                {last ? null : <span className="dd-tl-time__rail" />}
              </div>
              <div className="dd-tl-card dd-tl-card--empty">
                <span className="dd-tl-head__label">
                  {iconMeal}
                  {item.type} · 음식점
                </span>
                <p className="dd-tl-title dd-tl-title--muted">
                  {mealFailed
                    ? "식사 정보를 다시 불러오면 채워져요"
                    : "추천할 식당을 더 찾지 못했어요"}
                </p>
                {mealFailed ? null : (
                  <p className="dd-tl-basis">
                    서로 다른 음식점을 4곳까지 확보하지 못해서 이 칸은 비워
                    뒀어요. 임의·중복 식당은 넣지 않아요.
                  </p>
                )}
              </div>
            </li>
          );
        }
        return (
          <li className="dd-tl-row" key={`${item.day}-${item.time}-식사`}>
            <div className="dd-tl-time">
              <span className="dd-tl-time__label">{item.time}</span>
              {last ? null : <span className="dd-tl-time__rail" />}
            </div>
            <button
              type="button"
              className="dd-tl-card dd-tl-card--stay"
              onClick={() => onOpenRestaurant(meal)}
            >
              <div className="dd-tl-head">
                <span className="dd-tl-head__label dd-tl-head__label--stay">
                  {iconMeal}
                  {item.type} · 음식점
                </span>
                <span className="dd-tl-head__dur">1시간</span>
              </div>
              <p className="dd-tl-title">{meal.name}</p>
              <p className="dd-tl-basis">
                TourAPI 목록에서 배정 · 콘텐츠 ID 순{listBasis}
              </p>
              <span className="dd-tl-affordance">
                {iconChevronDown}
                눌러서 운영시간·메뉴 확인
              </span>
            </button>
          </li>
        );
      })}
      {day === 1 ? (
        <li className="dd-tl-row">
          <div className="dd-tl-time">
            <span className="dd-tl-time__label dd-tl-time__label--soft">
              21:00
            </span>
          </div>
          <div className="dd-tl-rest">
            {iconMoon}
            <span>21:00부터 다음날 07:00까지는 휴식 (관광·식사 없음)</span>
          </div>
        </li>
      ) : null}
    </ol>
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

function PlanPreviewRow({
  row,
  showRail,
}: {
  row: PreviewRow;
  showRail: boolean;
}) {
  let cardClass = "dd-timeline-row__card";
  let kindClass = "dd-timeline-row__kind";
  let kindLabel: string;
  let kindIcon: ReactNode = null;
  let body: ReactNode;
  if (row.kind === "이동") {
    kindLabel = "이동";
    kindIcon = iconCar;
    body = (
      <>
        <p className="dd-timeline-row__title">{row.title}</p>
        {row.meta ? <p className="dd-timeline-row__meta">{row.meta}</p> : null}
      </>
    );
  } else if (row.kind === "관광") {
    cardClass += " dd-timeline-row__card--stay";
    kindClass += " dd-timeline-row__kind--visit";
    kindLabel = "방문";
    kindIcon = iconVisit;
    body = row.title ? (
      <>
        <p className="dd-timeline-row__title">{row.title}</p>
        <p className="dd-timeline-row__meta">체류 1시간</p>
      </>
    ) : (
      skeletonBody
    );
  } else {
    cardClass += " dd-timeline-row__card--meal";
    kindClass += " dd-timeline-row__kind--meal";
    kindLabel = row.kind;
    kindIcon = iconMeal;
    body = skeletonBody;
  }
  return (
    <div className="dd-timeline-row">
      <div className="dd-timeline-row__time">
        <div className="dd-skeleton" />
        {showRail ? <span className="dd-timeline-row__rail" /> : null}
      </div>
      <div className={cardClass}>
        <span className={kindClass}>
          <span
            style={{
              display: "inline-flex",
              verticalAlign: "-3px",
              marginRight: 6,
            }}
          >
            {kindIcon}
          </span>
          {kindLabel}
        </span>
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
          {rows.map((row, index) => (
            <PlanPreviewRow
              key={row.key}
              row={row}
              showRail={!(day === 2 && index === rows.length - 1)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
