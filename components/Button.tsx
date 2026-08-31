import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * 버튼. 변형과 상태를 props로 받는다(docs/design/DESIGN_TOKENS.md 버튼 표).
 *
 * 비활성은 네이티브 `disabled`로 표현한다. 별도 변형을 만들면 실제로 눌리는 버튼과
 * 눌리는 것처럼 보이는 버튼이 갈린다.
 *
 * `장애 복구` 변형은 데이터 장애 화면 전용이라 이 화면 범위에서 만들지 않았다.
 */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: "primary" | "secondary";
  children: ReactNode;
};

export function Button({ variant, children, className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={["dd-button", `dd-button--${variant}`, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
