import { NextResponse } from "next/server";
import {
  collectRestaurants,
  validateRestaurantRequest,
} from "@/lib/mvp-phase-two-restaurants";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: Request) {
  let input: unknown;
  try {
    if (Number(request.headers.get("content-length")) > 8192) throw new Error();
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    input = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return NextResponse.json(
      {
        kind: "input-error",
        message: "음식점을 조회할 여행 정보를 확인해 주세요.",
      },
      { status: 400 },
    );
  }
  const selection = validateRestaurantRequest(input);
  if (!selection)
    return NextResponse.json(
      {
        kind: "input-error",
        message: "선택한 목적지와 관광 장소를 확인해 주세요.",
      },
      { status: 400 },
    );
  try {
    const result = await collectRestaurants(selection, request.signal);
    return NextResponse.json(result, {
      status: result.kind === "data-error" ? 502 : 200,
    });
  } catch {
    return NextResponse.json(
      {
        kind: "data-error",
        message: "음식점 정보를 불러오지 못했어요. 다시 시도해 주세요.",
      },
      { status: 502 },
    );
  }
}
