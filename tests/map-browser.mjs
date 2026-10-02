import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "./map-browser-fixture.mjs";
process.env.VITE_MAP_TILE_URL = ""; // Exercise the default provider.
process.env.VITE_MAP_ATTRIBUTION = "";
const server = await createServer({ server: { host: "127.0.0.1", port: 0, headers: { "Referrer-Policy": "strict-origin-when-cross-origin" } } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).hostname === "tile.openstreetmap.org") requests.push(request); });
  await page.goto(base + "/tests/map-harness.html");
  await page.locator(".leaflet-tile-loaded").first().waitFor();
  assert.ok(requests.length > 0 && requests.length < 50);
  assert.equal((await requests[0].allHeaders()).referer, base + "/");
  const attribution = page.locator(".leaflet-control-attribution");
  await attribution.getByRole("link", { name: "OpenStreetMap", exact: true }).waitFor();
  assert.match(await attribution.innerText(), /©.*OpenStreetMap.*contributors/);
  assert.equal(await attribution.isVisible(), true);
  assert.equal(await page.locator(".leaflet-overlay-pane path").count(), 4);
  await page.locator(".leaflet-overlay-pane path").first().click({ force: true });
  assert.equal(await page.evaluate(() => document.body.dataset.selected), "1");
  await page.getByRole("button", { name: "Mapa de calor", exact: true }).click();
  await page.locator(".heat-legend").waitFor();
  assert.equal(await page.locator(".leaflet-overlay-pane path").count(), 3);
  await page.getByRole("button", { name: "Pontos de ocorrências", exact: true }).click();
  assert.equal(await page.locator(".leaflet-overlay-pane path").count(), 4);
  await page.route("https://tile.openstreetmap.org/**", route => route.abort());
  await page.locator(".leaflet-control-zoom-in").click();
  await page.getByText("Mapa-base indisponível. Os registros continuam acessíveis.", { exact: true }).waitFor();
  assert.equal(await page.locator(".leaflet-overlay-pane path").count(), 4);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ tiles: "mockados; sem rede OSM", referer: "origem real", attribution: "visível", layers: "ocorrência, obra, segmento, polígono, calor", errors }, null, 2));
} finally { await browser.close(); await server.close(); }
