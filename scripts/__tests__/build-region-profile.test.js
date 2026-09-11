import {
  QUERY_SPECS,
  createProfileCollector,
  validateDocument,
} from "../lib/region-profile-core.mjs";

const noopSleep = async () => {};
const fixedNow = () => 0;
const spec = QUERY_SPECS[0]; // nature/new lclsSystm1=NA

const item = (id) => ({ contentid: id, title: `장소 ${id}` });
const page = (ids) => ids.map(item);
const nItems = (prefix, count) =>
  Array.from({ length: count }, (_, i) => item(`${prefix}-${i}`));

function tourBody(items, totalCount = items.length) {
  return {
    response: {
      header: { resultCode: "0000", resultMsg: "OK" },
      body: { totalCount, numOfRows: 1000, items: { item: items } },
    },
  };
}

/** pageNo → 응답 스펙(객체 또는 함수/Error)을 돌려주는 fake fetch. */
function fetchByPage(map) {
  const calls = [];
  const impl = async (url) => {
    const pageNo = Number(new URL(url).searchParams.get("pageNo"));
    calls.push(pageNo);
    const spec = map[pageNo];
    if (spec === undefined) throw new Error(`no response for page ${pageNo}`);
    if (spec instanceof Error) throw spec;
    const body = typeof spec === "function" ? spec() : spec;
    return {
      status: 200,
      ok: true,
      text: async () =>
        typeof body === "string" ? body : JSON.stringify(body),
    };
  };
  impl.calls = calls;
  return impl;
}

function collectorFor(fetchImpl, overrides = {}) {
  return createProfileCollector({
    fetchImpl,
    serviceKey: "decoded-test-key",
    sleep: noopSleep,
    now: fixedNow,
    logger: { warn() {}, log() {} },
    ...overrides,
  });
}

describe("createProfileCollector.collectSpec — 결함 1 (수집 완전성)", () => {
  it("totalCount 100 인데 1건만 반환되면 blockers 를 남긴다", async () => {
    const collector = collectorFor(
      fetchByPage({ 1: tourBody(page(["only-one"]), 100) }),
    );
    const result = await collector.collectSpec(spec);
    expect(result.receivedUnique).toBe(1);
    expect(result.drift).toBe(99);
    expect(result.blockers.some((b) => b.includes("건수 부족"))).toBe(true);
  });

  it("마지막 전 페이지가 실제 건수보다 적으면 부족으로 잡는다", async () => {
    const collector = collectorFor(
      fetchByPage({
        1: tourBody(nItems("p1", 1000), 2500),
        2: tourBody(nItems("p2", 1000), 2500),
        3: tourBody(nItems("p3", 10), 2500), // 480건 누락
      }),
    );
    const result = await collector.collectSpec(spec);
    expect(result.blockers.some((b) => b.includes("건수 부족"))).toBe(true);
  });

  it("페이지별 totalCount 가 계속 흔들리면 재시작 소진 후 done=false", async () => {
    const collector = collectorFor(
      fetchByPage({
        1: tourBody(nItems("p1", 1000), 2000),
        2: tourBody(nItems("p2", 900), 1900), // 매번 드리프트
      }),
    );
    const result = await collector.collectSpec(spec);
    expect(result.done).toBe(false);
    expect(result.restarts).toBeGreaterThanOrEqual(2);
    expect(result.blockers.some((b) => b.includes("일관성 붕괴"))).toBe(true);
  });

  it("완전한 수집은 blockers 가 없다", async () => {
    const collector = collectorFor(
      fetchByPage({
        1: tourBody(nItems("p1", 1000), 2200),
        2: tourBody(nItems("p2", 1000), 2200),
        3: tourBody(nItems("p3", 200), 2200),
      }),
    );
    const result = await collector.collectSpec(spec);
    expect(result.blockers).toEqual([]);
    expect(result.receivedUnique).toBe(2200);
  });

  it("contentid 가 빠진 항목이 섞이면(건수는 채워도) 그 페이지는 미저장·done=false", async () => {
    const withHole = [
      ...nItems("p3", 199),
      { contentid: "", title: "식별자 없음" },
    ];
    const collector = collectorFor(
      fetchByPage({
        1: tourBody(nItems("p1", 1000), 2200),
        2: tourBody(nItems("p2", 1000), 2200),
        3: tourBody(withHole, 2200),
      }),
    );
    const result = await collector.collectSpec(spec);
    expect(result.done).toBe(false);
    expect(result.incompletePages).toEqual([3]);
    expect(Object.keys(result.validatedPages).sort()).toEqual(["1", "2"]);
  });

  it("ID 누락 페이지 → --resume 에서 정상 페이지로 실제 복구(1·2 재호출 안 함)", async () => {
    const first = collectorFor(
      fetchByPage({
        1: tourBody(nItems("p1", 1000), 2200),
        2: tourBody(nItems("p2", 1000), 2200),
        3: tourBody(
          [...nItems("p3", 199), { contentid: "  ", title: "공백 ID" }],
          2200,
        ),
      }),
    );
    const run1 = await first.collectSpec(spec);
    expect(run1.done).toBe(false);
    expect(Object.keys(run1.validatedPages).sort()).toEqual(["1", "2"]);

    const secondFetch = fetchByPage({ 3: tourBody(nItems("p3", 200), 2200) });
    const second = collectorFor(secondFetch);
    const run2 = await second.collectSpec(spec, {
      savedPages: run1.validatedPages,
    });
    expect(secondFetch.calls).toEqual([3]);
    expect(run2.done).toBe(true);
    expect(run2.receivedUnique).toBe(2200);
  });
});

const validated = (prefix, count, totalCount) => ({
  totalCount,
  items: nItems(prefix, count),
  complete: true,
});

describe("createProfileCollector.collectSpec — 결함 3 (페이지 재개)", () => {
  it("검증 통과한 1·2페이지는 다시 호출하지 않고 3페이지만 조회한다", async () => {
    const fetchImpl = fetchByPage({ 3: tourBody(nItems("p3", 500), 2500) });
    const collector = collectorFor(fetchImpl);
    const result = await collector.collectSpec(spec, {
      savedPages: {
        1: validated("p1", 1000, 2500),
        2: validated("p2", 1000, 2500),
      },
    });
    expect(fetchImpl.calls).toEqual([3]); // 1·2페이지 재호출 없음
    expect(collector.stats.requests).toBe(1);
    expect(result.done).toBe(true);
    expect(result.receivedUnique).toBe(2500);
    expect(result.blockers).toEqual([]);
    expect(Object.keys(result.validatedPages).sort()).toEqual(["1", "2", "3"]);
  });

  it("불완전(1/100건) 페이지 → 미저장·미완료·복구: 1차→재개 시 3페이지만 정상 조회하면 복구된다", async () => {
    // 1차: 1·2 정상, 3페이지가 1/500건만 반환.
    const first = collectorFor(
      fetchByPage({
        1: tourBody(nItems("p1", 1000), 2500),
        2: tourBody(nItems("p2", 1000), 2500),
        3: tourBody(nItems("p3", 1), 2500),
      }),
    );
    const run1 = await first.collectSpec(spec);
    expect(run1.done).toBe(false);
    expect(run1.incompletePages).toEqual([3]);
    expect(Object.keys(run1.validatedPages).sort()).toEqual(["1", "2"]);
    expect(run1.blockers.some((b) => b.includes("건수 부족"))).toBe(true);

    // 2차 --resume: 저장된 1·2만 넘긴다. 3페이지가 정상 500건.
    const second = collectorFor(
      fetchByPage({ 3: tourBody(nItems("p3", 500), 2500) }),
    );
    const run2 = await second.collectSpec(spec, {
      savedPages: run1.validatedPages,
    });
    expect(run2.done).toBe(true);
    expect(run2.receivedUnique).toBe(2500);
  });

  it("네트워크 실패 후 재개 시 검증 통과 1·2페이지를 다시 부르지 않는다", async () => {
    const first = fetchByPage({
      1: tourBody(nItems("p1", 1000), 2500),
      2: tourBody(nItems("p2", 1000), 2500),
      3: () => {
        throw Object.assign(new Error("boom"), { code: "ECONNRESET" });
      },
    });
    const c1 = collectorFor(first);
    let saved;
    await c1.collectSpec(spec).catch((error) => {
      saved = error.validatedPages;
    });
    expect(Object.keys(saved).map(Number).sort()).toEqual([1, 2]);

    const second = fetchByPage({ 3: tourBody(nItems("p3", 500), 2500) });
    const c2 = collectorFor(second);
    const result = await c2.collectSpec(spec, { savedPages: saved });
    expect(second.calls).toEqual([3]);
    expect(c2.stats.requests).toBe(1);
    expect(result.done).toBe(true);
  });

  it("재개 중 페이지별 totalCount 변동 → 저장 페이지 무효화하고 1페이지부터 재수집", async () => {
    let page3 = 0;
    const fetchImpl = fetchByPage({
      1: () => tourBody(nItems("p1", 1000), 2500),
      2: () => tourBody(nItems("p2", 1000), 2500),
      3: () => {
        page3 += 1;
        return page3 === 1
          ? tourBody(nItems("p3", 400), 2400) // 재개 시 드리프트
          : tourBody(nItems("p3", 500), 2500); // 재시작 후 정상
      },
    });
    const collector = collectorFor(fetchImpl);
    const result = await collector.collectSpec(spec, {
      savedPages: {
        1: validated("p1", 1000, 2500),
        2: validated("p2", 1000, 2500),
      },
    });
    expect(result.restarts).toBe(1);
    expect(fetchImpl.calls).toEqual([3, 1, 2, 3]); // 1페이지부터 다시
    expect(result.done).toBe(true);
  });
});

describe("validateDocument — 교체 차단", () => {
  const attraction = (id) => ({ contentId: id, categories: ["history"] });
  const goodDoc = () => ({
    schemaVersion: 2,
    profiles: [
      {
        regionId: "ktdb-zone-154",
        attractions: [
          attraction("125949"),
          attraction("126166"),
          attraction("126207"),
          attraction("127977"),
          ...Array.from({ length: 8100 }, (_, i) => attraction(`x-${i}`)),
        ],
      },
      ...Array.from({ length: 210 }, (_, i) => ({
        regionId: `z-${i}`,
        attractions: [],
      })),
    ],
    completeness: { ok: true, blockers: [] },
  });

  it("정상 문서는 차단 사유가 없다", () => {
    expect(validateDocument(goodDoc())).toEqual([]);
  });

  it("completeness.blockers 가 있으면 --promote 를 막는다", () => {
    const doc = goodDoc();
    doc.completeness = {
      ok: false,
      blockers: ["[nature] 실제 수집 건수 부족: totalCount 100 vs 고유 1"],
    };
    const blockers = validateDocument(doc);
    expect(blockers.some((b) => b.includes("수집 불완전"))).toBe(true);
  });

  it("대표 명소 누락도 차단한다", () => {
    const doc = goodDoc();
    doc.profiles[0].attractions = doc.profiles[0].attractions.filter(
      (a) => a.contentId !== "126166",
    );
    expect(validateDocument(doc).some((b) => b.includes("126166"))).toBe(true);
  });
});
