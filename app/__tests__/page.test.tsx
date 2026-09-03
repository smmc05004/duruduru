import { describe, expect, it } from "@jest/globals";
import type { ComponentProps } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TripConditionsPage from "../page";
import {
  evaluateRecommendationRequest,
  type RecommendationDataSource,
} from "@/lib/recommendation-request";
import { pocDataAdapter } from "@/lib/poc-data-adapter";
import { recommendationPolicyV1 } from "@/lib/trip-policy";
import { supportConditionsV1, type SupportSet } from "@/lib/support-conditions";
import type { ValidTripConditions } from "@/lib/trip-conditions";
import type { ReferenceItineraryResult } from "@/lib/reference-itinerary";

/*
 * 조건 입력 화면의 표시·전환만 확인한다. 검증 규칙 자체는
 * lib/__tests__/trip-conditions.test.ts가 다룬다. 같은 규칙을 두 곳에서 검증하지 않는다.
 */

async function fillConditions(startAt: string, returnBy: string) {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("어디서 출발해요?"), "seoul");
  await user.type(screen.getByLabelText("출발 일시"), startAt);
  await user.type(screen.getByLabelText("복귀 가능 일시"), returnBy);
  // 관심사는 1개 이상 필수다(DECISIONS.md 7.3절).
  await user.click(screen.getByRole("checkbox", { name: "역사" }));
  return user;
}

/* 화면 표시 테스트용 계약 데이터. 실제 화면 기본 경로는 E4의 결측 어댑터를 사용한다. */
function requestWithFixture(conditions: ValidTripConditions) {
  return Promise.resolve(
    evaluateRecommendationRequest(
      conditions,
      pocDataAdapter,
      recommendationPolicyV1,
    ),
  );
}

function itineraryWithFixture(
  input: Parameters<
    NonNullable<ComponentProps<typeof TripConditionsPage>["loadItinerary"]>
  >[0],
) {
  return Promise.resolve({
    kind: "reference-itinerary",
    destinationId: input.destinationId,
    conditions: input.conditions,
    originTravel: null,
    policyVersion: "2026-09-03",
    ordering: "matched-interest-evidence-desc:id-asc",
    disclaimer: {
      label: "참고용 계획",
      latestInfoAction: "방문 전 최신 운영·휴무·예약 정보를 확인",
    },
    guarantees: {
      operationChecked: false,
      restaurantAvailable: false,
      returnByChecked: false,
    },
    notices: [],
    places: [
      {
        id: "fixture-place",
        name: "테스트 유적",
        category: "관광지",
        matchedInterests: ["역사"],
        interestEvidence: [],
        interestEvidenceProvenance: {
          source: "테스트",
          collectedAt: "2026-09-03",
          dataStatus: "normal",
        },
        visit: {
          kind: "estimate",
          estimatedHours: 1.5,
          provenance: {
            source: "테스트",
            collectedAt: "2026-09-03",
            dataStatus: "estimate",
          },
        },
        broadTimeWindow: {
          startsAt: new Date("2026-09-12T10:00:00+09:00"),
          endsAt: new Date("2026-09-12T11:30:00+09:00"),
        },
        operation: {
          kind: "missing",
          reason: "운영 정보 없음",
          provenance: {
            source: "테스트",
            collectedAt: "2026-09-03",
            dataStatus: "missing",
          },
        },
        travelFromPrevious: null,
      },
    ],
  } satisfies ReferenceItineraryResult);
}

/** 첫 후보는 시간 제약 탈락, 공주만 이동시간 결측인 E4 혼합 결과를 만든다. */
function requestWithMixedData(conditions: ValidTripConditions) {
  const source: RecommendationDataSource = {
    listDestinations: () => pocDataAdapter.listDestinations(),
    lookupOriginTravelTime: (originId, destinationId, transport) => {
      if (destinationId === "gongju") return null;
      const travel = pocDataAdapter.lookupOriginTravelTime(
        originId,
        destinationId,
        transport,
      );
      return travel ? { ...travel, oneWayHours: 20 } : null;
    },
  };

  return Promise.resolve(
    evaluateRecommendationRequest(conditions, source, recommendationPolicyV1),
  );
}

describe("조건 입력 화면", () => {
  it("로더가 준 지원 조건으로 출발지 선택지와 기준일을 함께 표시한다", () => {
    const alternateSupport: SupportSet = {
      ...supportConditionsV1,
      version: "test-version",
      basisDate: "2026-09-03",
      origins: [
        {
          ...supportConditionsV1.origins[0],
          id: "test-origin",
          name: "테스트 출발지",
        },
      ],
    };
    render(<TripConditionsPage loadConditions={() => alternateSupport} />);

    expect(
      screen.getByRole("option", { name: "테스트 출발지" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "서울특별시" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("지원 조건 2026-09-03 기준")).toBeInTheDocument();
  });

  it("지원 조건을 읽지 못하면 추천 대신 재시도를 안내하고, 성공 시에만 입력을 보인다", async () => {
    let attempts = 0;
    render(
      <TripConditionsPage
        loadConditions={() => {
          attempts += 1;
          if (attempts === 1) throw new Error("지원 조건을 읽지 못함");
          return supportConditionsV1;
        }}
      />,
    );

    expect(
      screen.getByRole("alert", { name: "지원 조건 오류" }),
    ).toHaveTextContent("임의 조건으로 추천하지 않았어요");
    expect(
      screen.queryByRole("button", { name: "갈 수 있는 곳 찾기" }),
    ).not.toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "다시 시도하기" }));

    expect(
      screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
    ).toBeInTheDocument();
  });

  it("필수값 없이 제출하면 요약 배너와 항목별 오류를 보이고 제출 버튼을 비활성으로 만든다", async () => {
    const user = userEvent.setup();
    render(<TripConditionsPage />);

    await user.click(
      screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
    );

    expect(screen.getByText("고쳐야 할 항목이 4개 있어요")).toBeInTheDocument();
    expect(
      screen.getByText("관심사를 하나 이상 골라 주세요."),
    ).toBeInTheDocument();
    expect(screen.getByText("출발지를 골라 주세요.")).toBeInTheDocument();
    expect(screen.getByText("출발 일시를 골라 주세요.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
    ).toBeDisabled();
    expect(
      screen.getByText("고쳐야 할 항목이 남아 있어 아직 찾을 수 없어요"),
    ).toBeInTheDocument();
  });

  it("복귀가 출발보다 이르면 제출을 막고 복귀 항목에 오류를 붙인다", async () => {
    render(<TripConditionsPage />);

    const user = await fillConditions("2026-09-12T08:00", "2026-09-12T06:00");
    await user.click(
      screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
    );

    expect(
      screen.getByText("복귀 시각이 출발보다 빨라요. 출발 이후로 맞춰 주세요."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "제출한 여행 조건" }),
    ).not.toBeInTheDocument();
  });

  it("유효한 조건을 제출하면 조건 요약을 보인다", async () => {
    render(<TripConditionsPage />);

    const user = await fillConditions("2026-09-12T08:00", "2026-09-13T20:00");
    expect(screen.getByText("쓸 수 있는 시간 36시간")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
    );

    const summary = screen.getByRole("region", { name: "제출한 여행 조건" });
    expect(summary).toBeInTheDocument();
    expect(screen.getByText("서울특별시 출발")).toBeInTheDocument();
    expect(screen.getByText("1박 2일")).toBeInTheDocument();
    expect(
      screen.getByText("Asia/Seoul · 지원 조건 2026-09-02"),
    ).toBeInTheDocument();
  });

  it("출발과 복귀가 동시에 잘못되면 두 오류 메시지가 모두 보인다", async () => {
    const user = userEvent.setup();
    render(<TripConditionsPage />);

    await user.click(
      screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
    );

    expect(screen.getByText("출발 일시를 골라 주세요.")).toBeInTheDocument();
    expect(
      screen.getByText("복귀 가능 일시를 골라 주세요."),
    ).toBeInTheDocument();
  });

  it("요약 배너가 세는 개수와 화면에 보이는 항목별 오류 메시지 수가 일치한다", async () => {
    const user = userEvent.setup();
    const { container } = render(<TripConditionsPage />);

    await user.click(
      screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
    );

    const banner = screen.getByText(/고쳐야 할 항목이 (\d+)개 있어요/);
    const counted = Number(/(\d+)개/.exec(banner.textContent ?? "")?.[1]);
    expect(counted).toBeGreaterThan(0);
    expect(container.querySelectorAll(".dd-field-error__text")).toHaveLength(
      counted,
    );
  });

  it("각 입력의 aria-describedby가 자기 오류 메시지를 가리킨다", async () => {
    const user = userEvent.setup();
    render(<TripConditionsPage />);

    await user.click(
      screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
    );

    const startAt = screen.getByLabelText("출발 일시");
    const returnBy = screen.getByLabelText("복귀 가능 일시");
    const origin = screen.getByLabelText("어디서 출발해요?");

    for (const [input, message] of [
      [startAt, "출발 일시를 골라 주세요."],
      [returnBy, "복귀 가능 일시를 골라 주세요."],
      [origin, "출발지를 골라 주세요."],
    ] as const) {
      const describedBy = input.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const described = (describedBy ?? "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ");
      expect(described).toContain(message);
    }
  });

  it("오류가 없으면 입력에 오류 메시지가 연결되지 않는다", async () => {
    render(<TripConditionsPage />);

    await fillConditions("2026-09-12T08:00", "2026-09-13T20:00");

    for (const label of ["출발 일시", "복귀 가능 일시"]) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute(
        "aria-describedby",
      );
    }
    // 출발지는 오류가 없을 때 안내 문구가 연결된다.
    const describedBy = screen
      .getByLabelText("어디서 출발해요?")
      .getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toContain(
      "승인된 도시 대표 기준점에서 출발해요.",
    );
  });

  it("자차만 정식 이동수단으로 보이고 대중교통 선택지는 없다", () => {
    render(<TripConditionsPage />);

    expect(screen.getByRole("radio", { name: "자차" })).toBeEnabled();
    expect(
      screen.queryByRole("radio", { name: "대중교통" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("현재는 자차 여행만 지원해요."),
    ).toBeInTheDocument();
  });

  it("관심사 칩은 선택 상태를 토글한다", async () => {
    const user = userEvent.setup();
    render(<TripConditionsPage />);

    const chip = screen.getByRole("checkbox", { name: "역사" });
    expect(chip).toHaveAttribute("aria-checked", "false");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-checked", "true");
  });
});

/*
 * F-02·F-03 추천 계산 → 추천 결과 / 결과 없음.
 * 판정·점수 규칙 자체는 lib/__tests__/recommendation.test.ts가 다룬다. 여기서는 화면 전환과
 * 표시만 확인한다.
 */
describe("추천 결과 화면", () => {
  async function submitTrip(startAt: string, returnBy: string) {
    const user = await fillConditions(startAt, returnBy);
    await user.click(
      screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
    );
    return user;
  }

  it("제출 직후에는 조건 요약을 유지한 채 계산 중 상태를 보인다", async () => {
    render(
      <TripConditionsPage
        loadRecommendations={() => new Promise(() => undefined)}
      />,
    );
    await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");

    expect(screen.getByRole("status")).toHaveTextContent("계산하고 있어요");
    // 계산 중에도 조건 요약이 남는다(4장 "로딩 중 조건 요약 유지").
    expect(
      screen.getByRole("region", { name: "제출한 여행 조건" }),
    ).toBeInTheDocument();
    expect(screen.getByText("서울특별시 출발")).toBeInTheDocument();
  });

  it("기본 정적 데이터로 시간 제약을 통과한 추천과 추정 근거를 보인다", async () => {
    render(<TripConditionsPage />);
    await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");

    expect(
      await screen.findByText(/다녀올 수 있는 곳 3군데/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/이동시간 추정/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/OSRM 공개 데모 서버 수동 경로 조회/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("alert", { name: "추천 데이터 부족" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("더 이른 시간에 출발하기"),
    ).not.toBeInTheDocument();
  });

  it("혼합 결과에서는 실제로 결측된 후보의 출처와 사유만 빠짐없이 보인다", async () => {
    render(<TripConditionsPage loadRecommendations={requestWithMixedData} />);
    await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");

    const unavailable = await screen.findByRole("alert", {
      name: "추천 데이터 부족",
    });
    expect(unavailable).toHaveTextContent("공주");
    expect(unavailable).toHaveTextContent("이동시간 · 출처 미기록");
    expect(unavailable).toHaveTextContent("상태 결측");
    expect(unavailable).not.toHaveTextContent("상태 추정");
  });

  it("통과 후보가 있으면 후보 카드와 근거·신뢰도를 보인다", async () => {
    render(<TripConditionsPage loadRecommendations={requestWithFixture} />);
    await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");

    await waitFor(() =>
      expect(screen.getByText(/다녀올 수 있는 곳 \d+군데/)).toBeInTheDocument(),
    );

    // 시간 적합순 정렬: 왕복이 가장 짧은 공주가 앞선다(경주 3.5h / 공주 1.6h / 강릉 2.8h).
    const names = screen
      .getAllByRole("heading", { level: 2 })
      .map((node) => node.textContent);
    expect(names[0]).toBe("공주");
    expect(screen.getByText("가장 잘 맞아요")).toBeInTheDocument();
    // F-03: 점수 숫자를 보이면 항목과 계산 원칙을 함께 보인다.
    expect(
      screen.getAllByText(/쓸 수 있는 시간 중 이동에 쓰이지 않은 비율/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/고른 관심사 중 겹친 개수/).length,
    ).toBeGreaterThan(0);
    // F-05: 이동시간이 추정·목업임을 표시한다.
    expect(
      screen.getAllByText(/이동시간 추정.*PoC 목업/).length,
    ).toBeGreaterThan(0);
    // E5: 카드가 계산에 쓴 데이터의 출처·수집 시각·상태를 함께 보존해 표시한다.
    expect(screen.getAllByText(/수집 2026-08-30/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/상태 추정/).length).toBeGreaterThan(0);
  });

  it("기본 후보를 고르면 실제 장소 앵커의 참고 계획을 보인다", async () => {
    render(<TripConditionsPage />);
    const user = await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");

    const button = await screen.findByRole("button", {
      name: "공주 일정 보기",
    });
    await user.click(button);

    expect(
      screen.getByRole("region", { name: "참고용 여행 계획" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /공산성 광복루/ }),
    ).toBeInTheDocument();
  });

  it("선택한 후보의 참고 계획은 방문 순서·시간대·근거와 주의문을 보인다", async () => {
    render(
      <TripConditionsPage
        loadRecommendations={requestWithFixture}
        loadItinerary={itineraryWithFixture}
      />,
    );
    const user = await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");
    await user.click(
      await screen.findByRole("button", { name: "공주 일정 보기" }),
    );
    expect(
      await screen.findByRole("region", { name: "참고용 여행 계획" }),
    ).toHaveTextContent("테스트 유적");
    expect(screen.getByText(/참고용 계획/)).toBeInTheDocument();
    expect(screen.getByText(/방문 전 최신 운영/)).toBeInTheDocument();
    expect(screen.getByText(/넓은 시간대/)).toBeInTheDocument();
    expect(screen.getByText(/관심사 근거: 역사/)).toBeInTheDocument();
  });

  it("참고 계획 계산 중 로딩과 오류·재시도를 표시한다", async () => {
    let rejectRequest: ((error: Error) => void) | undefined;
    const loadItinerary = () =>
      new Promise<never>((_, reject) => {
        rejectRequest = reject;
      });
    render(
      <TripConditionsPage
        loadRecommendations={requestWithFixture}
        loadItinerary={loadItinerary}
      />,
    );
    const user = await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");
    await user.click(
      await screen.findByRole("button", { name: "공주 일정 보기" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "참고 계획을 준비하고 있어요",
    );
    rejectRequest?.(new Error("fixture failure"));
    expect(
      await screen.findByRole("alert", { name: "참고 계획 생성 오류" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도하기" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "참고 계획을 준비하고 있어요",
    );
  });

  it("모든 후보가 탈락하면 결과 없음을 정상 상태로 보이고 조정 행동을 안내한다", async () => {
    render(<TripConditionsPage loadRecommendations={requestWithFixture} />);
    await submitTrip("2026-09-12T09:00", "2026-09-12T14:00");

    const empty = await screen.findByRole("region", { name: "결과 없음" });
    expect(empty).toHaveTextContent("최소로 머물러야 하는 4시간(당일치기)");
    expect(screen.getByText("더 이른 시간에 출발하기")).toBeInTheDocument();
    expect(screen.getByText("복귀 시간을 늦춰보기")).toBeInTheDocument();
    // 후보를 지어내지 않는다.
    expect(
      screen.queryByText(/다녀올 수 있는 곳 \d+군데/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("조건 수정하기를 누르면 입력 화면으로 돌아간다", async () => {
    render(<TripConditionsPage loadRecommendations={requestWithFixture} />);
    const user = await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");

    await screen.findByText(/다녀올 수 있는 곳/);
    await user.click(screen.getByRole("button", { name: "조건 수정하기" }));

    expect(
      screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }),
    ).toBeInTheDocument();
  });
});
