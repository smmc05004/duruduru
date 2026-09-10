"use client";
import { useState } from "react";
import {
  ORIGIN_REGIONS,
  originRegion,
  searchOriginRegions,
} from "@/lib/origin-regions";

const provinces = [...new Set(ORIGIN_REGIONS.map((row) => row.province))];
export function OriginSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [province, setProvince] = useState("");
  const options = searchOriginRegions(query, province);
  const selected = originRegion(value);
  return (
    <div className="p2-form">
      <label>
        출발 지역 검색
        <input
          aria-label="출발 지역 검색"
          value={query}
          placeholder="강남, 수원, 해운대"
          onChange={(event) => {
            setQuery(event.target.value);
            onChange("");
          }}
        />
      </label>
      <label>
        출발 시도
        <select
          aria-label="출발 시도"
          value={province}
          onChange={(event) => {
            setProvince(event.target.value);
            setQuery("");
            onChange("");
          }}
        >
          <option value="">전체 시도</option>
          {provinces.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        출발 지역 선택
        <select
          aria-label="출발 지역 선택"
          value={selected?.id ?? ""}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">표준 지역을 선택해 주세요</option>
          {options.map((row) => (
            <option key={row.id} value={row.id} disabled={!row.supported}>
              {row.label}
              {row.supported ? "" : " · 자동차 경로 데이터 없음"}
            </option>
          ))}
        </select>
      </label>
      <p role="status">
        {selected
          ? `${selected.label} 대표점 기준이에요.`
          : options.length
            ? "검색 결과에서 지역을 선택해 주세요. 구가 나뉜 도시는 구까지 선택해요."
            : "일치하는 지원 지역이 없어요. 검색어나 시도를 바꿔 주세요."}
      </p>
      <p className="p2-muted">
        집 주소·읍·면·리 기준이 아니에요. 매핑 미확인 지역은 선택 목록에서
        제외하며 제주·울릉은 자동차 경로 데이터가 없어 선택할 수 없어요.
      </p>
    </div>
  );
}
