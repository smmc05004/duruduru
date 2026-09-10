import { writeFileSync } from "node:fs";
import { searchPhaseTwo } from "@/lib/mvp-phase-two-search";
import type { MvpCategoryId } from "@/lib/mvp-region-data";
import type { SearchResponse } from "@/lib/mvp-phase-two-types";

/**
 * T6 변경 전/후 비교용 실행 매트릭스.
 *
 * 이 스펙은 네트워크 없이 정상본 JSON만 읽어 `searchPhaseTwo`를 결정적으로 돌린다.
 * `T6_OUT` 환경변수가 있으면 결과를 JSON으로 덤프한다(변경 전 워크트리와 변경 후
 * 워크트리에서 각각 실행해 비교 표를 만든다). 환경변수가 없으면 결정성·구조·상한만
 * 검증한다.
 */

const ORIGINS: Array<{ key: string; originId: string; label: string }> = [
  { key: "seoul", originId: "seoul", label: "서울특별시 중구 존" },
  { key: "busan", originId: "busan", label: "부산광역시 중구 존" },
  {
    key: "gangneung",
    originId: "ktdb-zone-122",
    label: "강원특별자치도 강릉시(비광역시)",
  },
  {
    key: "suwon",
    originId: "ktdb-zone-78",
    label: "경기도 수원시 팔달구(비광역시)",
  },
];

const INTEREST_SETS: Array<{ key: string; interests: MvpCategoryId[] }> = [
  { key: "history", interests: ["history"] },
  { key: "nature", interests: ["nature"] },
  { key: "culture", interests: ["culture"] },
  { key: "leisure", interests: ["leisure"] },
  { key: "rest", interests: ["rest"] },
  { key: "history+culture", interests: ["history", "culture"] },
];

const TIME_CASES: Array<{ key: string; startAt: string; returnBy: string }> = [
  {
    key: "day-08to20",
    startAt: "2026-09-12T08:00",
    returnBy: "2026-09-13T20:00",
  },
  {
    key: "night-18to20",
    startAt: "2026-09-12T18:00",
    returnBy: "2026-09-13T20:00",
  },
];

const SEARCHED_AT = "2026-09-10T00:00:00.000Z";

type CandidateRow = {
  role: string;
  groupId: string;
  displayName: string;
  province: string;
  roundTripMinutes: number;
  oneWayMinutes: number;
  localFreeMinutes: number;
  attractionCount: number;
  categoryDiversity: number;
  fulfilledInterests: MvpCategoryId[];
  missingInterests: MvpCategoryId[];
  placedAttractions: Array<{
    contentId: string;
    title: string;
    regionId: string;
  }>;
  purposeStatus: string | null;
  purposeScore: number | null;
  purposeContributingCount: number | null;
  purposeMatchedHubCount: number | null;
  purposeContributingContentIds: string[] | null;
  centralEmptyRegionIds: string[] | null;
};

type MatrixRow = {
  origin: string;
  originId: string;
  interests: string;
  time: string;
  kind: SearchResponse["kind"];
  message: string | null;
  candidates: CandidateRow[];
};

function runOne(
  originId: string,
  interests: MvpCategoryId[],
  startAt: string,
  returnBy: string,
): SearchResponse {
  return searchPhaseTwo(
    { originId, startAt, returnBy, transport: "car", interests },
    "t6-compare",
    SEARCHED_AT,
  );
}

function summarize(res: SearchResponse): MatrixRow["candidates"] {
  if (res.kind !== "success") return [];
  return res.candidates.map((candidate) => {
    const rec = candidate.recommendation!;
    const placed = candidate.preview.blocks
      .filter((block) => block.kind === "attraction" && block.attraction)
      .map((block) => ({
        contentId: block.attraction!.contentId,
        title: block.attraction!.title,
        regionId: block.attraction!.regionId,
      }));
    const purpose = rec.purpose ?? null;
    return {
      role: rec.role,
      groupId: candidate.groupId,
      displayName: candidate.displayName,
      province: candidate.province,
      roundTripMinutes: rec.roundTripMinutes,
      oneWayMinutes: candidate.oneWayMinutes,
      localFreeMinutes: rec.localFreeMinutes,
      attractionCount: rec.attractionCount,
      categoryDiversity: rec.categoryDiversity,
      fulfilledInterests: rec.requestedInterests.filter(
        (i) => !rec.missingInterests.includes(i),
      ),
      missingInterests: rec.missingInterests,
      placedAttractions: placed,
      purposeStatus: purpose ? purpose.status : null,
      purposeScore: purpose ? purpose.score : null,
      purposeContributingCount: purpose
        ? purpose.contributingContentIds.length
        : null,
      purposeMatchedHubCount: purpose ? purpose.matchedHubCount : null,
      purposeContributingContentIds: purpose
        ? purpose.contributingContentIds
        : null,
      centralEmptyRegionIds: purpose ? purpose.centralEmptyRegionIds : null,
    };
  });
}

describe("T6 변경 전/후 비교 매트릭스", () => {
  const matrix: MatrixRow[] = [];

  for (const origin of ORIGINS) {
    for (const set of INTEREST_SETS) {
      for (const time of TIME_CASES) {
        it(`${origin.key} · ${set.key} · ${time.key}`, () => {
          const first = runOne(
            origin.originId,
            set.interests,
            time.startAt,
            time.returnBy,
          );
          const candidates = summarize(first);
          expect(candidates.length).toBeLessThanOrEqual(3);
          for (const candidate of candidates) {
            // 점수 상한(D4).
            if (candidate.purposeScore !== null)
              expect(candidate.purposeScore).toBeLessThanOrEqual(1);
            // 목적 점수 기여 장소는 실제 초안에 있어야 한다(수용 기준 4).
            if (candidate.purposeContributingContentIds) {
              const placedIds = new Set(
                candidate.placedAttractions.map((a) => a.contentId),
              );
              for (const id of candidate.purposeContributingContentIds)
                expect(placedIds.has(id)).toBe(true);
            }
          }

          matrix.push({
            origin: origin.label,
            originId: origin.originId,
            interests: set.key,
            time: time.key,
            kind: first.kind,
            message: first.kind === "success" ? null : first.message,
            candidates,
          });
        });
      }
    }
  }

  it("같은 입력/데이터 버전은 같은 추천·초안을 만든다(수용 기준 4)", () => {
    for (const origin of ORIGINS.slice(0, 3)) {
      for (const set of [INTEREST_SETS[0], INTEREST_SETS[5]]) {
        const a = runOne(
          origin.originId,
          set.interests,
          TIME_CASES[0].startAt,
          TIME_CASES[0].returnBy,
        );
        const b = runOne(
          origin.originId,
          set.interests,
          TIME_CASES[0].startAt,
          TIME_CASES[0].returnBy,
        );
        expect(JSON.stringify(summarize(b))).toEqual(
          JSON.stringify(summarize(a)),
        );
      }
    }
  });

  afterAll(() => {
    const out = process.env.T6_OUT;
    if (out) writeFileSync(out, JSON.stringify(matrix, null, 2));
  });
});
