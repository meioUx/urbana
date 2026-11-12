import OnboardingEntry from "./onboarding/OnboardingEntry";
import {
  moduleCatalog,
  hasModuleAccess,
  moduleForPath,
  landingModule,
} from "../shared/authorization.mjs";
import { lazyModule } from "./shared/lazyModule";
import { api } from "./shared/api";
import { canAct } from "./shared/access";
import type { Row } from "./shared/types";
import TerritorialView from "./modules/map/TerritorialView";
import { GeoMap } from "./modules/map/LazyGeoMap";
import MapPage from "./modules/map/MapPage";
import Login from "./modules/auth/Login";
import OccurrenceTable from "./modules/occurrences/OccurrenceTable";
import TriageQueue from "./modules/triage/TriageQueue";
import OrdersTable from "./modules/orders/OrdersTable";
import { useFilters } from "./modules/workspace/useFilters";
import { useNavigationState } from "./modules/workspace/useNavigationState";
import {
  forgetFieldSession,
  useWorkspaceData,
  type WorkspaceBoot,
} from "./modules/workspace/useWorkspaceData";
import { useMapRows, usePagedList } from "./modules/workspace/useRecordLists";
import { useOnboardingNavigation } from "./modules/workspace/useOnboardingNavigation";
import { exportCsv } from "./modules/workspace/records";
import { FilterBar, Pagination } from "./modules/workspace/FilterBar";
import {
  AccessNotice,
  OfflineNotice,
  PageHeading,
  Sidebar,
  Topbar,
  navigationItems,
} from "./modules/workspace/Shell";
import WorkspaceModals from "./modules/workspace/WorkspaceModals";
const AdminPage = lazyModule(
  () => import("./modules/administration/AdminPage"),
);
const PlanningPanel = lazyModule(() => import("./PlanningPanel"));
const TeamKanban = lazyModule(() => import("./TeamKanban"));
const OperationsDashboard = lazyModule(() => import("./OperationsDashboard"));
const Operator = lazyModule(() => import("./Operator"));
const SectorControl = lazyModule(() => import("./SectorControl"));
const ReviewPage = lazyModule(() => import("./modules/review/ReviewPage"));
const TeamsPage = lazyModule(() => import("./modules/teams/TeamsPage"));
const MaterialsPage = lazyModule(
  () => import("./modules/catalogs/MaterialsPage"),
);
const EquipmentPage = lazyModule(
  () => import("./modules/catalogs/EquipmentPage"),
);
const WorksPage = lazyModule(() => import("./modules/works/WorksPage"));
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Building2,
  CheckCircle2,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
// Mantém a ordem original da cascata: estes estilos vinham antes de styles.css no CSS de entrada.
import "./dispatch-context.css";
import "./styles.css";

function Workspace({
  onBoot,
}: {
  onBoot: (boot: WorkspaceBoot | null) => void;
}) {
  const { page, setPage, mapOnly, setMapOnly, fieldMode, setFieldMode } =
    useNavigationState();
  const [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [modal, setModal] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [mobile, setMobile] = useState(false),
    [busy, setBusy] = useState(false),
    [adminTab, setAdminTab] = useState("categorias");
  const filters = useFilters();
  const {
    q,
    setQ,
    status,
    setStatus,
    priority,
    setPriority,
    team,
    setTeam,
    deadline,
    setDeadline,
    category,
    setCategory,
    neighborhood,
    setNeighborhood,
    from,
    setFrom,
    to,
    setTo,
  } = filters;
  const {
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
  } = useWorkspaceData({ page, setPage, setError, fieldMode });
  useEffect(() => onBoot(boot), [boot, onBoot]);
  // Título da aba por tela (WCAG 2.4.2). O Campo define o próprio título; o portal, o dele.
  const inField = !!boot && (boot.user.role === "Equipe de Campo" || fieldMode);
  const screenName = navigationItems(canAct(boot, "admin")).find(
    ([key]) => key === page,
  )?.[1];
  useEffect(() => {
    if (inField) return;
    document.title = loading
      ? "Carregando | Urbana"
      : !boot
        ? "Entrar | Urbana"
        : mapOnly
          ? "Mapa territorial em tela cheia | Urbana"
          : `${screenName || "Visão geral"} | Urbana`;
  }, [inField, loading, boot, mapOnly, screenName]);
  useOnboardingNavigation({
    boot,
    filters,
    setMobile,
    setDetail,
    setModal,
    setMapOnly,
    setFieldMode,
    setPage,
    setAdminTab,
  });
  const list = usePagedList({ boot, page, filters, lastSync });
  const { pagedScope, listPage, listKey, listError } = list;
  const { mapRows, mapNeighborhoods } = useMapRows({
    boot,
    page,
    filters,
    lastSync,
    setSyncError,
  });
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const can = (action: string) => canAct(boot, action);
  const catalogs = (kind: string) =>
    boot?.catalogs.filter((c) => c.kind === kind) || [];
  const name = (id: string) =>
    boot?.catalogs.find((c) => c.id === id)?.name || "—";
  const run = async (
    fn: () => Promise<any>,
    message = "Alterações salvas.",
  ) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setToast(message);
      try {
        await refresh();
      } catch {
        setSyncError(
          "A operação foi salva, mas a atualização falhou. Atualize os dados antes de continuar.",
        );
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const openDetail = async (
    type: string,
    id: string,
    initialTab = "overview",
  ) => {
    setError("");
    try {
      setDetail({
        type,
        initialTab,
        ...(await api(
          `/${type === "order" ? "ordens-servico" : "ocorrencias"}/${id}`,
        )),
      });
    } catch (e: any) {
      setError(e.message);
    }
  };
  const changePage = (value: string) => {
    if (value === "field") {
      setFieldMode(true);
      history.replaceState(null, "", "/campo");
      return;
    }
    if (!boot || !hasModuleAccess(boot.user, value)) return;
    history.pushState(
      null,
      "",
      moduleCatalog.find((m) => m.key === value)?.path || "/",
    );
    setPage(value);
    setQ("");
    setStatus("");
    setPriority("");
    setTeam("");
    setDeadline("");
    setCategory("");
    setNeighborhood("");
    setFrom("");
    setTo("");
    setMobile(false);
    setDetail(null);
  };
  const currentPage: Row[] = listPage.key === listKey ? listPage.items : [];
  const filtered: Row[] =
    page === "map"
      ? mapRows
      : pagedScope && page !== "orders"
        ? currentPage
        : [];
  const filteredOrders: Row[] = page === "orders" ? currentPage : [];
  if (loading)
    return (
      <div className="loading">
        <Building2 size={32} />
        <p>Carregando Urbana...</p>
      </div>
    );
  if (!boot)
    return (
      <Login
        error={error}
        onLogin={async (email, password) => {
          await api("/auth/login", "POST", { email, password });
          await refresh();
          setError("");
        }}
      />
    );
  // Sessão de Campo salva (sem servidor): só o Campo funciona; o resto pede conexão.
  if (
    boot.offline &&
    ((boot.user.role !== "Equipe de Campo" && !fieldMode) ||
      !hasModuleAccess(boot.user, "field"))
  )
    return (
      <OfflineNotice
        canField={hasModuleAccess(boot.user, "field")}
        onField={() => {
          setFieldMode(true);
          history.replaceState(null, "", "/campo");
        }}
        onRetry={() =>
          refresh().catch(async (e) => {
            if (e.status === 401) {
              await forgetFieldSession(boot.user.id).catch(() => {});
              setBoot(null);
            }
          })
        }
      />
    );
  const available = moduleCatalog.filter((m) =>
    hasModuleAccess(boot.user, m.key),
  );
  const accessNotice = (message: string) => (
    <AccessNotice
      message={message}
      onMyModules={() => {
        const first = landingModule(boot.user);
        setPage(first || "none");
        setFieldMode(first === "field");
        history.replaceState(
          null,
          "",
          moduleCatalog.find((m) => m.key === first)?.path || "/",
        );
      }}
      onLogout={async () => {
        await forgetFieldSession(boot.user.id).catch(() => {});
        await api("/auth/logout", "POST");
        setBoot(null);
        history.replaceState(null, "", "/");
      }}
    />
  );
  if (!available.length) return accessNotice("Sem módulos disponíveis");
  const requestedModule = moduleForPath(window.location.pathname);
  if (
    window.location.pathname !== "/" &&
    requestedModule &&
    !hasModuleAccess(boot.user, requestedModule)
  )
    return accessNotice("Acesso negado");
  if (fieldMode && !hasModuleAccess(boot.user, "field"))
    return accessNotice("Acesso negado");
  if (
    boot.user.role === "Equipe de Campo" &&
    !hasModuleAccess(boot.user, "field")
  )
    return accessNotice("Sem módulos disponíveis");
  if (boot.user.role === "Equipe de Campo" || fieldMode)
    return (
      <Operator
        key={boot.user.id}
        boot={boot}
        api={api}
        onLogout={async () => {
          await api("/auth/logout", "POST");
          setBoot(null);
          setDetail(null);
          setModal(null);
        }}
        onManagement={() => {
          setFieldMode(false);
          // Sessão salva (sem servidor): a URL fica em /campo para o app reabrir o Campo se recarregar.
          if (!boot.offline) history.replaceState(null, "", "/");
        }}
      />
    );
  const nav = navigationItems(can("admin")).filter(([key]) =>
    hasModuleAccess(boot.user, key),
  );
  if (!hasModuleAccess(boot.user, page)) return accessNotice("Acesso negado");
  const title = nav.find((n) => n[0] === page)?.[1] || "Visão geral";
  const filterBar = (
    <FilterBar
      page={page}
      filters={filters}
      boot={boot}
      neighborhoods={summary?.neighborhoods || []}
      mapNeighborhoods={mapNeighborhoods}
    />
  );
  const enterMap = () => {
    history.pushState(null, "", "/mapa");
    setMapOnly(true);
  };
  const leaveMap = () => {
    history.pushState(null, "", "/");
    setMapOnly(false);
    refresh().catch((e) => setSyncError(e.message));
  };
  if (mapOnly)
    return (
      <TerritorialView
        filters={filterBar}
        activeCount={
          [q, status, priority, category, neighborhood, from, to].filter(
            Boolean,
          ).length
        }
        onClear={() => {
          setQ("");
          setStatus("");
          setPriority("");
          setCategory("");
          setNeighborhood("");
          setFrom("");
          setTo("");
        }}
        onBack={leaveMap}
        error={syncError}
      >
        <GeoMap
          rows={filtered}
          onSelect={(r) => {
            leaveMap();
            openDetail("occurrence", r.id);
          }}
          heatmap
          large
          loadSummary={(id) => api(`/mapa/ocorrencias/${id}/resumo`)}
        />
      </TerritorialView>
    );
  const editCatalog = (kind: string, item?: Row) =>
    setModal({ type: "catalog", kind, item });
  return (
    <div className="app">
      <a
        className="skip-link"
        href="#conteudo"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("conteudo")?.focus();
        }}
      >
        Ir para o conteúdo
      </a>
      <Sidebar
        mobile={mobile}
        nav={nav}
        page={page}
        triageCount={
          summary
            ? (summary.by_status.IDENTIFICADA || 0) +
              (summary.by_status.EM_TRIAGEM || 0)
            : null
        }
        boot={boot}
        onNavigate={changePage}
        onLogout={async () => {
          try {
            // A sessão de Campo salva sai antes do servidor, como no logout do Campo.
            await forgetFieldSession(boot.user.id).catch(() => {});
            await api("/auth/logout", "POST");
            setDetail(null);
            setModal(null);
            setError("");
            setBoot(null);
          } catch (e: any) {
            setError(e.message);
          }
        }}
      />
      {mobile && (
        <div className="mobile-shade" onClick={() => setMobile(false)} />
      )}
      <div className="main">
        <Topbar title={title} onToggleMenu={() => setMobile(!mobile)} />
        <main id="conteudo" tabIndex={-1}>
          <PageHeading
            page={page}
            title={title}
            pagedScope={pagedScope}
            can={can}
            onExport={() =>
              exportCsv(page, page === "orders" ? filteredOrders : filtered)
            }
            onNewOccurrence={() => setModal({ type: "new" })}
            onNewCatalog={(kind) => setModal({ type: "catalog", kind })}
          />
          {error && (
            <div className="notice error" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button
                className="icon"
                title="Dispensar erro"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {syncError && page !== "dashboard" && (
            <div className="notice error" role="alert">
              {syncError}
              <button
                className="text-button"
                disabled={syncing}
                onClick={manualRefresh}
              >
                Atualizar dados
              </button>
            </div>
          )}
          {page === "dashboard" &&
            (dashboard ? (
              <OperationsDashboard
                dashboard={dashboard}
                boot={boot}
                lastSync={lastSync}
                syncError={syncError}
                syncing={syncing}
                onRefresh={manualRefresh}
              />
            ) : syncError ? (
              <div className="notice error" role="alert">
                {syncError}
                <button
                  className="text-button"
                  disabled={syncing}
                  onClick={manualRefresh}
                >
                  Tentar novamente
                </button>
              </div>
            ) : (
              <p className="loading-inline" role="status">
                Carregando indicadores...
              </p>
            ))}
          {["occurrences", "triagem"].includes(page) && (
            <>
              {page === "triagem" && (
                <TriageQueue
                  counts={summary?.by_status || null}
                  status={status}
                  setStatus={setStatus}
                />
              )}
              {filterBar}
              <div className="results-count">
                {filtered.length} ocorrências nesta página
              </div>
              <Pagination list={list} />
              {listError && <p role="alert">{listError}</p>}
              <OccurrenceTable
                data={filtered}
                name={name}
                onOpen={openDetail}
              />
            </>
          )}
          {page === "map" && (
            <MapPage
              filters={filterBar}
              rows={filtered}
              onOpen={openDetail}
              onOpenFullMap={enterMap}
              boot={boot}
              lastSync={lastSync}
              onOpenIntervention={(id) => {
                changePage("works");
                history.replaceState(null, "", `/obras?intervencao=${id}`);
              }}
            />
          )}
          {page === "works" && (
            <WorksPage
              boot={boot}
              lastSync={lastSync}
              canManage={can("works")}
              onOpenRecord={openDetail}
            />
          )}
          {page === "sector-control" && (
            <SectorControl api={api} boot={boot} onOpen={openDetail} />
          )}
          {page === "kanban" && (
            <TeamKanban
              boot={boot}
              can={can}
              onOpen={openDetail}
              api={api}
              lastSync={lastSync}
              onRefresh={refresh}
            />
          )}
          {page === "review" && (
            <ReviewPage lastSync={lastSync} name={name} onOpen={openDetail} />
          )}
          {page === "planning" && !planning && !syncError && (
            <p className="loading-inline" role="status">
              Carregando planejamento...
            </p>
          )}
          {page === "planning" && planning && (
            <PlanningPanel
              planning={planning}
              boot={boot}
              lastSync={lastSync}
              api={api}
              onRefresh={refresh}
              canSchedule={can("schedule")}
              onOpen={openDetail}
              onOrders={() => changePage("orders")}
              onSchedule={(plan: any) => setModal({ type: "plan-order", plan })}
              renderMap={(members: Row[]) => (
                <GeoMap
                  rows={members}
                  onSelect={(r) => openDetail("occurrence", r.id)}
                  point={
                    members.length
                      ? [members[0].lat, members[0].lng]
                      : undefined
                  }
                />
              )}
            />
          )}
          {page === "orders" && (
            <>
              {filterBar}
              <div className="results-count">
                {filteredOrders.length} ordens de serviço nesta página
              </div>
              <Pagination list={list} />
              {listError && <p role="alert">{listError}</p>}
              <OrdersTable
                orders={filteredOrders}
                name={name}
                onOpen={openDetail}
              />
            </>
          )}
          {page === "teams" && (
            <TeamsPage
              teams={catalogs("equipes")}
              lastSync={lastSync}
              canReadOrders={[
                "orders",
                "planning",
                "kanban",
                "review",
                "dashboard",
                "sector-control",
              ].some((m) => hasModuleAccess(boot.user, m))}
              name={name}
              canAdmin={can("admin")}
              onEdit={(t) => editCatalog("equipes", t)}
              onViewOrders={(t) => {
                changePage("orders");
                setQ(t.name);
              }}
            />
          )}
          {page === "materials" && (
            <MaterialsPage
              materials={catalogs("materiais")}
              dashboard={dashboard}
              canSchedule={can("schedule")}
              canAdmin={can("admin")}
              onEdit={(m) => editCatalog("materiais", m)}
            />
          )}
          {page === "equipment" && (
            <EquipmentPage
              equipment={catalogs("equipamentos")}
              canAdmin={can("admin")}
              onEdit={(e) => editCatalog("equipamentos", e)}
            />
          )}
          {page === "admin" && (
            <AdminPage
              boot={boot}
              users={users}
              adminTab={adminTab}
              setAdminTab={setAdminTab}
              name={name}
              onCatalog={editCatalog}
              onUser={(item) => setModal({ type: "user", item })}
              onError={setError}
              onSaveSettings={(data) =>
                run(() => api("/settings", "PATCH", data))
              }
            />
          )}
          <footer className="page-footer">
            <span>Urbana · Gestão de Manutenção Municipal</span>
            <span>
              <ShieldCheck size={13} />
              Histórico e rastreabilidade
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
        </div>
      )}
      <WorkspaceModals
        modal={modal}
        setModal={setModal}
        detail={detail}
        setDetail={setDetail}
        boot={boot}
        lastSync={lastSync}
        can={can}
        refresh={refresh}
        openDetail={openDetail}
        setToast={setToast}
        setError={setError}
        setSyncError={setSyncError}
      />
      {busy && (
        <div className="saving" role="status">
          Salvando...
        </div>
      )}
    </div>
  );
}

function App() {
  const [boot, setBoot] = useState<WorkspaceBoot | null>(null);
  return (
    <>
      <Workspace onBoot={setBoot} />
      {boot && !boot.offline && (
        <OnboardingEntry key={boot.user.id} boot={boot} api={api} />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
