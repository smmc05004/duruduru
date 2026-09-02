import fixture from "../scripts/fixtures/e2-data-quality.json";
import type { SurveyDataset } from "./data-quality-survey";

/** 대표음식 이름은 PM 제안과 사용자 승인 전 fixture에도 넣지 않는다. */
export const e2SurveyFixtures = fixture as SurveyDataset[];
