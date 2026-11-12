export type ActionKind =
  | "assumir"
  | "iniciar"
  | "concluir"
  | "devolver"
  | "material"
  | "equipamento"
  | "anexo";
export type QueueError = {
  status: number | null;
  code: string | null;
  message: string;
  reason: string;
};
/** Ação guardada na fila (store "outbox" do IndexedDB). `id` é o request_id enviado ao servidor. */
export type OutboxItem = {
  id: string;
  user_id: string;
  user_name?: string;
  order_id: string;
  order_code?: string;
  kind: ActionKind;
  body: Record<string, any>;
  file?: Blob | null;
  captured_at?: string | null;
  created_at: string;
  seq: number;
  base_version?: number;
  status: "pending" | "rejected";
  attempts: number;
  last_error?: string;
  last_attempt_at?: string;
  rejected_at?: string;
  error?: QueueError;
  drop_captured_at?: boolean;
};
export type QueueState = {
  item: OutboxItem;
  state: "pending" | "waiting" | "rejected";
};
export type RequestDescriptor = {
  path: string;
  method: string;
  json?: Record<string, any>;
  multipart?: Record<string, string>;
};
export type FlushResult = {
  sent: number;
  rejected: number;
  stop: null | "network" | "auth" | "retry";
  retryIn: number;
  touched: string[];
};
export const TRANSITIONS: Record<string, { from: string[]; to: string }>;
export const ACTION_KINDS: ActionKind[];
export const ACTIVE_STATUSES: string[];
export const MESSAGES: Record<string, string>;
export function actionLabel(item: OutboxItem | null | undefined): string;
export function sortQueue(items: OutboxItem[]): OutboxItem[];
export function nextSendable(items: OutboxItem[]): OutboxItem | null;
export function queueStates(items: OutboxItem[]): QueueState[];
export function queueSummary(items: OutboxItem[]): {
  total: number;
  pending: number;
  rejected: number;
  orders: string[];
};
export function classifyFailure(
  error: any,
): "network" | "auth" | "retry" | "rejected";
export function backoffDelay(attempts: number, random?: () => number): number;
export function rejectionText(error: any): string;
export function beforePhotoThreshold(order: any): number;
export function afterPhotoThreshold(order: any): number;
export function hasValidPhoto(order: any, stage: string): boolean;
export function requirementsFor(
  order: any,
  catalogs: any[],
): { before: boolean; after: boolean; material: boolean };
export function validateAction(
  order: any,
  kind: ActionKind,
  body?: Record<string, any>,
  catalogs?: any[],
): { code: string; message: string } | null;
export function projectOrder(order: any, items: OutboxItem[]): any;
export function projectList(orders: any[], items: OutboxItem[]): any[];
export function applyAccepted(
  order: any,
  item: OutboxItem,
  response: any,
  receivedAt: string,
): any;
export function buildRequest(item: OutboxItem): RequestDescriptor;
export function clockOffset(
  serverTime: string,
  requestStart: number,
  requestEnd: number,
): number;
export function capturedNow(offsetMs?: number, now?: number): string;
export function resequenceForRetry(
  items: OutboxItem[],
  id: string,
  nextSeq: () => number,
): OutboxItem[];
export function prepareRetry(
  item: OutboxItem,
  currentVersion?: number,
): OutboxItem;
export function flushQueue(deps: {
  list: () => Promise<OutboxItem[]>;
  save: (item: OutboxItem) => Promise<void>;
  remove: (id: string) => Promise<void>;
  send: (item: OutboxItem) => Promise<any>;
  accepted?: (item: OutboxItem, response: any) => Promise<void>;
  rejected?: (item: OutboxItem, error: any) => Promise<void>;
  now?: () => number;
}): Promise<FlushResult>;
