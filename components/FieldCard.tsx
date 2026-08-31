import type { ReactNode } from "react";

/**
 * 입력 항목 하나를 담는 카드. 라벨·컨트롤·보조 문구·항목 오류를 한 자리에 모은다.
 *
 * 검증 오류는 항목 단위로 붙인다(docs/design/DESIGN_TOKENS.md 검증 오류 표현 규칙).
 * 상단 요약 배너만으로 어느 항목인지 알 수 있게 하지 않는다.
 */
type FieldCardProps = {
  label: string;
  /** 라벨 뒤에 붙는 보조 문구. 예: "· 안 골라도 괜찮아요" */
  labelAside?: string;
  /** 컨트롤 아래 안내 문구(정상 상태) */
  hint?: string;
  /** 항목 검증 오류 메시지. 있으면 hint 대신 오류를 보인다. */
  error?: string;
  /** 라벨을 연결할 컨트롤의 id. 없으면 그룹 라벨로 렌더한다. */
  htmlFor?: string;
  children: ReactNode;
};

export function FieldCard({ label, labelAside, hint, error, htmlFor, children }: FieldCardProps) {
  const labelContent = (
    <>
      {label}
      {labelAside ? <span className="dd-field-card__label-aside"> {labelAside}</span> : null}
    </>
  );

  return (
    <div className="dd-field-card">
      {htmlFor ? (
        <label className="dd-field-card__label" htmlFor={htmlFor}>
          {labelContent}
        </label>
      ) : (
        <span className="dd-field-card__label">{labelContent}</span>
      )}
      <div className="dd-field-card__body">{children}</div>
      {error ? (
        <div className="dd-field-error" role="alert">
          <svg
            className="dd-field-error__icon"
            width="15"
            height="15"
            viewBox="0 0 20 20"
            fill="none"
            stroke="var(--alert)"
            strokeWidth="1.9"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="7.2" />
            <path d="M7.4 7.4l5.2 5.2M12.6 7.4l-5.2 5.2" />
          </svg>
          <p className="dd-field-error__text">{error}</p>
        </div>
      ) : hint ? (
        <p className="dd-field-card__hint">{hint}</p>
      ) : null}
    </div>
  );
}
