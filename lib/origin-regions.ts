import catalog from "@/data/origin-regions.json";
export const ORIGIN_REGIONS = catalog.regions;
export const ORIGIN_MAPPING_VERSION = catalog.mappingGeneratedAt;
const byId = new Map(ORIGIN_REGIONS.map((row) => [row.id, row]));
export function originRegion(id: unknown) {
  if (typeof id !== "string") return undefined;
  return byId.get(
    id === "seoul" ? "ktdb-zone-2" : id === "busan" ? "ktdb-zone-26" : id,
  );
}
export function searchOriginRegions(query: string, province = "") {
  const key = query
    .trim()
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .toLocaleLowerCase("ko");
  return ORIGIN_REGIONS.filter(
    (row) =>
      (!province || row.province === province) &&
      (!key ||
        [row.label, ...row.aliases].some((label) =>
          label.replace(/\s+/gu, "").toLocaleLowerCase("ko").includes(key),
        )),
  );
}
