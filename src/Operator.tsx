import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Camera,
  CheckCircle2,
  ClipboardList,
  LocateFixed,
  LogOut,
  MapPin,
  Navigation,
  Plus,
  RefreshCw,
  Send,
  TriangleAlert,
} from "lucide-react";
import { fieldDraft } from "./field-storage";
import {
  capturedNow,
  hasValidPhoto,
  projectList,
  projectOrder,
  validateAction,
  type ActionKind,
} from "./modules/field/outbox-model.mjs";
import { useFieldSync } from "./modules/field/useFieldSync";
import type { FieldSync, SyncState } from "./modules/field/sync";
import {
  cachedTasks,
  forgetSession,
  forgetUserCache,
  isNetworkError,
  loadOrder,
  loadTasks,
  prefetchOrders,
  rememberSession,
} from "./modules/field/cache";
import {
  CachedNotice,
  LocalPhoto,
  OutboxPanel,
  SyncBanner,
} from "./modules/field/SyncStatus";
import "./operator.css";
type Props = {
  boot: any;
  api: (path: string, method?: string, body?: any) => Promise<any>;
  onLogout: () => Promise<void>;
  onManagement: () => void;
};
const status: Record<string, string> = {
  PROGRAMADA: "A fazer",
  EM_DESLOCAMENTO: "A caminho",
  EM_EXECUCAO: "Em execução",
  AGUARDANDO_VALIDACAO: "Em análise",
  CONCLUIDA: "Aprovada",
  CANCELADA: "Cancelada",
  RECUSADA: "Recusada",
  DEVOLVIDA: "Devolvida à gestão",
  IDENTIFICADA: "Recebida",
  EM_TRIAGEM: "Em triagem",
};
const active = ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"];
const date = (v: string) =>
  v
    ? new Date(v).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
function Field({ label, children }: any) {
  const id = React.useId();
  return (
    <label className="operator-field">
      <span id={id}>{label}</span>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<any>, {
            "aria-labelledby": id,
          })
        : children}
    </label>
  );
}
function PhotoPreview({ file }: { file: File | null }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? (
    <img
      className="operator-photo"
      src={url}
      alt="Foto selecionada para envio"
    />
  ) : null;
}
async function location(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(
        new Error("GPS indisponível. Informe as coordenadas manualmente."),
      );
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () =>
        reject(
          new Error(
            "Não foi possível obter a localização. Permita o GPS ou informe as coordenadas.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
function checkedPhoto(file?: File) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Escolha uma foto JPG, PNG ou WebP.");
  if (file.size > 15 * 1024 * 1024)
    throw new Error("A foto deve ter até 15 MB.");
  return file;
}
/** Contexto offline compartilhado com a tela da OS: fila, relógio do servidor e situação da sessão. */
type Offline = {
  sync: FieldSync;
  syncState: SyncState;
  offset: () => number;
  /** true quando a ação deve ir para a fila em vez de ser enviada diretamente. */
  mustQueue: (orderId: string) => boolean;
  /** Um envio direto recebeu 401: a ação vai para a fila e a tela pede novo login. */
  expire: () => void;
};
export default function Operator({ boot, api, onLogout, onManagement }: Props) {
  const [tab, setTab] = useState("tasks"),
    [list, setList] = useState<any>({ orders: [], records: [], push: {} }),
    [orderId, setOrderId] = useState<string | null>(
      new URLSearchParams(window.location.search).get("ordem"),
    ),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [online, setOnline] = useState(navigator.onLine),
    [filter, setFilter] = useState("active"),
    [notificationBusy, setNotificationBusy] = useState(false),
    [savedAt, setSavedAt] = useState<string | null>(null),
    [sessionExpired, setSessionExpired] = useState(false),
    [confirmLogout, setConfirmLogout] = useState(false);
  const { sync, state: syncState } = useFieldSync(boot.user);
  // Título da aba por tela (WCAG 2.4.2).
  const openCode = list.orders.find((o: any) => o.id === orderId)?.code;
  useEffect(() => {
    document.title = `${orderId ? (openCode ? `Ordem ${openCode}` : "Ordem de serviço") : tab === "new" ? "Registrar ocorrência" : tab === "records" ? "Meus registros" : "Minhas tarefas"} | Urbana Campo`;
  }, [tab, orderId, openCode]);
  const userId = boot.user.id;
  const [guideStep, setGuideStep] = useState<any>(null);
  useEffect(() => {
    const navigate = (event: Event) => {
      const step = (event as CustomEvent).detail?.step;
      if (step?.page !== "field") return;
      setTab("tasks");
      setFilter("active");
      setGuideStep(step);
      const task =
        step.detail === "field"
          ? list.orders.find(
              (o: any) => !step.states || step.states.includes(o.status),
            )
          : null;
      setOrderId(task?.id || null);
    };
    const end = () => setGuideStep(null);
    window.addEventListener("urbana:onboarding-navigate", navigate);
    window.addEventListener("urbana:onboarding-end", end);
    return () => {
      window.removeEventListener("urbana:onboarding-navigate", navigate);
      window.removeEventListener("urbana:onboarding-end", end);
    };
  }, [list.orders]);
  const previous = useRef<string | null>(null),
    fetching = useRef(false),
    offset = useRef(0),
    fresh = useRef(false),
    leaving = useRef(false);
  const refresh = async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const loaded = await loadTasks(api, userId);
      const data = loaded.data;
      const signature = data.orders
        .map((o: any) => `${o.id}:${o.updated_at}`)
        .join("|");
      if (previous.current !== null && previous.current !== signature)
        setNotice("Suas tarefas foram atualizadas. Confira a lista.");
      previous.current = signature;
      offset.current = loaded.offset;
      fresh.current = true;
      setList(data);
      setSavedAt(null);
      setSessionExpired(false);
      setError("");
      void prefetchOrders(api, userId, data.orders, () => !leaving.current);
      void sync.flush();
    } catch (e: any) {
      fresh.current = false;
      if (!previous.current) {
        const cached = await cachedTasks(userId).catch(() => null);
        if (cached) {
          offset.current = cached.offset;
          setList(cached.data);
          setSavedAt(cached.savedAt);
        }
      } else setSavedAt((value) => value || new Date().toISOString());
      if (e.status === 401) {
        setSessionExpired(true);
        setError("");
      } else
        setError(
          isNetworkError(e) && !navigator.onLine
            ? ""
            : "Não foi possível atualizar. Seus rascunhos e ações guardadas permanecem neste aparelho.",
        );
    } finally {
      setLoading(false);
      fetching.current = false;
    }
  };
  useEffect(() => {
    // Lista salva aparece logo; a do servidor a substitui quando chegar.
    cachedTasks(userId)
      .then((cached) => {
        if (!cached || fresh.current) return;
        offset.current = cached.offset;
        setList(cached.data);
        setSavedAt(cached.savedAt);
        setLoading(false);
      })
      .catch(() => {});
    // Garante no cache do service worker os arquivos do app já carregados (inclusive os carregados
    // antes de o service worker assumir a página), para /campo abrir sem rede no próximo acesso.
    navigator.serviceWorker?.ready
      .then((registration) => {
        const urls = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => url.startsWith(`${window.location.origin}/assets/`));
        registration.active?.postMessage({ type: "urbana-cache-shell", urls });
      })
      .catch(() => {});
    refresh();
    const stopSynced = sync.whenSynced(() => {
      void refresh();
    });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
        void sync.flush();
      }
    }, 15000);
    const handleOnline = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOnline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopSynced();
      clearInterval(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOnline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    if (syncState.paused === "auth") setSessionExpired(true);
  }, [syncState.paused]);
  // Sessão válida (bootstrap do servidor, inclusive o que substitui a sessão salva ao voltar a rede):
  // habilita a abertura sem rede neste aparelho.
  useEffect(() => {
    if (!boot.offline) rememberSession(userId, boot).catch(() => {});
  }, [boot]); // eslint-disable-line react-hooks/exhaustive-deps
  // A revalidação da sessão salva recebeu 401: pede novo login, como a fila faz.
  const expired = sessionExpired || !!boot.session_expired;
  const enableNotifications = async () => {
    setNotificationBusy(true);
    try {
      if (
        !window.isSecureContext ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      )
        throw new Error(
          "Use o endereço HTTPS do sistema. No iPhone, adicione o app à Tela de Início e abra por ela.",
        );
      if (!list.push.configured)
        throw new Error(
          "As notificações serão habilitadas após a configuração da publicação. Com esta tela aberta, as tarefas atualizam a cada 15 segundos.",
        );
      if ((await Notification.requestPermission()) !== "granted")
        throw new Error(
          "Permita as notificações nas configurações do navegador.",
        );
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration?.active)
        throw new Error(
          "Instalação em preparação. Atualize a página e tente novamente.",
        );
      const raw = atob(
        list.push.public_key.replace(/-/g, "+").replace(/_/g, "/"),
      );
      const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }));
      await api("/campo/notificacoes", "POST", subscription.toJSON());
      setNotice("Notificações ativadas neste aparelho.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setNotificationBusy(false);
    }
  };
  const logout = async () => {
    if (syncState.items.length && !confirmLogout) {
      setConfirmLogout(true);
      return;
    }
    setConfirmLogout(false);
    // A sessão offline sai antes do servidor: se o app fechar no meio, ninguém reabre estes dados sem rede.
    await forgetSession().catch(() => {});
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        const sub = await registration?.pushManager.getSubscription();
        if (sub) {
          await api("/campo/notificacoes", "DELETE", {
            endpoint: sub.endpoint,
          });
          await sub.unsubscribe();
        }
      }
      leaving.current = true;
      await onLogout();
      await forgetUserCache(userId).catch(() => {});
    } catch (e: any) {
      leaving.current = false;
      if (!boot.offline) rememberSession(userId, boot).catch(() => {});
      setError(e.message);
    }
  };
  const offline: Offline = {
    sync,
    syncState,
    offset: () => offset.current,
    mustQueue: (id: string) =>
      !navigator.onLine ||
      expired ||
      syncState.items.some((i) => i.order_id === id),
    expire: () => setSessionExpired(true),
  };
  const orders = projectList(list.orders, syncState.items);
  const tasks = orders
    .filter((o: any) =>
      filter === "active"
        ? active.includes(o.status)
        : !active.includes(o.status),
    )
    .sort(
      (a: any, b: any) =>
        boot.priorities.indexOf(a.priority) -
          boot.priorities.indexOf(b.priority) ||
        a.scheduled_at.localeCompare(b.scheduled_at),
    );
  return (
    <div className="operator-app">
      <header className="operator-top">
        <div>
          <strong>
            urbana<span>campo</span>
          </strong>
          <small>{boot.user.name}</small>
        </div>
        <div>
          <button
            aria-label="Atualizar tarefas"
            onClick={() => {
              refresh();
              void sync.flush(true);
            }}
          >
            <RefreshCw size={21} />
          </button>
          <button aria-label="Sair da conta" onClick={logout}>
            <LogOut size={21} />
          </button>
        </div>
      </header>
      <main className="operator-main">
        <SyncBanner
          online={online}
          state={syncState}
          sessionExpired={expired}
          onLogin={() => window.location.reload()}
          onSyncNow={() => void sync.flush(true)}
        />
        {confirmLogout && (
          <div className="operator-message warning" role="alert">
            <span>
              Há {syncState.items.length}{" "}
              {syncState.items.length === 1
                ? "ação ainda não enviada"
                : "ações ainda não enviadas"}
              . Elas continuam guardadas neste aparelho, visíveis só para você,
              e serão enviadas quando você entrar de novo. As tarefas salvas
              serão apagadas do aparelho.
            </span>
            <div className="operator-outbox-actions">
              <button
                type="button"
                className="operator-button secondary"
                onClick={logout}
              >
                Sair mesmo assim
              </button>
              <button
                type="button"
                className="operator-link-button"
                onClick={() => setConfirmLogout(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="operator-message warning" role="alert">
            {error}
            <button aria-label="Fechar aviso" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="operator-message" role="status">
            {notice}
            <button
              aria-label="Fechar atualização"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
        {boot.user.role !== "Equipe de Campo" && (
          <button className="operator-back" onClick={onManagement}>
            <ArrowLeft size={17} />
            Voltar ao painel de gestão
          </button>
        )}
        {orderId ? (
          <Task
            key={orderId + ":" + (guideStep?.id || "")}
            id={orderId}
            guideStep={guideStep}
            version={list.orders.find((o: any) => o.id === orderId)?.updated_at}
            boot={boot}
            api={api}
            offline={offline}
            onBack={() => {
              setOrderId(null);
              history.replaceState(null, "", "/campo");
            }}
            onChange={refresh}
          />
        ) : tab === "new" ? (
          <Register
            boot={boot}
            api={api}
            onSaved={async (code: string) => {
              await refresh();
              setTab("records");
              setNotice(`Ocorrência ${code} enviada com foto para a gestão.`);
            }}
          />
        ) : tab === "records" ? (
          <>
            <h1>Meus registros</h1>
            <p className="operator-lead">
              Acompanhe o que você encontrou em campo.
            </p>
            <CachedNotice savedAt={savedAt} />
            {list.records.map((o: any) => (
              <article className="operator-card" key={o.id}>
                <span className="operator-status">{status[o.status]}</span>
                <h2>{o.address}</h2>
                <p>
                  {o.neighborhood} · {o.code}
                </p>
                <p>{o.description}</p>
                <small>Registrada em {date(o.created_at)}</small>
              </article>
            ))}
            {!list.records.length && (
              <div className="operator-empty" data-guide="field-empty">
                <MapPin />
                <h2>Nenhum registro enviado</h2>
                <p>Encontrou um problema? Use Registrar.</p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="operator-page-heading" data-guide="field-tasks">
              <div>
                <p className="operator-eyebrow">SEU DIA EM CAMPO</p>
                <h1>Minhas tarefas</h1>
              </div>
              <span className="operator-count">
                {orders.filter((o: any) => active.includes(o.status)).length}
              </span>
            </div>
            <p className="operator-lead">
              Veja onde ir, o que fazer e envie o resultado para análise.
            </p>
            <CachedNotice savedAt={savedAt} />
            <OutboxPanel
              items={syncState.items}
              onRetry={(id) => void sync.retry(id)}
              onDiscard={(id) => void sync.discard(id)}
            />
            <button
              className="operator-notifications"
              disabled={notificationBusy}
              onClick={enableNotifications}
            >
              <Bell size={19} />
              Ativar avisos neste celular
            </button>
            <div className="operator-tabs">
              <button
                aria-pressed={filter === "active"}
                onClick={() => setFilter("active")}
              >
                Para executar
              </button>
              <button
                aria-pressed={filter === "history"}
                onClick={() => setFilter("history")}
              >
                Enviadas e histórico
              </button>
            </div>
            {filter === "history" && boot.user.role !== "Equipe de Campo" && (
              <p className="operator-sync" role="note">
                No acesso da gestão, o Campo recebe só as OS abertas. As
                concluídas e canceladas estão em Ordens de serviço.
              </p>
            )}
            {loading ? (
              <p>Carregando tarefas...</p>
            ) : (
              tasks.map((o: any) => (
                <button
                  className="operator-card operator-task"
                  key={o.id}
                  data-guide="field-task"
                  onClick={() => setOrderId(o.id)}
                >
                  <div className="operator-card-heading">
                    <span className="operator-status">{status[o.status]}</span>
                    <span
                      className={`operator-priority ${o.priority === "Emergencial" ? "urgent" : ""}`}
                    >
                      {o.priority}
                    </span>
                  </div>
                  <small>
                    {o.code} ·{" "}
                    {o.assigned_user_id === boot.user.id
                      ? "Atribuída a você"
                      : "Atribuída à equipe"}
                  </small>
                  {(o.pending_count > 0 || o.rejected_count > 0) && (
                    <span
                      className={`operator-pending-badge ${o.rejected_count ? "rejected" : ""}`}
                    >
                      {o.rejected_count
                        ? `${o.rejected_count} recusada${o.rejected_count > 1 ? "s" : ""} pelo servidor`
                        : `${o.pending_count} aguardando envio`}
                    </span>
                  )}
                  <h2>
                    {o.occurrences[0]?.address || "Consultar locais da ordem"}
                  </h2>
                  <p>
                    {o.occurrences[0]?.neighborhood}{" "}
                    {o.occurrences.length > 1
                      ? `· +${o.occurrences.length - 1} locais`
                      : ""}
                  </p>
                  <p>{o.notes || o.occurrences[0]?.description}</p>
                  <div className="operator-task-footer">
                    <span>
                      Programada:{" "}
                      {o.scheduled_at.split("-").reverse().join("/")}
                    </span>
                    <strong>Abrir tarefa →</strong>
                  </div>
                </button>
              ))
            )}
            {!loading && !tasks.length && (
              <div className="operator-empty">
                <CheckCircle2 />
                <h2>
                  {filter === "active"
                    ? "Nenhuma tarefa no momento"
                    : "Nenhum envio por aqui"}
                </h2>
                <p>
                  As ordens distribuídas para você ou sua equipe aparecem aqui.
                </p>
              </div>
            )}
            <small className="operator-sync">
              Última atualização: {date(list.server_time)} · Atualiza a cada 15
              s com a tela aberta.
            </small>
          </>
        )}
      </main>
      <nav className="operator-bottom" aria-label="Navegação de campo">
        <button
          aria-current={!orderId && tab === "tasks" ? "page" : undefined}
          onClick={() => {
            setOrderId(null);
            setTab("tasks");
          }}
        >
          <ClipboardList />
          Tarefas
        </button>
        <button
          aria-current={tab === "new" && !orderId ? "page" : undefined}
          onClick={() => {
            setOrderId(null);
            setTab("new");
          }}
        >
          <Plus />
          Registrar
        </button>
        <button
          aria-current={tab === "records" && !orderId ? "page" : undefined}
          onClick={() => {
            setOrderId(null);
            setTab("records");
          }}
        >
          <MapPin />
          Meus registros
        </button>
      </nav>
    </div>
  );
}

function Register({ boot, api, onSaved }: any) {
  const cats = boot.catalogs.filter((c: any) => c.kind === "categorias"),
    key = `occurrence:${boot.user.id}`;
  const [draft, setDraft] = useState<any>({
    request_id: crypto.randomUUID(),
    photo_request_id: crypto.randomUUID(),
    category_id: cats[0]?.id,
    subcategory: cats[0]?.subcategories[0] || "",
    address: "",
    neighborhood: "",
    reference: "",
    description: "",
    lat: "",
    lng: "",
    priority: "Média",
    origin: "Equipe de campo",
    file: null,
  });
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(""),
    [nearby, setNearby] = useState<any[]>([]);
  const sent = useRef(false);
  useEffect(() => {
    let mounted = true;
    fieldDraft(key)
      .then((value) => {
        if (mounted && value) setDraft(value);
      })
      .catch(() =>
        setError(
          "Armazenamento local indisponível. Mantenha esta tela aberta até enviar.",
        ),
      )
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (!ready || busy) return;
    const timer = setTimeout(() => {
      if (!sent.current)
        fieldDraft(key, draft)
          .then(() => setSaved("Rascunho salvo neste aparelho."))
          .catch(() => setSaved("Não foi possível salvar o rascunho local."));
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, ready, busy]);
  const set = (name: string, value: any) => {
    setDraft((d: any) => ({ ...d, [name]: value }));
    setSaved("");
  };
  const gps = async () => {
    setBusy(true);
    setError("");
    try {
      const point = await location();
      setDraft((d: any) => ({ ...d, ...point }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!draft.file)
        throw new Error("Tire ou selecione uma foto do problema.");
      if (draft.lat === "" || draft.lng === "")
        throw new Error("Capture a localização ou informe as coordenadas.");
      await fieldDraft(key, draft);
      const occurrence = draft.record_id
        ? { id: draft.record_id, code: draft.record_code }
        : await api("/ocorrencias", "POST", {
            ...draft,
            file: undefined,
            lat: Number(draft.lat),
            lng: Number(draft.lng),
          });
      const updated = {
        ...draft,
        record_id: occurrence.id,
        record_code: occurrence.code,
      };
      setDraft(updated);
      await fieldDraft(key, updated);
      const form = new FormData();
      form.append("file", draft.file);
      form.append("stage", "registro");
      form.append("lat", String(draft.lat));
      form.append("lng", String(draft.lng));
      form.append("request_id", draft.photo_request_id);
      await api(`/ocorrencias/${occurrence.id}/anexos`, "POST", form);
      sent.current = true;
      await fieldDraft(key, undefined, true);
      await onSaved(occurrence.code);
    } catch (e: any) {
      setError(e.message || "Falha no envio. Seu rascunho foi mantido.");
      if (e.status === 409) setNearby(e.details?.nearby || []);
    } finally {
      setBusy(false);
    }
  };
  if (!ready) return <p>Recuperando rascunho...</p>;
  return (
    <>
      <p className="operator-eyebrow">REGISTRO NO LOCAL</p>
      <h1>Encontrou um problema?</h1>
      <p className="operator-lead">
        Uma foto, a localização e uma descrição para a gestão organizar o
        atendimento.
      </p>
      {error && (
        <div className="operator-message warning" role="alert">
          {error}
        </div>
      )}
      {draft.record_id && (
        <div className="operator-message">
          Registro {draft.record_code} recebido. Falta enviar a foto; toque em
          Reenviar foto.
        </div>
      )}
      <form onSubmit={submit} className="operator-form">
        <fieldset disabled={busy || !!draft.record_id}>
          <section className="operator-card">
            <h2>1. Fotografe o problema</h2>
            <label className="operator-camera">
              <Camera size={26} />
              <span>
                {draft.file ? "Trocar foto" : "Tirar ou escolher foto"}
              </span>
              <input
                aria-label="Foto do problema"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(e) => {
                  try {
                    set("file", checkedPhoto(e.target.files?.[0]));
                  } catch (err: any) {
                    setError(err.message);
                  }
                }}
              />
            </label>
            <PhotoPreview file={draft.file} />
          </section>
          <section className="operator-card">
            <h2>2. Confirme o local</h2>
            <button
              type="button"
              className="operator-button secondary"
              onClick={gps}
            >
              <LocateFixed />
              Usar minha localização
            </button>
            {draft.lat !== "" && (
              <p className="operator-gps">
                Localização definida: {Number(draft.lat).toFixed(5)},{" "}
                {Number(draft.lng).toFixed(5)}
              </p>
            )}
            <Field label="Rua e número">
              <input
                required
                maxLength={300}
                value={draft.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Ex.: Rua Azulão, 500"
              />
            </Field>
            <Field label="Bairro">
              <input
                required
                maxLength={200}
                value={draft.neighborhood}
                onChange={(e) => set("neighborhood", e.target.value)}
              />
            </Field>
            <Field label="Próximo a / ponto de referência">
              <input
                maxLength={1000}
                value={draft.reference}
                onChange={(e) => set("reference", e.target.value)}
              />
            </Field>
            <details>
              <summary>Informar coordenadas manualmente</summary>
              <Field label="Latitude do registro">
                <input
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  value={draft.lat}
                  onChange={(e) => set("lat", e.target.value)}
                />
              </Field>
              <Field label="Longitude do registro">
                <input
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  value={draft.lng}
                  onChange={(e) => set("lng", e.target.value)}
                />
              </Field>
            </details>
          </section>
          <section className="operator-card">
            <h2>3. O que precisa ser feito?</h2>
            <Field label="Tipo de problema">
              <select
                aria-label="Tipo de problema"
                value={draft.category_id}
                onChange={(e) =>
                  setDraft((d: any) => ({
                    ...d,
                    category_id: e.target.value,
                    subcategory:
                      cats.find((c: any) => c.id === e.target.value)
                        ?.subcategories[0] || "",
                  }))
                }
              >
                {cats.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Serviço solicitado">
              <select
                aria-label="Serviço solicitado"
                value={draft.subcategory}
                onChange={(e) => set("subcategory", e.target.value)}
              >
                {cats
                  .find((c: any) => c.id === draft.category_id)
                  ?.subcategories.map((v: string) => (
                    <option key={v}>{v}</option>
                  ))}
              </select>
            </Field>
            <Field label="Descrição do problema">
              <textarea
                required
                maxLength={2000}
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Conte o que encontrou e os riscos no local."
              />
            </Field>
            <details>
              <summary>Solicitante e contato (opcional)</summary>
              <Field label="Solicitado por">
                <input
                  maxLength={200}
                  value={draft.requested_by || ""}
                  onChange={(e) => set("requested_by", e.target.value)}
                />
              </Field>
              <Field label="Fone do solicitante">
                <input
                  type="tel"
                  maxLength={40}
                  value={draft.phone || ""}
                  onChange={(e) => set("phone", e.target.value)}
                />
              </Field>
            </details>
            <Field label="Prioridade observada">
              <select
                aria-label="Prioridade observada"
                value={draft.priority}
                onChange={(e) => set("priority", e.target.value)}
              >
                {boot.priorities.map((p: string) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
          </section>
        </fieldset>
        {nearby.length > 0 && (
          <div className="operator-card">
            <h2>Já existe registro próximo</h2>
            {nearby.map((o) => (
              <p key={o.id}>
                {o.code} · {o.address}
              </p>
            ))}
            <label className="operator-check">
              <input
                type="checkbox"
                checked={draft.duplicate_action === "new"}
                onChange={(e) =>
                  set("duplicate_action", e.target.checked ? "new" : undefined)
                }
              />
              Conferi: é outro problema e deve ser registrado separadamente.
            </label>
          </div>
        )}
        <button className="operator-button" disabled={busy}>
          <Send />
          {busy
            ? "Enviando..."
            : draft.record_id
              ? "Reenviar foto"
              : "Enviar ocorrência"}
        </button>
        <p className="operator-sync">
          {saved} O envio à gestão só acontece ao tocar no botão.
        </p>
      </form>
    </>
  );
}
const sentMessages: Record<string, string> = {
  assumir: "Deslocamento registrado.",
  iniciar: "Execução iniciada. Registre o resultado do serviço.",
  concluir: "Resultado enviado para análise. Aguarde a validação da gestão.",
  devolver: "Ordem devolvida à gestão com a justificativa informada.",
  material: "Material utilizado registrado.",
  equipamento: "Equipamento vinculado.",
};
const queuedMessages: Record<string, string> = {
  assumir:
    "Deslocamento guardado neste aparelho. Será enviado automaticamente quando houver conexão.",
  iniciar:
    "Chegada e início guardados neste aparelho. Registre o resultado do serviço.",
  concluir:
    "Resultado guardado neste aparelho. Será enviado para análise automaticamente quando houver conexão.",
  devolver:
    "Devolução guardada neste aparelho. Será enviada automaticamente quando houver conexão.",
  material: "Material guardado neste aparelho. Será enviado automaticamente.",
  equipamento:
    "Equipamento guardado neste aparelho. Será enviado automaticamente.",
};
function Task({
  guideStep,
  id,
  version,
  boot,
  api,
  offline,
  onBack,
  onChange,
}: {
  guideStep: any;
  id: string;
  version?: string;
  boot: any;
  api: Props["api"];
  offline: Offline;
  onBack: () => void;
  onChange: () => Promise<void>;
}) {
  const errorRef = useRef<HTMLDivElement>(null);
  const userId = boot.user.id;
  const { sync, syncState } = offline;
  const [serverOrder, setServerOrder] = useState<any>(null),
    [savedAt, setSavedAt] = useState<string | null>(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [point, setPointState] = useState<any>({ lat: "", lng: "" }),
    [notes, setNotes] = useState(""),
    [reason, setReason] = useState(""),
    [returning, setReturning] = useState(guideStep?.id === "return");
  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView({ block: "center" });
    }
  }, [error, busy]);
  const load = async (network = true) => {
    try {
      const loaded = await loadOrder(
        api,
        userId,
        id,
        network && navigator.onLine,
      );
      if (loaded) {
        setServerOrder(loaded.data);
        setSavedAt(loaded.savedAt);
        setError("");
      } else
        setError(
          "Esta ordem ainda não foi salva neste aparelho. Conecte-se à internet para abri-la pela primeira vez.",
        );
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, [id, version]);
  // A sincronização atualizou o cache desta OS (envio aceito ou recusado): relê a cópia local.
  useEffect(() => {
    if (syncState.cacheRevision) load(false);
  }, [syncState.cacheRevision]);
  useEffect(() => {
    fieldDraft(`notes:${boot.user.id}:${id}`)
      .then((v) => {
        if (v) setNotes(v);
      })
      .catch(() => {});
    fieldDraft(`point:${boot.user.id}:${id}`)
      .then((v) => {
        if (v)
          setPointState((current: any) => (current.lat === "" ? v : current));
      })
      .catch(() => {});
  }, [id]);
  // GPS do local fica no aparelho: reabrir a OS sem rede não perde a chegada capturada.
  const setPoint = (value: any) => {
    setPointState(value);
    fieldDraft(`point:${boot.user.id}:${id}`, value).catch(() => {});
  };
  const items = syncState.items.filter((i) => i.order_id === id);
  const order = serverOrder ? projectOrder(serverOrder, items) : null;
  const categories = boot.catalogs.filter((c: any) => c.kind === "categorias");
  /** Guarda a ação na fila depois de antecipar as validações do servidor. */
  const queue = async (
    kind: ActionKind,
    body: any,
    requestId: string,
    capturedAt: string,
    file?: Blob | null,
  ) => {
    const problem = validateAction(order, kind, body, categories);
    if (problem) throw new Error(problem.message);
    await sync.enqueue({
      id: requestId,
      kind,
      order: { id, code: serverOrder.code, version: serverOrder.version },
      body,
      file,
      captured_at: capturedAt,
    });
  };
  const action = async (name: ActionKind, body: any = {}) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    // Identificador e hora reais do toque: valem para o envio direto e, se a rede falhar, para a fila.
    const requestId = crypto.randomUUID(),
      capturedAt = capturedNow(offline.offset());
    try {
      if (!offline.mustQueue(id)) {
        try {
          await api(
            `/ordens-servico/${id}/${name}`,
            "POST",
            name === "equipamento"
              ? body
              : { ...body, version: order.version, request_id: requestId },
          );
          setSuccess(sentMessages[name] || "Operação registrada.");
          await load();
          try {
            await onChange();
          } catch {
            setError(
              "A operação foi registrada, mas a lista não foi atualizada. Volte às tarefas e confira antes de repetir.",
            );
          }
          if (name === "concluir")
            await fieldDraft(
              `notes:${boot.user.id}:${id}`,
              undefined,
              true,
            ).catch(() => {});
          return;
        } catch (e: any) {
          if (e.status === 401) offline.expire();
          else if (!isNetworkError(e)) throw e;
          // Sem resposta (ou sessão expirada): a mesma ação (mesmo request_id) vai para a fila; se já tiver sido aplicada, o servidor não repete.
        }
      }
      await queue(name, body, requestId, capturedAt);
      setSuccess(queuedMessages[name] || "Ação guardada neste aparelho.");
      if (name === "concluir")
        await fieldDraft(`notes:${boot.user.id}:${id}`, undefined, true).catch(
          () => {},
        );
      if (name === "devolver") setReturning(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const gps = async () => {
    setBusy(true);
    try {
      setPoint(await location());
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!order)
    return (
      <>
        <button className="operator-back" onClick={onBack}>
          <ArrowLeft />
          Voltar às tarefas
        </button>
        <p role={error ? "alert" : undefined}>
          {error || "Carregando ordem..."}
        </p>
        <OutboxPanel
          items={syncState.items}
          orderId={id}
          onRetry={(i) => void sync.retry(i)}
          onDiscard={(i) => void sync.discard(i)}
        />
      </>
    );
  const cat = (kind: string) =>
      boot.catalogs.filter((c: any) => c.kind === kind),
    name = (id: string) =>
      boot.catalogs.find((c: any) => c.id === id)?.name || "—";
  const isActive = active.includes(order.status),
    started = order.status === "EM_EXECUCAO";
  const localFile = (itemId?: string) =>
    items.find((i) => i.id === itemId)?.file || null;
  return (
    <>
      <button className="operator-back" onClick={onBack}>
        <ArrowLeft size={18} />
        Voltar às tarefas
      </button>
      <div className="operator-page-heading" data-guide="field-summary">
        <div>
          <p className="operator-eyebrow">ORDEM DE SERVIÇO</p>
          <h1>{order.code}</h1>
        </div>
        <span className="operator-status">{status[order.status]}</span>
      </div>
      <CachedNotice savedAt={savedAt} />
      {error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          className="operator-message warning"
          role="alert"
        >
          {error}
        </div>
      )}
      {error === "Registro alterado por outro usuário." && (
        <div className="operator-message" role="alert">
          <p>
            Atualize os dados antes de continuar. Seu relato local foi
            preservado.
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={async () => {
              await load();
            }}
          >
            Atualizar dados
          </button>
        </div>
      )}
      {success && (
        <div className="operator-message" role="status">
          {success}
        </div>
      )}
      <OutboxPanel
        items={syncState.items}
        orderId={id}
        busy={busy}
        onRetry={(i) => void sync.retry(i)}
        onDiscard={(i) => void sync.discard(i)}
      />
      {order.status === "AGUARDANDO_VALIDACAO" && (
        <div className="operator-message">
          <CheckCircle2 />
          {items.some((i) => i.kind === "concluir" && i.status !== "rejected")
            ? "Resultado guardado neste aparelho. Será enviado para análise quando houver conexão."
            : "Resultado enviado. Aguarde a análise da gestão para o fechamento."}
        </div>
      )}
      {order.status === "CONCLUIDA" && (
        <div className="operator-message">
          Serviço aprovado por {order.validated_by || "fiscalização"} em{" "}
          {date(order.completed_at)}.
        </div>
      )}
      {order.reason && started && (
        <div className="operator-message warning">
          Correção solicitada: {order.reason}
        </div>
      )}
      {order.return_reason && (
        <div className="operator-message warning">
          Devolução registrada: {order.return_reason}
        </div>
      )}
      <section className="operator-card">
        <h2>Serviço solicitado</h2>
        <dl className="operator-facts">
          <div>
            <dt>Emitida por</dt>
            <dd>{order.issued_by || "Gestão municipal"}</dd>
          </div>
          <div>
            <dt>Data / hora da emissão</dt>
            <dd>{date(order.created_at)}</dd>
          </div>
          <div>
            <dt>Equipe</dt>
            <dd>{name(order.team_id)}</dd>
          </div>
          <div>
            <dt>Responsável</dt>
            <dd>{order.responsible}</dd>
          </div>
          <div>
            <dt>Prioridade</dt>
            <dd>{order.priority}</dd>
          </div>
          <div>
            <dt>Data programada</dt>
            <dd>{order.scheduled_at.split("-").reverse().join("/")}</dd>
          </div>
          <div>
            <dt>Prazo de atendimento</dt>
            <dd>{date(order.due_at)}</dd>
          </div>
        </dl>
        {order.notes && <p className="operator-instructions">{order.notes}</p>}
      </section>
      {order.occurrences.map((o: any) => (
        <section className="operator-card" key={o.id}>
          <small>
            {o.code} · {name(o.category_id)}
          </small>
          <h2>{o.address}</h2>
          <p>{o.neighborhood}</p>
          {o.reference && (
            <p>
              <strong>Próximo a:</strong> {o.reference}
            </p>
          )}
          <p>
            <strong>Solicitado por:</strong> {o.requested_by || o.origin}
          </p>
          {o.phone && (
            <p>
              <strong>Fone:</strong> {o.phone}
            </p>
          )}
          <p className="operator-instructions">{o.description}</p>
          <div className="operator-evidence">
            {o.evidence
              ?.filter((e: any) => e.mime.startsWith("image/"))
              .map((e: any) => (
                <a
                  key={e.id}
                  href={`/api/anexos/${e.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={`/api/anexos/${e.id}`}
                    alt="Foto do problema registrado"
                  />
                  <small>Registro inicial · {date(e.created_at)}</small>
                </a>
              ))}
          </div>
          <a
            className="operator-button secondary"
            href={`https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            <Navigation />
            Como chegar
          </a>
        </section>
      ))}
      {isActive && (
        <section className="operator-card" data-guide="field-arrival">
          <h2>{started ? "Execução no local" : "Chegada ao local"}</h2>
          {order.status === "PROGRAMADA" && (
            <button
              className="operator-button secondary"
              disabled={busy}
              data-guide="field-assume"
              onClick={() => action("assumir")}
            >
              Estou a caminho
            </button>
          )}
          <button
            className="operator-button secondary"
            disabled={busy}
            onClick={gps}
          >
            <LocateFixed />
            Capturar GPS do local
          </button>
          {point.lat !== "" && (
            <p className="operator-gps">
              GPS: {Number(point.lat).toFixed(5)},{" "}
              {Number(point.lng).toFixed(5)}
            </p>
          )}
          <details>
            <summary>Informar coordenadas manualmente</summary>
            <Field label="Latitude de campo">
              <input
                type="number"
                min="-90"
                max="90"
                step="any"
                value={point.lat}
                onChange={(e) => setPoint({ ...point, lat: e.target.value })}
              />
            </Field>
            <Field label="Longitude de campo">
              <input
                type="number"
                min="-180"
                max="180"
                step="any"
                value={point.lng}
                onChange={(e) => setPoint({ ...point, lng: e.target.value })}
              />
            </Field>
          </details>
          <Evidence
            key={`${id}:antes`}
            stage="antes"
            order={order}
            serverOrder={serverOrder}
            boot={boot}
            point={point}
            api={api}
            offline={offline}
            onChange={load}
          />
          {!started && (
            <button
              className="operator-button"
              disabled={busy || point.lat === "" || point.lng === ""}
              onClick={() =>
                action("iniciar", {
                  lat: Number(point.lat),
                  lng: Number(point.lng),
                })
              }
            >
              Confirmar chegada e iniciar serviço
            </button>
          )}
        </section>
      )}
      {started && (
        <>
          <section className="operator-card">
            <h2 data-guide="field-materials">Materiais utilizados</h2>
            {order.materials.map((m: any) => (
              <p key={m.id}>
                {name(m.material_id)} · {m.quantity}{" "}
                {boot.catalogs.find((c: any) => c.id === m.material_id)?.unit}
                {m.pending && (
                  <span className="operator-pending-tag">
                    {" "}
                    · aguardando envio
                  </span>
                )}
              </p>
            ))}
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                action("material", {
                  material_id: data.get("material_id"),
                  quantity: Number(data.get("quantity")),
                });
              }}
            >
              <Field label="Material utilizado">
                <select
                  name="material_id"
                  aria-label="Material utilizado"
                  required
                >
                  <option value="">Selecione</option>
                  {cat("materiais").map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.unit})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quantidade utilizada">
                <input
                  type="number"
                  name="quantity"
                  min="0.001"
                  step="any"
                  required
                />
              </Field>
              <button className="operator-button secondary" disabled={busy}>
                Adicionar material
              </button>
            </form>
          </section>
          {cat("equipamentos").length > 0 && (
            <section className="operator-card">
              <h2>Equipamentos utilizados</h2>
              {order.equipment.map((e: any) => (
                <p key={e.equipment_id}>
                  {name(e.equipment_id)}
                  {e.pending && (
                    <span className="operator-pending-tag">
                      {" "}
                      · aguardando envio
                    </span>
                  )}
                </p>
              ))}
              <form
                className="operator-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  action("equipamento", {
                    equipment_id: data.get("equipment_id"),
                  });
                }}
              >
                <Field label="Equipamento utilizado">
                  <select
                    name="equipment_id"
                    aria-label="Equipamento utilizado"
                    required
                  >
                    <option value="">Selecione</option>
                    {cat("equipamentos").map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <button className="operator-button secondary" disabled={busy}>
                  Vincular equipamento
                </button>
              </form>
            </section>
          )}
          <section className="operator-card">
            <h2 data-guide="field-result">Resultado do serviço</h2>
            <p>
              Depois de selecionar a foto, toque em &quot;Enviar foto
              depois&quot; e aguarde a confirmação &quot;Foto enviada&quot;
              antes de enviar para análise.
            </p>
            <Evidence
              key={`${id}:depois`}
              stage="depois"
              order={order}
              serverOrder={serverOrder}
              boot={boot}
              point={point}
              api={api}
              offline={offline}
              onChange={load}
            />
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                action("concluir", { notes });
              }}
            >
              <Field label="O que foi feito">
                <textarea
                  required
                  data-guide="field-report"
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    fieldDraft(
                      `notes:${boot.user.id}:${id}`,
                      e.target.value,
                    ).catch(() => {});
                  }}
                  placeholder="Descreva o serviço executado e as condições do local."
                />
              </Field>
              <p>
                A gestão analisará as fotos e o relato antes de encerrar a
                ordem.
              </p>
              <button
                data-guide="field-send"
                className="operator-button"
                disabled={busy}
              >
                <Send />
                Enviar para análise
              </button>
            </form>
          </section>
        </>
      )}
      {isActive && (
        <section className="operator-card">
          <button
            className="operator-return"
            data-guide="field-return"
            onClick={() => setReturning(!returning)}
          >
            <TriangleAlert size={20} />
            Não foi possível executar
          </button>
          {returning && (
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                action("devolver", { reason });
              }}
            >
              <Field label="Motivo da devolução">
                <textarea
                  required
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explique o impedimento para a gestão reprogramar."
                />
              </Field>
              <button className="operator-button secondary" disabled={busy}>
                Devolver à gestão
              </button>
            </form>
          )}
        </section>
      )}
      {order.evidence.length > 0 && (
        <section className="operator-card">
          <h2>Fotos enviadas</h2>
          <div className="operator-evidence">
            {order.evidence
              .filter((e: any) => e.mime.startsWith("image/"))
              .map((e: any) =>
                e.pending ? (
                  <figure key={e.id} className="operator-local-photo">
                    <LocalPhoto
                      file={localFile(e.local_item)}
                      alt={`Foto ${e.stage} do serviço (aguardando envio)`}
                    />
                    <small>
                      {e.stage} · {date(e.captured_at || e.created_at)} ·
                      aguardando envio
                    </small>
                  </figure>
                ) : (
                  <a
                    key={e.id}
                    href={`/api/anexos/${e.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={`/api/anexos/${e.id}`}
                      alt={`Foto ${e.stage} do serviço`}
                    />
                    <small>
                      {e.stage} · {date(e.captured_at || e.created_at)}
                    </small>
                  </a>
                ),
              )}
          </div>
        </section>
      )}
      {order.completion_notes && (
        <section className="operator-card">
          <h2>
            {items.some((i) => i.kind === "concluir" && i.status !== "rejected")
              ? "Relato guardado (aguardando envio)"
              : "Relato enviado"}
          </h2>
          <p>{order.completion_notes}</p>
          <small>
            {order.executed_by} · {date(order.finished_at)}
          </small>
        </section>
      )}
    </>
  );
}
function Evidence({
  stage,
  order,
  serverOrder,
  boot,
  point,
  api,
  offline,
  onChange,
}: any) {
  const key = `photo:${boot.user.id}:${order.id}:${stage}`;
  const { sync } = offline as Offline;
  const [draft, setDraft] = useState<any>({
      file: null,
      request_id: crypto.randomUUID(),
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [queued, setQueued] = useState("");
  useEffect(() => {
    fieldDraft(key)
      .then((v) => {
        if (v) setDraft(v);
      })
      .catch(() => {});
  }, []);
  const upload = async () => {
    setBusy(true);
    setError("");
    setQueued("");
    try {
      if (point.lat === "" || point.lng === "")
        throw new Error("Capture o GPS do local antes de enviar a foto.");
      if (!(offline as Offline).mustQueue(order.id)) {
        try {
          const form = new FormData();
          form.append("file", draft.file);
          form.append("stage", stage);
          form.append("lat", String(point.lat));
          form.append("lng", String(point.lng));
          form.append("request_id", draft.request_id);
          await api(`/ordens-servico/${order.id}/anexos`, "POST", form);
          await fieldDraft(key, undefined, true);
          setDraft({ file: null, request_id: crypto.randomUUID() });
          await onChange();
          return;
        } catch (e: any) {
          if (e.status === 401) (offline as Offline).expire();
          else if (!isNetworkError(e)) throw e;
        }
      }
      // Sem rede (ou com ações anteriores desta OS na fila): a foto entra na fila com o mesmo request_id.
      const body = {
        stage,
        lat: Number(point.lat),
        lng: Number(point.lng),
        mime: draft.file.type,
      };
      const problem = validateAction(order, "anexo", body, boot.catalogs);
      if (problem) throw new Error(problem.message);
      await sync.enqueue({
        id: draft.request_id,
        kind: "anexo",
        order: {
          id: order.id,
          code: order.code,
          version: serverOrder?.version,
        },
        body,
        file: draft.file,
        captured_at:
          draft.captured_at || capturedNow((offline as Offline).offset()),
      });
      await fieldDraft(key, undefined, true).catch(() => {});
      setDraft({ file: null, request_id: crypto.randomUUID() });
      setQueued(
        "Foto guardada neste aparelho. Será enviada automaticamente quando houver conexão.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const real = {
    ...order,
    evidence: order.evidence.filter((e: any) => !e.pending),
  };
  const sent = hasValidPhoto(real, stage),
    waiting = !sent && hasValidPhoto(order, stage);
  return (
    <div
      className="operator-upload"
      data-guide={
        stage === "antes" ? "field-photo-before" : "field-photo-after"
      }
    >
      <h3>
        Foto {stage === "antes" ? "antes do serviço" : "depois do serviço"}
      </h3>
      {sent && <p className="operator-gps">✓ Foto enviada</p>}
      {waiting && (
        <p className="operator-gps pending">
          ✓ Foto guardada · aguardando envio
        </p>
      )}
      {queued && (
        <p className="operator-sync" role="status">
          {queued}
        </p>
      )}
      {error && (
        <p role="alert" className="operator-upload-error">
          {error}
        </p>
      )}
      <label className="operator-camera">
        <Camera />
        <span>{draft.file ? "Trocar foto" : `Fotografar ${stage}`}</span>
        <input
          aria-label={`Foto ${stage}`}
          disabled={busy}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={async (e) => {
            try {
              const file = checkedPhoto(e.target.files?.[0]);
              if (file) {
                // captured_at: momento em que a foto foi tirada/escolhida, no relógio do servidor.
                const next = {
                  file,
                  request_id: crypto.randomUUID(),
                  captured_at: capturedNow((offline as Offline).offset()),
                };
                setDraft(next);
                await fieldDraft(key, next);
                setError("");
                setQueued("");
              }
            } catch (err: any) {
              setError(err.message);
            }
          }}
        />
      </label>
      <PhotoPreview file={draft.file} />
      {draft.file && (
        <button
          type="button"
          className="operator-button secondary"
          disabled={busy}
          onClick={upload}
        >
          {busy ? "Enviando foto..." : `Enviar foto ${stage}`}
        </button>
      )}
    </div>
  );
}
