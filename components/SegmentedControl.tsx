import type { ReactNode } from "react";

/**
 * 세그먼티드 컨트롤. 한 줄에 2~3칸이고 칸마다 선택·미선택·비활성 상태를 가진다.
 *
 * 비활성 칸에는 왜 고를 수 없는지 컨트롤 아래에 적는다(DESIGN_TOKENS.md 세그먼티드 표).
 * 그 문구는 항목별 `disabledReason`을 모아 호출하는 쪽이 FieldCard의 hint로 넘긴다.
 */
export type SegmentedOption = {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

type SegmentedControlProps = {
  /** 라디오 그룹 접근성 라벨 */
  label: string;
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
};

export function SegmentedControl({ label, options, value, onChange, invalid = false }: SegmentedControlProps) {
  return (
    <div className="dd-segmented" role="radiogroup" aria-label={label} aria-invalid={invalid || undefined}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            className={["dd-segmented__item", selected ? "dd-segmented__item--selected" : null]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? <span className="dd-segmented__icon">{option.icon}</span> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
