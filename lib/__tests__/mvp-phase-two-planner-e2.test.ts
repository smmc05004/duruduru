import { describe, expect, it } from "@jest/globals";
import {
  facilityGroups,
  scheduleTrip,
  selectPlaces,
} from "@/lib/mvp-phase-two-planner";
import type {
  Attraction,
  Coordinates,
  SearchInput,
} from "@/lib/mvp-phase-two-types";

const input: SearchInput = {
  originId: "seoul",
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
  transport: "car",
  interests: ["history"],
};

const point = (latitude: number, longitude: number): Coordinates => ({
  latitude,
  longitude,
});

const attraction = (
  contentId: string,
  title: string,
  address: string,
  coordinates: Coordinates | null,
): Attraction => ({
  contentId,
  contentTypeId: "12",
  regionId: "fixture-region",
  title,
  address,
  imageUrl: "",
  coordinates,
  categories: ["history"],
  cat1: "A02",
  cat2: "A0201",
  cat3: "A02010100",
});

describe("E2 시설 의심 묶음", () => {
  it("주소·거리·고유 토큰이 모두 맞을 때만 묶고 대표 기준 연쇄 병합을 막는다", () => {
    const groups = facilityGroups([
      attraction(
        "A",
        "공산성 광복루",
        "충남 공주시 공산성로 1",
        point(36.46, 127.12),
      ),
      attraction(
        "B",
        "공산성 쌍수정",
        "충남 공주시 공산성로 1",
        point(36.461, 127.12),
      ),
      attraction(
        "C",
        "공산성 관리동",
        "충남 공주시 공산성로 1",
        point(36.463, 127.12),
      ),
      attraction(
        "D",
        "역사 박물관",
        "충남 공주시 공산성로 1",
        point(36.46, 127.12),
      ),
      attraction("E", "공산성 전시관", "다른 주소", point(36.46, 127.12)),
      attraction(
        "F",
        "공산성 매표소",
        "충남 공주시 공산성로 1-2",
        point(36.46, 127.12),
      ),
      attraction(
        "G",
        "공산성 안내소",
        "충남 공주시 공산성로 12",
        point(36.46, 127.12),
      ),
      attraction(
        "H",
        "공산성 안내판",
        "충남 공주시 공산성로 1 - 2",
        point(36.46, 127.12),
      ),
    ]);

    expect(groups.get("A")).toBe(groups.get("B"));
    expect(groups.get("C")).not.toBe(groups.get("A"));
    expect(groups.get("D")).not.toBe(groups.get("A"));
    expect(groups.get("E")).not.toBe(groups.get("A"));
    expect(groups.get("F")).not.toBe(groups.get("G"));
    expect(groups.get("H")).toBe(groups.get("F"));
    expect(groups.get("H")).not.toBe(groups.get("G"));
  });

  it("대안이 있으면 같은 시설 의심 장소보다 독립 장소를 먼저 고른다", () => {
    const selected = selectPlaces(
      [
        attraction(
          "A",
          "공산성 광복루",
          "충남 공주시 공산성로 1",
          point(36.46, 127.12),
        ),
        attraction(
          "B",
          "공산성 쌍수정",
          "충남 공주시 공산성로 1",
          point(36.461, 127.12),
        ),
        attraction(
          "C",
          "무령왕릉",
          "충남 공주시 왕릉로 37",
          point(36.462, 127.122),
        ),
      ],
      ["history"],
      [
        [
          { start: 600, end: 660 },
          { start: 675, end: 735 },
        ],
        [],
      ],
    );

    expect(selected.map((visit) => visit.attraction.contentId)).toEqual([
      "A",
      "C",
    ]);
    expect(selected.map((visit) => visit.sessionId)).toEqual([
      "day-1-morning",
      "day-1-morning",
    ]);
  });

  it("확인된 same-facility 보정은 자동 초안에서 한 장소만 사용한다", () => {
    const places = [
      attraction(
        "A",
        "공산성 광복루",
        "충남 공주시 공산성로 1",
        point(36.46, 127.12),
      ),
      attraction(
        "B",
        "공산성 쌍수정",
        "충남 공주시 공산성로 1",
        point(36.461, 127.12),
      ),
    ];
    const selected = selectPlaces(
      places,
      ["history"],
      [
        [
          { start: 600, end: 660 },
          { start: 675, end: 735 },
        ],
        [],
      ],
      [
        {
          contentIds: ["A", "B"],
          disposition: "same-facility",
          evidence: "현장 확인",
          verifiedAt: "2026-09-08",
        },
      ],
    );

    expect(selected.map((visit) => visit.attraction.contentId)).toEqual(["A"]);
    expect(selected[0].facilityGroupId).toBe("facility-confirmed-A-B");

    const independent = facilityGroups(places, [
      {
        contentIds: ["A", "B"],
        disposition: "independent",
        evidence: "현장 확인",
        verifiedAt: "2026-09-08",
      },
    ]);
    expect(independent.get("A")).not.toBe(independent.get("B"));
  });
});

describe("E2 공통 일정 여유", () => {
  it("연속 관광 사이에 15분 자유시간을 넣고 그 시간을 하루 30분 자유시간에 포함한다", () => {
    const result = scheduleTrip(input, 120, [
      attraction(
        "1",
        "공산성 광복루",
        "충남 공주시 공산성로 1",
        point(36.46, 127.12),
      ),
      attraction(
        "2",
        "무령왕릉",
        "충남 공주시 왕릉로 37",
        point(36.462, 127.122),
      ),
      attraction(
        "3",
        "국립공주박물관",
        "충남 공주시 관광단지길 34",
        point(36.463, 127.123),
      ),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attractions = result.blocks
      .filter((block) => block.kind === "attraction")
      .toSorted((left, right) => left.startAt.localeCompare(right.startAt));
    const consecutive = attractions.find(
      (block, index) => index > 0 && block.day === attractions[index - 1].day,
    );
    expect(consecutive).toBeDefined();
    if (!consecutive) return;
    const previous = attractions[attractions.indexOf(consecutive) - 1];
    const slack = result.blocks.find(
      (block) =>
        block.kind === "free" &&
        block.startAt === previous.endAt &&
        block.endAt === consecutive.startAt,
    );
    expect(slack).toMatchObject({ durationMinutes: 15, title: "여유시간" });
    expect(result.metrics.freeMinutes).toBeGreaterThanOrEqual(30);
  });
});
