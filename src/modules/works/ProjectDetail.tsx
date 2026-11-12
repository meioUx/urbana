import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../../shared/api";
import type { Boot, Row } from "../../shared/types";
import { Badge } from "../../shared/ui";
import { fmt } from "../../shared/format";
import { GeoMap } from "../map/LazyGeoMap";
import type { MapOverlay } from "../map/GeoMap";
import { LinkSearch, TransitionDialog, WorksBadge } from "./parts";
import {
  dateBR,
  describeGeometry,
  featureStyle,
  periodBR,
  transitionLabel,
} from "./model";
import ProjectForm from "./ProjectForm";

/** Detalhe da obra: dados, intervenções e OS agrupadas, mapa das intervenções e histórico. */
export default function ProjectDetail({
  boot,
  id,
  canManage,
  onBack,
  onOpenRecord,
  onOpenIntervention,
  onChanged,
  notify,
}: {
  boot: Boot;
  id: string;
  canManage: boolean;
  onBack: () => void;
  onOpenRecord: (type: string, id: string) => void;
  onOpenIntervention: (id: string) => void;
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const [item, setItem] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<
    null | { type: "edit" } | { type: "transition"; to: string }
  >(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const load = async () => {
    try {
      setItem(await api(`/obras/${id}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps -- recarrega ao trocar de registro
  useEffect(() => {
    if (item) heading.current?.focus();
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- foco só ao abrir
  const name = (catalogId: string) =>
    boot.catalogs.find((c) => c.id === catalogId)?.name || "—";
  const overlays = useMemo<MapOverlay[]>(
    () =>
      item
        ? [
            {
              id: "project",
              data: {
                type: "FeatureCollection",
                features: item.interventions.map((i: Row) => ({
                  type: "Feature",
                  properties: { status: i.status, code: i.code },
                  geometry: i.geometry,
                })),
              } as any,
              options: {
                style: (f: any) => featureStyle(f?.properties?.status) as any,
                onEachFeature: (f: any, layer: any) =>
                  layer.bindTooltip(String(f.properties.code)),
              },
            },
          ]
        : [],
    [item],
  );
  const apply = (detail: Row, message: string) => {
    setItem(detail);
    setDialog(null);
    notify(message);
    onChanged();
  };
  const mutate = async (fn: () => Promise<Row>, message: string) => {
    setError("");
    try {
      apply(await fn(), message);
    } catch (e: any) {
      setError(e.message);
    }
  };
  if (!item)
    return (
      <section className="works-detail">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={15} /> Voltar à lista
        </button>
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : (
          <p className="loading-inline" role="status">
            Carregando obra...
          </p>
        )}
      </section>
    );
  const open = !["CONCLUIDA", "CANCELADA"].includes(item.status);
  return (
    <section className="works-detail" aria-labelledby="project-title">
      <div className="works-detail-top">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={15} /> Voltar à lista
        </button>
        <button className="text-button" onClick={load}>
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>
      <header className="works-detail-header">
        <div>
          <p className="eyebrow">OBRA · {item.code}</p>
          <h2 id="project-title" tabIndex={-1} ref={heading}>
            {item.title}
          </h2>
          <div className="works-detail-badges">
            <WorksBadge status={item.status} />
          </div>
        </div>
        {canManage && (
          <div
            className="works-actions"
            role="group"
            aria-label="Ações da obra"
          >
            {item.status !== "CANCELADA" && (
              <button
                className="button secondary"
                onClick={() => setDialog({ type: "edit" })}
              >
                <Pencil size={15} /> Editar
              </button>
            )}
            {item.allowed_transitions.map((to: string) => (
              <button
                key={to}
                className={`button ${to === "CANCELADA" ? "secondary danger" : "primary"}`}
                onClick={() => setDialog({ type: "transition", to })}
              >
                {transitionLabel(item.status, to)}
              </button>
            ))}
            {item.status === "PLANEJADA" && (
              <button
                className="button secondary danger"
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Excluir ${item.code}? As intervenções e OS agrupadas continuam existindo.`,
                    )
                  )
                    return;
                  try {
                    await api(`/obras/${item.id}`, "DELETE", {
                      version: item.version,
                    });
                    notify(`${item.code} excluída.`);
                    onChanged();
                    onBack();
                  } catch (e: any) {
                    setError(e.message);
                  }
                }}
              >
                <Trash2 size={15} /> Excluir
              </button>
            )}
          </div>
        )}
      </header>
      {error && (
        <div className="notice error" role="alert">
          <span>{error}</span>
        </div>
      )}
      <dl className="works-facts">
        <div>
          <dt>Responsável</dt>
          <dd>{item.responsible}</dd>
        </div>
        <div>
          <dt>Período previsto</dt>
          <dd>{periodBR(item.planned_start, item.planned_end)}</dd>
        </div>
        <div>
          <dt>Período real</dt>
          <dd>
            {item.actual_start
              ? periodBR(item.actual_start, item.actual_end)
              : "Não iniciada"}
          </dd>
        </div>
        <div>
          <dt>Agrupamento</dt>
          <dd>
            {item.interventions.length} intervenções · {item.orders.length} OS
          </dd>
        </div>
      </dl>
      {item.description && <p className="description">{item.description}</p>}
      <p className="muted">
        Cronograma físico, custos, medições e fiscalização da obra ainda não
        estão disponíveis nesta versão.
      </p>
      {item.interventions.length > 0 && (
        <div className="works-map">
          <GeoMap rows={[]} overlays={overlays} fit={item.extent} />
        </div>
      )}
      <div className="works-links">
        <section aria-labelledby="project-interventions">
          <h3 id="project-interventions">
            Intervenções da obra ({item.interventions.length})
          </h3>
          <ul className="linked-list">
            {item.interventions.map((i: Row) => (
              <li key={i.id}>
                <button
                  className="text-button"
                  onClick={() => onOpenIntervention(i.id)}
                >
                  {i.code}
                </button>
                <span>
                  {i.title} · {periodBR(i.planned_start, i.planned_end)}
                  <small className="visually-muted">
                    {describeGeometry(i.geometry)}
                  </small>
                </span>
                <WorksBadge status={i.status} />
                {canManage && open && (
                  <button
                    className="text-button"
                    aria-label={`Remover ${i.code} da obra`}
                    onClick={() =>
                      mutate(
                        () =>
                          api(
                            `/obras/${item.id}/intervencoes/${i.id}`,
                            "DELETE",
                          ),
                        `${i.code} removida da obra.`,
                      )
                    }
                  >
                    Remover da obra
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canManage && open && (
            <LinkSearch
              label="Buscar intervenção para agrupar"
              path="/intervencoes"
              worksStatus
              exclude={item.interventions.map((i: Row) => i.id)}
              describe={(r) =>
                `${r.title}${r.project ? ` (já na obra ${r.project.code})` : ""}`
              }
              onLink={async (r) =>
                apply(
                  await api(`/obras/${item.id}/intervencoes`, "POST", {
                    intervention_id: r.id,
                  }),
                  `${r.code} agrupada na obra.`,
                )
              }
            />
          )}
        </section>
        <section aria-labelledby="project-orders">
          <h3 id="project-orders">
            Ordens de serviço da obra ({item.orders.length})
          </h3>
          <ul className="linked-list">
            {item.orders.map((o: Row) => (
              <li key={o.id}>
                <button
                  className="text-button"
                  onClick={() => onOpenRecord("order", o.id)}
                >
                  {o.code}
                </button>
                <span>
                  {name(o.team_id)} · prazo {fmt(o.due_at)}
                </span>
                <Badge status={o.status} />
                {canManage && open && (
                  <button
                    className="text-button"
                    aria-label={`Remover ${o.code} da obra`}
                    onClick={() =>
                      mutate(
                        () =>
                          api(
                            `/obras/${item.id}/ordens-servico/${o.id}`,
                            "DELETE",
                          ),
                        `${o.code} removida da obra.`,
                      )
                    }
                  >
                    Remover da obra
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canManage && open && (
            <LinkSearch
              label="Buscar ordem de serviço para agrupar"
              path="/ordens-servico"
              exclude={item.orders.map((o: Row) => o.id)}
              describe={(r) => `${name(r.team_id)} · ${r.responsible || ""}`}
              onLink={async (r) =>
                apply(
                  await api(`/obras/${item.id}/ordens-servico`, "POST", {
                    order_id: r.id,
                  }),
                  `${r.code} agrupada na obra.`,
                )
              }
            />
          )}
        </section>
      </div>
      <h3>Histórico</h3>
      <ol className="works-history">
        {item.history.map((h: Row) => (
          <li key={h.id}>
            <strong>{h.event}</strong>
            <small>
              {h.user_name} · {fmt(h.created_at)}
            </small>
          </li>
        ))}
      </ol>
      <p className="muted">
        Cadastrada em {dateBR(item.created_at)} por{" "}
        {item.created_by_name || "—"} · versão {item.version}
      </p>
      {dialog?.type === "edit" && (
        <ProjectForm
          item={item}
          onClose={() => setDialog(null)}
          onSaved={(d) => apply(d, "Obra atualizada.")}
        />
      )}
      {dialog?.type === "transition" && (
        <TransitionDialog
          record={item}
          to={dialog.to}
          kind="obras"
          onClose={() => setDialog(null)}
          onDone={(d) => apply(d, "Situação atualizada.")}
        />
      )}
    </section>
  );
}
