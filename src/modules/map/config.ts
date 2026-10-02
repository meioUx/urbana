import { resolveMapTileProvider } from "./tile-provider.mjs";
export const mapTileProvider = resolveMapTileProvider(import.meta.env);
