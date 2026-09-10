import {
  assessCompleteness,
  expectedPageCount,
  pendingPageNumbers,
} from "../lib/paged-collection.mjs";

const ids = (prefix, count) =>
  Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

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
