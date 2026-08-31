import type { ReactNode } from "react";

/**
 * 입력 항목 하나를 담는 카드. 라벨·컨트롤·보조 문구·항목 오류를 한 자리에 모은다.
 *
 * 검증 오류는 항목 단위로 붙인다(docs/design/DESIGN_TOKENS.md 검증 오류 표현 규칙).
 * 상단 요약 배너만으로 어느 항목인지 알 수 있게 하지 않는다.
 *
 * 카드 하나가 입력 두 개를 담을 수 있어서(출발·복귀 일시) 오류는 목록으로 받는다.
 * 하나만 골라 보여 주면 요약 배너가 세는 개수와 화면에 보이는 메시지 수가 어긋난다.
 */

/** 오류를 낸 입력의 id와 메시지. id로 오류 텍스트 엘리먼트의 `id`를 만든다. */
export type FieldCardError = { inputId: string; message: string };

/** 오류 텍스트 엘리먼트의 id. 입력의 `aria-describedby`가 이 값을 가리킨다. */
export function fieldErrorId(inputId: string) {
  return `${inputId}-error`;
}

/** 안내 문구 엘리먼트의 id. */
export function fieldHintId(inputId: string) {
  return `${inputId}-hint`;
}

type FieldCardProps = {
  label: string;
  /** 라벨 뒤에 붙는 보조 문구. 예: "· 안 골라도 괜찮아요" */
  labelAside?: string;
  /** 컨트롤 아래 안내 문구(정상 상태) */
  hint?: string;
  /** 안내 문구를 연결할 입력의 id. 주면 문구에 `id`가 붙는다. */
  hintFor?: string;
  /** 항목 검증 오류. 하나 이상 있으면 hint 대신 오류를 모두 보인다. */
  errors?: FieldCardError[];
  /** 라벨을 연결할 컨트롤의 id. 없으면 그룹 라벨로 렌더한다. */
  htmlFor?: string;
  children: ReactNode;
};

export function FieldCard({
  label,
  labelAside,
  hint,
  hintFor,
  errors = [],
  htmlFor,
  children,
}: FieldCardProps) {
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
      {errors.length > 0 ? (
        // 여러 오류를 한 번에 알린다. 입력마다 role="alert"를 두면 같은 제출에서 여러 번 끼어든다.
        <div role="alert">
          {errors.map((error) => (
            <div className="dd-field-error" key={error.inputId}>
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
              <p className="dd-field-error__text" id={fieldErrorId(error.inputId)}>
                {error.message}
              </p>
            </div>
          ))}
        </div>
      ) : hint ? (
        <p className="dd-field-card__hint" id={hintFor ? fieldHintId(hintFor) : undefined}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
