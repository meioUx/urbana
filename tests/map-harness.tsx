import { createRoot } from "react-dom/client";
import GeoMap, { type MapOverlay } from "../src/modules/map/GeoMap";
import L from "leaflet";
import "../src/styles.css";
const overlays: MapOverlay[] = [
  { id: "obra", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-48.638, -26.998] } }, options: { pointToLayer: (_feature, point) => L.circleMarker(point) } },
  { id: "road-segment", data: { type: "LineString", coordinates: [[-48.64, -27], [-48.63, -26.99]] } },
  { id: "interdicao", data: { type: "Polygon", coordinates: [[[-48.645,-27.005],[-48.635,-27.005],[-48.635,-27],[-48.645,-27.005]]] } },
];
createRoot(document.getElementById("root")!).render(<GeoMap large heatmap rows={[{ id: "1", lat: -26.998, lng: -48.638, code: "OC-1", address: "Teste", status: "ABERTA" }]} overlays={overlays} onSelect={() => document.body.dataset.selected = "1"} />);
