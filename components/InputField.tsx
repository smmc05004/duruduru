import type { InputHTMLAttributes } from "react";

/**
 * 입력 필드. 상태(기본·포커스·오류·비활성)를 props로 받는다.
 *
 * 포커스 표현은 `:focus-within`으로 CSS가 처리한다. "입력 중"은 상태 prop이 아니라
 * 실제 포커스와 어긋날 수 없어야 한다.
 * 비활성일 때 값 자리는 `--skeleton` 블록으로 바뀐다(DESIGN_TOKENS.md 입력 필드 표).
 */
type InputFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className"
> & {
  id: string;
  /** 컨트롤 안 왼쪽에 붙는 짧은 라벨. 예: "출발" */
  prefix?: string;
  invalid?: boolean;
};

export function InputField({
  id,
  prefix,
  invalid = false,
  disabled = false,
  ...rest
}: InputFieldProps) {
  const classes = [
    "dd-control",
    invalid ? "dd-control--invalid" : null,
    disabled ? "dd-control--disabled" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {prefix ? (
        <span className="dd-control__prefix" aria-hidden="true">
          {prefix}
        </span>
      ) : null}
      {disabled ? (
        <span className="dd-control__skeleton" aria-hidden="true" />
      ) : (
        <input
          id={id}
          className="dd-control__input"
          aria-invalid={invalid || undefined}
          {...rest}
        />
      )}
    </div>
  );
}
