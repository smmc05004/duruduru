import { NextResponse } from "next/server";
import profiles from "@/data/region-profiles.json";
import { normalizeAttractionDetail } from "@/lib/attraction-detail";
import { requestTourApi } from "@/lib/tour-api";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
) {
  const { contentId } = await context.params;
  const contentTypeId = new URL(request.url).searchParams.get("contentTypeId");
  if (
    !/^\d{1,12}$/.test(contentId) ||
    !contentTypeId ||
    !["12", "14", "28"].includes(contentTypeId)
  ) {
    return NextResponse.json(
      { kind: "input-error", message: "관광 장소 정보를 확인해 주세요." },
      { status: 400 },
    );
  }
  const attraction = profiles.profiles
    .flatMap((profile) => profile.attractions)
    .find(
      (item) =>
        item.contentId === contentId && item.contentTypeId === contentTypeId,
    );
  if (!attraction)
    return NextResponse.json(
      {
        kind: "input-error",
        message: "지원하는 관광 장소 정보를 찾지 못했어요.",
      },
      { status: 404 },
    );
  const [common, intro] = await Promise.allSettled([
    // Common detail accepts contentId; type is validated above and sent to intro.
    requestTourApi("detailCommon2", { contentId }, request.signal),
    requestTourApi(
      "detailIntro2",
      { contentId, contentTypeId },
      request.signal,
    ),
  ]);
  const commonItem =
    common.status === "fulfilled" ? common.value.items[0] : undefined;
  const introItem =
    intro.status === "fulfilled" ? intro.value.items[0] : undefined;
  if (!commonItem && !introItem)
    return NextResponse.json(
      {
        kind: "data-error",
        message: "관광지 상세 정보를 불러오지 못했어요. 다시 시도해 주세요.",
      },
      { status: 502 },
    );
  return NextResponse.json({
    kind: commonItem && introItem ? "success" : "partial",
    detail: normalizeAttractionDetail(
      commonItem ?? {},
      introItem ?? {},
      attraction,
      new Date().toISOString(),
    ),
  });
}
