import { Pencil } from "lucide-react";
import { api } from "../../shared/api";
import { money } from "../../shared/format";
import { lazyModule } from "../../shared/lazyModule";
import type { Row } from "../../shared/types";
import { TableScroll } from "../../shared/ui";
const InventoryPanel = lazyModule(() => import("../../InventoryPanel"));

export default function MaterialsPage({
  materials,
  dashboard,
  canSchedule,
  canAdmin,
  onEdit,
}: {
  materials: Row[];
  dashboard: any;
  canSchedule: boolean;
  canAdmin: boolean;
  onEdit: (material: Row) => void;
}) {
  return (
    <>
      <InventoryPanel api={api} catalogs={materials} readOnly={!canSchedule} />
      <div className="section-heading recent">
        <h2>Cadastros de apoio</h2>
      </div>
      <div className="section-heading">
        <h2>Materiais</h2>
        <span>{materials.length} itens</span>
      </div>
      <TableScroll label="Tabela de materiais">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Unidade</th>
              <th>Custo unitário</th>
              <th>Consumo total</th>
              <th>
                <span className="visually-hidden">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.name}</strong>
                </td>
                <td>{m.unit}</td>
                <td>{money(m.unit_cost)}</td>
                <td>
                  {dashboard ? (
                    <>
                      {dashboard.consumption_by_material[m.id] || 0} {m.unit}
                    </>
                  ) : (
                    " " + m.unit
                  )}
                </td>
                <td>
                  {canAdmin && (
                    <button
                      className="icon"
                      title={`Editar ${m.name}`}
                      onClick={() => onEdit(m)}
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </>
  );
}
