import { useState } from "react";
import { lazyModule } from "../../shared/lazyModule";
import { Field, Modal } from "../../shared/ui";
import { useOpenOrders } from "../workspace/useServerData";
const PlanningTeamCapacity = lazyModule(() =>
  import("../../PlanningPanel").then((m) => ({
    default: m.PlanningTeamCapacity,
  })),
);

export default function PlanOrderForm({
  plan,
  boot,
  lastSync,
  onClose,
  onSave,
}: any) {
  const { orders, error: loadError } = useOpenOrders(lastSync);
  const eligible = plan.occurrences.filter(
    (o: any) => o.status === "EM_TRIAGEM" && !o.order_ids?.length,
  );
  const [sector, setSector] = useState(eligible[0]?.sector_id || ""),
    [team, setTeam] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const members = eligible
    .filter((o: any) => o.sector_id === sector)
    .slice(0, 100);
  const teams = boot.catalogs.filter(
    (c: any) => c.kind === "equipes" && c.sector_id === sector,
  );
  const [date, setDate] = useState(plan.scheduled_at || "");
  return (
    <Modal title="Programar ordem do plano" onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await onSave({
              plan_id: plan.id,
              occurrence_ids: members.map((o: any) => o.id),
              team_id: team,
              responsible: form.get("responsible"),
              scheduled_at: form.get("scheduled_at"),
              notes: plan.objective,
            });
          } catch (err: any) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {plan.code} · {plan.street}
        </p>
        <p>
          A OS reúne as ocorrências em triagem do setor selecionado. O prazo de
          SLA continua contando desde a identificação.
        </p>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <Field label="Setor do plano">
          <select
            aria-label="Setor do plano"
            value={sector}
            onChange={(e) => {
              setSector(e.target.value);
              setTeam("");
            }}
          >
            {[...new Set<string>(eligible.map((o: any) => o.sector_id))].map(
              (id) => (
                <option key={id} value={id}>
                  {boot.catalogs.find((c: any) => c.id === id)?.name}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="Equipe do plano">
          <select
            aria-label="Equipe do plano"
            required
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">Selecione uma equipe</option>
            {teams.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        {loadError && (
          <p className="form-error" role="alert">
            Não foi possível consultar a carga das equipes. {loadError}
          </p>
        )}
        <PlanningTeamCapacity
          boot={boot}
          orders={orders}
          sectorId={sector}
          selectedTeam={team}
          date={date}
          onChoose={(t: any) => setTeam(t.id)}
        />
        <div className="form-grid">
          <Field label="Responsável pela ordem">
            <input
              name="responsible"
              required
              defaultValue={plan.responsible}
            />
          </Field>
          <Field label="Data da ordem">
            <input
              name="scheduled_at"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </div>
        <p>{members.length} ocorrências nesta ordem:</p>
        <ul>
          {members.map((o: any) => (
            <li key={o.id}>
              {o.code} · {o.address}
            </li>
          ))}
        </ul>
        <button
          className="button primary"
          disabled={busy || !team || !members.length}
        >
          {busy ? "Programando..." : "Confirmar programação"}
        </button>
      </form>
    </Modal>
  );
}
