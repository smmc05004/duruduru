/** @jest-environment node */
/**
 * T7-5 비교 재실행. T6와 같은 48개 입력(출발지 4 × 관심사 6 × 시간 2)으로
 * `searchPhaseTwo`를 결정적으로 돌리고, 각 후보의 관심사별 배치 시설 수·세부 유형
 * 수·목적 적합성 구간·보조(중심 연결) 근거·왕복/현지시간·실제 장소를 검증한다.
 * `T7_OUT`이 있으면 JSON을 덤프해 `scripts/report-t7-selection.mjs`가 표로 만든다.
 *
 * 외부 fetch 0회(정상본 JSON만 읽음). 같은 데이터 버전이면 같은 결과.
 */
import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "@jest/globals";
import { searchPhaseTwo } from "@/lib/mvp-phase-two-search";
import { facilityGroups } from "@/lib/mvp-phase-two-planner";
import { detailClassificationStrict } from "@/lib/interest-classification";
import { hubEvidenceFor, PURPOSE_FIT_METRIC } from "@/lib/tourism-evidence";
import type { MvpCategoryId } from "@/lib/mvp-region-data";
import type { Attraction, SearchResponse } from "@/lib/mvp-phase-two-types";

const ORIGINS = [
  { key: "seoul", originId: "seoul" },
  { key: "busan", originId: "busan" },
  { key: "gangneung", originId: "ktdb-zone-122" },
  { key: "suwon", originId: "ktdb-zone-78" },
];
const INTEREST_SETS: Array<{ key: string; interests: MvpCategoryId[] }> = [
  { key: "history", interests: ["history"] },
  { key: "nature", interests: ["nature"] },
  { key: "culture", interests: ["culture"] },
  { key: "leisure", interests: ["leisure"] },
  { key: "rest", interests: ["rest"] },
  { key: "history+culture", interests: ["history", "culture"] },
];
const TIME_CASES = [
  { key: "day", startAt: "2026-09-12T08:00", returnBy: "2026-09-13T20:00" },
  { key: "night", startAt: "2026-09-12T18:00", returnBy: "2026-09-13T20:00" },
];
const SEARCHED_AT = "2026-09-10T00:00:00.000Z";

function perInterest(placed: Attraction[], interests: MvpCategoryId[]) {
  const groups = facilityGroups(placed);
  const out: Record<
    string,
    { facilities: number; types: number; matchedCentral: number }
  > = {};
  for (const interest of interests) {
    const relevant = placed.filter((p) => p.categories.includes(interest));
    out[interest] = {
      facilities: new Set(
        relevant.map((p) => groups.get(p.contentId) ?? p.contentId),
      ).size,
      types: new Set(
        relevant
          .map((p) => detailClassificationStrict(p))
          .filter((v): v is string => v !== null),
      ).size,
      matchedCentral: new Set(
        relevant
          .filter((p) => hubEvidenceFor(p.regionId, p.contentId) !== null)
          .map((p) => groups.get(p.contentId) ?? p.contentId),
      ).size,
    };
  }
  return out;
}

function summarize(res: SearchResponse, interests: MvpCategoryId[]) {
  if (res.kind !== "success") return { kind: res.kind, message: res.message };
  return {
    kind: "success" as const,
    candidates: res.candidates.map((c) => {
      const placed = c.preview.blocks.flatMap((b) =>
        b.kind === "attraction" && b.attraction ? [b.attraction] : [],
      );
      const rec = c.recommendation!;
      return {
        role: rec.role,
        displayName: c.displayName,
        province: c.province,
        memberRegionCount: c.memberRegionIds.length,
        roundTripMinutes: rec.roundTripMinutes,
        localFreeMinutes: rec.localFreeMinutes,
        attractionCount: rec.attractionCount,
        fulfilledInterestCount: rec.fulfilledInterestCount,
        fitBand: rec.purpose?.fitBand ?? null,
        fitAverage: rec.purpose?.fitAverage ?? null,
        matchedFacilityCount: rec.purpose?.matchedFacilityCount ?? null,
        purposeStatus: rec.purpose?.status ?? null,
        rawScore: rec.purpose?.score ?? null,
        placedTitles: placed.map((p) => p.title),
        perInterest: perInterest(placed, interests),
      };
    }),
  };
}

describe("T7-5 48개 입력 재실행", () => {
  const rows: unknown[] = [];

  for (const origin of ORIGINS) {
    for (const set of INTEREST_SETS) {
      for (const time of TIME_CASES) {
        it(`${origin.key} · ${set.key} · ${time.key}`, () => {
          const request = {
            originId: origin.originId,
            startAt: time.startAt,
            returnBy: time.returnBy,
            transport: "car" as const,
            interests: set.interests,
          };
          const first = searchPhaseTwo(request, "t7", SEARCHED_AT);
          const again = searchPhaseTwo(request, "t7b", SEARCHED_AT);
          const s = summarize(first, set.interests);
          // 결정성.
          expect(JSON.stringify(summarize(again, set.interests))).toBe(
            JSON.stringify(s),
          );
          rows.push({
            origin: origin.key,
            interests: set.key,
            time: time.key,
            ...s,
          });
          if (s.kind !== "success") return;

          const [interestCard, ...rest] = s.candidates;
          expect(interestCard.role).toBe("interest");
          for (const c of s.candidates) {
            if (c.fitBand !== null) expect([0, 1, 2]).toContain(c.fitBand);
          }
          // D4 interest 정렬: 다른 후보가 (더 많은 충족) 또는
          // (같은 충족 · 더 높은 구간 · 왕복시간이 더 짧거나 같음)이면 안 된다.
          for (const other of rest) {
            const better =
              other.fulfilledInterestCount >
                interestCard.fulfilledInterestCount ||
              (other.fulfilledInterestCount ===
                interestCard.fulfilledInterestCount &&
                (other.fitBand ?? 0) > (interestCard.fitBand ?? 0) &&
                other.roundTripMinutes <= interestCard.roundTripMinutes);
            expect(better).toBe(false);
          }
          // 같은 구간이면 interest 왕복시간이 easy(가장 가까운 후보)보다
          // 크게 벗어나지 않는다 — 유사 적합성에서 짧은 이동 우선.
          const easyCard = s.candidates.find((c) => c.role === "easy");
          if (
            easyCard &&
            (interestCard.fitBand ?? 0) <= (easyCard.fitBand ?? 0) &&
            interestCard.fulfilledInterestCount ===
              easyCard.fulfilledInterestCount
          )
            expect(interestCard.roundTripMinutes).toBeLessThanOrEqual(
              easyCard.roundTripMinutes,
            );
        });
      }
    }
  }

  it("포화 상한이 문서 상수와 일치한다", () => {
    expect(PURPOSE_FIT_METRIC).toEqual({
      facilityCap: 4,
      typeCap: 3,
      bandBoundaries: [4.5, 6.5],
      matchedFacilityCap: 4,
    });
  });

  afterAll(() => {
    if (process.env.T7_OUT)
      writeFileSync(process.env.T7_OUT, JSON.stringify(rows, null, 2));
  });
});
