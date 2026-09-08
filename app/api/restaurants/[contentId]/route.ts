import { NextResponse } from "next/server";
import { normalizeRestaurantDetail } from "@/lib/restaurant-detail";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  context: RouteContext<"/api/restaurants/[contentId]">,
) {
  const { contentId } = await context.params;
  const value = process.env.TOUR_API_SERVICE_KEY;
  if (!value)
    return NextResponse.json(
      { kind: "data-error", message: "음식점 상세 정보를 불러오지 못했어요." },
      { status: 502 },
    );
  try {
    const key = decodeURIComponent(value);
    const url = new URL(
      "https://apis.data.go.kr/B551011/KorService2/detailIntro2",
    );
    url.search = new URLSearchParams({
      serviceKey: key,
      MobileOS: "ETC",
      MobileApp: "DURUDURU_MVP",
      _type: "json",
      contentId,
      contentTypeId: "39",
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    const payload = await response.json();
    if (!response.ok || payload?.response?.header?.resultCode !== "0000")
      throw new Error();
    // 원시 item(객체·배열·null)을 그대로 넘기지 않고 표시용으로 정규화한다.
    // docs/design/DESIGN_TOKENS.md 「음식점 상세 시트」. 결측 필드는 "확인 필요"로 남기며
    // 상세 실패(아래 catch)만 kind:"data-error" 502로 구분한다.
    return NextResponse.json({
      kind: "success",
      detail: normalizeRestaurantDetail(payload?.response?.body?.items?.item),
    });
  } catch {
    return NextResponse.json(
      {
        kind: "data-error",
        message: "음식점 상세 정보를 불러오지 못했어요. 다시 시도해 주세요.",
      },
      { status: 502 },
    );
  }
}
