"use client";

import { useState } from "react";
import type { Attraction } from "@/lib/mvp-phase-two-types";
import {
  buildMapSearchUrl,
  holidayWarningForVisit,
  overviewPreview,
  type VisitInfoEntry,
} from "@/lib/attraction-visit-info";

export function AttractionVisitInfo({
  attraction,
  visitAt,
  entry,
  onRequest,
}: {
  attraction: Attraction;
  visitAt: string;
  entry: VisitInfoEntry;
  onRequest: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const detail = entry.detail;
  const address =
    detail?.address.status === "confirmed"
      ? detail.address.value
      : attraction.address;
  const overview =
    detail?.overview.status === "confirmed" ? detail.overview.value : "";
  const closedDays =
    detail?.closedDays.status === "confirmed" ? detail.closedDays.value : "";
  const hasAddress = Boolean(address.trim());
  const holidayWarning =
    Boolean(closedDays) && holidayWarningForVisit(closedDays, visitAt);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyMessage("주소를 복사했어요.");
    } catch {
      setCopyMessage("주소를 선택해 복사해 주세요.");
    }
  }

  return (
    <section
      className="p2-visit-info"
      aria-label={`${attraction.title} 방문 정보`}
    >
      <div className="p2-visit-info__head">
        <strong>방문 정보</strong>
        <span aria-live="polite">
          {entry.status === "loading"
            ? "불러오는 중"
            : entry.status === "ready"
              ? "확인됨"
              : entry.status === "partial"
                ? "일부 확인됨"
                : entry.status === "unavailable"
                  ? "확인 필요"
                  : "아직 불러오지 않음"}
        </span>
      </div>
      {entry.status === "loading" ? (
        <p role="status">
          방문 정보를 불러오는 중이에요. 일정은 그대로 볼 수 있어요.
        </p>
      ) : null}
      {entry.status === "unavailable" ? (
        <p role="status">{entry.message ?? "제공 정보 없음 · 방문 전 확인"}</p>
      ) : null}
      {entry.status === "not-requested" || entry.status === "unavailable" ? (
        <button className="p2-control" onClick={onRequest}>
          방문정보 확인
        </button>
      ) : null}
      {detail ? (
        <div className="p2-visit-info__body">
          {detail.imageUrl &&
          detail.image?.license === "Type1" &&
          !imageFailed ? (
            <figure className="p2-detail-photo">
              {/* Server normalization admits only a Type1, approved TourAPI image origin. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={detail.imageUrl}
                alt=""
                loading="lazy"
                onError={() => setImageFailed(true)}
              />
              <figcaption>
                {detail.image.source} · 공공누리 제1유형 ·{" "}
                <a
                  href={detail.image.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  사진 출처 확인
                </a>
              </figcaption>
            </figure>
          ) : null}
          {overview ? (
            <div>
              <strong>소개</strong>
              <p>{expanded ? overview : overviewPreview(overview)}</p>
              {overview.length > 160 ? (
                <button
                  className="p2-text-button"
                  onClick={() => setExpanded(!expanded)}
                  aria-expanded={expanded}
                >
                  {expanded ? "접기" : "소개 펼쳐보기"}
                </button>
              ) : null}
            </div>
          ) : (
            <p>제공 정보 없음 · 방문 전 확인</p>
          )}
          {closedDays ? (
            <p>
              <strong>휴무 안내</strong> · {closedDays}
            </p>
          ) : null}
          {holidayWarning ? (
            <p className="p2-visit-info__warning" role="status">
              공공데이터 안내상 방문일이 정기휴무일과 겹쳐요. 운영 정보를
              확인하거나 장소를 바꿔 주세요.
            </p>
          ) : null}
          <p className="p2-muted">
            TourAPI 상세 · {detail.fetchedAt} 조회. 운영 정보는 방문 전 확인해
            주세요.
          </p>
        </div>
      ) : null}
      <p className="p2-visit-info__address">
        <strong>주소</strong> ·{" "}
        {hasAddress ? address : "주소가 없어 이름으로 지도에서 찾아요."}
      </p>
      <div className="p2-actions">
        {hasAddress ? (
          <button className="p2-control" onClick={() => void copyAddress()}>
            주소 복사
          </button>
        ) : null}
        <a
          className="p2-control"
          href={buildMapSearchUrl(hasAddress ? address : "", attraction.title)}
          target="_blank"
          rel="noopener noreferrer"
        >
          지도에서 장소 찾기
        </a>
      </div>
      {copyMessage ? <p role="status">{copyMessage}</p> : null}
    </section>
  );
}
