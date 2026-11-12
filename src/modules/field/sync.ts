// Motor de sincronização do Campo: guarda ações na fila (IndexedDB), envia em ordem por OS ao
// reconectar, aplica espera crescente em falhas de rede, pausa em sessão expirada (401) e marca
// como rejeitadas as ações recusadas pelo servidor, atualizando o cache com o estado real.
// A lógica de decisão está em outbox-model.mjs (testada no Node); aqui ficam transporte e eventos.
import {
  applyAccepted,
  buildRequest,
  flushQueue,
  prepareRetry,
  queueSummary,
  resequenceForRetry,
  sortQueue,
  type ActionKind,
  type OutboxItem,
} from "./outbox-model.mjs";
import {
  deleteCache,
  deleteOutbox,
  listOutbox,
  putOutbox,
  readCache,
  updateCache,
  writeCache,
} from "../../field-storage";

export type SyncState = {
  items: OutboxItem[];
  ready: boolean;
  syncing: boolean;
  paused: null | "auth";
  retryAt: number | null;
  lastSyncAt: string | null;
  storageError: string;
  /** Muda sempre que o cache local de OS é alterado pela sincronização. */
  cacheRevision: number;
  /** Último resultado relevante, para anúncio em aria-live. */
  announcement: string;
};

const SYNC_TAG = "urbana-field-outbox";
const JSON_TIMEOUT = 20000,
  UPLOAD_TIMEOUT = 120000;
let lastSeq = 0;
const nextSeq = () => (lastSeq = Math.max(Date.now(), lastSeq + 1));
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

type HttpError = Error & { status?: number; code?: string; details?: any };
const httpError = (
  message: string,
  status = 0,
  code?: string,
  details?: any,
): HttpError => Object.assign(new Error(message), { status, code, details });

/** Requisição da fila com prazo próprio (fotos grandes em sinal fraco precisam de mais tempo). */
async function request(
  path: string,
  init: RequestInit & { timeout?: number } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    init.timeout || JSON_TIMEOUT,
  );
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      signal: controller.signal,
      credentials: "same-origin",
    });
  } catch {
    throw httpError("Sem conexão com o servidor.");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw httpError(
      data?.error || `Erro ${res.status}`,
      res.status,
      data?.code,
      data?.details,
    );
  return data;
}

async function send(item: OutboxItem) {
  const req = buildRequest(item);
  if (req.multipart) {
    if (!item.file)
      throw httpError(
        "A foto não está mais neste aparelho.",
        400,
        "LOCAL_FILE_MISSING",
      );
    const form = new FormData();
    form.append(
      "file",
      item.file,
      (item.file as File).name || `foto-${item.body.stage}.jpg`,
    );
    for (const [key, value] of Object.entries(req.multipart))
      form.append(key, value);
    return request(req.path, {
      method: req.method,
      body: form,
      timeout: UPLOAD_TIMEOUT,
    });
  }
  return request(req.path, {
    method: req.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.json),
  });
}

const listFields = [
  "status",
  "version",
  "updated_at",
  "assumed_by",
  "assumed_by_name",
  "started_at",
  "finished_at",
  "returned_at",
];

export class FieldSync {
  readonly userId: string;
  readonly userName: string;
  private state: SyncState = {
    items: [],
    ready: false,
    syncing: false,
    paused: null,
    retryAt: null,
    lastSyncAt: null,
    storageError: "",
    cacheRevision: 0,
    announcement: "",
  };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private again = false;
  private disposed = false;
  private synced = new Set<(touched: string[]) => void>();

  constructor(user: { id: string; name: string }) {
    this.userId = user.id;
    this.userName = user.name;
  }
  getState = () => this.state;
  /** Avisa depois de cada sincronização com envios ou rejeições (a tela relê a lista do servidor). */
  whenSynced = (listener: (touched: string[]) => void) => {
    this.synced.add(listener);
    return () => {
      this.synced.delete(listener);
    };
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  async load() {
    try {
      const items = sortQueue(await listOutbox(this.userId));
      this.set({ items, ready: true, storageError: "" });
    } catch {
      this.set({
        ready: true,
        storageError:
          "Armazenamento local indisponível neste navegador. Mantenha a conexão para registrar as ações.",
      });
    }
  }
  start() {
    this.disposed = false;
  }
  stop() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  pendingFor(orderId: string) {
    return this.state.items.filter((i) => i.order_id === orderId);
  }

  /** Coloca uma ação na fila com request_id estável e captured_at do momento real. */
  async enqueue(input: {
    id?: string;
    kind: ActionKind;
    order: { id: string; code?: string; version?: number };
    body: Record<string, any>;
    file?: Blob | null;
    captured_at: string | null;
  }) {
    const item: OutboxItem = {
      id: input.id || crypto.randomUUID(),
      user_id: this.userId,
      user_name: this.userName,
      order_id: input.order.id,
      order_code: input.order.code,
      kind: input.kind,
      body: input.body,
      file: input.file || null,
      captured_at: input.captured_at,
      created_at: new Date().toISOString(),
      seq: nextSeq(),
      base_version: input.order.version,
      status: "pending",
      attempts: 0,
    };
    await putOutbox(item);
    this.set({
      items: sortQueue([
        ...this.state.items.filter((i) => i.id !== item.id),
        item,
      ]),
    });
    this.registerBackgroundSync();
    if (navigator.onLine) void this.flush();
    return item;
  }

  /** Reenvio decidido pelo operador: transições passam a valer sobre a versão atual do cache. */
  async retry(id: string) {
    const item = this.state.items.find((i) => i.id === id);
    if (!item) return;
    const cached = await readCache(this.userId, `order|${item.order_id}`).catch(
      () => undefined,
    );
    const moved = resequenceForRetry(this.state.items, id, nextSeq).map((i) =>
      i.id === id ? prepareRetry(i, cached?.data?.version) : i,
    );
    for (const changed of moved) await putOutbox(changed);
    const byId = new Map(moved.map((i) => [i.id, i]));
    this.set({
      items: sortQueue(this.state.items.map((i) => byId.get(i.id) || i)),
      paused: null,
    });
    void this.flush(true);
  }
  async discard(id: string) {
    await deleteOutbox(id);
    this.set({ items: this.state.items.filter((i) => i.id !== id) });
    void this.flush(true);
  }
  /** Retoma após login ou quando o operador pede. */
  resume() {
    this.set({ paused: null });
    void this.flush(true);
  }

  private registerBackgroundSync() {
    // Complemento (Chrome/Android): acorda o app aberto em segundo plano quando a rede volta.
    // Não é o mecanismo principal: o iOS não implementa Background Sync.
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((registration: any) => registration.sync?.register(SYNC_TAG))
      .catch(() => {});
  }

  private schedule(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
    this.set({ retryAt: Date.now() + delay });
  }

  /**
   * Envia a fila. `force` ignora a espera da última falha (reconexão, retorno ao app, ação do
   * operador). Outra aba com a fila em envio (Web Locks) faz esta chamada apenas sair.
   */
  async flush(force = false): Promise<void> {
    if (this.disposed || !this.state.ready) return;
    if (this.state.syncing) {
      this.again = true;
      return;
    }
    if (this.state.paused === "auth" && !force) return;
    if (!force && this.state.retryAt && this.state.retryAt > Date.now()) return;
    if (!navigator.onLine) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const locks = (navigator as any).locks;
    const job = () => this.runFlush();
    if (locks?.request)
      await locks.request(
        `urbana-field-sync:${this.userId}`,
        { ifAvailable: true },
        (lock: any) => (lock ? job() : null),
      );
    else await job();
    if (this.again && !this.disposed) {
      this.again = false;
      if (
        this.state.items.some((i) => i.status === "pending") &&
        !this.state.paused
      )
        await this.flush();
    }
  }

  private async runFlush() {
    let items: OutboxItem[];
    try {
      items = await listOutbox(this.userId);
    } catch {
      return;
    }
    if (!items.some((i) => i.status === "pending")) {
      this.set({ items: sortQueue(items), retryAt: null });
      return;
    }
    const before = queueSummary(items);
    this.set({
      syncing: true,
      paused: null,
      retryAt: null,
      items: sortQueue(items),
      announcement: `Enviando ${plural(before.pending, "ação guardada", "ações guardadas")}…`,
    });
    const receivedAt = () => new Date().toISOString();
    const result = await flushQueue({
      list: () => listOutbox(this.userId),
      save: async (item) => {
        await putOutbox(item);
        this.set({
          items: sortQueue(
            this.state.items.map((i) => (i.id === item.id ? item : i)),
          ),
        });
      },
      remove: async (id) => {
        await deleteOutbox(id);
        this.set({ items: this.state.items.filter((i) => i.id !== id) });
      },
      send,
      accepted: async (item, response) => {
        await updateCache(this.userId, `order|${item.order_id}`, (order) =>
          applyAccepted(order, item, response, receivedAt()),
        ).catch(() => {});
        if (response?.version !== undefined)
          await updateCache(this.userId, "list", (data) => ({
            ...data,
            orders: (data.orders || []).map((o: any) =>
              o.id === item.order_id
                ? {
                    ...o,
                    ...Object.fromEntries(
                      listFields
                        .filter((f) => f in response)
                        .map((f) => [f, response[f]]),
                    ),
                  }
                : o,
            ),
          })).catch(() => {});
        this.bumpCache();
      },
      rejected: async (item) => {
        await this.refreshOrder(item.order_id);
      },
    }).catch(() => ({
      sent: 0,
      rejected: 0,
      stop: "retry" as const,
      retryIn: 5000,
      touched: [] as string[],
    }));
    for (const orderId of result.touched) await this.refreshOrder(orderId);
    const after = sortQueue(
      await listOutbox(this.userId).catch(() => this.state.items),
    );
    const summary = queueSummary(after);
    let announcement = "";
    // Sessão expirada é anunciada pelo alerta próprio (SyncBanner).
    if (result.stop === "auth") announcement = "";
    else if (result.stop)
      announcement = `Sem resposta do servidor. ${plural(summary.pending, "ação guardada", "ações guardadas")}; nova tentativa automática em instantes.`;
    // Rejeições são anunciadas pelo alerta do painel (role="alert"); aqui só o que foi enviado.
    else if (result.sent && !summary.pending)
      announcement = "Todas as ações guardadas foram enviadas.";
    else if (result.sent)
      announcement = `${plural(result.sent, "ação enviada", "ações enviadas")}.`;
    this.set({
      items: after,
      syncing: false,
      paused: result.stop === "auth" ? "auth" : null,
      lastSyncAt: result.sent
        ? new Date().toISOString()
        : this.state.lastSyncAt,
      announcement,
    });
    if (result.stop === "network" || result.stop === "retry")
      this.schedule(result.retryIn);
    if (result.sent || result.rejected)
      for (const listener of this.synced) listener(result.touched);
  }

  private bumpCache() {
    this.set({ cacheRevision: this.state.cacheRevision + 1 });
  }

  /** Relê a OS no servidor e grava no cache (estado real após envio ou rejeição). */
  async refreshOrder(orderId: string) {
    try {
      const order = await request(`/ordens-servico/${orderId}`);
      await writeCache(this.userId, `order|${orderId}`, order);
      await updateCache(this.userId, "list", (data) => ({
        ...data,
        orders: (data.orders || []).map((o: any) =>
          o.id === orderId
            ? {
                ...o,
                ...Object.fromEntries(listFields.map((f) => [f, order[f]])),
              }
            : o,
        ),
      }));
    } catch (e: any) {
      if (e?.status === 403 || e?.status === 404) {
        // OS reatribuída ou removida: some do aparelho; a ação rejeitada continua visível na fila.
        await deleteCache(this.userId, `order|${orderId}`).catch(() => {});
        await updateCache(this.userId, "list", (data) => ({
          ...data,
          orders: (data.orders || []).filter((o: any) => o.id !== orderId),
        })).catch(() => {});
      } else return;
    }
    this.bumpCache();
  }
}
