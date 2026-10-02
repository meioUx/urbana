export { ONBOARDING_VERSION } from "./onboarding-version.mjs";
export type GuideStep = {
  id: string;
  module: string;
  page: string;
  path: string;
  title: string;
  description: string;
  target: string;
  fallback?: string;
  stage: string;
  includesStages?: string[];
  action?: string;
  adminTab?: string;
  filter?: string;
  detail?: string;
  detailTab?: string;
  guideMode?: string;
  states?: string[];
  map?: boolean;
  transition?: string[];
  checklist?: string;
};
export type Journey = {
  role: string;
  title: string;
  description: string;
  workflow: string[];
  participation: number[];
  handoff: string;
  cta: string;
  steps: GuideStep[];
};
export const operationFlow: string[];
export const roleJourneys: Record<string, Omit<Journey, "role" | "steps">>;
export function getJourney(user: any): Journey | null;
export function getTutorials(
  user: any,
): { id: string; title: string; steps: GuideStep[] }[];
export function getTutorial(user: any, id: string): Journey | null;
export function canOfferOnboarding(user: any, state: any): boolean;
