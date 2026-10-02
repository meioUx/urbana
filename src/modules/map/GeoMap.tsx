import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { GeoJsonObject } from "geojson";
import { mapTileProvider } from "./config";

// Independent operational overlays: works, interventions, road segments, closures and mobility.
export type MapOverlay = { id: string; data: GeoJsonObject; options?: L.GeoJSONOptions };
import { LocateFixed } from "lucide-react";
import { heatLayer } from "../../heat-layer";
import { colors } from "../../shared/workflow";
import "leaflet/dist/leaflet.css";
type Row = { id: string; [key: string]: any };
export default function GeoMap({
  rows,
  onSelect,
  pick,
  point,
  large = false,
  heatmap = false,
  overlays,
}: {
  rows: Row[];
  onSelect?: (r: Row) => void;
  pick?: (lat: number, lng: number) => void;
  point?: [number, number];
  large?: boolean;
  heatmap?: boolean;
  overlays?: MapOverlay[];
}) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    group = useRef<L.LayerGroup | null>(null),
    handler = useRef(pick),
    select = useRef(onSelect);
  handler.current = pick;
  select.current = onSelect;
  const [mapError, setMapError] = useState(false);
  const [mapMode, setMapMode] = useState("points");
  useEffect(() => {
    if (!map.current || mapMode !== "heat" || !heatmap) return;
    const layer = heatLayer(
      rows
        .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
        .map((r) => [r.lat, r.lng] as [number, number]),
    );
    layer.addTo(map.current);
    return () => {
      layer.remove();
    };
  }, [rows, mapMode, heatmap]);
  useEffect(() => {
    if (!element.current) return;
    const m = L.map(element.current, {
      zoomControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([-26.998, -48.638], 13);
    map.current = m;
    L.control.zoom({ position: "bottomright" }).addTo(m);
    const tiles = L.tileLayer(mapTileProvider.url, {
      attribution: mapTileProvider.attribution,
      maxZoom: mapTileProvider.maxZoom,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 0,
    }).addTo(m);
    tiles.on("tileerror", () => setMapError(true));
    tiles.on("tileload", () => setMapError(false));
    group.current = L.layerGroup().addTo(m);
    m.on("click", (e) => handler.current?.(e.latlng.lat, e.latlng.lng));
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      m.stop();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    const layers = (overlays || []).map(({ data, options }) =>
      L.geoJSON(data, options).addTo(map.current!),
    );
    return () => { layers.forEach((layer) => layer.remove()); };
  }, [overlays]);
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.clearLayers();
    rows.forEach((r) => {
      if (mapMode === "heat" && heatmap) return;
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: colors[r.status] || "#15765d",
        fillOpacity: 1,
      }).addTo(g);
      const tip = document.createElement("span");
      tip.textContent = `${r.code} · ${r.address}`;
      marker.bindTooltip(tip);
      marker.on("click", () => select.current?.(r));
    });
    if (point) {
      L.circleMarker(point, {
        radius: 10,
        color: "#fff",
        weight: 3,
        fillColor: "#14785f",
        fillOpacity: 1,
      }).addTo(g);
      map.current?.setView(point, 16);
    }
  }, [rows, point?.[0], point?.[1], mapMode, heatmap]);
  return (
    <>
      {heatmap && (
        <div
          className="heat-controls"
          role="group"
          aria-label="Visualização do mapa"
        >
          <button
            type="button"
            className="button secondary"
            aria-pressed={mapMode === "points"}
            onClick={() => setMapMode("points")}
          >
            Pontos de ocorrências
          </button>
          <button
            type="button"
            className="button secondary"
            aria-pressed={mapMode === "heat"}
            onClick={() => setMapMode("heat")}
          >
            Mapa de calor
          </button>
          <span>{rows.length} ocorrências nos filtros atuais</span>
        </div>
      )}
      <div className={`map-wrap ${large ? "large" : ""}`}>
        <div className="map" ref={element} />
        {(mapError || mapTileProvider.placeholder) && (
          <div className="map-warning">
            {mapTileProvider.placeholder
              ? "Grade local de desenvolvimento, sem cartografia. Configure o provider para o mapa-base."
              : "Mapa-base indisponível. Os registros continuam acessíveis."}
          </div>
        )}
        <button
          className="map-home icon"
          type="button"
          title="Enquadrar ocorrências"
          onClick={() => {
            if (rows.length)
              map.current?.fitBounds(
                L.latLngBounds(
                  rows.map((r) => [r.lat, r.lng] as [number, number]),
                ),
                { padding: [35, 35], maxZoom: 15 },
              );
            else map.current?.setView([-26.998, -48.638], 13);
          }}
        >
          <LocateFixed size={18} />
        </button>
      </div>
      {heatmap && mapMode === "heat" && (
        <div className="heat-legend" role="status">
          <span className="heat-ramp" />
          <span>Menor → maior concentração de ocorrências</span>
          <small>
            Cada ocorrência tem o mesmo peso. A concentração varia com o zoom e
            respeita os filtros. Selecione um registro na lista ou volte aos
            pontos para abrir o detalhe.
          </small>
        </div>
      )}
    </>
  );
}
