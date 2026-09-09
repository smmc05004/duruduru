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
};
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
};

/**
 * Client-memory coordinator. It deliberately queues plan items one at a time:
 * the Route Handler performs only detailCommon2 + detailIntro2 in parallel, so
 * this preserves the E3 upstream concurrency cap of two.
 */
export class AttractionVisitInfoCoordinator {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlight>();
  private readonly failures = new Map<string, { failedAt: number }>();
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
    const key = visitInfoKey(attraction);
    const cached = this.current(attraction);
    if (cached.status === "ready" || cached.status === "partial") return cached;
    const shared = this.inFlight.get(key);
    if (shared) return shared.promise;

    const previousFailure = this.failures.get(key);
    if (
      previousFailure &&
      this.now() - previousFailure.failedAt < RETRY_COOLDOWN_MS
    )
      throw new Error("cooldown");
    const controller = new AbortController();
    const abortForParent = () => controller.abort();
    parentSignal?.addEventListener("abort", abortForParent, { once: true });
    const identity = Symbol(key);
    let resolve!: (entry: VisitInfoEntry) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<VisitInfoEntry>((done, failed) => {
      resolve = done;
      reject = failed;
    }).finally(() =>
      parentSignal?.removeEventListener("abort", abortForParent),
    );
    const job: QueuedRequest = {
      attraction,
      mode,
      controller,
      identity,
      promise,
      resolve,
      reject,
    };
    this.inFlight.set(key, job);
    this.queued.push(job);
    this.runNext();
    return promise;
  }

  private runNext() {
    if (this.active) return;
    const job = this.queued.shift();
    if (!job) return;
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
    const timeout = setTimeout(
      () => job.controller.abort(),
      this.itemTimeoutMs,
    );
    void this.fetcher(job.attraction, job.controller.signal)
      .then((response) => {
        const entry: CacheEntry = {
          status: response.kind === "success" ? "ready" : "partial",
          detail: response.detail,
          fetchedAt: response.detail.fetchedAt,
          expiresAt:
            this.now() +
            (response.kind === "success" ? NORMAL_CACHE_MS : PARTIAL_CACHE_MS),
        };
        this.cache.set(key, entry);
        this.failures.delete(key);
        job.resolve(entry);
      })
      .catch(() => {
        this.failures.set(key, { failedAt: this.now() });
        job.reject(new Error("unavailable"));
      })
      .finally(() => {
        clearTimeout(timeout);
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
    this.automaticControllers.add(controller);
    let wholeTimedOut = false;
    const stop = () => controller.abort();
    parentSignal?.addEventListener("abort", stop, { once: true });
    const timeout = setTimeout(() => {
      wholeTimedOut = true;
      controller.abort();
    }, this.wholeTimeoutMs);
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
        onChange?.(attraction, { status: "loading" });
        try {
          const entry = await this.request(
            attraction,
            "automatic",
            controller.signal,
          );
          onChange?.(attraction, entry);
        } catch {
          if (!controller.signal.aborted || wholeTimedOut)
            onChange?.(attraction, {
              status: "unavailable",
              message: "방문 정보를 불러오지 못했어요. 방문 전 확인해 주세요.",
            });
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
