import type { NormalizedAttractionDetail } from "./attraction-detail";
import type { Attraction } from "./mvp-phase-two-types";

export type AttractionDetailResponse = {
  kind: "success" | "partial";
  detail: NormalizedAttractionDetail;
};
export type VisitInfoStatus =
  "not-requested" | "loading" | "ready" | "partial" | "unavailable";
export type VisitInfoEntry = {
  status: VisitInfoStatus;
  detail?: NormalizedAttractionDetail;
  message?: string;
  fetchedAt?: string;
  reason?: "cooldown" | "limit" | "timeout" | "cancelled" | "unavailable";
};
export function visitInfoFailure(error: unknown): VisitInfoEntry {
  const reason = error instanceof Error ? error.message : "unavailable";
  const messages = {
    cooldown: "다시 확인하려면 마지막 실패 후 30초를 기다려 주세요.",
    limit: "이 계획에서 이 장소의 방문정보 확인 횟수를 모두 사용했어요.",
    timeout: "방문정보 확인 시간이 초과됐어요. 방문 전 확인해 주세요.",
    cancelled: "방문정보 확인이 취소됐어요.",
    unavailable: "방문 정보를 불러오지 못했어요. 방문 전 확인해 주세요.",
  };
  const code = Object.hasOwn(messages, reason)
    ? (reason as keyof typeof messages)
    : "unavailable";
  return { status: "unavailable", reason: code, message: messages[code] };
}
export type AttractionDetailFetcher = (
  attraction: Attraction,
  signal: AbortSignal,
) => Promise<AttractionDetailResponse>;

const NORMAL_CACHE_MS = 30 * 60_000;
const PARTIAL_CACHE_MS = 5 * 60_000;
const RETRY_COOLDOWN_MS = 30_000;
const ITEM_TIMEOUT_MS = 12_000;
const WHOLE_TIMEOUT_MS = 28_000;
const MAX_AUTOMATIC_ITEMS = 6;

export const visitInfoKey = (
  attraction: Pick<Attraction, "contentId" | "contentTypeId">,
) => `${attraction.contentId}:${attraction.contentTypeId}`;

/** Keeps completed details through an in-place plan edit. Cancelled loading
 * entries are deliberately dropped so the UI offers a fresh retry. */
export function retainVisitInfoForAttractions(
  entries: Record<string, VisitInfoEntry>,
  attractions: readonly Pick<Attraction, "contentId" | "contentTypeId">[],
): Record<string, VisitInfoEntry> {
  const keys = new Set(attractions.map(visitInfoKey));
  return Object.fromEntries(
    Object.entries(entries).filter(
      ([key, entry]) => keys.has(key) && entry.status !== "loading",
    ),
  );
}

type CacheEntry = VisitInfoEntry & { expiresAt: number };
type InFlight = {
  promise: Promise<VisitInfoEntry>;
  controller: AbortController;
  identity: symbol;
};
type QueuedRequest = InFlight & {
  attraction: Attraction;
  mode: "automatic" | "manual";
  resolve: (entry: VisitInfoEntry) => void;
  reject: (error: Error) => void;
  budget: PlanBudget;
  queueTimeout: ReturnType<typeof setTimeout>;
};
type PlanBudget = {
  manual: Map<string, number>;
  automatic: Set<string>;
  failures: Map<string, { failedAt: number }>;
  automaticStartedAt?: number;
};
const createBudget = (): PlanBudget => ({
  manual: new Map(),
  automatic: new Set(),
  failures: new Map(),
});

/**
 * Client-memory coordinator. It deliberately queues plan items one at a time:
 * the Route Handler performs only detailCommon2 + detailIntro2 in parallel, so
 * this preserves the E3 upstream concurrency cap of two.
 */
export class AttractionVisitInfoCoordinator {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlight>();
  // Budgets live for each plan ID in this mounted planner session. Cancellation,
  // edits, cache expiry and reopening the same saved plan never replenish them.
  private readonly budgets = new Map<string, PlanBudget>();
  private budget = createBudget();
  private planId: string | undefined;
  private readonly queued: QueuedRequest[] = [];
  private readonly automaticControllers = new Set<AbortController>();
  private active: QueuedRequest | null = null;
  private readonly now: () => number;
  private readonly itemTimeoutMs: number;
  private readonly wholeTimeoutMs: number;

  constructor(
    private readonly fetcher: AttractionDetailFetcher,
    options: {
      now?: () => number;
      itemTimeoutMs?: number;
      wholeTimeoutMs?: number;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.itemTimeoutMs = options.itemTimeoutMs ?? ITEM_TIMEOUT_MS;
    this.wholeTimeoutMs = options.wholeTimeoutMs ?? WHOLE_TIMEOUT_MS;
  }

  current(
    attraction: Pick<Attraction, "contentId" | "contentTypeId">,
  ): VisitInfoEntry {
    const cached = this.cache.get(visitInfoKey(attraction));
    if (!cached || cached.expiresAt <= this.now())
      return { status: "not-requested" };
    return cached;
  }

  usePlan(planId: string) {
    if (this.planId === planId) return;
    this.cancelAll();
    this.planId = planId;
    this.budget = this.budgets.get(planId) ?? createBudget();
    this.budgets.set(planId, this.budget);
  }

  cancelAll() {
    for (const controller of this.automaticControllers) controller.abort();
    for (const job of this.queued.splice(0)) {
      job.controller.abort();
      if (
        this.inFlight.get(visitInfoKey(job.attraction))?.identity ===
        job.identity
      )
        this.inFlight.delete(visitInfoKey(job.attraction));
      job.reject(new Error("cancelled"));
    }
    if (this.active) {
      const job = this.active;
      job.controller.abort();
      if (
        this.inFlight.get(visitInfoKey(job.attraction))?.identity ===
        job.identity
      )
        this.inFlight.delete(visitInfoKey(job.attraction));
    }
  }

  async request(
    attraction: Attraction,
    mode: "automatic" | "manual",
    parentSignal?: AbortSignal,
  ): Promise<VisitInfoEntry> {
    if (parentSignal?.aborted) throw new Error("cancelled");
    const key = visitInfoKey(attraction);
    const cached = this.current(attraction);
    if (cached.status === "ready" || cached.status === "partial") return cached;
    const shared = this.inFlight.get(key);
    if (shared) return shared.promise;

    const previousFailure = this.budget.failures.get(key);
    if (
      previousFailure &&
      this.now() - previousFailure.failedAt < RETRY_COOLDOWN_MS
    )
      throw new Error("cooldown");
    this.checkBudget(key, mode, this.budget);
    const controller = new AbortController();
    const abortForParent = () => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener("abort", abortForParent, { once: true });
    const identity = Symbol(key);
    let resolve!: (entry: VisitInfoEntry) => void;
    let reject!: (error: Error) => void;
    const cancelQueued = () => {
      const index = this.queued.findIndex(
        (queued) => queued.identity === identity,
      );
      if (index < 0) return;
      this.queued.splice(index, 1);
      if (this.inFlight.get(key)?.identity === identity)
        this.inFlight.delete(key);
      reject(
        new Error(
          controller.signal.reason instanceof Error &&
            controller.signal.reason.message === "timeout"
            ? "timeout"
            : "cancelled",
        ),
      );
    };
    // An abort-ignoring transport must keep its concurrency slot, but must not
    // leave later callers loading forever. Expired reservations never fetch.
    const queueTimeout = setTimeout(
      () => controller.abort(new Error("timeout")),
      this.itemTimeoutMs,
    );
    const promise = new Promise<VisitInfoEntry>((done, failed) => {
      resolve = done;
      reject = failed;
    }).finally(() => {
      clearTimeout(queueTimeout);
      parentSignal?.removeEventListener("abort", abortForParent);
      controller.signal.removeEventListener("abort", cancelQueued);
    });
    controller.signal.addEventListener("abort", cancelQueued, { once: true });
    const job: QueuedRequest = {
      attraction,
      mode,
      controller,
      identity,
      promise,
      resolve,
      reject,
      budget: this.budget,
      queueTimeout,
    };
    this.inFlight.set(key, job);
    this.queued.push(job);
    this.runNext();
    return promise;
  }

  private checkBudget(
    key: string,
    mode: "automatic" | "manual",
    budget: PlanBudget,
  ) {
    if (mode === "manual") {
      if ((budget.manual.get(key) ?? 0) >= 2) throw new Error("limit");
    } else {
      if (
        budget.automatic.has(key) ||
        budget.automatic.size >= MAX_AUTOMATIC_ITEMS
      )
        throw new Error("automatic-limit");
      if (
        budget.automaticStartedAt !== undefined &&
        this.now() - budget.automaticStartedAt >= this.wholeTimeoutMs
      )
        throw new Error("timeout");
    }
  }

  private runNext() {
    if (this.active) return;
    const job = this.queued.shift();
    if (!job) return;
    clearTimeout(job.queueTimeout);
    if (job.controller.signal.aborted) {
      const key = visitInfoKey(job.attraction);
      if (this.inFlight.get(key)?.identity === job.identity)
        this.inFlight.delete(key);
      job.reject(new Error("cancelled"));
      this.runNext();
      return;
    }
    this.active = job;
    const key = visitInfoKey(job.attraction);
    try {
      this.checkBudget(key, job.mode, job.budget);
    } catch (error) {
      this.inFlight.delete(key);
      this.active = null;
      job.reject(error as Error);
      this.runNext();
      return;
    }
    if (job.mode === "manual")
      job.budget.manual.set(key, (job.budget.manual.get(key) ?? 0) + 1);
    else {
      job.budget.automatic.add(key);
      job.budget.automaticStartedAt ??= this.now();
    }
    let timedOut = false;
    const onAbort = () => {
      timedOut ||=
        job.controller.signal.reason instanceof Error &&
        job.controller.signal.reason.message === "timeout";
      if (this.inFlight.get(key)?.identity === job.identity)
        this.inFlight.delete(key);
      if (timedOut) job.budget.failures.set(key, { failedAt: this.now() });
      job.reject(new Error(timedOut ? "timeout" : "cancelled"));
    };
    job.controller.signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      job.controller.abort();
    }, this.itemTimeoutMs);
    void this.fetcher(job.attraction, job.controller.signal)
      .then((response) => {
        if (
          job.controller.signal.aborted ||
          this.inFlight.get(key)?.identity !== job.identity
        )
          return;
        const entry: CacheEntry = {
          status: response.kind === "success" ? "ready" : "partial",
          detail: response.detail,
          fetchedAt: response.detail.fetchedAt,
          expiresAt:
            this.now() +
            (response.kind === "success" ? NORMAL_CACHE_MS : PARTIAL_CACHE_MS),
        };
        this.cache.set(key, entry);
        job.budget.failures.delete(key);
        job.resolve(entry);
      })
      .catch(() => {
        if (
          job.controller.signal.aborted ||
          this.inFlight.get(key)?.identity !== job.identity
        )
          return;
        job.budget.failures.set(key, { failedAt: this.now() });
        job.reject(new Error("unavailable"));
      })
      .finally(() => {
        clearTimeout(timeout);
        job.controller.signal.removeEventListener("abort", onAbort);
        if (this.inFlight.get(key)?.identity === job.identity)
          this.inFlight.delete(key);
        if (this.active?.identity === job.identity) this.active = null;
        this.runNext();
      });
  }

  async automatically(
    attractions: Attraction[],
    parentSignal?: AbortSignal,
    onChange?: (attraction: Attraction, entry: VisitInfoEntry) => void,
  ) {
    const controller = new AbortController();
    if (parentSignal?.aborted) return;
    this.budget.automaticStartedAt ??= this.now();
    this.automaticControllers.add(controller);
    let wholeTimedOut = false;
    const stop = () => controller.abort();
    parentSignal?.addEventListener("abort", stop, { once: true });
    const timeout = setTimeout(
      () => {
        wholeTimedOut = true;
        controller.abort(new Error("timeout"));
      },
      Math.max(
        0,
        this.wholeTimeoutMs -
          (this.budget.automaticStartedAt === undefined
            ? 0
            : this.now() - this.budget.automaticStartedAt),
      ),
    );
    const unique = Array.from(
      new Map(
        attractions.map((attraction) => [visitInfoKey(attraction), attraction]),
      ).values(),
    ).slice(0, MAX_AUTOMATIC_ITEMS);
    try {
      for (const attraction of unique) {
        if (controller.signal.aborted) break;
        if (this.current(attraction).status !== "not-requested") {
          onChange?.(attraction, this.current(attraction));
          continue;
        }
        if (
          this.budget.automaticStartedAt !== undefined &&
          this.now() - this.budget.automaticStartedAt >= this.wholeTimeoutMs
        )
          break;
        if (this.budget.automatic.has(visitInfoKey(attraction))) continue;
        if (this.budget.automatic.size >= MAX_AUTOMATIC_ITEMS) break;
        onChange?.(attraction, { status: "loading" });
        try {
          const entry = await this.request(
            attraction,
            "automatic",
            controller.signal,
          );
          if (!controller.signal.aborted) onChange?.(attraction, entry);
        } catch (error) {
          if (!controller.signal.aborted || wholeTimedOut)
            onChange?.(
              attraction,
              wholeTimedOut &&
                !this.budget.automatic.has(visitInfoKey(attraction))
                ? { status: "not-requested" }
                : visitInfoFailure(
                    wholeTimedOut ? new Error("timeout") : error,
                  ),
            );
          if (controller.signal.aborted) break;
        }
      }
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", stop);
      this.automaticControllers.delete(controller);
    }
  }
}

const SIMPLE_WEEKLY_CLOSED =
  /^매주\s*(월요일|화요일|수요일|목요일|금요일|토요일|일요일)(?:\s*휴무)?$/;
const WEEKDAY = [
  "일요일",
  "월요일",
  "화요일",
  "수요일",
  "목요일",
  "금요일",
  "토요일",
];

export function holidayWarningForVisit(
  closedDays: string,
  visitAt: string,
): boolean {
  const match = SIMPLE_WEEKLY_CLOSED.exec(
    closedDays.trim().replace(/\s+/g, " "),
  );
  const date = visitAt.slice(0, 10);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T12:00:00+09:00`);
  return (
    !Number.isNaN(value.getTime()) && match[1] === WEEKDAY[value.getUTCDay()]
  );
}

export function overviewPreview(overview: string): string {
  return overview.length > 160 ? `${overview.slice(0, 160)}…` : overview;
}

const MAP_SEARCH_ORIGIN = "https://www.google.com/maps/search/";
export function buildMapSearchUrl(address: string, title: string): string {
  const url = new URL(MAP_SEARCH_ORIGIN);
  url.searchParams.set("api", "1");
  url.searchParams.set("query", address || title);
  return url.toString();
}
