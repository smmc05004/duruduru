import type { DetailTextField } from "@/lib/restaurant-detail";

export type NormalizedAttractionDetail = {
  title: DetailTextField;
  address: DetailTextField;
  overview: DetailTextField;
  openingHours: DetailTextField;
  closedDays: DetailTextField;
  fees: DetailTextField;
  phone: DetailTextField;
  imageUrl: string;
  /** Present only when the response confirms an approved Type1 TourAPI image. */
  image?: {
    license: "Type1";
    source: "한국관광공사 TourAPI";
    sourceUrl: "https://www.data.go.kr/data/15101578/openapi.do";
    fetchedAt: string;
  };
  fetchedAt: string;
};

export function safeDetailText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .slice(0, 30_000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const missing = /^(?:[-–—.]+|없음|정보\s*없음|미정|none|n\/a)$/i;
function field(...values: unknown[]): DetailTextField {
  const value = values
    .map(safeDetailText)
    .find((text) => text && !missing.test(text));
  return value ? { status: "confirmed", value } : { status: "unknown" };
}

/** The existing profile has no per-image license, so it is never used as a photo fallback. */
export function licensedTourImage(item: Record<string, unknown>): string {
  if (item.cpyrhtDivCd !== "Type1") return "";
  const value = typeof item.firstimage === "string" ? item.firstimage : "";
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.hostname !== "tong.visitkorea.or.kr"
    )
      return "";
    url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

export function normalizeAttractionDetail(
  common: Record<string, unknown>,
  intro: Record<string, unknown>,
  fallback: { title: string; address: string },
  fetchedAt: string,
): NormalizedAttractionDetail {
  const imageUrl = licensedTourImage(common);
  return {
    title: field(common.title, fallback.title),
    address: field(
      [safeDetailText(common.addr1), safeDetailText(common.addr2)]
        .filter(Boolean)
        .join(" "),
      fallback.address,
    ),
    overview: field(common.overview),
    openingHours: field(
      intro.usetime,
      intro.usetimeculture,
      intro.usetimeleports,
    ),
    closedDays: field(
      intro.restdate,
      intro.restdateculture,
      intro.restdateleports,
    ),
    fees: field(intro.usefee, intro.usefeeculture, intro.usefeeleports),
    phone: field(
      common.tel,
      intro.infocenter,
      intro.infocenterculture,
      intro.infocenterleports,
    ),
    imageUrl,
    image: imageUrl
      ? {
          license: "Type1",
          source: "한국관광공사 TourAPI",
          sourceUrl: "https://www.data.go.kr/data/15101578/openapi.do",
          fetchedAt,
        }
      : undefined,
    fetchedAt,
  };
}
