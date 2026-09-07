import culture from "@/data/food-culture-keywords.json";
import certifications from "@/data/excellent-restaurant-certifications.json";
import type { Restaurant } from "@/lib/mvp-core";

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^0-9a-z가-힣]/gu, "");
export function prioritizeRestaurants(
  regionId: string,
  raw: Array<{
    contentid?: string;
    title?: string;
    addr1?: string;
    tel?: string;
  }>,
): Restaurant[] {
  const keywords = new Set(
    culture.regions.find((item) => item.regionId === regionId)?.keywords ?? [],
  );
  return raw
    .map((item) => {
      const name = item.title?.trim() ?? "",
        address = item.addr1?.trim() ?? "",
        phone = (item.tel ?? "").replace(/\D/gu, "");
      const certification = certifications.certifications.find((record) => {
        const phoneMatches = Boolean(phone) && record.phone === phone;
        const addressMatches =
          normalize(record.roadAddress) === normalize(address) ||
          normalize(record.lotAddress) === normalize(address);
        return (
          phoneMatches ||
          (normalize(record.name) === normalize(name) && addressMatches)
        );
      });
      return {
        contentId: item.contentid ?? "",
        name,
        address,
        phone,
        certified: Boolean(certification),
        foodCultureMatch: [...keywords].some((keyword) =>
          name.includes(keyword),
        ),
      };
    })
    .filter((item) => item.contentId && item.name)
    .toSorted(
      (a, b) =>
        Number(b.foodCultureMatch) - Number(a.foodCultureMatch) ||
        Number(b.certified) - Number(a.certified) ||
        a.contentId.localeCompare(b.contentId),
    );
}
