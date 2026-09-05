export type SearchRequest = {
  originId: string;
  startAt: string;
  returnBy: string;
  transport: "car";
  interests: string[];
};

export type PlannerPlace = {
  id: string;
  name: string;
  category: "관광" | "점심" | "저녁";
  tags: string[];
  menu?: string;
};

export type ItineraryItem = PlannerPlace & {
  day: 1 | 2;
  startsAt: string;
  endsAt: string;
};

export type PlannerCandidate = {
  id: string;
  name: string;
  region: string;
  oneWayMinutes: number;
  localMinutes: number;
  matchedInterests: string[];
  attractions: PlannerPlace[];
  lunch: PlannerPlace;
  dinner: PlannerPlace;
  itinerary: ItineraryItem[];
  collectedAt: string;
};

export type SearchSuccess = {
  kind: "success";
  candidates: PlannerCandidate[];
  collectedAt: string;
  travelTimeSource: string;
};

export type SearchFailure = {
  kind: "no-results" | "data-error";
  message: string;
};

export type SearchResponse = SearchSuccess | SearchFailure;
