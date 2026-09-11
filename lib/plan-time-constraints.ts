import type { PlanSnapshot } from "./mvp-phase-two-types";
import { estimateLocalTravel } from "./local-travel-time";

/** Minutes relative to the trip's first KST midnight. Shared by generation,
 * editing and storage; this is a daytime activity window, not a driving limit. */
export function localActivityWindow(
  day: 1 | 2,
  arrival: number,
  departure: number,
) {
  return {
    start: Math.max(arrival, (day - 1) * 1440 + 420),
    end: Math.min(departure, (day - 1) * 1440 + 1260),
  };
}

/**
 * 저장된 이동 구간의 `distanceKm`와 다시 계산한 값을 비교한다. 이 값은
 * `Math.sin/cos/asin`으로 만드는데, 초월함수 결과는 JS 엔진(서버 Node ↔ 브라우저
 * Chromium)마다 최대 1 ULP까지 다를 수 있다. 서버가 만든 계획을 브라우저에서
 * 검증할 때 이 미세한 차이로 저장이 거부되던 회귀가 있어, 1mm(1e-6km) 허용
 * 오차로 비교한다. 분 단위 값(`estimatedMinutes` 등)은 `Math.ceil`로 안정적이라
 * 그대로 정확 비교한다.
 */
function sameDistanceKm(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 1e-6;
}

export function planTimeError(
  plan: PlanSnapshot,
  enforceEditingRules = true,
): string | undefined {
  const time = (value: string) => Date.parse(`${value}:00+09:00`);
  const midnight = time(`${plan.input.startAt.slice(0, 10)}T00:00`);
  const minute = (value: string) => (time(value) - midnight) / 60_000;
  const arrival = minute(plan.metrics.arrivalAt),
    departure = minute(plan.metrics.returnDepartureAt);
  let previous = time(plan.input.startAt);
  const ids = new Set<string>(),
    contents = new Set<string>();
  for (const block of plan.blocks) {
    const start = time(block.startAt),
      end = time(block.endAt);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start !== previous ||
      end <= start ||
      end > time(plan.input.returnBy) ||
      (end - start) / 60_000 !== block.durationMinutes ||
      ids.has(block.id)
    )
      return "여행 범위의 시간 블록이 겹치거나 비어 있어요.";
    ids.add(block.id);
    previous = end;
    if (
      ["attraction", "personal", "free"].includes(block.kind) ||
      block.localTravel
    ) {
      const window = localActivityWindow(block.day, arrival, departure);
      if (
        minute(block.startAt) < window.start ||
        minute(block.endAt) > window.end
      )
        return "현지 체류 범위 밖에는 활동이나 여유시간을 배치할 수 없어요.";
    }
    if (block.kind === "attraction") {
      if (!block.contentId || contents.has(block.contentId))
        return "같은 관광지를 두 번 배치할 수 없어요.";
      contents.add(block.contentId);
    }
    if (
      block.kind === "personal" &&
      (!block.personal ||
        block.personal.day !== block.day ||
        block.personal.durationMinutes !== block.durationMinutes ||
        block.personal.id !== block.id)
    )
      return "개인 일정의 날짜나 시간이 일치하지 않아요.";
    if (block.fixedStartAt && block.fixedStartAt !== block.startAt)
      return "고정 시각 충돌이 있어요.";
  }
  if (previous !== time(plan.input.returnBy))
    return "복귀 완료까지 시간 블록이 이어지지 않아요.";
  if (plan.localTravelVersion) {
    if (plan.localTravelVersion !== "straight-line-v1")
      return "지원하지 않는 이동시간 규칙이에요.";
    const used = new Set<string>();
    for (const day of [1, 2]) {
      const places = plan.blocks.filter(
        (b) =>
          b.day === day &&
          (b.kind === "attraction" ||
            b.kind === "personal" ||
            (b.kind === "meal" && b.mealScope === "local")),
      );
      for (let i = 1; i < places.length; i++) {
        const from = places[i - 1],
          to = places[i];
        const estimate = estimateLocalTravel(
          from.attraction?.coordinates ?? from.restaurant?.coordinates ?? null,
          to.attraction?.coordinates ?? to.restaurant?.coordinates ?? null,
        );
        const legs = plan.blocks.filter(
          (b) =>
            b.localTravel?.fromId === from.id && b.localTravel.toId === to.id,
        );
        if (estimate.reservedMinutes === 0 && !legs.length) continue;
        if (legs.length !== 1)
          return "장소 간 이동 구간이 누락되거나 중복됐어요.";
        const b = legs[0],
          l = b.localTravel!;
        if (
          b.day !== day ||
          b.kind !== "travel" ||
          b.direction !== undefined ||
          b.durationMinutes !== estimate.reservedMinutes ||
          time(b.startAt) < time(from.endAt) ||
          time(b.endAt) > time(to.startAt) ||
          l.status !== estimate.status ||
          l.estimatedMinutes !== estimate.estimatedMinutes ||
          l.reservedMinutes !== estimate.reservedMinutes ||
          !sameDistanceKm(l.distanceKm, estimate.distanceKm) ||
          l.policyVersion !== estimate.policyVersion
        )
          return "장소 간 이동시간과 일정이 일치하지 않아요.";
        used.add(b.id);
      }
    }
    if (plan.blocks.some((b) => b.localTravel && !used.has(b.id)))
      return "이동 구간의 장소 연결이 올바르지 않아요.";
  } else if (plan.blocks.some((b) => b.localTravel))
    return "이동시간 규칙이 누락됐어요.";
  if (!enforceEditingRules) return;
  if (contents.size > 6)
    return "관광지는 여행 전체 최대 6곳까지 추가할 수 있어요.";
  if (plan.blocks.filter((b) => b.kind === "personal").length > 4)
    return "개인 일정은 여행 전체 최대 4개까지 추가할 수 있어요.";
  for (const day of [1, 2] as const) {
    const daily = plan.blocks.filter((b) => b.day === day);
    if (daily.filter((b) => b.kind === "attraction").length > 3)
      return "해당 날짜 관광 3곳 한도예요.";
    const activities = daily.filter(
      (b) => b.kind === "attraction" || b.kind === "personal",
    );
    if (
      activities.length &&
      daily
        .filter((b) => b.kind === "free")
        .reduce((sum, b) => sum + b.durationMinutes, 0) < 30
    )
      return "하루 여유시간 30분을 확보할 수 없어요.";
    if (plan.localTravelVersion) continue;
    let lastActivityEnd: number | undefined;
    for (const block of daily) {
      if (block.kind === "free") continue;
      if (block.kind !== "attraction" && block.kind !== "personal") {
        lastActivityEnd = undefined;
        continue;
      }
      if (
        lastActivityEnd !== undefined &&
        time(block.startAt) - lastActivityEnd < 15 * 60_000
      )
        return "활동 사이 여유시간 15분을 확보할 수 없어요.";
      lastActivityEnd = time(block.endAt);
    }
  }
}
