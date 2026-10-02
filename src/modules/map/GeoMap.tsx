import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { createPortal } from "react-dom";
import OperationalPopup from "./OperationalPopup";
import "./territorial.css";
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
  loadSummary,
  onOpenFullMap,
}: {
  rows: Row[];
  onSelect?: (r: Row) => void;
  pick?: (lat: number, lng: number) => void;
  point?: [number, number];
  large?: boolean;
  heatmap?: boolean;
  overlays?: MapOverlay[];
  loadSummary?: (id: string) => Promise<any>;
  onOpenFullMap?: () => void;
}) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    group = useRef<L.LayerGroup | null>(null),
    handler = useRef(pick),
    select = useRef(onSelect),
    summary = useRef(loadSummary);
  summary.current = loadSummary;
  const [popup, setPopup] = useState<{id: string; element: HTMLElement} | null>(null);
  const selectedMarker = useRef<HTMLElement | null>(null);
  const summaryCache = useRef(new Map<string, {time: number; request: Promise<any>}>());
  const getSummary = (id: string) => {
    const cached = summaryCache.current.get(id);
    if (cached && Date.now() - cached.time < 30000) return cached.request;
    const request = summary.current!(id).catch(error => { summaryCache.current.delete(id); throw error; });
    if (summaryCache.current.size >= 20) summaryCache.current.delete(summaryCache.current.keys().next().value!);
    summaryCache.current.set(id, {time: Date.now(), request});
    return request;
  };
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
    m.on("popupclose", () => setPopup(null));
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && element.current?.querySelector(".operational-popup")) {
        m.closePopup(); selectedMarker.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    m.on("click", (e) => handler.current?.(e.latlng.lat, e.latlng.lng));
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", escape);
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
    map.current?.closePopup();
    g.clearLayers();
    rows.forEach((r) => {
      if (mapMode === "heat" && heatmap) return;
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return;
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
      const open = () => {
        if (!summary.current) { select.current?.(r); return; }
        selectedMarker.current = marker.getElement() as HTMLElement;
        const content = document.createElement("div");
        const dedicated = !!element.current?.closest(".territorial-view");
        const compact = window.innerWidth <= 700;
        const availableHeight = Math.min(window.innerHeight, map.current!.getSize().y);
        marker.bindPopup(content, {className:"operational-popup", minWidth:240, maxWidth:440, maxHeight: Math.max(100, availableHeight - (dedicated ? compact ? 330 : 230 : 130)), autoPanPaddingTopLeft:L.point(20,dedicated ? 110 : 20), autoPanPaddingBottomRight:L.point(20,dedicated && compact ? 150 : 60)}).openPopup();
        content.tabIndex = -1;
        content.setAttribute("role", "region");
        content.setAttribute("aria-label", "Resumo operacional");
        content.addEventListener("keydown", event => { if (event.key === "Escape") {event.stopPropagation(); map.current?.closePopup(); (marker.getElement() as HTMLElement | undefined)?.focus();} });
        const observer = new MutationObserver(() => marker.getPopup()?.update());
        observer.observe(content, {childList:true, subtree:true, characterData:true});
        marker.once("popupclose", () => observer.disconnect());
        setPopup({id:r.id, element:content});
        content.focus();
      };
      marker.on("click", open);
      const node = marker.getElement();
      if (node) {
        node.setAttribute("tabindex", "0"); node.setAttribute("role", "button"); node.setAttribute("aria-label", `Abrir serviço em ${r.address || r.code}`);
        L.DomEvent.on(node as HTMLElement, "keydown", (event: Event) => { const e = event as KeyboardEvent; if (e.key === "Enter" || e.key === " ") {e.preventDefault(); open();} });
      }
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
      {popup && loadSummary && createPortal(<OperationalPopup key={popup.id} id={popup.id} load={getSummary} onOpen={onSelect ? () => { const row = rows.find(r => r.id === popup.id); if (row) { map.current?.closePopup(); onSelect(row); } } : undefined}/>, popup.element)}
      {heatmap && (
        <div
          className="heat-controls"
          role="group"
          aria-label="Visualização do mapa"
        >
          <div className="heat-control-buttons">
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
          {onOpenFullMap && <button type="button" className="button secondary" onClick={onOpenFullMap}>Abrir mapa completo ↗</button>}
          </div>
          <span className="heat-count">{rows.length} ocorrências nos filtros atuais</span>
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
