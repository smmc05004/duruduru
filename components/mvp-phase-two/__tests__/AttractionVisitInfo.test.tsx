import { render, screen } from "@testing-library/react";
import { AttractionVisitInfo } from "@/components/mvp-phase-two/AttractionVisitInfo";
import type { Attraction } from "@/lib/mvp-phase-two-types";

const attraction: Attraction = {
  contentId: "1",
  contentTypeId: "12",
  regionId: "region",
  title: "주소 확인 관광지",
  address: "서울특별시 중구 세종대로 1",
  imageUrl: "",
  coordinates: null,
  categories: ["history"],
  cat1: "A02",
  cat2: "A0201",
  cat3: "A0201",
};

describe("AttractionVisitInfo", () => {
  it("상세 조회 실패에도 프로필 주소 복사와 안전한 지도 검색을 유지한다", () => {
    render(
      <AttractionVisitInfo
        attraction={attraction}
        visitAt="2026-09-14T10:00"
        entry={{ status: "unavailable", message: "확인 필요" }}
        onRequest={() => {}}
      />,
    );
    expect(
      screen.getByText(
        (_, element) =>
          element?.classList.contains("p2-visit-info__address") === true &&
          element.textContent?.includes("서울특별시 중구 세종대로 1") === true,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "주소 복사" })).toBeEnabled();
    expect(
      screen.getByRole("link", { name: "지도에서 장소 찾기" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("https://www.google.com/maps/search/"),
    );
  });

  it("보존된 상세 정보의 휴무 경고를 현재 방문 시각으로 다시 계산한다", () => {
    const entry = {
      status: "ready" as const,
      detail: {
        title: { status: "confirmed" as const, value: attraction.title },
        address: { status: "confirmed" as const, value: attraction.address },
        overview: { status: "confirmed" as const, value: "안전한 방문 소개" },
        openingHours: { status: "unknown" as const },
        closedDays: { status: "confirmed" as const, value: "매주 월요일 휴무" },
        fees: { status: "unknown" as const },
        phone: { status: "unknown" as const },
        imageUrl: "",
        fetchedAt: "2026-09-09T00:00:00.000Z",
      },
    };
    const view = render(
      <AttractionVisitInfo
        attraction={attraction}
        visitAt="2026-09-13T10:00"
        entry={entry}
        onRequest={() => {}}
      />,
    );
    expect(screen.queryByText(/방문일이 정기휴무일/)).not.toBeInTheDocument();

    view.rerender(
      <AttractionVisitInfo
        attraction={attraction}
        visitAt="2026-09-14T10:00"
        entry={entry}
        onRequest={() => {}}
      />,
    );
    expect(screen.getByText(/방문일이 정기휴무일/)).toBeInTheDocument();
  });
});
