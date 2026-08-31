import { describe, expect, it } from "@jest/globals";
import { destinations } from "@/lib/mock-data";
import { buildItinerary, type ScheduleItem, type TripInput } from "@/lib/planner";

// design/screens 시안이 쓴 것과 같은 입력(서울 출발, 9/12 08:00 → 9/13 20:00, 자차, 관심사 역사).
// 현재 화면(app/page.tsx)은 조건 입력까지만 다루고 추천·일정 엔진을 아직 호출하지 않는다.
const defaultInput: TripInput = {
  origin: "서울",
  start: "2026-09-12T08:00",
  end: "2026-09-13T20:00",
  transport: "car",
  interests: ["역사"],
};

const gyeongju = destinations.find((destination) => destination.id === "gyeongju")!;

const placedItems = (items: ScheduleItem[]) => items.filter((item) => item.type !== "이동" && item.type !== "축제");

describe("buildItinerary 시간 배정 규칙", () => {
  it("같은 날짜에 두 항목을 같은 시각으로 배정하지 않는다", () => {
    const items = buildItinerary(gyeongju, defaultInput);
    const slots = placedItems(items).map((item) => `${item.day} ${item.time}`);

    expect(new Set(slots).size).toBe(slots.length);
  });

  it("날짜가 바뀐 뒤에도 항목 사이에 체류시간 + 30분 간격을 유지한다", () => {
    const items = placedItems(buildItinerary(gyeongju, defaultInput));

    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1];
      const current = items[index];
      if (previous.day !== current.day) continue;

      const stayHours = Number(/추천 체류 ([\d.]+)시간/.exec(previous.note ?? "")?.[1]);
      expect(Number.isNaN(stayHours)).toBe(false);

      const minutes = (value: string) => {
        const [hh, mm] = value.split(":").map(Number);
        return hh * 60 + mm;
      };
      expect(minutes(current.time) - minutes(previous.time)).toBe(Math.round((stayHours + 0.5) * 60));
    }
  });

  it("모든 목적지의 일정에서 (날짜, 시각) 조합이 유일하다", () => {
    for (const destination of destinations) {
      const slots = placedItems(buildItinerary(destination, defaultInput)).map((item) => `${item.day} ${item.time}`);
      expect(new Set(slots).size).toBe(slots.length);
    }
  });
});

describe("buildItinerary 운영시간 표기", () => {
  it("소수 운영시간을 17.5:00 같은 형태로 출력하지 않는다", () => {
    const notes = placedItems(buildItinerary(gyeongju, defaultInput)).map((item) => item.note ?? "");

    expect(notes.some((note) => note.includes("17.5:00"))).toBe(false);
    for (const note of notes) {
      expect(note).not.toMatch(/\d+\.\d+\s*:/);
    }
  });

  it("운영시간을 HH:MM–HH:MM 형태로 출력한다", () => {
    for (const destination of destinations) {
      for (const item of placedItems(buildItinerary(destination, defaultInput))) {
        expect(item.note).toMatch(/운영 \d{2}:\d{2}–\d{2}:\d{2}$/);
      }
    }
    const bulguksa = placedItems(buildItinerary(gyeongju, defaultInput)).find((item) => item.title === "불국사");
    expect(bulguksa?.note).toContain("운영 09:00–17:30");
  });
});
