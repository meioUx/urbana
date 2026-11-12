import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { Empty } from "../../shared/ui";
import { featureStyle, worksColors, worksLabels } from "../works/labels";
import { inkColor } from "../../shared/workflow";
import type { MapOverlay } from "./GeoMap";

const ACTIVE = "PLANEJADA,EM_ANDAMENTO,PARALISADA";

/**
 * Camada de intervenções do mapa territorial (módulo Obras e intervenções), carregada sob demanda:
 * controles (mostrar e filtrar por situação), legenda, GeoJSON entregue ao mapa por onOverlays e a
 * lista textual das intervenções exibidas, alternativa acessível ao desenho no mapa.
 */
export default function InterventionLayer({
  lastSync,
  onOverlays,
  onOpenIntervention,
}: {
  lastSync: string;
  onOverlays: (overlays: MapOverlay[]) => void;
  onOpenIntervention: (id: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState(ACTIVE);
  const [features, setFeatures] = useState<any[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!show) {
      onOverlays([]);
      return;
    }
    let cancelled = false;
    api(`/intervencoes/geojson${status ? `?status=${status}` : ""}`)
      .then((data) => {
        if (cancelled) return;
        setFeatures(data.features);
        setError("");
        onOverlays([
          {
            id: "interventions",
            data: { type: "FeatureCollection", features: data.features } as any,
            options: {
              style: (f: any) => featureStyle(f?.properties?.status) as any,
              onEachFeature: (f: any, layer: any) =>
                layer.bindTooltip(
                  `${f.properties.code} · ${f.properties.title} (${worksLabels[f.properties.status]})`,
                ),
            },
          },
        ]);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [show, status, lastSync]); // eslint-disable-line react-hooks/exhaustive-deps -- onOverlays é um setter estável
  useEffect(() => () => onOverlays([]), []); // eslint-disable-line react-hooks/exhaustive-deps -- limpa a camada ao sair
  return (
    <div
      className="works-layer"
      role="group"
      aria-label="Camada de intervenções"
    >
      <div className="section-heading">
        <h2>Intervenções</h2>
        {show && <span>{features.length}</span>}
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
        />
        Mostrar intervenções no mapa
      </label>
      {show && (
        <>
          <select
            aria-label="Situação das intervenções no mapa"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value={ACTIVE}>Intervenções ativas</option>
            <option value="">Todas as situações</option>
            {Object.entries(worksLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {error && <p role="alert">{error}</p>}
          <div className="legend">
            {Object.entries(worksLabels).map(([s, l]) => (
              <span key={s}>
                <i
                  style={{
                    background: worksColors[s],
                    borderRadius: 0,
                    height: 4,
                  }}
                />
                {l}
              </span>
            ))}
          </div>
          {features.map((f) => (
            <button
              className="map-result"
              key={f.id}
              onClick={() => onOpenIntervention(f.id)}
            >
              <strong>{f.properties.title}</strong>
              <small>
                {f.properties.code} · {f.properties.location}
              </small>
              <span
                className="badge"
                style={{
                  color: inkColor(worksColors[f.properties.status]),
                  background: `${worksColors[f.properties.status]}13`,
                }}
              >
                {worksLabels[f.properties.status]}
              </span>
            </button>
          ))}
          {!features.length && !error && (
            <Empty text="Nenhuma intervenção para a situação escolhida." />
          )}
        </>
      )}
    </div>
  );
}
