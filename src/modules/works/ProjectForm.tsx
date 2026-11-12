import { useState } from "react";
import { api } from "../../shared/api";
import type { Row } from "../../shared/types";
import { Field, Modal } from "../../shared/ui";

/** Cadastro e edição da obra (identificação, descrição, responsável e período previsto). */
export default function ProjectForm({
  item,
  onClose,
  onSaved,
}: {
  item?: Row | null;
  onClose: () => void;
  onSaved: (detail: Row, created: boolean) => void;
}) {
  const [form, setForm] = useState({
    title: item?.title || "",
    description: item?.description || "",
    responsible: item?.responsible || "",
    planned_start: item?.planned_start || "",
    planned_end: item?.planned_end || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const set = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  return (
    <Modal title={item ? `Editar ${item.code}` : "Nova obra"} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (form.planned_end < form.planned_start) {
            setError(
              "A data final prevista deve ser igual ou posterior à data inicial.",
            );
            return;
          }
          setSaving(true);
          try {
            onSaved(
              item
                ? await api(`/obras/${item.id}`, "PATCH", {
                    ...form,
                    version: item.version,
                  })
                : await api("/obras", "POST", {
                    ...form,
                    request_id: requestId,
                  }),
              !item,
            );
          } catch (err: any) {
            setError(
              err.code === "VERSION_CONFLICT"
                ? "Outro usuário alterou esta obra depois que você a abriu. Feche, atualize e refaça a alteração."
                : err.message,
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <p className="muted">
          Cronograma físico, custos, medições e fiscalização da obra ainda não
          estão disponíveis.
        </p>
        <div className="form-grid">
          <Field label="Nome da obra" wide>
            <input
              required
              minLength={3}
              maxLength={200}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label="Responsável" wide>
            <input
              required
              maxLength={200}
              value={form.responsible}
              onChange={(e) => set("responsible", e.target.value)}
            />
          </Field>
          <Field label="Início previsto">
            <input
              type="date"
              required
              value={form.planned_start}
              onChange={(e) => set("planned_start", e.target.value)}
            />
          </Field>
          <Field label="Término previsto">
            <input
              type="date"
              required
              min={form.planned_start}
              value={form.planned_end}
              onChange={(e) => set("planned_end", e.target.value)}
            />
          </Field>
          <Field label="Descrição" wide>
            <textarea
              maxLength={3000}
              rows={4}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" disabled={saving}>
            {saving
              ? "Salvando..."
              : item
                ? "Salvar alterações"
                : "Cadastrar obra"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
