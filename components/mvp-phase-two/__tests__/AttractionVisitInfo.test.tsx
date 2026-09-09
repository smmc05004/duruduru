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
});
