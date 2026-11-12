import { Pencil, Truck } from "lucide-react";
import type { Row } from "../../shared/types";

export default function EquipmentPage({
  equipment,
  canAdmin,
  onEdit,
}: {
  equipment: Row[];
  canAdmin: boolean;
  onEdit: (item: Row) => void;
}) {
  return (
    <>
      <div className="section-heading recent">
        <h2>Equipamentos</h2>
      </div>
      <div className="equipment-list">
        {equipment.map((e) => (
          <div key={e.id}>
            <Truck size={23} />
            <span>
              <strong>{e.name}</strong>
              <small>{e.code}</small>
            </span>
            {canAdmin && (
              <button
                className="icon"
                title={`Editar ${e.name}`}
                onClick={() => onEdit(e)}
              >
                <Pencil size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
