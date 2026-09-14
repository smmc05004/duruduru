/** @jest-environment node */
/**
 * 선정·정렬 회귀. `selectCandidateRoles`(R3 역할 정책)와 `selectPlaces`
 * (지역 내 관광 선정)가 정렬 순서·총순서(추이성)·결정성·행정구역 분할 불변을
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
    freeMinutes?: number;
  },
): Bare {
  const attractions = [1, 2, 3].map((index): Attraction => ({
    contentId: `${groupId}-${index}`,
    contentTypeId: "12",
    regionId: groupId,
    title: `${groupId}-${index}`,
    address: "주소",
    imageUrl: "",
    coordinates: null,
    categories: ["history"],
    cat1: "",
    cat2: "",
    cat3: "",
    lclsSystm1: "HS",
    lclsSystm2: `HS0${index}`,
    lclsSystm3: `HS0${index}0100`,
  }));
  const blocks = attractions.map((attraction, offset) => ({
    id: `attraction-${attraction.contentId}`,
    day: offset < 2 ? (1 as const) : (2 as const),
    startAt: `2026-09-${offset < 2 ? "12" : "13"}T10:00`,
    endAt: `2026-09-${offset < 2 ? "12" : "13"}T11:00`,
    kind: "attraction" as const,
    title: attraction.title,
    durationMinutes: 60,
    contentId: attraction.contentId,
    attraction,
    facilityGroupId: `facility-${attraction.contentId}`,
    reason: "fixture",
  }));
  return {
    groupId,
    memberRegionIds: opts.memberRegionIds ?? [groupId],
    representativeZoneId: groupId,
    displayName: groupId,
    name: groupId,
    province: "검증도",
    oneWayMinutes: opts.oneWayMinutes,
    attractions,
    preview: {
      blocks,
      metrics: {
        arrivalAt: "2026-09-12T09:00",
        returnDepartureAt: "2026-09-13T18:00",
        localMinutes: 900,
        freeMinutes: opts.freeMinutes ?? 400,
        attractionCount: blocks.length,
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

function purpose({
  fitAverage = 7,
  facilities = 4,
  types = 3,
  matchedFacilityCount = 3,
}: {
  fitAverage?: number;
  facilities?: number;
  types?: number;
  matchedFacilityCount?: number;
} = {}): PurposeEvidence {
  return {
    version: "test",
    baseYm: "202608",
    status: "scored",
    fitBand: fitAverage >= 6.5 ? 2 : fitAverage >= 4.5 ? 1 : 0,
    fitAverage,
    fitByInterest: {
      history: { facilities, types, fit: fitAverage },
    },
    matchedFacilityCount,
    score: 0,
    perInterest: {},
    contributingContentIds: [],
    centralEmptyRegionIds: [],
    matchedHubCount: matchedFacilityCount,
  };
}

const INTERESTS: MvpCategoryId[] = ["history"];

describe("R3 역할 정렬", () => {
  it("가까운 여행은 편도 60분 이하에서 가장 가까운 후보를 고른다", () => {
    const selected = selectCandidateRoles(
      [
        bareCandidate("near-b", { oneWayMinutes: 55, fulfilled: ["history"] }),
        bareCandidate("near-a", { oneWayMinutes: 40, fulfilled: ["history"] }),
        bareCandidate("far", { oneWayMinutes: 120, fulfilled: ["history"] }),
      ],
      INTERESTS,
      new Map([
        ["near-a", purpose()],
        ["near-b", purpose()],
        ["far", purpose()],
      ]),
    );
    expect(selected[0].groupId).toBe("near-a");
    expect(selected[0].recommendation.role).toBe("nearby");
  });

  it("1박 2일 여행은 120분에 가까운 후보를 선호한다", () => {
    const selected = selectCandidateRoles(
      [
        bareCandidate("near", { oneWayMinutes: 40, fulfilled: ["history"] }),
        bareCandidate("target", { oneWayMinutes: 120, fulfilled: ["history"] }),
        bareCandidate("longer", { oneWayMinutes: 170, fulfilled: ["history"] }),
      ],
      INTERESTS,
      new Map([
        ["near", purpose()],
        ["target", purpose()],
        ["longer", purpose()],
      ]),
    );
    expect(selected[1].groupId).toBe("target");
    expect(selected[1].recommendation.role).toBe("overnight");
  });

  it("관심사 중심 여행은 유형·시설 cap 뒤에는 180분에 가까운 후보를 고른다", () => {
    const selected = selectCandidateRoles(
      [
        bareCandidate("near", { oneWayMinutes: 40, fulfilled: ["history"] }),
        bareCandidate("overnight", {
          oneWayMinutes: 120,
          fulfilled: ["history"],
        }),
        bareCandidate("extreme", {
          oneWayMinutes: 220,
          fulfilled: ["history"],
        }),
        bareCandidate("balanced", {
          oneWayMinutes: 180,
          fulfilled: ["history"],
        }),
      ],
      INTERESTS,
      new Map([
        ["near", purpose()],
        ["overnight", purpose()],
        ["extreme", purpose({ facilities: 20, types: 20 })],
        ["balanced", purpose({ facilities: 4, types: 3 })],
      ]),
    );
    expect(selected[2].groupId).toBe("balanced");
    expect(selected[2].recommendation.role).toBe("interestRich");
  });

  it("역할 조건을 만족하지 못하면 억지로 세 장을 채우지 않는다", () => {
    const selected = selectCandidateRoles(
      [
        bareCandidate("near", { oneWayMinutes: 40, fulfilled: ["history"] }),
        bareCandidate("weak", {
          oneWayMinutes: 120,
          fulfilled: ["history"],
          freeMinutes: 120,
        }),
      ],
      INTERESTS,
      new Map([
        ["near", purpose()],
        ["weak", purpose({ facilities: 1, types: 1 })],
      ]),
    );
    expect(selected.map((c) => c.groupId)).toEqual(["near"]);
  });

  it("입력 순서를 섞어도 같은 결과다(결정성·총순서)", () => {
    const base: Array<[string, number]> = [
      ["near-a", 40],
      ["near-b", 55],
      ["overnight", 120],
      ["rich", 180],
      ["rich-tie", 180],
    ];
    const map = new Map(base.map(([groupId]) => [groupId, purpose()]));
    const candidates = base.map(([groupId, oneWayMinutes]) =>
      bareCandidate(groupId, { oneWayMinutes, fulfilled: ["history"] }),
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
    expect(canonical).toEqual(["near-a", "overnight", "rich"]);
  });

  it("행정구역 분할·cap 초과 개수는 순위를 바꾸지 않는다", () => {
    const run = (memberCount: number, facilities: number, types: number) =>
      selectCandidateRoles(
        [
          bareCandidate("near", {
            oneWayMinutes: 40,
            fulfilled: ["history"],
          }),
          bareCandidate("overnight", {
            oneWayMinutes: 120,
            fulfilled: ["history"],
            memberRegionIds: Array.from(
              { length: memberCount },
              (_, i) => `r${i}`,
            ),
          }),
        ],
        INTERESTS,
        new Map([
          ["near", purpose()],
          ["overnight", purpose({ facilities, types })],
        ]),
      ).map((c) => c.groupId);
    expect(run(1, 4, 3)).toEqual(run(12, 99, 99));
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
