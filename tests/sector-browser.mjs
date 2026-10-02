import {skipInitialOnboarding} from './onboarding-fixture.mjs';
import { chromium } from "./map-browser-fixture.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";

mkdirSync("test-results", { recursive: true });
const folder = mkdtempSync(join(tmpdir(), "urbana-sector-browser-"));
process.env.DATA_DIR = folder;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Urbana@2026";
delete process.env.DATABASE_URL;
const db = await openDatabase();
await seed(db);await skipInitialOnboarding(db);
const app = createApp(db);
app.use(express.static(resolve("dist")));
app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: "msedge" });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByLabel("E-mail", { exact: true }).fill("admin@urbana.local");
  await page.getByLabel("Senha", { exact: true }).fill("Urbana@2026");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("heading", { name: "Visão geral", exact: true }).waitFor();
  await page.locator("nav").getByRole("button", { name: "Controle do setor", exact: true }).click();
  await page.getByRole("heading", { name: "Controle do setor", exact: true }).waitFor();
  await page.getByLabel("Mês de entrada", { exact: true }).fill(new Date().toISOString().slice(0, 7));
  await page.locator(".sector-table tbody tr").first().waitFor();
  assert.ok(await page.getByText("Somatória O.S.", { exact: true }).isVisible());
  assert.ok(await page.getByText("Somatório dos contatos", { exact: true }).isVisible());
  assert.ok(await page.getByText("Conclusão", { exact: true }).first().isVisible());
  await page.screenshot({ path: "test-results/sector-control-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "test-results/sector-control-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ desktop: "1440x1000", mobile: "390x844", consoleErrors: errors }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  rmSync(folder, { recursive: true, force: true });
}
