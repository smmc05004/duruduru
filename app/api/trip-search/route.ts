import axios from "axios";
import { NextResponse } from "next/server";
import {
  buildItinerary,
  destinationRegions,
  lookupOneWayMinutes,
} from "@/lib/mvp-trip-planner";
import type {
  PlannerPlace,
  SearchRequest,
  SearchResponse,
} from "@/lib/trip-planner-contract";

export const dynamic = "force-dynamic";

const TOUR_BASE_URL = "https://apis.data.go.kr/B551011/KorService2";

type TourItem = Record<string, string | undefined>;

function list(value: unknown): TourItem[] {
  if (Array.isArray(value)) return value as TourItem[];
  return value ? [value as TourItem] : [];
}

function clean(value: string | undefined) {
  return (
    value
      ?.replace(/<[^>]*>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim() ?? ""
  );
}

function normalizedKey() {
  const value = process.env.TOUR_API_SERVICE_KEY;
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function tourRequest(
  endpoint: string,
  parameters: Record<string, string>,
) {
  const key = normalizedKey();
  if (!key) throw new Error("TOUR_API_SERVICE_KEY가 설정되지 않았습니다.");
  const response = await axios.get(`${TOUR_BASE_URL}/${endpoint}`, {
    params: {
      serviceKey: key,
      MobileOS: "ETC",
      MobileApp: "DURUDURU_MVP",
      _type: "json",
      numOfRows: "30",
      pageNo: "1",
      ...parameters,
    },
    timeout: 12_000,
  });
  const payload = response.data;
  const header = payload?.response?.header;
  if (header?.resultCode !== "0000") {
    throw new Error(header?.resultMsg ?? "TourAPI 응답을 확인할 수 없습니다.");
  }
  return list(payload?.response?.body?.items?.item);
}

function interestTags(item: TourItem) {
  const category = item.cat2 ?? "";
  if (category.startsWith("A0201")) return ["역사"];
  if (category.startsWith("A0202")) return ["자연"];
  if (category.startsWith("A0206") || item.contenttypeid === "14")
    return ["문화"];
  return [];
}

function canServeAt(raw: string, targetHour: number) {
  const time = clean(raw);
  const matches = [...time.matchAll(/(\d{1,2})\s*[:시]\s*(\d{2})?/gu)];
  if (matches.length < 2) return false;
  for (let index = 0; index + 1 < matches.length; index += 2) {
    const opens =
      Number(matches[index][1]) * 60 + Number(matches[index][2] ?? 0);
    const closes =
      Number(matches[index + 1][1]) * 60 + Number(matches[index + 1][2] ?? 0);
    const target = targetHour * 60 + 30;
    if (opens <= target && closes >= target + 60) return true;
  }
  return false;
}

async function legalCodes() {
  return tourRequest("ldongCode2", { lDongListYn: "Y", numOfRows: "1000" });
}

async function searchRegion(
  request: SearchRequest,
  region: (typeof destinationRegions)[number],
  codes: TourItem[],
  collectedAt: string,
) {
  const signguName = region.legalName.split(" ").at(-1) ?? region.name;
  const code = codes.find((item) => item.lDongSignguNm === signguName);
  const oneWayMinutes = lookupOneWayMinutes(request.originId, region.id);
  if (!code || !oneWayMinutes) return null;

  const availableMinutes =
    new Date(`${request.returnBy}:00+09:00`).getTime() -
    new Date(`${request.startAt}:00+09:00`).getTime() -
    oneWayMinutes * 2 * 60_000;
  if (availableMinutes < 8 * 60 * 60_000) return null;

  const area = {
    lDongRegnCd: code.lDongRegnCd ?? "",
    lDongSignguCd: code.lDongSignguCd ?? "",
  };
  const [touristSpots, culturalSites] = await Promise.all([
    tourRequest("areaBasedList2", { ...area, contentTypeId: "12" }),
    tourRequest("areaBasedList2", { ...area, contentTypeId: "14" }),
  ]);
  const attractions: PlannerPlace[] = [...touristSpots, ...culturalSites]
    .map((item) => ({
      id: `tourapi:attraction:${item.contentid ?? item.title}`,
      name: clean(item.title),
      category: "관광" as const,
      tags: interestTags(item),
    }))
    .filter(
      (item) =>
        item.name && item.tags.some((tag) => request.interests.includes(tag)),
    );
  const uniqueAttractions = attractions.filter(
    (item, index, items) =>
      items.findIndex((other) => other.name === item.name) === index,
  );
  if (uniqueAttractions.length < 3) return null;

  // 관광지 조건을 통과한 지역에서만 음식점을 조회한다.
  const restaurants = await tourRequest("areaBasedList2", {
    ...area,
    contentTypeId: "39",
  });
  const details = await Promise.all(
    restaurants.slice(0, 30).map(async (restaurant) => {
      const contentId = restaurant.contentid;
      if (!contentId) return null;
      const [intro] = await tourRequest("detailIntro2", {
        contentId,
        contentTypeId: "39",
      });
      const menu =
        clean(intro.firstmenu) ||
        clean(intro.treatmenu) ||
        clean(intro.treatmenufood);
      const hours = clean(intro.opentimefood);
      if (!menu || !hours) return null;
      return {
        id: `tourapi:restaurant:${contentId}`,
        name: clean(restaurant.title),
        category: "점심" as const,
        tags: ["미식"],
        menu,
        hours,
      };
    }),
  );
  const usable = details.filter((item): item is NonNullable<typeof item> =>
    Boolean(item?.name),
  );
  const lunchSource = usable.find((item) => canServeAt(item.hours, 11));
  const dinnerSource = usable.find((item) => canServeAt(item.hours, 17));
  if (!lunchSource || !dinnerSource) return null;
  const lunch: PlannerPlace = { ...lunchSource, category: "점심" };
  const dinner: PlannerPlace = { ...dinnerSource, category: "저녁" };
  const itinerary = buildItinerary(
    request,
    oneWayMinutes,
    uniqueAttractions,
    lunch,
    dinner,
  );
  if (!itinerary) return null;
  return {
    id: region.id,
    name: region.name,
    region: region.province,
    oneWayMinutes,
    localMinutes: Math.floor(availableMinutes / 60_000),
    matchedInterests: request.interests,
    attractions: uniqueAttractions,
    lunch,
    dinner,
    itinerary,
    collectedAt,
  };
}

function validRequest(value: unknown): value is SearchRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<SearchRequest>;
  return (
    typeof input.originId === "string" &&
    typeof input.startAt === "string" &&
    typeof input.returnBy === "string" &&
    input.transport === "car" &&
    Array.isArray(input.interests) &&
    input.interests.length > 0
  );
}

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  if (!validRequest(payload)) {
    return NextResponse.json<SearchResponse>(
      { kind: "data-error", message: "입력 조건을 다시 확인해 주세요." },
      { status: 400 },
    );
  }
  const collectedAt = new Date().toISOString();
  try {
    const codes = await legalCodes();
    const candidates = (
      await Promise.all(
        destinationRegions.map((region) =>
          searchRegion(payload, region, codes, collectedAt),
        ),
      )
    )
      .filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          candidate !== null,
      )
      .sort(
        (left, right) =>
          right.matchedInterests.length - left.matchedInterests.length ||
          left.oneWayMinutes - right.oneWayMinutes,
      )
      .slice(0, 5);
    if (!candidates.length) {
      return NextResponse.json<SearchResponse>({
        kind: "no-results",
        message:
          "현재 조건과 최신 관광·음식점 정보로는 점심과 저녁을 포함한 계획을 만들 수 있는 지역을 찾지 못했어요.",
      });
    }
    return NextResponse.json<SearchResponse>({
      kind: "success",
      candidates,
      collectedAt,
      travelTimeSource: "한국교통연구원 국가교통DB(KTDB) 2024 도로 네트워크",
    });
  } catch {
    return NextResponse.json<SearchResponse>(
      {
        kind: "data-error",
        message:
          "최신 관광 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
      },
      { status: 502 },
    );
  }
}
