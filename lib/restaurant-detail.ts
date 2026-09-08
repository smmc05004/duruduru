/*
 * TourAPI KorService2 `detailIntro2`(콘텐츠유형 39 · 음식점) 응답을 화면 표시용으로
 * 정규화하는 순수 함수. docs/product/API_FETCH_FLOW.md 4단계와
 * docs/design/DESIGN_TOKENS.md 「음식점 상세 시트」에 대응한다.
 *
 * 규칙:
 * - 결측·빈 문자열·`"-"` 같은 자리표시 값은 지어내지 않고 "확인 필요"(unknown) 상태로 표현한다.
 * - 결측은 후보(음식점) 제외 사유가 아니다. 시트는 확인용이며 일정 시간표를 바꾸지 않는다.
 * - 평점·리뷰·랭킹은 다루지 않는다.
 */

/** `detailIntro2` 응답에서 이 화면이 읽는 필드. 모두 선택적이며 문자열이 아닐 수 있다. */
export type RawRestaurantDetail = {
  opentimefood?: unknown;
  restdatefood?: unknown;
  firstmenu?: unknown;
  treatmenu?: unknown;
};

/** 정규화한 단일 텍스트 필드. 값이 있으면 confirmed, 없으면 unknown(확인 필요). */
export type DetailTextField =
  { status: "confirmed"; value: string } | { status: "unknown" };

/** 정규화한 대표 메뉴 목록. firstmenu·treatmenu를 합쳐 중복을 제거한다. */
export type DetailMenuField =
  { status: "confirmed"; items: string[] } | { status: "unknown" };

export type NormalizedRestaurantDetail = {
  openingHours: DetailTextField;
  closedDays: DetailTextField;
  menus: DetailMenuField;
};

/** 실제 정보가 없다고 보는 자리표시 값(소문자 비교). */
const PLACEHOLDER_VALUES = new Set([
  "",
  "-",
  "--",
  "---",
  "―",
  "·",
  ".",
  "none",
  "n/a",
  "없음",
  "정보없음",
  "정보 없음",
  "없습니다",
  "미정",
]);

const MENU_SEPARATORS = /[\n,/·|]+/;

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

/** `<br>`는 줄바꿈으로, 그 밖의 태그·엔티티는 제거·치환하고 공백을 정리한다. */
function cleanText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_VALUES.has(value.toLowerCase());
}

function normalizeTextField(raw: string): DetailTextField {
  const cleaned = cleanText(raw);
  if (cleaned.length === 0 || isPlaceholder(cleaned))
    return { status: "unknown" };
  return { status: "confirmed", value: cleaned };
}

function normalizeMenus(firstMenu: string, treatMenu: string): DetailMenuField {
  const items: string[] = [];
  for (const raw of [firstMenu, treatMenu]) {
    const cleaned = cleanText(raw);
    if (cleaned.length === 0) continue;
    for (const part of cleaned.split(MENU_SEPARATORS)) {
      const item = part.trim();
      if (item.length === 0 || isPlaceholder(item)) continue;
      if (!items.includes(item)) items.push(item);
    }
  }
  if (items.length === 0) return { status: "unknown" };
  return { status: "confirmed", items };
}

/**
 * `detailIntro2` item 하나를 정규화한다. 배열·객체·null 어떤 형태의 원본이 와도
 * 안전하게 처리하고, 알 수 없는 값은 unknown으로 남긴다.
 */
export function normalizeRestaurantDetail(
  raw: unknown,
): NormalizedRestaurantDetail {
  const item = Array.isArray(raw) ? raw[0] : raw;
  const source: Record<string, unknown> =
    item !== null && typeof item === "object"
      ? (item as Record<string, unknown>)
      : {};
  return {
    openingHours: normalizeTextField(readString(source, "opentimefood")),
    closedDays: normalizeTextField(readString(source, "restdatefood")),
    menus: normalizeMenus(
      readString(source, "firstmenu"),
      readString(source, "treatmenu"),
    ),
  };
}
