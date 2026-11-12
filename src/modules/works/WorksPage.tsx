import { useEffect, useRef, useState } from "react";
import { ChevronRight, Plus, Search, TriangleAlert } from "lucide-react";
import { api } from "../../shared/api";
import type { Boot, Row } from "../../shared/types";
import { Empty, Priority, TableScroll } from "../../shared/ui";
import { WorksBadge } from "./parts";
import { geometryTypeLabels, periodBR, worksLabels } from "./model";
import InterventionForm from "./InterventionForm";
import InterventionDetail from "./InterventionDetail";
import ProjectForm from "./ProjectForm";
import ProjectDetail from "./ProjectDetail";
import "./works.css";

type Tab = "interventions" | "projects";
type View =
  | { kind: "list" }
  | { kind: "intervention"; id: string }
  | { kind: "project"; id: string };

const initialView = (): { tab: Tab; view: View } => {
  const params = new URLSearchParams(window.location.search);
  const intervention = params.get("intervencao"),
    project = params.get("obra");
  if (intervention)
    return {
      tab: "interventions",
      view: { kind: "intervention", id: intervention },
    };
  if (project)
    return { tab: "projects", view: { kind: "project", id: project } };
  return { tab: "interventions", view: { kind: "list" } };
};

/** Área "Obras e intervenções": listas paginadas com filtros, cadastro, detalhe e vínculos. */
export default function WorksPage({
  boot,
  lastSync,
  canManage,
  onOpenRecord,
}: {
  boot: Boot;
  lastSync: string;
  canManage: boolean;
  onOpenRecord: (type: string, id: string) => void;
}) {
  const [{ tab, view }, setState] = useState(initialView);
  const [modal, setModal] = useState<"" | "intervention" | "project">("");
  const [toast, setToast] = useState("");
  const [version, setVersion] = useState(0);
  const tabs = useRef<HTMLDivElement>(null);
  const go = (next: { tab?: Tab; view: View }) => {
    setState((s) => ({ tab: next.tab ?? s.tab, view: next.view }));
    const url =
      next.view.kind === "intervention"
        ? `/obras?intervencao=${next.view.id}`
        : next.view.kind === "project"
          ? `/obras?obra=${next.view.id}`
          : "/obras";
    history.replaceState(null, "", url);
  };
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const changed = () => setVersion((v) => v + 1);
  const selectTab = (next: Tab) => {
    go({ tab: next, view: { kind: "list" } });
  };
  return (
    <div className="works-page">
      <div className="toast-region" role="status" aria-live="polite">
        {toast && <div className="toast">{toast}</div>}
      </div>
      {view.kind === "intervention" && (
        <InterventionDetail
          boot={boot}
          id={view.id}
          canManage={canManage}
          onBack={() => go({ tab: "interventions", view: { kind: "list" } })}
          onOpenRecord={onOpenRecord}
          onOpenProject={(id) =>
            go({ tab: "projects", view: { kind: "project", id } })
          }
          onChanged={changed}
          notify={setToast}
        />
      )}
      {view.kind === "project" && (
        <ProjectDetail
          boot={boot}
          id={view.id}
          canManage={canManage}
          onBack={() => go({ tab: "projects", view: { kind: "list" } })}
          onOpenRecord={onOpenRecord}
          onOpenIntervention={(id) =>
            go({ tab: "interventions", view: { kind: "intervention", id } })
          }
          onChanged={changed}
          notify={setToast}
        />
      )}
      {view.kind === "list" && (
        <>
          <div className="works-toolbar">
            <div
              className="works-tabs"
              role="tablist"
              aria-label="Obras e intervenções"
              ref={tabs}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                  return;
                e.preventDefault();
                const next: Tab =
                  e.key === "Home"
                    ? "interventions"
                    : e.key === "End"
                      ? "projects"
                      : tab === "interventions"
                        ? "projects"
                        : "interventions";
                selectTab(next);
                tabs.current
                  ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
                  [next === "interventions" ? 0 : 1]?.focus();
              }}
            >
              <button
                role="tab"
                id="works-tab-interventions"
                aria-selected={tab === "interventions"}
                tabIndex={tab === "interventions" ? 0 : -1}
                aria-controls="works-panel"
                onClick={() => selectTab("interventions")}
              >
                Intervenções
              </button>
              <button
                role="tab"
                id="works-tab-projects"
                aria-selected={tab === "projects"}
                tabIndex={tab === "projects" ? 0 : -1}
                aria-controls="works-panel"
                onClick={() => selectTab("projects")}
              >
                Obras
              </button>
            </div>
            {canManage && (
              <button
                className="button primary"
                onClick={() =>
                  setModal(tab === "interventions" ? "intervention" : "project")
                }
              >
                <Plus size={18} />
                {tab === "interventions" ? "Nova intervenção" : "Nova obra"}
              </button>
            )}
          </div>
          <div
            id="works-panel"
            role="tabpanel"
            aria-labelledby={
              tab === "interventions"
                ? "works-tab-interventions"
                : "works-tab-projects"
            }
          >
            <p className="muted works-intro">
              {tab === "interventions"
                ? "Conjuntos de serviços num trecho, área ou ativo, com geometria e período. Vincular ocorrências e OS é opcional; a manutenção simples continua independente."
                : "Projetos que agrupam intervenções e OS. Cronograma, custos, medições e fiscalização da obra ainda não estão disponíveis."}
            </p>
            <WorksList
              key={tab}
              tab={tab}
              boot={boot}
              refreshKey={`${lastSync}-${version}`}
              onOpen={(id) =>
                go({
                  view: {
                    kind: tab === "interventions" ? "intervention" : "project",
                    id,
                  },
                })
              }
            />
          </div>
        </>
      )}
      {modal === "intervention" && (
        <InterventionForm
          boot={boot}
          onClose={() => setModal("")}
          onSaved={(detail) => {
            setModal("");
            setToast(
              detail.conflicts?.length
                ? `${detail.code} cadastrada com ${detail.conflicts.length} conflito(s) a avaliar.`
                : `${detail.code} cadastrada.`,
            );
            changed();
            go({
              tab: "interventions",
              view: { kind: "intervention", id: detail.id },
            });
          }}
        />
      )}
      {modal === "project" && (
        <ProjectForm
          onClose={() => setModal("")}
          onSaved={(detail) => {
            setModal("");
            setToast(`${detail.code} cadastrada.`);
            changed();
            go({ tab: "projects", view: { kind: "project", id: detail.id } });
          }}
        />
      )}
    </div>
  );
}

function WorksList({
  tab,
  boot,
  refreshKey,
  onOpen,
}: {
  tab: Tab;
  boot: Boot;
  refreshKey: string;
  onOpen: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursor, setCursor] = useState("");
  const [back, setBack] = useState<string[]>([]);
  const [page, setPage] = useState<{
    items: Row[];
    has_more: boolean;
    next_cursor: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filterKey = JSON.stringify([q, status, priority, from, to]);
  useEffect(() => {
    setCursor("");
    setBack([]);
  }, [filterKey]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      const params = new URLSearchParams({ limit: "50" });
      for (const [k, v] of Object.entries({
        q,
        status,
        priority: tab === "interventions" ? priority : "",
        period_from: from,
        period_to: to,
        cursor,
      }))
        if (v) params.set(k, v);
      try {
        const result = await api(
          `/${tab === "interventions" ? "intervencoes" : "obras"}?${params}`,
        );
        if (!cancelled) {
          setPage(result);
          setError("");
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, filterKey, cursor, refreshKey]);
  const items = page?.items || [];
  const open = (id: string) => onOpen(id);
  const sector = (id: string) =>
    boot.catalogs.find((c) => c.id === id)?.name || "";
  return (
    <>
      <div className="filters" role="group" aria-label="Filtros">
        <div className="search">
          <Search size={17} />
          <input
            aria-label={
              tab === "interventions" ? "Buscar intervenções" : "Buscar obras"
            }
            placeholder={
              tab === "interventions"
                ? "Buscar por código, título, local ou responsável..."
                : "Buscar por código, nome ou responsável..."
            }
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          aria-label="Filtrar situação"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todas as situações</option>
          {Object.entries(worksLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {tab === "interventions" && (
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
        )}
        <input
          type="date"
          aria-label="Período previsto a partir de"
          title="Período previsto a partir de"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          aria-label="Período previsto até"
          title="Período previsto até"
          min={from}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      {error && (
        <div className="notice error" role="alert">
          <TriangleAlert size={18} />
          <span>{error}</span>
        </div>
      )}
      <div className="form-actions" role="group" aria-label="Paginação">
        <button
          className="button secondary"
          disabled={busy || !back.length}
          onClick={() => {
            setCursor(back.at(-1) || "");
            setBack(back.slice(0, -1));
          }}
        >
          Anterior
        </button>
        <span role="status">
          Página {back.length + 1} ·{" "}
          {busy ? "Atualizando..." : `${items.length} registros`}
        </span>
        <button
          className="button secondary"
          disabled={busy || !page?.has_more}
          onClick={() => {
            setBack([...back, cursor]);
            setCursor(page!.next_cursor || "");
          }}
        >
          Próxima
        </button>
      </div>
      <TableScroll label="Tabela de obras e intervenções">
        <table>
          <thead>
            {tab === "interventions" ? (
              <tr>
                <th>Intervenção</th>
                <th>Local</th>
                <th>Prioridade</th>
                <th>Situação</th>
                <th>Período previsto</th>
                <th>Vínculos</th>
                <th>
                  <span className="visually-hidden">Ações</span>
                </th>
              </tr>
            ) : (
              <tr>
                <th>Obra</th>
                <th>Responsável</th>
                <th>Situação</th>
                <th>Período previsto</th>
                <th>Agrupamento</th>
                <th>
                  <span className="visually-hidden">Ações</span>
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {items.map((r) => (
              <tr
                key={r.id}
                tabIndex={0}
                aria-label={`Abrir ${r.code}`}
                onClick={() => open(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open(r.id);
                  }
                }}
              >
                {tab === "interventions" ? (
                  <>
                    <td>
                      <strong>{r.code}</strong>
                      <small>{r.title}</small>
                    </td>
                    <td>
                      {r.location}
                      <small>
                        {geometryTypeLabels[r.geometry_type]}
                        {r.neighborhood ? ` · ${r.neighborhood}` : ""}
                        {r.sector_id ? ` · ${sector(r.sector_id)}` : ""}
                      </small>
                    </td>
                    <td>
                      <Priority value={r.priority} />
                    </td>
                    <td>
                      <WorksBadge status={r.status} />
                    </td>
                    <td>{periodBR(r.planned_start, r.planned_end)}</td>
                    <td>
                      {r.occurrence_count} ocorr. · {r.order_count} OS
                      <small>
                        {r.project ? `Obra ${r.project.code}` : "Sem obra"}
                      </small>
                    </td>
                  </>
                ) : (
                  <>
                    <td>
                      <strong>{r.code}</strong>
                      <small>{r.title}</small>
                    </td>
                    <td>{r.responsible}</td>
                    <td>
                      <WorksBadge status={r.status} />
                    </td>
                    <td>{periodBR(r.planned_start, r.planned_end)}</td>
                    <td>
                      {r.intervention_count} intervenções · {r.order_count} OS
                    </td>
                  </>
                )}
                <td>
                  <ChevronRight size={16} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {page && !items.length && (
          <Empty
            text={
              tab === "interventions"
                ? "Nenhuma intervenção encontrada para os filtros."
                : "Nenhuma obra encontrada para os filtros."
            }
          />
        )}
      </TableScroll>
    </>
  );
}
