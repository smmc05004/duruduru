#!/usr/bin/env node

/**
 * 보수적 원천 연결·배포 묶음 (T4).
 *
 * 기획서 D3(`docs/product/TOURISM_RECOMMENDATION_UPGRADE.md`), 작업 계획 T4
 * (`docs/development/TOURISM_RECOMMENDATION_WORK_PLAN.md`)를 따른다.
 *
 * - 입력(외부 호출 없음, 로컬 JSON만):
 *     data/region-profiles.json     (schemaVersion 2, contentId·좌표·분류)
 *     data/central-attractions.json (schemaVersion 1, hubTatsCd·hubRank·좌표, baseYm 202608)
 *     data/region-mapping.json      (schemaVersion 1, mappingVersion 2026-09-06)
 * - 세 원천의 baseYm·classificationVersion·mappingVersion 이 맞지 않으면 섞지 않고 실패한다.
 * - 출력: data/tourism-evidence.json (연결 인덱스 + 배포 묶음 참조).
 *   런타임 검색은 regions[regionId].matched[contentId] 를 O(1) 조회만 한다(전체 비교 없음).
 * - 안전 배포: 항상 data/tourism-evidence.next.json(+ 품질 보고)로만 쓴다. 검증 통과 시
 *   `--promote` 로만 data/tourism-evidence.json 을 교체한다. 기존 정상본으로 재배포 가능.
 *
 * 사용법:
 *   npm run build:tourism-evidence
 *   npm run build:tourism-evidence -- --promote
 *   npm run build:tourism-evidence -- --promote-only   # 새 계산 없이 next.json 재검증 후 교체
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildEvidenceDocument,
  validateDocument,
} from "./lib/tourism-evidence-core.mjs";

const DATA_DIR = "data";
const PROFILES_PATH = `${DATA_DIR}/region-profiles.json`;
const CENTRAL_PATH = `${DATA_DIR}/central-attractions.json`;
const MAPPING_PATH = `${DATA_DIR}/region-mapping.json`;
const LIVE_PATH = `${DATA_DIR}/tourism-evidence.json`;
const NEXT_PATH = `${DATA_DIR}/tourism-evidence.next.json`;
const REPORT_PATH = `${DATA_DIR}/tourism-evidence.quality-report.json`;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
for (const flag of flags) {
  if (!["--promote", "--promote-only"].includes(flag)) {
    throw new Error(`알 수 없는 옵션: ${flag}`);
  }
}
const promote = flags.has("--promote");
const promoteOnly = flags.has("--promote-only");

const jsonLine = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(resolve(tempPath), jsonLine(value), "utf8");
  await rename(resolve(tempPath), resolve(path));
}

const readJson = async (path) =>
  JSON.parse(await readFile(resolve(path), "utf8"));

function buildReport(doc) {
  const sampleRegionIds = {
    "ktdb-zone-154": "공주시",
    "ktdb-zone-207": "경주시",
    "ktdb-zone-171": "익산시",
    "ktdb-zone-97": "과천시",
    "ktdb-zone-89": "광명시",
    "ktdb-zone-108": "파주시",
  };
  const samples = Object.entries(sampleRegionIds).map(([regionId, label]) => {
    const region = doc.regions[regionId];
    if (!region) return { regionId, label, missing: true };
    const linkRate =
      region.hubCount > 0
        ? Number((region.matchedCount / region.hubCount).toFixed(3))
        : null;
    return {
      regionId,
      label,
      centralStatus: region.centralStatus,
      hubCount: region.hubCount,
      profileAttractionCount: region.profileAttractionCount,
      matched: region.matchedCount,
      linkRate,
      ambiguous: region.ambiguous.length,
      rejected: region.rejected.length,
      superseded: region.superseded.length,
      unmatchedTop: region.unmatched.slice(0, 8).map((u) => u.hubTatsName),
      matchedSample: Object.values(region.matched)
        .slice(0, 10)
        .map((m) => ({
          hub: m.hubTatsName,
          contentTitle: m.contentTitle,
          contentId: m.contentId,
          hubRank: m.hubRank,
          method: m.method,
          distanceM: m.distanceM,
        })),
      rejectedSample: region.rejected.map((r) => ({
        hub: r.hubTatsName,
        contentTitle: r.contentTitle,
        reason: r.reason,
        distanceM: r.distanceM,
      })),
      supersededSample: region.superseded,
    };
  });

  const linkRateAll =
    doc.summary.hubsConsidered > 0
      ? Number((doc.summary.matched / doc.summary.hubsConsidered).toFixed(4))
      : null;

  return {
    generatedAt: doc.generatedAt,
    dataVersion: doc.dataVersion,
    baseYm: doc.baseYm,
    bundle: doc.bundle,
    summary: { ...doc.summary, linkRateAll },
    samples,
    validation: validateDocument(doc),
  };
}

async function promoteFrom(nextDoc) {
  const blockers = validateDocument(nextDoc);
  if (blockers.length) {
    console.error("[promote] 검증 실패, 교체하지 않습니다:");
    for (const b of blockers) console.error(`  - ${b}`);
    process.exitCode = 1;
    return false;
  }
  await writeJsonAtomic(LIVE_PATH, nextDoc);
  console.log(`[promote] ${NEXT_PATH} → ${LIVE_PATH} 교체 완료.`);
  return true;
}

async function main() {
  if (promoteOnly) {
    const next = await readJson(NEXT_PATH);
    await promoteFrom(next);
    return;
  }

  const [profiles, central, mapping] = await Promise.all([
    readJson(PROFILES_PATH),
    readJson(CENTRAL_PATH),
    readJson(MAPPING_PATH),
  ]);

  const doc = buildEvidenceDocument({ profiles, central, mapping });
  const report = buildReport(doc);

  await writeJsonAtomic(NEXT_PATH, doc);
  await writeFile(resolve(REPORT_PATH), jsonLine(report), "utf8");

  const s = doc.summary;
  console.log("\n=== 연결 요약 ===");
  console.log(
    `프로필 지역 ${s.regionsWithProfile} · 중심 있음 ${s.regionsWithCentral} · 중심 없음 ${s.regionsWithoutCentral} · 중심 empty ${s.centralEmptyRegions}`,
  );
  console.log(`중심 항목 ${s.hubsConsidered}개 검토`);
  console.log(
    `matched ${s.matched} · unmatched ${s.unmatched} · ambiguous ${s.ambiguous} · rejected ${s.rejected} · superseded ${s.superseded}`,
  );
  console.log(`matched 방법 분포 ${JSON.stringify(s.matchMethods)}`);
  console.log(`reject 사유 ${JSON.stringify(s.rejectReasons)}`);
  console.log(`ambiguous 사유 ${JSON.stringify(s.ambiguousReasons)}`);
  console.log(`관광 일정 비대상 카테고리로 matched ${s.nonItineraryMatched}건`);
  console.log(`\n표본 지역:`);
  for (const sample of report.samples) {
    if (sample.missing) {
      console.log(`  ${sample.label}: 프로필 없음`);
      continue;
    }
    console.log(
      `  ${sample.label}: matched ${sample.matched}/${sample.hubCount} (연결률 ${sample.linkRate}) · ambiguous ${sample.ambiguous} · rejected ${sample.rejected} · superseded ${sample.superseded}`,
    );
  }
  console.log(`\n임시 출력: ${NEXT_PATH}\n품질 보고: ${REPORT_PATH}`);

  const blockers = validateDocument(doc);
  if (blockers.length) {
    console.error("\n[검증 차단] 다음 사유로 --promote 교체를 막습니다:");
    for (const b of blockers) console.error(`  - ${b}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n[검증 통과] --promote 로 교체할 수 있습니다.");

  if (promote) {
    await promoteFrom(doc);
  }
}

const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\n[실패] ${error.message}`);
    process.exitCode = 1;
  });
}
