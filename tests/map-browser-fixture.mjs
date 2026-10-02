import { chromium as realChromium } from "@playwright/test";
export { expect } from "@playwright/test";
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8efea"/></svg>';
export async function mockMapTiles(context) {
  // Runs before navigation. Blocks every OSM host, including redirects, and mocks
  // external images for other configured tile providers. Service workers are disabled.
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const osm = /(^|\.)openstreetmap\.org$/.test(url.hostname);
    const externalImage = request.resourceType() === "image" &&
      url.origin !== new URL(request.frame().url() || request.url()).origin;
    if (osm || externalImage || url.pathname === "/map-development-tile.svg") {
      if (request.resourceType() !== "image") return route.abort();
      return route.fulfill({ contentType: "image/svg+xml", body: tile });
    }
    return route.continue();
  });
}
export const chromium = {
  async launch(options) {
    const browser = await realChromium.launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (options = {}) => {
      const context = await newContext({ ...options, serviceWorkers: "block" });
      await mockMapTiles(context);
      return context;
    };
    browser.newPage = async (options = {}) => {
      const context = await browser.newContext(options);
      return context.newPage();
    };
    return browser;
  },
};
