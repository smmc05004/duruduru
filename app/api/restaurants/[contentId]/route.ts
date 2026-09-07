import { NextResponse } from "next/server";
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
    return NextResponse.json({
      kind: "success",
      detail: payload.response.body.items.item ?? null,
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
