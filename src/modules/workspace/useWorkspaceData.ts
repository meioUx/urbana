import { useEffect, useRef, useState } from "react";
import {
  hasModuleAccess,
  landingModule,
} from "../../../shared/authorization.mjs";
import { api } from "../../shared/api";
import type { Boot, Row } from "../../shared/types";

/**
 * Bootstrap em uso. `offline` marca a sessão de Campo salva neste aparelho (IndexedDB), usada quando
 * /api/bootstrap não alcança o servidor em /campo; `session_expired` indica que a revalidação recebeu 401.
 */
export type WorkspaceBoot = Boot & {
  offline?: boolean;
  offline_saved_at?: string;
  session_expired?: boolean;
};
/** Contagem de ocorrências por estado e, na tela do mapa, os bairros conhecidos (`GET /api/ocorrencias/resumo`). */
export type OccurrenceSummary = {
  by_status: Record<string, number>;
  neighborhoods?: string[];
};

const isFieldPath = () => /^\/campo(\/|$)/.test(window.location.pathname);
/** Falha sem resposta do servidor (sem rede, tempo esgotado) ou gateway sem o servidor por trás. */
const unreachable = (e: any) =>
  !e?.status || [502, 503, 504].includes(e.status);
/** Armazenamento do Campo carregado sob demanda (fora do chunk de entrada). */
const fieldStorage = () => import("../../field-storage");
/** Sessão de Campo salva pelo Operator neste aparelho. */
async function savedFieldBoot(): Promise<WorkspaceBoot | null> {
  const saved = await (await fieldStorage()).readFieldSession();
  return saved?.boot?.user
    ? { ...saved.boot, offline: true, offline_saved_at: saved.saved_at }
    : null;
}
/** Logout ou sessão recusada (401): a sessão de Campo deste aparelho não abre mais o app sem rede. */
export async function forgetFieldSession(userId?: string) {
  const { clearFieldSession, clearCache } = await fieldStorage();
  await clearFieldSession();
  if (userId) await clearCache(userId, true);
}

/** Fuso horário do navegador, usado nos dias do gráfico de evolução do painel. */
const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
/** Módulos que leem o resumo de ocorrências (contador da triagem no menu e bairros do mapa). */
const summaryModules = ["triagem", "map"];

/**
 * Sessão (bootstrap) e dados operacionais da área de gestão: carga inicial,
 * atualização sob demanda e sincronização periódica a cada 15 segundos.
 * Nenhuma lista completa é carregada aqui: o menu usa o resumo de ocorrências, o painel recebe só
 * agregados (`/dashboard`, carregado na Visão geral e em Materiais) e o planejamento só o trabalho
 * aberto (`/planejamento`, carregado na tela de Planejamento). As demais telas buscam o que mostram.
 */
export function useWorkspaceData({
  page,
  setPage,
  setError,
  fieldMode,
}: {
  page: string;
  setPage: (page: string) => void;
  setError: (message: string) => void;
  fieldMode: boolean;
}) {
  const [boot, setBoot] = useState<WorkspaceBoot | null>(null),
    [loading, setLoading] = useState(true),
    [summary, setSummary] = useState<OccurrenceSummary | null>(null),
    [planning, setPlanning] = useState<any>(null),
    [dashboard, setDashboard] = useState<any>(null),
    [users, setUsers] = useState<Row[]>([]),
    [syncError, setSyncError] = useState(""),
    [lastSync, setLastSync] = useState<string>(""),
    [syncing, setSyncing] = useState(false);
  const pageRef = useRef(page),
    loadedFor = useRef("");
  pageRef.current = page;
  /** Dados que dependem da tela aberta: agregados do painel, planejamento e bairros do mapa. */
  const loadPageData = async (b: Boot, current: string) => {
    const [d, p, s] = await Promise.all([
      ["dashboard", "materials"].includes(current) &&
      hasModuleAccess(b.user, "dashboard")
        ? api(`/dashboard?tz=${encodeURIComponent(timeZone())}`)
        : undefined,
      current === "planning" && hasModuleAccess(b.user, "planning")
        ? api("/planejamento")
        : undefined,
      current === "map" && hasModuleAccess(b.user, "map")
        ? api("/ocorrencias/resumo?bairros=1")
        : undefined,
    ]);
    if (d !== undefined) setDashboard(d);
    if (p !== undefined) setPlanning(p);
    if (s !== undefined) setSummary(s);
    loadedFor.current = current;
  };
  const refresh = async () => {
    const b = await api("/bootstrap");
    if (
      b.user.role === "Equipe de Campo" ||
      window.location.pathname === "/mapa"
    ) {
      if (b.user.role !== "Equipe de Campo")
        setLastSync(new Date().toISOString());
      setBoot(b);
      if (b.user.role === "Equipe de Campo" && window.location.pathname === "/")
        history.replaceState(null, "", "/campo");
      return;
    }
    const permitted = (modules: string[]) =>
      modules.some((m) => hasModuleAccess(b.user, m));
    const landing =
      !boot && window.location.pathname === "/"
        ? landingModule(b.user) || "none"
        : pageRef.current;
    // No mapa, loadPageData já traz o resumo com os bairros.
    const mapSummary = landing === "map" && hasModuleAccess(b.user, "map");
    const [s] = await Promise.all([
      permitted(summaryModules) && !mapSummary
        ? api("/ocorrencias/resumo")
        : undefined,
      loadPageData(b, landing),
    ]);
    if (!boot && window.location.pathname === "/") setPage(landing);
    setBoot(b);
    if (s !== undefined) setSummary(s);
    else if (!permitted(summaryModules)) setSummary(null);
    if (hasModuleAccess(b.user, "admin")) {
      setUsers(await api("/users"));
    }
    setLastSync(new Date().toISOString());
    setSyncError("");
  };
  // Ao trocar de tela, carrega os dados próprios dela (painel, planejamento) sem esperar os 15 s.
  useEffect(() => {
    if (
      !boot ||
      boot.offline ||
      boot.user.role === "Equipe de Campo" ||
      fieldMode ||
      loadedFor.current === page
    )
      return;
    loadPageData(boot, page).catch((e) => setSyncError(e.message));
  }, [page, boot?.user.id, fieldMode]); // eslint-disable-line react-hooks/exhaustive-deps -- loadPageData é recriada a cada render
  useEffect(() => {
    refresh()
      .catch(async (e) => {
        if (e.status === 401) {
          await forgetFieldSession().catch(() => {});
          return;
        }
        // Sem servidor em /campo: abre o Campo com a sessão salva neste aparelho, se houver.
        if (unreachable(e) && isFieldPath()) {
          const saved = await savedFieldBoot().catch(() => null);
          if (saved) return setBoot(saved);
        }
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  // Sessão salva em uso: revalida com o servidor quando a rede volta. O bootstrap real substitui o
  // salvo; 401 marca a sessão como expirada (o Campo pausa a fila e pede novo login).
  useEffect(() => {
    if (!boot?.offline || boot.session_expired) return;
    let busy = false;
    const revalidate = () => {
      if (busy || !navigator.onLine || document.visibilityState !== "visible")
        return;
      busy = true;
      refresh()
        .catch((e) => {
          if (e.status === 401)
            setBoot((b) => (b?.offline ? { ...b, session_expired: true } : b));
        })
        .finally(() => {
          busy = false;
        });
    };
    window.addEventListener("online", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    const timer = setInterval(revalidate, 15000);
    return () => {
      window.removeEventListener("online", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
      clearInterval(timer);
    };
  }, [boot?.offline, boot?.session_expired, boot?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh é recriada a cada render
  useEffect(() => {
    if (!boot || boot.user.role === "Equipe de Campo" || fieldMode) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        refresh().catch((e) =>
          setSyncError(
            e.status === 401
              ? "Sua sessão expirou. Entre novamente para continuar."
              : "A atualização falhou. Os dados exibidos podem estar desatualizados.",
          ),
        );
    }, 15000);
    return () => clearInterval(timer);
  }, [boot?.user.id, fieldMode]);
  /** Atualização manual usada pelos botões "Atualizar dados". */
  const manualRefresh = async () => {
    setSyncing(true);
    try {
      await refresh();
    } catch (e: any) {
      setSyncError(e.message);
    } finally {
      setSyncing(false);
    }
  };
  return {
    boot,
    setBoot,
    loading,
    summary,
    planning,
    dashboard,
    users,
    syncError,
    setSyncError,
    lastSync,
    syncing,
    refresh,
    manualRefresh,
  };
}
