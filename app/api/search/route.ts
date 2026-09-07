import { NextResponse } from "next/server";
import {
  searchCandidates,
  validOneNight,
  type SearchInput,
} from "@/lib/mvp-core";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const input = (await request.json().catch(() => null)) as SearchInput | null;
  if (!input || !validOneNight(input))
    return NextResponse.json(
      {
        kind: "input-error",
        message: "출발지, 1박 2일 일정과 관심사를 입력해 주세요.",
      },
      { status: 400 },
    );
  const candidates = searchCandidates(input);
  return NextResponse.json(
    candidates.length
      ? { kind: "success", candidates, profileGeneratedAt: "2026-09-07" }
      : { kind: "no-results", message: "조건에 맞는 지역을 찾지 못했어요." },
  );
}
