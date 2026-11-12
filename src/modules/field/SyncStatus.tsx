import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, TriangleAlert, CloudUpload } from "lucide-react";
import { actionLabel, queueStates, type OutboxItem } from "./outbox-model.mjs";
import type { SyncState } from "./sync";

const when = (v?: string | null) =>
  v
    ? new Date(v).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Situação de conexão e envio. A região "status" é sempre renderizada (aria-live polite) para
 * leitores de tela anunciarem mudanças; rejeições e sessão expirada usam "alert".
 */
export function SyncBanner({
  online,
  state,
  sessionExpired,
  onLogin,
  onSyncNow,
}: {
  online: boolean;
  state: SyncState;
  sessionExpired: boolean;
  onLogin: () => void;
  onSyncNow: () => void;
}) {
  const states = queueStates(state.items);
  const pending = states.filter((s) => s.state !== "rejected").length;
  const rejected = states.length - pending;
  const message = !online
    ? `Sem conexão. Continue o trabalho: as ações ficam guardadas neste aparelho e serão enviadas quando o sinal voltar.${pending ? ` ${plural(pending, "ação aguardando envio", "ações aguardando envio")}.` : ""}`
    : state.syncing
      ? state.announcement
      : pending
        ? `${plural(pending, "ação aguardando envio", "ações aguardando envio")}.${state.retryAt ? " Nova tentativa automática em instantes." : ""}`
        : state.announcement;
  return (
    <>
      <div
        className={`operator-sync-status ${!online ? "offline" : pending ? "pending" : message ? "done" : "idle"}`}
        role="status"
        aria-live="polite"
        data-testid="sync-status"
      >
        {message && (
          <>
            {!online ? (
              <CloudOff size={20} aria-hidden="true" />
            ) : (
              <CloudUpload size={20} aria-hidden="true" />
            )}
            <span>{message}</span>
            {online && pending > 0 && !state.syncing && !sessionExpired && (
              <button
                type="button"
                className="operator-link-button"
                onClick={onSyncNow}
              >
                <RefreshCw size={15} aria-hidden="true" />
                Enviar agora
              </button>
            )}
          </>
        )}
      </div>
      {state.storageError && (
        <div className="operator-message warning" role="alert">
          {state.storageError}
        </div>
      )}
      {sessionExpired && (
        <div className="operator-message warning operator-session" role="alert">
          <span>
            Sua sessão expirou.
            {state.items.length
              ? ` ${plural(state.items.length, "ação continua guardada", "ações continuam guardadas")} neste aparelho e ${state.items.length === 1 ? "será enviada" : "serão enviadas"} depois que você entrar.`
              : " Entre novamente para continuar."}
          </span>
          {online && (
            <button
              type="button"
              className="operator-button secondary"
              onClick={onLogin}
            >
              Entrar novamente
            </button>
          )}
        </div>
      )}
      {rejected > 0 && (
        <div className="operator-message warning" role="alert">
          <TriangleAlert size={20} aria-hidden="true" />
          {plural(rejected, "ação foi recusada", "ações foram recusadas")} pelo
          servidor. Revise em “Pendências de envio”.
        </div>
      )}
    </>
  );
}

/** Indicação de que os dados exibidos vêm do aparelho, com a hora da última atualização. */
export function CachedNotice({ savedAt }: { savedAt: string | null }) {
  if (!savedAt) return null;
  return (
    <p className="operator-cached" data-testid="cached-notice">
      <CloudOff size={16} aria-hidden="true" />
      Dados salvos neste aparelho · atualizados em {when(savedAt)}
    </p>
  );
}

/** Pré-visualização de uma foto guardada na fila (ainda não enviada). */
export function LocalPhoto({ file, alt }: { file?: Blob | null; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt={alt} /> : null;
}

/** Pendências de envio: o que ainda não chegou ao servidor e as ações recusadas, com decisão. */
export function OutboxPanel({
  items,
  orderId,
  busy,
  onRetry,
  onDiscard,
}: {
  items: OutboxItem[];
  orderId?: string;
  busy?: boolean;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const states = queueStates(items).filter(
    (s) => !orderId || s.item.order_id === orderId,
  );
  if (!states.length) return null;
  return (
    <section
      className="operator-card operator-outbox"
      aria-labelledby={`outbox-${orderId || "all"}`}
    >
      <h2 id={`outbox-${orderId || "all"}`}>Pendências de envio</h2>
      <ul>
        {states.map(({ item, state }) => (
          <li key={item.id} className={`operator-outbox-item ${state}`}>
            <div>
              <strong>{actionLabel(item)}</strong>
              {!orderId && item.order_code && (
                <small> · {item.order_code}</small>
              )}
            </div>
            <small>
              Registrada em {when(item.captured_at || item.created_at)}
            </small>
            <span className="operator-outbox-state">
              {state === "rejected"
                ? "Recusada pelo servidor"
                : state === "waiting"
                  ? "Aguardando a ação recusada ser resolvida"
                  : "Aguardando envio"}
            </span>
            {state === "rejected" && (
              <>
                <p className="operator-outbox-reason">
                  {item.error?.reason || item.error?.message}
                </p>
                {confirm === item.id ? (
                  <div className="operator-outbox-actions">
                    <p>
                      Descartar apaga esta ação do aparelho. Ela não será
                      enviada.
                    </p>
                    <button
                      type="button"
                      className="operator-button secondary"
                      disabled={busy}
                      onClick={() => {
                        setConfirm(null);
                        onDiscard(item.id);
                      }}
                    >
                      Confirmar descarte
                    </button>
                    <button
                      type="button"
                      className="operator-link-button"
                      onClick={() => setConfirm(null)}
                    >
                      Manter
                    </button>
                  </div>
                ) : (
                  <div className="operator-outbox-actions">
                    <button
                      type="button"
                      className="operator-button secondary"
                      disabled={busy}
                      onClick={() => onRetry(item.id)}
                    >
                      Reenviar
                    </button>
                    <button
                      type="button"
                      className="operator-button secondary"
                      disabled={busy}
                      onClick={() => setConfirm(item.id)}
                    >
                      Descartar
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
