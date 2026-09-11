import { describe, expect, it } from "@jest/globals";
import { planMetrics } from "@/lib/mvp-phase-two-planner";
import type {
  Attraction,
  SearchInput,
  TimeBlock,
} from "@/lib/mvp-phase-two-types";

/**
 * 결함 2 회귀: 새 공식 세부 분류(`lclsSystm3`)만 있고 구 `cat`이 빈 서로 다른 역사
 * 명소가 세부 분류 다양성 지표에서 구별돼야 한다. 이전 구현은 `cat3 || cat2 ||
 * categories.join("+")`만 봐서 둘 다 `"history"`로 뭉갰다.
 */

const input: SearchInput = {
  originId: "seoul",
  startAt: "2026-09-12T08:00",
  returnBy: "2026-09-13T20:00",
  transport: "car",
  interests: ["history"],
};

const historyPlace = (
  contentId: string,
  lclsSystm2: string,
  lclsSystm3: string,
): Attraction => ({
  contentId,
  contentTypeId: "12",
  regionId: "ktdb-zone-154",
  title: `역사 명소 ${contentId}`,
  address: `충청남도 공주시 ${contentId}`,
  imageUrl: "",
  coordinates: { latitude: 36.46, longitude: 127.12 },
  categories: ["history"],
  cat1: "",
  cat2: "",
  cat3: "",
  lclsSystm1: "HS",
  lclsSystm2,
  lclsSystm3,
});

const attractionBlock = (
  place: Attraction,
  day: 1 | 2,
  startAt: string,
  endAt: string,
): TimeBlock => ({
  id: `attraction-${place.contentId}`,
  day,
  startAt,
  endAt,
  kind: "attraction",
  title: place.title,
  durationMinutes: 60,
  contentId: place.contentId,
  attraction: place,
  reason: "test",
});

describe("세부 분류 다양성 지표", () => {
  it("lclsSystm3 이 다른 두 역사 명소를 서로 다른 세부 분류로 센다", () => {
    const gongsanseong = historyPlace("125949", "HS01", "HS010200");
    const bulguksa = historyPlace("126166", "HS03", "HS030100");
    const metrics = planMetrics(
      input,
      [
        attractionBlock(
          gongsanseong,
          1,
          "2026-09-12T10:00",
          "2026-09-12T11:00",
        ),
        attractionBlock(bulguksa, 1, "2026-09-12T12:00", "2026-09-12T13:00"),
      ],
      "2026-09-12T10:00",
      "2026-09-13T18:00",
    );
    expect(metrics.categoryDiversity).toBe(2);
  });

  it("같은 lclsSystm3 인 두 역사 명소는 하나의 세부 분류로 센다", () => {
    const first = historyPlace("125949", "HS01", "HS010200");
    const second = historyPlace("125950", "HS01", "HS010200");
    const metrics = planMetrics(
      input,
      [
        attractionBlock(first, 1, "2026-09-12T10:00", "2026-09-12T11:00"),
        attractionBlock(second, 1, "2026-09-12T12:00", "2026-09-12T13:00"),
      ],
      "2026-09-12T10:00",
      "2026-09-13T18:00",
    );
    expect(metrics.categoryDiversity).toBe(1);
  });
});
