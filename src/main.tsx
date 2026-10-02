import { lazyModule } from "./shared/lazyModule";
import { colors, labels } from "./shared/workflow";
const GeoMap = lazyModule(() => import("./modules/map/GeoMap"));
const AuditPanel = lazyModule(() => import("./modules/administration/AuditPanel"));
const PlanningPanel = lazyModule(() => import("./PlanningPanel"));
const PlanningTeamCapacity = lazyModule(() => import("./PlanningPanel").then(m => ({default:m.PlanningTeamCapacity})));
import WorkflowGuide from "./WorkflowGuide";
import DispatchContext from "./DispatchContext";
const TeamKanban = lazyModule(() => import("./TeamKanban"));
import SidebarNav from "./SidebarNav";
const OperationsDashboard = lazyModule(() => import("./OperationsDashboard"));
const Operator = lazyModule(() => import("./Operator"));
const SectorControl = lazyModule(() => import("./SectorControl"));
const InventoryPanel = lazyModule(() => import("./InventoryPanel"));
const InvoicePanel = lazyModule(() => import("./InvoicePanel"));
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  Filter,
  HardHat,
  Layers3,
  LayoutDashboard,
  LocateFixed,
  LogOut,
  Map as MapIcon,
  MapPin,
  Menu,
  Package,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Truck,
  Users,
  X,
} from "lucide-react";
import "./styles.css";

type Row = { id: string; [key: string]: any };
type Boot = {
  user: Row;
  catalogs: Row[];
  settings: any;
  roles: string[];
  priorities: string[];
  operators: Row[];
  kanban: { revision: number; limits: Record<string, number>; order: Record<string, string[]> };
};
const fmt = (d: string) =>
  d
    ? new Date(d).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const money = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    n,
  );
async function api(path: string, method = "GET", body?: any) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal: controller.signal,
    headers:
      body instanceof FormData
        ? {}
        : body
          ? { "Content-Type": "application/json" }
          : {},
      body:
        body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error(method === "GET" ? "A resposta demorou demais. Tente atualizar novamente." : "O servidor não confirmou a operação a tempo. Confira o registro antes de repetir o envio.");
    throw new Error(method === "GET" ? "Não foi possível comunicar com o servidor. Verifique a conexão e tente novamente." : "A conexão foi interrompida. Confira se a operação foi registrada antes de repetir o envio.");
  } finally {
    window.clearTimeout(timeout);
  }
  const data = await res.json().catch(() => ({ error: "O servidor retornou uma resposta inesperada. Confira o registro e atualize a página." }));
  if (res.ok && data.error) throw new Error(data.error);
  if (!res.ok)
    throw Object.assign(new Error(data.error), {
      status: res.status,
      code: data.code,
      details: data.details,
    });
  return data;
}
function Badge({ status }: { status: string }) {
  return (
    <span
      className="badge"
      style={{
        color: colors[status] || "#555",
        background: `${colors[status] || "#555555"}13`,
      }}
    >
      <i style={{ background: colors[status] }} />
      {labels[status] || status}
    </span>
  );
}
function Priority({ value }: { value: string }) {
  return (
    <span
      className={`priority p-${value === "Emergencial" ? "critical" : value === "Alta" ? "high" : value === "Média" ? "medium" : "low"}`}
    >
      <span /> {value}
    </span>
  );
}
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const fieldId = React.useId();
  return (
    <label className={wide ? "field wide" : "field"}>
      <span id={fieldId}>{label}</span>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<any>, {
            "aria-labelledby": fieldId,
          })
        : children}
    </label>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} title="Fechar">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
function App() {
  const [boot, setBoot] = useState<Boot | null>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("dashboard"),
    [fieldMode, setFieldMode] = useState(window.location.pathname === "/campo"),
    [rows, setRows] = useState<Row[]>([]),
    [orders, setOrders] = useState<Row[]>([]),
    [planning, setPlanning] = useState<any>({ groups: [], plans: [] }),
    [dashboard, setDashboard] = useState<any>(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [modal, setModal] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [priority, setPriority] = useState(""),
    [team, setTeam] = useState(""),
    [deadline, setDeadline] = useState(""),
    [category, setCategory] = useState(""),
    [neighborhood, setNeighborhood] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [mobile, setMobile] = useState(false),
    [busy, setBusy] = useState(false),
    [adminTab, setAdminTab] = useState("categorias"),
    [users, setUsers] = useState<Row[]>([]),
    [audit, setAudit] = useState<Row[]>([]),
    [syncError, setSyncError] = useState(""),
    [lastSync, setLastSync] = useState<string>(""),
    [syncing, setSyncing] = useState(false);
  const pagedScope = ["occurrences", "triagem", "orders"].includes(page);
  const [listPage, setListPage] = useState<any>({items:[],has_more:false,next_cursor:null});
  const [listCursor, setListCursor] = useState("");
  const [listBack, setListBack] = useState<string[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const listKey = JSON.stringify([page,q,status,priority,category,team,deadline,from,to,neighborhood]);
  useEffect(() => {setListCursor("");setListBack([]);},[listKey]);
  useEffect(() => {
    if (!boot || !pagedScope) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setListBusy(true);setListError("");
      const params = new URLSearchParams({limit:"50"});
      for (const [key,value] of Object.entries({q,status:status || (page === "triagem" ? "IDENTIFICADA,EM_TRIAGEM" : ""),priority,category_id:page === "orders" ? "" : category,team_id:page === "orders" ? team : "",deadline:page === "orders" ? deadline : "",from,to,neighborhood,cursor:listCursor})) if(value) params.set(key,value);
      try {const result = await api(`/${page === "orders" ? "ordens-servico" : "ocorrencias"}?${params}`);if(!cancelled)setListPage({...result,key:listKey});} catch(e:any) {if(!cancelled)setListError(e.message);} finally {if(!cancelled)setListBusy(false);}
    },200);
    return () => {cancelled=true;window.clearTimeout(timer);};
  },[boot?.user.id,pagedScope,listKey,listCursor,lastSync]);
  const pageControls = <div className="form-actions" aria-label="Paginação"><button className="button secondary" disabled={listBusy || !listBack.length} onClick={() => {setListCursor(listBack.at(-1) || "");setListBack(listBack.slice(0,-1));}}>Anterior</button><span role="status">Página {listBack.length+1} · {listBusy ? "Atualizando..." : listPage.items.length+" registros"}</span><button className="button secondary" disabled={listBusy || !listPage.has_more} onClick={() => {setListBack([...listBack,listCursor]);setListCursor(listPage.next_cursor);}}>Próxima</button></div>;
  const refresh = async () => {
    const b = await api("/bootstrap");
    if (b.user.role === "Equipe de Campo") {
      setBoot(b);
      return;
    }
    const [r, o, d, p] = await Promise.all([
      api("/ocorrencias"),
      api("/ordens-servico"),
      api("/dashboard"),
      api("/planejamento"),
    ]);
    setBoot(b);
    setRows(r);
    setOrders(o);
    setDashboard(d);
    setPlanning(p);
    if (b.user.role === "Administrador") {
      setUsers(await api("/users"));
    }
    setLastSync(new Date().toISOString());
    setSyncError("");
  };
  useEffect(() => {
    refresh()
      .catch((e) => {
        if (e.status !== 401) setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!boot || boot.user.role === "Equipe de Campo" || fieldMode) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh().catch((e) => setSyncError(e.status === 401 ? "Sua sessão expirou. Entre novamente para continuar." : "A atualização falhou. Os dados exibidos podem estar desatualizados."));
    }, 15000);
    return () => clearInterval(timer);
  }, [boot?.user.id, fieldMode]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const can = (action: string) =>
    !!boot &&
    (
      {
        create: [
          "Administrador",
          "Gestor",
          "Triagem",
          "Fiscalização",
          "Equipe de Campo",
        ],
        classify: ["Administrador", "Gestor", "Triagem"],
        schedule: ["Administrador", "Gestor"],
        execute: ["Administrador", "Gestor", "Equipe de Campo"],
        validate: ["Administrador", "Gestor", "Fiscalização"],
        admin: ["Administrador"],
      } as Record<string, string[]>
    )[action].includes(boot.user.role);
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
      try { await refresh(); } catch { setSyncError("A operação foi salva, mas a atualização falhou. Atualize os dados antes de continuar."); }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const openDetail = async (type: string, id: string, initialTab = "overview") => {
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
  const filtered: Row[] = pagedScope && page !== "orders" ? (listPage.key === listKey ? listPage.items : []) : rows.filter(
    (r) =>
      (!q ||
        [r.code, r.address, r.neighborhood, r.description].some((x) =>
          x?.toLowerCase().includes(q.toLowerCase()),
        )) &&
      (!status || r.status === status) &&
      (!priority || r.priority === priority) &&
      (!category || r.category_id === category) &&
      (!neighborhood || r.neighborhood === neighborhood) &&
      (!from || r.created_at.slice(0, 10) >= from) &&
      (!to || r.created_at.slice(0, 10) <= to) &&
      (page !== "triagem" || ["IDENTIFICADA", "EM_TRIAGEM"].includes(r.status)),
  );
  const filteredOrders: Row[] = page === "orders" ? (listPage.key === listKey ? listPage.items : []) : orders.filter(
    (r) =>
      (!q ||
        [r.code, name(r.team_id), r.responsible].some((x) =>
          x?.toLowerCase().includes(q.toLowerCase()),
        )) &&
      (!status || r.status === status) &&
      (!priority || r.priority === priority) &&
      (!team || r.team_id === team) &&
      (!deadline ||
        (() => {
          if (["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(r.status)) return false;
          const remaining = Date.parse(r.due_at) - Date.now();
          if (deadline === "late") return remaining < 0;
          if (deadline === "soon")
            return remaining >= 0 && remaining <= 86400000;
          return remaining > 86400000;
        })()) &&
      (!from || r.created_at.slice(0, 10) >= from) &&
      (!to || r.created_at.slice(0, 10) <= to),
  );
  const exportCsv = () => {
    const data = page === "orders" ? filteredOrders : filtered;
    const columns =
      page === "orders"
        ? ["code", "status", "priority", "due_at", "responsible"]
        : [
            "code",
            "address",
            "neighborhood",
            "status",
            "priority",
            "lat",
            "lng",
          ];
    const cell = (v: any) =>
      `"${String(v ?? "")
        .replace(/^[=+@\-]/, "'$&")
        .replace(/"/g, '""')}"`;
    const blob = new Blob(
      [
        "\ufeff" +
          [
            columns.join(";"),
            ...data.map((r) => columns.map((k) => cell(r[k])).join(";")),
          ].join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8;" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `urbana-${page}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
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
  if (boot.user.role === "Equipe de Campo" || fieldMode)
    return (
      <Operator
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
          history.replaceState(null, "", "/");
        }}
      />
    );
  const nav: [string, string, typeof MapIcon][] = [
    ["dashboard", "Visão geral", LayoutDashboard],
    ["map", "Mapa territorial", MapIcon],
    ["occurrences", "Ocorrências", MapPin],
    ["triagem", "Triagem", Filter],
    ["kanban", "Kanban de equipes", Layers3],
    ["planning", "Planejamento", Layers3],
    ["orders", "Ordens de serviço", ClipboardList],
    ["sector-control", "Controle do setor", FileText],
    ["review", "Análise de campo", ShieldCheck],
    ["field", "Operação de campo", HardHat],
    ["teams", "Equipes", Users],
    ["materials", "Materiais", Package],
    ["equipment", "Equipamentos", Truck],
    ...(can("admin")
      ? [
          ["admin", "Administração", Settings2] as [
            string,
            string,
            typeof MapIcon,
          ],
        ]
      : []),
  ];
  const title = nav.find((n) => n[0] === page)?.[1] || "Visão geral";
  const filters = (
    <div className="filters">
      <div className="search">
        <Search size={17} />
        <input
          aria-label="Buscar registros"
          placeholder={
            page === "orders"
              ? "Buscar por código, equipe ou responsável..."
              : "Buscar por endereço, bairro ou código..."
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <select
        aria-label="Filtrar status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">Todos os status</option>
        {Object.entries(labels).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <select
        aria-label="Filtrar prioridade"
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
      >
        <option value="">Todas as prioridades</option>
        {boot.priorities.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      {page !== "orders" && (
        <select
          aria-label="Filtrar categoria"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Todas as categorias</option>
          {catalogs("categorias").map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {page === "orders" && (
        <>
          <select
            aria-label="Filtrar equipe"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">Todas as equipes</option>
            {catalogs("equipes").map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar prazo"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          >
            <option value="">Todos os prazos</option>
            <option value="late">Atrasadas</option>
            <option value="soon">Vencem em até 24 horas</option>
            <option value="ontime">Prazo acima de 24 horas</option>
          </select>
        </>
      )}
      {page === "map" && (
        <select
          aria-label="Filtrar bairro"
          value={neighborhood}
          onChange={(e) => setNeighborhood(e.target.value)}
        >
          <option value="">Todos os bairros</option>
          {[...new Set(rows.map((r) => r.neighborhood))].sort().map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      )}
      <input
        type="date"
        title="Data inicial"
        aria-label="Data inicial"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />
      <input
        type="date"
        title="Data final"
        aria-label="Data final"
        value={to}
        min={from}
        onChange={(e) => setTo(e.target.value)}
      />
      {(q ||
        status ||
        priority ||
        team ||
        deadline ||
        category ||
        from ||
        to ||
        neighborhood) && (
        <button
          className="icon"
          title="Limpar filtros"
          onClick={() => {
            setQ("");
            setStatus("");
            setPriority("");
            setTeam("");
            setDeadline("");
            setCategory("");
            setFrom("");
            setTo("");
            setNeighborhood("");
          }}
        >
          <X size={17} />
        </button>
      )}
    </div>
  );
  const occurrenceTable = (data: Row[], compact = false) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Ocorrência / localização</th>
            {!compact && <th>Categoria</th>}
            <th>Prioridade</th>
            <th>Status</th>
            {!compact && <th>Identificação</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr
              key={r.id}
              onClick={() => openDetail("occurrence", r.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail("occurrence", r.id); }
              }}
            >
              <td>
                <strong>{r.address}</strong>
                <small>
                  {r.code} <span>·</span> {r.neighborhood}
                  {r.recurrence ? " · Reincidência" : ""}
                </small>
              </td>
              {!compact && (
                <td>
                  {name(r.category_id)}
                  <small>{r.subcategory}</small>
                </td>
              )}
              <td>
                <Priority value={r.priority} />
              </td>
              <td>
                <Badge status={r.status} />
              </td>
              {!compact && <td className="muted">{fmt(r.created_at)}</td>}
              <td>
                <ChevronRight size={16} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.length && <Empty text="Nenhuma ocorrência encontrada." />}
    </div>
  );
  return (
    <div className="app">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            changePage("dashboard");
          }}
        >
          <span className="brand-icon">
            <Building2 size={26} />
          </span>
          <span>
            urbana<small>GESTÃO MUNICIPAL</small>
          </span>
        </a>
        <p className="nav-caption">ÁREA DE TRABALHO</p>
        <SidebarNav nav={nav} page={page} rows={rows} onNavigate={changePage}/>
        <div className="sidebar-bottom">
          <div className="connection">
            <span />
            {boot.settings.demo
              ? "Ambiente demonstrativo"
              : "Ambiente municipal"}
          </div>
          <button
            className="profile"
            onClick={async () => {
              try {
                await api("/auth/logout", "POST");
                setDetail(null);
                setModal(null);
                setError("");
                setBoot(null);
              } catch (e: any) {
                setError(e.message);
              }
            }}
            title="Sair da conta"
          >
            <span className="avatar">
              {boot.user.name
                .split(" ")
                .map((x: string) => x[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span>
              <strong>{boot.user.name}</strong>
              <small>{boot.user.role}</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {mobile && (
        <div className="mobile-shade" onClick={() => setMobile(false)} />
      )}
      <div className="main">
        <header className="topbar">
          <div>
            <button
              className="icon mobile-toggle"
              title="Abrir menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={22} />
            </button>
            <strong>{title}</strong>
          </div>
          <div className="top-meta">
            <span className="live-dot" />
            Operação municipal
            <span className="divider" />
            <span>
              {new Date().toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
        </header>
        <main>
          <div className={`page-heading ${page === "kanban" ? "kanban-heading" : ""}`}>
            <div>
              <p className="eyebrow">
                {page === "dashboard"
                  ? "PAINEL OPERACIONAL"
                  : "GESTÃO DE MANUTENÇÃO"}
              </p>
              <h1>{title}</h1>
              <p className="subtitle">
                {page === "dashboard"
                  ? "Acompanhe o território e as frentes de trabalho."
                  : page === "map"
                    ? "Ocorrências e serviços no território municipal."
                    : page === "kanban"
                      ? "Organize o fluxo e acompanhe as entregas das equipes."
                    : page === "planning"
                      ? "Compare intervenções, escolha o escopo e programe as equipes."
                    : page === "orders"
                      ? "Programação, execução e validação dos serviços."
                      : page === "triagem"
                        ? "Análise e encaminhamento das demandas recebidas."
                        : page === "admin"
                          ? "Estrutura, regras de atendimento e acesso."
                          : page === "teams"
                            ? "Equipes e distribuição das frentes de trabalho."
                            : page === "materials"
                              ? "Estoque, consumo e cadastro de materiais."
                            : page === "equipment"
                              ? "Equipamentos disponíveis para as frentes de trabalho."
                              : "Registro e acompanhamento das demandas urbanas."}
              </p>
            </div>
            <div className="heading-actions">
              {["occurrences", "orders", "map"].includes(page) && (
                <button className="button secondary" onClick={exportCsv}>
                  <ArrowDownToLine size={16} />
                  {pagedScope ? "Exportar página" : "Exportar"}
                </button>
              )}
              {can("create") &&
                ["map", "occurrences", "triagem", "kanban"].includes(
                  page,
                ) && (
                  <button
                    className="button primary"
                    onClick={() => setModal({ type: "new" })}
                  >
                    <Plus size={18} />
                    Nova ocorrência
                  </button>
                )}
              {can("admin") && ["teams", "materials", "equipment"].includes(page) && (
                <button
                  className="button primary"
                  onClick={() =>
                    setModal({
                      type: "catalog",
                      kind: page === "teams" ? "equipes" : page === "equipment" ? "equipamentos" : "materiais",
                    })
                  }
                >
                  <Plus size={18} />
                  Novo cadastro
                </button>
              )}
            </div>
          </div>
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
          {syncError && page !== "dashboard" && <div className="notice error" role="alert">{syncError}<button className="text-button" disabled={syncing} onClick={async () => { setSyncing(true); try { await refresh(); } catch (e: any) { setSyncError(e.message); } finally { setSyncing(false); } }}>Atualizar dados</button></div>}
          {page === "dashboard" && dashboard && <OperationsDashboard rows={rows} orders={orders} boot={boot} lastSync={lastSync} syncError={syncError} syncing={syncing} onRefresh={async () => { setSyncing(true); try { await refresh(); } catch (e: any) { setSyncError(e.message); } finally { setSyncing(false); } }} />}
          {["occurrences", "triagem"].includes(page) && (
            <>
              {page === "triagem" && <section className="demand-queue" aria-label="Filas de triagem"><p>Analise a demanda e depois escolha quando atender. Planejamento é opcional para comparar obras e agrupar demandas da mesma via.</p><div className="form-actions">{[["IDENTIFICADA", "A analisar"], ["EM_TRIAGEM", "Prontas para programar"], ["", "Todas da triagem"]].map(([value, title]) => <button key={value} type="button" className={`button ${status === value ? "primary" : "secondary"}`} aria-pressed={status === value} onClick={() => setStatus(value)}>{title} ({rows.filter(r => value ? r.status === value : ["IDENTIFICADA", "EM_TRIAGEM"].includes(r.status)).length})</button>)}</div></section>}
              {filters}
              <div className="results-count">{filtered.length} ocorrências nesta página</div>
              {pageControls}
              {listError && <p role="alert">{listError}</p>}
              {occurrenceTable(filtered)}
            </>
          )}
          {page === "map" && (
            <>
              {filters}
              <div className="map-layout">
                <div>
                  <GeoMap
                    rows={filtered}

                    heatmap
                    onSelect={(r) => openDetail("occurrence", r.id)}
                    large
                  />
                  <div className="legend">
                    {Object.entries(labels).map(([s, l]) => (
                      <span key={s}>
                        <i style={{ background: colors[s] }} />
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
                <section className="map-results">
                  <div className="section-heading">
                    <h2>No mapa</h2>
                    <span>{filtered.length}</span>
                  </div>
                  {filtered.map((r) => (
                    <button
                      className="map-result"
                      key={r.id}
                      onClick={() => openDetail("occurrence", r.id)}
                    >
                      <strong>{r.address}</strong>
                      <small>
                        {r.code} · {r.neighborhood}
                      </small>
                      <Badge status={r.status} />
                    </button>
                  ))}
                  {!filtered.length && (
                    <Empty text="Nenhum registro para os filtros." />
                  )}
                </section>
              </div>
            </>
          )}
          {page === "sector-control" && (
            <SectorControl api={api} boot={boot} onOpen={openDetail} />
          )}
          {page === "kanban" && <TeamKanban rows={rows} orders={orders} boot={boot} can={can} onOpen={openDetail} api={api} onRefresh={refresh} />}
          {page === "review" && (
            <div className="planning-page">
              <div className="notice">
                <ShieldCheck />
                <span>
                  Confira o relato, as fotos antes/depois e os materiais. Aprove
                  o serviço, solicite correção ou reprograme uma devolução.
                </span>
              </div>
              <div className="team-grid">
                {orders
                  .filter((o) =>
                    ["AGUARDANDO_VALIDACAO", "DEVOLVIDA"].includes(o.status),
                  )
                  .map((o) => (
                    <article className="team-card" key={o.id}>
                      <Badge status={o.status} />
                      <h2>{o.code}</h2>
                      <p>
                        {name(o.team_id)} · {o.responsible}
                      </p>
                      <p>
                        {o.status === "DEVOLVIDA"
                          ? o.return_reason
                          : o.completion_notes}
                      </p>
                      <small>{fmt(o.returned_at || o.finished_at)}</small>
                      <button
                        className="button primary"
                        onClick={() => openDetail("order", o.id)}
                      >
                        Analisar ordem
                      </button>
                    </article>
                  ))}
              </div>
              {!orders.some((o) =>
                ["AGUARDANDO_VALIDACAO", "DEVOLVIDA"].includes(o.status),
              ) && <Empty text="Nenhum serviço aguardando análise." />}
            </div>
          )}
          {page === "planning" && (
            <PlanningPanel
              planning={planning}
              boot={boot}
              orders={orders}
              api={api}
              onRefresh={refresh}
              canSchedule={can("schedule")}
              onOpen={openDetail}
              onOrders={() => changePage("orders")}
              onSchedule={(plan: any) => setModal({ type: "plan-order", plan })}
              renderMap={(members: Row[]) => <GeoMap rows={members} onSelect={r => openDetail("occurrence", r.id)} point={members.length ? [members[0].lat, members[0].lng] : undefined} />}
            />
          )}
          {page === "orders" && (
            <>
              {filters}
              <div className="results-count">
                {filteredOrders.length} ordens de serviço nesta página
              </div>
              {pageControls}
              {listError && <p role="alert">{listError}</p>}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Ordem de serviço</th>
                      <th>Equipe responsável</th>
                      <th>Prioridade</th>
                      <th>Status</th>
                      <th>Prazo / SLA</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((o) => (
                      <tr
                        key={o.id}
                        onClick={() => openDetail("order", o.id)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail("order", o.id); }
                        }}
                      >
                        <td>
                          <strong>{o.code}</strong>
                          <small>{name(o.sector_id)}</small>
                        </td>
                        <td>
                          {name(o.team_id)}
                          <small>{o.responsible}</small>
                        </td>
                        <td>
                          <Priority value={o.priority} />
                        </td>
                        <td>
                          <Badge status={o.status} />
                        </td>
                        <td>
                          <Sla order={o} />
                        </td>
                        <td>
                          <ChevronRight size={16} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredOrders.length && (
                  <Empty text="Nenhuma ordem de serviço encontrada." />
                )}
              </div>
            </>
          )}
          {page === "teams" && (
            <div className="team-grid">
              {catalogs("equipes").map((t) => (
                <article className="team-card" key={t.id}>
                  <div className="section-heading">
                    <span className="team-icon">
                      <Users size={23} />
                    </span>
                    {can("admin") && (
                      <button
                        className="icon"
                        title={`Editar ${t.name}`}
                        onClick={() =>
                          setModal({
                            type: "catalog",
                            kind: "equipes",
                            item: t,
                          })
                        }
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                  </div>
                  <h2>{t.name}</h2>
                  <p>{name(t.sector_id)}</p>
                  <div className="team-leader">
                    <span className="avatar">
                      {t.leader?.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <strong>{t.leader}</strong>
                      <small>Responsável · {t.members} integrantes</small>
                    </div>
                  </div>
                  <div className="team-stats">
                    <span>
                      <strong>
                        {
                          orders.filter(
                            (o) =>
                              o.team_id === t.id &&
                              !["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(o.status),
                          ).length
                        }
                      </strong>
                      Ordens ativas
                    </span>
                    <span>
                      <strong>
                        {
                          orders.filter(
                            (o) =>
                              o.team_id === t.id && o.status === "CONCLUIDA",
                          ).length
                        }
                      </strong>
                      Concluídas
                    </span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => {
                      changePage("orders");
                      setQ(t.name);
                    }}
                  >
                    Ver ordens
                    <ArrowRight size={16} />
                  </button>
                </article>
              ))}
            </div>
          )}
          {page === "materials" && (
            <>
              {can("schedule") && <InventoryPanel api={api} catalogs={catalogs("materiais")} />}
              <div className="section-heading recent"><h2>Cadastros de apoio</h2></div>
              <div className="section-heading">
                <h2>Materiais</h2>
                <span>{catalogs("materiais").length} itens</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Unidade</th>
                      <th>Custo unitário</th>
                      <th>Consumo total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {catalogs("materiais").map((m) => (
                      <tr key={m.id}>
                        <td>
                          <strong>{m.name}</strong>
                        </td>
                        <td>{m.unit}</td>
                        <td>{money(m.unit_cost)}</td>
                        <td>
                          {dashboard?.materials
                            .filter((x: any) => x.material_id === m.id)
                            .reduce(
                              (s: number, x: any) => s + x.quantity,
                              0,
                            )}{" "}
                          {m.unit}
                        </td>
                        <td>
                          {can("admin") && (
                            <button
                              className="icon"
                              title={`Editar ${m.name}`}
                              onClick={() =>
                                setModal({
                                  type: "catalog",
                                  kind: "materiais",
                                  item: m,
                                })
                              }
                            >
                              <Pencil size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {page === "equipment" && (
            <>
              <div className="section-heading recent">
                <h2>Equipamentos</h2>
              </div>
              <div className="equipment-list">
                {catalogs("equipamentos").map((e) => (
                  <div key={e.id}>
                    <Truck size={23} />
                    <span>
                      <strong>{e.name}</strong>
                      <small>{e.code}</small>
                    </span>
                    {can("admin") && (
                      <button
                        className="icon"
                        title={`Editar ${e.name}`}
                        onClick={() =>
                          setModal({
                            type: "catalog",
                            kind: "equipamentos",
                            item: e,
                          })
                        }
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {page === "admin" && (
            <>
              <div className="tabs">
                {[
                  ["categorias", "Categorias e SLA"],
                  ["secretarias", "Secretarias"],
                  ["departamentos", "Departamentos"],
                  ["setores", "Setores"],
                  ["users", "Usuários"],
                  ["settings", "Configurações"],
                  ["audit", "Auditoria"],
                ].map(([k, l]) => (
                  <button
                    key={k}
                    className={adminTab === k ? "selected" : ""}
                    onClick={() => setAdminTab(k)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {[
                "categorias",
                "secretarias",
                "departamentos",
                "setores",
              ].includes(adminTab) && (
                <>
                  <div className="section-heading">
                    <h2>
                      {adminTab === "categorias"
                        ? "Categorias de manutenção"
                        : "Estrutura administrativa"}
                    </h2>
                    <button
                      className="button primary"
                      onClick={() =>
                        setModal({ type: "catalog", kind: adminTab })
                      }
                    >
                      <Plus size={16} />
                      Adicionar
                    </button>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Nome</th>
                          <th>
                            {adminTab === "categorias"
                              ? "Subcategorias"
                              : "Vínculo"}
                          </th>
                          {adminTab === "categorias" && (
                            <th>SLA emergencial</th>
                          )}
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {catalogs(adminTab).map((c) => (
                          <tr key={c.id}>
                            <td>
                              <strong>{c.name}</strong>
                            </td>
                            <td>
                              {c.subcategories?.join(", ") || name(c.parent_id)}
                            </td>
                            {adminTab === "categorias" && (
                              <td>{c.sla.Emergencial} horas</td>
                            )}
                            <td>
                              <button
                                className="icon"
                                title={`Editar ${c.name}`}
                                onClick={() =>
                                  setModal({
                                    type: "catalog",
                                    kind: adminTab,
                                    item: c,
                                  })
                                }
                              >
                                <Pencil size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {adminTab === "users" && (
                <>
                  <div className="section-heading">
                    <h2>Usuários e permissões</h2>
                    <button
                      className="button primary"
                      onClick={() => setModal({ type: "user" })}
                    >
                      <Plus size={16} />
                      Novo usuário
                    </button>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Nome</th>
                          <th>E-mail</th>
                          <th>Perfil</th>
                          <th>Equipe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.id}>
                            <td>{u.name}</td>
                            <td>{u.email}</td>
                            <td>{u.role}</td>
                            <td>{name(u.team_id)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {adminTab === "settings" && (
                <SettingsForm
                  boot={boot}
                  save={(data) => run(() => api("/settings", "PATCH", data))}
                />
              )}{" "}
              {adminTab === "audit" && <AuditPanel api={api} />}
            </>
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
      {modal?.type === "plan-order" && (
        <PlanOrderForm
          plan={modal.plan}
          boot={boot}
          orders={orders}
          onClose={() => setModal(null)}
          onSave={async (data: any) => {
            await api("/ordens-servico", "POST", data);
            setModal(null);
            setToast("Ordem de serviço vinculada ao plano.");
            try { await refresh(); } catch { setSyncError("A ordem foi salva, mas não foi possível atualizar o planejamento. Atualize os dados antes de continuar."); }
          }}
        />
      )}
      {modal?.type === "new" && (
        <NewOccurrence
          boot={boot}
          rows={rows}
          onClose={() => setModal(null)}
          onSave={async (data, file) => {
            const result = await api("/ocorrencias", "POST", data);
            if (file) {
              try {
                const fd = new FormData();
                fd.append("file", file);
                fd.append("stage", "registro");
                fd.append("lat", String(result.lat));
                fd.append("lng", String(result.lng));
                await api(`/ocorrencias/${result.id}/anexos`, "POST", fd);
              } catch (e: any) {
                setError(
                  `Ocorrência ${result.code} criada, mas a foto falhou: ${e.message}. Anexe novamente no detalhe.`,
                );
              }
            }
            setModal(null);
            setToast(
              result.linked
                ? "Solicitação vinculada."
                : "Ocorrência registrada.",
            );
            try { await refresh(); } catch { setSyncError("A ocorrência foi registrada, mas a atualização falhou. Atualize os dados antes de continuar."); }
            await openDetail("occurrence", result.id);
          }}
        />
      )}
      {modal?.type === "catalog" && (
        <CatalogForm
          kind={modal.kind}
          item={modal.item}
          boot={boot}
          onClose={() => setModal(null)}
          onSave={async (data: any) => {
            await api(
              `/${modal.kind}${modal.item ? "/" + modal.item.id : ""}`,
              modal.item ? "PATCH" : "POST",
              data,
            );
            await refresh();
            setModal(null);
            setToast("Cadastro salvo.");
          }}
        />
      )}
      {modal?.type === "user" && (
        <UserForm
          boot={boot}
          onClose={() => setModal(null)}
          onSave={async (data: any) => {
            await api("/users", "POST", data);
            await refresh();
            setModal(null);
            setToast("Usuário criado.");
          }}
        />
      )}
      {detail && (
        <Detail
          key={detail.id}
          value={detail}
          boot={boot}
          can={can}
          onClose={() => setDetail(null)}
          onOpen={openDetail}
          onChange={async () => {
            const updated = await api(`/${detail.type === "order" ? "ordens-servico" : "ocorrencias"}/${detail.id}`);
            setDetail({ type: detail.type, ...updated });
            await refresh();
          }}
        />
      )}
      {busy && (
        <div className="saving" role="status">
          Salvando...
        </div>
      )}
    </div>
  );
}
function PlanOrderForm({ plan, boot, orders, onClose, onSave }: any) {
  const eligible = plan.occurrences.filter(
    (o: any) => o.status === "EM_TRIAGEM" && !o.order_ids?.length,
  );
  const [sector, setSector] = useState(eligible[0]?.sector_id || ""),
    [team, setTeam] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const members = eligible
    .filter((o: any) => o.sector_id === sector)
    .slice(0, 100);
  const teams = boot.catalogs.filter(
    (c: any) => c.kind === "equipes" && c.sector_id === sector,
  );
  const [date, setDate] = useState(plan.scheduled_at || "");
  return (
    <Modal title="Programar ordem do plano" onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await onSave({
              plan_id: plan.id,
              occurrence_ids: members.map((o: any) => o.id),
              team_id: team,
              responsible: form.get("responsible"),
              scheduled_at: form.get("scheduled_at"),
              notes: plan.objective,
            });
          } catch (err: any) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {plan.code} · {plan.street}
        </p>
        <p>
          A OS reúne as ocorrências em triagem do setor selecionado. O prazo de
          SLA continua contando desde a identificação.
        </p>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <Field label="Setor do plano">
          <select
            aria-label="Setor do plano"
            value={sector}
            onChange={(e) => {
              setSector(e.target.value);
              setTeam("");
            }}
          >
            {[...new Set<string>(eligible.map((o: any) => o.sector_id))].map(
              (id) => (
                <option key={id} value={id}>
                  {boot.catalogs.find((c: any) => c.id === id)?.name}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="Equipe do plano">
          <select
            aria-label="Equipe do plano"
            required
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">Selecione uma equipe</option>
            {teams.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <PlanningTeamCapacity boot={boot} orders={orders} sectorId={sector} selectedTeam={team} date={date} onChoose={(t: any) => setTeam(t.id)} />
        <div className="form-grid">
          <Field label="Responsável pela ordem">
            <input
              name="responsible"
              required
              defaultValue={plan.responsible}
            />
          </Field>
          <Field label="Data da ordem">
            <input
              name="scheduled_at"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </div>
        <p>{members.length} ocorrências nesta ordem:</p>
        <ul>
          {members.map((o: any) => (
            <li key={o.id}>
              {o.code} · {o.address}
            </li>
          ))}
        </ul>
        <button
          className="button primary"
          disabled={busy || !team || !members.length}
        >
          {busy ? "Programando..." : "Confirmar programação"}
        </button>
      </form>
    </Modal>
  );
}

function Assignment({ order, boot, onSave, busy }: any) {
  const [team, setTeam] = useState(order.team_id),
    [operator, setOperator] = useState(order.assigned_user_id || "");
  const [date, setDate] = useState(order.scheduled_at || "");
  return (
    <details className="assignment-form">
      <summary>
        {order.status === "DEVOLVIDA"
          ? "Reprogramar serviço devolvido"
          : "Distribuir para equipe ou operador"}
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          onSave({
            team_id: team,
            assigned_user_id: operator || null,
            responsible: d.get("responsible"),
            scheduled_at: d.get("scheduled_at"),
            notes: d.get("notes"),
          });
        }}
      >
        <DispatchContext boot={boot} api={api} sectorId={order.sector_id} selectedTeam={team} scheduledAt={date} excludeOrderId={order.id} onChoose={(t: any) => { setTeam(t.id); setOperator(""); }} />
        <div className="form-grid">
          <Field label="Equipe da programação">
            <select
              aria-label="Equipe da programação"
              value={team}
              onChange={(e) => {
                setTeam(e.target.value);
                setOperator("");
              }}
            >
              {boot.catalogs
                .filter(
                  (c: any) =>
                    c.kind === "equipes" && c.sector_id === order.sector_id,
                )
                .map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Operador da programação">
            <select
              aria-label="Operador da programação"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
            >
              <option value="">Toda a equipe</option>
              {boot.operators
                .filter((u: any) => u.team_id === team)
                .map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Responsável pela programação">
            <input
              name="responsible"
              required
              defaultValue={order.responsible}
            />
          </Field>
          <Field label="Data da programação">
            <input
              type="date"
              name="scheduled_at"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Instruções para o operador" wide>
            <textarea
              name="notes"
              maxLength={3000}
              defaultValue={order.notes}
            />
          </Field>
        </div>
        <button className="button primary" disabled={busy}>
          Salvar distribuição
        </button>
      </form>
    </details>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <ClipboardList size={28} />
      <p>{text}</p>
    </div>
  );
}
function Sla({ order: o }: { order: Row }) {
  const end = o.completed_at ? Date.parse(o.completed_at) : Date.now(),
    hours = Math.ceil((Date.parse(o.due_at) - end) / 3600000),
    closed = ["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(o.status);
  return (
    <div className={`sla ${hours < 0 && !closed ? "late" : ""}`}>
      <span>
        {closed
          ? labels[o.status]
          : hours < 0
            ? `${Math.abs(hours)}h em atraso`
            : `${hours}h restantes`}
      </span>
      <small>{fmt(o.due_at)}</small>
    </div>
  );
}
function Login({
  onLogin,
  error: outer,
}: {
  onLogin: (e: string, p: string) => Promise<void>;
  error: string;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <div className="login-content">
        <a className="brand">
          <span className="brand-icon">
            <Building2 size={29} />
          </span>
          <span>
            urbana<small>GESTÃO MUNICIPAL</small>
          </span>
        </a>
        <div className="login-form">
          <p className="eyebrow">MANUTENÇÃO URBANA</p>
          <h1>Acesso à plataforma</h1>
          <p className="subtitle">Entre com sua conta municipal.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await onLogin(email, password);
              } catch (err: any) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="E-mail">
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.nome@municipio.gov.br"
              />
            </Field>
            <Field label="Senha">
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {(error || outer) && (
              <p className="form-error" role="alert">
                {error || outer}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Entrando..." : "Entrar"}
              <ArrowRight size={18} />
            </button>
          </form>
        </div>
        <small className="muted">
          Plataforma Municipal de Gestão de Manutenção Urbana
        </small>
      </div>
      <div className="login-map">
        <GeoMap rows={[]} large />
        <div className="login-caption">
          <span className="eyebrow">TERRITÓRIO CONECTADO</span>
          <h2>
            Cuidado com a cidade.
            <br />
            Do registro à resolução.
          </h2>
        </div>
      </div>
    </div>
  );
}

function NewOccurrence({
  boot,
  rows,
  onClose,
  onSave,
}: {
  boot: Boot;
  rows: Row[];
  onClose: () => void;
  onSave: (d: any, f: File | null) => Promise<void>;
}) {
  const cats = boot.catalogs.filter((c) => c.kind === "categorias");
  const [data, setData] = useState<any>({
    category_id: cats[0]?.id || "",
    subcategory: cats[0]?.subcategories[0] || "",
    description: "",
    priority: "Média",
    origin: "Fiscalização municipal",
    requested_by: "",
    phone: "",
    address: "",
    neighborhood: "",
    reference: "",
    lat: -26.992,
    lng: -48.635,
  });
  const [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [nearby, setNearby] = useState<Row[]>([]),
    [locating, setLocating] = useState(false);
  const set = (k: string, v: any) => setData((d: any) => ({ ...d, [k]: v }));
  const choosePoint = async (lat: number, lng: number) => {
    setData((d: any) => ({
      ...d,
      lat,
      lng,
      duplicate_action: undefined,
      duplicate_id: undefined,
    }));
    setNearby([]);
  };
  const gps = () => {
    setLocating(true);
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(
          (p) => {
            choosePoint(p.coords.latitude, p.coords.longitude);
            setLocating(false);
          },
          () => {
            setError(
              "Não foi possível obter o GPS. Selecione o ponto no mapa ou informe as coordenadas.",
            );
            setLocating(false);
          },
          { enableHighAccuracy: true, timeout: 10000 },
        )
      : (setError("GPS indisponível."), setLocating(false));
  };
  return (
    <Modal title="Nova ocorrência" onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            await onSave(data, file);
          } catch (err: any) {
            setError(err.message);
            if (err.status === 409) setNearby(err.details?.nearby || []);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-section-title">
          <MapPin size={18} />
          <h3>Localização</h3>
          <button
            type="button"
            className="text-button"
            disabled={locating}
            onClick={gps}
          >
            <LocateFixed size={16} />
            {locating ? "Localizando..." : "Usar meu GPS"}
          </button>
        </div>

        <GeoMap rows={rows} pick={choosePoint} point={[data.lat, data.lng]} />
        <div className="form-grid">
          <Field label="Latitude">
            <input
              type="number"
              step="any"
              min="-90"
              max="90"
              required
              value={data.lat}
              onChange={(e) => choosePoint(Number(e.target.value), data.lng)}
            />
          </Field>
          <Field label="Longitude">
            <input
              type="number"
              step="any"
              min="-180"
              max="180"
              required
              value={data.lng}
              onChange={(e) => choosePoint(data.lat, Number(e.target.value))}
            />
          </Field>
          <Field label="Endereço">
            <input
              required
              value={data.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
          <Field label="Bairro">
            <input
              required
              value={data.neighborhood}
              onChange={(e) => set("neighborhood", e.target.value)}
            />
          </Field>
        </div>
        <div className="form-section-title">
          <ClipboardList size={18} />
          <h3>Identificação da demanda</h3>
        </div>
        <div className="form-grid">
          <Field label="Categoria">
            <select
              value={data.category_id}
              onChange={(e) => {
                const c = cats.find((c) => c.id === e.target.value)!;
                setData({
                  ...data,
                  category_id: c.id,
                  subcategory: c.subcategories[0],
                });
              }}
            >
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subcategoria">
            <select
              value={data.subcategory}
              onChange={(e) => set("subcategory", e.target.value)}
            >
              {cats
                .find((c) => c.id === data.category_id)
                ?.subcategories.map((s: string) => (
                  <option key={s}>{s}</option>
                ))}
            </select>
          </Field>
          <Field label="Origem">
            <select
              value={data.origin}
              onChange={(e) => set("origin", e.target.value)}
            >
              {[
                "Fiscalização municipal",
                "Equipe de manutenção",
                "Cidadão",
                "BC Digital",
                "Central de atendimento",
                "Integração externa",
                "Sensor",
                "Importação administrativa",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Prioridade">
            <select
              value={data.priority}
              onChange={(e) => set("priority", e.target.value)}
            >
              {boot.priorities.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Descrição" wide>
            <textarea
              required
              value={data.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
            />
          </Field>
          <Field label="Referência" wide>
            <input
              value={data.reference}
              onChange={(e) => set("reference", e.target.value)}
            />
          </Field>
          <Field label="Foto do local" wide>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Field>
        </div>
        {nearby.length > 0 && (
          <div className="duplicate">
            <h3>Ocorrências próximas</h3>
            {nearby.map((o) => (
              <label key={o.id}>
                <input
                  type="radio"
                  name="duplicate"
                  checked={
                    data.duplicate_id === o.id &&
                    data.duplicate_action === "link"
                  }
                  onChange={() =>
                    setData({
                      ...data,
                      duplicate_action: "link",
                      duplicate_id: o.id,
                    })
                  }
                />
                <span>
                  Vincular a {o.code} · {o.address}
                </span>
              </label>
            ))}
            <label>
              <input
                type="radio"
                name="duplicate"
                checked={data.duplicate_action === "new"}
                onChange={() =>
                  setData({
                    ...data,
                    duplicate_action: "new",
                    duplicate_id: undefined,
                  })
                }
              />
              Manter como nova ocorrência
            </label>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            <Check size={17} />
            {busy ? "Registrando..." : "Registrar ocorrência"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Detail({
  value: v,
  boot,
  can,
  onClose,
  onOpen,
  onChange,
}: {
  value: any;
  boot: Boot;
  can: (a: string) => boolean;
  onClose: () => void;
  onOpen: (t: string, id: string) => void;
  onChange: () => Promise<void>;
}) {
  const [tab, setTab] = useState(v.initialTab || "overview"),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [notes, setNotes] = useState(""),
    [reason, setReason] = useState(""),
    [stage, setStage] = useState(v.type === "order" ? "antes" : "registro"),
    [file, setFile] = useState<File | null>(null),
    [material, setMaterial] = useState(""),
    [quantity, setQuantity] = useState(1),
    [equipment, setEquipment] = useState("");
  const [conflict, setConflict] = useState(false);
  const [triageDecision, setTriageDecision] = useState(""), [rejectionReason, setRejectionReason] = useState("");
  const cats = boot.catalogs.filter((c) => c.kind === "categorias"),
    sectors = boot.catalogs.filter((c) => c.kind === "setores");
  const [triage, setTriage] = useState({
    category_id: v.category_id,
    subcategory: v.subcategory,
    sector_id: v.sector_id,
    priority: v.priority,
  });
  const teams = boot.catalogs.filter(
    (c) => c.kind === "equipes" && c.sector_id === triage.sector_id,
  );
  const [schedule, setSchedule] = useState({
    team_id: "",
    scheduled_at: new Date().toISOString().slice(0, 10),
    responsible: "",
    notes: "",
    assigned_user_id: "",
  });
  useEffect(() => {
    if (schedule.team_id && !teams.some(t => t.id === schedule.team_id)) setSchedule(s => ({ ...s, team_id: "", assigned_user_id: "", responsible: "" }));
  }, [triage.sector_id, schedule.team_id]);
  const name = (id: string) =>
    boot.catalogs.find((c) => c.id === id)?.name || "—";
  const isOrder = v.type === "order",
    base = `/${isOrder ? "ordens-servico" : "ocorrencias"}/${v.id}`,
    location = isOrder ? v.occurrences[0] : v;
  const [lat, setLat] = useState(location?.lat || 0),
    [lng, setLng] = useState(location?.lng || 0);
  const execute = async (fn: () => Promise<any>, message = "Operação registrada com sucesso.") => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      setConflict(false);
      setSuccess(message);
      try { await onChange(); } catch { setError("A operação foi registrada, mas não foi possível atualizar o detalhe. Feche e abra o registro antes de continuar."); }
    } catch (e: any) {
      setConflict(e.code === "VERSION_CONFLICT");
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const action = (a: string, body: any = {}) =>
    execute(() => api(`${base}/${a}`, "POST", { ...body, version: v.version }), ({ classificar: "Triagem salva. A gestão já pode programar a ordem de serviço.", assumir: "Deslocamento registrado. Confira a chegada e as evidências antes de iniciar.", iniciar: "Execução iniciada. Registre os materiais e as fotos do serviço.", material: "Consumo de material registrado.", equipamento: "Equipamento vinculado ao serviço.", concluir: "Serviço enviado para validação. A conclusão depende da análise da gestão ou fiscalização.", validar: "Serviço validado e concluído. O resultado foi registrado no histórico.", reabrir: "Execução reaberta para correção. A justificativa foi registrada.", cancelar: "Ordem cancelada. A justificativa foi registrada no histórico." } as Record<string, string>)[a]);
  const editable = !["CONCLUIDA", "CANCELADA", "RECUSADA", "AGUARDANDO_VALIDACAO"].includes(
    v.status,
  );
  return (
    <Modal title={v.code} onClose={onClose} wide>
      <div className="detail-summary">
        <div>
          <Badge status={v.status} />
          <Priority value={v.priority} />
        </div>
        <h2>{isOrder ? name(v.team_id) : v.address}</h2>
        <p>
          {isOrder
            ? `${name(v.sector_id)} · ${v.responsible}`
            : `${v.neighborhood} · ${name(v.category_id)} / ${v.subcategory}`}
        </p>
        {v.demo && <small className="demo-label">Registro demonstrativo</small>}
      </div>
      <>{conflict && <div className="notice" role="alert"><p>Este registro foi alterado por outra pessoa enquanto você trabalhava nele. Atualize os dados antes de continuar. Seus campos locais foram preservados.</p><button type="button" className="button secondary" disabled={busy} onClick={async () => { setBusy(true); try { await onChange(); setConflict(false); setError(""); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}>Atualizar dados</button></div>}</>
      <WorkflowGuide value={v} catalogs={boot.catalogs} onEvidence={() => setTab("evidence")} />
      {success && <p className="notice" role="status">{success}</p>}
      <div className="tabs">
        <button
          className={tab === "overview" ? "selected" : ""}
          onClick={() => setTab("overview")}
        >
          Informações
        </button>
        <button
          className={tab === "evidence" ? "selected" : ""}
          onClick={() => setTab("evidence")}
        >
          Evidências ({v.evidence.length})
        </button>
        {isOrder && (
          <button
            className={tab === "execution" ? "selected" : ""}
            onClick={() => setTab("execution")}
          >
            Execução
          </button>
        )}
        {isOrder && (
          <button className={tab === "costs" ? "selected" : ""} onClick={() => setTab("costs")}>
            Custos e NFs ({v.invoices?.length || 0})
          </button>
        )}
        <button
          className={tab === "history" ? "selected" : ""}
          onClick={() => setTab("history")}
        >
          Histórico ({v.history.length})
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {tab === "overview" && (
        <>
          {isOrder ? (
            <>
              <div className="detail-facts">
                <div>
                  <small>Programação</small>
                  <strong>{v.scheduled_at}</strong>
                </div>
                <div>
                  <small>Prazo de atendimento</small>
                  <Sla order={v} />
                </div>
                <div>
                  <small>Início da execução</small>
                  <strong>{fmt(v.started_at)}</strong>
                </div>
                <div>
                  <small>Conclusão validada</small>
                  <strong>{fmt(v.completed_at)}</strong>
                </div>
              </div>
              <h3>Ocorrências relacionadas</h3>
              {v.occurrences.map((o: Row) => (
                <button
                  className="linked-row"
                  key={o.id}
                  onClick={() => onOpen("occurrence", o.id)}
                >
                  <MapPin size={18} />
                  <span>
                    <strong>{o.address}</strong>
                    <small>{o.code}</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
              {v.completion_notes && (
                <p className="description">{v.completion_notes}</p>
              )}
            </>
          ) : (
            <>
              <p className="description">{v.description}</p>
              {v.status === "RECUSADA" && <div className="notice" role="status"><span><strong>Recusada na triagem</strong><p>{v.rejection_reason}</p><small>{v.rejected_by} · {fmt(v.rejected_at)}</small></span></div>}
              <div className="detail-facts">
                <div>
                  <small>Origem</small>
                  <strong>{v.origin}</strong>
                </div>
                <div>
                  <small>Identificada em</small>
                  <strong>{fmt(v.created_at)}</strong>
                </div>
                <div>
                  <small>Setor responsável</small>
                  <strong>{name(v.sector_id)}</strong>
                </div>
                <div>
                  <small>Coordenadas</small>
                  <strong>
                    {v.lat.toFixed(6)}, {v.lng.toFixed(6)}
                  </strong>
                </div>
              </div>
              {v.reference && <p>Referência: {v.reference}</p>}
              <GeoMap rows={[v]} point={[v.lat, v.lng]} />
              {can("classify") &&
                ["IDENTIFICADA", "EM_TRIAGEM"].includes(v.status) && triageDecision === "" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      action("classificar", triage);
                    }}
                  >
                    <div className="form-section-title">
                      <Filter size={18} />
                      <h3>Triagem</h3>
                    </div>
                    <div className="form-grid">
                      <Field label="Categoria">
                        <select
                          value={triage.category_id}
                          onChange={(e) => {
                            const c = cats.find(
                              (c) => c.id === e.target.value,
                            )!;
                            setTriage({
                              ...triage,
                              category_id: c.id,
                              subcategory: c.subcategories[0],
                              sector_id: c.sector_id,
                            });
                          }}
                        >
                          {cats.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Subcategoria">
                        <select
                          value={triage.subcategory}
                          onChange={(e) =>
                            setTriage({
                              ...triage,
                              subcategory: e.target.value,
                            })
                          }
                        >
                          {cats
                            .find((c) => c.id === triage.category_id)
                            ?.subcategories.map((s: string) => (
                              <option key={s}>{s}</option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Prioridade">
                        <select
                          value={triage.priority}
                          onChange={(e) =>
                            setTriage({ ...triage, priority: e.target.value })
                          }
                        >
                          {boot.priorities.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Setor responsável">
                        <select
                          value={triage.sector_id}
                          onChange={(e) =>
                            setTriage({ ...triage, sector_id: e.target.value })
                          }
                        >
                          {sectors.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="form-actions">
                      {can("schedule") && <button type="button" className="button primary" disabled={busy} onClick={() => { setTriageDecision("program"); setError(""); }}><Plus size={16}/>Gerar ordem de serviço</button>}
                      <button type="submit" className={`button ${can("schedule") ? "secondary" : "primary"}`} disabled={busy}><Check size={16}/>Concluir triagem e programar depois</button>
                      <button type="button" className="button secondary" disabled={busy} onClick={() => { setTriageDecision("reject"); setError(""); }}>Recusar</button>
                    </div>
                  </form>
                )}
              {can("classify") && ["IDENTIFICADA", "EM_TRIAGEM"].includes(v.status) && triageDecision === "reject" && <form className="assignment-form" onSubmit={e => { e.preventDefault(); execute(async () => { await api(`/ocorrencias/${v.id}/recusar`, "POST", { reason: rejectionReason, version: v.version }); setTriageDecision(""); }, "Demanda recusada. A justificativa foi registrada no histórico."); }}><h3>Justificativa de recusa</h3><Field label="Justificativa de recusa"><textarea autoFocus required maxLength={2000} rows={4} value={rejectionReason} onChange={e=>setRejectionReason(e.target.value)} placeholder="Informe o motivo da recusa desta demanda."/></Field><div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>setTriageDecision("")}>Voltar</button><button className="button primary" disabled={busy || !rejectionReason.trim()}>{busy ? "Enviando..." : "Enviar"}</button></div></form>}
              {can("schedule") && ["IDENTIFICADA", "EM_TRIAGEM"].includes(v.status) && triageDecision === "program" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    execute(async () => {
                      await api("/ordens-servico", "POST", {
                        ...schedule,
                        occurrence_ids: [v.id],
                        triage: { ...triage, version: v.version },
                      });
                      setTriageDecision("");
                      setTab("overview");
                    }, "Ordem de serviço criada e equipe designada.");
                  }}
                >
                  <div className="form-section-title">
                    <ClipboardList size={18} />
                    <h3>Gerar ordem de serviço</h3>
                  </div>
                  <p>Escolha a equipe e a data. A triagem será salva junto com a programação.</p>
                  <details className="dispatch-optional"><summary>Consultar equipes e trabalhos do setor</summary><DispatchContext boot={boot} api={api} sectorId={triage.sector_id || v.sector_id} selectedTeam={schedule.team_id} scheduledAt={schedule.scheduled_at} occurrenceId={v.id} onOpen={onOpen} onChoose={(t: any) => setSchedule({ ...schedule, team_id: t.id, assigned_user_id: "", responsible: t.leader || "" })} /></details>
                  <div className="form-grid">
                    <Field label="Equipe">
                      <select
                        required
                        value={schedule.team_id}
                        onChange={(e) =>
                          setSchedule({
                            ...schedule,
                            team_id: e.target.value,
                            assigned_user_id: "",
                            responsible:
                              teams.find((t) => t.id === e.target.value)
                                ?.leader || "",
                          })
                        }
                      >
                        <option value="">Selecione</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Operador designado">
                      <select
                        aria-label="Operador designado"
                        value={schedule.assigned_user_id}
                        onChange={(e) =>
                          setSchedule({
                            ...schedule,
                            assigned_user_id: e.target.value,
                          })
                        }
                      >
                        <option value="">Toda a equipe</option>
                        {boot.operators
                          .filter((u) => u.team_id === schedule.team_id)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Data programada">
                      <input
                        type="date"
                        required
                        value={schedule.scheduled_at}
                        onChange={(e) =>
                          setSchedule({
                            ...schedule,
                            scheduled_at: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Responsável" wide>
                      <input
                        required
                        value={schedule.responsible}
                        onChange={(e) =>
                          setSchedule({
                            ...schedule,
                            responsible: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>
                  <div className="form-actions">
                  <button type="button" className="button secondary" disabled={busy} onClick={() => setTriageDecision("")}>Voltar à triagem</button>
                  <button className="button primary" disabled={busy}>
                    <Plus size={17} />
                    Confirmar ordem de serviço
                  </button>
                  </div>
                </form>
              )}
              {v.orders.length > 0 && (
                <>
                  <h3 className="spaced">Ordens de serviço</h3>
                  {v.orders.map((o: Row) => (
                    <button
                      className="linked-row"
                      key={o.id}
                      onClick={() => onOpen("order", o.id)}
                    >
                      <ClipboardList size={18} />
                      <strong>{o.code}</strong>
                      <Badge status={o.status} />
                      <ChevronRight size={17} />
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
      {tab === "evidence" && (
        <>
          {isOrder && (
            <>
              <h3>Fotos do registro inicial</h3>
              <div className="evidence-grid">
                {v.occurrences
                  .flatMap((o: any) => o.evidence || [])
                  .filter((e: any) => e.mime.startsWith("image/"))
                  .map((e: any) => (
                    <a
                      className="evidence-item"
                      key={e.id}
                      href={`/api/anexos/${e.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={`/api/anexos/${e.id}`}
                        alt="Foto do problema registrado"
                      />
                      <small>
                        {e.user_name} · {fmt(e.created_at)}
                      </small>
                    </a>
                  ))}
              </div>
              <h3>Execução do serviço</h3>
            </>
          )}
          <div className="evidence-grid">
            {v.evidence.map((e: Row) => (
              <a
                key={e.id}
                href={`/api/anexos/${e.id}`}
                target="_blank"
                rel="noreferrer"
                className="evidence-item"
              >
                {e.mime.startsWith("image/") ? (
                  <img src={`/api/anexos/${e.id}`} alt={`Foto ${e.stage}`} />
                ) : (
                  <div className="file-preview">
                    <FileText size={35} />
                  </div>
                )}
                <strong>
                  {e.stage} · {e.original_name}
                </strong>
                <small>
                  {fmt(e.created_at)} · {e.user_name}
                </small>
                <small>
                  {e.lat?.toFixed(5)}, {e.lng?.toFixed(5)}
                </small>
              </a>
            ))}
          </div>
          {!v.evidence.length && <Empty text="Nenhuma evidência anexada." />}
          {editable && can(isOrder ? "execute" : "create") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                execute(async () => {
                  if (!file) throw new Error("Selecione um arquivo.");
                  const fd = new FormData();
                  fd.append("file", file);
                  fd.append("stage", stage);
                  fd.append("lat", String(lat));
                  fd.append("lng", String(lng));
                  await api(`${base}/anexos`, "POST", fd);
                });
              }}
            >
              <div className="form-section-title">
                <Camera size={18} />
                <h3>Anexar evidência</h3>
              </div>
              <div className="form-grid">
                <Field label="Etapa">
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                  >
                    {(isOrder
                      ? ["antes", "durante", "depois", "documento"]
                      : ["registro", "documento"]
                    ).map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Arquivo (até 15 MB)">
                  <input
                    type="file"
                    required
                    accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </Field>
                <Field label="Latitude da captura">
                  <input
                    type="number"
                    step="any"
                    required
                    min="-90"
                    max="90"
                    value={lat}
                    onChange={(e) => setLat(Number(e.target.value))}
                  />
                </Field>
                <Field label="Longitude da captura">
                  <input
                    type="number"
                    step="any"
                    required
                    min="-180"
                    max="180"
                    value={lng}
                    onChange={(e) => setLng(Number(e.target.value))}
                  />
                </Field>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  navigator.geolocation?.getCurrentPosition(
                    (p) => {
                      setLat(p.coords.latitude);
                      setLng(p.coords.longitude);
                    },
                    () =>
                      setError(
                        "GPS indisponível. Confirme as coordenadas manualmente.",
                      ),
                    { timeout: 10000 },
                  )
                }
              >
                <LocateFixed size={16} />
                GPS da captura
              </button>{" "}
              <button className="button primary" disabled={busy}>
                <Camera size={16} />
                Enviar evidência
              </button>
            </form>
          )}
        </>
      )}
      {isOrder && tab === "costs" && (
        <InvoicePanel order={v} materials={boot.catalogs.filter((item) => item.kind === "materiais")} api={api} onChange={onChange} canManage={can("schedule")} />
      )}
      {isOrder && v.return_reason && (
        <div className="notice">
          <TriangleAlert />
          <span>
            <strong>Não foi possível executar</strong>
            <br />
            {v.return_reason}
            <br />
            {v.returned_by} · {fmt(v.returned_at)}
          </span>
        </div>
      )}
      {isOrder && v.completion_notes && (
        <div className="notice">
          <CheckCircle2 />
          <span>
            <strong>Relato de campo</strong>
            <br />
            {v.completion_notes}
            <br />
            {v.executed_by} · {fmt(v.finished_at)}
          </span>
        </div>
      )}
      {isOrder &&
        can("schedule") &&
        ["PROGRAMADA", "DEVOLVIDA"].includes(v.status) && (
          <Assignment
            key={v.updated_at}
            order={v}
            boot={boot}
            onSave={(data: any) =>
              execute(() => api(`${base}/programacao`, "POST", { ...data, version: v.version }))
            }
            busy={busy}
          />
        )}
      {tab === "execution" && (
        <>
          {can("execute") &&
            ["PROGRAMADA", "EM_DESLOCAMENTO"].includes(v.status) && (
              <>
                <div className="form-grid">
                  <Field label="Latitude de chegada">
                    <input
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      value={lat}
                      onChange={(e) => setLat(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Longitude de chegada">
                    <input
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      value={lng}
                      onChange={(e) => setLng(Number(e.target.value))}
                    />
                  </Field>
                </div>
                <div className="action-row">
                  {v.status === "PROGRAMADA" && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => action("assumir")}
                    >
                      <Truck size={17} />
                      Iniciar deslocamento
                    </button>
                  )}
                  <button
                    className="button secondary"
                    onClick={() =>
                      navigator.geolocation?.getCurrentPosition(
                        (p) => {
                          setLat(p.coords.latitude);
                          setLng(p.coords.longitude);
                        },
                        () =>
                          setError(
                            "GPS indisponível. Informe a localização manualmente.",
                          ),
                        { timeout: 10000 },
                      )
                    }
                  >
                    <LocateFixed size={16} />
                    Capturar GPS
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => action("iniciar", { lat, lng })}
                  >
                    <HardHat size={17} />
                    Confirmar chegada e iniciar
                  </button>
                </div>
              </>
            )}
          <h3 className="spaced">Materiais utilizados</h3>
          {v.materials.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Quantidade</th>
                    <th>Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {v.materials.map((m: Row) => (
                    <tr key={m.id}>
                      <td>{name(m.material_id)}</td>
                      <td>
                        {m.quantity}{" "}
                        {
                          boot.catalogs.find((c) => c.id === m.material_id)
                            ?.unit
                        }
                      </td>
                      <td>{money(m.quantity * m.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Nenhum material registrado.</p>
          )}
          {can("execute") && v.status === "EM_EXECUCAO" && (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                action("material", { material_id: material, quantity });
              }}
            >
              <Field label="Material">
                <select
                  required
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {boot.catalogs
                    .filter((c) => c.kind === "materiais")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.unit})
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Quantidade">
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </Field>
              <button className="button secondary" disabled={busy}>
                <Plus size={16} />
                Registrar
              </button>
            </form>
          )}
          <h3 className="spaced">Equipamentos</h3>
          {v.equipment.map((e: any) => (
            <div className="consumption-line" key={e.equipment_id}>
              <Truck size={17} />
              <span>{name(e.equipment_id)}</span>
            </div>
          ))}
          {!v.equipment.length && (
            <p className="muted">Nenhum equipamento registrado.</p>
          )}
          {can("execute") && v.status === "EM_EXECUCAO" && (
            <>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  action("equipamento", { equipment_id: equipment });
                }}
              >
                <Field label="Equipamento">
                  <select
                    required
                    value={equipment}
                    onChange={(e) => setEquipment(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {boot.catalogs
                      .filter((c) => c.kind === "equipamentos")
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <button className="button secondary" disabled={busy}>
                  <Plus size={16} />
                  Vincular
                </button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action("concluir", { notes });
                }}
              >
                <div className="form-section-title">
                  <CheckCircle2 size={18} />
                  <h3>Conclusão do serviço</h3>
                </div>
                <Field label="Relato da execução">
                  <textarea
                    required
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
                <button className="button primary" disabled={busy}>
                  <Check size={17} />
                  Enviar para validação
                </button>
              </form>
            </>
          )}
          {can("validate") && v.status === "AGUARDANDO_VALIDACAO" && (
            <div className="form-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={() => action("validar")}
              >
                <ShieldCheck size={17} />
                Validar e concluir
              </button>
            </div>
          )}
          {((can("validate") &&
            ["CONCLUIDA", "AGUARDANDO_VALIDACAO"].includes(v.status)) ||
            (can("schedule") &&
              ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"].includes(
                v.status,
              ))) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action(
                  ["CONCLUIDA", "AGUARDANDO_VALIDACAO"].includes(v.status)
                    ? "reabrir"
                    : "cancelar",
                  { reason },
                );
              }}
            >
              <h3 className="spaced">
                {["CONCLUIDA", "AGUARDANDO_VALIDACAO"].includes(v.status)
                  ? "Reabrir serviço"
                  : "Cancelar ordem"}
              </h3>
              <Field label="Justificativa">
                <textarea
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <button className="button secondary" disabled={busy}>
                {["CONCLUIDA", "AGUARDANDO_VALIDACAO"].includes(v.status)
                  ? "Reabrir execução"
                  : "Cancelar ordem"}
              </button>
            </form>
          )}
        </>
      )}
      {tab === "history" && (
        <div className="timeline">
          {v.history.map((h: Row) => (
            <div key={h.id}>
              <i />
              <strong>{h.event}</strong>
              <p>
                {h.user_name} · {fmt(h.created_at)}
              </p>
              <details>
                <summary>Detalhes da alteração</summary>
                <pre>
                  {JSON.stringify(
                    {
                      anterior: h.before_value
                        ? JSON.parse(h.before_value)
                        : null,
                      novo: h.after_value ? JSON.parse(h.after_value) : null,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          ))}
          {!v.history.length && <Empty text="Nenhum evento registrado." />}
        </div>
      )}
    </Modal>
  );
}

function CatalogForm({
  kind,
  item,
  boot,
  onClose,
  onSave,
}: {
  kind: string;
  item?: Row;
  boot: Boot;
  onClose: () => void;
  onSave: (d: any) => Promise<void>;
}) {
  const [d, setD] = useState<any>(
    item || {
      name: "",
      subcategories: [],
      sector_id: boot.catalogs.find((c) => c.kind === "setores")?.id || "",
      sla: {
        Emergencial: 24,
        Alta: 48,
        Média: 120,
        Baixa: 240,
        Programada: 360,
      },
      require_before: true,
      require_after: true,
      require_material: false,
      unit: "kg",
      unit_cost: 0,
      minimum_stock: 0,
      leader: "",
      members: 1,
      code: "",
      parent_id: "",
    },
  );
  const [subs, setSubs] = useState(item?.subcategories?.join(", ") || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setD({ ...d, [k]: v });
  return (
    <Modal
      title={`${item ? "Editar" : "Novo cadastro"} · ${kind}`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave({
              ...d,
              subcategories: subs
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean),
            });
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Nome">
          <input
            required
            value={d.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        {["equipes", "categorias"].includes(kind) && (
          <Field label="Setor responsável">
            <select
              required
              value={d.sector_id}
              onChange={(e) => set("sector_id", e.target.value)}
            >
              {boot.catalogs
                .filter((c) => c.kind === "setores")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {kind === "categorias" && (
          <>
            <Field label="Subcategorias (separadas por vírgula)">
              <input
                required
                value={subs}
                onChange={(e) => setSubs(e.target.value)}
              />
            </Field>
            <h3>SLA por prioridade (horas)</h3>
            <div className="form-grid">
              {boot.priorities.map((p) => (
                <Field label={p} key={p}>
                  <input
                    required
                    type="number"
                    min="1"
                    max="8760"
                    value={d.sla[p]}
                    onChange={(e) =>
                      set("sla", { ...d.sla, [p]: Number(e.target.value) })
                    }
                  />
                </Field>
              ))}
            </div>
            <h3>Evidências obrigatórias</h3>
            {[
              ["require_before", "Foto antes de iniciar"],
              ["require_after", "Foto após o serviço"],
              ["require_material", "Material utilizado"],
            ].map(([k, l]) => (
              <label className="checkbox" key={k}>
                <input
                  type="checkbox"
                  checked={d[k]}
                  onChange={(e) => set(k, e.target.checked)}
                />
                {l}
              </label>
            ))}
          </>
        )}
        {kind === "materiais" && (
          <div className="form-grid">
            <Field label="Unidade">
              <input
                required
                value={d.unit}
                onChange={(e) => set("unit", e.target.value)}
              />
            </Field>
            <Field label="Custo unitário (R$)">
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={d.unit_cost}
                onChange={(e) => set("unit_cost", Number(e.target.value))}
              />
            </Field>
            <Field label="Estoque mínimo">
              <input type="number" min="0" step="0.001" required value={d.minimum_stock || 0} onChange={(e) => set("minimum_stock", Number(e.target.value))} />
            </Field>
          </div>
        )}
        {kind === "equipes" && (
          <>
            <Field label="Responsável">
              <input
                required
                value={d.leader}
                onChange={(e) => set("leader", e.target.value)}
              />
            </Field>
            <Field label="Quantidade de integrantes">
              <input
                type="number"
                min="1"
                required
                value={d.members}
                onChange={(e) => set("members", Number(e.target.value))}
              />
            </Field>
          </>
        )}
        {kind === "equipamentos" && (
          <Field label="Código patrimonial">
            <input
              required
              value={d.code}
              onChange={(e) => set("code", e.target.value)}
            />
          </Field>
        )}
        {["departamentos", "setores"].includes(kind) && (
          <Field
            label={kind === "departamentos" ? "Secretaria" : "Departamento"}
          >
            <select
              required
              value={d.parent_id}
              onChange={(e) => set("parent_id", e.target.value)}
            >
              <option value="">Selecione</option>
              {boot.catalogs
                .filter(
                  (c) =>
                    c.kind ===
                    (kind === "departamentos"
                      ? "secretarias"
                      : "departamentos"),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            <Check size={16} />
            Salvar cadastro
          </button>
        </div>
      </form>
    </Modal>
  );
}
function UserForm({
  boot,
  onClose,
  onSave,
}: {
  boot: Boot;
  onClose: () => void;
  onSave: (d: any) => Promise<void>;
}) {
  const [d, setD] = useState<any>({
      name: "",
      email: "",
      password: "",
      role: "Consulta",
      team_id: null,
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Novo usuário" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(d);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {[
          ["name", "Nome", "text"],
          ["email", "E-mail", "email"],
          ["password", "Senha (mínimo 10 caracteres)", "password"],
        ].map(([k, l, t]) => (
          <Field key={k} label={l}>
            <input
              required
              type={t}
              minLength={k === "password" ? 10 : 2}
              autoComplete={k === "password" ? "new-password" : "off"}
              value={d[k]}
              onChange={(e) => setD({ ...d, [k]: e.target.value })}
            />
          </Field>
        ))}
        <Field label="Perfil">
          <select
            value={d.role}
            onChange={(e) => setD({ ...d, role: e.target.value })}
          >
            {boot.roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Equipe">
          <select
            required={d.role === "Equipe de Campo"}
            value={d.team_id || ""}
            onChange={(e) => setD({ ...d, team_id: e.target.value || null })}
          >
            <option value="">Sem equipe</option>
            {boot.catalogs
              .filter((c) => c.kind === "equipes")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="button primary" disabled={busy}>
            <Plus size={16} />
            Criar usuário
          </button>
        </div>
      </form>
    </Modal>
  );
}
function SettingsForm({
  boot,
  save,
}: {
  boot: Boot;
  save: (d: any) => Promise<void>;
}) {
  const [d, setD] = useState({
    municipality: boot.settings.municipality,
    duplicate_radius: boot.settings.duplicate_radius,
  });
  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        save(d);
      }}
    >
      <Field label="Município">
        <input
          required
          value={d.municipality}
          onChange={(e) => setD({ ...d, municipality: e.target.value })}
        />
      </Field>
      <Field label="Raio de duplicidade e reincidência (metros)">
        <input
          required
          type="number"
          min="1"
          max="500"
          value={d.duplicate_radius}
          onChange={(e) =>
            setD({ ...d, duplicate_radius: Number(e.target.value) })
          }
        />
      </Field>
      <button className="button primary">
        <Check size={16} />
        Salvar configurações
      </button>
    </form>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
