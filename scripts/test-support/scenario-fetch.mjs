/**
 * 통제된 fetch 픽스처. 두 수집기 CLI(`build-region-profile.mjs`·
 * `build-central-attractions.mjs`)를 `child_process` 로 실제 실행하면서 네트워크 대신
 * 이 모듈을 주입한다(`DURUDURU_TEST_FETCH_MODULE`). `createTestFetch` 를 export 한다.
 *
 * 시나리오 파일(JSON, `DURUDURU_TEST_FETCH_SCENARIO`):
 *   {
 *     keyBy: "signguCd" | "profileSpec",   // 요청 → unit 키 결정
 *     pageSize: 1000,
 *     units: {
 *       "<key>": {
 *         // (A) 명시적 페이지
 *         pages: { "1": { totalCount, items?, resultCode?, httpStatus?, crashOnCall? },
 *                  "*": { ... } },
 *         // (B) 자동 페이지네이션 — total 개 항목을 pageSize 로 잘라 준다
 *         paginate: {
 *           total, idPrefix, idField,
 *           fields: { <k>: <상수> | [배열, n%len] | "$n" | "$n1" },
 *           prependPage1: [ {...} ],          // 1페이지 앞에 붙일 고정 항목
 *           pageOverrides: { "3": { crashOnCall: 1, dropIdCount: 1, totalCount } }
 *         }
 *       },
 *       "*": { ... }                          // 정의 안 된 unit 기본값
 *     }
 *   }
 *
 * 모든 요청은 `DURUDURU_TEST_FETCH_LOG` 에 `{key,pageNo}` 한 줄씩 append 된다.
 * `crashOnCall: n` = 그 page 의 n 번째 호출에서 `process.exit(137)`(하드 크래시 흉내).
 * `dropIdCount: k` = 그 페이지 마지막 k 개 항목의 식별자를 비운다(ID 누락 회귀용).
 */

import { appendFileSync, readFileSync } from "node:fs";

const PROFILE_SPEC_KEYS = [
  "lclsSystm1",
  "lclsSystm2",
  "lclsSystm3",
  "contentTypeId",
];

function profileSpecKey(params) {
  const parts = PROFILE_SPEC_KEYS.filter((k) => params.has(k)).map(
    (k) => `${k}=${params.get(k)}`,
  );
  return parts.join("&") || "default";
}

function materializeField(value, n) {
  if (Array.isArray(value)) return value[n % value.length];
  if (value === "$n") return String(n);
  if (value === "$n1") return String(n + 1);
  return value;
}

/** paginate unit 의 전체 가상 항목 목록(항상 같은 순서). */
function fullList(paginate) {
  const idField = paginate.idField ?? "id";
  const prepend = paginate.prependPage1 ?? [];
  const generated = [];
  const genCount = paginate.total - prepend.length;
  for (let i = 0; i < genCount; i += 1) {
    const item = { [idField]: `${paginate.idPrefix ?? "gen"}-${i}` };
    for (const [key, value] of Object.entries(paginate.fields ?? {})) {
      item[key] = materializeField(value, i);
    }
    generated.push(item);
  }
  return [...prepend, ...generated];
}

function pageFromPaginate(paginate, pageNo, pageSize, list) {
  const start = (pageNo - 1) * pageSize;
  const slice = list.slice(start, start + pageSize).map((it) => ({ ...it }));
  const override = paginate.pageOverrides?.[String(pageNo)] ?? {};
  if (override.dropIdCount) {
    const idField = paginate.idField ?? "id";
    for (
      let i = slice.length - override.dropIdCount;
      i < slice.length;
      i += 1
    ) {
      if (slice[i]) slice[i][idField] = "";
    }
  }
  return {
    items: slice,
    totalCount:
      typeof override.totalCount === "number"
        ? override.totalCount
        : list.length,
    crashOnCall: override.crashOnCall,
    resultCode: override.resultCode,
    httpStatus: override.httpStatus,
  };
}

export function createTestFetch() {
  const scenarioPath = process.env.DURUDURU_TEST_FETCH_SCENARIO;
  const logPath = process.env.DURUDURU_TEST_FETCH_LOG;
  const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
  const pageSize = scenario.pageSize ?? 1000;
  const callCounts = new Map();
  const listCache = new Map();

  return async function testFetch(url) {
    const u = new URL(String(url));
    const params = u.searchParams;
    const pageNo = Number(params.get("pageNo") || "1");
    const key =
      scenario.keyBy === "signguCd"
        ? params.get("signguCd")
        : profileSpecKey(params);

    if (logPath) {
      appendFileSync(logPath, `${JSON.stringify({ key, pageNo })}\n`);
    }

    const unit = scenario.units[key] ?? scenario.units["*"] ?? { pages: {} };

    let pageSpec;
    if (unit.paginate) {
      if (!listCache.has(key)) listCache.set(key, fullList(unit.paginate));
      pageSpec = pageFromPaginate(
        unit.paginate,
        pageNo,
        pageSize,
        listCache.get(key),
      );
    } else {
      pageSpec = unit.pages?.[String(pageNo)] ??
        unit.pages?.["*"] ?? { totalCount: 0, items: [] };
    }

    if (pageSpec.crashOnCall) {
      const cc = `${key}|${pageNo}`;
      const seen = (callCounts.get(cc) ?? 0) + 1;
      callCounts.set(cc, seen);
      if (seen === pageSpec.crashOnCall) process.exit(137);
    }

    if (pageSpec.httpStatus && pageSpec.httpStatus !== 200) {
      return {
        status: pageSpec.httpStatus,
        ok: false,
        text: async () => "server error",
      };
    }

    const items = pageSpec.items ?? [];
    const totalCount =
      typeof pageSpec.totalCount === "number"
        ? pageSpec.totalCount
        : items.length;
    const body = {
      response: {
        header: { resultCode: pageSpec.resultCode ?? "0000", resultMsg: "OK" },
        body: {
          items: { item: items },
          totalCount,
          numOfRows: pageSize,
          pageNo,
        },
      },
    };
    return { status: 200, ok: true, text: async () => JSON.stringify(body) };
  };
}
