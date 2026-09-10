import {
  searchPhaseTwo,
  selectCandidateRoles,
} from "@/lib/mvp-phase-two-search";
import { assignRestaurants } from "@/lib/mvp-phase-two-meals";
import { createPlan } from "@/lib/mvp-phase-two-planner";
import type {
  Attraction,
  Candidate,
  Coordinates,
  Restaurant,
  TimeBlock,
} from "@/lib/mvp-phase-two-types";

const input = ["nature", "history", "culture"] as const;
const point = (latitude: number, longitude: number): Coordinates => ({
  latitude,
  longitude,
});
function attraction(id: string, coordinates: Coordinates | null): Attraction {
  return {
    contentId: id,
    contentTypeId: "12",
    regionId: `region-${id}`,
    title: `관광지 ${id}`,
    address: `주소 ${id}`,
    imageUrl: "",
    coordinates,
    categories: ["history"],
    cat1: "A02",
    cat2: "A0201",
    cat3: "A02010100",
  };
}
function attractionBlock(
  id: string,
  day: 1 | 2,
  coordinates: Coordinates | null,
): TimeBlock {
  const place = attraction(id, coordinates);
  return {
    id: `attraction-${id}`,
    day,
    startAt: `2026-09-${day === 1 ? "12" : "13"}T10:00`,
    endAt: `2026-09-${day === 1 ? "12" : "13"}T11:00`,
    kind: "attraction",
    title: place.title,
    durationMinutes: 60,
    contentId: place.contentId,
    attraction: place,
    reason: "fixture",
  };
}
function candidate(
  groupId: string,
  options: {
    oneWayMinutes: number;
    fulfilledInterests: Candidate["preview"]["metrics"]["fulfilledInterests"];
    categoryDiversity: number;
    freeMinutes: number;
    points?: Array<Coordinates | null>;
  },
): Omit<Candidate, "recommendation" | "reasons"> {
  const blocks = (options.points ?? [point(37, 127), point(37.01, 127.01)]).map(
    (coordinates, index) =>
      attractionBlock(`${groupId}-${index}`, 1, coordinates),
  );
  return {
    groupId,
    memberRegionIds: [groupId],
    representativeZoneId: groupId,
    displayName: groupId,
    name: groupId,
    province: "검증도",
    oneWayMinutes: options.oneWayMinutes,
    attractions: blocks.flatMap((block) =>
      block.attraction ? [block.attraction] : [],
    ),
    preview: {
      blocks,
      metrics: {
        arrivalAt: "2026-09-12T09:00",
        returnDepartureAt: "2026-09-13T18:00",
        localMinutes: 900,
        freeMinutes: options.freeMinutes,
        attractionCount: blocks.length,
        localMealCount: 2,
        fulfilledInterests: options.fulfilledInterests,
        categoryDiversity: options.categoryDiversity,
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

describe("E1 목적지 역할 선택", () => {
  it("가까운 A, 관심사가 다양한 B, 자유시간이 긴 C를 순서대로 선택한다", () => {
    const selected = selectCandidateRoles(
      [
        candidate("A", {
          oneWayMinutes: 60,
          fulfilledInterests: ["history"],
          categoryDiversity: 1,
          freeMinutes: 300,
        }),
        candidate("B", {
          oneWayMinutes: 130,
          fulfilledInterests: ["nature", "history", "culture"],
          categoryDiversity: 4,
          freeMinutes: 300,
        }),
        candidate("C", {
          oneWayMinutes: 180,
          fulfilledInterests: ["history"],
          categoryDiversity: 1,
          freeMinutes: 900,
        }),
      ],
      [...input],
    );

    // 표시 순서는 interest → easy → relaxed (D4): 관심사가 다양한 B가 먼저다.
    expect(selected.map((item) => item.groupId)).toEqual(["B", "A", "C"]);
    expect(selected.map((item) => item.recommendation.role)).toEqual([
      "interest",
      "easy",
      "relaxed",
    ]);
  });

  it("단독 우승자가 겹쳐도 이미 고른 그룹은 제외하고 1~2곳만 그대로 반환한다", () => {
    const first = candidate("A", {
      oneWayMinutes: 60,
      fulfilledInterests: ["nature", "history", "culture"],
      categoryDiversity: 4,
      freeMinutes: 900,
    });
    const second = candidate("B", {
      oneWayMinutes: 120,
      fulfilledInterests: ["history"],
      categoryDiversity: 1,
      freeMinutes: 200,
    });

    const selected = selectCandidateRoles([first, second], [...input]);

    expect(selected.map((item) => item.groupId)).toEqual(["A", "B"]);
    expect(selected.map((item) => item.recommendation.role)).toEqual([
      "interest",
      "easy",
    ]);
  });

  it("모든 비교 지표가 같으면 groupId 사전순으로 역할을 결정한다", () => {
    const options = {
      oneWayMinutes: 120,
      fulfilledInterests: ["history"] as const,
      categoryDiversity: 1,
      freeMinutes: 300,
      points: [point(37, 127), point(37.01, 127.01)],
    };

    const selected = selectCandidateRoles(
      [
        candidate("C", options),
        candidate("A", options),
        candidate("B", options),
      ],
      [...input],
    );

    expect(selected.map((item) => item.groupId)).toEqual(["A", "B", "C"]);
  });

  it("좌표가 일부 또는 전부 빠진 초안은 숨기지 않고 근접성 비교 불가 근거를 보존한다", () => {
    const selected = selectCandidateRoles(
      [
        candidate("partial", {
          oneWayMinutes: 60,
          fulfilledInterests: ["history"],
          categoryDiversity: 1,
          freeMinutes: 200,
          points: [point(37, 127), null, point(37.02, 127.02)],
        }),
        candidate("missing", {
          oneWayMinutes: 120,
          fulfilledInterests: ["history"],
          categoryDiversity: 1,
          freeMinutes: 500,
          points: [null, null],
        }),
      ],
      [...input],
    );

    expect(selected).toHaveLength(2);
    expect(selected[1].recommendation.distancePairCount).toBe(1);
    expect(selected[1].recommendation.validDistancePairCount).toBe(0);
    expect(selected[1].recommendation.proximityComparable).toBe(false);
    expect(selected[1].reasons).toContain(
      "장소 간 근접성은 확인하지 못했어요.",
    );
  });

  it("실제 검색 엔진의 초안에서 역할을 고르고 선택 계획에 제한된 음식 목록을 연결한다", () => {
    const result = searchPhaseTwo(
      {
        originId: "seoul",
        startAt: "2026-09-12T08:00",
        returnBy: "2026-09-13T20:00",
        transport: "car",
        interests: ["history", "culture"],
      },
      "deterministic-search",
      "2026-09-08T00:00:00.000Z",
    );

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.candidates).not.toHaveLength(0);
    expect(new Set(result.candidates.map((item) => item.groupId)).size).toBe(
      result.candidates.length,
    );
    expect(result.candidates.map((item) => item.recommendation?.role)).toEqual(
      ["interest", "easy", "relaxed"].slice(0, result.candidates.length),
    );

    const selected = result.candidates[0];
    const plan = createPlan(
      {
        originId: "seoul",
        startAt: "2026-09-12T08:00",
        returnBy: "2026-09-13T20:00",
        transport: "car",
        interests: ["history", "culture"],
      },
      selected,
      result.searchId,
    );
    const restaurants: Restaurant[] = selected.memberRegionIds
      .slice(0, 2)
      .map((regionId, index) => ({
        contentId: `mocked-restaurant-${index}`,
        regionId,
        name: `검증 식당 ${index + 1}`,
        address: "검증 주소",
        phone: "",
        imageUrl: "",
        coordinates: null,
        certified: false,
        foodCultureMatch: false,
        fetchedAt: "2026-09-08T00:00:00.000Z",
      }));
    const withFood = assignRestaurants(plan, restaurants);

    expect(withFood.blocks.some((block) => block.restaurant)).toBe(true);
    expect(withFood.destination.preview.blocks).toEqual(
      selected.preview.blocks,
    );
  });
});

describe("T5 목적 근거 점수의 초안 일치·결정성", () => {
  const request = {
    originId: "seoul" as const,
    startAt: "2026-09-12T08:00",
    returnBy: "2026-09-13T20:00",
    transport: "car" as const,
    interests: ["history", "culture"] as const,
  };

  it("점수 기여 장소는 모두 실제 초안에 배치된 관광지다", () => {
    const result = searchPhaseTwo(request, "s", "2026-09-08T00:00:00.000Z");
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    let scoredWithContribution = 0;
    for (const candidate of result.candidates) {
      const purpose = candidate.recommendation?.purpose;
      expect(purpose).toBeDefined();
      if (!purpose) continue;
      expect(purpose.version).not.toBe("");
      expect(["scored", "no-central-data"]).toContain(purpose.status);
      if (purpose.score !== null) expect(purpose.score).toBeLessThanOrEqual(1);
      const placedIds = new Set(
        candidate.preview.blocks.flatMap((block) =>
          block.kind === "attraction" && block.contentId
            ? [block.contentId]
            : [],
        ),
      );
      for (const contentId of purpose.contributingContentIds)
        expect(placedIds.has(contentId)).toBe(true);
      // 근거 장소가 후보 지역의 전체 원천 명소가 아니라 배치된 부분집합임을 확인
      expect(purpose.contributingContentIds.length).toBeLessThanOrEqual(
        placedIds.size,
      );
      if (purpose.status === "scored" && purpose.contributingContentIds.length)
        scoredWithContribution++;
    }
    expect(scoredWithContribution).toBeGreaterThan(0);
  });

  it("같은 입력·데이터 버전은 같은 후보·근거 점수를 만든다", () => {
    const a = searchPhaseTwo(request, "s1", "2026-09-08T00:00:00.000Z");
    const b = searchPhaseTwo(request, "s2", "2026-09-08T00:00:00.000Z");
    if (a.kind !== "success" || b.kind !== "success") throw new Error("no");
    expect(a.candidates.map((c) => c.groupId)).toEqual(
      b.candidates.map((c) => c.groupId),
    );
    expect(a.candidates.map((c) => c.recommendation?.purpose?.score)).toEqual(
      b.candidates.map((c) => c.recommendation?.purpose?.score),
    );
    expect(a.candidates.map((c) => c.recommendation?.role)).toEqual([
      "interest",
      "easy",
      "relaxed",
    ]);
  });
});
