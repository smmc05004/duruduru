import { NextResponse } from "next/server";
import { normalizeRestaurantDetail } from "@/lib/restaurant-detail";
import { requestTourApi } from "@/lib/tour-api";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: RouteContext<"/api/restaurants/[contentId]">,
) {
  const { contentId } = await context.params;
  if (!/^\d{1,12}$/.test(contentId))
    return NextResponse.json(
      { kind: "input-error", message: "음식점 정보를 확인해 주세요." },
      { status: 400 },
    );
  try {
    const payload = await requestTourApi(
      "detailIntro2",
      {
        contentId,
        contentTypeId: "39",
      },
      request.signal,
    );
    if (!payload.items.length) throw new Error();
    // 원시 item(객체·배열·null)을 그대로 넘기지 않고 표시용으로 정규화한다.
    // docs/design/DESIGN_TOKENS.md 「음식점 상세 시트」. 결측 필드는 "확인 필요"로 남기며
    // 상세 실패(아래 catch)만 kind:"data-error" 502로 구분한다.
    return NextResponse.json({
      kind: "success",
      detail: normalizeRestaurantDetail(payload.items),
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
