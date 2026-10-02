// One provider configuration for all maps; custom providers can override OpenStreetMap.
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export function resolveMapTileProvider(env = {}) {
  const url = env.VITE_MAP_TILE_URL?.trim() || OSM_TILE_URL;
  if (url === "/map-development-tile.svg") return {
    url: "/map-development-tile.svg",
    attribution: "Urbana · grade local de desenvolvimento (sem cartografia)",
    maxZoom: 19,
    placeholder: true,
  };
  const isOsm = /(?:^|\/\/)(?:[^/]+\.)?tile\.openstreetmap\.org(?:[/:]|$)/i.test(url);
  if (isOsm && url !== OSM_TILE_URL)
    throw new Error("OpenStreetMap exige a URL canônica https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  const configuredAttribution = env.VITE_MAP_ATTRIBUTION?.trim();
  const attribution = isOsm
    ? (configuredAttribution ? `${configuredAttribution} · ${OSM_ATTRIBUTION}` : OSM_ATTRIBUTION)
    : configuredAttribution || "";
  if (!attribution) throw new Error("Configure VITE_MAP_ATTRIBUTION para o provider de tiles.");
  const maxZoom = Number(env.VITE_MAP_MAX_ZOOM || 19);
  if (!Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > 22)
    throw new Error("VITE_MAP_MAX_ZOOM deve ser um inteiro entre 0 e 22.");
  return { url, attribution, maxZoom, placeholder: false };
}
