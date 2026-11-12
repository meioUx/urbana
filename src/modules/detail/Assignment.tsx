import { useState } from "react";
import DispatchContext from "../../DispatchContext";
import { api } from "../../shared/api";
import { Field } from "../../shared/ui";

export default function Assignment({ order, boot, onSave, busy }: any) {
  const [team, setTeam] = useState(order.team_id),
    [operator, setOperator] = useState(order.assigned_user_id || "");
  const [date, setDate] = useState(order.scheduled_at || "");
  return (
    <details
      className="assignment-form"
      data-guide="assignment"
      open={order.guideKey ? true : undefined}
    >
      <summary>
        {order.status === "DEVOLVIDA"
          ? "Reprogramar serviço devolvido"
          : "Distribuir para equipe ou operador"}
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          onSave({
            team_id: team,
            assigned_user_id: operator || null,
            responsible: d.get("responsible"),
            scheduled_at: d.get("scheduled_at"),
            notes: d.get("notes"),
          });
        }}
      >
        <DispatchContext
          boot={boot}
          api={api}
          sectorId={order.sector_id}
          selectedTeam={team}
          scheduledAt={date}
          excludeOrderId={order.id}
          onChoose={(t: any) => {
            setTeam(t.id);
            setOperator("");
          }}
        />
        <div className="form-grid">
          <Field label="Equipe da programação">
            <select
              aria-label="Equipe da programação"
              value={team}
              onChange={(e) => {
                setTeam(e.target.value);
                setOperator("");
              }}
            >
              {boot.catalogs
                .filter(
                  (c: any) =>
                    c.kind === "equipes" && c.sector_id === order.sector_id,
                )
                .map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Operador da programação">
            <select
              aria-label="Operador da programação"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
            >
              <option value="">Toda a equipe</option>
              {boot.operators
                .filter((u: any) => u.team_id === team)
                .map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Responsável pela programação">
            <input
              name="responsible"
              required
              defaultValue={order.responsible}
            />
          </Field>
          <Field label="Data da programação">
            <input
              type="date"
              name="scheduled_at"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Instruções para o operador" wide>
            <textarea
              name="notes"
              maxLength={3000}
              defaultValue={order.notes}
            />
          </Field>
        </div>
        <button className="button primary" disabled={busy}>
          Salvar distribuição
        </button>
      </form>
    </details>
  );
}
