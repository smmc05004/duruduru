/**
 * 칩. 선택 가능한 칩(관심사)과 읽기 전용 칩(조건 요약)을 변형으로 나눈다.
 *
 * 읽기 전용 칩은 44px 최소 높이 규칙을 강제하지 않고 버튼으로 렌더하지 않는다
 * (DESIGN_TOKENS.md 칩 표). 누를 수 없는 것을 버튼으로 만들지 않는다.
 */
type SelectableChipProps = {
  variant: "selectable";
  label: string;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

type SummaryChipProps = {
  variant: "summary";
  label: string;
};

type ChipProps = SelectableChipProps | SummaryChipProps;

export function Chip(props: ChipProps) {
  if (props.variant === "summary") {
    return <span className="dd-chip dd-chip--summary">{props.label}</span>;
  }

  const { label, selected, disabled = false, onToggle } = props;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      className={["dd-chip", selected ? "dd-chip--selected" : null]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}
