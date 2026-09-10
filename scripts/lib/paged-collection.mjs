/**
 * 페이지 단위 수집의 순수 공통 로직 (결함 1·3 공용).
 *
 * 두 수집기 — `scripts/build-region-profile.mjs`(관광지 프로필, 스펙 단위)와
 * `scripts/build-central-attractions.mjs`(중심 관광지, 지역 단위) — 가 같은 규칙으로
 *   (1) 재개 시 이미 성공한 페이지를 다시 호출하지 않고,
 *   (2) 수집 완전성(건수 부족·페이지 누락·페이지 간 중복·페이지별 총건수 변동)을 검증한다.
 *
 * 네트워크·파일 IO 없음. `scripts/__tests__/`가 직접 import 한다.
 */

/** declaredTotal·pageSize 로 계산한 기대 페이지 수(최소 1). */
export function expectedPageCount(declaredTotal, pageSize) {
  const total = Number(declaredTotal);
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * declaredTotal·pageSize 기준으로 아직 조회하지 않은 페이지 번호(오름차순).
 * `--resume` 이 성공한 페이지를 건너뛰고 미수집·실패 페이지만 잇는 데 쓴다.
 */
export function pendingPageNumbers(declaredTotal, pageSize, savedPageNos = []) {
  const expected = expectedPageCount(declaredTotal, pageSize);
  const saved = new Set([...savedPageNos].map(Number));
  const pages = [];
  for (let page = 1; page <= expected; page += 1) {
    if (!saved.has(page)) pages.push(page);
  }
  return pages;
}

/**
 * 한 조회 단위(스펙 또는 지역)의 수집 완전성을 평가한다.
 *
 * @param {object} params
 * @param {number} params.declaredTotal  첫 페이지 응답의 `totalCount`(기준값).
 * @param {number} params.pageSize
 * @param {Array<{ pageNo: number, totalCount: number, ids: string[] }>} params.pages
 *        조회한 각 페이지의 번호·응답 totalCount·항목 ID 목록.
 * @param {number} [params.tolerance=0]  허용 부족분(기본 0 — 실측 드리프트가 0).
 * @returns {{
 *   expectedPageCount: number,
 *   fetchedPageNos: number[],
 *   missingPages: number[],
 *   totalCountValues: number[],
 *   totalCountDrifted: boolean,
 *   uniqueCount: number,
 *   duplicateCount: number,
 *   crossPageDuplicateCount: number,
 *   shortfall: number,
 *   overCount: number,
 *   blockers: string[],
 * }}
 */
export function assessCompleteness({
  declaredTotal,
  pageSize,
  pages,
  tolerance = 0,
}) {
  const expected = expectedPageCount(declaredTotal, pageSize);
  const fetchedPageNos = [
    ...new Set(pages.map((page) => Number(page.pageNo))),
  ].sort((a, b) => a - b);
  const missingPages = [];
  for (let page = 1; page <= expected; page += 1) {
    if (!fetchedPageNos.includes(page)) missingPages.push(page);
  }

  const totalCountValues = [
    ...new Set(
      pages
        .map((page) => Number(page.totalCount))
        .filter((value) => Number.isFinite(value)),
    ),
  ];
  const totalCountDrifted = totalCountValues.length > 1;

  const seen = new Set();
  let duplicateCount = 0;
  let crossPageDuplicateCount = 0;
  for (const page of [...pages].sort(
    (a, b) => Number(a.pageNo) - Number(b.pageNo),
  )) {
    const inThisPage = new Set();
    for (const rawId of page.ids ?? []) {
      const id = String(rawId ?? "").trim();
      if (!id) continue;
      if (seen.has(id)) {
        duplicateCount += 1;
        // 같은 페이지 안의 중복은 원천 자체의 중복(정상 제거 대상)이지만,
        // 다른 페이지에서 다시 나온 ID는 스냅샷이 흔들렸다는 신호다.
        if (!inThisPage.has(id)) crossPageDuplicateCount += 1;
        inThisPage.add(id);
        continue;
      }
      seen.add(id);
      inThisPage.add(id);
    }
  }
  const uniqueCount = seen.size;
  const total = Number(declaredTotal);
  const hasTotal = Number.isFinite(total) && total > 0;
  const shortfall = hasTotal ? total - uniqueCount - duplicateCount : 0;
  const overCount = hasTotal ? uniqueCount - total : 0;

  const blockers = [];
  if (missingPages.length > 0) {
    blockers.push(
      `요청 페이지 범위에서 누락된 페이지 ${missingPages.join(", ")} (기대 ${expected}페이지, 조회 ${
        fetchedPageNos.join("/") || "없음"
      })`,
    );
  }
  if (totalCountDrifted) {
    blockers.push(
      `페이지별 totalCount 변동(스냅샷 격리 없음 징후): ${totalCountValues.join(" / ")}`,
    );
  }
  if (crossPageDuplicateCount > 0) {
    blockers.push(`페이지 간 중복 ID ${crossPageDuplicateCount}건`);
  }
  if (shortfall > tolerance) {
    blockers.push(
      `실제 수집 건수 부족: totalCount ${total} vs 고유 ${uniqueCount}(+중복 ${duplicateCount}) → 부족 ${shortfall}`,
    );
  }
  if (hasTotal && overCount > tolerance) {
    blockers.push(
      `수집 고유 건수가 totalCount 초과: 고유 ${uniqueCount} vs totalCount ${total}`,
    );
  }

  return {
    expectedPageCount: expected,
    fetchedPageNos,
    missingPages,
    totalCountValues,
    totalCountDrifted,
    uniqueCount,
    duplicateCount,
    crossPageDuplicateCount,
    shortfall,
    overCount,
    blockers,
  };
}
