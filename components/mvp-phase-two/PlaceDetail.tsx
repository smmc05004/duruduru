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
function Field({ label, value }: { label: string; value: DetailTextField }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
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
    const before =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [onClose]);
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
        <h2 className="dd-sheet__name">{selected.place.title}</h2>
        <p>{selected.place.address || "제공 주소 없음"}</p>
        {query.isFetching ? (
          <p role="status">관광지 정보를 불러오고 있어요</p>
        ) : query.isError ? (
          <div role="alert">
            <p>{apiMessage(query.error)}</p>
            <button className="p2-control" onClick={() => void query.refetch()}>
              상세 다시 시도
            </button>
          </div>
        ) : detail ? (
          <>
            {query.data?.kind === "attraction" && query.data.partial ? (
              <p role="status">
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
              <Field label="이용시간" value={detail.openingHours} />
              <Field label="휴무" value={detail.closedDays} />
              <Field label="요금" value={detail.fees} />
              <Field label="연락처" value={detail.phone} />
            </dl>
            <p className="p2-muted">
              TourAPI · {detail.fetchedAt} 조회. 운영정보는 변경될 수 있으니
              방문 전 확인해 주세요.
            </p>
          </>
        ) : null}
        <button className="dd-button dd-button--secondary" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
