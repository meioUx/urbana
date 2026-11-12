import { ChevronRight } from "lucide-react";
import type { Row } from "../../shared/types";
import { Badge, Empty, Priority, Sla, TableScroll } from "../../shared/ui";

export default function OrdersTable({
  orders: filteredOrders,
  name,
  onOpen,
}: {
  orders: Row[];
  name: (id: string) => string;
  onOpen: (type: string, id: string) => void;
}) {
  return (
    <TableScroll label="Tabela de ordens de serviço">
      <table>
        <thead>
          <tr>
            <th>Ordem de serviço</th>
            <th>Equipe responsável</th>
            <th>Prioridade</th>
            <th>Status</th>
            <th>Prazo / SLA</th>
            <th>
              <span className="visually-hidden">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredOrders.map((o) => (
            <tr
              key={o.id}
              onClick={() => onOpen("order", o.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen("order", o.id);
                }
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
        <Empty text="Nenhuma ordem de serviço encontrada. Os atendimentos programados aparecerão aqui; ajuste os filtros para consultar outras situações." />
      )}
    </TableScroll>
  );
}
