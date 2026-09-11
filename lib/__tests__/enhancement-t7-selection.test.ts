/** @jest-environment node */
/**
 * T7-4 선정·정렬 회귀. `selectCandidateRoles`(interest 정렬)와 `selectPlaces`
 * (지역 내 관광 선정)가 D4 순서·총순서(추이성)·결정성·행정구역 분할 불변을
 * 지키는지 합성 입력으로 검증한다. 정상본 JSON을 읽지만 외부 fetch는 없다.
 */
import { describe, expect, it } from "@jest/globals";
import { selectCandidateRoles } from "@/lib/mvp-phase-two-search";
import { selectPlaces } from "@/lib/mvp-phase-two-planner";
import type {
  Attraction,
  Candidate,
  PurposeEvidence,
} from "@/lib/mvp-phase-two-types";
import type { MvpCategoryId } from "@/lib/mvp-region-data";

type Bare = Omit<Candidate, "recommendation" | "reasons">;

function bareCandidate(
  groupId: string,
  opts: {
    oneWayMinutes: number;
    fulfilled: MvpCategoryId[];
    memberRegionIds?: string[];
  },
): Bare {
  return {
    groupId,
    memberRegionIds: opts.memberRegionIds ?? [groupId],
    representativeZoneId: groupId,
    displayName: groupId,
    name: groupId,
    province: "검증도",
    oneWayMinutes: opts.oneWayMinutes,
    attractions: [],
    preview: {
      blocks: [],
      metrics: {
        arrivalAt: "2026-09-12T09:00",
        returnDepartureAt: "2026-09-13T18:00",
        localMinutes: 900,
        freeMinutes: 400,
        attractionCount: 4,
        localMealCount: 2,
        fulfilledInterests: opts.fulfilled,
        categoryDiversity: 2,
        averageDistanceKm: null,
      },
    },
    metadata: {
      profileGeneratedAt: "2026-09-07",
      travelTimeGeneratedAt: "2026-09-07",
      networkYear: 2024,
      travelTimeSource: "KTDB",
      representativePoint: "KTDB 존 중심",
      searchedAt: "2026-09-08T00:00:00.000Z",
    },
  };
}

function purpose(
  fitBand: number,
  matchedFacilityCount: number,
): PurposeEvidence {
  return {
    version: "test",
    baseYm: "202608",
    status: "scored",
    fitBand,
    fitAverage: fitBand === 2 ? 7 : fitBand === 1 ? 5 : 3,
    fitByInterest: {},
    matchedFacilityCount,
    score: 0,
    perInterest: {},
    contributingContentIds: [],
    centralEmptyRegionIds: [],
    matchedHubCount: matchedFacilityCount,
  };
}

const INTERESTS: MvpCategoryId[] = ["history"];

describe("T7-4 interest 정렬 (D4)", () => {
  it("같은 구간이면 왕복시간이 짧은 후보를 interest로 고른다", () => {
    const selected = selectCandidateRoles(
      [
        bareCandidate("far", { oneWayMinutes: 200, fulfilled: ["history"] }),
        bareCandidate("near", { oneWayMinutes: 40, fulfilled: ["history"] }),
      ],
      INTERESTS,
      new Map([
        ["far", purpose(2, 4)],
        ["near", purpose(2, 1)],
      ]),
    );
    expect(selected[0].groupId).toBe("near");
    expect(selected[0].recommendation.role).toBe("interest");
  });

  it("더 높은 구간이면 먼 후보도 interest로 고른다", () => {
    const selected = selectCandidateRoles(
      [
        bareCandidate("far", { oneWayMinutes: 200, fulfilled: ["history"] }),
        bareCandidate("near", { oneWayMinutes: 40, fulfilled: ["history"] }),
      ],
      INTERESTS,
      new Map([
        ["far", purpose(2, 3)],
        ["near", purpose(1, 3)],
      ]),
    );
    expect(selected[0].groupId).toBe("far");
  });

  it("구간·왕복시간이 같으면 상한 적용 보조(중심 연결) 시설 수로만 정한다", () => {
    const selected = selectCandidateRoles(
      [
        bareCandidate("a", { oneWayMinutes: 60, fulfilled: ["history"] }),
        bareCandidate("b", { oneWayMinutes: 60, fulfilled: ["history"] }),
      ],
      INTERESTS,
      new Map([
        ["a", purpose(1, 1)],
        ["b", purpose(1, 3)],
      ]),
    );
    expect(selected[0].groupId).toBe("b");
  });

  it("행정구역 분할·보조 상한 초과 개수는 순위를 바꾸지 않는다", () => {
    // 두 시나리오: near의 memberRegionIds 개수와 보조 시설 수만 다르다.
    // 보조 시설 수는 상한 4에서 잘리므로 5·9 모두 4로 동일 취급되어야 한다.
    const run = (memberCount: number, matched: number) =>
      selectCandidateRoles(
        [
          bareCandidate("far", {
            oneWayMinutes: 200,
            fulfilled: ["history"],
          }),
          bareCandidate("near", {
            oneWayMinutes: 40,
            fulfilled: ["history"],
            memberRegionIds: Array.from(
              { length: memberCount },
              (_, i) => `r${i}`,
            ),
          }),
        ],
        INTERESTS,
        new Map([
          ["far", purpose(2, 4)],
          ["near", purpose(2, Math.min(matched, 4))],
        ]),
      ).map((c) => c.groupId);
    expect(run(1, 5)).toEqual(run(12, 9));
    expect(run(1, 5)[0]).toBe("near");
  });

  it("입력 순서를 섞어도 같은 결과다(결정성·총순서)", () => {
    const base: Array<[string, number, number, number]> = [
      ["p", 40, 2, 4],
      ["q", 40, 2, 4],
      ["r", 120, 2, 1],
      ["s", 90, 1, 3],
      ["t", 40, 1, 0],
    ];
    const map = new Map(base.map(([g, , b, m]) => [g, purpose(b, m)]));
    const candidates = base.map(([g, rt]) =>
      bareCandidate(g, { oneWayMinutes: rt, fulfilled: ["history"] }),
    );
    const canonical = selectCandidateRoles(candidates, INTERESTS, map).map(
      (c) => c.groupId,
    );
    for (let seed = 0; seed < 40; seed++) {
      const shuffled = [...candidates].sort(
        () => Math.sin(seed * 97 + candidates.length) - 0.5,
      );
      const got = selectCandidateRoles(shuffled, INTERESTS, map).map(
        (c) => c.groupId,
      );
      expect(got).toEqual(canonical);
    }
    // 동점(p·q: 같은 rt·구간·보조)은 groupId 사전순.
    expect(canonical[0]).toBe("p");
  });
});

describe("T7-4 지역 내 관광 선정 (selectPlaces, D4 순서)", () => {
  const slot = (start: number): { start: number; end: number } => ({
    start,
    end: start + 60,
  });
  const place = (
    contentId: string,
    lclsSystm3: string,
    overrides: Partial<Attraction> = {},
  ): Attraction => ({
    contentId,
    contentTypeId: "12",
    regionId: "region-x",
    title: `장소 ${contentId}`,
    address: `주소 ${contentId}`,
    imageUrl: "",
    coordinates: null,
    categories: ["history"],
    cat1: "",
    cat2: "",
    cat3: "",
    lclsSystm1: "HS",
    lclsSystm3,
    ...overrides,
  });

  it("중심 근거가 세부 유형 다양성보다 앞서지 않는다(같은 유형 반복 방지)", () => {
    const places = [
      place("same-a", "HS030100"),
      place("same-b", "HS030100"),
      place("diverse", "HS010100"),
      place("same-c", "HS030100"),
    ];
    // 중심 근거는 same-* 에만 있다고 신호. 그래도 두 번째 선택은 diverse 여야 한다.
    const hasCentral = (p: Attraction) =>
      p.contentId.startsWith("same") ? 5 : null;
    const visits = selectPlaces(
      places,
      ["history"],
      [[slot(480), slot(600)], []],
      undefined,
      hasCentral,
    );
    const picked = visits.map((v) => v.attraction.contentId);
    expect(picked).toContain("diverse");
    // 첫 두 칸에 같은 세부 유형(HS030100)만 오지 않는다.
    const firstTwoTypes = visits
      .slice(0, 2)
      .map((v) => v.attraction.lclsSystm3);
    expect(new Set(firstTwoTypes).size).toBe(2);
  });

  it("결정적이다 — 입력 순서를 바꿔도 같은 선택", () => {
    const places = [
      place("a", "HS010100"),
      place("b", "HS020100"),
      place("c", "HS030100"),
      place("d", "HS040100"),
    ];
    const pick = (arr: Attraction[]) =>
      selectPlaces(arr, ["history"], [[slot(480), slot(600)], []])
        .map((v) => v.attraction.contentId)
        .join(",");
    const canonical = pick(places);
    expect(pick([...places].reverse())).toBe(canonical);
    expect(pick([places[2], places[0], places[3], places[1]])).toBe(canonical);
  });
});
