export interface MapTileProvider {
  url: string;
  attribution: string;
  maxZoom?: number;
  placeholder?: boolean;
}
export interface MapTileEnvironment {
  VITE_MAP_TILE_URL?: string;
  VITE_MAP_ATTRIBUTION?: string;
  VITE_MAP_MAX_ZOOM?: string;
}
export const OSM_TILE_URL: string;
export function resolveMapTileProvider(env?: MapTileEnvironment): MapTileProvider;
