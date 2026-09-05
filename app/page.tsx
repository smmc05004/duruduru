"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { FieldCard } from "@/components/FieldCard";
import { InputField } from "@/components/InputField";
import { Select } from "@/components/Select";
import { formatHoursAndMinutes } from "@/lib/format-duration";
import { originRegions } from "@/lib/region-config";
import type {
  PlannerCandidate,
  SearchRequest,
  SearchResponse,
} from "@/lib/trip-planner-contract";
import { interestTags } from "@/lib/support-conditions";

type View = "form" | "loading" | "candidates" | "itinerary" | "error";

const initialRequest: SearchRequest = {
  originId: "",
  startAt: "",
  returnBy: "",
  transport: "car",
  interests: [],
};

const formatMinutes = (minutes: number) => formatHoursAndMinutes(minutes / 60);

export default function TripConditionsPage() {
  const [request, setRequest] = useState<SearchRequest>(initialRequest);
  const [view, setView] = useState<View>("form");
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState<PlannerCandidate[]>([]);
  const [selected, setSelected] = useState<PlannerCandidate | null>(null);

  const update = (patch: Partial<SearchRequest>) =>
    setRequest((current) => ({ ...current, ...patch }));
  const toggleInterest = (interest: string) =>
    update({
      interests: request.interests.includes(interest)
        ? request.interests.filter((item) => item !== interest)
        : [...request.interests, interest],
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !request.originId ||
      !request.startAt ||
      !request.returnBy ||
      !request.interests.length
    ) {
      setMessage("출발지, 출발·복귀 일시, 관심사를 모두 입력해 주세요.");
      setView("error");
      return;
    }
    if (new Date(request.returnBy) <= new Date(request.startAt)) {
      setMessage("복귀 시각은 출발 시각 이후여야 해요.");
      setView("error");
      return;
    }
    setView("loading");
    try {
      const response = await fetch("/api/trip-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const result = (await response.json()) as SearchResponse;
      if (result.kind !== "success") {
        setMessage(result.message);
        setView("error");
        return;
      }
      setCandidates(result.candidates);
      setView("candidates");
    } catch {
      setMessage("검색을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
      setView("error");
    }
  }

  if (view === "loading") {
    return (
      <main className="dd-screen">
        <Header />
        <section className="dd-calculating" role="status">
          <p>최신 관광지와 음식점 정보를 확인하고 있어요</p>
          <p>
            관광지 조건을 먼저 확인한 뒤, 가능한 지역에만 식사 정보를 연결해요.
          </p>
        </section>
      </main>
    );
  }

  if (view === "error") {
    return (
      <main className="dd-screen">
        <Header />
        <section className="dd-error-summary" role="alert">
          <p className="dd-error-summary__title">
            지금은 계획을 만들 수 없어요
          </p>
          <p className="dd-error-summary__text">{message}</p>
          <p className="dd-error-summary__text">
            임의 관광지·음식점·이동시간으로 대신 추천하지 않았어요.
          </p>
        </section>
        <div className="dd-result-actions">
          <Button variant="primary" onClick={() => setView("form")}>
            조건 수정하기
          </Button>
        </div>
      </main>
    );
  }

  if (view === "itinerary" && selected) {
    const origin = originRegions.find((item) => item.id === request.originId);
    return (
      <main className="dd-screen">
        <Header />
        <section className="dd-summary-card">
          <p className="dd-summary-card__title">
            {selected.name} 참고용 여행 계획
          </p>
          <div className="dd-summary-card__chips">
            <span className="dd-pill">{origin?.name ?? "출발지"} 출발</span>
            <span className="dd-pill">
              편도 일반 예상 {formatMinutes(selected.oneWayMinutes)}
            </span>
            <span className="dd-pill">내부 장소 이동시간은 반영하지 않음</span>
          </div>
        </section>
        <p className="dd-notice">
          관광지와 식사는 각각 1시간으로 배치한 참고 계획이에요. 방문 전
          운영·휴무를 다시 확인해 주세요.
        </p>
        {([1, 2] as const).map((day) => (
          <section
            className="dd-itinerary-day"
            key={day}
            aria-label={`${day}일차 일정`}
          >
            <h2>{day}일차</h2>
            <ol className="dd-candidates">
              {selected.itinerary
                .filter((item) => item.day === day)
                .map((item) => (
                  <li
                    className="dd-candidate"
                    key={`${day}-${item.id}-${item.startsAt}`}
                  >
                    <p className="dd-itinerary__time">
                      {item.startsAt} ~ {item.endsAt}
                    </p>
                    <h3>
                      {item.category} · {item.name}
                    </h3>
                    {item.menu ? <p>추천 메뉴: {item.menu}</p> : null}
                    {item.tags.length ? (
                      <p>관심사: {item.tags.join(" · ")}</p>
                    ) : null}
                  </li>
                ))}
            </ol>
          </section>
        ))}
        <div className="dd-result-actions">
          <Button variant="secondary" onClick={() => setView("candidates")}>
            다른 지역 보기
          </Button>
          <Button variant="secondary" onClick={() => setView("form")}>
            조건 수정하기
          </Button>
        </div>
      </main>
    );
  }

  if (view === "candidates") {
    const origin = originRegions.find((item) => item.id === request.originId);
    return (
      <main className="dd-screen">
        <Header />
        <section className="dd-summary-card">
          <p className="dd-summary-card__title">
            {origin?.name ?? "출발지"}에서 갈 수 있는 곳
          </p>
          <p>관광지 조건을 통과한 지역에만 최신 음식점 정보를 연결했어요.</p>
        </section>
        <ol className="dd-candidates">
          {candidates.map((candidate) => (
            <li className="dd-candidate" key={candidate.id}>
              <h2>{candidate.name}</h2>
              <p>
                {candidate.region} · 편도 일반 예상{" "}
                {formatMinutes(candidate.oneWayMinutes)} · 현지 이용 가능{" "}
                {formatMinutes(candidate.localMinutes)}
              </p>
              <p>
                관심사 {candidate.matchedInterests.join(" · ")} · 관광지{" "}
                {candidate.attractions.length}곳 · 점심 {candidate.lunch.name} ·
                저녁 {candidate.dinner.name}
              </p>
              <Button
                variant="primary"
                onClick={() => {
                  setSelected(candidate);
                  setView("itinerary");
                }}
              >
                {candidate.name} 일정 보기
              </Button>
            </li>
          ))}
        </ol>
        <div className="dd-result-actions">
          <Button variant="secondary" onClick={() => setView("form")}>
            조건 수정하기
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="dd-screen">
      <Header />
      <h1 className="dd-screen__title">
        쓸 수 있는 시간을 알려주면
        <br />갈 곳부터 골라줄게요
      </h1>
      <form onSubmit={submit}>
        <div className="dd-screen__fields">
          <FieldCard label="어디서 출발해요?" htmlFor="origin">
            <Select
              id="origin"
              value={request.originId}
              placeholder="출발지를 골라 주세요"
              options={originRegions.map((region) => ({
                value: region.id,
                label: region.name,
              }))}
              onChange={(event) => update({ originId: event.target.value })}
            />
          </FieldCard>
          <FieldCard label="언제 나가서 언제까지 돌아와요?">
            <div className="dd-datetime-pair">
              <InputField
                id="start-at"
                type="datetime-local"
                prefix="출발"
                value={request.startAt}
                onChange={(event) => update({ startAt: event.target.value })}
              />
              <InputField
                id="return-by"
                type="datetime-local"
                prefix="복귀"
                value={request.returnBy}
                onChange={(event) => update({ returnBy: event.target.value })}
              />
            </div>
          </FieldCard>
          <FieldCard
            label="무엇을 좋아해요?"
            labelAside="· 하나 이상 골라 주세요"
          >
            <div className="dd-chip-group" role="group" aria-label="관심사">
              {interestTags.map((interest) => (
                <Chip
                  key={interest}
                  variant="selectable"
                  label={interest}
                  selected={request.interests.includes(interest)}
                  onToggle={() => toggleInterest(interest)}
                />
              ))}
            </div>
          </FieldCard>
        </div>
        <div className="dd-screen__actions">
          <Button type="submit" variant="primary">
            갈 수 있는 곳 찾기
          </Button>
        </div>
      </form>
      <p className="dd-screen__footnote">
        지역 간 이동시간은 KTDB 2024 도로 네트워크의 일반 예상시간이며, 실시간
        교통은 반영하지 않아요.
      </p>
    </main>
  );
}

function Header() {
  return (
    <div className="dd-screen__header">
      <span className="dd-screen__logo">두루두루</span>
    </div>
  );
}
