"use client";

import { FormEvent, useMemo, useState } from "react";
import { destinations, type Destination } from "@/lib/mock-data";
import { buildItinerary, recommendDestinations, type TripInput } from "@/lib/planner";

const defaultInput: TripInput = {
  origin: "서울",
  start: "2026-09-12T08:00",
  end: "2026-09-13T20:00",
  transport: "car",
  interests: ["역사"],
};

const interestOptions = ["역사", "자연", "문화", "미식"];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(value));
}

export default function Home() {
  const [input, setInput] = useState<TripInput>(defaultInput);
  const [submitted, setSubmitted] = useState(defaultInput);
  const [selectedId, setSelectedId] = useState("gyeongju");
  const recommendations = useMemo(() => recommendDestinations(submitted, destinations), [submitted]);
  const selected = recommendations.find(({ destination }) => destination.id === selectedId)?.destination ?? recommendations[0]?.destination;
  const itinerary = useMemo(() => selected ? buildItinerary(selected, submitted) : [], [selected, submitted]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(input);
    const next = recommendDestinations(input, destinations)[0]?.destination.id;
    if (next) setSelectedId(next);
  }

  function toggleInterest(interest: string) {
    setInput((current) => ({
      ...current,
      interests: current.interests.includes(interest)
        ? current.interests.filter((item) => item !== interest)
        : [...current.interests, interest],
    }));
  }

  return (
    <main>
      <section className="hero">
        <nav><span className="logo">DURUDURU</span><span>목적지 없는 여행의 시작</span></nav>
        <div className="hero-copy"><p className="eyebrow">국내 여행 플래너 · PoC</p><h1>시간이 생기면,<br />두루두루.</h1><p>출발과 복귀 시간만 알려주세요. 갈 수 있는 곳부터 찾아드릴게요.</p></div>
      </section>

      <section className="planner" aria-label="여행 조건 입력">
        <form onSubmit={submit}>
          <div className="field"><label htmlFor="origin">출발지</label><select id="origin" value={input.origin} onChange={(e) => setInput({ ...input, origin: e.target.value })}><option>서울</option><option>대전</option><option>부산</option></select></div>
          <div className="field"><label htmlFor="start">출발</label><input id="start" type="datetime-local" value={input.start} onChange={(e) => setInput({ ...input, start: e.target.value })} /></div>
          <div className="field"><label htmlFor="end">복귀</label><input id="end" type="datetime-local" value={input.end} onChange={(e) => setInput({ ...input, end: e.target.value })} /></div>
          <div className="field"><label>이동 수단</label><div className="segmented"><button type="button" className={input.transport === "car" ? "active" : ""} onClick={() => setInput({ ...input, transport: "car" })}>자차</button><button type="button" className={input.transport === "public" ? "active" : ""} onClick={() => setInput({ ...input, transport: "public" })}>대중교통</button></div></div>
          <div className="field interests"><label>여행 관심사</label><div>{interestOptions.map((interest) => <button type="button" key={interest} className={input.interests.includes(interest) ? "chip selected" : "chip"} onClick={() => toggleInterest(interest)}>{interest}</button>)}</div></div>
          <button className="submit" type="submit">갈 수 있는 곳 찾기 <span>→</span></button>
        </form>
      </section>

      <section className="content">
        <div className="section-heading"><div><p className="eyebrow">RECOMMENDATIONS</p><h2>이번 여행에 갈 수 있는 곳</h2><p>{submitted.origin} 출발 · {formatDate(submitted.start)} ~ {formatDate(submitted.end)} · {submitted.interests.join(" · ")} 중심</p></div><span className="count">{recommendations.length}곳</span></div>
        <div className="cards">{recommendations.map(({ destination, score, reason }) => <DestinationCard key={destination.id} destination={destination} score={score} reason={reason} selected={destination.id === selected?.id} onSelect={() => setSelectedId(destination.id)} />)}</div>

        {selected && <section className="itinerary"><div className="section-heading"><div><p className="eyebrow">SIMPLE ITINERARY</p><h2>{selected.name}, 이렇게 둘러보세요</h2><p>운영시간과 평균 이동시간을 반영한 간단한 추천 일정이에요.</p></div><span className="tag">{selected.food}</span></div><div className="timeline">{itinerary.map((item, index) => <div className="timeline-item" key={`${item.time}-${item.title}`}><div className="time">{item.time}<span>{item.day}</span></div><div className="dot" /><div className="schedule"><span className="schedule-type">{item.type}</span><h3>{item.title}</h3><p>{item.description}</p>{item.note && <small>{item.note}</small>}</div>{index < itinerary.length - 1 && <div className="line" />}</div>)}</div></section>}
      </section>
      <footer>© DURUDURU PoC · 현재 추천 및 일정은 목업 데이터로 생성됩니다.</footer>
    </main>
  );
}

function DestinationCard({ destination, score, reason, selected, onSelect }: { destination: Destination; score: number; reason: string; selected: boolean; onSelect: () => void }) {
  return <button className={`destination-card ${selected ? "selected" : ""}`} onClick={onSelect}><div className="card-top"><span className="area">{destination.region}</span><span className="score">추천 {score}점</span></div><h3>{destination.name}</h3><p>{destination.summary}</p><div className="meta"><span>🚗 평균 {destination.driveHours}시간</span><span>·</span><span>{destination.attractions.length}곳 둘러보기</span></div><div className="reason">{reason}</div>{destination.festival && <div className="festival">✦ {destination.festival.name}</div>}</button>;
}
