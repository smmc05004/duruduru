import { describe, expect, it, jest } from "@jest/globals";
import type { Attraction } from "@/lib/mvp-phase-two-types";
import {
  AttractionVisitInfoCoordinator,
  buildMapSearchUrl,
  holidayWarningForVisit,
  overviewPreview,
  retainVisitInfoForAttractions,
} from "@/lib/attraction-visit-info";

const attraction = (contentId: string): Attraction => ({
  contentId,
  contentTypeId: "12",
  regionId: "region-a",
  title: `관광지 ${contentId}`,
  address: "서울특별시 중구 세종대로 1",
  imageUrl: "",
  coordinates: null,
  categories: ["history"],
  cat1: "A02",
  cat2: "A0201",
  cat3: "A0201",
});

const detail = (closedDays = "") => ({
  title: { status: "confirmed" as const, value: "관광지" },
  address: {
    status: "confirmed" as const,
    value: "서울특별시 중구 세종대로 1",
  },
  overview: { status: "confirmed" as const, value: "안전한 소개" },
  openingHours: { status: "unknown" as const },
  closedDays: closedDays
    ? { status: "confirmed" as const, value: closedDays }
    : { status: "unknown" as const },
  fees: { status: "unknown" as const },
  phone: { status: "unknown" as const },
  imageUrl: "",
  fetchedAt: "2026-09-09T00:00:00.000Z",
});

describe("E3 방문 정보 요청 조정기", () => {
  it("취소를 무시하는 원천 뒤 수동 예약도 12초에 끝나며 미시작 예약은 예산을 쓰지 않는다", async () => {
    jest.useFakeTimers();
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fetcher = jest.fn(async (item: Attraction) => {
        if (item.contentId === "held") await held;
        throw new Error("offline");
      });
      const coordinator = new AttractionVisitInfoCoordinator(fetcher);
      const first = coordinator.request(attraction("held"), "manual");
      const firstTimeout = expect(first).rejects.toThrow("timeout");
      await jest.advanceTimersByTimeAsync(12_000);
      await firstTimeout;
      await jest.advanceTimersByTimeAsync(31_000);
      const queued = coordinator.request(attraction("queued"), "manual");
      const queuedTimeout = expect(queued).rejects.toThrow("timeout");
      await jest.advanceTimersByTimeAsync(12_000);
      // The original transport is still unresolved at this assertion.
      await queuedTimeout;
      expect(fetcher).toHaveBeenCalledTimes(1);
      release();
      await jest.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(
        coordinator.request(attraction("queued"), "manual"),
      ).rejects.toThrow("unavailable");
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(
        coordinator.request(attraction("queued"), "manual"),
      ).rejects.toThrow("unavailable");
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it("취소를 무시하는 원천도 12초에 UI를 해제하고 늦은 응답을 버린다", async () => {
    jest.useFakeTimers();
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const coordinator = new AttractionVisitInfoCoordinator(async () => {
        await held;
        return { kind: "success", detail: detail() };
      });
      const request = coordinator.request(attraction("late"), "manual");
      const assertion = expect(request).rejects.toThrow("timeout");
      await jest.advanceTimersByTimeAsync(12_000);
      await assertion;
      release();
      await jest.advanceTimersByTimeAsync(0);
      expect(coordinator.current(attraction("late"))).toEqual({
        status: "not-requested",
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("28초가 지나면 예약 자동 요청을 즉시 해제하고 시작 못한 다음 장소는 미조회로 둔다", async () => {
    jest.useFakeTimers();
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fetcher = jest.fn(async () => {
        await held;
        return { kind: "success" as const, detail: detail() };
      });
      const coordinator = new AttractionVisitInfoCoordinator(fetcher, {
        itemTimeoutMs: 60_000,
      });
      const manual = coordinator.request(attraction("held"), "manual");
      const states: string[] = [];
      const automatic = coordinator.automatically(
        [attraction("queued"), attraction("never")],
        undefined,
        (_, entry) => states.push(entry.status),
      );
      await jest.advanceTimersByTimeAsync(28_000);
      await automatic;
      expect(states).toEqual(["loading", "not-requested"]);
      expect(coordinator.current(attraction("never"))).toEqual({
        status: "not-requested",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      release();
      await manual;
    } finally {
      jest.useRealTimers();
    }
  });

  it("같은 계획 재열기·취소는 수동 2회 예산을 보존하고 새 계획만 분리한다", async () => {
    let now = 0;
    const fetcher = jest.fn(async () => {
      throw new Error("offline");
    });
    const coordinator = new AttractionVisitInfoCoordinator(fetcher, {
      now: () => now,
    });
    coordinator.usePlan("saved-plan");
    await expect(
      coordinator.request(attraction("a"), "manual"),
    ).rejects.toThrow("unavailable");
    await expect(
      coordinator.request(attraction("a"), "manual"),
    ).rejects.toThrow("cooldown");
    now += 30_000;
    coordinator.cancelAll();
    coordinator.usePlan("saved-plan");
    await expect(
      coordinator.request(attraction("a"), "manual"),
    ).rejects.toThrow("unavailable");
    now += 30_000;
    await expect(
      coordinator.request(attraction("a"), "manual"),
    ).rejects.toThrow("limit");
    coordinator.usePlan("new-plan");
    await expect(
      coordinator.request(attraction("a"), "manual"),
    ).rejects.toThrow("unavailable");
    coordinator.usePlan("saved-plan");
    await expect(
      coordinator.request(attraction("a"), "manual"),
    ).rejects.toThrow("limit");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("전체 확인 반복과 취소로 자동 재시도·6항목 예산을 충전하지 않는다", async () => {
    let now = 0;
    const fetcher = jest.fn(async () => {
      throw new Error("offline");
    });
    const coordinator = new AttractionVisitInfoCoordinator(fetcher, {
      now: () => now,
    });
    const items = Array.from({ length: 8 }, (_, i) => attraction(String(i)));
    await coordinator.automatically(items);
    coordinator.cancelAll();
    await coordinator.automatically(items.slice(2));
    now += 31_000;
    await coordinator.automatically(items);
    expect(fetcher).toHaveBeenCalledTimes(6);
    await expect(coordinator.request(items[0], "manual")).rejects.toThrow(
      "unavailable",
    );
    now += 30_000;
    await expect(coordinator.request(items[0], "manual")).rejects.toThrow(
      "unavailable",
    );
    now += 30_000;
    await expect(coordinator.request(items[0], "manual")).rejects.toThrow(
      "limit",
    );
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("시작 전 취소된 예약은 예산을 소비하지 않고 늦은 성공은 캐시를 오염시키지 않는다", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = jest.fn(async (item: Attraction) => {
      if (item.contentId === "held") await held;
      return { kind: "success" as const, detail: detail() };
    });
    const coordinator = new AttractionVisitInfoCoordinator(fetcher);
    const started = coordinator.request(attraction("held"), "manual");
    const parent = new AbortController();
    const queued = coordinator.request(
      attraction("queued"),
      "manual",
      parent.signal,
    );
    parent.abort();
    coordinator.cancelAll();
    await expect(started).rejects.toThrow("cancelled");
    await expect(queued).rejects.toThrow("cancelled");
    // Keep the transport slot until an abort-ignoring fetcher actually settles.
    expect(fetcher).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(coordinator.current(attraction("held"))).toEqual({
      status: "not-requested",
    });
    await expect(
      coordinator.request(attraction("queued"), "manual"),
    ).resolves.toMatchObject({ status: "ready" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("서로 다른 계획 관광지 최대 6개를 순차 보강하고 진행 요청을 클릭과 공유한다", async () => {
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const fetcher = jest.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await waiting;
      active -= 1;
      return { kind: "success" as const, detail: detail() };
    });
    const coordinator = new AttractionVisitInfoCoordinator(fetcher);
    const automatic = coordinator.automatically(
      Array.from({ length: 8 }, (_, index) => attraction(String(index))),
    );
    const shared = coordinator.request(attraction("0"), "manual");
    release();
    await Promise.all([automatic, shared]);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(peak).toBe(1);
  });

  it("부분 성공을 짧게 캐시하고 실패 재시도 쿨다운과 최대 두 번을 적용한다", async () => {
    let now = 0;
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({ kind: "partial" as const, detail: detail() })
      .mockRejectedValue(new Error("unavailable"));
    const coordinator = new AttractionVisitInfoCoordinator(fetcher, {
      now: () => now,
    });
    await coordinator.request(attraction("a"), "manual");
    await coordinator.request(attraction("a"), "manual");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 5 * 60_000 + 1;
    await expect(
      coordinator.request(attraction("a"), "manual"),
    ).rejects.toThrow("unavailable");
    await expect(
      coordinator.request(attraction("a"), "manual"),
    ).rejects.toThrow("cooldown");
  });

  it("항목 시간 초과는 계획을 막지 않고 unavailable로 남기며, stale 자동 작업은 다음 항목을 시작하지 않는다", async () => {
    const slow = jest.fn(
      (_attraction: Attraction, signal: AbortSignal) =>
        new Promise<never>((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          }),
        ),
    );
    const coordinator = new AttractionVisitInfoCoordinator(slow, {
      itemTimeoutMs: 5,
      wholeTimeoutMs: 50,
    });
    const states: string[] = [];
    await coordinator.automatically(
      [attraction("timeout")],
      undefined,
      (_, entry) => states.push(entry.status),
    );
    expect(states).toEqual(["loading", "unavailable"]);

    const parent = new AbortController();
    const stale = coordinator.automatically(
      [attraction("stale-a"), attraction("stale-b")],
      parent.signal,
    );
    parent.abort();
    await stale;
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it("자동 A와 수동 B/C도 하나의 직렬 큐를 공유하고 취소 뒤 예약 항목을 시작하지 않는다", async () => {
    let active = 0;
    let peak = 0;
    const started: string[] = [];
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const coordinator = new AttractionVisitInfoCoordinator(async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(item.contentId);
      await hold;
      active -= 1;
      return { kind: "success" as const, detail: detail() };
    });
    const automatic = coordinator.automatically([
      attraction("A"),
      attraction("D"),
    ]);
    const manualB = coordinator.request(attraction("B"), "manual");
    const manualC = coordinator.request(attraction("C"), "manual");
    coordinator.cancelAll();
    release();
    await Promise.allSettled([automatic, manualB, manualC]);
    expect(peak).toBe(1);
    expect(started).toEqual(["A"]);
  });

  it("취소 없이도 자동 A와 수동 B/C를 모두 하나씩 완료해 source 동시성 2를 넘지 않는다", async () => {
    let active = 0;
    let peak = 0;
    const started: string[] = [];
    const coordinator = new AttractionVisitInfoCoordinator(async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(item.contentId);
      await Promise.resolve();
      active -= 1;
      return { kind: "success" as const, detail: detail() };
    });
    const automatic = coordinator.automatically([
      attraction("A"),
      attraction("D"),
    ]);
    const manualB = coordinator.request(attraction("B"), "manual");
    const manualC = coordinator.request(attraction("C"), "manual");
    await Promise.all([automatic, manualB, manualC]);
    expect(peak).toBe(1);
    expect(started).toEqual(["A", "B", "C", "D"]);
  });

  it("취소된 StrictMode 요청은 새 요청과 공유하지 않고, whole timeout은 현재 항목을 재시도 가능 상태로 남긴다", async () => {
    const fetcher = jest.fn(
      (_item: Attraction, signal: AbortSignal) =>
        new Promise<never>((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          }),
        ),
    );
    const coordinator = new AttractionVisitInfoCoordinator(fetcher, {
      wholeTimeoutMs: 5,
      itemTimeoutMs: 50,
    });
    const first = coordinator.request(attraction("strict"), "automatic");
    coordinator.cancelAll();
    const second = coordinator.request(attraction("strict"), "manual");
    await Promise.allSettled([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(2);

    coordinator.usePlan("whole-timeout-plan");
    const states: string[] = [];
    await coordinator.automatically(
      [attraction("whole"), attraction("later")],
      undefined,
      (_, entry) => states.push(entry.status),
    );
    expect(states).toEqual(["loading", "unavailable"]);
    expect(coordinator.current(attraction("later")).status).toBe(
      "not-requested",
    );
  });

  it("부모 취소로 건너뛴 대기 항목을 제거해 다음 시도가 새 요청이 된다", async () => {
    let releaseActive!: () => void;
    const active = new Promise<void>((resolve) => (releaseActive = resolve));
    const fetcher = jest.fn(async (item: Attraction) => {
      if (item.contentId === "A") await active;
      return { kind: "success" as const, detail: detail() };
    });
    const coordinator = new AttractionVisitInfoCoordinator(fetcher);
    const first = coordinator.request(attraction("A"), "manual");
    const parent = new AbortController();
    const cancelled = coordinator.request(
      attraction("B"),
      "manual",
      parent.signal,
    );
    parent.abort();
    releaseActive();
    await first;
    await expect(cancelled).rejects.toThrow("cancelled");

    await expect(
      coordinator.request(attraction("B"), "manual"),
    ).resolves.toMatchObject({
      status: "ready",
    });
    expect(fetcher.mock.calls.map(([item]) => item.contentId)).toEqual([
      "A",
      "B",
    ]);
  });

  it("계획 편집은 유지된 관광지의 완료 방문 정보를 보존하고 삭제된 정보만 제거한다", () => {
    const retained = attraction("retained");
    const removed = attraction("removed");
    const entries = {
      [`${retained.contentId}:${retained.contentTypeId}`]: {
        status: "ready" as const,
        detail: detail("매주 월요일 휴무"),
      },
      [`${removed.contentId}:${removed.contentTypeId}`]: {
        status: "partial" as const,
        detail: detail(),
      },
      "loading:12": { status: "loading" as const },
    };

    expect(retainVisitInfoForAttractions(entries, [retained])).toEqual({
      [`${retained.contentId}:${retained.contentTypeId}`]:
        entries[`${retained.contentId}:${retained.contentTypeId}`],
    });
  });

  it("안전한 지도 링크, 소개 축약 및 KST 단일 요일 휴무만 경고한다", () => {
    expect(
      buildMapSearchUrl("서울 <script>alert(1)</script>", "관광지"),
    ).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    expect(overviewPreview("가".repeat(170))).toHaveLength(161);
    expect(holidayWarningForVisit("매주 월요일 휴무", "2026-09-14T10:00")).toBe(
      true,
    );
    expect(
      holidayWarningForVisit("매주 월요일 (공휴일 제외)", "2026-09-14T10:00"),
    ).toBe(false);
    expect(holidayWarningForVisit("연중무휴", "2026-09-14T10:00")).toBe(false);
  });
});
