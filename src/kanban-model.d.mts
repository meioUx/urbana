export const kanbanColumns: { status: string; title: string; hint: string }[];
export function buildKanbanCards(occurrences: any[], orders: any[]): any[];
export function teamColor(id: string): string;
export function closedStatus(status: string): boolean;
export function cardKey(card: any): string;
export type KanbanMove = {
  status: string;
  action: string;
  form: string;
  label: string;
};
export function availableMoves(
  card: any,
  can: (permission: string) => boolean,
): KanbanMove[];
export function sortKanbanCards(
  cards: any[],
  order?: Record<string, string[]>,
): any[];
export function flowMetrics(
  cards: any[],
  time?: number,
): {
  wip: number;
  throughput: number;
  oldest: number | null;
  cycle: number | null;
};
