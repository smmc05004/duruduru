/**
 * T6 통합 검증 — 검색 경로의 외부 원천 호출 0회 (기획 수용 기준 6).
 *
 * "브라우저 내부 API 1회만 보였으니 원천 호출 0"이라고 단정하지 않는다. 여기서는
 * (1) 전역 `fetch`를 감시·실패시키고도 `searchPhaseTwo`가 정상 동작하는지,
 * (2) 검색 진입점이 실제로 의존하는 모듈 그래프에 관광 목록·중심·음식점·상세
 *     원천 클라이언트가 없는지를 함께 본다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { searchPhaseTwo } from "@/lib/mvp-phase-two-search";
import type { MvpCategoryId } from "@/lib/mvp-region-data";

const CASES: Array<{ originId: string; interests: MvpCategoryId[] }> = [
  { originId: "seoul", interests: ["history"] },
  { originId: "busan", interests: ["nature", "culture"] },
  { originId: "ktdb-zone-122", interests: ["leisure"] },
  { originId: "ktdb-zone-78", interests: ["rest"] },
];

describe("검색 경로 외부 호출 0회", () => {
  const realFetch = globalThis.fetch;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      throw new Error("네트워크 호출 금지 (T6 검색 경로 검증)");
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("fetch를 실패시켜도 모든 매트릭스 입력에서 추천이 나온다", () => {
    for (const testCase of CASES) {
      const result = searchPhaseTwo(
        {
          originId: testCase.originId,
          startAt: "2026-09-12T08:00",
          returnBy: "2026-09-13T20:00",
          transport: "car",
          interests: testCase.interests,
        },
        "t6-no-network",
        "2026-09-10T00:00:00.000Z",
      );
      expect(result.kind).toBe("success");
      if (result.kind === "success")
        expect(result.candidates.length).toBeGreaterThan(0);
    }
    expect(calls).toEqual([]);
  });

  it("검색 진입 파일들은 원천 클라이언트(tour-api/restaurants route/axios)를 import 하지 않는다", () => {
    const searchGraph = [
      "lib/mvp-phase-two-search.ts",
      "lib/mvp-phase-two-planner.ts",
      "lib/mvp-phase-two-regions.ts",
      "lib/tourism-evidence.ts",
      "lib/interest-classification.ts",
      "lib/origin-regions.ts",
      "lib/mvp-phase-two-types.ts",
      "lib/mvp-region-data.ts",
      "app/api/search/route.ts",
    ];
    const forbidden = [
      /from ["']@\/lib\/tour-api["']/,
      /from ["']axios["']/,
      /apis\.data\.go\.kr/,
      /restaurants\/route/,
      /detailIntro2/,
    ];
    for (const relativePath of searchGraph) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      for (const pattern of forbidden)
        expect({ relativePath, match: pattern.test(source) }).toEqual({
          relativePath,
          match: false,
        });
      // JSON import 또는 순수 로직만 참조한다.
      expect(/\bfetch\s*\(/.test(source)).toBe(false);
    }
  });
});
