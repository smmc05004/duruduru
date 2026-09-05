#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function usage() {
  throw new Error(
    "사용법: node scripts/build-ktdb-travel-times.mjs <도로네트워크.in> <존체계.xlsx> <출력.json>",
  );
}

function readZipEntry(filePath, entry) {
  const result = spawnSync("unzip", ["-p", filePath, entry], {
    encoding: "utf8",
  });

  if (result.status !== 0 || !result.stdout) {
    throw new Error(`${filePath}에서 ${entry}을 읽지 못했습니다.`);
  }

  return result.stdout;
}

function decodeXml(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .trim();
}

function parseZones(xlsxPath) {
  const sharedStringsXml = readZipEntry(xlsxPath, "xl/sharedStrings.xml");
  const sharedStrings = [
    ...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map((match) => decodeXml(match[1]));
  const worksheetXml = readZipEntry(xlsxPath, "xl/worksheets/sheet1.xml");
  const rows = [...worksheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];

  const zones = rows.slice(1).map((row) => {
    const cells = new Map();

    for (const cell of row[1].matchAll(
      /<c r="([A-Z]+)\d+"(?:[^>]*?t="(s)")?[^>]*><v>([^<]+)<\/v><\/c>/g,
    )) {
      const [, column, stringType, rawValue] = cell;
      cells.set(
        column,
        stringType === "s" ? sharedStrings[Number(rawValue)] : rawValue,
      );
    }

    const nodeId = Number(cells.get("D"));
    const province = cells.get("B");
    const district = cells.get("C");

    if (!Number.isInteger(nodeId) || !province || !district) {
      throw new Error(
        "KTDB 존체계 파일의 시도·시군구·161존체계를 읽지 못했습니다.",
      );
    }

    return {
      id: `ktdb-zone-${nodeId}`,
      name: `${province} ${district}`,
      networkNodeId: nodeId,
      province,
      district,
    };
  });

  if (
    zones.length !== 252 ||
    new Set(zones.map((zone) => zone.networkNodeId)).size !== zones.length
  ) {
    throw new Error(`KTDB 252존을 기대했지만 ${zones.length}개를 읽었습니다.`);
  }

  return zones;
}

function parseRoadNetwork(networkText) {
  const graph = new Map();
  let linksStarted = false;

  for (const line of networkText.split(/\r?\n/)) {
    if (line.startsWith("t links init")) {
      linksStarted = true;
      continue;
    }
    if (!linksStarted || !line.startsWith("a ")) continue;

    const fields = line.trim().split(/\s+/);
    const [, fromText, toText, lengthText, modes, , , , speedText] = fields;
    const from = Number(fromText);
    const to = Number(toText);
    const lengthKm = Number(lengthText);
    const baseSpeedKph = Number(speedText);

    if (
      !modes.includes("c") ||
      !Number.isFinite(baseSpeedKph) ||
      baseSpeedKph <= 0
    ) {
      continue;
    }

    const minutes = (lengthKm / baseSpeedKph) * 60;
    if (!Number.isFinite(minutes) || minutes < 0) continue;

    const edges = graph.get(from) ?? [];
    edges.push({ to, minutes });
    graph.set(from, edges);
  }

  return graph;
}

class MinHeap {
  #items = [];

  push(item) {
    this.#items.push(item);
    let index = this.#items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.#items[parent].minutes <= item.minutes) break;
      this.#items[index] = this.#items[parent];
      index = parent;
    }
    this.#items[index] = item;
  }

  pop() {
    if (this.#items.length === 0) return undefined;
    const first = this.#items[0];
    const last = this.#items.pop();
    if (this.#items.length === 0) return first;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.#items.length) break;
      const child =
        right < this.#items.length &&
        this.#items[right].minutes < this.#items[left].minutes
          ? right
          : left;
      if (this.#items[child].minutes >= last.minutes) break;
      this.#items[index] = this.#items[child];
      index = child;
    }
    this.#items[index] = last;
    return first;
  }

  get size() {
    return this.#items.length;
  }
}

function shortestPaths(graph, start) {
  const distances = new Map([[start, 0]]);
  const queue = new MinHeap();
  queue.push({ node: start, minutes: 0 });

  while (queue.size > 0) {
    const current = queue.pop();
    if (current.minutes !== distances.get(current.node)) continue;

    for (const edge of graph.get(current.node) ?? []) {
      const candidate = current.minutes + edge.minutes;
      if (candidate >= (distances.get(edge.to) ?? Infinity)) continue;
      distances.set(edge.to, candidate);
      queue.push({ node: edge.to, minutes: candidate });
    }
  }

  return distances;
}

const [networkPath, zonePath, outputPath] = process.argv.slice(2);
if (!networkPath || !zonePath || !outputPath) usage();

const [networkText, zones] = await Promise.all([
  readFile(networkPath, "utf8"),
  parseZones(zonePath),
]);
const graph = parseRoadNetwork(networkText);
const minutes = zones.map((origin) => {
  const distances = shortestPaths(graph, origin.networkNodeId);
  return zones.map((destination) => {
    const value = distances.get(destination.networkNodeId);
    return value === undefined ? null : Math.round(value);
  });
});

const output = {
  schemaVersion: 1,
  source: {
    provider: "한국교통연구원 국가교통DB(KTDB)",
    dataset: "2025-TRNT-RO-00 (도로) 전국 지역간 네트워크(2024-2035)",
    networkYear: 2024,
    representativePoint: "KTDB 252존 중심 노드",
    routingCost: "승용차 링크 기본 속도(통행량·시간대·실시간 교통 미반영)",
  },
  generatedAt: new Date().toISOString(),
  regions: zones,
  minutes,
};

await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`, "utf8");
console.log(
  `${zones.length}개 지역, ${zones.length ** 2}개 이동시간을 ${outputPath}에 생성했습니다.`,
);
