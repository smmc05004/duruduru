import type { SelectHTMLAttributes } from "react";

/**
 * 셀렉트. 입력 필드와 같은 상태 집합(기본·포커스·오류·비활성·미선택)을 쓰고
 * 오른쪽에 18px 아래꺾쇠를 둔다. 상태색이 바뀌면 꺾쇠 색도 함께 바뀐다(CSS가 처리한다).
 */
export type SelectOption = { value: string; label: string };

type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "className" | "children"
> & {
  id: string;
  options: SelectOption[];
  /** 값이 비었을 때 보이는 안내 문구. `--ink-faint`로 표시된다. */
  placeholder?: string;
  invalid?: boolean;
};

export function Select({
  id,
  options,
  placeholder,
  invalid = false,
  disabled = false,
  value,
  ...rest
}: SelectProps) {
  const isPlaceholder = !value;
  const classes = [
    "dd-control",
    invalid ? "dd-control--invalid" : null,
    disabled ? "dd-control--disabled" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <select
        id={id}
        className={[
          "dd-control__select",
          isPlaceholder ? "dd-control__select--placeholder" : null,
        ]
          .filter(Boolean)
          .join(" ")}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        className="dd-control__chevron"
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5.5 8L10 12.5 14.5 8" />
      </svg>
    </div>
  );
}
