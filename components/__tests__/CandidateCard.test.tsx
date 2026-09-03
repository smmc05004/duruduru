import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CandidateCard } from "@/components/CandidateCard";
import type { DomainDataStatus } from "@/lib/domain-data";
import type { CandidateEvaluation } from "@/lib/recommendation";

function candidateWith(status: DomainDataStatus): CandidateEvaluation {
  const provenance = {
    source: "상태 표시 테스트 데이터",
    collectedAt: "2026-09-03T00:00:00.000Z",
    dataStatus: status,
  };
  const travel = {
    destinationId: `destination-${status}`,
    oneWayHours: 2,
    kind: "estimate" as const,
    source: provenance.source,
    basisDate: "2026-09-03",
    provenance,
    provisional: status !== "normal",
  };

  return {
    id: `destination-${status}`,
    name: `${status} 후보`,
    region: "테스트 지역",
    tags: ["역사"],
    travel,
    oneWayHours: 2,
    roundTripHours: 4,
    localAvailableHours: 12,
    minimumLocalStayHours: 4,
    passed: true,
    interestMatches: ["역사"],
    score: 1,
    components: [
      {
        id: "timeFit",
        label: "시간 적합성",
        available: true,
        raw: 0.75,
        weight: 0.6,
        weighted: 0.45,
      },
      {
        id: "interestFit",
        label: "관심사 일치",
        available: true,
        raw: 1,
        weight: 0.4,
        weighted: 0.4,
      },
    ],
    usedWeights: { timeFit: 0.6, interestFit: 0.4 },
    policyVersion: "test-policy",
    data: {
      destination: provenance,
      tags: { records: [], provenance },
      travel,
    },
  };
}

describe("CandidateCard 정보 위계", () => {
  it.each([
    ["normal"],
    ["estimate"],
    ["fallback"],
    ["stale"],
    ["missing"],
  ] as const)(
    "%s 상태를 전용 클래스·아이콘과 사용자 고지로 표시한다",
    (status) => {
      const { container } = render(
        <ul>
          <CandidateCard
            candidate={candidateWith(status)}
            selectedInterestCount={1}
            best={false}
            selected={false}
            onSelect={() => undefined}
          />
        </ul>,
      );

      const statusItem = container.querySelector(`.dd-data-status--${status}`);
      expect(statusItem).toBeInTheDocument();
      expect(statusItem?.querySelector("svg")).toBeInTheDocument();
      expect(statusItem).toHaveTextContent(
        status === "missing" ? "이동시간 데이터를 준비하지 못했어요" : "기준일",
      );
    },
  );

  it("기본 화면에는 원본 수집 정보를 숨기고 데이터 기준을 열어 표시한다", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <CandidateCard
          candidate={candidateWith("estimate")}
          selectedInterestCount={1}
          best={false}
          selected={false}
          onSelect={() => undefined}
        />
      </ul>,
    );

    expect(screen.getByText("데이터 기준 보기")).toBeVisible();
    expect(
      screen.queryByText("상태 표시 테스트 데이터"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("OpenStreetMap 도로 데이터 기반 일반 예상치"),
    ).not.toBeInTheDocument();

    const summary = screen.getByText("데이터 기준 보기");
    await user.click(summary);

    expect(screen.getByText("이 추천에 사용한 데이터")).toBeVisible();
    expect(
      screen.getByText(/OpenStreetMap 도로 데이터 기반 일반 예상치/),
    ).toBeVisible();
  });
});
