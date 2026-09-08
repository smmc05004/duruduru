import axios from "axios";
import { create } from "zustand";
import type { Restaurant } from "./mvp-phase-two-types";

export const tripApi = axios.create({ baseURL: "/api", timeout: 65_000 });
export function apiMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message: unknown = error.response?.data?.message;
    if (typeof message === "string") return message;
  }
  return "정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}
export type RestaurantResponse = {
  kind: "success" | "partial" | "data-error";
  restaurants: Restaurant[];
  queriedRegionIds: string[];
  failedRegionIds: string[];
  truncated: boolean;
  fetchedAt: string;
  message: string;
};
type TripUi = {
  savedOpen: boolean;
  setSavedOpen: (open: boolean) => void;
};
// Server data lives in Query; only this panel's visibility is global UI state.
export const useTripUi = create<TripUi>((set) => ({
  savedOpen: false,
  setSavedOpen: (savedOpen) => set({ savedOpen }),
}));
