"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { FieldCard, fieldErrorId } from "@/components/FieldCard";
import { InputField } from "@/components/InputField";
import { SegmentedControl } from "@/components/SegmentedControl";
import {
  INTERESTS,
  ORIGINS,
  type Attraction,
  type Candidate,
  type EditCommand,
  type PlanSnapshot,
  type Restaurant,
  type SearchInput,
  type SearchResponse,
  type VisitDuration,
} from "@/lib/mvp-phase-two-types";
import {
  attractionAlternatives,
  createPlan,
  editPlan,
  validateSearchInput,
} from "@/lib/mvp-phase-two-planner";
import {
  assignRestaurants,
  replaceRestaurant,
  restaurantAlternatives,
} from "@/lib/mvp-phase-two-meals";
import {
  apiMessage,
  tripApi,
  useTripUi,
  type RestaurantResponse,
} from "@/lib/mvp-phase-two-client";
import {
  AttractionVisitInfoCoordinator,
  type VisitInfoEntry,
  visitInfoKey,
} from "@/lib/attraction-visit-info";
import {
  deleteSavedPlan,
  isSavedPlan,
  readSavedPlans,
  savePlan,
} from "@/lib/mvp-phase-two-storage";
import { PlaceDetail, type SelectedPlace } from "./PlaceDetail";
import { AttractionVisitInfo } from "./AttractionVisitInfo";
import {
  NotebookCandidate,
  NotebookConditions,
  NotebookIcon,
  notebookDate,
} from "./Notebook";

const clock = (value: string) => value.slice(11, 16);
const duration = (minutes: number) =>
  minutes < 60
    ? `${minutes}분`
    : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ""}`;
const labels = (values: SearchInput["interests"]) =>
  INTERESTS.filter((i) => values.includes(i.id))
    .map((i) => i.label)
    .join(" · ");
type MealRequest = {
  planId: string;
  groupId: string;
  visits: { contentId: string; regionId: string }[];
  nonce: number;
};
function requestFor(plan: PlanSnapshot): MealRequest {
  return {
    planId: plan.id,
    groupId: plan.destination.groupId,
    visits: plan.blocks.flatMap((b) =>
      b.attraction
        ? [
            {
              contentId: b.attraction.contentId,
              regionId: b.attraction.regionId,
            },
          ]
        : [],
    ),
    nonce: Date.now(),
  };
}

export function TripPlanner() {
  const queryClient = useQueryClient();
  const [input, setInput] = useState<SearchInput>({
    originId: "seoul",
    startAt: "",
    returnBy: "",
    transport: "car",
    interests: ["nature", "history"],
  });
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [mealRequest, setMealRequest] = useState<MealRequest | null>(null);
  const [selected, setSelected] = useState<SelectedPlace | null>(null);
  const [message, setMessage] = useState("");
  const [savedPlans, setSavedPlans] = useState<PlanSnapshot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visitInfo, setVisitInfo] = useState<Record<string, VisitInfoEntry>>(
    {},
  );
  const [screen, setScreen] = useState<"input" | "results">("input");
  const [attempted, setAttempted] = useState(false);
  const savedOpen = useTripUi((s) => s.savedOpen),
    setSavedOpen = useTripUi((s) => s.setSavedOpen);
  const generation = useRef(0);
  const activeMealRequest = useRef<MealRequest | null>(null);
  const mealSequence = useRef(0);
  const visitGeneration = useRef(0);
  const automaticVisitPlan = useRef<string | null>(null);
  const visitWorkController = useRef<AbortController | null>(null);
  const latestPlanId = useRef<string | null>(null);
  const automaticVisitSnapshot = useRef<{
    planId: string;
    attractions: Attraction[];
  } | null>(null);
  const visitCoordinator = useRef(
    new AttractionVisitInfoCoordinator(async (attraction, signal) => {
      const { data } = await tripApi.get<{
        kind: "success" | "partial";
        detail: import("@/lib/attraction-detail").NormalizedAttractionDetail;
      }>(`/attractions/${encodeURIComponent(attraction.contentId)}`, {
        params: { contentTypeId: attraction.contentTypeId },
        signal,
      });
      return data;
    }),
  );
  const closeDetail = useCallback(() => setSelected(null), []);
  useEffect(() => {
    latestPlanId.current = plan?.id ?? null;
  }, [plan?.id]);
  function cancelVisitInfo(preserveAutomaticPlan = false) {
    ++visitGeneration.current;
    visitWorkController.current?.abort();
    visitWorkController.current = null;
    visitCoordinator.current.cancelAll();
    if (!preserveAutomaticPlan) automaticVisitPlan.current = null;
    setVisitInfo({});
  }
  const planId = plan?.id;
  useEffect(() => {
    const snapshot = automaticVisitSnapshot.current;
    if (!planId || !snapshot || loaded || automaticVisitPlan.current === planId)
      return;
    automaticVisitPlan.current = planId;
    const current = ++visitGeneration.current;
    const controller = new AbortController();
    const coordinator = visitCoordinator.current;
    visitWorkController.current = controller;
    void coordinator.automatically(
      snapshot.attractions,
      controller.signal,
      (attraction, entry) => {
        if (visitGeneration.current !== current) return;
        setVisitInfo((previous) => ({
          ...previous,
          [visitInfoKey(attraction)]: entry,
        }));
      },
    );
    return () => {
      controller.abort();
      coordinator.cancelAll();
      if (visitWorkController.current === controller)
        visitWorkController.current = null;
      // In development React may mount this effect, clean it up, then mount it
      // again. Do not let the aborted first attempt permanently suppress the
      // second attempt for this plan.
      if (automaticVisitPlan.current === planId)
        automaticVisitPlan.current = null;
    };
  }, [loaded, planId]);
  function requestVisitInfo(
    attraction: NonNullable<PlanSnapshot["blocks"][number]["attraction"]>,
  ) {
    const currentPlanId = latestPlanId.current;
    const currentGeneration = visitGeneration.current;
    const key = visitInfoKey(attraction);
    setVisitInfo((previous) => ({ ...previous, [key]: { status: "loading" } }));
    void visitCoordinator.current
      .request(attraction, "manual")
      .then((entry) => {
        if (
          latestPlanId.current !== currentPlanId ||
          visitGeneration.current !== currentGeneration
        )
          return;
        setVisitInfo((previous) => ({ ...previous, [key]: entry }));
      })
      .catch(() => {
        if (
          latestPlanId.current !== currentPlanId ||
          visitGeneration.current !== currentGeneration
        )
          return;
        setVisitInfo((previous) => ({
          ...previous,
          [key]: {
            status: "unavailable",
            message: "방문 정보를 불러오지 못했어요. 방문 전 확인해 주세요.",
          },
        }));
      });
  }
  function requestAllVisitInfo() {
    if (!plan) return;
    const current = ++visitGeneration.current;
    visitWorkController.current?.abort();
    visitCoordinator.current.cancelAll();
    const controller = new AbortController();
    visitWorkController.current = controller;
    const attractions = plan.blocks.flatMap((block) =>
      block.attraction ? [block.attraction] : [],
    );
    void visitCoordinator.current.automatically(
      attractions,
      controller.signal,
      (attraction, entry) => {
        if (visitGeneration.current !== current) return;
        setVisitInfo((previous) => ({
          ...previous,
          [visitInfoKey(attraction)]: entry,
        }));
      },
    );
  }
  const search = useMutation({
    mutationFn: async (variables: {
      input: SearchInput;
      generation: number;
    }) => {
      const { data } = await tripApi.post<SearchResponse>(
        "/search",
        variables.input,
      );
      return data;
    },
  });
  const meals = useMutation({
    mutationFn: (request: MealRequest) =>
      queryClient.fetchQuery({
        queryKey: ["phase-two-restaurants", request],
        queryFn: async ({ signal }) => {
          const { data } = await tripApi.post<RestaurantResponse>(
            "/phase-two/restaurants",
            { groupId: request.groupId, visits: request.visits },
            { signal },
          );
          return data;
        },
      }),
    onSuccess: (data, request) => {
      if (activeMealRequest.current !== request || data.kind === "data-error")
        return;
      const restaurants =
        queryClient.setQueryData<Restaurant[]>(
          ["restaurant-pool", request.planId],
          (previous = []) => {
            const merged = new Map(
              previous.map((restaurant) => [restaurant.contentId, restaurant]),
            );
            for (const restaurant of data.restaurants)
              merged.set(restaurant.contentId, restaurant);
            return [...merged.values()];
          },
        ) ?? data.restaurants;
      setPlan((current) =>
        current?.id === request.planId
          ? assignRestaurants(current, restaurants)
          : current,
      );
    },
  });
  const pool = useQuery<Restaurant[]>({
    queryKey: ["restaurant-pool", plan?.id],
    queryFn: async () => [],
    enabled: false,
  });
  function clearMeals() {
    const previous = activeMealRequest.current;
    activeMealRequest.current = null;
    if (previous)
      void queryClient.cancelQueries({
        queryKey: ["phase-two-restaurants", previous],
        exact: true,
      });
    setMealRequest(null);
    meals.reset();
  }
  function collectMeals(current: PlanSnapshot) {
    clearMeals();
    const request = { ...requestFor(current), nonce: ++mealSequence.current };
    activeMealRequest.current = request;
    setMealRequest(request);
    meals.mutate(request);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await runSearch();
  }
  async function runSearch() {
    setAttempted(true);
    const checked = validateSearchInput(input);
    if (!checked.ok) {
      setMessage("");
      return;
    }
    const current = ++generation.current;
    setPlan(null);
    cancelVisitInfo();
    clearMeals();
    setSelected(null);
    setMessage("");
    setLoaded(false);
    setSavedOpen(false);
    setExpanded(null);
    setScreen("results");
    window.scrollTo(0, 0);
    try {
      const data = await search.mutateAsync({
        input: checked.input,
        generation: current,
      });
      if (generation.current !== current) return;
      if (data.kind !== "success") setMessage(data.message);
    } catch (error) {
      if (generation.current === current) setMessage(apiMessage(error));
    }
  }
  function choose(candidate: Candidate) {
    if (search.data?.kind !== "success" || !search.variables) return;
    const next = {
      ...createPlan(search.variables.input, candidate, search.data.searchId),
      // Selecting a destination again starts a separate editable/savable draft.
      id: crypto.randomUUID(),
    };
    ++generation.current;
    cancelVisitInfo();
    automaticVisitSnapshot.current = {
      planId: next.id,
      attractions: next.blocks.flatMap((block) =>
        block.attraction ? [block.attraction] : [],
      ),
    };
    setPlan(next);
    setLoaded(false);
    setMessage("");
    setSelected(null);
    setExpanded(null);
    collectMeals(next);
    window.scrollTo(0, 0);
  }
  function change(command: EditCommand) {
    if (!plan) return;
    const result = editPlan(plan, command);
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    cancelVisitInfo(true);
    setPlan(result.plan);
    setMessage(
      command.type === "toggle-fixed"
        ? "고정은 장소를 보존해요. 방문 시각이나 날짜는 바뀔 수 있어요."
        : "변경했어요. 관광지역이 바뀌었다면 식당 목록을 다시 조회할 수 있어요.",
    );
    setExpanded(null);
  }
  function openSaved() {
    const result = readSavedPlans();
    setSavedPlans(result.plans);
    setMessage(result.error ?? "");
    setSavedOpen(!savedOpen);
  }
  function persist() {
    if (!plan) return;
    const result = savePlan(plan);
    if (result.error || !result.plan) {
      setMessage(result.error ?? "저장하지 못했어요");
      return;
    }
    setPlan(result.plan);
    setMessage("이 기기에 계획을 저장했어요.");
    if (savedOpen) setSavedPlans(readSavedPlans().plans);
  }
  function load(saved: PlanSnapshot) {
    if (!isSavedPlan(saved)) {
      setMessage("손상된 계획은 불러올 수 없어요.");
      return;
    }
    ++generation.current;
    cancelVisitInfo();
    automaticVisitSnapshot.current = null;
    search.reset();
    setPlan(saved);
    setInput(saved.input);
    setLoaded(true);
    clearMeals();
    setSelected(null);
    setExpanded(null);
    setSavedOpen(false);
    setScreen("results");
    window.scrollTo(0, 0);
    setMessage(
      "저장 당시 계획을 불러왔어요. 음식점과 시간표는 저장 당시 정보예요.",
    );
  }
  function remove(saved: PlanSnapshot) {
    if (
      !window.confirm(
        `${saved.destination.displayName} 계획을 이 기기에서 삭제할까요?`,
      )
    )
      return;
    const result = deleteSavedPlan(saved.id);
    setSavedPlans(result.plans);
    setMessage(result.error ?? "선택한 저장 계획을 삭제했어요.");
    if (!result.error && plan?.id === saved.id)
      setPlan({ ...plan, savedAt: undefined });
  }
  const restaurants = mealRequest?.planId === plan?.id ? (pool.data ?? []) : [];
  const candidates =
    search.data?.kind === "success" ? search.data.candidates : [];
  const changedAfterSave =
    plan?.savedAt && Date.parse(plan.updatedAt) > Date.parse(plan.savedAt);
  const checkedInput = validateSearchInput(input);
  const inputError = attempted && !checkedInput.ok ? checkedInput.reason : "";
  const interestError = attempted && input.interests.length === 0;
  const dateError = inputError && !interestError ? inputError : "";
  const searchFailed =
    screen === "results" &&
    !plan &&
    (search.isError || search.data?.kind === "data-error");
  const noResults =
    screen === "results" && !plan && search.data?.kind === "no-results";
  const mealFailed =
    !!mealRequest &&
    (meals.isError ||
      meals.data?.kind === "data-error" ||
      !!meals.data?.failedRegionIds.length);
  function showInput() {
    ++generation.current;
    cancelVisitInfo();
    search.reset();
    clearMeals();
    setPlan(null);
    setSelected(null);
    setExpanded(null);
    setMessage("");
    setScreen("input");
    window.scrollTo(0, 0);
  }
  function showCandidates() {
    ++generation.current;
    cancelVisitInfo();
    setPlan(null);
    clearMeals();
    setSelected(null);
    setExpanded(null);
    setMessage("");
    window.scrollTo(0, 0);
  }
  return (
    <main className={`p2-page${searchFailed ? " p2-page--error" : ""}`}>
      <header className="p2-header">
        {plan ? (
          <button
            className="p2-back"
            onClick={candidates.length ? showCandidates : showInput}
          >
            <NotebookIcon kind="back" />
            {candidates.length ? "추천 목록" : "조건 입력"}
          </button>
        ) : (
          <Link href="/" className="p2-logo">
            두루두루
          </Link>
        )}
        <span
          className={`p2-trip-badge${searchFailed ? " p2-trip-badge--error" : ""}`}
        >
          {searchFailed ? "데이터 장애" : "1박 2일"}
        </span>
      </header>
      <div className="p2-storage-link">
        <button
          className="p2-text-button"
          onClick={openSaved}
          aria-expanded={savedOpen}
        >
          저장한 여행
        </button>
      </div>
      {screen === "input" && !plan ? (
        <section className="p2-intro">
          <h1>
            쓸 수 있는 시간을
            <br />
            알려주면 갈 곳부터 골라줄게요
          </h1>
        </section>
      ) : null}
      {(message && !searchFailed && !noResults) ||
      (screen === "input" && inputError) ? (
        <p
          className={
            screen === "input" && inputError
              ? "p2-notice p2-notice--error"
              : "p2-notice"
          }
          role="status"
        >
          {screen === "input" && inputError ? inputError : message}
        </p>
      ) : null}
      {savedOpen ? (
        <section className="p2-panel" aria-label="이 기기에 저장한 계획">
          <h2>저장한 계획 {savedPlans.length}/10</h2>
          <p className="p2-muted">
            이 브라우저에만 저장돼요. 저장 공간과 브라우저 설정에 따라 저장이
            제한될 수 있어요.
          </p>
          {savedPlans.length ? (
            savedPlans.map((saved) => (
              <article className="p2-saved-row" key={saved.id}>
                <div>
                  <strong>{saved.destination.displayName}</strong>
                  <p>
                    {saved.input.startAt.slice(0, 10)} · 저장{" "}
                    {saved.savedAt
                      ? new Date(saved.savedAt).toLocaleString("ko-KR", {
                          timeZone: "Asia/Seoul",
                        })
                      : ""}
                  </p>
                </div>
                <div className="p2-actions">
                  <button className="p2-control" onClick={() => load(saved)}>
                    불러오기
                  </button>
                  <button className="p2-control" onClick={() => remove(saved)}>
                    삭제
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p>아직 저장한 계획이 없어요.</p>
          )}
        </section>
      ) : null}
      {screen === "input" && !plan ? (
        <form className="p2-form" onSubmit={submit}>
          <FieldCard
            label="어디서 출발해요?"
            hint="지금은 서울·부산 두 곳에서만 출발할 수 있어요."
          >
            <SegmentedControl
              label="출발지"
              options={ORIGINS.map((origin) => ({
                value: origin.id,
                label: origin.label,
              }))}
              value={input.originId}
              onChange={(value) =>
                setInput({
                  ...input,
                  originId: value as SearchInput["originId"],
                })
              }
            />
          </FieldCard>
          <FieldCard
            label="언제 나가서 언제까지 돌아와요?"
            hint="다음날 귀가하는 1박 2일이에요. 출발·귀가는 어느 시각이든 가능해요."
            errors={
              dateError ? [{ inputId: "p2-return", message: dateError }] : []
            }
          >
            <div className="p2-date-fields">
              <InputField
                id="p2-start"
                prefix="출발"
                aria-label="출발 일시"
                invalid={!!dateError}
                aria-describedby={
                  dateError ? fieldErrorId("p2-return") : undefined
                }
                required
                type="datetime-local"
                value={input.startAt}
                onChange={(event) =>
                  setInput({ ...input, startAt: event.target.value })
                }
              />
              <InputField
                id="p2-return"
                prefix="귀가"
                aria-label="다음날 귀가 완료 일시"
                invalid={!!dateError}
                aria-describedby={
                  dateError ? fieldErrorId("p2-return") : undefined
                }
                required
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
                  icon: <NotebookIcon kind="travel" />,
                },
              ]}
              value="car"
              onChange={() => {}}
            />
          </FieldCard>
          <FieldCard
            label="어떤 걸 좋아해요?"
            labelAside="· 하나 이상 골라 주세요"
            invalid={interestError}
            errors={
              interestError
                ? [
                    {
                      inputId: "p2-interests",
                      message: "관심사를 하나 이상 골라 주세요.",
                    },
                  ]
                : []
            }
          >
            <div
              className="p2-actions"
              role="group"
              aria-label="관심사"
              aria-describedby={
                interestError ? fieldErrorId("p2-interests") : undefined
              }
            >
              {INTERESTS.map((interest) => (
                <Chip
                  variant="selectable"
                  label={interest.label}
                  selected={input.interests.includes(interest.id)}
                  key={interest.id}
                  onToggle={() =>
                    setInput({
                      ...input,
                      interests: input.interests.includes(interest.id)
                        ? input.interests.filter((id) => id !== interest.id)
                        : [...input.interests, interest.id],
                    })
                  }
                />
              ))}
            </div>
          </FieldCard>
          <p className="p2-muted">
            관광은 07:00~21:00에, 점심·저녁은 여행 시간에 맞춰 포함해요.
          </p>
          <Button
            variant="primary"
            type="submit"
            disabled={search.isPending || !!inputError}
          >
            {search.isPending
              ? "갈 수 있는 곳을 찾고 있어요…"
              : "갈 수 있는 곳 찾기"}
          </Button>
          {inputError ? (
            <p className="p2-muted">
              표시된 항목을 수정하면 다시 찾을 수 있어요.
            </p>
          ) : null}
        </form>
      ) : null}
      {screen === "results" && !plan && search.variables ? (
        <NotebookConditions
          input={search.variables.input}
          title={`${ORIGINS.find((origin) => origin.id === search.variables?.input.originId)?.label}에서 갈 수 있는 곳`}
        />
      ) : null}
      {screen === "results" && !plan && search.isPending ? (
        <section aria-label="여행지 검색 중">
          <p className="p2-notice" role="status">
            시간에 맞는 여행지를 찾고 있어요.
          </p>
          <div className="p2-panel" aria-hidden="true">
            <div className="p2-loading-title dd-skeleton" />
            <div className="p2-loading-line dd-skeleton" />
            <div className="p2-loading-line dd-skeleton" />
          </div>
        </section>
      ) : null}
      {searchFailed ||
      noResults ||
      (screen === "results" && !plan && search.data?.kind === "input-error") ? (
        <section
          className={`p2-panel p2-result-state${searchFailed ? " p2-result-state--error" : ""}`}
          role={searchFailed ? "alert" : "status"}
        >
          <NotebookIcon kind={searchFailed ? "warning" : "map"} />
          <h2>
            {searchFailed
              ? "정보를 불러오지 못했어요"
              : "이번 조건에 맞는 곳을 찾지 못했어요"}
          </h2>
          <p>{message}</p>
          <p className="p2-muted">
            {searchFailed
              ? "잠시 후 다시 시도해 주세요."
              : "관심사를 더 고르거나 여행 시간을 늘려 다시 찾아보세요."}
          </p>
          {searchFailed ? (
            <button
              className="dd-button p2-retry"
              onClick={() => void runSearch()}
            >
              다시 시도하기
            </button>
          ) : null}
        </section>
      ) : null}
      {screen === "results" &&
      !plan &&
      candidates.length > 0 &&
      !search.isPending ? (
        <section aria-label="목적지 추천">
          <div className="p2-list-head">
            <strong>다녀올 수 있는 곳 {candidates.length}군데</strong>
            <span>실제 초안을 바탕으로 서로 다른 기준으로 골랐어요</span>
          </div>
          <div className="p2-candidates">
            {candidates.map((candidate, index) => (
              <NotebookCandidate
                key={candidate.groupId}
                candidate={candidate}
                best={index === 0}
                onChoose={() => choose(candidate)}
              />
            ))}
          </div>
        </section>
      ) : null}
      {screen === "results" && !plan ? (
        <Button variant="secondary" onClick={showInput}>
          {search.isPending ? "검색 취소·조건 수정" : "조건 수정하기"}
        </Button>
      ) : null}
      {plan ? (
        <section aria-label="여행 계획">
          <NotebookConditions
            input={plan.input}
            title={`${plan.destination.displayName} 참고용 여행 계획`}
          />
          <div className="p2-plan-head">
            <div className="p2-actions">
              <button className="p2-control" onClick={persist}>
                이 기기에 저장
              </button>
              <button className="p2-control" onClick={requestAllVisitInfo}>
                방문정보 확인
              </button>
              {candidates.length ? (
                <button className="p2-control" onClick={showCandidates}>
                  다른 목적지 보기
                </button>
              ) : null}
            </div>
          </div>
          <p className="p2-muted">
            자동차 일반 예상시간 편도 {duration(plan.destination.oneWayMinutes)}{" "}
            · {labels(plan.metrics.fulfilledInterests)} ·{" "}
            {plan.metrics.attractionCount}곳
          </p>
          <p>
            <span className="p2-arrival">
              여행지 도착 {notebookDate(plan.metrics.arrivalAt)}
            </span>
            <span className="p2-arrival">
              귀가 운전 시작 {notebookDate(plan.metrics.returnDepartureAt)}
            </span>
          </p>
          {plan.savedAt ? (
            <p className="p2-notice">
              {changedAfterSave
                ? "저장 후 변경됨 · 저장 버튼을 누르면 반영돼요"
                : "저장됨"}
              {loaded
                ? ` · 저장 당시 정보 (${new Date(plan.savedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})`
                : ""}
            </p>
          ) : null}
          <details
            className={`p2-meal-info${mealFailed ? " p2-meal-info--error" : ""}`}
            open={
              mealFailed || (!!mealRequest && meals.isPending)
                ? true
                : undefined
            }
          >
            <summary>
              {mealFailed ? (
                <>
                  <NotebookIcon kind="warning" />{" "}
                  {meals.isError || meals.data?.kind === "data-error"
                    ? "식사 정보를 불러오지 못했어요"
                    : "식사 정보를 일부 불러오지 못했어요"}
                </>
              ) : (
                "식사 정보·목록 다시 조회"
              )}
            </summary>
            <p role="status">
              {meals.isPending && mealRequest
                ? "관광 일정 주변의 음식점을 불러오고 있어요. 관광 계획은 바로 볼 수 있어요."
                : mealRequest && meals.isError
                  ? apiMessage(meals.error)
                  : mealRequest && meals.data
                    ? meals.data.message ||
                      "관광 일정 주변의 음식점 목록을 반영했어요."
                    : loaded
                      ? "저장 당시 식당을 유지했어요. 목록이 필요하면 직접 조회해 주세요."
                      : "관광 일정에 맞춰 식당을 확인할 수 있어요."}
            </p>
            {mealRequest && meals.data?.truncated ? (
              <p>조회 상한에 도달해 일부 지역·목록만 반영했어요.</p>
            ) : null}
            {mealRequest && meals.data?.failedRegionIds.length ? (
              <p>
                일부 지역 조회에 실패했어요. 가져온 식당과 관광 계획은 유지돼요.
              </p>
            ) : null}
            <button
              className={mealFailed ? "dd-button p2-retry" : "p2-control"}
              disabled={meals.isPending && !!mealRequest}
              onClick={() => collectMeals(plan)}
            >
              식당 목록 {mealRequest ? "다시 조회" : "조회"}
            </button>
          </details>
          {[1, 2].map((day) => (
            <section key={day} className="p2-day">
              <h3>
                {day}일차 ·{" "}
                {day === 1
                  ? plan.input.startAt.slice(0, 10)
                  : plan.input.returnBy.slice(0, 10)}
              </h3>
              <ol className="p2-timeline">
                {plan.blocks
                  .filter((block) => block.day === day)
                  .map((block) => (
                    <li
                      key={block.id}
                      className={`p2-block p2-block--${block.kind}${block.kind === "meal" && block.mealScope === "local" && !block.restaurant ? " p2-block--empty" : ""}${block.restaurant ? " p2-block--restaurant" : ""}`}
                    >
                      <div className="p2-block-time dd-timeline-row__time">
                        <time dateTime={block.startAt}>
                          {clock(block.startAt)}
                        </time>
                        <span>~{clock(block.endAt)}</span>
                        {block.startAt.slice(0, 10) !==
                        block.endAt.slice(0, 10) ? (
                          <span>다음날까지</span>
                        ) : null}
                        <span
                          className="dd-timeline-row__rail"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="p2-block-main dd-timeline-row__card">
                        <div className="p2-block-label">
                          <span>
                            <NotebookIcon kind={block.kind} />
                            {block.kind === "attraction"
                              ? `방문 · ${labels(block.attraction?.categories ?? [])}`
                              : block.kind === "meal"
                                ? `${block.mealType === "lunch" ? "점심" : "저녁"} · ${block.mealScope === "local" ? "음식점" : "이동 중 식사"}`
                                : block.kind === "travel"
                                  ? block.direction === "return"
                                    ? "복귀 이동"
                                    : "출발 이동"
                                  : block.kind === "rest"
                                    ? "휴식"
                                    : block.title}
                          </span>
                          <span>{duration(block.durationMinutes)}</span>
                        </div>
                        {block.attraction ? (
                          <button
                            className="p2-place"
                            onClick={() =>
                              setSelected({
                                kind: "attraction",
                                place: block.attraction!,
                              })
                            }
                          >
                            {block.attraction.title}{" "}
                            <span>눌러서 장소 정보 확인</span>
                          </button>
                        ) : block.restaurant ? (
                          <button
                            className="p2-place"
                            onClick={() =>
                              setSelected({
                                kind: "restaurant",
                                place: block.restaurant!,
                              })
                            }
                          >
                            {block.restaurant.name}{" "}
                            <span>눌러서 운영시간·메뉴 확인</span>
                          </button>
                        ) : (
                          <strong>
                            {block.kind === "meal" &&
                            block.mealScope === "transit"
                              ? "이동 중 자유 식사"
                              : block.kind === "meal"
                                ? "현지 식사"
                                : block.title}
                          </strong>
                        )}
                        {block.attraction ? (
                          <AttractionVisitInfo
                            key={`${block.id}:${block.attraction.contentId}`}
                            attraction={block.attraction}
                            visitAt={block.startAt}
                            entry={
                              visitInfo[visitInfoKey(block.attraction)] ?? {
                                status: "not-requested",
                              }
                            }
                            onRequest={() =>
                              requestVisitInfo(block.attraction!)
                            }
                          />
                        ) : null}
                        {block.fixed ? (
                          <span className="p2-fixed">장소 고정됨</span>
                        ) : null}
                        {block.kind === "meal" &&
                        block.mealScope === "local" &&
                        !block.restaurant ? (
                          <p>
                            {meals.isPending && mealRequest
                              ? "음식점 정보를 불러오는 중이에요 · 식사 60분은 확보했어요."
                              : mealFailed
                                ? "식사 정보를 다시 불러오면 채워져요 · 식사 60분은 확보했어요."
                                : "추천할 식당을 더 찾지 못했어요 · 식사 60분은 확보했어요."}
                          </p>
                        ) : null}
                        {block.kind === "meal" &&
                        block.mealScope === "transit" ? (
                          <p className="p2-muted">
                            운전을 멈추고 자유롭게 식사해요. 특정 식당을
                            추천하는 구간은 아니에요.
                          </p>
                        ) : null}
                        {block.attraction ? (
                          <details className="p2-edit-tools">
                            <summary>방문 수정</summary>
                            <div className="p2-actions">
                              <button
                                className="p2-control"
                                aria-pressed={!!block.fixed}
                                onClick={() =>
                                  change({
                                    type: "toggle-fixed",
                                    blockId: block.id,
                                  })
                                }
                              >
                                {block.fixed
                                  ? "장소 고정됨 · 해제"
                                  : "장소 고정"}
                              </button>
                              <label className="p2-duration">
                                방문시간
                                <select
                                  value={block.durationMinutes}
                                  onChange={(event) =>
                                    change({
                                      type: "duration",
                                      blockId: block.id,
                                      durationMinutes: Number(
                                        event.target.value,
                                      ) as VisitDuration,
                                    })
                                  }
                                >
                                  {[30, 60, 90, 120].map((minutes) => (
                                    <option key={minutes} value={minutes}>
                                      {minutes}분
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                className="p2-control"
                                onClick={() => {
                                  if (block.fixed)
                                    setMessage(
                                      "교체하려면 먼저 장소 고정을 해제해 주세요.",
                                    );
                                  else
                                    setExpanded(
                                      expanded === block.id ? null : block.id,
                                    );
                                }}
                              >
                                관광지 교체
                              </button>
                              <button
                                className="p2-control"
                                onClick={() => {
                                  if (block.fixed)
                                    setMessage(
                                      "삭제하려면 먼저 장소 고정을 해제해 주세요.",
                                    );
                                  else if (
                                    window.confirm(
                                      `${block.title} 방문을 삭제하고 자유시간으로 바꿀까요?`,
                                    )
                                  )
                                    change({
                                      type: "delete-attraction",
                                      blockId: block.id,
                                    });
                                }}
                              >
                                삭제
                              </button>
                            </div>
                          </details>
                        ) : null}
                        {block.kind === "meal" &&
                        block.mealScope === "local" ? (
                          <button
                            className="p2-control"
                            onClick={() =>
                              setExpanded(
                                expanded === block.id ? null : block.id,
                              )
                            }
                          >
                            다른 식당 보기
                          </button>
                        ) : null}
                        {expanded === block.id ? (
                          <div className="p2-alternatives">
                            {block.attraction ? (
                              attractionAlternatives(plan, block.id).length ? (
                                attractionAlternatives(plan, block.id).map(
                                  (alternative) => (
                                    <button
                                      className="p2-control"
                                      key={alternative.contentId}
                                      onClick={() =>
                                        change({
                                          type: "replace-attraction",
                                          blockId: block.id,
                                          contentId: alternative.contentId,
                                        })
                                      }
                                    >
                                      {alternative.title}
                                      <small>{alternative.address}</small>
                                    </button>
                                  ),
                                )
                              ) : (
                                <p>
                                  관심사에 맞는 미사용 관광지를 더 찾지
                                  못했어요.
                                </p>
                              )
                            ) : restaurantAlternatives(
                                plan,
                                block.id,
                                restaurants,
                              ).length ? (
                              restaurantAlternatives(
                                plan,
                                block.id,
                                restaurants,
                              ).map((alternative) => (
                                <button
                                  className="p2-control"
                                  key={alternative.contentId}
                                  onClick={() => {
                                    setPlan(
                                      replaceRestaurant(
                                        plan,
                                        block.id,
                                        alternative,
                                      ),
                                    );
                                    setExpanded(null);
                                    setMessage("이 식사 칸의 식당만 바꿨어요.");
                                  }}
                                >
                                  {alternative.name}
                                  <small>{alternative.address}</small>
                                </button>
                              ))
                            ) : (
                              <p>
                                추천할 식당을 더 찾지 못했어요. 기존 식당은
                                유지돼요. 필요하면 식당 목록을 다시 조회해
                                주세요.
                              </p>
                            )}
                          </div>
                        ) : null}
                        <details className="p2-block-basis">
                          <summary>배치 근거</summary>
                          <p>{block.reason}</p>
                        </details>
                      </div>
                    </li>
                  ))}
              </ol>
            </section>
          ))}
          <details className="p2-panel">
            <summary>추천·시간 계산의 근거</summary>
            <p>
              도착 {clock(plan.metrics.arrivalAt)} · 귀가 운전 시작{" "}
              {clock(plan.metrics.returnDepartureAt)} · 현지 활동{" "}
              {duration(plan.metrics.localMinutes)} · 자유시간{" "}
              {duration(plan.metrics.freeMinutes)}
            </p>
            <p>
              활동 사이 여유는 이동·주차·대기에 쓸 수 있는 자유시간이며, 실제
              장소 간 이동시간을 계산한 값은 아니에요.
            </p>
            <p>
              {plan.destination.metadata.travelTimeSource} · 기준연도{" "}
              {plan.destination.metadata.networkYear}
              <br />
              시간표 생성 {plan.destination.metadata.travelTimeGeneratedAt}
              <br />
              관광 프로필 생성 {plan.destination.metadata.profileGeneratedAt}
              <br />
              검색 {plan.destination.metadata.searchedAt}
            </p>
            <p>
              {plan.destination.metadata.representativePoint} · 대표 존{" "}
              {plan.destination.representativeZoneId}
            </p>
            <p>
              지역 대표점 기준 일반 예상시간이며 실시간 교통이나 개별 주소까지의
              시간은 아니에요. 여행지 내부 이동시간은 계산하지 않아요. 주변
              장소는 좌표 근접성으로 함께 구성했으며 도로 동선이나 도보 가능
              여부를 보장하지 않아요.
            </p>
            <p>
              관광 방문시간·여유시간은 서비스의 계획 기준이에요.
              운영·휴무·요금은 방문 전 직접 확인해 주세요.
            </p>
            {mealRequest && meals.data?.fetchedAt ? (
              <p>식당 목록 조회 {meals.data.fetchedAt}</p>
            ) : null}
          </details>
          <Button variant="secondary" onClick={showInput}>
            조건 수정하기
          </Button>
        </section>
      ) : null}
      <footer className="p2-muted">
        두루두루의 계획은 여행 준비를 위한 참고 초안이에요. 방문 전 운영정보와
        실제 이동 여건을 확인해 주세요.
      </footer>
      {selected ? (
        <PlaceDetail
          key={`${selected.kind}:${selected.place.contentId}`}
          selected={selected}
          onClose={closeDetail}
          attractionEntry={
            selected.kind === "attraction"
              ? (visitInfo[visitInfoKey(selected.place)] ?? {
                  status: "not-requested",
                })
              : undefined
          }
          onRequestAttraction={
            selected.kind === "attraction"
              ? () => requestVisitInfo(selected.place)
              : undefined
          }
        />
      ) : null}
    </main>
  );
}
