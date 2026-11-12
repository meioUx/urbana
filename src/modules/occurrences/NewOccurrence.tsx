import { useState } from "react";
import type { Boot, Row } from "../../shared/types";
import { Field, Modal } from "../../shared/ui";
import { GeoMap } from "../map/LazyGeoMap";
import {
  OPEN_OCCURRENCE_STATUSES,
  useServerData,
} from "../workspace/useServerData";
import { Check, ClipboardList, LocateFixed, MapPin } from "lucide-react";

export default function NewOccurrence({
  boot,
  onClose,
  onSave,
}: {
  boot: Boot;
  onClose: () => void;
  onSave: (d: any, f: File | null) => Promise<void>;
}) {
  // Ocorrências em andamento como referência no mapa de escolha do ponto (as encerradas não entram).
  const context = useServerData<Row[]>(
    `/ocorrencias?status=${OPEN_OCCURRENCE_STATUSES.join(",")}`,
  );
  const cats = boot.catalogs.filter((c) => c.kind === "categorias");
  const [data, setData] = useState<any>({
    category_id: cats[0]?.id || "",
    subcategory: cats[0]?.subcategories[0] || "",
    description: "",
    priority: "Média",
    origin: "Fiscalização municipal",
    requested_by: "",
    phone: "",
    address: "",
    neighborhood: "",
    reference: "",
    lat: -26.992,
    lng: -48.635,
  });
  const [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [nearby, setNearby] = useState<Row[]>([]),
    [locating, setLocating] = useState(false);
  const set = (k: string, v: any) => setData((d: any) => ({ ...d, [k]: v }));
  const choosePoint = async (lat: number, lng: number) => {
    setData((d: any) => ({
      ...d,
      lat,
      lng,
      duplicate_action: undefined,
      duplicate_id: undefined,
    }));
    setNearby([]);
  };
  const gps = () => {
    setLocating(true);
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(
          (p) => {
            choosePoint(p.coords.latitude, p.coords.longitude);
            setLocating(false);
          },
          () => {
            setError(
              "Não foi possível obter o GPS. Selecione o ponto no mapa ou informe as coordenadas.",
            );
            setLocating(false);
          },
          { enableHighAccuracy: true, timeout: 10000 },
        )
      : (setError("GPS indisponível."), setLocating(false));
  };
  return (
    <Modal title="Nova ocorrência" onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            await onSave(data, file);
          } catch (err: any) {
            setError(err.message);
            if (err.status === 409) setNearby(err.details?.nearby || []);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-section-title">
          <MapPin size={18} />
          <h3>Localização</h3>
          <button
            type="button"
            className="text-button"
            disabled={locating}
            onClick={gps}
          >
            <LocateFixed size={16} />
            {locating ? "Localizando..." : "Usar meu GPS"}
          </button>
        </div>

        <GeoMap
          rows={context.data || []}
          pick={choosePoint}
          point={[data.lat, data.lng]}
        />
        {context.loading && (
          <small role="status">
            Carregando as ocorrências em andamento no mapa...
          </small>
        )}
        {context.error && (
          <small role="status">
            Não foi possível exibir as ocorrências em andamento no mapa. O
            registro continua disponível.
          </small>
        )}
        <div className="form-grid">
          <Field label="Latitude">
            <input
              type="number"
              step="any"
              min="-90"
              max="90"
              required
              value={data.lat}
              onChange={(e) => choosePoint(Number(e.target.value), data.lng)}
            />
          </Field>
          <Field label="Longitude">
            <input
              type="number"
              step="any"
              min="-180"
              max="180"
              required
              value={data.lng}
              onChange={(e) => choosePoint(data.lat, Number(e.target.value))}
            />
          </Field>
          <Field label="Endereço">
            <input
              required
              value={data.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
          <Field label="Bairro">
            <input
              required
              value={data.neighborhood}
              onChange={(e) => set("neighborhood", e.target.value)}
            />
          </Field>
        </div>
        <div className="form-section-title">
          <ClipboardList size={18} />
          <h3>Identificação da demanda</h3>
        </div>
        <div className="form-grid">
          <Field label="Categoria">
            <select
              value={data.category_id}
              onChange={(e) => {
                const c = cats.find((c) => c.id === e.target.value)!;
                setData({
                  ...data,
                  category_id: c.id,
                  subcategory: c.subcategories[0],
                });
              }}
            >
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subcategoria">
            <select
              value={data.subcategory}
              onChange={(e) => set("subcategory", e.target.value)}
            >
              {cats
                .find((c) => c.id === data.category_id)
                ?.subcategories.map((s: string) => (
                  <option key={s}>{s}</option>
                ))}
            </select>
          </Field>
          <Field label="Origem">
            <select
              value={data.origin}
              onChange={(e) => set("origin", e.target.value)}
            >
              {[
                "Fiscalização municipal",
                "Equipe de manutenção",
                "Cidadão",
                "BC Digital",
                "Central de atendimento",
                "Integração externa",
                "Sensor",
                "Importação administrativa",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Prioridade">
            <select
              value={data.priority}
              onChange={(e) => set("priority", e.target.value)}
            >
              {boot.priorities.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Descrição" wide>
            <textarea
              required
              value={data.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
            />
          </Field>
          <Field label="Referência" wide>
            <input
              value={data.reference}
              onChange={(e) => set("reference", e.target.value)}
            />
          </Field>
          <Field label="Foto do local" wide>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Field>
        </div>
        {nearby.length > 0 && (
          <div className="duplicate">
            <h3>Ocorrências próximas</h3>
            {nearby.map((o) => (
              <label key={o.id}>
                <input
                  type="radio"
                  name="duplicate"
                  checked={
                    data.duplicate_id === o.id &&
                    data.duplicate_action === "link"
                  }
                  onChange={() =>
                    setData({
                      ...data,
                      duplicate_action: "link",
                      duplicate_id: o.id,
                    })
                  }
                />
                <span>
                  Vincular a {o.code} · {o.address}
                </span>
              </label>
            ))}
            <label>
              <input
                type="radio"
                name="duplicate"
                checked={data.duplicate_action === "new"}
                onChange={() =>
                  setData({
                    ...data,
                    duplicate_action: "new",
                    duplicate_id: undefined,
                  })
                }
              />
              Manter como nova ocorrência
            </label>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            <Check size={17} />
            {busy ? "Registrando..." : "Registrar ocorrência"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
