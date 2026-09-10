import {
  assessCompleteness,
  collectPagedUnit,
  expectedPageCount,
  expectedPageItemCount,
  isPageComplete,
  pendingPageNumbers,
  validatedPageNumbers,
} from "../lib/paged-collection.mjs";

const ids = (prefix, count) =>
  Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
const rows = (prefix, count) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}` }));

describe("expectedPageCount", () => {
  it("총건수/페이지크기 올림, 최소 1", () => {
    expect(expectedPageCount(0, 1000)).toBe(1);
    expect(expectedPageCount(1, 1000)).toBe(1);
    expect(expectedPageCount(1000, 1000)).toBe(1);
    expect(expectedPageCount(1001, 1000)).toBe(2);
    expect(expectedPageCount(2500, 1000)).toBe(3);
  });
});

describe("pendingPageNumbers", () => {
  it("성공한 페이지는 빼고 미수집 페이지만 오름차순으로 준다", () => {
    expect(pendingPageNumbers(2500, 1000, [1, 2])).toEqual([3]);
    expect(pendingPageNumbers(2500, 1000, [])).toEqual([1, 2, 3]);
    expect(pendingPageNumbers(2500, 1000, [1, 3])).toEqual([2]);
    expect(pendingPageNumbers(100, 100, [1])).toEqual([]);
  });
});

describe("assessCompleteness — 결함 1", () => {
  it("totalCount 100 인데 1건만 반환되면 건수 부족으로 차단한다", () => {
    const result = assessCompleteness({
      declaredTotal: 100,
      pageSize: 100,
      pages: [{ pageNo: 1, totalCount: 100, ids: ["only-one"] }],
    });
    expect(result.uniqueCount).toBe(1);
    expect(result.shortfall).toBe(99);
    expect(result.blockers.some((b) => b.includes("건수 부족"))).toBe(true);
  });

  it("정상적인 페이지 내 중복 제거분은 부족으로 세지 않는다", () => {
    const result = assessCompleteness({
      declaredTotal: 3,
      pageSize: 100,
      pages: [{ pageNo: 1, totalCount: 3, ids: ["a", "a", "b"] }],
    });
    expect(result.uniqueCount).toBe(2);
    expect(result.duplicateCount).toBe(1);
    expect(result.crossPageDuplicateCount).toBe(0);
    expect(result.shortfall).toBe(0);
    expect(result.blockers).toEqual([]);
  });

  it("요청 페이지 범위에서 빠진 페이지를 차단한다", () => {
    const result = assessCompleteness({
      declaredTotal: 2500,
      pageSize: 1000,
      pages: [
        { pageNo: 1, totalCount: 2500, ids: ids("p1", 1000) },
        { pageNo: 3, totalCount: 2500, ids: ids("p3", 500) },
      ],
    });
    expect(result.missingPages).toEqual([2]);
    expect(result.blockers.some((b) => b.includes("누락된 페이지 2"))).toBe(
      true,
    );
  });

  it("페이지 간 중복 ID 를 차단한다", () => {
    const result = assessCompleteness({
      declaredTotal: 4,
      pageSize: 2,
      pages: [
        { pageNo: 1, totalCount: 4, ids: ["a", "b"] },
        { pageNo: 2, totalCount: 4, ids: ["b", "c"] },
      ],
    });
    expect(result.crossPageDuplicateCount).toBe(1);
    expect(result.blockers.some((b) => b.includes("페이지 간 중복 ID"))).toBe(
      true,
    );
  });

  it("페이지마다 totalCount 가 다르면(스냅샷 격리 없음) 차단한다", () => {
    const result = assessCompleteness({
      declaredTotal: 2000,
      pageSize: 1000,
      pages: [
        { pageNo: 1, totalCount: 2000, ids: ids("p1", 1000) },
        { pageNo: 2, totalCount: 1950, ids: ids("p2", 950) },
      ],
    });
    expect(result.totalCountDrifted).toBe(true);
    expect(
      result.blockers.some((b) => b.includes("페이지별 totalCount 변동")),
    ).toBe(true);
  });

  it("완전한 수집은 차단 사유가 없다", () => {
    const result = assessCompleteness({
      declaredTotal: 2500,
      pageSize: 1000,
      pages: [
        { pageNo: 1, totalCount: 2500, ids: ids("p1", 1000) },
        { pageNo: 2, totalCount: 2500, ids: ids("p2", 1000) },
        { pageNo: 3, totalCount: 2500, ids: ids("p3", 500) },
      ],
    });
    expect(result.blockers).toEqual([]);
  });
});

describe("expectedPageItemCount / isPageComplete — 페이지 단위 검증", () => {
  it("마지막 전 페이지는 pageSize, 마지막 페이지는 나머지", () => {
    expect(expectedPageItemCount(2500, 1000, 1)).toBe(1000);
    expect(expectedPageItemCount(2500, 1000, 2)).toBe(1000);
    expect(expectedPageItemCount(2500, 1000, 3)).toBe(500);
  });
  it("나머지가 0이면 마지막 페이지도 pageSize", () => {
    expect(expectedPageItemCount(2000, 1000, 2)).toBe(1000);
    expect(expectedPageItemCount(100, 100, 1)).toBe(100);
  });
  it("totalCount 0 이면 0(빈 응답이 정상)", () => {
    expect(expectedPageItemCount(0, 100, 1)).toBe(0);
  });
  it("항목 수가 기대치 미만이면 불완전", () => {
    expect(isPageComplete(100, 100, 1, 100)).toBe(true);
    expect(isPageComplete(100, 100, 1, 1)).toBe(false); // totalCount=100, 1건
    expect(isPageComplete(2500, 1000, 3, 499)).toBe(false);
    expect(isPageComplete(0, 100, 1, 0)).toBe(true);
  });
});

describe("validatedPageNumbers", () => {
  it("complete === true 인 페이지 번호만", () => {
    expect(
      validatedPageNumbers({
        1: { items: [], complete: true },
        2: { items: [], complete: false },
        3: { items: [], complete: true },
        4: { items: [] },
      }),
    ).toEqual([1, 3]);
  });
});

describe("collectPagedUnit — 통신 성공 vs 검증 성공, 재개, 재시작", () => {
  const unitOf = (map, savedPages = {}) => {
    const calls = [];
    return {
      calls,
      run: () =>
        collectPagedUnit({
          pageSize: 1000,
          savedPages,
          idOf: (row) => row.id,
          requestPage: async (pageNo) => {
            calls.push(pageNo);
            const spec = map[pageNo];
            if (spec instanceof Error) throw spec;
            return typeof spec === "function" ? spec() : spec;
          },
        }),
    };
  };

  it("불완전 페이지는 validatedPages 에 넣지 않고 done=false", async () => {
    const { run } = unitOf({
      1: { totalCount: 2500, items: rows("p1", 1000) },
      2: { totalCount: 2500, items: rows("p2", 1000) },
      3: { totalCount: 2500, items: rows("p3", 1) }, // 기대 500, 실제 1
    });
    const unit = await run();
    expect(unit.done).toBe(false);
    expect(unit.incompletePages).toEqual([3]);
    expect(Object.keys(unit.validatedPages).sort()).toEqual(["1", "2"]);
    expect(unit.blockers.some((b) => b.includes("건수 부족"))).toBe(true);
  });

  it("검증 통과 저장 페이지만 재개에서 건너뛴다", async () => {
    const { calls, run } = unitOf(
      { 3: { totalCount: 2500, items: rows("p3", 500) } },
      {
        1: { totalCount: 2500, items: rows("p1", 1000), complete: true },
        2: { totalCount: 2500, items: rows("p2", 1000), complete: true },
      },
    );
    const unit = await run();
    expect(calls).toEqual([3]); // 1·2 재호출 없음
    expect(unit.done).toBe(true);
    expect(unit.items).toHaveLength(2500);
  });

  it("불완전으로 저장된 페이지는 재개에서 다시 조회한다", async () => {
    const { calls, run } = unitOf(
      { 3: { totalCount: 2500, items: rows("p3", 500) } },
      {
        1: { totalCount: 2500, items: rows("p1", 1000), complete: true },
        2: { totalCount: 2500, items: rows("p2", 1000), complete: true },
        3: { totalCount: 2500, items: rows("p3", 1), complete: false },
      },
    );
    const unit = await run();
    expect(calls).toEqual([3]);
    expect(unit.done).toBe(true);
  });

  it("페이지별 totalCount 변동 → 저장 페이지 무효화 후 1페이지부터 재수집", async () => {
    let phase = 0;
    const { calls, run } = unitOf(
      {
        1: () => ({ totalCount: 2500, items: rows("p1", 1000) }),
        2: () => ({ totalCount: 2500, items: rows("p2", 1000) }),
        3: () => {
          phase += 1;
          // 1차 시도(재개): 드리프트. 2차(재시작): 정상.
          return phase === 1
            ? { totalCount: 2400, items: rows("p3", 400) }
            : { totalCount: 2500, items: rows("p3", 500) };
        },
      },
      {
        1: { totalCount: 2500, items: rows("p1", 1000), complete: true },
        2: { totalCount: 2500, items: rows("p2", 1000), complete: true },
      },
    );
    const unit = await run();
    expect(unit.restarts).toBe(1);
    // 재시작 후 1페이지부터 다시 조회했다(저장 seed 를 신뢰하지 않음).
    expect(calls).toEqual([3, 1, 2, 3]);
    expect(unit.done).toBe(true);
  });

  it("일관성 붕괴가 반복되면 done=false, validatedPages 비움", async () => {
    const { run } = unitOf({
      1: { totalCount: 2000, items: rows("p1", 1000) },
      2: () => ({ totalCount: 1900, items: rows("p2", 900) }), // 매번 드리프트
    });
    const unit = await run();
    expect(unit.done).toBe(false);
    expect(unit.restarts).toBeGreaterThanOrEqual(2);
    expect(unit.validatedPages).toEqual({});
    expect(unit.blockers.some((b) => b.includes("일관성 붕괴"))).toBe(true);
  });

  it("페이지 간 중복 ID → 단위 재시작", async () => {
    let page2Calls = 0;
    const unit = await collectPagedUnit({
      pageSize: 2,
      idOf: (r) => r.id,
      requestPage: async (pageNo) => {
        if (pageNo === 1)
          return { totalCount: 4, items: [{ id: "a" }, { id: "b" }] };
        page2Calls += 1;
        return page2Calls === 1
          ? { totalCount: 4, items: [{ id: "b" }, { id: "c" }] } // 중복 b
          : { totalCount: 4, items: [{ id: "c" }, { id: "d" }] };
      },
    });
    expect(unit.restarts).toBe(1);
    expect(unit.done).toBe(true);
    expect(unit.items.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
});
