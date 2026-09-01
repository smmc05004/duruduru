import { describe, expect, it } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TripConditionsPage from "../page";

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

describe("조건 입력 화면", () => {
  it("필수값 없이 제출하면 요약 배너와 항목별 오류를 보이고 제출 버튼을 비활성으로 만든다", async () => {
    const user = userEvent.setup();
    render(<TripConditionsPage />);

    await user.click(screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }));

    expect(screen.getByText("고쳐야 할 항목이 4개 있어요")).toBeInTheDocument();
    expect(screen.getByText("관심사를 하나 이상 골라 주세요.")).toBeInTheDocument();
    expect(screen.getByText("출발지를 골라 주세요.")).toBeInTheDocument();
    expect(screen.getByText("출발 일시를 골라 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "갈 수 있는 곳 찾기" })).toBeDisabled();
    expect(screen.getByText("고쳐야 할 항목이 남아 있어 아직 찾을 수 없어요")).toBeInTheDocument();
  });

  it("복귀가 출발보다 이르면 제출을 막고 복귀 항목에 오류를 붙인다", async () => {
    render(<TripConditionsPage />);

    const user = await fillConditions("2026-09-12T08:00", "2026-09-12T06:00");
    await user.click(screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }));

    expect(screen.getByText("복귀 시각이 출발보다 빨라요. 출발 이후로 맞춰 주세요.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "제출한 여행 조건" })).not.toBeInTheDocument();
  });

  it("유효한 조건을 제출하면 조건 요약을 보인다", async () => {
    render(<TripConditionsPage />);

    const user = await fillConditions("2026-09-12T08:00", "2026-09-13T20:00");
    expect(screen.getByText("쓸 수 있는 시간 36시간")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }));

    const summary = screen.getByRole("region", { name: "제출한 여행 조건" });
    expect(summary).toBeInTheDocument();
    expect(screen.getByText("서울 출발")).toBeInTheDocument();
  });

  it("출발과 복귀가 동시에 잘못되면 두 오류 메시지가 모두 보인다", async () => {
    const user = userEvent.setup();
    render(<TripConditionsPage />);

    await user.click(screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }));

    expect(screen.getByText("출발 일시를 골라 주세요.")).toBeInTheDocument();
    expect(screen.getByText("복귀 가능 일시를 골라 주세요.")).toBeInTheDocument();
  });

  it("요약 배너가 세는 개수와 화면에 보이는 항목별 오류 메시지 수가 일치한다", async () => {
    const user = userEvent.setup();
    const { container } = render(<TripConditionsPage />);

    await user.click(screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }));

    const banner = screen.getByText(/고쳐야 할 항목이 (\d+)개 있어요/);
    const counted = Number(/(\d+)개/.exec(banner.textContent ?? "")?.[1]);
    expect(counted).toBeGreaterThan(0);
    expect(container.querySelectorAll(".dd-field-error__text")).toHaveLength(counted);
  });

  it("각 입력의 aria-describedby가 자기 오류 메시지를 가리킨다", async () => {
    const user = userEvent.setup();
    render(<TripConditionsPage />);

    await user.click(screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }));

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
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-describedby");
    }
    // 출발지는 오류가 없을 때 안내 문구가 연결된다.
    const describedBy = screen.getByLabelText("어디서 출발해요?").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toContain(
      "지금은 주요 도시 단위로만 고를 수 있어요.",
    );
  });

  it("대중교통은 고를 수 없다", () => {
    render(<TripConditionsPage />);

    expect(screen.getByRole("radio", { name: "대중교통" })).toBeDisabled();
    expect(screen.getByText("대중교통은 아직 준비 중이라 고를 수 없어요.")).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }));
    return user;
  }

  it("제출 직후에는 조건 요약을 유지한 채 계산 중 상태를 보인다", async () => {
    render(<TripConditionsPage />);
    await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");

    expect(screen.getByRole("status")).toHaveTextContent("계산하고 있어요");
    // 계산 중에도 조건 요약이 남는다(4장 "로딩 중 조건 요약 유지").
    expect(screen.getByRole("region", { name: "제출한 여행 조건" })).toBeInTheDocument();
    expect(screen.getByText("서울 출발")).toBeInTheDocument();
  });

  it("통과 후보가 있으면 후보 카드와 근거·신뢰도를 보인다", async () => {
    render(<TripConditionsPage />);
    await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");

    await waitFor(() => expect(screen.getByText(/다녀올 수 있는 곳 \d+군데/)).toBeInTheDocument());

    // 시간 적합순 정렬: 왕복이 가장 짧은 공주가 앞선다(경주 3.5h / 공주 1.6h / 강릉 2.8h).
    const names = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
    expect(names[0]).toBe("공주");
    expect(screen.getByText("가장 잘 맞아요")).toBeInTheDocument();
    // F-03: 점수 숫자를 보이면 항목과 계산 원칙을 함께 보인다.
    expect(screen.getAllByText(/쓸 수 있는 시간 중 이동에 쓰이지 않은 비율/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/고른 관심사 중 겹친 개수/).length).toBeGreaterThan(0);
    // F-05: 이동시간이 추정·목업임을 표시한다.
    expect(screen.getAllByText(/이동시간 추정 · PoC 목업/).length).toBeGreaterThan(0);
  });

  it("후보를 고르면 선택 상태로 남고, 일정 결과가 아직 없다는 것을 알린다", async () => {
    render(<TripConditionsPage />);
    const user = await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");

    const button = await screen.findByRole("button", { name: "공주 일정 보기" });
    await user.click(button);

    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/일정 결과 화면은 아직 준비 중/)).toBeInTheDocument();
  });

  it("모든 후보가 탈락하면 결과 없음을 정상 상태로 보이고 조정 행동을 안내한다", async () => {
    render(<TripConditionsPage />);
    await submitTrip("2026-09-12T09:00", "2026-09-12T14:00");

    const empty = await screen.findByRole("region", { name: "결과 없음" });
    expect(empty).toHaveTextContent("최소로 머물러야 하는 4시간(당일치기)");
    expect(screen.getByText("더 이른 시간에 출발하기")).toBeInTheDocument();
    expect(screen.getByText("복귀 시간을 늦춰보기")).toBeInTheDocument();
    // 후보를 지어내지 않는다.
    expect(screen.queryByText(/다녀올 수 있는 곳 \\d+군데/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("조건 수정하기를 누르면 입력 화면으로 돌아간다", async () => {
    render(<TripConditionsPage />);
    const user = await submitTrip("2026-09-12T08:00", "2026-09-13T20:00");

    await screen.findByText(/다녀올 수 있는 곳/);
    await user.click(screen.getByRole("button", { name: "조건 수정하기" }));

    expect(screen.getByRole("button", { name: "갈 수 있는 곳 찾기" })).toBeInTheDocument();
  });
});
