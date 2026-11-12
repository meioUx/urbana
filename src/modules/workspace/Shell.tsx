import {
  ArrowDownToLine,
  Building2,
  ClipboardList,
  Construction,
  FileText,
  Filter,
  HardHat,
  Layers3,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  MapPin,
  Menu,
  Package,
  Plus,
  Settings2,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import { useState } from "react";
import SidebarNav from "../../SidebarNav";
import type { Boot } from "../../shared/types";

export type NavItem = [string, string, typeof MapIcon];

/** Itens do menu principal, na ordem exibida; "Administração" só aparece para quem pode administrar. */
export function navigationItems(canAdmin: boolean): NavItem[] {
  return [
    ["dashboard", "Visão geral", LayoutDashboard],
    ["map", "Mapa territorial", MapIcon],
    ["occurrences", "Ocorrências", MapPin],
    ["triagem", "Triagem", Filter],
    ["kanban", "Kanban de equipes", Layers3],
    ["planning", "Planejamento", Layers3],
    ["works", "Obras e intervenções", Construction],
    ["orders", "Ordens de serviço", ClipboardList],
    ["sector-control", "Controle do setor", FileText],
    ["review", "Análise de campo", ShieldCheck],
    ["field", "Operação de campo", HardHat],
    ["teams", "Equipes", Users],
    ["materials", "Materiais", Package],
    ["equipment", "Equipamentos", Truck],
    ...(canAdmin
      ? [
          ["admin", "Administração", Settings2] as [
            string,
            string,
            typeof MapIcon,
          ],
        ]
      : []),
  ];
}

export function Sidebar({
  mobile,
  nav,
  page,
  triageCount,
  boot,
  onNavigate,
  onLogout,
}: {
  mobile: boolean;
  nav: NavItem[];
  page: string;
  triageCount: number | null;
  boot: Boot;
  onNavigate: (page: string) => void;
  onLogout: () => void;
}) {
  return (
    <aside
      className={mobile ? "sidebar open" : "sidebar"}
      aria-label="Barra lateral"
    >
      <a
        className="brand"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onNavigate("dashboard");
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
      <SidebarNav
        nav={nav}
        page={page}
        triageCount={triageCount}
        onNavigate={onNavigate}
      />
      <div className="sidebar-bottom">
        <div className="connection">
          <span />
          {boot.settings.demo ? "Ambiente demonstrativo" : "Ambiente municipal"}
        </div>
        <button className="profile" onClick={onLogout} title="Sair da conta">
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
  );
}

export function Topbar({
  title,
  onToggleMenu,
}: {
  title: string;
  onToggleMenu: () => void;
}) {
  return (
    <header className="topbar">
      <div>
        <button
          className="icon mobile-toggle"
          title="Abrir menu"
          onClick={onToggleMenu}
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
  );
}

export function PageHeading({
  page,
  title,
  pagedScope,
  can,
  onExport,
  onNewOccurrence,
  onNewCatalog,
}: {
  page: string;
  title: string;
  pagedScope: boolean;
  can: (action: string) => boolean;
  onExport: () => void;
  onNewOccurrence: () => void;
  onNewCatalog: (kind: string) => void;
}) {
  return (
    <div
      data-guide="page-heading"
      className={`page-heading ${page === "kanban" ? "kanban-heading" : ""}`}
    >
      <div>
        <p className="eyebrow">
          {page === "dashboard" ? "PAINEL OPERACIONAL" : "GESTÃO DE MANUTENÇÃO"}
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
                  : page === "works"
                    ? "Intervenções com geometria e período, agrupadas em obras, com vínculos opcionais a ocorrências e OS."
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
          <button className="button secondary" onClick={onExport}>
            <ArrowDownToLine size={16} />
            {pagedScope ? "Exportar página" : "Exportar"}
          </button>
        )}
        {can("create") &&
          ["map", "occurrences", "triagem", "kanban"].includes(page) && (
            <button className="button primary" onClick={onNewOccurrence}>
              <Plus size={18} />
              Nova ocorrência
            </button>
          )}
        {can("admin") && ["teams", "materials", "equipment"].includes(page) && (
          <button
            className="button primary"
            onClick={() =>
              onNewCatalog(
                page === "teams"
                  ? "equipes"
                  : page === "equipment"
                    ? "equipamentos"
                    : "materiais",
              )
            }
          >
            <Plus size={18} />
            Novo cadastro
          </button>
        )}
      </div>
    </div>
  );
}

export function AccessNotice({
  message,
  onMyModules,
  onLogout,
}: {
  message: string;
  onMyModules: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="login-page">
      <section className="login-card">
        <h1>{message}</h1>
        <p>
          {message === "Sem módulos disponíveis"
            ? "Seu usuário não possui módulos liberados no momento. Entre em contato com o administrador do sistema."
            : "Seu usuário não possui acesso a este ambiente. Entre em contato com o administrador do sistema."}
        </p>
        <button className="button secondary" onClick={onMyModules}>
          Ir para meus módulos
        </button>
        <button className="button secondary" onClick={onLogout}>
          Sair
        </button>
      </section>
    </div>
  );
}

/** Sessão de Campo salva em uso (sem servidor): a gestão precisa de conexão. */
export function OfflineNotice({
  canField,
  onField,
  onRetry,
}: {
  canField: boolean;
  onField: () => void;
  onRetry: () => Promise<unknown>;
}) {
  const [checking, setChecking] = useState(false);
  return (
    <div className="login-page">
      <section className="login-card" role="alert">
        <h1>Sem conexão com o servidor</h1>
        <p>
          {canField
            ? "A área de gestão precisa de conexão. Sem rede, este aparelho abre apenas o Campo, com as tarefas salvas."
            : "Este aparelho guardou uma sessão sem acesso ao Campo, e as demais áreas precisam de conexão."}{" "}
          Quando a conexão voltar, os dados são atualizados automaticamente.
        </p>
        {canField && (
          <button className="button" onClick={onField}>
            Abrir o Campo
          </button>
        )}
        <button
          className="button secondary"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            onRetry().finally(() => setChecking(false));
          }}
        >
          {checking ? "Verificando..." : "Tentar novamente"}
        </button>
      </section>
    </div>
  );
}
