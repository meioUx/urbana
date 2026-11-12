import { useState, type ReactNode } from "react";
import { hasModuleAccess } from "../../../shared/authorization.mjs";
import { api } from "../../shared/api";
import { lazyModule } from "../../shared/lazyModule";
import type { Boot, Row } from "../../shared/types";
import { Badge, Empty } from "../../shared/ui";
import { colors, labels } from "../../shared/workflow";
import type { MapOverlay } from "./GeoMap";
import { GeoMap } from "./LazyGeoMap";
const InterventionLayer = lazyModule(() => import("./InterventionLayer"));

/** Página "Mapa territorial" dentro da área de gestão (mapa, legenda e lista de resultados). */
export default function MapPage({
  filters,
  rows,
  onOpen,
  onOpenFullMap,
  boot,
  lastSync,
  onOpenIntervention,
}: {
  filters: ReactNode;
  rows: Row[];
  onOpen: (type: string, id: string) => void;
  onOpenFullMap: () => void;
  boot: Boot;
  lastSync: string;
  onOpenIntervention: (id: string) => void;
}) {
  const filtered = rows;
  // Camada de intervenções só para quem tem o módulo Obras e intervenções.
  const [overlays, setOverlays] = useState<MapOverlay[]>([]);
  return (
    <>
      {filters}
      <div className="map-layout" data-guide="map">
        <div>
          <GeoMap
            rows={filtered}
            onSelect={(r) => onOpen("occurrence", r.id)}
            onOpenFullMap={onOpenFullMap}
            heatmap
            loadSummary={(id) => api(`/mapa/ocorrencias/${id}/resumo`)}
            overlays={overlays}
            large
          />
          <div className="legend">
            {Object.entries(labels).map(([s, l]) => (
              <span key={s}>
                <i style={{ background: colors[s] }} />
                {l}
              </span>
            ))}
          </div>
        </div>
        <section className="map-results">
          {hasModuleAccess(boot.user, "works") && (
            <InterventionLayer
              lastSync={lastSync}
              onOverlays={setOverlays}
              onOpenIntervention={onOpenIntervention}
            />
          )}
          <div className="section-heading">
            <h2>No mapa</h2>
            <span>{filtered.length}</span>
          </div>
          {filtered.map((r) => (
            <button
              className="map-result"
              key={r.id}
              onClick={() => onOpen("occurrence", r.id)}
            >
              <strong>{r.address}</strong>
              <small>
                {r.code} · {r.neighborhood}
              </small>
              <Badge status={r.status} />
            </button>
          ))}
          {!filtered.length && (
            <Empty text="Nenhum registro para os filtros." />
          )}
        </section>
      </div>
    </>
  );
}
