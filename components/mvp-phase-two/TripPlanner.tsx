"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import {
  INTERESTS,
  ORIGINS,
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
  deleteSavedPlan,
  isSavedPlan,
  readSavedPlans,
  savePlan,
} from "@/lib/mvp-phase-two-storage";
import { PlaceDetail, type SelectedPlace } from "./PlaceDetail";

const clock = (value: string) => value.slice(11, 16);
const duration = (minutes: number) =>
  `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ""}`;
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
  const savedOpen = useTripUi((s) => s.savedOpen),
    setSavedOpen = useTripUi((s) => s.setSavedOpen);
  const generation = useRef(0);
  const closeDetail = useCallback(() => setSelected(null), []);
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
  const meals = useQuery({
    queryKey: ["phase-two-restaurants", mealRequest],
    enabled: mealRequest !== null,
    queryFn: async ({ signal }) => {
      if (!mealRequest) throw new Error("음식점 조회 조건이 없어요");
      const { data } = await tripApi.post<RestaurantResponse>(
        "/phase-two/restaurants",
        { groupId: mealRequest.groupId, visits: mealRequest.visits },
        { signal },
      );
      if (data.kind !== "data-error")
        queryClient.setQueryData<Restaurant[]>(
          ["restaurant-pool", mealRequest.planId],
          (previous = []) => {
            const merged = new Map(
              previous.map((restaurant) => [restaurant.contentId, restaurant]),
            );
            for (const restaurant of data.restaurants)
              merged.set(restaurant.contentId, restaurant);
            return [...merged.values()];
          },
        );
      return data;
    },
  });
  const pool = useQuery<Restaurant[]>({
    queryKey: ["restaurant-pool", plan?.id],
    queryFn: async () => [],
    enabled: false,
  });
  useEffect(() => {
    if (!meals.data || !mealRequest || meals.data.kind === "data-error") return;
    const requestPlanId = mealRequest.planId,
      restaurants =
        queryClient.getQueryData<Restaurant[]>([
          "restaurant-pool",
          mealRequest.planId,
        ]) ?? meals.data.restaurants;
    setPlan((current) =>
      current?.id === requestPlanId
        ? assignRestaurants(current, restaurants)
        : current,
    );
  }, [meals.data, meals.dataUpdatedAt, mealRequest, queryClient]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = validateSearchInput(input);
    if (!checked.ok) {
      setMessage(checked.reason);
      return;
    }
    const current = ++generation.current;
    setPlan(null);
    setMealRequest(null);
    setSelected(null);
    setMessage("");
    setLoaded(false);
    setSavedOpen(false);
    setExpanded(null);
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
    setPlan(next);
    setLoaded(false);
    setMessage("");
    setSelected(null);
    setExpanded(null);
    setMealRequest(requestFor(next));
  }
  function change(command: EditCommand) {
    if (!plan) return;
    const result = editPlan(plan, command);
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
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
    search.reset();
    setPlan(saved);
    setInput(saved.input);
    setLoaded(true);
    setMealRequest(null);
    setSelected(null);
    setExpanded(null);
    setSavedOpen(false);
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
  return (
    <main className="p2-page">
      <header className="p2-header">
        <a href="/" className="p2-logo">
          두루두루
        </a>
        <button
          className="p2-control"
          onClick={openSaved}
          aria-expanded={savedOpen}
        >
          이 기기 저장 목록
        </button>
      </header>
      <section className="p2-intro">
        <p className="p2-eyebrow">목적지는 아직 몰라도 괜찮아요</p>
        <h1>
          시간만 정하면,
          <br />
          여행이 시작돼요.
        </h1>
        <p>갈 수 있는 곳을 비교하고, 나에게 맞게 바꾸는 1박 2일 여행 초안.</p>
      </section>
      {message ? (
        <p className="p2-notice" role="status">
          {message}
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
      <form className="p2-panel p2-form" onSubmit={submit}>
        <h2>언제 떠날까요?</h2>
        <label>
          출발지
          <select
            value={input.originId}
            onChange={(event) =>
              setInput({
                ...input,
                originId: event.target.value as SearchInput["originId"],
              })
            }
          >
            {ORIGINS.map((origin) => (
              <option key={origin.id} value={origin.id}>
                {origin.label}
              </option>
            ))}
          </select>
        </label>
        <div className="p2-grid">
          <label>
            출발 일시
            <input
              required
              type="datetime-local"
              value={input.startAt}
              onChange={(event) =>
                setInput({ ...input, startAt: event.target.value })
              }
            />
          </label>
          <label>
            다음날 귀가 완료 일시
            <input
              required
              type="datetime-local"
              value={input.returnBy}
              onChange={(event) =>
                setInput({ ...input, returnBy: event.target.value })
              }
            />
          </label>
        </div>
        <p className="p2-muted">
          자차 · 1박 2일 · 출발과 복귀는 07:00~21:00. 양일 점심과 저녁을
          포함해요.
        </p>
        <fieldset>
          <legend>좋아하는 여행을 골라 주세요 · 1개 이상</legend>
          <div className="p2-actions">
            {INTERESTS.map((interest) => (
              <button
                className="p2-control"
                type="button"
                aria-pressed={input.interests.includes(interest.id)}
                key={interest.id}
                onClick={() =>
                  setInput({
                    ...input,
                    interests: input.interests.includes(interest.id)
                      ? input.interests.filter((id) => id !== interest.id)
                      : [...input.interests, interest.id],
                  })
                }
              >
                {interest.label}
              </button>
            ))}
          </div>
        </fieldset>
        <Button variant="primary" type="submit" disabled={search.isPending}>
          {search.isPending
            ? "갈 수 있는 곳을 찾고 있어요…"
            : "갈 수 있는 곳 찾기"}
        </Button>
      </form>
      {!plan && candidates.length > 0 && !search.isPending ? (
        <section aria-label="목적지 추천">
          <h2>이 시간에 다녀올 수 있어요</h2>
          <p>실제 방문 장소와 여유시간을 비교해 보세요.</p>
          <div className="p2-candidates">
            {candidates.map((candidate) => (
              <article className="p2-panel" key={candidate.groupId}>
                <p className="p2-eyebrow">{candidate.province}</p>
                <h2>{candidate.displayName}</h2>
                <p>
                  {labels(candidate.preview.metrics.fulfilledInterests)} ·{" "}
                  {candidate.preview.metrics.attractionCount}곳 방문
                </p>
                <p>
                  왕복 운전 {duration(candidate.oneWayMinutes * 2)}
                  <br />
                  현지 활동 {duration(candidate.preview.metrics.localMinutes)} ·
                  자유시간 {duration(candidate.preview.metrics.freeMinutes)}
                </p>
                <ol className="p2-preview">
                  {candidate.preview.blocks
                    .filter((b) => b.kind === "attraction")
                    .map((block) => (
                      <li key={block.id}>
                        {block.day}일차 {clock(block.startAt)}~
                        {clock(block.endAt)}
                        <br />
                        <strong>{block.title}</strong>
                      </li>
                    ))}
                </ol>
                <ul>
                  {candidate.reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
                <Button variant="primary" onClick={() => choose(candidate)}>
                  이곳으로 계획하기
                </Button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {plan ? (
        <section aria-label="여행 계획">
          <div className="p2-plan-head">
            <div>
              <p className="p2-eyebrow">나의 1박 2일 참고 계획</p>
              <h2>{plan.destination.displayName}</h2>
              <p>
                {plan.input.startAt.replace("T", " ")} 출발 →{" "}
                {plan.input.returnBy.replace("T", " ")} 귀가 완료
              </p>
            </div>
            <div className="p2-actions">
              <button className="p2-control" onClick={persist}>
                이 기기에 저장
              </button>
              {candidates.length ? (
                <button
                  className="p2-control"
                  onClick={() => {
                    setPlan(null);
                    setMealRequest(null);
                    setSelected(null);
                  }}
                >
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
            여행지 도착 {clock(plan.metrics.arrivalAt)} · 다음날 귀가 운전 시작{" "}
            {clock(plan.metrics.returnDepartureAt)}
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
          <div className="p2-panel">
            <strong>식사 정보</strong>
            <p role="status">
              {meals.isFetching && mealRequest
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
              className="p2-control"
              disabled={meals.isFetching && !!mealRequest}
              onClick={() => setMealRequest(requestFor(plan))}
            >
              식당 목록 {mealRequest ? "다시 조회" : "조회"}
            </button>
          </div>
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
                      className={`p2-block p2-block--${block.kind}`}
                    >
                      <div className="p2-block-time">
                        {clock(block.startAt)}—{clock(block.endAt)}
                        {block.kind === "rest" ? <span>다음날까지</span> : null}
                      </div>
                      <div className="p2-block-main">
                        {block.kind === "meal" ? (
                          <p className="p2-eyebrow">
                            {block.mealType === "lunch" ? "점심" : "저녁"} ·{" "}
                            {block.mealScope === "local"
                              ? "현지 식사"
                              : "이동 중 자유 식사"}{" "}
                            · 60분
                          </p>
                        ) : null}
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
                            {block.attraction.title} <span>상세 보기</span>
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
                            {block.restaurant.name} <span>식당 상세</span>
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
                        <p className="p2-muted">{block.reason}</p>
                        {block.kind === "meal" &&
                        block.mealScope === "local" &&
                        !block.restaurant ? (
                          <p>
                            {meals.isFetching && mealRequest
                              ? "음식점 정보를 불러오는 중이에요 · 식사 60분은 확보했어요."
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
                              {block.fixed ? "장소 고정됨 · 해제" : "장소 고정"}
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
        />
      ) : null}
    </main>
  );
}
