import { NextResponse } from "next/server";
import { validateSearchInput } from "@/lib/mvp-phase-two-planner";
import { searchPhaseTwo } from "@/lib/mvp-phase-two-search";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const validated = validateSearchInput(await request.json().catch(() => null));
  if (!validated.ok)
    return NextResponse.json(
      {
        kind: "input-error",
        message: validated.reason,
      },
      { status: 400 },
    );
  const result = searchPhaseTwo(validated.input, crypto.randomUUID());
  return NextResponse.json(result, {
    status: result.kind === "data-error" ? 503 : 200,
  });
}
