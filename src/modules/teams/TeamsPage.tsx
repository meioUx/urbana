import { ArrowRight, Pencil, Users } from "lucide-react";
import type { Row } from "../../shared/types";
import { useServerData } from "../workspace/useServerData";

const closed = ["CONCLUIDA", "CANCELADA", "RECUSADA"];

/** Equipes com a contagem de OS ativas e concluídas, calculada no servidor (`/ordens-servico/resumo`). */
export default function TeamsPage({
  teams,
  lastSync,
  canReadOrders,
  name,
  canAdmin,
  onEdit,
  onViewOrders,
}: {
  teams: Row[];
  lastSync: string;
  canReadOrders: boolean;
  name: (id: string) => string;
  canAdmin: boolean;
  onEdit: (team: Row) => void;
  onViewOrders: (team: Row) => void;
}) {
  const summary = useServerData<{
    by_team: Record<string, Record<string, number>>;
  }>(canReadOrders ? "/ordens-servico/resumo" : null, lastSync);
  const counts = (id: string) => summary.data?.by_team[id] || {};
  const show = (value: number) =>
    summary.data ? value : canReadOrders ? "…" : "—";
  return (
    <>
      {summary.error && (
        <div className="notice error" role="alert">
          Não foi possível carregar a contagem de ordens das equipes.{" "}
          {summary.error}
        </div>
      )}
      <div className="team-grid" data-guide="teams" aria-busy={summary.loading}>
        {teams.map((t) => (
          <article className="team-card" key={t.id}>
            <div className="section-heading">
              <span className="team-icon">
                <Users size={23} />
              </span>
              {canAdmin && (
                <button
                  className="icon"
                  title={`Editar ${t.name}`}
                  onClick={() => onEdit(t)}
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
                  {show(
                    Object.entries(counts(t.id))
                      .filter(([status]) => !closed.includes(status))
                      .reduce((n, [, value]) => n + value, 0),
                  )}
                </strong>
                Ordens ativas
              </span>
              <span>
                <strong>{show(counts(t.id).CONCLUIDA || 0)}</strong>
                Concluídas
              </span>
            </div>
            <button className="text-button" onClick={() => onViewOrders(t)}>
              Ver ordens
              <ArrowRight size={16} />
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
