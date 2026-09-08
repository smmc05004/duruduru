import type { RegionMapping } from "@/lib/mvp-region-data";

/** Pure grouping policy shared by search and selected-region API validation. */
export function groupForMapping(
  mapping: Pick<RegionMapping, "province" | "district">,
) {
  const metropolitan = /(?:특별시|광역시|특별자치시)$/u.test(mapping.province);
  // Mapping stores ordinary districts as e.g. "수원시 장안구". A city
  // name can itself start with 시/군 (시흥시, 군산시), so never split at
  // the first occurrence of those characters.
  const district = mapping.district.trim().split(/\s+/u)[0];
  return metropolitan
    ? {
        groupId: `metropolitan:${mapping.province}`,
        displayName: mapping.province,
        name: mapping.province,
        province: mapping.province,
      }
    : {
        groupId: `municipality:${mapping.province}:${district}`,
        displayName: district.replace(/[시군]$/u, ""),
        name: `${mapping.province} ${district}`,
        province: mapping.province,
      };
}
