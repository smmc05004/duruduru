import {
  BASE_YM,
  FatalApiError,
  centralApiCodesFor,
  classifyHttpStatus,
  classifyNetworkError,
  classifyResultCode,
  createCollector,
  isCheckpointReusable,
  normalizeHub,
  projectRequestBudget,
  regionCodesFor,
  regionsToCollect,
  validateDocument,
} from "../lib/central-attractions-core.mjs";

const noopSleep = async () => {};
const fixedNow = () => 0;

/** 큐에 넣은 응답을 순서대로 돌려주는 fake fetch. 마지막 응답을 반복 사용한다. */
function queueFetch(responses) {
  const calls = [];
  let index = 0;
  const impl = async (url) => {
    calls.push(String(url));
    const spec = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (typeof spec === "function") return spec();
    if (spec instanceof Error) throw spec;
    const { status = 200, body } = spec;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () =>
        typeof body === "string" ? body : JSON.stringify(body),
    };
  };
  impl.calls = calls;
  return impl;
}

function okBody(items, totalCount = items.length, pageNo = 1) {
  return {
    response: {
      header: { resultCode: "0000", resultMsg: "OK" },
      body: {
        items: { item: items },
        totalCount,
        numOfRows: 100,
        pageNo,
      },
    },
  };
}

function sourceErrorBody(code) {
  return {
    response: {
      header: { resultCode: code, resultMsg: "ERR" },
      body: {},
    },
  };
}

const hub = (rank, cd = `cd-${rank}`) => ({
  baseYm: "202608",
  mapX: "127.0",
  mapY: "36.0",
  areaCd: "44",
  areaNm: "충청남도",
  signguCd: "44150",
  signguNm: "공주시",
  hubTatsCd: cd,
  hubTatsNm: `장소${rank}`,
  hubCtgryLclsNm: "관광지",
  hubCtgryMclsNm: "역사관광",
  hubRank: String(rank),
});

function collectorFor(fetchImpl, overrides = {}) {
  return createCollector({
    fetchImpl,
    serviceKey: "decoded-test-key",
    sleep: noopSleep,
    now: fixedNow,
    logger: { warn() {}, log() {} },
    ...overrides,
  });
}

const mapping = (regionId, lDongRegnCd, lDongSignguCd, district) => ({
  regionId,
  name: `테스트 ${district}`,
  province: "테스트도",
  district,
  lDongRegnCd,
  lDongSignguCd,
});

describe("regionCodesFor", () => {
  it("일반 지역은 lDongRegnCd + lDongSignguCd 를 5자리 signguCd 로 만든다", () => {
    expect(regionCodesFor(mapping("z1", "44", "150", "공주시"))).toEqual({
      areaCd: "44",
      signguCd: "44150",
    });
    expect(regionCodesFor(mapping("z2", "47", "130", "경주시"))).toEqual({
      areaCd: "47",
      signguCd: "47130",
    });
  });

  it("세종(lDongRegnCd 5자리)은 그 값이 signguCd, 앞 2자리가 areaCd 다", () => {
    expect(regionCodesFor(mapping("z3", "36110", "36110", "세종시"))).toEqual({
      areaCd: "36",
      signguCd: "36110",
    });
  });

  it("lDongRegnCd 2자리 + lDongSignguCd 5자리도 허용한다", () => {
    expect(regionCodesFor(mapping("z4", "41", "41290", "과천시"))).toEqual({
      areaCd: "41",
      signguCd: "41290",
    });
  });

  it("형식을 해석할 수 없으면 throw 한다", () => {
    expect(() => regionCodesFor(mapping("z5", "4", "15", "x"))).toThrow();
    expect(() => regionCodesFor(mapping("z6", "", "", "x"))).toThrow();
  });
});

describe("centralApiCodesFor (중심 API 전용 정규화)", () => {
  const m = (province, district, regn, signgu) => ({
    regionId: "z",
    name: `${province} ${district}`,
    province,
    district,
    lDongRegnCd: regn,
    lDongSignguCd: signgu,
  });

  it("표준 코드 지역은 일반 규칙과 같다", () => {
    expect(centralApiCodesFor(m("충청남도", "공주시", "44", "150"))).toEqual({
      areaCd: "44",
      signguCd: "44150",
    });
  });

  it("세종(5자리 lDongRegnCd)은 areaCd 36 / signguCd 36110", () => {
    expect(
      centralApiCodesFor(m("세종특별자치시", "세종시", "36110", "36110")),
    ).toEqual({ areaCd: "36", signguCd: "36110" });
  });

  it("광주광역시는 표준 SIG_CD 오버라이드를 쓴다(KTDB '12' 스킴 무시)", () => {
    expect(centralApiCodesFor(m("광주광역시", "남구", "12", "270"))).toEqual({
      areaCd: "29",
      signguCd: "29155",
    });
    expect(centralApiCodesFor(m("광주광역시", "광산구", "12", "330"))).toEqual({
      areaCd: "29",
      signguCd: "29200",
    });
  });

  it("전라남도는 표준 SIG_CD 오버라이드를 쓴다(뒤 3자리가 표준과 어긋남)", () => {
    // 매핑상 고흥군=740, 광양시=190 이지만 표준은 46770 / 46230.
    expect(centralApiCodesFor(m("전라남도", "고흥군", "12", "740"))).toEqual({
      areaCd: "46",
      signguCd: "46770",
    });
    expect(centralApiCodesFor(m("전라남도", "광양시", "12", "190"))).toEqual({
      areaCd: "46",
      signguCd: "46230",
    });
    expect(centralApiCodesFor(m("전라남도", "목포시", "12", "110"))).toEqual({
      areaCd: "46",
      signguCd: "46110",
    });
  });

  it("비표준 lDongRegnCd인데 오버라이드가 없으면 throw", () => {
    expect(() =>
      centralApiCodesFor(m("전라남도", "없는군", "12", "999")),
    ).toThrow(/오버라이드가 없습니다/);
  });
});

describe("오류 분류", () => {
  it("resultCode", () => {
    expect(classifyResultCode("0000")).toBe("ok");
    expect(classifyResultCode("22")).toBe("fatal"); // 일일 한도
    expect(classifyResultCode("30")).toBe("fatal"); // 키 미등록
    expect(classifyResultCode("23")).toBe("retry"); // 초당 허용량
    expect(classifyResultCode("9999")).toBe("error");
  });

  it("HTTP 상태", () => {
    expect(classifyHttpStatus(429)).toBe("retry");
    expect(classifyHttpStatus(503)).toBe("retry");
    expect(classifyHttpStatus(404)).toBe("error");
    expect(classifyHttpStatus(400)).toBe("error");
  });

  it("네트워크 예외", () => {
    expect(classifyNetworkError({ name: "TimeoutError" })).toBe("retry");
    expect(classifyNetworkError({ code: "ECONNRESET" })).toBe("retry");
    expect(classifyNetworkError(new Error("boom"))).toBe("error");
  });
});

describe("예산·체크포인트 순수 로직", () => {
  it("projectRequestBudget 는 지역 수 + 1", () => {
    expect(projectRequestBudget(249)).toBe(250);
  });

  it("isCheckpointReusable 은 기준월·매핑·분류 버전이 모두 같을 때만 참", () => {
    const ctx = {
      baseYm: "202608",
      mappingVersion: "m1",
      classificationVersion: "c1",
    };
    expect(isCheckpointReusable({ ...ctx }, ctx)).toBe(true);
    expect(isCheckpointReusable({ ...ctx, baseYm: "202607" }, ctx)).toBe(false);
    expect(isCheckpointReusable({ ...ctx, mappingVersion: "m2" }, ctx)).toBe(
      false,
    );
    expect(isCheckpointReusable(null, ctx)).toBe(false);
  });

  it("regionsToCollect 는 코드가 일치하는 ok 지역만 건너뛴다", () => {
    const mappings = [
      mapping("z1", "44", "150", "a"), // ok, 코드 일치 → skip
      mapping("z2", "47", "130", "b"), // empty → 재조회
      mapping("z3", "41", "290", "c"), // failed → 재조회
      mapping("z4", "48", "250", "d"), // ok 이지만 저장 코드 불일치 → 재조회
      mapping("z5", "43", "111", "e"), // 체크포인트에 없음 → 신규
    ];
    const checkpoint = {
      regions: {
        z1: { status: "ok", areaCd: "44", signguCd: "44150" },
        z2: { status: "empty", areaCd: "47", signguCd: "47130" },
        z3: { status: "failed" },
        z4: { status: "ok", areaCd: "12", signguCd: "12250" },
      },
    };
    expect(
      regionsToCollect(mappings, checkpoint).map((m) => m.regionId),
    ).toEqual(["z2", "z3", "z4", "z5"]);
    expect(regionsToCollect(mappings, null).map((m) => m.regionId)).toEqual([
      "z1",
      "z2",
      "z3",
      "z4",
      "z5",
    ]);
  });
});

describe("normalizeHub", () => {
  it("hubTatsCd 를 보존하고 rank 를 숫자로, 이름 태그를 제거한다", () => {
    expect(
      normalizeHub({
        hubTatsCd: "abc123",
        hubTatsNm: " <b>국립공주박물관</b> ",
        hubRank: "3",
        hubCtgryLclsNm: "관광지",
        hubCtgryMclsNm: "문화관광",
        mapX: "127.1",
        mapY: "36.4",
      }),
    ).toEqual({
      hubTatsCd: "abc123",
      hubTatsName: "국립공주박물관",
      hubRank: 3,
      categoryLcls: "관광지",
      categoryMcls: "문화관광",
      mapX: "127.1",
      mapY: "36.4",
    });
  });

  it("rank 가 비어 있으면 null", () => {
    expect(normalizeHub({ hubTatsCd: "x", hubRank: "" }).hubRank).toBeNull();
  });
});

describe("createCollector.collectRegion", () => {
  const m = mapping("z1", "44", "150", "공주시");

  it("한 페이지 성공 → status ok, rank 오름차순 정렬", async () => {
    const fetchImpl = queueFetch([{ body: okBody([hub(3), hub(1), hub(2)]) }]);
    const c = collectorFor(fetchImpl);
    const result = await c.collectRegion(m);
    expect(result.status).toBe("ok");
    expect(result.collected).toBe(3);
    expect(result.totalCount).toBe(3);
    expect(result.hubs.map((h) => h.hubRank)).toEqual([1, 2, 3]);
    expect(result.rankRange).toEqual({ min: 1, max: 3 });
    expect(c.stats.requests).toBe(1);
  });

  it("같은 hubTatsCd 는 중복 제거하고 duplicateHubCds 로 센다", async () => {
    const fetchImpl = queueFetch([
      { body: okBody([hub(1, "same"), hub(2, "same"), hub(3, "other")]) },
    ]);
    const result = await collectorFor(fetchImpl).collectRegion(m);
    expect(result.collected).toBe(2);
    expect(result.duplicateHubCds).toBe(1);
  });

  it("totalCount 0 → status empty", async () => {
    const fetchImpl = queueFetch([{ body: okBody([], 0) }]);
    const result = await collectorFor(fetchImpl).collectRegion(m);
    expect(result.status).toBe("empty");
    expect(result.collected).toBe(0);
  });

  it("여러 페이지를 끝까지 받는다", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => hub(i + 1, `a${i}`));
    const page2 = Array.from({ length: 50 }, (_, i) => hub(i + 101, `b${i}`));
    const fetchImpl = queueFetch([
      { body: okBody(page1, 150, 1) },
      { body: okBody(page2, 150, 2) },
    ]);
    const c = collectorFor(fetchImpl);
    const result = await c.collectRegion(m);
    expect(result.collected).toBe(150);
    expect(c.stats.requests).toBe(2);
  });

  it("resultCode 22 → FatalApiError 전파", async () => {
    const fetchImpl = queueFetch([{ body: sourceErrorBody("22") }]);
    await expect(
      collectorFor(fetchImpl).collectRegion(m),
    ).rejects.toBeInstanceOf(FatalApiError);
  });

  it("resultCode 23(초당 제한) → 대기 후 재시도해 성공, 재시도도 예산 산입", async () => {
    const fetchImpl = queueFetch([
      { body: sourceErrorBody("23") },
      { body: okBody([hub(1)]) },
    ]);
    const c = collectorFor(fetchImpl);
    const result = await c.collectRegion(m);
    expect(result.status).toBe("ok");
    expect(c.stats.requests).toBe(2);
    expect(c.stats.retries).toBe(1);
  });

  it("HTTP 500 반복 → 재시도 소진 후 region status failed", async () => {
    const fetchImpl = queueFetch([{ status: 500, body: "oops" }]);
    const c = collectorFor(fetchImpl);
    const result = await c.collectRegion(m);
    expect(result.status).toBe("failed");
    expect(c.stats.requests).toBe(3); // 최초 + 재시도 2
    expect(c.stats.retries).toBe(2);
    expect(c.stats.failedRequests).toBe(1);
  });

  it("HTTP 200 이지만 비-JSON + returnReasonCode 30 → FatalApiError", async () => {
    const fetchImpl = queueFetch([
      {
        body: "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>",
      },
    ]);
    await expect(
      collectorFor(fetchImpl).collectRegion(m),
    ).rejects.toBeInstanceOf(FatalApiError);
  });

  it("예산을 초과하면 FatalApiError, 부분 결과 없음", async () => {
    const fetchImpl = queueFetch([{ body: okBody([hub(1)]) }]);
    const c = collectorFor(fetchImpl, { maxRequests: 2 });
    await c.collectRegion(mapping("z1", "44", "150", "a"));
    await c.collectRegion(mapping("z2", "47", "130", "b"));
    await expect(
      c.collectRegion(mapping("z3", "41", "290", "c")),
    ).rejects.toBeInstanceOf(FatalApiError);
  });

  it("serviceKey 를 정확히 한 번만 인코딩한다(디코딩 키를 URLSearchParams가 인코딩)", async () => {
    const rawKey = "abc+def/ghi==xyz";
    const fetchImpl = queueFetch([{ body: okBody([hub(1)]) }]);
    const c = createCollector({
      fetchImpl,
      serviceKey: rawKey,
      sleep: noopSleep,
      now: fixedNow,
      logger: { warn() {} },
    });
    await c.collectRegion(mapping("z1", "44", "150", "공주시"));
    const url = new URL(fetchImpl.calls[0]);
    expect(url.searchParams.get("serviceKey")).toBe(rawKey);
    expect(url.searchParams.get("baseYm")).toBe(BASE_YM);
    expect(url.searchParams.get("areaCd")).toBe("44");
    expect(url.searchParams.get("signguCd")).toBe("44150");
    // 원문 쿼리에는 이중 인코딩된 %25(=%) 가 없어야 한다.
    expect(url.search).not.toContain("%25");
  });
});

/** pageNo → 응답(객체/함수/Error)을 돌려주는 fake fetch(중심 API). */
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

const hubPage = (from, count) =>
  Array.from({ length: count }, (_, i) => hub(from + i, `cd-${from + i}`));

describe("collectRegion — 결함 1 (수집 완전성)", () => {
  const m = mapping("z1", "44", "150", "공주시");

  it("totalCount 100 인데 1건만 반환되면 status failed + completenessBlockers", async () => {
    const fetchImpl = queueFetch([{ body: okBody([hub(1)], 100) }]);
    const result = await collectorFor(fetchImpl).collectRegion(m);
    expect(result.status).toBe("failed");
    expect(result.completenessBlockers.length).toBeGreaterThan(0);
    expect(result.error).toMatch(/불완전 수집/);
  });

  it("불완전 페이지(3페이지 1/50건) → status failed, 그 페이지는 미저장", async () => {
    const fetchImpl = fetchByPage({
      1: okBody(hubPage(1, 100), 250, 1),
      2: okBody(hubPage(101, 100), 250, 2),
      3: okBody(hubPage(201, 1), 250, 3), // 기대 50, 실제 1
    });
    const result = await collectorFor(fetchImpl).collectRegion(m);
    expect(result.status).toBe("failed");
    expect(result.done).toBe(false);
    expect(Object.keys(result.validatedPages).sort()).toEqual(["1", "2"]);
    expect(
      result.completenessBlockers.some((b) => b.includes("건수 부족")),
    ).toBe(true);
  });

  it("페이지별 totalCount 가 계속 흔들리면 재시작 소진 후 status failed", async () => {
    const fetchImpl = fetchByPage({
      1: okBody(hubPage(1, 100), 250, 1),
      2: okBody(hubPage(101, 100), 250, 2),
      3: okBody(hubPage(201, 50), 240, 3), // 매번 드리프트
    });
    const result = await collectorFor(fetchImpl).collectRegion(m);
    expect(result.status).toBe("failed");
    expect(result.restarted).toBeGreaterThanOrEqual(2);
    expect(
      result.completenessBlockers.some((b) => b.includes("일관성 붕괴")),
    ).toBe(true);
  });

  it("모든 페이지가 채워지면 status ok", async () => {
    const fetchImpl = fetchByPage({
      1: okBody(hubPage(1, 100), 250, 1),
      2: okBody(hubPage(101, 100), 250, 2),
      3: okBody(hubPage(201, 50), 250, 3),
    });
    const result = await collectorFor(fetchImpl).collectRegion(m);
    expect(result.status).toBe("ok");
    expect(result.done).toBe(true);
    expect(result.collected).toBe(250);
    expect(result.completenessBlockers).toEqual([]);
  });

  it("hubTatsCd 가 빠진 항목이 섞이면 그 페이지는 미저장·status failed", async () => {
    const holed = [
      ...hubPage(201, 49),
      { ...hub(250), hubTatsCd: "" }, // 건수는 50건이지만 식별자 없음
    ];
    const fetchImpl = fetchByPage({
      1: okBody(hubPage(1, 100), 250, 1),
      2: okBody(hubPage(101, 100), 250, 2),
      3: okBody(holed, 250, 3),
    });
    const result = await collectorFor(fetchImpl).collectRegion(m);
    expect(result.status).toBe("failed");
    expect(result.done).toBe(false);
    expect(Object.keys(result.validatedPages).sort()).toEqual(["1", "2"]);
  });

  it("ID 누락 페이지 → --resume 에서 정상 페이지로 실제 복구(1·2 재호출 안 함)", async () => {
    const first = fetchByPage({
      1: okBody(hubPage(1, 100), 250, 1),
      2: okBody(hubPage(101, 100), 250, 2),
      3: okBody(
        [...hubPage(201, 49), { ...hub(250), hubTatsCd: "  " }],
        250,
        3,
      ),
    });
    const run1 = await collectorFor(first).collectRegion(m);
    expect(run1.status).toBe("failed");
    expect(Object.keys(run1.validatedPages).map(Number).sort()).toEqual([1, 2]);

    const second = fetchByPage({ 3: okBody(hubPage(201, 50), 250, 3) });
    const run2 = await collectorFor(second).collectRegion(m, {
      savedPages: run1.validatedPages,
    });
    expect(second.calls).toEqual([3]);
    expect(run2.status).toBe("ok");
    expect(run2.collected).toBe(250);
  });
});

describe("collectRegion — 결함 3 (페이지 재개)", () => {
  const m = mapping("z1", "44", "150", "공주시");
  const validated = (from, count, totalCount) => ({
    totalCount,
    items: hubPage(from, count),
    complete: true,
  });

  it("검증 통과한 1·2페이지는 다시 호출하지 않고 3페이지만 조회한다", async () => {
    const fetchImpl = fetchByPage({ 3: okBody(hubPage(201, 50), 250, 3) });
    const result = await collectorFor(fetchImpl).collectRegion(m, {
      savedPages: { 1: validated(1, 100, 250), 2: validated(101, 100, 250) },
    });
    expect(fetchImpl.calls).toEqual([3]);
    expect(result.status).toBe("ok");
    expect(result.collected).toBe(250);
  });

  it("불완전 응답 → 재개 시 정상 응답으로 실제 복구된다(1·2페이지 재호출 안 함)", async () => {
    // 1차: 1·2 정상, 3페이지 1/50건.
    const first = fetchByPage({
      1: okBody(hubPage(1, 100), 250, 1),
      2: okBody(hubPage(101, 100), 250, 2),
      3: okBody(hubPage(201, 1), 250, 3),
    });
    const run1 = await collectorFor(first).collectRegion(m);
    expect(run1.status).toBe("failed");
    expect(Object.keys(run1.validatedPages).map(Number).sort()).toEqual([1, 2]);

    // 2차 --resume: 3페이지가 정상 50건.
    const second = fetchByPage({ 3: okBody(hubPage(201, 50), 250, 3) });
    const run2 = await collectorFor(second).collectRegion(m, {
      savedPages: run1.validatedPages,
    });
    expect(second.calls).toEqual([3]);
    expect(run2.status).toBe("ok");
    expect(run2.collected).toBe(250);
  });

  it("네트워크 실패 후 재개하면 검증 통과 1·2페이지를 다시 부르지 않는다", async () => {
    const first = fetchByPage({
      1: okBody(hubPage(1, 100), 250, 1),
      2: okBody(hubPage(101, 100), 250, 2),
      3: () =>
        (() => {
          throw Object.assign(new Error("boom"), { code: "ECONNRESET" });
        })(),
    });
    const failed = await collectorFor(first).collectRegion(m);
    expect(failed.status).toBe("failed");
    expect(Object.keys(failed.validatedPages).map(Number).sort()).toEqual([
      1, 2,
    ]);

    const second = fetchByPage({ 3: okBody(hubPage(201, 50), 250, 3) });
    const resumed = await collectorFor(second).collectRegion(m, {
      savedPages: failed.validatedPages,
    });
    expect(second.calls).toEqual([3]);
    expect(resumed.status).toBe("ok");
    expect(resumed.collected).toBe(250);
  });

  it("재개 중 totalCount 변동 → 저장 페이지 무효화하고 1페이지부터 재수집", async () => {
    let page3 = 0;
    const fetchImpl = fetchByPage({
      1: () => okBody(hubPage(1, 100), 250, 1),
      2: () => okBody(hubPage(101, 100), 250, 2),
      3: () => {
        page3 += 1;
        return page3 === 1
          ? okBody(hubPage(201, 40), 240, 3) // 재개 시 드리프트
          : okBody(hubPage(201, 50), 250, 3); // 재시작 후 정상
      },
    });
    const result = await collectorFor(fetchImpl).collectRegion(m, {
      savedPages: { 1: validated(1, 100, 250), 2: validated(101, 100, 250) },
    });
    expect(result.restarted).toBe(1);
    expect(fetchImpl.calls).toEqual([3, 1, 2, 3]);
    expect(result.status).toBe("ok");
  });
});

describe("validateDocument", () => {
  const sampleRegion = (district, extra = {}) => ({
    regionId: `z-${district}`,
    name: `x ${district}`,
    district,
    status: "ok",
    collected: 100,
    totalCount: 100,
    hubs: [
      {
        hubTatsCd: `cd-${district}`,
        hubTatsName: `${district} 대표`,
        hubRank: 1,
      },
    ],
    ...extra,
  });

  const goodDoc = () => ({
    schemaVersion: 1,
    baseYm: "202608",
    regions: [
      ...Array.from({ length: 210 }, (_, i) => sampleRegion(`더미${i}`)),
      sampleRegion("공주시", {
        hubs: [{ hubTatsCd: "cd-gongsan", hubTatsName: "공산성", hubRank: 2 }],
      }),
      sampleRegion("익산시"),
      sampleRegion("경주시"),
      sampleRegion("과천시", { collected: 63, totalCount: 63 }),
      sampleRegion("광명시", { collected: 93, totalCount: 93 }),
      sampleRegion("파주시"),
    ],
  });

  it("정상 문서는 차단 사유가 없다", () => {
    expect(validateDocument(goodDoc())).toEqual([]);
  });

  it("실패 지역이 남으면 차단", () => {
    const doc = goodDoc();
    doc.regions.push({
      regionId: "z-fail",
      name: "x",
      district: "실패군",
      status: "failed",
    });
    expect(validateDocument(doc).some((b) => b.includes("실패 지역"))).toBe(
      true,
    );
  });

  it("표본 지역 누락은 차단", () => {
    const doc = goodDoc();
    doc.regions = doc.regions.filter((r) => r.district !== "경주시");
    expect(validateDocument(doc).some((b) => b.includes("경주시"))).toBe(true);
  });

  it("잘못된 baseYm 은 차단", () => {
    const doc = goodDoc();
    doc.baseYm = "202607";
    expect(validateDocument(doc).some((b) => b.includes("baseYm"))).toBe(true);
  });

  it("공주시에 공산성이 없으면 회귀 실패로 차단", () => {
    const doc = goodDoc();
    doc.regions.find((r) => r.district === "공주시").hubs = [
      { hubTatsCd: "cd-other", hubTatsName: "다른곳", hubRank: 1 },
    ];
    expect(validateDocument(doc).some((b) => b.includes("공산성"))).toBe(true);
  });

  it("ok 인데 totalCount ≠ 수집+중복 이면 차단(결함 1)", () => {
    const doc = goodDoc();
    doc.regions.find((r) => r.district === "익산시").collected = 1;
    doc.regions.find((r) => r.district === "익산시").totalCount = 100;
    expect(validateDocument(doc).some((b) => b.includes("불일치한 지역"))).toBe(
      true,
    );
  });
});
