"use client";

import { useEffect, useRef } from "react";
import type {
  DetailTextField,
  NormalizedRestaurantDetail,
} from "@/lib/restaurant-detail";

/*
 * 음식점 상세 바텀 시트. 일정의 음식점 행을 누르면 서버 Route Handler가 `detailIntro2`로
 * 조회해 정규화한 값(lib/restaurant-detail.ts)을 보여준다.
 *
 * docs/design/DESIGN_TOKENS.md 「음식점 상세 시트」:
 * - 뒤 일정 화면은 흐리고, 시트는 --card 바탕 + 2px --line + 상단 --line-dashed 핸들.
 * - 운영시간 배지(--olive-soft), 휴무 배지(--mustard-soft), 대표 메뉴 목록.
 * - 조회 근거: 조회 시각과 "방문 전 재확인", "일정·시간표는 바뀌지 않음".
 * - 값이 비어 있으면 지어내지 않고 "확인 필요"(dashed 밑줄) 자리로 둔다.
 * - 상세 실패는 시트 안에서만 재시도한다. 일정 전체를 장애로 바꾸지 않는다.
 */

export type RestaurantDetailState =
  | { status: "loading" }
  | { status: "success"; detail: NormalizedRestaurantDetail }
  | { status: "error" };

type Props = {
  restaurantName: string;
  regionLabel: string;
  fetchedAt: string;
  state: RestaurantDetailState;
  onRetry: () => void;
  onClose: () => void;
};

const clockIcon = (
  <svg
    width="17"
    height="17"
    viewBox="0 0 20 20"
    fill="none"
    stroke="var(--olive-ink)"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="10" cy="10" r="7.2" />
    <path d="M10 6.2V10l2.8 1.8" />
  </svg>
);

const calendarIcon = (
  <svg
    width="17"
    height="17"
    viewBox="0 0 20 20"
    fill="none"
    stroke="var(--mustard-ink)"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 5h12v11H4zM4 8.5h12M8 3v3M12 3v3" />
  </svg>
);

const warningIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="var(--alert)"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 3.2l7 12.4H3z" />
    <path d="M10 7.8v3.4M10 13.6v.2" />
  </svg>
);

const retryIcon = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 20 20"
    fill="none"
    stroke="var(--on-dark)"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M16.4 10a6.4 6.4 0 1 1-2-4.6" />
    <path d="M16.6 3.4v3.2h-3.2" />
  </svg>
);

const infoIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 20 20"
    fill="none"
    stroke="var(--ink-faint)"
    strokeWidth="1.9"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="10" cy="10" r="7.2" />
    <path d="M10 9v4.4M10 6.4v.2" />
  </svg>
);

const UNKNOWN_TEXT = "정보가 없어요 · 방문 전 확인이 필요해요";

function FieldValue({ field }: { field: DetailTextField }) {
  if (field.status === "unknown")
    return (
      <p className="dd-detail-badge__value dd-detail-badge__value--unknown">
        {UNKNOWN_TEXT}
      </p>
    );
  return <p className="dd-detail-badge__value">{field.value}</p>;
}

function DetailBody({ detail }: { detail: NormalizedRestaurantDetail }) {
  return (
    <>
      <div className="dd-detail-fields">
        <div className="dd-detail-badge dd-detail-badge--hours">
          {clockIcon}
          <div>
            <p className="dd-detail-badge__label">운영시간</p>
            <FieldValue field={detail.openingHours} />
          </div>
        </div>
        <div className="dd-detail-badge dd-detail-badge--closed">
          {calendarIcon}
          <div>
            <p className="dd-detail-badge__label">휴무</p>
            <FieldValue field={detail.closedDays} />
          </div>
        </div>
      </div>

      <p className="dd-detail-menu__title">대표 메뉴</p>
      {detail.menus.status === "confirmed" ? (
        <ul className="dd-detail-menu__list">
          {detail.menus.items.map((item) => (
            <li key={item} className="dd-detail-menu__item">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dd-detail-menu__item dd-detail-menu__empty">
          {UNKNOWN_TEXT}
        </p>
      )}
    </>
  );
}

export function RestaurantDetailSheet({
  restaurantName,
  regionLabel,
  fetchedAt,
  state,
  onRetry,
  onClose,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="dd-sheet-overlay">
      <button
        type="button"
        className="dd-sheet-backdrop"
        aria-label="상세 닫기"
        onClick={onClose}
      />
      <div
        className="dd-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${restaurantName} 상세 정보`}
        tabIndex={-1}
        ref={sheetRef}
      >
        <div className="dd-sheet__handle" aria-hidden="true" />

        <div className="dd-sheet__head">
          <p className="dd-sheet__name">{restaurantName}</p>
          <span className="dd-sheet__kind">음식점</span>
        </div>
        <p className="dd-sheet__region">{regionLabel}</p>

        {state.status === "loading" ? (
          <p className="dd-notice" role="status">
            음식점 정보를 불러오고 있어요
          </p>
        ) : null}

        {state.status === "success" ? (
          <DetailBody detail={state.detail} />
        ) : null}

        {state.status === "error" ? (
          <section className="dd-sheet__error" role="alert">
            <div className="dd-sheet__error-head">
              {warningIcon}
              <div>
                <p className="dd-sheet__error-title">
                  이 음식점 정보를 불러오지 못했어요
                </p>
                <p className="dd-sheet__error-text">
                  상세 조회만 실패했어요. 일정과 다른 음식점은 그대로예요.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="dd-button dd-button--recover"
              onClick={onRetry}
            >
              {retryIcon}
              다시 시도하기
            </button>
          </section>
        ) : null}

        {state.status === "success" ? (
          <div className="dd-detail-basis">
            {infoIcon}
            <p>
              TourAPI 상세(detailIntro2) · {fetchedAt} 조회.
              운영시간·메뉴·휴무는 바뀔 수 있으니 방문 전 다시 확인하세요. 이
              조회는 확인용이라 일정의 식사 배치와 시간표를 바꾸지 않아요.
            </p>
          </div>
        ) : null}

        <button
          type="button"
          className="dd-button dd-button--secondary dd-sheet__close"
          onClick={onClose}
        >
          닫기
        </button>
      </div>
    </div>
  );
}
