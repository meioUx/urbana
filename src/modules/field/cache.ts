// Leitura das tarefas do operador com cópia no aparelho: online grava o que veio do servidor,
// sem rede devolve a última cópia salva (com a hora em que foi salva).
import { clockOffset } from "./outbox-model.mjs";
import {
  clearCache,
  clearFieldSession,
  deleteCache,
  pruneOrderCache,
  readCache,
  saveFieldSession,
  writeCache,
} from "../../field-storage";

type Api = (path: string, method?: string, body?: any) => Promise<any>;
export type Loaded<T> = { data: T; savedAt: string | null; fromCache: boolean };
const ACTIVE = ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"];
/** Erro sem status HTTP: rede indisponível ou tempo esgotado. */
export const isNetworkError = (e: any) => !e?.status;

export async function loadTasks(
  api: Api,
  userId: string,
): Promise<Loaded<any> & { offset: number }> {
  const start = Date.now();
  const data = await api("/campo");
  const offset = clockOffset(data.server_time, start, Date.now());
  const savedAt = new Date().toISOString();
  await writeCache(userId, "list", data, savedAt).catch(() => {});
  await writeCache(userId, "meta", { offset }, savedAt).catch(() => {});
  return { data, savedAt: null, fromCache: false, offset };
}
export async function cachedTasks(
  userId: string,
): Promise<(Loaded<any> & { offset: number }) | null> {
  const [list, meta] = await Promise.all([
    readCache(userId, "list").catch(() => undefined),
    readCache(userId, "meta").catch(() => undefined),
  ]);
  return list
    ? {
        data: list.data,
        savedAt: list.saved_at,
        fromCache: true,
        offset: meta?.data?.offset || 0,
      }
    : null;
}

/** Guarda o detalhe das OS ativas que mudaram, para executar sem rede mesmo as que não foram abertas. */
export async function prefetchOrders(
  api: Api,
  userId: string,
  orders: any[],
  stillValid: () => boolean,
) {
  await pruneOrderCache(
    userId,
    orders.map((o) => o.id),
  ).catch(() => {});
  for (const o of orders.filter((x) => ACTIVE.includes(x.status))) {
    if (!stillValid()) return;
    const cached = await readCache(userId, `order|${o.id}`).catch(
      () => undefined,
    );
    if (
      cached &&
      cached.data?.updated_at === o.updated_at &&
      cached.data?.version === o.version
    )
      continue;
    try {
      const detail = await api(`/ordens-servico/${o.id}`);
      if (stillValid()) await writeCache(userId, `order|${o.id}`, detail);
    } catch (e: any) {
      if (isNetworkError(e) || e.status === 401) return;
    }
  }
}

export async function loadOrder(
  api: Api,
  userId: string,
  id: string,
  network: boolean,
): Promise<Loaded<any> | null> {
  if (network) {
    try {
      const data = await api(`/ordens-servico/${id}`);
      await writeCache(userId, `order|${id}`, data).catch(() => {});
      return { data, savedAt: null, fromCache: false };
    } catch (e: any) {
      if (e.status === 403 || e.status === 404) {
        await deleteCache(userId, `order|${id}`).catch(() => {});
        throw e;
      }
      if (!isNetworkError(e) && e.status !== 401 && e.status < 500) throw e;
    }
  }
  const cached = await readCache(userId, `order|${id}`).catch(() => undefined);
  return cached
    ? { data: cached.data, savedAt: cached.saved_at, fromCache: true }
    : null;
}

/**
 * Sessão de Campo usada pelo service worker para abrir sem rede. Só quem está com sessão válida
 * (bootstrap vindo do servidor) a grava; outro usuário que entra no aparelho apaga o cache anterior.
 */
export async function rememberSession(userId: string, boot: any) {
  await saveFieldSession(userId, boot);
  await clearCache(userId, false);
}
/** Logout: apaga a sessão offline e o cache de OS deste usuário. A fila e os rascunhos (por usuário) ficam. */
export async function forgetSession() {
  await clearFieldSession();
}
export async function forgetUserCache(userId: string) {
  await clearCache(userId, true);
}
