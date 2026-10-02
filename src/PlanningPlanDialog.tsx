import { useEffect, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, X } from "lucide-react";
import { occurrenceDeadline, planningPriority } from "./planning-model.mjs";
import { summarizeTeam } from "./dispatch-model.mjs";

const dateLabel = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
export default function PlanningPlanDialog({
  candidate,
  boot,
  orders,
  referenceDate,
  presetTeam = "",
  onClose,
  onSave,
  onOpen,
}: any) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initial = (
    candidate.ready.length ? candidate.ready : candidate.waiting
  ).slice(0, 100);
  const [selected, setSelected] = useState<string[]>(
    initial.map((o: any) => o.id),
  );
  const [program, setProgram] = useState(
    initial.every((o: any) => o.status === "EM_TRIAGEM"),
  );
  const [date, setDate] = useState(referenceDate),
    [team, setTeam] = useState(presetTeam),
    [operator, setOperator] = useState("");
  const teams = boot.catalogs.filter(
    (c: any) => c.kind === "equipes" && c.sector_id === candidate.sector_id,
  );
  const [responsible, setResponsible] = useState(boot.user.name);
  const [orderResponsible, setOrderResponsible] = useState(
    teams.find((t: any) => t.id === presetTeam)?.leader || "",
  );
  const [objective, setObjective] = useState(
    `Atender as demandas de ${candidate.categories.join(" e ").toLocaleLowerCase("pt-BR")} na ${candidate.street}.`,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const members = candidate.occurrences.filter((o: any) =>
    selected.includes(o.id),
  );
  const ready =
    members.length > 0 && members.every((o: any) => o.status === "EM_TRIAGEM");
  const issue = program && ready;
  const priority = planningPriority(members);
  const due = members
    .map((o: any) => occurrenceDeadline(o, boot.catalogs, priority))
    .filter(Boolean)
    .sort()[0];
  const load = team ? summarizeTeam(orders, team, date) : null;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="planning-dialog"
      aria-labelledby="planning-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <small>DEFINIR A INTERVENÇÃO</small>
          <h2 id="planning-dialog-title">Planejar esta obra</h2>
          <p>
            {candidate.street} · {candidate.neighborhood}
          </p>
        </div>
        <button
          type="button"
          className="icon"
          aria-label="Fechar planejamento"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await onSave(
              issue ? "/ordens-servico" : "/planos-acao",
              issue
                ? {
                    occurrence_ids: selected,
                    team_id: team,
                    assigned_user_id: operator || null,
                    responsible: orderResponsible,
                    scheduled_at: date,
                    notes: objective,
                    new_plan: { objective, responsible },
                  }
                : {
                    occurrence_ids: selected,
                    objective,
                    responsible,
                    scheduled_at: date,
                  },
            );
          } catch (err: any) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="planning-dialog-summary">
            <span>
              <strong>{selected.length}</strong> demandas selecionadas
            </span>
            <span>
              Prioridade do plano <strong>{priority}</strong>
            </span>
          </div>
          <details
            className="planning-scope"
            open={!ready || candidate.waiting.length > 0}
          >
            <summary>
              Revisar o escopo ({candidate.occurrences.length} demandas)
            </summary>
            <div className="planning-scope-list">
              {candidate.occurrences.map((o: any) => (
                <label key={o.id}>
                  <input
                    aria-label={`Incluir ${o.code}`}
                    type="checkbox"
                    checked={selected.includes(o.id)}
                    onChange={(e) => {
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, o.id]
                          : ids.filter((id) => id !== o.id),
                      );
                      if (e.target.checked && o.status !== "EM_TRIAGEM")
                        setProgram(false);
                    }}
                  />
                  <span>
                    <strong>{o.code}</strong>
                    <small>
                      {o.address} ·{" "}
                      {o.status === "EM_TRIAGEM"
                        ? "Triagem concluída"
                        : "Aguarda triagem"}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      onClose();
                      onOpen("occurrence", o.id);
                    }}
                  >
                    Conferir
                  </button>
                </label>
              ))}
            </div>
          </details>
          {!ready && (
            <p className="planning-note">
              Demandas sem triagem podem entrar no plano, mas precisam ser
              classificadas antes de emitir a OS.
            </p>
          )}
          <label>
            Objetivo do plano
            <textarea
              aria-label="Objetivo do plano"
              required
              minLength={5}
              maxLength={3000}
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              Responsável pelo plano
              <input
                aria-label="Responsável pelo plano"
                required
                maxLength={200}
                value={responsible}
                onChange={(e) => setResponsible(e.target.value)}
              />
            </label>
            <label>
              Data planejada
              <input
                aria-label="Data planejada"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          {due && (
            <p
              className={`planning-note ${Date.parse(due) < Date.now() ? "warning" : ""}`}
            >
              <CalendarDays size={15} />
              Prazo mais próximo do escopo: {dateLabel(due)}. A programação
              mantém a contagem do SLA desde o registro.
            </p>
          )}
          <label className="planning-issue-choice">
            <input
              type="checkbox"
              aria-label="Emitir ordem de serviço agora"
              checked={issue}
              disabled={!ready}
              onChange={(e) => setProgram(e.target.checked)}
            />
            <span>
              <strong>Emitir ordem de serviço agora</strong>
              <small>
                {ready
                  ? "Salve o plano e a OS juntos, com a equipe definida."
                  : "Disponível quando todas as demandas selecionadas estiverem triadas."}
              </small>
            </span>
          </label>
          {issue && (
            <>
              <div className="form-grid">
                <label>
                  Equipe do plano
                  <select
                    aria-label="Equipe do plano"
                    required
                    value={team}
                    onChange={(e) => {
                      setTeam(e.target.value);
                      setOperator("");
                      setOrderResponsible(
                        teams.find((t: any) => t.id === e.target.value)
                          ?.leader || "",
                      );
                    }}
                  >
                    <option value="">Escolha a equipe</option>
                    {teams.map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Responsável pela ordem
                  <input
                    aria-label="Responsável pela ordem"
                    required
                    maxLength={2000}
                    value={orderResponsible}
                    onChange={(e) => setOrderResponsible(e.target.value)}
                  />
                </label>
                <label className="wide">
                  Operador
                  <select
                    aria-label="Operador do plano"
                    value={operator}
                    onChange={(e) => setOperator(e.target.value)}
                  >
                    <option value="">Compartilhar com a equipe</option>
                    {boot.operators
                      .filter((u: any) => u.team_id === team)
                      .map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {load && (
                <div className="planning-load-note">
                  <strong>
                    {load.onDate} OS na data escolhida · {load.open} OS abertas
                  </strong>
                  <span>
                    {load.running} em operação · {load.review} aguardando
                    validação
                  </span>
                  {load.onDate > 0 && (
                    <p>
                      A equipe já tem serviços nesta data. Confira se o novo
                      escopo cabe na jornada antes de confirmar.
                    </p>
                  )}
                </div>
              )}
              {boot.kanban?.limits?.PROGRAMADA > 0 && (
                <p className="planning-note">
                  A programação também respeita o limite de trabalho definido no
                  Kanban.
                </p>
              )}
            </>
          )}
        </fieldset>
        <footer>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="button primary"
            disabled={busy || selected.length === 0 || selected.length > 100}
          >
            <CheckCircle2 size={16} />
            {busy
              ? "Salvando..."
              : issue
                ? "Salvar plano e programar OS"
                : "Salvar plano de ação"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
