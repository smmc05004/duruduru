import type {
  Attraction,
  Candidate,
  CandidateRecommendation,
  PlanMetrics,
  PlanSnapshot,
  Restaurant,
  TimeBlock,
} from "./mvp-phase-two-types";
import { INTERESTS } from "./mvp-phase-two-types";
import { planTimeError } from "./plan-time-constraints";
import {
  localRestIntervals,
  tripMealWindows,
  parseLocalDate,
  validateSearchInput,
} from "./mvp-phase-two-planner";

const STORAGE_KEY_V2 = "duruduru.plans.v2";
const STORAGE_KEY_V3 = "duruduru.plans.v3";
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
const categories = (v: unknown): v is Array<(typeof INTERESTS)[number]["id"]> =>
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
function recommendation(v: unknown): v is CandidateRecommendation {
  if (!object(v)) return false;
  const pairCount = v.distancePairCount;
  const validPairCount = v.validDistancePairCount;
  const requestedInterests = v.requestedInterests;
  const missingInterests = v.missingInterests;
  return (
    ["easy", "interest", "relaxed"].includes(String(v.role)) &&
    v.algorithmVersion === "e1-v1" &&
    [
      v.roundTripMinutes,
      v.fulfilledInterestCount,
      v.attractionCount,
      v.categoryDiversity,
      v.localFreeMinutes,
    ].every(finite) &&
    finite(pairCount) &&
    finite(validPairCount) &&
    validPairCount <= pairCount &&
    (v.averageDistanceKm === null || finite(v.averageDistanceKm)) &&
    typeof v.proximityComparable === "boolean" &&
    categories(requestedInterests) &&
    categories(missingInterests) &&
    missingInterests.every((interest) => requestedInterests.includes(interest))
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
      !["travel", "attraction", "personal", "meal", "free", "rest"].includes(
        b.kind,
      ) ||
      !text(b.title) ||
      !text(b.reason) ||
      !finite(b.durationMinutes)
    )
      return false;
    if (
      (b.facilityGroupId !== undefined && !id(b.facilityGroupId)) ||
      (b.sessionId !== undefined &&
        (!text(b.sessionId) ||
          !/^day-[12]-(morning|afternoon)$/.test(b.sessionId)))
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
    const localMidnight =
      Math.floor((start + 540 * 60_000) / 86_400_000) * 86_400_000 -
      540 * 60_000;
    const activityStart =
      localMidnight + (b.day - 1) * 86_400_000 + 420 * 60_000;
    const activityEnd =
      localMidnight + (b.day - 1) * 86_400_000 + 1260 * 60_000;
    if (
      b.fixedStartAt !== undefined &&
      (parseLocalDate(b.fixedStartAt) === null || b.fixedStartAt !== b.startAt)
    )
      return false;
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
    if (b.kind === "personal") {
      if (
        !object(b.personal) ||
        !id(b.personal.id) ||
        !text(b.personal.name) ||
        b.personal.name.trim().length < 1 ||
        !["appointment", "place"].includes(String(b.personal.category)) ||
        (b.personal.day !== 1 && b.personal.day !== 2) ||
        ![30, 60, 90, 120].includes(Number(b.personal.durationMinutes)) ||
        !text(b.personal.address) ||
        b.personal.address.length > 200 ||
        b.personal.id !== b.id ||
        b.personal.day !== b.day ||
        b.personal.durationMinutes !== b.durationMinutes
      )
        return false;
    } else if (b.personal !== undefined) return false;
    if (b.kind === "attraction" || b.kind === "personal") {
      if (from < activityStart || to > activityEnd) return false;
    } else if (b.fixedStartAt !== undefined) return false;
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
      b.localTravel === undefined &&
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
    (v.recommendation !== undefined && !recommendation(v.recommendation)) ||
    (v.itineraryAlgorithmVersion !== undefined &&
      v.itineraryAlgorithmVersion !== "e2-v1") ||
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
      value.schemaVersion !== 3 ||
      !id(value.id) ||
      !id(value.searchId) ||
      !validDate(value.createdAt) ||
      !validDate(value.updatedAt) ||
      !validDate(value.savedAt) ||
      typeof value.edited !== "boolean" ||
      !["e4-v1", "e4-v2"].includes(String(value.itineraryRuleVersion)) ||
      !candidate(value.destination) ||
      !metrics(value.metrics) ||
      (value.accommodation !== undefined &&
        (!object(value.accommodation) ||
          !text(value.accommodation.name) ||
          value.accommodation.name.trim().length < 1 ||
          value.accommodation.name.length > 80 ||
          !text(value.accommodation.address) ||
          value.accommodation.address.length > 200 ||
          !text(value.accommodation.note) ||
          value.accommodation.note.length > 500))
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
      !planTimeError(
        value as unknown as PlanSnapshot,
        value.itineraryRuleVersion === "e4-v2",
      ) &&
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
    fixedStartAt: b.fixedStartAt,
    personal: b.personal
      ? {
          id: b.personal.id,
          name: b.personal.name,
          category: b.personal.category,
          day: b.personal.day,
          durationMinutes: b.personal.durationMinutes,
          address: b.personal.address,
        }
      : undefined,
    mealScope: b.mealScope,
    mealType: b.mealType,
    direction: b.direction,
    localTravel: b.localTravel ? { ...b.localTravel } : undefined,
    facilityGroupId: b.facilityGroupId,
    sessionId: b.sessionId,
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
function cleanRecommendation(
  recommendation: CandidateRecommendation | undefined,
): CandidateRecommendation | undefined {
  return recommendation
    ? {
        role: recommendation.role,
        algorithmVersion: recommendation.algorithmVersion,
        roundTripMinutes: recommendation.roundTripMinutes,
        fulfilledInterestCount: recommendation.fulfilledInterestCount,
        attractionCount: recommendation.attractionCount,
        categoryDiversity: recommendation.categoryDiversity,
        localFreeMinutes: recommendation.localFreeMinutes,
        distancePairCount: recommendation.distancePairCount,
        validDistancePairCount: recommendation.validDistancePairCount,
        averageDistanceKm: recommendation.averageDistanceKm,
        proximityComparable: recommendation.proximityComparable,
        requestedInterests: [...recommendation.requestedInterests],
        missingInterests: [...recommendation.missingInterests],
      }
    : undefined;
}
function snapshot(plan: PlanSnapshot): PlanSnapshot {
  const d = plan.destination,
    m = d.metadata;
  return {
    schemaVersion: 3,
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
      recommendation: cleanRecommendation(d.recommendation),
      itineraryAlgorithmVersion: d.itineraryAlgorithmVersion,
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
    itineraryRuleVersion: plan.itineraryRuleVersion,
    localTravelVersion: plan.localTravelVersion,
    accommodation: plan.accommodation
      ? {
          name: plan.accommodation.name,
          address: plan.accommodation.address,
          note: plan.accommodation.note,
        }
      : undefined,
  };
}
function storageError(
  message = "저장된 계획의 날짜나 장소 정보가 손상되어 불러올 수 없어요. 기존 정보는 보존했어요.",
): StoredResult {
  return { plans: [], error: message };
}
function migratedV2(value: unknown): PlanSnapshot | null {
  if (!object(value) || value.schemaVersion !== 2) return null;
  const withoutUnexpectedTimeLock = (block: unknown) => {
    if (!object(block)) return block;
    const legacy = { ...block };
    delete legacy.fixedStartAt;
    return legacy;
  };
  const destination = object(value.destination)
    ? {
        ...value.destination,
        preview: object(value.destination.preview)
          ? {
              ...value.destination.preview,
              blocks: Array.isArray(value.destination.preview.blocks)
                ? value.destination.preview.blocks.map(
                    withoutUnexpectedTimeLock,
                  )
                : value.destination.preview.blocks,
            }
          : value.destination.preview,
      }
    : value.destination;
  const next = {
    ...value,
    schemaVersion: 3,
    itineraryRuleVersion: "e4-v1",
    destination,
    blocks: Array.isArray(value.blocks)
      ? value.blocks.map(withoutUnexpectedTimeLock)
      : value.blocks,
  } as unknown;
  return isSavedPlan(next) ? next : null;
}
function parseContainer(raw: string, version: 2 | 3): StoredResult {
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    value.version !== version ||
    !Array.isArray(value.plans) ||
    value.plans.length > LIMIT
  )
    return storageError(
      "지원하지 않는 저장 형식이에요. 기존 저장 정보는 변경하지 않았어요.",
    );
  const plans =
    version === 3
      ? value.plans.filter(isSavedPlan)
      : value.plans
          .map(migratedV2)
          .filter((plan): plan is PlanSnapshot => !!plan);
  if (
    plans.length !== value.plans.length ||
    new Set(plans.map((plan) => plan.id)).size !== plans.length
  )
    return storageError();
  return { plans };
}
/** v3 always wins, even when it is empty: deleted v2 plans must not reappear. */
export function readSavedPlans(): StoredResult {
  try {
    const v3 = localStorage.getItem(STORAGE_KEY_V3);
    if (v3 !== null) return parseContainer(v3, 3);
    const v2 = localStorage.getItem(STORAGE_KEY_V2);
    if (v2 === null) return { plans: [] };
    return parseContainer(v2, 2);
  } catch {
    return {
      plans: [],
      error:
        "이 기기 저장소를 읽을 수 없어요. 저장소 차단 또는 손상된 정보가 있는지 확인해 주세요.",
    };
  }
}
function writeV3(plans: PlanSnapshot[]): StoredResult {
  let previous: string | null = null;
  let writeAttempted = false;
  try {
    const container = {
      version: 3,
      migratedFromV2: localStorage.getItem(STORAGE_KEY_V2) !== null,
      plans,
    };
    previous = localStorage.getItem(STORAGE_KEY_V3);
    const expected = JSON.stringify(container);
    writeAttempted = true;
    localStorage.setItem(STORAGE_KEY_V3, expected);
    const confirmation = localStorage.getItem(STORAGE_KEY_V3);
    if (confirmation !== expected)
      throw new Error("storage confirmation mismatch");
    const checked = parseContainer(confirmation, 3);
    if (checked.error || checked.plans.length !== plans.length)
      throw new Error("storage validation failed");
    return checked;
  } catch {
    if (!writeAttempted)
      return storageError(
        "저장소가 차단되어 변경하지 못했어요. 기존 저장 정보는 유지돼요.",
      );
    try {
      if (previous === null) localStorage.removeItem(STORAGE_KEY_V3);
      else localStorage.setItem(STORAGE_KEY_V3, previous);
      if (localStorage.getItem(STORAGE_KEY_V3) !== previous)
        throw new Error("rollback failed");
    } catch {
      return storageError(
        "저장과 이전 정보 복구를 확인하지 못했어요. 현재 계획을 유지한 채 저장소 설정을 확인해 주세요.",
      );
    }
    return storageError(
      "저장 내용을 확인하지 못했어요. 기존 저장 정보는 보존했어요.",
    );
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
    const result = writeV3([
      saved,
      ...stored.plans.filter((p) => p.id !== saved.id),
    ]);
    return result.error
      ? { error: result.error }
      : { plan: { ...plan, savedAt: saved.savedAt } };
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
  const result = writeV3(plans);
  return result.error ? { plans: stored.plans, error: result.error } : result;
}
