import { describe, expect, it } from "@jest/globals";
import { render } from "@testing-library/react";
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

describe("CandidateCard 데이터 신뢰도 표시", () => {
  it.each([
    ["normal", "정상"],
    ["estimate", "추정"],
    ["fallback", "대체값"],
    ["stale", "오래됨"],
    ["missing", "결측"],
  ] as const)(
    "%s 상태를 전용 클래스·텍스트·아이콘으로 표시한다",
    (status, label) => {
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
      expect(statusItem).toHaveTextContent(`상태 ${label}`);
    },
  );
});
