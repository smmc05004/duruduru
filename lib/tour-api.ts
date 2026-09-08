/** Server helper. Only Route Handlers / server data modules may import this file. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type TourPage = {
  items: Record<string, unknown>[];
  totalCount: number | null;
};

export async function requestTourApi(
  endpoint: "areaBasedList2" | "detailCommon2" | "detailIntro2",
  parameters: Record<string, string>,
  signal?: AbortSignal,
): Promise<TourPage> {
  const configured = process.env.TOUR_API_SERVICE_KEY;
  if (!configured) throw new Error("TOUR_API_UNAVAILABLE");
  let key = configured;
  try {
    key = decodeURIComponent(configured);
  } catch {
    /* Accept an already decoded key. */
  }
  const url = new URL(
    `https://apis.data.go.kr/B551011/KorService2/${endpoint}`,
  );
  url.search = new URLSearchParams({
    ...parameters,
    serviceKey: key,
    MobileOS: "ETC",
    MobileApp: "DURUDURU_MVP",
    _type: "json",
  }).toString();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error();
    const payload: unknown = await response.json();
    const envelope = asRecord(asRecord(payload).response);
    if (asRecord(envelope.header).resultCode !== "0000") throw new Error();
    const body = asRecord(envelope.body);
    if (Object.keys(body).length === 0) throw new Error();
    const raw = asRecord(body.items).item;
    const items = (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .map(asRecord)
      .filter((item) => Object.keys(item).length > 0);
    const count =
      typeof body.totalCount === "number" || typeof body.totalCount === "string"
        ? Number(body.totalCount)
        : NaN;
    return {
      items,
      totalCount: Number.isFinite(count) && count >= 0 ? count : null,
    };
  } catch {
    // Never propagate an upstream body, URL, service key or transport exception.
    throw new Error("TOUR_API_UNAVAILABLE");
  }
}
