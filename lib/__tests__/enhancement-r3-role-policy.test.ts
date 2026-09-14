/** @jest-environment node */
/**
 * R3 새 역할 정책 재현/안전 검증.
 *
 * 과거 R1/R2 비교 하네스는 `enhancement-r2-comparison.test.ts`에 고정하고,
 * 이 파일은 production `searchPhaseTwo`가 R3 확정 정책
 * (nearby/overnight/interestRich, e1-v4)을 따르는지만 별도로 본다.
 *
 * 덤프 재현:
 * `R3_OUT=/tmp/r3-role-policy-samples.json npx jest enhancement-r3-role-policy --runInBand`
 */
import fs from "node:fs";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { searchPhaseTwo } from "@/lib/mvp-phase-two-search";
import type { MvpCategoryId } from "@/lib/mvp-region-data";
import type { Candidate, SearchInput } from "@/lib/mvp-phase-two-types";

const DAY = {
  key: "day",
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
};
const NIGHT = {
  key: "night",
  startAt: "2026-09-12T18:00",
  returnBy: "2026-09-13T20:00",
};

const SAMPLE_CASES: Array<{
  key: string;
  input: SearchInput;
  expected: Array<[Candidate["recommendation"]["role"], string, number]>;
}> = [
  {
    key: "seoul-history-day",
    input: {
      originId: "seoul",
      startAt: DAY.startAt,
      returnBy: DAY.returnBy,
      transport: "car",
      interests: ["history"],
    },
    expected: [
      ["nearby", "고양", 30],
      ["overnight", "문경", 240],
      ["interestRich", "순창", 360],
    ],
  },
  {
    key: "seoul-history-night",
    input: {
      originId: "seoul",
      startAt: NIGHT.startAt,
      returnBy: NIGHT.returnBy,
      transport: "car",
      interests: ["history"],
    },
    expected: [
      ["nearby", "고양", 30],
      ["overnight", "문경", 240],
      ["interestRich", "청송", 358],
    ],
  },
  {
    key: "busan-culture-day",
    input: {
      originId: "busan",
      startAt: DAY.startAt,
      returnBy: DAY.returnBy,
      transport: "car",
      interests: ["culture"],
    },
    expected: [
      ["nearby", "김해", 48],
      ["overnight", "구례", 240],
      ["interestRich", "고창", 360],
    ],
  },
  {
    key: "busan-culture-night",
    input: {
      originId: "busan",
      startAt: NIGHT.startAt,
      returnBy: NIGHT.returnBy,
      transport: "car",
      interests: ["culture"],
    },
    expected: [
      ["nearby", "김해", 48],
      ["overnight", "구례", 240],
      ["interestRich", "고창", 360],
    ],
  },
];

const ORIGINS = [
  { key: "seoul", originId: "seoul" },
  { key: "busan", originId: "busan" },
  { key: "gangneung", originId: "ktdb-zone-122" },
  { key: "suwon-paldal", originId: "ktdb-zone-78" },
] as const;
const INTEREST_SETS: Array<{ key: string; interests: MvpCategoryId[] }> = [
  { key: "history", interests: ["history"] },
  { key: "nature", interests: ["nature"] },
  { key: "culture", interests: ["culture"] },
  { key: "leisure", interests: ["leisure"] },
  { key: "rest", interests: ["rest"] },
  { key: "history+culture", interests: ["history", "culture"] },
];
const TIMES = [DAY, NIGHT] as const;

function placedTitles(candidate: Candidate) {
  return candidate.preview.blocks.flatMap((block) =>
    block.kind === "attraction" ? [block.title] : [],
  );
}

function summarizeCandidate(candidate: Candidate) {
  const recommendation = candidate.recommendation!;
  return {
    role: recommendation.role,
    algorithmVersion: recommendation.algorithmVersion,
    itineraryAlgorithmVersion: candidate.itineraryAlgorithmVersion,
    displayName: candidate.displayName,
    groupId: candidate.groupId,
    oneWayMinutes: candidate.oneWayMinutes,
    roundTripMinutes: recommendation.roundTripMinutes,
    fitAverage: recommendation.purpose?.fitAverage ?? null,
    fitBand: recommendation.purpose?.fitBand ?? null,
    fitByInterest: recommendation.purpose?.fitByInterest ?? {},
    localFreeMinutes: recommendation.localFreeMinutes,
    attractionCount: recommendation.attractionCount,
    placedTitles: placedTitles(candidate),
  };
}

function run(input: SearchInput) {
  const result = searchPhaseTwo(
    input,
    "r3-role-policy",
    "2026-09-14T00:00:00.000Z",
  );
  expect(result.kind).toBe("success");
  if (result.kind !== "success") throw new Error(`search kind=${result.kind}`);
  return result;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("R3 역할 정책", () => {
  it("4개 확정 표본을 재현한다", () => {
    const dump = {
      generatedAt: new Date().toISOString(),
      note: "R3 production role policy sample; no API/fetch; separate from R1/R2 historical evidence",
      samples: SAMPLE_CASES.map((sample) => {
        const result = run(sample.input);
        const actual = result.candidates.map((candidate) => [
          candidate.recommendation!.role,
          candidate.displayName,
          candidate.recommendation!.roundTripMinutes,
        ]);
        expect(actual).toEqual(sample.expected);
        for (const candidate of result.candidates) {
          expect(candidate.recommendation!.algorithmVersion).toBe("e1-v4");
          expect(candidate.itineraryAlgorithmVersion).toBe("e2-v3");
        }
        return {
          key: sample.key,
          input: sample.input,
          candidates: result.candidates.map(summarizeCandidate),
        };
      }),
    };
    if (process.env.R3_OUT)
      fs.writeFileSync(process.env.R3_OUT, JSON.stringify(dump, null, 2));
  });

  it("검색 단계에서는 TourAPI/fetch를 호출하지 않는다", () => {
    const spy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("검색 단계 fetch 금지"));
    run(SAMPLE_CASES[0].input);
    expect(spy).not.toHaveBeenCalled();
  });

  it("48셀 현행 정책 결과를 한 번 집계한다", () => {
    const rows = [];
    for (const origin of ORIGINS) {
      for (const interestSet of INTEREST_SETS) {
        for (const time of TIMES) {
          const input: SearchInput = {
            originId: origin.originId,
            startAt: time.startAt,
            returnBy: time.returnBy,
            transport: "car",
            interests: interestSet.interests,
          };
          const result = searchPhaseTwo(
            input,
            `r3-${origin.key}-${interestSet.key}-${time.key}`,
            "2026-09-14T00:00:00.000Z",
          );
          expect(result.kind).toBe("success");
          if (result.kind !== "success") continue;
          rows.push({
            origin: origin.key,
            interests: interestSet.key,
            time: time.key,
            candidates: result.candidates.map(summarizeCandidate),
          });
          expect(result.candidates.length).toBeGreaterThanOrEqual(1);
          expect(result.candidates.length).toBeLessThanOrEqual(3);
          expect(new Set(result.candidates.map((c) => c.groupId)).size).toBe(
            result.candidates.length,
          );
          for (const candidate of result.candidates) {
            expect(candidate.recommendation!.algorithmVersion).toBe("e1-v4");
            expect(candidate.itineraryAlgorithmVersion).toBe("e2-v3");
            expect(
              candidate.preview.blocks.some((b) => b.kind === "attraction"),
            ).toBe(true);
          }
        }
      }
    }
    expect(rows).toHaveLength(48);
    if (process.env.R3_MATRIX_OUT)
      fs.writeFileSync(
        process.env.R3_MATRIX_OUT,
        JSON.stringify(rows, null, 2),
      );
  });
});
