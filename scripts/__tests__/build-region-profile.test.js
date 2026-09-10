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

  it("페이지별 totalCount 가 흔들리면(스냅샷 격리 없음) blockers 를 남긴다", async () => {
    const collector = collectorFor(
      fetchByPage({
        1: tourBody(nItems("p1", 1000), 2000),
        2: tourBody(nItems("p2", 900), 1900),
      }),
    );
    const result = await collector.collectSpec(spec);
    expect(result.perPageTotals.length).toBeGreaterThan(1);
    expect(
      result.blockers.some((b) => b.includes("페이지별 totalCount 변동")),
    ).toBe(true);
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
});

describe("createProfileCollector.collectSpec — 결함 3 (페이지 재개)", () => {
  it("성공한 1·2페이지는 다시 호출하지 않고 3페이지만 조회한다", async () => {
    const fetchImpl = fetchByPage({
      3: tourBody(nItems("p3", 500), 2500),
    });
    const collector = collectorFor(fetchImpl);
    const savedPages = {
      1: { totalCount: 2500, items: nItems("p1", 1000) },
      2: { totalCount: 2500, items: nItems("p2", 1000) },
    };
    const persisted = [];
    const result = await collector.collectSpec(spec, {
      savedPages,
      onPage: async (pageNo) => persisted.push(pageNo),
    });
    expect(fetchImpl.calls).toEqual([3]); // 1·2페이지 재호출 없음
    expect(collector.stats.requests).toBe(1);
    expect(persisted).toEqual([3]);
    expect(result.receivedUnique).toBe(2500);
    expect(result.blockers).toEqual([]);
  });

  it("3페이지 실패 → 재개 시 1·2페이지를 다시 부르지 않는다", async () => {
    // 1차: 1·2 성공, 3 실패(HTTP 500 반복).
    const first = fetchByPage({
      1: tourBody(nItems("p1", 1000), 2500),
      2: tourBody(nItems("p2", 1000), 2500),
      3: () => {
        throw Object.assign(new Error("boom"), { code: "ECONNRESET" });
      },
    });
    const c1 = collectorFor(first);
    const saved = {};
    await expect(
      c1.collectSpec(spec, {
        savedPages: {},
        onPage: async (pageNo, pageData) => {
          saved[pageNo] = pageData;
        },
      }),
    ).rejects.toThrow();
    expect(Object.keys(saved).map(Number).sort()).toEqual([1, 2]);

    // 2차: 저장된 1·2를 넘겨 재개. 3페이지만 조회돼야 한다.
    const second = fetchByPage({ 3: tourBody(nItems("p3", 500), 2500) });
    const c2 = collectorFor(second);
    const result = await c2.collectSpec(spec, { savedPages: saved });
    expect(second.calls).toEqual([3]);
    expect(c2.stats.requests).toBe(1);
    expect(result.receivedUnique).toBe(2500);
    expect(result.blockers).toEqual([]);
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
