import { useState } from "react";
import { api } from "../../shared/api";
import type { Row } from "../../shared/types";
import { Badge, Field, Modal } from "../../shared/ui";
import { inkColor } from "../../shared/workflow";
import {
  dateBR,
  needsReason,
  periodBR,
  transitionLabel,
  worksColors,
  worksLabels,
} from "./model";

export function WorksBadge({ status }: { status: string }) {
  const color = worksColors[status] || "#555555";
  return (
    <span
      className="badge"
      style={{ color: inkColor(color), background: `${color}13` }}
    >
      <i style={{ background: color }} />
      {worksLabels[status] || status}
    </span>
  );
}

export function ConflictList({
  conflicts,
  onReview,
}: {
  conflicts: Row[];
  onReview?: (conflict: Row, note: string) => Promise<void>;
}) {
  return (
    <ul className="conflict-list">
      {conflicts.map((c) => (
        <li key={c.id}>
          <div>
            <strong>
              {c.code} · {c.title}
            </strong>
            <small>
              {c.location ? `${c.location} · ` : ""}
              {worksLabels[c.status]} · previsto{" "}
              {periodBR(c.planned_start, c.planned_end)} · sobreposição de{" "}
              {periodBR(c.overlap_start, c.overlap_end)} ·{" "}
              {c.distance_m === 0
                ? "geometrias se tocam"
                : `a ${c.distance_m.toLocaleString("pt-BR")} m`}
            </small>
            {c.review && (
              <p className="conflict-review">
                Avaliado por {c.review.user_name} em{" "}
                {dateBR(c.review.created_at)}: {c.review.note}
              </p>
            )}
          </div>
          {onReview && <ReviewForm conflict={c} onReview={onReview} />}
        </li>
      ))}
    </ul>
  );
}

function ReviewForm({
  conflict,
  onReview,
}: {
  conflict: Row;
  onReview: (conflict: Row, note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        className="text-button"
        onClick={() => setOpen(true)}
      >
        {conflict.review ? "Atualizar avaliação" : "Registrar avaliação"}
      </button>
    );
  return (
    <form
      className="review-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onReview(conflict, note);
          setOpen(false);
          setNote("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Como o conflito com {conflict.code} foi avaliado</span>
        <textarea
          required
          minLength={3}
          maxLength={1000}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoFocus
        />
      </label>
      <div className="inline-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => setOpen(false)}
        >
          Cancelar
        </button>
        <button className="button primary" disabled={busy}>
          Salvar avaliação
        </button>
      </div>
    </form>
  );
}

/** Confirma a mudança de situação; pede motivo quando a regra exige e data real opcional. */
export function TransitionDialog({
  record,
  to,
  kind,
  onClose,
  onDone,
}: {
  record: Row;
  to: string;
  kind: "intervencoes" | "obras";
  onClose: () => void;
  onDone: (detail: Row) => void;
}) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const required = needsReason(record.status, to);
  const dated =
    to === "CONCLUIDA" || (to === "EM_ANDAMENTO" && !record.actual_start);
  const label = transitionLabel(record.status, to);
  return (
    <Modal title={`${label} ${record.code}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            onDone(
              await api(`/${kind}/${record.id}/transicao`, "POST", {
                version: record.version,
                to,
                ...(reason.trim() ? { reason: reason.trim() } : {}),
                ...(date ? { date } : {}),
              }),
            );
          } catch (err: any) {
            setError(
              err.code === "VERSION_CONFLICT"
                ? "Outro usuário alterou este registro. Feche e atualize antes de tentar de novo."
                : err.code === "OPEN_INTERVENTIONS"
                  ? `${err.message} Pendentes: ${err.details.interventions.join(", ")}.`
                  : err.message,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Situação atual: <strong>{worksLabels[record.status]}</strong>. Nova
          situação: <strong>{worksLabels[to]}</strong>.
        </p>
        {kind === "intervencoes" && (
          <p className="muted">
            As ocorrências e ordens de serviço vinculadas não mudam de situação.
          </p>
        )}
        {dated && (
          <Field
            label={
              to === "CONCLUIDA"
                ? "Data real de término (padrão: hoje)"
                : "Data real de início (padrão: hoje)"
            }
          >
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        )}
        <Field
          label={required ? "Motivo (obrigatório)" : "Observação (opcional)"}
        >
          <textarea
            required={required}
            maxLength={2000}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Voltar
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Salvando..." : label}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Busca e vínculo de registros (ocorrência, OS ou intervenção) pelo código ou texto. */
export function LinkSearch({
  label,
  path,
  describe,
  exclude,
  onLink,
  worksStatus = false,
}: {
  label: string;
  path: string;
  describe: (r: Row) => string;
  exclude: string[];
  onLink: (r: Row) => Promise<void>;
  worksStatus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="link-search">
      <form
        className="inline-form"
        role="search"
        aria-label={label}
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            const r = await api(
              `${path}?limit=10&q=${encodeURIComponent(q.trim())}`,
            );
            setResults(r.items.filter((x: Row) => !exclude.includes(x.id)));
          } catch (err: any) {
            setError(err.message);
          }
        }}
      >
        <label className="field">
          <span>{label}</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Código, endereço ou responsável"
          />
        </label>
        <button className="button secondary">Buscar</button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {results && (
        <ul
          className="link-results"
          aria-live="polite"
          aria-label={`Resultados: ${label}`}
        >
          {!results.length && (
            <li className="muted">Nenhum registro encontrado.</li>
          )}
          {results.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.code}</strong> {describe(r)}
              </span>
              {worksStatus ? (
                <WorksBadge status={r.status} />
              ) : (
                <Badge status={r.status} />
              )}
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await onLink(r);
                    setResults(results.filter((x) => x.id !== r.id));
                  } catch (err: any) {
                    setError(err.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Vincular {r.code}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
