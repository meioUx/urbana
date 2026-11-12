import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Pencil,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { geometryBBox } from "../../../shared/geometry.mjs";
import { api } from "../../shared/api";
import type { Boot, Row } from "../../shared/types";
import { Badge, Priority } from "../../shared/ui";
import { fmt } from "../../shared/format";
import { GeoMap } from "../map/LazyGeoMap";
import type { MapOverlay } from "../map/GeoMap";
import {
  ConflictList,
  LinkSearch,
  TransitionDialog,
  WorksBadge,
} from "./parts";
import {
  dateBR,
  describeGeometry,
  featureStyle,
  geometryTypeLabels,
  periodBR,
  scopeLabels,
  transitionLabel,
} from "./model";
import InterventionForm from "./InterventionForm";

/** Detalhe da intervenção: dados, geometria (mapa e texto), conflitos, vínculos e histórico. */
export default function InterventionDetail({
  boot,
  id,
  canManage,
  onBack,
  onOpenRecord,
  onOpenProject,
  onChanged,
  notify,
}: {
  boot: Boot;
  id: string;
  canManage: boolean;
  onBack: () => void;
  onOpenRecord: (type: string, id: string) => void;
  onOpenProject: (id: string) => void;
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
      setItem(await api(`/intervencoes/${id}`));
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
              id: item.id,
              data: {
                type: "Feature",
                properties: {},
                geometry: item.geometry,
              } as any,
              options: { style: () => featureStyle(item.status, true) as any },
            },
          ]
        : [],
    [item],
  );
  const fit = useMemo(
    () => (item ? geometryBBox(item.geometry) : null),
    [item?.geometry],
  ); // eslint-disable-line react-hooks/exhaustive-deps -- geometria
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
            Carregando intervenção...
          </p>
        )}
      </section>
    );
  const open = !["CONCLUIDA", "CANCELADA"].includes(item.status);
  const pending = item.conflicts.filter((c: Row) => !c.review).length;
  return (
    <section className="works-detail" aria-labelledby="intervention-title">
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
          <p className="eyebrow">INTERVENÇÃO · {item.code}</p>
          <h2 id="intervention-title" tabIndex={-1} ref={heading}>
            {item.title}
          </h2>
          <div className="works-detail-badges">
            <WorksBadge status={item.status} />
            <Priority value={item.priority} />
          </div>
        </div>
        {canManage && (
          <div
            className="works-actions"
            role="group"
            aria-label="Ações da intervenção"
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
                      `Excluir ${item.code}? Os vínculos são desfeitos; ocorrências e OS não mudam.`,
                    )
                  )
                    return;
                  try {
                    await api(`/intervencoes/${item.id}`, "DELETE", {
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
      {item.conflicts.length > 0 && (
        <div className="notice warning" role="status">
          <TriangleAlert size={18} />
          <span>
            {item.conflicts.length === 1
              ? "Há 1 conflito"
              : `Há ${item.conflicts.length} conflitos`}{" "}
            de local e período com outras intervenções ativas
            {pending
              ? ` (${pending} sem avaliação registrada)`
              : " (todos avaliados)"}
            .
          </span>
        </div>
      )}
      <dl className="works-facts">
        <div>
          <dt>Abrangência</dt>
          <dd>{scopeLabels[item.scope] || item.scope}</dd>
        </div>
        <div>
          <dt>Local</dt>
          <dd>{item.location}</dd>
        </div>
        <div>
          <dt>Bairro</dt>
          <dd>{item.neighborhood || "—"}</dd>
        </div>
        <div>
          <dt>Setor</dt>
          <dd>{item.sector_id ? name(item.sector_id) : "—"}</dd>
        </div>
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
          <dt>Obra</dt>
          <dd>
            {item.project ? (
              <button
                className="text-button"
                onClick={() => onOpenProject(item.project.id)}
              >
                {item.project.code} · {item.project.title}
              </button>
            ) : (
              "Sem obra (intervenção independente)"
            )}
          </dd>
        </div>
        {(item.pause_reason || item.cancel_reason || item.reopen_reason) && (
          <div className="wide">
            <dt>Último motivo registrado</dt>
            <dd>
              {item.status_reason ||
                item.cancel_reason ||
                item.pause_reason ||
                item.reopen_reason}
            </dd>
          </div>
        )}
      </dl>
      {item.description && <p className="description">{item.description}</p>}
      <h3>Geometria · {geometryTypeLabels[item.geometry_type]}</h3>
      <div className="works-map">
        <GeoMap rows={[]} overlays={overlays} fit={fit} />
      </div>
      <p className="geometry-status">{describeGeometry(item.geometry)}</p>
      <details className="geometry-coordinates">
        <summary>Coordenadas da geometria (GeoJSON)</summary>
        <pre>{JSON.stringify(item.geometry, null, 1)}</pre>
      </details>
      {item.services?.length > 0 && (
        <>
          <h3>Serviços previstos</h3>
          <ul className="works-services">
            {item.services.map((s: Row, i: number) => (
              <li key={i}>
                {s.description}
                {s.quantity != null
                  ? ` · ${Number(s.quantity).toLocaleString("pt-BR")} ${s.unit || ""}`
                  : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Conflitos de local e período</h3>
      {item.conflicts.length ? (
        <ConflictList
          conflicts={item.conflicts}
          onReview={
            canManage && open
              ? (c, note) =>
                  mutate(
                    () =>
                      api(
                        `/intervencoes/${item.id}/conflitos/${c.id}/avaliacao`,
                        "POST",
                        { note },
                      ),
                    "Avaliação do conflito registrada.",
                  )
              : undefined
          }
        />
      ) : (
        <p className="muted">
          Nenhuma outra intervenção ativa no mesmo local e período (tolerância
          de 15 m).
        </p>
      )}
      <div className="works-links">
        <section aria-labelledby="linked-occurrences">
          <h3 id="linked-occurrences">
            Ocorrências vinculadas ({item.occurrences.length})
          </h3>
          <p className="muted">
            Vínculo opcional: a ocorrência segue seu próprio atendimento.
          </p>
          <ul className="linked-list">
            {item.occurrences.map((o: Row) => (
              <li key={o.id}>
                <button
                  className="text-button"
                  onClick={() => onOpenRecord("occurrence", o.id)}
                >
                  {o.code}
                </button>
                <span>
                  {o.address} · {o.neighborhood}
                </span>
                <Badge status={o.status} />
                {canManage && open && (
                  <button
                    className="text-button"
                    aria-label={`Desvincular ${o.code}`}
                    onClick={() =>
                      mutate(
                        () =>
                          api(
                            `/intervencoes/${item.id}/ocorrencias/${o.id}`,
                            "DELETE",
                          ),
                        `${o.code} desvinculada.`,
                      )
                    }
                  >
                    Desvincular
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canManage && open && (
            <LinkSearch
              label="Buscar ocorrência para vincular"
              path="/ocorrencias"
              exclude={item.occurrences.map((o: Row) => o.id)}
              describe={(r) => `${r.address || ""} · ${r.neighborhood || ""}`}
              onLink={async (r) =>
                apply(
                  await api(`/intervencoes/${item.id}/ocorrencias`, "POST", {
                    occurrence_id: r.id,
                  }),
                  `${r.code} vinculada.`,
                )
              }
            />
          )}
        </section>
        <section aria-labelledby="linked-orders">
          <h3 id="linked-orders">
            Ordens de serviço vinculadas ({item.orders.length})
          </h3>
          <p className="muted">
            Vínculo opcional: a OS mantém equipe, prazo e situação próprios.
          </p>
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
                    aria-label={`Desvincular ${o.code}`}
                    onClick={() =>
                      mutate(
                        () =>
                          api(
                            `/intervencoes/${item.id}/ordens-servico/${o.id}`,
                            "DELETE",
                          ),
                        `${o.code} desvinculada.`,
                      )
                    }
                  >
                    Desvincular
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canManage && open && (
            <LinkSearch
              label="Buscar ordem de serviço para vincular"
              path="/ordens-servico"
              exclude={item.orders.map((o: Row) => o.id)}
              describe={(r) => `${name(r.team_id)} · ${r.responsible || ""}`}
              onLink={async (r) =>
                apply(
                  await api(`/intervencoes/${item.id}/ordens-servico`, "POST", {
                    order_id: r.id,
                  }),
                  `${r.code} vinculada.`,
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
        <InterventionForm
          boot={boot}
          item={item}
          onClose={() => setDialog(null)}
          onSaved={(d) => apply(d, "Intervenção atualizada.")}
        />
      )}
      {dialog?.type === "transition" && (
        <TransitionDialog
          record={item}
          to={dialog.to}
          kind="intervencoes"
          onClose={() => setDialog(null)}
          onDone={(d) => apply(d, "Situação atualizada.")}
        />
      )}
    </section>
  );
}
