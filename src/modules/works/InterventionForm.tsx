import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Geometry } from "../../../shared/geometry.mjs";
import { api } from "../../shared/api";
import type { Boot, Row } from "../../shared/types";
import { Field, Modal } from "../../shared/ui";
import GeometryEditor from "./GeometryEditor";
import { ConflictList } from "./parts";
import { scopeLabels } from "./model";

type Service = { description: string; quantity: string; unit: string };

/** Cadastro e edição de intervenção, com aviso (não bloqueio) de conflitos antes de salvar. */
export default function InterventionForm({
  boot,
  item,
  onClose,
  onSaved,
}: {
  boot: Boot;
  item?: Row | null;
  onClose: () => void;
  onSaved: (detail: Row, created: boolean) => void;
}) {
  const [form, setForm] = useState(() => ({
    title: item?.title || "",
    description: item?.description || "",
    scope: item?.scope || "TRECHO",
    location: item?.location || "",
    neighborhood: item?.neighborhood || "",
    sector_id: item?.sector_id || "",
    responsible: item?.responsible || "",
    priority: item?.priority || "Média",
    planned_start: item?.planned_start || "",
    planned_end: item?.planned_end || "",
  }));
  const [services, setServices] = useState<Service[]>(() =>
    (item?.services || []).map((s: any) => ({
      description: s.description,
      quantity: s.quantity == null ? "" : String(s.quantity),
      unit: s.unit || "",
    })),
  );
  const [geometry, setGeometry] = useState<Geometry | null>(
    item?.geometry || null,
  );
  const [geometryTouched, setGeometryTouched] = useState(false);
  const [geometryError, setGeometryError] = useState("");
  const [conflicts, setConflicts] = useState<Row[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const set = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const sectors = boot.catalogs.filter((c) => c.kind === "setores");
  const checkKey = JSON.stringify([
    geometry,
    form.planned_start,
    form.planned_end,
  ]);
  useEffect(() => {
    if (
      !geometry ||
      !form.planned_start ||
      !form.planned_end ||
      form.planned_end < form.planned_start
    ) {
      setConflicts(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setChecking(true);
      try {
        const r = await api("/intervencoes/conflitos", "POST", {
          geometry,
          planned_start: form.planned_start,
          planned_end: form.planned_end,
          exclude_id: item?.id,
        });
        if (!cancelled) setConflicts(r.conflicts);
      } catch {
        if (!cancelled) setConflicts(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [checkKey]); // eslint-disable-line react-hooks/exhaustive-deps -- checkKey resume geometria e período
  const submit = async () => {
    setError("");
    if (!geometry) {
      setError(
        geometryError ||
          "Desenhe a geometria no mapa ou informe as coordenadas dos pontos.",
      );
      return;
    }
    if (
      form.planned_end &&
      form.planned_start &&
      form.planned_end < form.planned_start
    ) {
      setError(
        "A data final prevista deve ser igual ou posterior à data inicial.",
      );
      return;
    }
    const body: Record<string, any> = {
      ...form,
      sector_id: form.sector_id || null,
      services: services
        .filter((s) => s.description.trim())
        .map((s) => ({
          description: s.description.trim(),
          quantity: s.quantity.trim()
            ? Number(s.quantity.replace(",", "."))
            : null,
          unit: s.unit.trim(),
        })),
    };
    if (!item || geometryTouched) body.geometry = geometry;
    setSaving(true);
    try {
      const saved = item
        ? await api(`/intervencoes/${item.id}`, "PATCH", {
            ...body,
            version: item.version,
          })
        : await api("/intervencoes", "POST", {
            ...body,
            request_id: requestId,
          });
      onSaved(saved, !item);
    } catch (e: any) {
      setError(
        e.code === "VERSION_CONFLICT"
          ? "Outro usuário alterou esta intervenção depois que você a abriu. Feche o formulário, atualize o registro e refaça a alteração."
          : e.details?.fieldErrors
            ? `${e.message} ${Object.entries(e.details.fieldErrors)
                .map(([k, v]: any) => `${k}: ${v.join(", ")}`)
                .join("; ")}`
            : e.message,
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={item ? `Editar ${item.code}` : "Nova intervenção"}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="form-grid">
          <Field label="Título" wide>
            <input
              required
              minLength={3}
              maxLength={200}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label="Abrangência">
            <select
              value={form.scope}
              onChange={(e) => set("scope", e.target.value)}
            >
              {Object.entries(scopeLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prioridade">
            <select
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
            >
              {boot.priorities.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Local (trecho, área ou ativo)" wide>
            <input
              required
              maxLength={300}
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="Ex.: Av. Central, entre a Rua 1500 e a Rua 1600"
            />
          </Field>
          <Field label="Bairro">
            <input
              maxLength={120}
              value={form.neighborhood}
              onChange={(e) => set("neighborhood", e.target.value)}
            />
          </Field>
          <Field label="Setor (opcional)">
            <select
              value={form.sector_id}
              onChange={(e) => set("sector_id", e.target.value)}
            >
              <option value="">Sem setor</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Responsável">
            <input
              required
              maxLength={200}
              value={form.responsible}
              onChange={(e) => set("responsible", e.target.value)}
            />
          </Field>
          <div />
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
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
        </div>
        <fieldset className="services-editor">
          <legend>Serviços previstos</legend>
          {services.map((s, i) => (
            <div className="service-row" key={i}>
              <label className="field">
                <span>Serviço {i + 1}</span>
                <input
                  maxLength={300}
                  value={s.description}
                  onChange={(e) =>
                    setServices(
                      services.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Quantidade</span>
                <input
                  inputMode="decimal"
                  value={s.quantity}
                  onChange={(e) =>
                    setServices(
                      services.map((x, j) =>
                        j === i ? { ...x, quantity: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Unidade</span>
                <input
                  maxLength={20}
                  value={s.unit}
                  onChange={(e) =>
                    setServices(
                      services.map((x, j) =>
                        j === i ? { ...x, unit: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="text-button"
                aria-label={`Remover serviço ${i + 1}`}
                onClick={() => setServices(services.filter((_, j) => j !== i))}
              >
                Remover
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setServices([
                ...services,
                { description: "", quantity: "", unit: "" },
              ])
            }
          >
            Adicionar serviço
          </button>
        </fieldset>
        <GeometryEditor
          initial={item?.geometry}
          onChange={(g, e) => {
            setGeometry(g);
            setGeometryError(e);
            setGeometryTouched(true);
          }}
        />
        <div className="conflict-check" aria-live="polite">
          {checking && (
            <p className="muted">
              Verificando conflitos com outras intervenções...
            </p>
          )}
          {!checking && conflicts && conflicts.length > 0 && (
            <div className="notice warning" role="status">
              <TriangleAlert size={18} />
              <div>
                <strong>
                  Atenção:{" "}
                  {conflicts.length === 1
                    ? "1 intervenção ativa ocupa"
                    : `${conflicts.length} intervenções ativas ocupam`}{" "}
                  o mesmo local no mesmo período.
                </strong>
                <p>
                  Você pode salvar mesmo assim; depois, registre no detalhe como
                  o conflito foi avaliado.
                </p>
                <ConflictList conflicts={conflicts} />
              </div>
            </div>
          )}
          {!checking && conflicts && conflicts.length === 0 && (
            <p className="muted">
              Nenhum conflito de local e período com intervenções ativas.
            </p>
          )}
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
                : "Cadastrar intervenção"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
