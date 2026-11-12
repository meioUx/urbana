// Armazenamento local do Campo (IndexedDB "urbana-field"). Tudo é separado por usuário.
//
// Versão 1 (já em uso nos aparelhos): store "drafts" (rascunhos de registro, fotos e relato).
// Versão 2 (aditiva; a migração só cria stores que faltam e nunca toca em "drafts"):
//   - "session": chave "current" → { user_id, boot, saved_at }. Bootstrap da última sessão de Campo,
//     lido pelo app (modules/workspace/useWorkspaceData.ts) para abrir /campo sem rede. Apagado no
//     logout (do Campo ou da gestão) e quando o servidor responde 401 na inicialização.
//   - "cache": { key, user_id, data, saved_at } com índice user_id. Lista "Minhas tarefas" (`<user>|list`),
//     detalhe de cada OS (`<user>|order|<id>`) e metadados (`<user>|meta`). Apagado no logout.
//   - "outbox": ações à espera de envio (ver OutboxItem em modules/field/outbox-model.d.mts),
//     chave = request_id, índice user_id. Nunca apagado em silêncio.
import type { OutboxItem } from "./modules/field/outbox-model.mjs";

export const FIELD_DB = "urbana-field";
export const FIELD_DB_VERSION = 2;
export const SESSION_STORE = "session";
export const SESSION_KEY = "current";
const DRAFTS = "drafts",
  CACHE = "cache",
  OUTBOX = "outbox";

let connection: Promise<IDBDatabase> | null = null;

/** Migração aditiva: cria somente o que não existe; os rascunhos da versão 1 permanecem. */
export function upgradeFieldDb(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS);
  if (!db.objectStoreNames.contains(SESSION_STORE))
    db.createObjectStore(SESSION_STORE);
  if (!db.objectStoreNames.contains(CACHE))
    db.createObjectStore(CACHE, { keyPath: "key" }).createIndex(
      "user_id",
      "user_id",
    );
  if (!db.objectStoreNames.contains(OUTBOX))
    db.createObjectStore(OUTBOX, { keyPath: "id" }).createIndex(
      "user_id",
      "user_id",
    );
}

function open(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined")
      return reject(new Error("IndexedDB indisponível."));
    const request = indexedDB.open(FIELD_DB, FIELD_DB_VERSION);
    request.onupgradeneeded = () => upgradeFieldDb(request.result);
    request.onsuccess = () => {
      const db = request.result;
      // Outra aba com versão mais nova do app: libera a conexão para a migração seguir.
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      db.onclose = () => {
        connection = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Armazenamento local ocupado por outra aba do app."));
  });
  connection.catch(() => {
    connection = null;
  });
  return connection;
}

async function run<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest | void,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = work(tx);
    tx.oncomplete = () => resolve((request ? request.result : undefined) as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Operação local cancelada."));
  });
}

/** Rascunhos (API inalterada desde a versão 1). */
export function fieldDraft(
  key: string,
  value?: any,
  remove = false,
): Promise<any> {
  return run(
    DRAFTS,
    value !== undefined || remove ? "readwrite" : "readonly",
    (tx) => {
      const store = tx.objectStore(DRAFTS);
      return remove
        ? store.delete(key)
        : value !== undefined
          ? store.put(value, key)
          : store.get(key);
    },
  );
}

/* Sessão usada para abrir o Campo sem rede. */
export function saveFieldSession(userId: string, boot: any) {
  const {
    offline: _offline,
    offline_saved_at: _savedAt,
    session_expired: _expired,
    ...data
  } = boot || {};
  return run(SESSION_STORE, "readwrite", (tx) =>
    tx
      .objectStore(SESSION_STORE)
      .put(
        { user_id: userId, boot: data, saved_at: new Date().toISOString() },
        SESSION_KEY,
      ),
  );
}
export function readFieldSession(): Promise<
  { user_id: string; boot: any; saved_at: string } | undefined
> {
  return run(SESSION_STORE, "readonly", (tx) =>
    tx.objectStore(SESSION_STORE).get(SESSION_KEY),
  );
}
export function clearFieldSession() {
  return run(SESSION_STORE, "readwrite", (tx) =>
    tx.objectStore(SESSION_STORE).delete(SESSION_KEY),
  );
}

/* Cache por usuário. */
const cacheKey = (userId: string, key: string) => `${userId}|${key}`;
export type CacheEntry<T = any> = {
  key: string;
  user_id: string;
  data: T;
  saved_at: string;
};
export function readCache<T = any>(
  userId: string,
  key: string,
): Promise<CacheEntry<T> | undefined> {
  return run(CACHE, "readonly", (tx) =>
    tx.objectStore(CACHE).get(cacheKey(userId, key)),
  );
}
export function writeCache(
  userId: string,
  key: string,
  data: any,
  savedAt = new Date().toISOString(),
) {
  return run(CACHE, "readwrite", (tx) =>
    tx.objectStore(CACHE).put({
      key: cacheKey(userId, key),
      user_id: userId,
      data,
      saved_at: savedAt,
    }),
  );
}
export function deleteCache(userId: string, key: string) {
  return run(CACHE, "readwrite", (tx) =>
    tx.objectStore(CACHE).delete(cacheKey(userId, key)),
  );
}
/** Altera uma entrada do cache numa única transação (sem perder escritas concorrentes). */
export function updateCache(
  userId: string,
  key: string,
  change: (data: any) => any,
) {
  return run(CACHE, "readwrite", (tx) => {
    const store = tx.objectStore(CACHE);
    const request = store.get(cacheKey(userId, key));
    request.onsuccess = () => {
      const entry = request.result as CacheEntry | undefined;
      if (!entry) return;
      const data = change(entry.data);
      if (data !== entry.data) store.put({ ...entry, data });
    };
  });
}
/** Apaga o cache de um usuário (only = true) ou de todos os outros usuários (only = false). */
export function clearCache(userId: string, only = true) {
  return run(CACHE, "readwrite", (tx) => {
    const store = tx.objectStore(CACHE);
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      if ((c.value.user_id === userId) === only) c.delete();
      c.continue();
    };
  });
}

/** Remove do cache do usuário os detalhes de OS que não estão mais na lista. */
export function pruneOrderCache(userId: string, keepIds: string[]) {
  const keep = new Set(keepIds.map((id) => cacheKey(userId, `order|${id}`)));
  const prefix = cacheKey(userId, "order|");
  return run(CACHE, "readwrite", (tx) => {
    const cursor = tx.objectStore(CACHE).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      if (String(c.key).startsWith(prefix) && !keep.has(String(c.key)))
        c.delete();
      c.continue();
    };
  });
}

/* Fila de ações (outbox). */
export function listOutbox(userId: string): Promise<OutboxItem[]> {
  return run(OUTBOX, "readonly", (tx) =>
    tx.objectStore(OUTBOX).index("user_id").getAll(userId),
  );
}
export function putOutbox(item: OutboxItem) {
  return run(OUTBOX, "readwrite", (tx) => tx.objectStore(OUTBOX).put(item));
}
export function deleteOutbox(id: string) {
  return run(OUTBOX, "readwrite", (tx) => tx.objectStore(OUTBOX).delete(id));
}
