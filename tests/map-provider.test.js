import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMapTileProvider, OSM_TILE_URL } from "../src/modules/map/tile-provider.mjs";
import { mockMapTiles } from "./map-browser-fixture.mjs";

test("empty provider uses local grid without any remote URL", () => {
  const provider = resolveMapTileProvider({ VITE_MAP_TILE_URL: " " });
  assert.equal(provider.url, "/map-development-tile.svg");
  assert.equal(provider.placeholder, true);
});
test("configured provider and attribution are independent of operational layers", () => {
  assert.deepEqual(resolveMapTileProvider({
    VITE_MAP_TILE_URL: "https://maps.example/{z}/{x}/{y}.png",
    VITE_MAP_ATTRIBUTION: "© Provider", VITE_MAP_MAX_ZOOM: "17",
  }), { url: "https://maps.example/{z}/{x}/{y}.png", attribution: "© Provider", maxZoom: 17, placeholder: false });
  assert.throws(() => resolveMapTileProvider({ VITE_MAP_TILE_URL: "/tiles/{z}/{x}/{y}.png" }), /ATTRIBUTION/);
  assert.throws(() => resolveMapTileProvider({ VITE_MAP_TILE_URL: OSM_TILE_URL, VITE_MAP_MAX_ZOOM: "NaN" }), /MAX_ZOOM/);
});
test("explicit OSM uses canonical URL and always includes contributor attribution", () => {
  const provider = resolveMapTileProvider({ VITE_MAP_TILE_URL: OSM_TILE_URL, VITE_MAP_ATTRIBUTION: "Urbana" });
  assert.match(provider.attribution, /OpenStreetMap.*contributors/);
  for (const url of ["https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png", "http://tile.openstreetmap.org/{z}/{x}/{y}.png"])
    assert.throws(() => resolveMapTileProvider({ VITE_MAP_TILE_URL: url }), /canônica/);
});
test("headless fixture intercepts OSM images and blocks other OSM traffic before network", async () => {
  let handler;
  await mockMapTiles({ route: async (_, callback) => { handler = callback; } });
  for (const [url, type, expected] of [
    ["https://tile.openstreetmap.org/13/1/2.png", "image", "mock"],
    ["https://a.tile.openstreetmap.org/13/1/2.png", "image", "mock"],
    ["https://www.openstreetmap.org/anything", "fetch", "abort"],
    ["https://maps.example/tiles.png", "image", "mock"],
    ["http://localhost/map-development-tile.svg", "image", "mock"],
    ["http://localhost/api/ocorrencias", "fetch", "continue"],
  ]) {
    let result;
    await handler({
      request: () => ({ url: () => url, resourceType: () => type, frame: () => ({ url: () => "http://localhost/" }) }),
      fulfill: async () => { result = "mock"; }, abort: async () => { result = "abort"; }, continue: async () => { result = "continue"; },
    });
    assert.equal(result, expected, url);
  }
});
