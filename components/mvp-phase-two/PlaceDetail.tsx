"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { tripApi, apiMessage } from "@/lib/mvp-phase-two-client";
import type { Attraction, Restaurant } from "@/lib/mvp-phase-two-types";
import type { NormalizedAttractionDetail } from "@/lib/attraction-detail";
import type {
  DetailTextField,
  NormalizedRestaurantDetail,
} from "@/lib/restaurant-detail";
import { RestaurantDetailSheet } from "@/components/RestaurantDetailSheet";

export type SelectedPlace =
  | { kind: "attraction"; place: Attraction }
  | { kind: "restaurant"; place: Restaurant };
function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: DetailTextField;
  tone?: "hours" | "closed";
}) {
  return (
    <div className={tone ? `p2-detail-field--${tone}` : undefined}>
      <dt>{label}</dt>
      <dd
        className={
          value.status === "confirmed"
            ? undefined
            : "dd-detail-badge__value--unknown"
        }
      >
        {value.status === "confirmed"
          ? value.value
          : "제공 정보 없음 · 방문 전 확인"}
      </dd>
    </div>
  );
}
export function PlaceDetail({
  selected,
  onClose,
}: {
  selected: SelectedPlace;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const contentId = selected.place.contentId;
  const contentTypeId =
    selected.kind === "attraction" ? selected.place.contentTypeId : "39";
  const query = useQuery({
    queryKey: ["place-detail", selected.kind, contentId, contentTypeId],
    queryFn: async ({ signal }) => {
      if (selected.kind === "restaurant") {
        const { data } = await tripApi.get<{
          kind: "success";
          detail: NormalizedRestaurantDetail;
        }>(`/restaurants/${encodeURIComponent(contentId)}`, { signal });
        return { kind: "restaurant" as const, detail: data.detail };
      }
      const { data } = await tripApi.get<{
        kind: "success" | "partial";
        detail: NormalizedAttractionDetail;
      }>(`/attractions/${encodeURIComponent(contentId)}`, {
        params: { contentTypeId },
        signal,
      });
      return {
        kind: "attraction" as const,
        detail: data.detail,
        partial: data.kind === "partial",
      };
    },
    staleTime: 0,
  });
  useEffect(() => {
    if (selected.kind !== "attraction") return;
    const before =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && panel.current) {
        const focusable = panel.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], summary, [tabindex='0']",
        );
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [onClose, selected.kind]);
  if (selected.kind === "restaurant")
    return (
      <RestaurantDetailSheet
        restaurantName={selected.place.name}
        regionLabel={selected.place.address}
        fetchedAt={
          query.dataUpdatedAt
            ? new Date(query.dataUpdatedAt).toLocaleString("ko-KR", {
                timeZone: "Asia/Seoul",
              })
            : ""
        }
        state={
          query.isFetching
            ? { status: "loading" }
            : query.isError || query.data?.kind !== "restaurant"
              ? { status: "error" }
              : { status: "success", detail: query.data.detail }
        }
        onRetry={() => void query.refetch()}
        onClose={onClose}
      />
    );
  const detail =
    query.data?.kind === "attraction" ? query.data.detail : undefined;
  return (
    <div className="dd-sheet-overlay">
      <button
        className="dd-sheet-backdrop"
        aria-label="상세 닫기"
        onClick={onClose}
      />
      <div
        className="dd-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${selected.place.title} 관광지 상세`}
        ref={panel}
        tabIndex={-1}
      >
        <div className="dd-sheet__handle" />
        <div className="dd-sheet__head">
          <h2 className="dd-sheet__name">{selected.place.title}</h2>
          <span className="dd-sheet__kind">관광지</span>
        </div>
        <p className="dd-sheet__region">
          {selected.place.address || "제공 주소 없음"}
        </p>
        {query.isFetching ? (
          <div className="dd-detail-fields" role="status">
            <p>관광지 정보를 불러오고 있어요</p>
            <div className="p2-loading-line dd-skeleton" aria-hidden="true" />
            <div className="p2-loading-line dd-skeleton" aria-hidden="true" />
          </div>
        ) : query.isError ? (
          <div className="dd-sheet__error" role="alert">
            <p>{apiMessage(query.error)}</p>
            <button
              className="dd-button p2-retry"
              onClick={() => void query.refetch()}
            >
              상세 다시 시도
            </button>
          </div>
        ) : detail ? (
          <>
            {query.data?.kind === "attraction" && query.data.partial ? (
              <p className="p2-notice" role="status">
                일부 정보만 가져왔어요. 제공되지 않은 항목은 방문 전 확인해
                주세요.
              </p>
            ) : null}
            {detail.imageUrl ? (
              <figure className="p2-detail-photo">
                {/* TourAPI Type1 확인 사진만 서버가 반환한다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={detail.imageUrl}
                  alt={selected.place.title}
                  loading="lazy"
                />
                <figcaption>
                  사진: 한국관광공사 TourAPI · 공공누리 제1유형
                </figcaption>
              </figure>
            ) : null}
            <dl className="p2-detail-fields">
              <Field label="장소명" value={detail.title} />
              <Field label="주소" value={detail.address} />
              <Field label="소개" value={detail.overview} />
              <Field
                label="이용시간"
                value={detail.openingHours}
                tone="hours"
              />
              <Field label="휴무" value={detail.closedDays} tone="closed" />
              <Field label="요금" value={detail.fees} />
              <Field label="연락처" value={detail.phone} />
            </dl>
            <div className="dd-detail-basis">
              <p>
                운영정보는 변경될 수 있으니 방문 전 확인해 주세요. 이 조회는
                계획의 시간표를 바꾸지 않아요.
              </p>
            </div>
            <details className="p2-basis">
              <summary>정보 출처·조회 시각</summary>
              <p>한국관광공사 TourAPI · {detail.fetchedAt} 조회</p>
            </details>
          </>
        ) : null}
        <button className="dd-button dd-button--secondary" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
