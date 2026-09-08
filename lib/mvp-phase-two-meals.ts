import type {
  Coordinates,
  PlanSnapshot,
  Restaurant,
  TimeBlock,
} from "@/lib/mvp-phase-two-types";

function distance(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const value =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, value))));
}

function mealAnchors(
  plan: PlanSnapshot,
  meal: TimeBlock,
): Array<Coordinates | null> {
  const visits = plan.blocks
    .filter(
      (block) =>
        block.day === meal.day &&
        block.kind === "attraction" &&
        block.attraction,
    )
    .toSorted((a, b) => a.startAt.localeCompare(b.startAt));
  const before = visits.filter((visit) => visit.endAt <= meal.startAt).at(-1);
  const after = visits.find((visit) => visit.startAt >= meal.endAt);
  const adjacent = [before, after].filter((block): block is TimeBlock =>
    Boolean(block),
  );
  if (!adjacent.length && visits[0]) adjacent.push(visits[0]);
  return adjacent.map((block) => block.attraction?.coordinates ?? null);
}

function ranked(
  plan: PlanSnapshot,
  meal: TimeBlock,
  restaurants: Restaurant[],
): Restaurant[] {
  const anchors = mealAnchors(plan, meal);
  const score = (restaurant: Restaurant) => {
    if (
      !restaurant.coordinates ||
      !anchors.length ||
      anchors.some((anchor) => !anchor)
    )
      return Infinity;
    return anchors.reduce<number>(
      (sum, anchor) => sum + distance(restaurant.coordinates!, anchor!),
      0,
    );
  };
  const unique = new Map<string, Restaurant>();
  for (const restaurant of restaurants) {
    if (
      restaurant.contentId &&
      plan.destination.memberRegionIds.includes(restaurant.regionId) &&
      !unique.has(restaurant.contentId)
    ) {
      unique.set(restaurant.contentId, restaurant);
    }
  }
  return [...unique.values()].toSorted((a, b) => {
    const aDistance = score(a),
      bDistance = score(b);
    return (
      (aDistance === bDistance ? 0 : aDistance < bDistance ? -1 : 1) ||
      Number(b.foodCultureMatch) - Number(a.foodCultureMatch) ||
      Number(b.certified) - Number(a.certified) ||
      a.contentId.localeCompare(b.contentId)
    );
  });
}

export function restaurantAlternatives(
  plan: PlanSnapshot,
  mealBlockId: string,
  restaurants: Restaurant[],
): Restaurant[] {
  const meal = plan.blocks.find(
    (block) =>
      block.id === mealBlockId &&
      block.kind === "meal" &&
      block.mealScope === "local",
  );
  if (!meal) return [];
  const used = new Set(
    plan.blocks
      .filter((block) => block.kind === "meal" && block.restaurant)
      .map((block) => block.restaurant!.contentId),
  );
  return ranked(plan, meal, restaurants).filter(
    (restaurant) => !used.has(restaurant.contentId),
  );
}

function withRestaurant(meal: TimeBlock, restaurant?: Restaurant): TimeBlock {
  return {
    ...meal,
    restaurant,
    contentId: restaurant?.contentId,
    title: restaurant?.name ?? "추천할 식당을 더 찾지 못했어요",
    reason: restaurant
      ? "식사 앞뒤 관광지의 직선거리 근접성을 우선하고 향토음식·모범음식점 근거를 보조로 참고했어요. 방문 전 운영 정보를 확인해 주세요."
      : "식사 60분은 유지했어요. 음식점 목록을 다시 불러오거나 자유롭게 식사해 주세요.",
  };
}

/** Fill empty local meals; retries and attraction edits preserve existing choices. */
export function assignRestaurants(
  plan: PlanSnapshot,
  restaurants: Restaurant[],
): PlanSnapshot {
  const used = new Set(
    plan.blocks.flatMap((block) =>
      block.restaurant ? [block.restaurant.contentId] : [],
    ),
  );
  let changed = false;
  const blocks = plan.blocks.map((block) => {
    if (
      block.kind !== "meal" ||
      block.mealScope !== "local" ||
      block.restaurant
    )
      return block;
    const restaurant = ranked(plan, block, restaurants).find(
      (item) => !used.has(item.contentId),
    );
    if (restaurant) used.add(restaurant.contentId);
    const next = withRestaurant(block, restaurant);
    if (
      restaurant ||
      next.title !== block.title ||
      next.reason !== block.reason
    )
      changed = true;
    return next;
  });
  return changed
    ? {
        ...plan,
        blocks,
        updatedAt: new Date().toISOString(),
        edited: plan.edited || Boolean(plan.savedAt),
      }
    : plan;
}

export function replaceRestaurant(
  plan: PlanSnapshot,
  mealBlockId: string,
  restaurant: Restaurant,
): PlanSnapshot {
  if (!restaurantAlternatives(plan, mealBlockId, [restaurant]).length)
    return plan;
  return {
    ...plan,
    edited: true,
    updatedAt: new Date().toISOString(),
    blocks: plan.blocks.map((block) =>
      block.id === mealBlockId ? withRestaurant(block, restaurant) : block,
    ),
  };
}
