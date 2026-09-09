import { describe, expect, it, jest } from "@jest/globals";
import type { Attraction } from "@/lib/mvp-phase-two-types";
import {
  AttractionVisitInfoCoordinator,
  buildMapSearchUrl,
  holidayWarningForVisit,
  overviewPreview,
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
