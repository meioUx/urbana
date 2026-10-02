export function buildWorkCandidates(
  groups: any[],
  catalogs: any[],
  orders?: any[],
  time?: number,
): any[];
export function sortWorkCandidates(candidates: any[], mode?: string): any[];
export function filterWorkCandidates(
  candidates: any[],
  filters?: {
    query?: string;
    sector?: string;
    neighborhood?: string;
    readiness?: string;
    sort?: string;
  },
): any[];
export function occurrenceDeadline(
  row: any,
  catalogs: any[],
  groupPriority?: string,
): string | null;
export function planningPriority(rows: any[]): string;
export function activePlan(plan: any): boolean;
export function unscheduledPlanMembers(plan: any): any[];
