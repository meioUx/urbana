import { ShieldCheck } from "lucide-react";
import { fmt } from "../../shared/format";
import type { Row } from "../../shared/types";
import { Badge, Empty } from "../../shared/ui";
import { useCursorPages } from "../workspace/useServerData";

/**
 * Análise de campo: serviços aguardando validação ou devolvidos pelas equipes, buscados no servidor
 * em páginas de 50 (mais recentes primeiro), recarregados a cada sincronização.
 */
export default function ReviewPage({
  lastSync,
  name,
  onOpen,
}: {
  lastSync: string;
  name: (id: string) => string;
  onOpen: (type: string, id: string) => void;
}) {
  const {
    items: orders,
    hasMore,
    loading,
    error,
    loadMore,
  } = useCursorPages<Row>(
    "/ordens-servico?status=AGUARDANDO_VALIDACAO,DEVOLVIDA&limit=50",
    lastSync,
  );
  return (
    <div data-guide="review" className="planning-page">
      <div className="notice">
        <ShieldCheck />
        <span>
          Confira o relato, as fotos antes/depois e os materiais. Aprove o
          serviço, solicite correção ou reprograme uma devolução.
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
                onClick={() => onOpen("order", o.id)}
              >
                Analisar ordem
              </button>
            </article>
          ))}
      </div>
      {error && (
        <div className="notice error" role="alert">
          Não foi possível carregar os serviços para análise. {error}
        </div>
      )}
      {loading && !orders.length && (
        <p role="status">Carregando serviços para análise...</p>
      )}
      {!loading && !error && !orders.length && (
        <Empty text="Nenhum serviço aguardando validação. Os serviços enviados pelas equipes aparecerão aqui para conferência." />
      )}
      {hasMore && (
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {loading ? "Carregando..." : "Carregar mais serviços"}
          </button>
        </div>
      )}
    </div>
  );
}
