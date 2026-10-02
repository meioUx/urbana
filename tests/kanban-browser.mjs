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
import { navigate } from "./navigation.mjs";
const temp = mkdtempSync(join(tmpdir(), "urbana-kanban-browser-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Urbana@2026";
delete process.env.DATABASE_URL;
const db = await openDatabase();
await seed(db);await skipInitialOnboarding(db);
const app = createApp(db);
app.use(express.static(resolve("dist")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByLabel("E-mail", { exact: true }).fill("admin@urbana.local");
  await page.getByLabel("Senha", { exact: true }).fill("Urbana@2026");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  const nav = page.getByRole("navigation", { name: "Menu principal" });
  assert.equal(
    await nav
      .getByRole("button", { name: "Operações", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  await navigate(page, "Ocorrências");
  await page
    .getByRole("heading", { name: "Ocorrências", exact: true })
    .waitFor();
  assert.equal(
    await nav
      .getByRole("button", { name: "Ocorrências", exact: true })
      .getAttribute("aria-expanded"),
    "true",
  );
  await navigate(page, "Equipamentos");
  await page
    .getByRole("heading", { name: "Equipamentos", exact: true, level: 1 })
    .waitFor();
  assert.equal(
    await nav
      .getByRole("button", { name: "Ocorrências", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(await page.locator(".inventory-module").count(), 0);
  await navigate(page, "Materiais");
  await page
    .getByRole("heading", { name: "Almoxarifado", exact: true })
    .waitFor();
  assert.equal(await page.locator(".equipment-list").count(), 0);
  const fixtures = [];
  for (let i = 0; i < 3; i++) {
    const r = await page.request.post(url + "/api/ocorrencias", {
      data: {
        category_id: "category-1",
        subcategory: "Buraco",
        description: "Teste do quadro com arraste",
        origin: "Fiscalização municipal",
        priority: "Alta",
        lat: -38.1 - i / 10,
        lng: -48.6,
        address: `Rua Quadro Agil, ${i + 1}`,
        neighborhood: "Centro",
      },
    });
    assert.equal(r.status(), 200);
    fixtures.push(await r.json());
  }
  await page.reload();
  await page
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  await navigate(page, "Kanban de equipes");
  const board = page.getByRole("region", {
    name: "Quadro de gestão das equipes",
  });
  await board.waitFor();
  assert.equal(await page.locator("#kanban-filters").count(), 0);
  assert.equal(await page.locator("#kanban-loads").count(), 0);
  const card = (o) => board.locator(`[data-card-key="occurrence:${o.id}"]`);
  const column = (status) => board.locator(`[data-status="${status}"]`);
  assert.equal(await column("CONCLUIDA").count(), 1);
  assert.equal(
    await board.locator(".kanban-column").last().getAttribute("data-status"),
    "CONCLUIDA",
  );
  assert.equal(await column("CANCELADA").count(), 0);
  assert.equal(await column("RECUSADA").count(), 0);

  await page
    .getByRole("button", { name: "Regras do quadro", exact: true })
    .click();
  const currentTriage = await column("EM_TRIAGEM")
    .locator(".kanban-card")
    .count();
  await page
    .getByLabel("Limite de Em triagem", { exact: true })
    .fill(String(currentTriage + 1));
  await page
    .getByRole("button", { name: "Salvar limites", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Limites de trabalho atualizados." })
    .waitFor();
  await page
    .getByRole("button", { name: "Regras do quadro", exact: true })
    .click();
  await card(fixtures[0]).dragTo(column("EM_TRIAGEM").locator("header"));
  const dialog = page.getByRole("dialog", { name: "Mover para em triagem" });
  await dialog.waitFor();
  await dialog
    .getByRole("button", { name: "Confirmar movimentação", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    (
      await (
        await page.request.get(url + `/api/ocorrencias/${fixtures[0].id}`)
      ).json()
    ).status,
    "EM_TRIAGEM",
  );
  assert.equal(
    await column("EM_TRIAGEM")
      .locator(`[data-card-key="occurrence:${fixtures[0].id}"]`)
      .count(),
    1,
  );
  await card(fixtures[1]).dragTo(column("EM_TRIAGEM").locator("header"));
  await page
    .getByRole("alert")
    .filter({ hasText: "atingiu o limite" })
    .waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    (
      await (
        await page.request.get(url + `/api/ocorrencias/${fixtures[1].id}`)
      ).json()
    ).status,
    "IDENTIFICADA",
  );
  await page
    .getByRole("button", { name: "Regras do quadro", exact: true })
    .click();
  await page.getByLabel("Limite de Em triagem", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Salvar limites", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Limites de trabalho atualizados." })
    .waitFor();
  await page
    .getByRole("button", { name: "Regras do quadro", exact: true })
    .click();
  await card(fixtures[2]).dragTo(card(fixtures[1]));
  await page
    .getByRole("status")
    .filter({ hasText: "Ordem dos cartões salva" })
    .waitFor();
  const config = await (await page.request.get(url + "/api/kanban")).json();
  assert.ok(
    config.order.IDENTIFICADA.indexOf("occurrence:" + fixtures[2].id) <
      config.order.IDENTIFICADA.indexOf("occurrence:" + fixtures[1].id),
  );
  await card(fixtures[1])
    .getByLabel(`Mover ${fixtures[1].code}`, { exact: true })
    .selectOption("EM_TRIAGEM");
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  assert.equal(
    (
      await (
        await page.request.get(url + `/api/ocorrencias/${fixtures[1].id}`)
      ).json()
    ).status,
    "IDENTIFICADA",
  );
  // Scheduling through keyboard controls creates a real OS without skipping triage.
  await card(fixtures[0])
    .getByLabel(`Mover ${fixtures[0].code}`, { exact: true })
    .selectOption("PROGRAMADA");
  const schedule = page.getByRole("dialog");
  await schedule.getByLabel("Equipe", { exact: true }).selectOption("team-1");
  await schedule
    .getByLabel("Data programada", { exact: true })
    .fill("2026-10-02");
  await schedule
    .getByRole("button", { name: "Confirmar movimentação", exact: true })
    .click();
  await schedule.waitFor({ state: "hidden" });
  const orders = await (
    await page.request.get(url + "/api/ordens-servico")
  ).json();
  const order = orders.find((o) => o.occurrence_ids.includes(fixtures[0].id));
  assert.ok(order);
  const orderCard = board.locator(`[data-card-key="order:${order.id}"]`);
  assert.equal(await card(fixtures[0]).count(), 0);
  assert.equal(await orderCard.count(), 1);
  await orderCard
    .getByLabel(`Mover ${order.code}`, { exact: true })
    .selectOption("EM_EXECUCAO");
  const start = page.getByRole("dialog");
  await start.getByLabel("Latitude de chegada", { exact: true }).fill("-38.1");
  await start.getByLabel("Longitude de chegada", { exact: true }).fill("-48.6");
  await start
    .getByRole("button", { name: "Confirmar movimentação", exact: true })
    .click();
  await start
    .getByRole("alert")
    .filter({ hasText: "Anexe uma foto" })
    .waitFor();
  assert.equal(
    (
      await (
        await page.request.get(url + `/api/ordens-servico/${order.id}`)
      ).json()
    ).status,
    "PROGRAMADA",
  );
  await start.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.reload();
  await page
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  await navigate(page, "Kanban de equipes");
  await column("IDENTIFICADA").waitFor();
  const ordered = await column("IDENTIFICADA")
    .locator(".kanban-card")
    .evaluateAll((items) => items.map((el) => el.dataset.cardKey));
  assert.ok(
    ordered.indexOf("occurrence:" + fixtures[2].id) <
      ordered.indexOf("occurrence:" + fixtures[1].id),
  );
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/kanban-agile-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "test-results/kanban-agile-mobile.png",
    fullPage: true,
  });
  // Exercise the touch-pointer drag path and cancellation, preserving the real status.
  await board.evaluate((el) => (el.scrollLeft = 0));
  const touchCard = card(fixtures[2]),
    grip = touchCard.getByRole("button", {
      name: `Arrastar ${fixtures[2].code}`,
      exact: true,
    });
  await grip.scrollIntoViewIfNeeded();
  const rect = await grip.boundingBox();
  assert.ok(rect);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: rect.x + 10, y: rect.y + 10 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  const targetRect = await column("IDENTIFICADA")
    .locator("header")
    .boundingBox();
  assert.ok(targetRect);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: rect.x + 10, y: rect.y + 10 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: targetRect.x + 60, y: targetRect.y + 18 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page
    .getByRole("status")
    .filter({ hasText: "Ordem dos cartões salva" })
    .waitFor();
  const touchOrder = await (await page.request.get(url + "/api/kanban")).json();
  assert.equal(
    touchOrder.order.IDENTIFICADA.at(-1),
    "occurrence:" + fixtures[2].id,
  );
  await cdp.detach();
  assert.equal(await page.locator(".kanban-touch-ghost").count(), 0);
  const reader = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  reader.on("pageerror", (e) => errors.push(e.message));
  await reader.goto(url);
  await reader
    .getByLabel("E-mail", { exact: true })
    .fill("consulta@urbana.local");
  await reader.getByLabel("Senha", { exact: true }).fill("Urbana@2026");
  await reader.getByRole("button", { name: "Entrar", exact: true }).click();
  await reader
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  await navigate(reader, "Kanban de equipes");
  await reader
    .getByRole("region", { name: "Quadro de gestão das equipes" })
    .waitFor();
  assert.equal(
    await reader.locator('.kanban-card[draggable="true"]').count(),
    0,
  );
  assert.equal(await reader.locator(".kanban-card-actions select").count(), 0);
  assert.equal(await reader.locator(".kanban-prioritize").count(), 0);
  await reader
    .getByRole("button", { name: "Regras do quadro", exact: true })
    .click();
  assert.equal(
    await reader
      .getByRole("button", { name: "Salvar limites", exact: true })
      .count(),
    0,
  );
  await reader.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        dragMoves: true,
        sharedOrdering: true,
        wipEnforced: true,
        keyboardMoves: true,
        touchOrdering: true,
        readOnlyAccess: true,
        evidenceRequired: true,
        groupedNavigation: true,
        mobileOverflow: false,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
} catch (e) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  if (pages[0]) {
    console.log("UI ERRORS", errors);
    console.log((await pages[0].locator("body").innerText()).slice(-7000));
    await pages[0].screenshot({
      path: "test-results/kanban-failure.png",
      fullPage: true,
    });
  }
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(temp, { recursive: true, force: true });
}
