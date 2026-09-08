import type {
  Attraction,
  Candidate,
  PlanMetrics,
  PlanSnapshot,
  Restaurant,
  TimeBlock,
} from "./mvp-phase-two-types";
import { INTERESTS } from "./mvp-phase-two-types";
import {
  localRestIntervals,
  tripMealWindows,
  parseLocalDate,
  validateSearchInput,
} from "./mvp-phase-two-planner";

const STORAGE_KEY = "duruduru.plans.v2";
const LIMIT = 10;
type StoredResult = { plans: PlanSnapshot[]; error?: string };
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 20_000;
const id = (v: unknown): v is string =>
  text(v) && /^[\p{L}\p{N}:_-]{1,160}$/u.test(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
function timestamp(v: unknown): number {
  if (
    !text(v) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
      v,
    )
  )
    return NaN;
  const date = v.slice(0, 10);
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    return NaN;
  return Date.parse(/[Z]|[+-]\d{2}:\d{2}$/.test(v) ? v : `${v}+09:00`);
}
const validDate = (v: unknown) => Number.isFinite(timestamp(v));
const categories = (v: unknown) =>
  Array.isArray(v) &&
  v.every((c: unknown) => INTERESTS.some((i) => i.id === c));
function coordinates(v: unknown) {
  return (
    v === null ||
    (object(v) &&
      typeof v.latitude === "number" &&
      Number.isFinite(v.latitude) &&
      Math.abs(v.latitude) <= 90 &&
      typeof v.longitude === "number" &&
      Number.isFinite(v.longitude) &&
      Math.abs(v.longitude) <= 180)
  );
}
function attraction(v: unknown): v is Attraction {
  return (
    object(v) &&
    id(v.contentId) &&
    typeof v.contentTypeId === "string" &&
    ["12", "14", "28"].includes(v.contentTypeId) &&
    id(v.regionId) &&
    [v.title, v.address, v.imageUrl, v.cat1, v.cat2, v.cat3].every(text) &&
    categories(v.categories) &&
    coordinates(v.coordinates)
  );
}
function restaurant(v: unknown): v is Restaurant {
  return (
    object(v) &&
    id(v.contentId) &&
    id(v.regionId) &&
    [v.name, v.address, v.phone, v.imageUrl].every(text) &&
    typeof v.certified === "boolean" &&
    typeof v.foodCultureMatch === "boolean" &&
    coordinates(v.coordinates) &&
    validDate(v.fetchedAt)
  );
}
function metrics(v: unknown): v is PlanMetrics {
  return (
    object(v) &&
    parseLocalDate(v.arrivalAt) !== null &&
    parseLocalDate(v.returnDepartureAt) !== null &&
    [
      v.localMinutes,
      v.freeMinutes,
      v.attractionCount,
      v.localMealCount,
      v.categoryDiversity,
    ].every(finite) &&
    categories(v.fulfilledInterests) &&
    (v.averageDistanceKm === null || finite(v.averageDistanceKm))
  );
}
function blocks(
  value: unknown,
  start: number,
  end: number,
): value is TimeBlock[] {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    return false;
  const ids = new Set<string>(),
    visits = new Set<string>(),
    meals = new Set<string>();
  let previous = start;
  for (const b of value) {
    if (
      !object(b) ||
      !id(b.id) ||
      ids.has(b.id) ||
      (b.day !== 1 && b.day !== 2) ||
      typeof b.kind !== "string" ||
      !["travel", "attraction", "meal", "free", "rest"].includes(b.kind) ||
      !text(b.title) ||
      !text(b.reason) ||
      !finite(b.durationMinutes)
    )
      return false;
    if (parseLocalDate(b.startAt) === null || parseLocalDate(b.endAt) === null)
      return false;
    const from = timestamp(b.startAt),
      to = timestamp(b.endAt);
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from !== previous ||
      from < start ||
      to > end ||
      to <= from ||
      Math.abs((to - from) / 60_000 - b.durationMinutes) > 0.01
    )
      return false;
    const startDay = Math.floor((start + 540 * 60_000) / 86_400_000);
    if (Math.floor((from + 540 * 60_000) / 86_400_000) - startDay + 1 !== b.day)
      return false;
    ids.add(b.id);
    previous = to;
    if (b.kind === "attraction") {
      if (
        !attraction(b.attraction) ||
        b.contentId !== b.attraction.contentId ||
        visits.has(b.attraction.contentId) ||
        typeof b.fixed !== "boolean" ||
        ![30, 60, 90, 120].includes(b.durationMinutes)
      )
        return false;
      visits.add(b.attraction.contentId);
    } else if (b.attraction !== undefined) return false;
    if (b.kind === "meal") {
      if (
        (b.mealScope !== "local" && b.mealScope !== "transit") ||
        (b.mealType !== "lunch" && b.mealType !== "dinner") ||
        b.durationMinutes !== 60
      )
        return false;
      if (b.restaurant !== undefined) {
        if (
          b.mealScope !== "local" ||
          !restaurant(b.restaurant) ||
          b.contentId !== b.restaurant.contentId ||
          meals.has(b.restaurant.contentId)
        )
          return false;
        meals.add(b.restaurant.contentId);
      }
    } else if (b.restaurant !== undefined) return false;
    if (
      b.kind === "travel" &&
      b.direction !== "outbound" &&
      b.direction !== "return"
    )
      return false;
  }
  return previous === end;
}
function candidate(v: unknown): v is Candidate {
  if (
    !object(v) ||
    !id(v.groupId) ||
    !id(v.representativeZoneId) ||
    !Array.isArray(v.memberRegionIds) ||
    !v.memberRegionIds.every(id) ||
    ![v.displayName, v.name, v.province].every(text) ||
    !finite(v.oneWayMinutes) ||
    v.oneWayMinutes <= 0 ||
    !Array.isArray(v.attractions) ||
    v.attractions.length > 20_000 ||
    !v.attractions.every(attraction) ||
    !Array.isArray(v.reasons) ||
    !v.reasons.every(text) ||
    !object(v.metadata)
  )
    return false;
  const m = v.metadata;
  return (
    [
      m.profileGeneratedAt,
      m.travelTimeGeneratedAt,
      m.travelTimeSource,
      m.representativePoint,
    ].every(text) &&
    validDate(m.searchedAt) &&
    finite(m.networkYear) &&
    object(v.preview) &&
    metrics(v.preview.metrics)
  );
}

export function isSavedPlan(value: unknown): value is PlanSnapshot {
  try {
    if (
      !object(value) ||
      value.schemaVersion !== 2 ||
      !id(value.id) ||
      !id(value.searchId) ||
      !validDate(value.createdAt) ||
      !validDate(value.updatedAt) ||
      !validDate(value.savedAt) ||
      typeof value.edited !== "boolean" ||
      !candidate(value.destination) ||
      !metrics(value.metrics)
    )
      return false;
    const input = validateSearchInput(value.input);
    if (!input.ok) return false;
    const start = timestamp(input.input.startAt),
      end = timestamp(input.input.returnBy);
    if (
      !blocks(value.blocks, start, end) ||
      !blocks(value.destination.preview.blocks, start, end)
    )
      return false;
    const planBlocks = value.blocks;
    const members = value.destination.memberRegionIds;
    if (
      value.destination.attractions.some(
        (a) => !members.includes(a.regionId),
      ) ||
      new Set(value.destination.attractions.map((a) => a.contentId)).size !==
        value.destination.attractions.length
    )
      return false;
    if (
      planBlocks.some(
        (b) =>
          (b.attraction && !members.includes(b.attraction.regionId)) ||
          (b.restaurant && !members.includes(b.restaurant.regionId)),
      )
    )
      return false;
    const midnight =
      Math.floor((start + 540 * 60_000) / 86_400_000) * 86_400_000 -
      540 * 60_000;
    const expectedRest = localRestIntervals(
      (timestamp(value.metrics.arrivalAt) - midnight) / 60_000,
      (timestamp(value.metrics.returnDepartureAt) - midnight) / 60_000,
    );
    const rest = planBlocks.filter((b) => b.kind === "rest");
    if (
      rest.length !== expectedRest.length ||
      rest.some(
        (b, index) =>
          timestamp(b.startAt) !==
            midnight + expectedRest[index].start * 60_000 ||
          timestamp(b.endAt) !== midnight + expectedRest[index].end * 60_000,
      )
    )
      return false;
    const mealBlocks = planBlocks.filter((b) => b.kind === "meal");
    const expectedMeals = tripMealWindows(input.input);
    if (
      mealBlocks.length !== expectedMeals.length ||
      expectedMeals.some(
        (meal) =>
          mealBlocks.filter(
            (b) => b.day === meal.day && b.mealType === meal.type,
          ).length !== 1,
      )
    )
      return false;
    if (
      planBlocks.some((b) => {
        if (b.kind !== "attraction" && b.kind !== "free") return false;
        const dayStart = midnight + (b.day - 1) * 86_400_000;
        return (
          timestamp(b.startAt) < dayStart + 420 * 60_000 ||
          timestamp(b.endAt) > dayStart + 1260 * 60_000
        );
      })
    )
      return false;
    if (
      mealBlocks.some((b) => {
        const minute =
          (timestamp(b.startAt) - midnight) / 60_000 - (b.day - 1) * 1440;
        return b.mealType === "lunch"
          ? minute < 690 || minute > 750
          : minute < 1050 || minute > 1110;
      })
    )
      return false;
    for (const direction of ["outbound", "return"] as const) {
      if (
        Math.abs(
          planBlocks
            .filter((b) => b.kind === "travel" && b.direction === direction)
            .reduce((sum, b) => sum + b.durationMinutes, 0) -
            value.destination.oneWayMinutes,
        ) > 0.01
      )
        return false;
    }
    const arrival = timestamp(value.metrics.arrivalAt),
      departure = timestamp(value.metrics.returnDepartureAt);
    return (
      arrival >= start &&
      departure <= end &&
      arrival <= departure &&
      value.metrics.attractionCount ===
        planBlocks.filter((b) => b.kind === "attraction").length
    );
  } catch {
    return false;
  }
}

// Whitelist fields: never persist API payloads, HTML detail, credentials or the national profile.
function cleanAttraction(a: Attraction): Attraction {
  return {
    contentId: a.contentId,
    contentTypeId: a.contentTypeId,
    regionId: a.regionId,
    title: a.title,
    address: a.address,
    imageUrl: "",
    coordinates: a.coordinates
      ? { latitude: a.coordinates.latitude, longitude: a.coordinates.longitude }
      : null,
    categories: [...a.categories],
    cat1: a.cat1,
    cat2: a.cat2,
    cat3: a.cat3,
  };
}
function cleanRestaurant(r: Restaurant): Restaurant {
  return {
    contentId: r.contentId,
    regionId: r.regionId,
    name: r.name,
    address: r.address,
    phone: r.phone,
    imageUrl: "",
    coordinates: r.coordinates
      ? { latitude: r.coordinates.latitude, longitude: r.coordinates.longitude }
      : null,
    certified: r.certified,
    foodCultureMatch: r.foodCultureMatch,
    fetchedAt: r.fetchedAt,
  };
}
function cleanBlock(b: TimeBlock): TimeBlock {
  return {
    id: b.id,
    day: b.day,
    startAt: b.startAt,
    endAt: b.endAt,
    kind: b.kind,
    title: b.title,
    durationMinutes: b.durationMinutes,
    contentId: b.contentId,
    attraction: b.attraction ? cleanAttraction(b.attraction) : undefined,
    restaurant: b.restaurant ? cleanRestaurant(b.restaurant) : undefined,
    fixed: b.fixed,
    mealScope: b.mealScope,
    mealType: b.mealType,
    direction: b.direction,
    reason: b.reason,
  };
}
function cleanMetrics(m: PlanMetrics): PlanMetrics {
  return {
    arrivalAt: m.arrivalAt,
    returnDepartureAt: m.returnDepartureAt,
    localMinutes: m.localMinutes,
    freeMinutes: m.freeMinutes,
    attractionCount: m.attractionCount,
    localMealCount: m.localMealCount,
    fulfilledInterests: [...m.fulfilledInterests],
    categoryDiversity: m.categoryDiversity,
    averageDistanceKm: m.averageDistanceKm,
  };
}
function snapshot(plan: PlanSnapshot): PlanSnapshot {
  const d = plan.destination,
    m = d.metadata;
  return {
    schemaVersion: 2,
    id: plan.id,
    searchId: plan.searchId,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    savedAt: new Date().toISOString(),
    edited: plan.edited,
    input: {
      originId: plan.input.originId,
      transport: "car",
      startAt: plan.input.startAt,
      returnBy: plan.input.returnBy,
      interests: [...plan.input.interests],
    },
    destination: {
      groupId: d.groupId,
      memberRegionIds: [...d.memberRegionIds],
      representativeZoneId: d.representativeZoneId,
      displayName: d.displayName,
      name: d.name,
      province: d.province,
      oneWayMinutes: d.oneWayMinutes,
      attractions: d.attractions.map(cleanAttraction),
      preview: {
        blocks: d.preview.blocks.map(cleanBlock),
        metrics: cleanMetrics(d.preview.metrics),
      },
      reasons: [...d.reasons],
      metadata: {
        profileGeneratedAt: m.profileGeneratedAt,
        travelTimeGeneratedAt: m.travelTimeGeneratedAt,
        networkYear: m.networkYear,
        travelTimeSource: m.travelTimeSource,
        representativePoint: m.representativePoint,
        searchedAt: m.searchedAt,
      },
    },
    blocks: plan.blocks.map(cleanBlock),
    metrics: cleanMetrics(plan.metrics),
  };
}
export function readSavedPlans(): StoredResult {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { plans: [] };
    const value: unknown = JSON.parse(raw);
    if (
      !object(value) ||
      value.version !== 2 ||
      !Array.isArray(value.plans) ||
      value.plans.length > LIMIT
    )
      return {
        plans: [],
        error:
          "지원하지 않는 저장 형식이에요. 기존 저장 정보는 변경하지 않았어요.",
      };
    const plans = value.plans.filter(isSavedPlan);
    if (
      plans.length !== value.plans.length ||
      new Set(plans.map((p) => p.id)).size !== plans.length
    )
      return {
        plans: [],
        error:
          "저장된 계획의 날짜나 장소 정보가 손상되어 불러올 수 없어요. 기존 정보는 보존했어요.",
      };
    return { plans };
  } catch {
    return {
      plans: [],
      error:
        "이 기기 저장소를 읽을 수 없어요. 저장소 차단 또는 손상된 정보가 있는지 확인해 주세요.",
    };
  }
}
export function savePlan(plan: PlanSnapshot): {
  plan?: PlanSnapshot;
  error?: string;
} {
  const stored = readSavedPlans();
  if (stored.error) return { error: stored.error };
  if (
    stored.plans.length >= LIMIT &&
    !stored.plans.some((p) => p.id === plan.id)
  )
    return {
      error:
        "최대 10개까지 저장할 수 있어요. 저장 목록에서 필요 없는 계획을 삭제해 주세요.",
    };
  const saved = snapshot(plan);
  if (!isSavedPlan(saved))
    return {
      error: "계획의 날짜나 시간 블록을 확인할 수 없어 저장하지 않았어요.",
    };
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        plans: [saved, ...stored.plans.filter((p) => p.id !== saved.id)],
      }),
    );
    return { plan: { ...plan, savedAt: saved.savedAt } };
  } catch {
    return {
      error: "저장 공간이 부족하거나 저장소가 차단되어 저장하지 못했어요.",
    };
  }
}
export function deleteSavedPlan(planId: string): StoredResult {
  const stored = readSavedPlans();
  if (stored.error) return stored;
  const plans = stored.plans.filter((p) => p.id !== planId);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, plans }));
    return { plans };
  } catch {
    return {
      plans: stored.plans,
      error: "저장소가 차단되어 삭제하지 못했어요.",
    };
  }
}
