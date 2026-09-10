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
 * 페이지 하나가 담아야 하는 기대 항목 수.
 * - 마지막 전 페이지: `pageSize`
 * - 마지막 페이지: `totalCount % pageSize`(0이면 `pageSize`)
 * - totalCount 0 이하: 0 (빈 응답이 정상)
 */
export function expectedPageItemCount(declaredTotal, pageSize, pageNo) {
  const total = Number(declaredTotal);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const lastPage = expectedPageCount(total, pageSize);
  if (pageNo < lastPage) return pageSize;
  const remainder = total % pageSize;
  return remainder === 0 ? pageSize : remainder;
}

/**
 * 한 페이지 응답이 **항목 수** 기준을 통과했는지. HTTP 200·resultCode 0000 이어도
 * 항목 수가 기대치에 못 미치면(예: `totalCount=100`인데 1건) 이 페이지는 불완전이며
 * 체크포인트에 성공으로 저장하지 않는다.
 *
 * 항목의 **필수 식별자 유효성**까지 함께 보려면 `isPageValidated` 를 쓴다.
 */
export function isPageComplete(declaredTotal, pageSize, pageNo, itemCount) {
  return (
    Number(itemCount) >= expectedPageItemCount(declaredTotal, pageSize, pageNo)
  );
}

/**
 * 한 항목이 담아야 하는 **필수 식별자**(정규화한 `idOf` 값이 비어있지 않음)를 가졌는지.
 *
 * 최종 `validateDocument` 가 항목에 적용하는 기준 — 프로필은 `contentId`,
 * 중심은 `hubTatsCd` 가 비어 있으면 안 된다 — 을 페이지 검증 단계에서도 **같은 함수**로
 * 쓴다. 두 수집기는 이 `idOf` 를 이미 `collectPagedUnit` 에 넘기므로 중복 로직이 없다.
 */
export function hasRequiredId(item, idOf) {
  return String(idOf?.(item) ?? "").trim() !== "";
}

/** 페이지의 모든 항목이 필수 식별자를 갖췄는지(빈 배열은 true). */
export function pageItemsAllHaveId(items, idOf) {
  return (items ?? []).every((item) => hasRequiredId(item, idOf));
}

/**
 * 한 페이지가 체크포인트에 성공(`complete`)으로 저장될 자격이 있는지.
 *   (1) 항목 수가 기대치 이상이고,
 *   (2) 모든 항목이 필수 식별자(`idOf`)를 갖췄을 때만 `true`.
 *
 * `totalCount=2` 인데 `[{ contentId: "a" }, {}]` 같은 응답은 길이만 보면 통과하지만
 * 최종 `validateDocument` 에서 실패한다. 그 페이지를 `complete` 로 저장하면 `--resume`
 * 이 재조회 없이 같은 실패를 무한 반복하므로 여기서 걸러 낸다.
 */
export function isPageValidated({
  declaredTotal,
  pageSize,
  pageNo,
  items,
  idOf,
}) {
  const list = items ?? [];
  return (
    isPageComplete(declaredTotal, pageSize, pageNo, list.length) &&
    pageItemsAllHaveId(list, idOf)
  );
}

/**
 * 저장된 페이지 맵(`{ [pageNo]: { totalCount, items, complete } }`)에서 **검증까지
 * 통과한(`complete === true`)** 페이지 번호만 오름차순으로 준다. 재개 시 이 페이지만
 * 건너뛴다.
 */
export function validatedPageNumbers(savedPages = {}) {
  return Object.entries(savedPages)
    .filter(
      ([, value]) =>
        value && value.complete === true && Array.isArray(value.items),
    )
    .map(([key]) => Number(key))
    .filter((n) => Number.isInteger(n) && n >= 1)
    .sort((a, b) => a - b);
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

/** 검증 통과(complete) 페이지만 담은 저장용 객체를 만든다. */
function completePagesObject(fetched) {
  const out = {};
  for (const [pageNo, page] of fetched) {
    if (!page.complete) continue;
    out[String(pageNo)] = {
      totalCount: page.totalCount,
      items: page.items,
      complete: true,
    };
  }
  return out;
}

/**
 * 한 조회 단위(분류 스펙 또는 지역)를 페이지 단위로 수집한다. 두 수집기의 공통 로직.
 *
 * - **통신 성공 ≠ 검증 성공.** 항목 수가 기대치(마지막 전 페이지 = pageSize, 마지막
 *   페이지 = `totalCount % pageSize`)에 못 미치면 그 페이지는 불완전으로 남기고
 *   `validatedPages`(체크포인트 저장 대상)에 넣지 않는다.
 * - **재개.** `savedPages` 중 `complete === true` 페이지만 건너뛴다. 불완전·미저장
 *   페이지는 다시 조회한다.
 * - **일관성 붕괴 → 단위 재시작.** 페이지별 `totalCount` 변동 또는 페이지 간 중복
 *   ID는 수집 도중 스냅샷이 바뀐 징후다. 저장된 성공 페이지를 전부 무효화하고
 *   1페이지부터 다시 수집한다(최대 `maxRestarts`회). 초과하면 미완료로 반환한다.
 * - **완료 판정.** 기대 페이지 전부 검증 통과 + 페이지 간 중복 0 + `totalCount`
 *   불변일 때만 `done: true`.
 *
 * `requestPage(pageNo)` 는 `{ items, totalCount }` 를 주는 async 함수다. 네트워크·원천
 * 오류는 그대로 던지되, 그때까지 검증 통과한 페이지를 `error.validatedPages` 로
 * 붙여 재개에 쓸 수 있게 한다.
 *
 * `onProgress({ validatedPages, reason, morePagesExpected })` 는 (있으면) **정상
 * 페이지 검증 직후**와 **일관성 붕괴로 단위를 재시작할 때** 즉시 호출되는 async 훅이다.
 * 호출부(두 수집기 CLI)가 이 시점에 체크포인트 파일을 디스크로 flush 한다(결함 2).
 *   - `reason: "page"` — 방금 한 페이지가 검증됐다. `morePagesExpected` 가 참이면
 *     뒤에 더 받을 페이지가 있다.
 *   - `reason: "restart"` — 저장된 페이지를 전부 무효화하고 1페이지부터 다시 받는다.
 *     `validatedPages` 는 `{}` 다(재수집 시작 전에 폐기를 디스크에 반영해야 한다).
 */
export async function collectPagedUnit({
  requestPage,
  idOf,
  pageSize,
  savedPages = {},
  maxRestarts = 2,
  onProgress,
}) {
  const emitProgress = (payload) =>
    typeof onProgress === "function"
      ? Promise.resolve(onProgress(payload))
      : Promise.resolve();

  const seedFrom = (source) => {
    const map = new Map();
    for (const pageNo of validatedPageNumbers(source)) {
      const value = source[String(pageNo)] ?? source[pageNo];
      // 오래된 체크포인트에 complete 로 저장됐더라도 필수 식별자가 빠진 페이지는
      // 재사용하지 않고 다시 조회한다(결함 1).
      if (!pageItemsAllHaveId(value.items, idOf)) continue;
      map.set(pageNo, {
        totalCount: Number(value.totalCount),
        items: value.items,
        complete: true,
      });
    }
    return map;
  };

  let seed = seedFrom(savedPages);
  let restarts = 0;
  const restartReasons = [];

  for (;;) {
    const fetched = new Map(seed);
    let declaredTotal = fetched.get(1)?.totalCount ?? 0;
    let broken = null;

    try {
      if (!fetched.get(1)?.complete) {
        const first = await requestPage(1);
        declaredTotal = Number(first.totalCount) || 0;
        fetched.set(1, {
          totalCount: declaredTotal,
          items: first.items,
          complete: isPageValidated({
            declaredTotal,
            pageSize,
            pageNo: 1,
            items: first.items,
            idOf,
          }),
        });
        await emitProgress({
          validatedPages: completePagesObject(fetched),
          reason: "page",
          morePagesExpected: expectedPageCount(declaredTotal, pageSize) > 1,
        });
      }
      const pageCount = expectedPageCount(declaredTotal, pageSize);
      for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) {
        if (fetched.get(pageNo)?.complete) continue;
        const page = await requestPage(pageNo);
        if (Number(page.totalCount) !== declaredTotal) {
          broken = `페이지 ${pageNo} totalCount ${page.totalCount} ≠ 첫 페이지 ${declaredTotal}`;
          break;
        }
        fetched.set(pageNo, {
          totalCount: Number(page.totalCount),
          items: page.items,
          complete: isPageValidated({
            declaredTotal,
            pageSize,
            pageNo,
            items: page.items,
            idOf,
          }),
        });
        await emitProgress({
          validatedPages: completePagesObject(fetched),
          reason: "page",
          morePagesExpected: pageNo < pageCount,
        });
      }
    } catch (error) {
      error.validatedPages = completePagesObject(fetched);
      throw error;
    }

    const ordered = [...fetched.entries()].sort((a, b) => a[0] - b[0]);
    const pageCount = expectedPageCount(declaredTotal, pageSize);

    const seen = new Set();
    let duplicateItems = 0;
    let crossPageDuplicates = 0;
    const items = [];
    for (const [, page] of ordered) {
      const inPage = new Set();
      for (const raw of page.items) {
        const id = String(idOf(raw) ?? "").trim();
        if (!id) continue;
        if (seen.has(id)) {
          duplicateItems += 1;
          if (!inPage.has(id)) crossPageDuplicates += 1;
          inPage.add(id);
          continue;
        }
        seen.add(id);
        inPage.add(id);
        items.push(raw);
      }
    }
    if (!broken && crossPageDuplicates > 0) {
      broken = `페이지 간 중복 ID ${crossPageDuplicates}건`;
    }

    if (broken) {
      restartReasons.push(broken);
      restarts += 1;
      seed = new Map(); // 저장된 성공 페이지 전부 무효화 → 1페이지부터 재수집
      // 재수집을 시작하기 전에 폐기를 디스크에 반영한다(결함 2). 여기서 죽어도
      // 다음 실행이 낡은 페이지를 재사용하면 안 된다.
      await emitProgress({
        validatedPages: {},
        reason: "restart",
        morePagesExpected: true,
      });
      if (restarts > maxRestarts) {
        return {
          declaredTotal,
          expectedPageCount: pageCount,
          items: [],
          validatedPages: {},
          done: false,
          restarts,
          restartReasons,
          incompletePages: [],
          duplicateItems: 0,
          crossPageDuplicates,
          perPageTotals: [
            ...new Set(ordered.map(([, page]) => page.totalCount)),
          ],
          blockers: [
            `일관성 붕괴로 ${maxRestarts}회 재수집에도 실패: ${restartReasons.join(" · ")}`,
          ],
        };
      }
      continue;
    }

    const expectedNos = Array.from({ length: pageCount }, (_, i) => i + 1);
    const incompletePages = expectedNos.filter(
      (pageNo) => !fetched.get(pageNo)?.complete,
    );
    const completeness = assessCompleteness({
      declaredTotal,
      pageSize,
      pages: ordered.map(([pageNo, page]) => ({
        pageNo,
        totalCount: page.totalCount,
        ids: page.items
          .map((raw) => String(idOf(raw) ?? "").trim())
          .filter(Boolean),
      })),
    });

    return {
      declaredTotal,
      expectedPageCount: pageCount,
      items,
      validatedPages: completePagesObject(fetched),
      done: incompletePages.length === 0 && completeness.blockers.length === 0,
      restarts,
      restartReasons,
      incompletePages,
      duplicateItems,
      crossPageDuplicates: 0,
      perPageTotals: completeness.totalCountValues,
      blockers: completeness.blockers,
    };
  }
}
