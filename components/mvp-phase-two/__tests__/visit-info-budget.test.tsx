import { fireEvent, render, screen } from "@testing-library/react";
import { AttractionVisitInfo } from "../AttractionVisitInfo";
import { visitInfoFailure } from "@/lib/attraction-visit-info";
import type { Attraction } from "@/lib/mvp-phase-two-types";

const attraction: Attraction = {
  contentId: "budget",
  contentTypeId: "12",
  regionId: "region",
  title: "방문정보 예산 관광지",
  address: "서울 중구",
  imageUrl: "",
  coordinates: null,
  categories: ["history"],
  cat1: "A02",
  cat2: "A0201",
  cat3: "A0201",
};

it("방문정보 로딩·쿨다운·시간초과·한도 상태를 구분하며 한도 뒤 클릭을 차단한다", () => {
  const onRequest = jest.fn();
  const props = { attraction, visitAt: "2026-09-14T10:00", onRequest };
  const view = render(
    <AttractionVisitInfo {...props} entry={{ status: "loading" }} />,
  );
  expect(
    screen.queryByRole("button", { name: "방문정보 확인" }),
  ).not.toBeInTheDocument();
  view.rerender(
    <AttractionVisitInfo
      {...props}
      entry={visitInfoFailure(new Error("cooldown"))}
    />,
  );
  expect(screen.getByText(/30초를 기다려/)).toBeInTheDocument();
  view.rerender(
    <AttractionVisitInfo
      {...props}
      entry={visitInfoFailure(new Error("timeout"))}
    />,
  );
  expect(screen.getByText(/확인 시간이 초과/)).toBeInTheDocument();
  view.rerender(
    <AttractionVisitInfo
      {...props}
      entry={visitInfoFailure(new Error("limit"))}
    />,
  );
  expect(screen.getByText(/확인 횟수를 모두 사용/)).toBeInTheDocument();
  const button = screen.getByRole("button", { name: "방문정보 확인" });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(onRequest).not.toHaveBeenCalled();
});
