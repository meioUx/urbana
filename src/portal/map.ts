// Map picker of the citizen portal, loaded on demand (dynamic import) so the form opens fast on slow
// networks. Same tile provider as the rest of the app (VITE_MAP_TILE_URL), allowed by the CSP img-src.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { mapTileProvider } from "../modules/map/config";

// Same default center as the internal registration form.
const DEFAULT_CENTER: [number, number] = [-26.992, -48.635];

export function createPicker(
  element: HTMLElement,
  initial: { lat: number; lng: number } | null,
  onPick: (lat: number, lng: number) => void,
) {
  const map = L.map(element, { keyboard: true, zoomControl: true }).setView(
    initial ? [initial.lat, initial.lng] : DEFAULT_CENTER,
    initial ? 17 : 14,
  );
  L.tileLayer(mapTileProvider.url, {
    attribution: mapTileProvider.attribution,
    maxZoom: mapTileProvider.maxZoom,
  }).addTo(map);
  let marker: L.CircleMarker | null = null;
  const place = (lat: number, lng: number) => {
    if (marker) marker.setLatLng([lat, lng]);
    else
      marker = L.circleMarker([lat, lng], {
        radius: 11,
        color: "#0b5d47",
        weight: 3,
        fillColor: "#1f9d78",
        fillOpacity: 0.55,
      }).addTo(map);
  };
  if (initial) place(initial.lat, initial.lng);
  map.on("click", (event: L.LeafletMouseEvent) => {
    place(event.latlng.lat, event.latlng.lng);
    onPick(event.latlng.lat, event.latlng.lng);
  });
  return {
    useCenter() {
      const center = map.getCenter();
      place(center.lat, center.lng);
      onPick(center.lat, center.lng);
    },
    show(lat: number, lng: number) {
      place(lat, lng);
      map.setView([lat, lng], 17);
    },
    refresh() {
      map.invalidateSize();
    },
  };
}
