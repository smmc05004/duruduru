import { NextResponse } from "next/server";
import { regionMappingFor } from "@/lib/mvp-core";
import { prioritizeRestaurants } from "@/lib/restaurant-selection";

export const dynamic = "force-dynamic";
const base = "https://apis.data.go.kr/B551011/KorService2/areaBasedList2";
function key() {
  const value = process.env.TOUR_API_SERVICE_KEY;
  if (!value) throw new Error("TourAPI 키가 없습니다.");
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
export async function GET(
  _: Request,
  context: RouteContext<"/api/destinations/[regionId]/restaurants">,
) {
  const { regionId } = await context.params;
  const mapping = regionMappingFor(regionId);
  if (!mapping)
    return NextResponse.json(
      { kind: "not-found", message: "지원하지 않는 지역이에요." },
      { status: 404 },
    );
  try {
    const url = new URL(base);
    url.search = new URLSearchParams({
      serviceKey: key(),
      MobileOS: "ETC",
      MobileApp: "DURUDURU_MVP",
      _type: "json",
      numOfRows: "100",
      pageNo: "1",
      contentTypeId: "39",
      lDongRegnCd: mapping.lDongRegnCd,
      lDongSignguCd: mapping.lDongSignguCd,
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    const payload = await response.json();
    if (!response.ok || payload?.response?.header?.resultCode !== "0000")
      throw new Error("TourAPI 음식점 목록 오류");
    const items = payload?.response?.body?.items?.item ?? [];
    return NextResponse.json({
      kind: "success",
      restaurants: prioritizeRestaurants(
        regionId,
        Array.isArray(items) ? items : [items],
      ),
    });
  } catch {
    return NextResponse.json(
      {
        kind: "data-error",
        message: "음식점 목록을 불러오지 못했어요. 다시 시도해 주세요.",
      },
      { status: 502 },
    );
  }
}
