import { useEffect, useMemo, useSyncExternalStore } from "react";
import { FieldSync } from "./sync";

/**
 * Uma fila por usuário. Dispara o envio ao reconectar (evento online), ao voltar para o app
 * (visibilitychange), por mensagem do service worker (Background Sync, quando existe); a tela
 * também chama `flush` na atualização periódica de 15 s.
 */
export function useFieldSync(user: { id: string; name: string }) {
  const sync = useMemo(() => new FieldSync(user), [user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = useSyncExternalStore(
    sync.subscribe,
    sync.getState,
    sync.getState,
  );
  useEffect(() => {
    sync.start();
    void sync.load().then(() => sync.flush(true));
    const online = () => void sync.flush(true);
    const visible = () => {
      if (document.visibilityState === "visible") void sync.flush(true);
    };
    const message = (event: MessageEvent) => {
      if (event.data?.type === "urbana-field-sync") void sync.flush(true);
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    navigator.serviceWorker?.addEventListener("message", message);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
      navigator.serviceWorker?.removeEventListener("message", message);
      sync.stop();
    };
  }, [sync]);
  return { sync, state };
}
