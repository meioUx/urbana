import { useState } from "react";
import type { Boot, Row } from "../../shared/types";
import { Field, Modal } from "../../shared/ui";
import { Check } from "lucide-react";

export default function CatalogForm({
  kind,
  item,
  boot,
  onClose,
  onSave,
}: {
  kind: string;
  item?: Row;
  boot: Boot;
  user?: any;
  onClose: () => void;
  onSave: (d: any) => Promise<void>;
}) {
  const [d, setD] = useState<any>(
    item || {
      name: "",
      subcategories: [],
      sector_id: boot.catalogs.find((c) => c.kind === "setores")?.id || "",
      sla: {
        Emergencial: 24,
        Alta: 48,
        Média: 120,
        Baixa: 240,
        Programada: 360,
      },
      require_before: true,
      require_after: true,
      require_material: false,
      unit: "kg",
      unit_cost: 0,
      minimum_stock: 0,
      leader: "",
      members: 1,
      code: "",
      parent_id: "",
    },
  );
  const [subs, setSubs] = useState(item?.subcategories?.join(", ") || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setD({ ...d, [k]: v });
  return (
    <Modal
      title={`${item ? "Editar" : "Novo cadastro"} · ${kind}`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave({
              ...d,
              subcategories: subs
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean),
            });
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Nome">
          <input
            required
            value={d.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        {["equipes", "categorias"].includes(kind) && (
          <Field label="Setor responsável">
            <select
              required
              value={d.sector_id}
              onChange={(e) => set("sector_id", e.target.value)}
            >
              {boot.catalogs
                .filter((c) => c.kind === "setores")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {kind === "categorias" && (
          <>
            <Field label="Subcategorias (separadas por vírgula)">
              <input
                required
                value={subs}
                onChange={(e) => setSubs(e.target.value)}
              />
            </Field>
            <h3>SLA por prioridade (horas)</h3>
            <div className="form-grid">
              {boot.priorities.map((p) => (
                <Field label={p} key={p}>
                  <input
                    required
                    type="number"
                    min="1"
                    max="8760"
                    value={d.sla[p]}
                    onChange={(e) =>
                      set("sla", { ...d.sla, [p]: Number(e.target.value) })
                    }
                  />
                </Field>
              ))}
            </div>
            <h3>Evidências obrigatórias</h3>
            {[
              ["require_before", "Foto antes de iniciar"],
              ["require_after", "Foto após o serviço"],
              ["require_material", "Material utilizado"],
            ].map(([k, l]) => (
              <label className="checkbox" key={k}>
                <input
                  type="checkbox"
                  checked={d[k]}
                  onChange={(e) => set(k, e.target.checked)}
                />
                {l}
              </label>
            ))}
          </>
        )}
        {kind === "materiais" && (
          <div className="form-grid">
            <Field label="Unidade">
              <input
                required
                value={d.unit}
                onChange={(e) => set("unit", e.target.value)}
              />
            </Field>
            <Field label="Custo unitário (R$)">
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={d.unit_cost}
                onChange={(e) => set("unit_cost", Number(e.target.value))}
              />
            </Field>
            <Field label="Estoque mínimo">
              <input
                type="number"
                min="0"
                step="0.001"
                required
                value={d.minimum_stock || 0}
                onChange={(e) => set("minimum_stock", Number(e.target.value))}
              />
            </Field>
          </div>
        )}
        {kind === "equipes" && (
          <>
            <Field label="Responsável">
              <input
                required
                value={d.leader}
                onChange={(e) => set("leader", e.target.value)}
              />
            </Field>
            <Field label="Quantidade de integrantes">
              <input
                type="number"
                min="1"
                required
                value={d.members}
                onChange={(e) => set("members", Number(e.target.value))}
              />
            </Field>
          </>
        )}
        {kind === "equipamentos" && (
          <Field label="Código patrimonial">
            <input
              required
              value={d.code}
              onChange={(e) => set("code", e.target.value)}
            />
          </Field>
        )}
        {["departamentos", "setores"].includes(kind) && (
          <Field
            label={kind === "departamentos" ? "Secretaria" : "Departamento"}
          >
            <select
              required
              value={d.parent_id}
              onChange={(e) => set("parent_id", e.target.value)}
            >
              <option value="">Selecione</option>
              {boot.catalogs
                .filter(
                  (c) =>
                    c.kind ===
                    (kind === "departamentos"
                      ? "secretarias"
                      : "departamentos"),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            <Check size={16} />
            Salvar cadastro
          </button>
        </div>
      </form>
    </Modal>
  );
}
