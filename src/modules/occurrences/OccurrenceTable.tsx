import { ChevronRight } from "lucide-react";
import { fmt } from "../../shared/format";
import type { Row } from "../../shared/types";
import { Badge, Empty, Priority, TableScroll } from "../../shared/ui";

export default function OccurrenceTable({
  data,
  compact = false,
  name,
  onOpen,
}: {
  data: Row[];
  compact?: boolean;
  name: (id: string) => string;
  onOpen: (type: string, id: string) => void;
}) {
  return (
    <TableScroll label="Tabela de ocorrências">
      <table>
        <thead>
          <tr>
            <th>Ocorrência / localização</th>
            {!compact && <th>Categoria</th>}
            <th>Prioridade</th>
            <th>Status</th>
            {!compact && <th>Identificação</th>}
            <th>
              <span className="visually-hidden">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr
              key={r.id}
              onClick={() => onOpen("occurrence", r.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen("occurrence", r.id);
                }
              }}
            >
              <td>
                <strong>{r.address}</strong>
                <small>
                  {r.code} <span>·</span> {r.neighborhood}
                  {r.recurrence ? " · Reincidência" : ""}
                  {r.public_portal ? " · Portal do cidadão" : ""}
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
      {!data.length && (
        <Empty text="Nenhuma ocorrência encontrada. As demandas registradas aparecerão aqui para consulta e análise; confira também os filtros." />
      )}
    </TableScroll>
  );
}
