import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";
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
  return user;
}

describe("조건 입력 화면", () => {
  it("필수값 없이 제출하면 요약 배너와 항목별 오류를 보이고 제출 버튼을 비활성으로 만든다", async () => {
    const user = userEvent.setup();
    render(<TripConditionsPage />);

    await user.click(screen.getByRole("button", { name: "갈 수 있는 곳 찾기" }));

    expect(screen.getByText("고쳐야 할 항목이 3개 있어요")).toBeInTheDocument();
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
