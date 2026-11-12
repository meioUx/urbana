import { launchBrowser } from "./support/browser.mjs";
import { skipInitialOnboarding } from "./onboarding-fixture.mjs";
import { navigate } from "./navigation.mjs";
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
const temp = mkdtempSync(join(tmpdir(), "urbana-browser-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Urbana@2026";
delete process.env.DATABASE_URL;
const db = await openDatabase();
await seed(db);
await skipInitialOnboarding(db);
const app = createApp(db);
app.use(express.static(resolve("dist")));
app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const testUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await launchBrowser(chromium);
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(testUrl);
  await page.getByLabel("E-mail", { exact: true }).fill("admin@urbana.local");
  await page.getByLabel("Senha", { exact: true }).fill("Urbana@2026");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Evolução das operações", exact: true })
    .waitFor();
  assert.equal(await page.locator(".operations-kpi").count(), 6);
  assert.equal(await page.locator(".operations-chart").count(), 4);
  assert.equal(await page.locator("table").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Nova ocorrência", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Buscar endereço", exact: true })
      .count(),
    0,
  );
  const dashboardData = await page.evaluate(async () => ({
    rows: await (await fetch("/api/ocorrencias")).json(),
    orders: await (await fetch("/api/ordens-servico")).json(),
  }));
  const dashboardOpen = dashboardData.orders.filter(
    (o) => !["CONCLUIDA", "CANCELADA"].includes(o.status),
  );
  assert.equal(
    await page
      .locator(".operations-kpi")
      .filter({ hasText: "Ordens abertas" })
      .locator("strong")
      .innerText(),
    String(dashboardOpen.length),
  );
  // R4: o painel recebe só agregados; os números continuam iguais aos calculados pelas listas.
  const openRows = dashboardData.rows.filter(
    (r) => !["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(r.status),
  );
  assert.equal(
    await page
      .locator(".operations-kpi")
      .filter({ hasText: "Demandas abertas" })
      .locator("strong")
      .innerText(),
    String(openRows.length),
  );
  const occurrencesGroup = page
    .getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name: "Ocorrências", exact: true });
  await occurrencesGroup.click();
  // R7: a contagem fica visível e o nome acessível do botão leva "demandas em triagem"
  // (antes era aria-label em <b>, atributo que leitores de tela ignoram nesse elemento).
  const triageCount = String(
    dashboardData.rows.filter((r) =>
      ["IDENTIFICADA", "EM_TRIAGEM"].includes(r.status),
    ).length,
  );
  const triageButton = page
    .getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", {
      name: `Triagem ${triageCount} demandas em triagem`,
      exact: true,
    });
  assert.equal(
    await triageButton.locator("b > span:not(.visually-hidden)").innerText(),
    triageCount,
  );
  await occurrencesGroup.click();
  const aggregate = await page.evaluate(async () =>
    (await fetch("/api/dashboard")).json(),
  );
  for (const key of ["orders", "occurrences", "materials"])
    assert.equal(key in aggregate, false, `/api/dashboard sem ${key}`);
  await page
    .getByLabel("Período do gráfico", { exact: true })
    .selectOption("30");
  await page
    .getByRole("img", { name: /Evolução nos últimos 30 dias/ })
    .waitFor();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await navigate(page, "Mapa territorial");
  await page
    .locator(".leaflet-tile-loaded")
    .first()
    .waitFor({ timeout: 45000 });
  const tiles = await page.locator(".leaflet-tile-loaded").count();
  assert.ok(tiles > 0, "Geographic tiles must render");
  await navigate(page, "Ocorrências");
  await page
    .getByRole("button", { name: "Nova ocorrência", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: "test-results/new-occurrence-desktop.png" });
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Latitude", { exact: true }).fill("-27.123");
  await dialog.getByLabel("Longitude", { exact: true }).fill("-48.654");
  await dialog
    .getByLabel("Endereço", { exact: true })
    .fill("Rua de verificação, 123");
  await dialog.getByLabel("Bairro", { exact: true }).fill("Centro");
  await dialog
    .getByLabel("Descrição", { exact: true })
    .fill("Ocorrência de teste automatizado de interface.");
  await dialog
    .getByRole("button", { name: "Registrar ocorrência", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Rua de verificação, 123", exact: true })
    .waitFor();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Buscar endereço", exact: true })
      .count(),
    0,
  );
  assert.ok(
    (
      await dialog
        .getByRole("region", { name: "Andamento e próximo passo" })
        .innerText()
    ).includes("triagem deve conferir"),
  );
  assert.equal(
    await dialog
      .getByRole("region", { name: "Equipes e planejamento de vias" })
      .count(),
    0,
  );
  await dialog
    .getByRole("button", {
      name: "Concluir triagem e programar depois",
      exact: true,
    })
    .click();
  await dialog
    .getByText(
      "Triagem salva. A gestão já pode programar a ordem de serviço.",
      { exact: true },
    )
    .waitFor();
  await dialog
    .getByText(/Triagem concluída. A demanda está pronta para programar/)
    .waitFor();
  await dialog
    .getByRole("button", { name: "Gerar ordem de serviço", exact: true })
    .click();
  assert.equal(
    await dialog
      .getByRole("button", {
        name: "Concluir triagem e programar depois",
        exact: true,
      })
      .count(),
    0,
  );
  await dialog
    .getByText("Consultar equipes e trabalhos do setor", { exact: true })
    .click();
  await dialog
    .getByRole("region", { name: "Equipes e planejamento de vias" })
    .waitFor();
  await dialog
    .getByRole("button", { name: "Voltar à triagem", exact: true })
    .click();
  assert.equal(
    await dialog
      .getByRole("region", { name: "Equipes e planejamento de vias" })
      .count(),
    0,
  );
  await dialog
    .getByRole("button", { name: "Gerar ordem de serviço", exact: true })
    .click();
  await dialog
    .getByText("Consultar equipes e trabalhos do setor", { exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirmar ordem de serviço", exact: true })
    .waitFor();
  await dialog
    .getByRole("region", { name: "Equipes e planejamento de vias" })
    .getByRole("heading", {
      name: "Equipes e planejamento de vias",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await dialog.getByLabel("Equipe", { exact: true }).inputValue(),
    "",
  );
  const dispatch = dialog.getByRole("region", {
    name: "Equipes e planejamento de vias",
  });
  const teamName = await page.evaluate(
    async () =>
      (await (await fetch("/api/bootstrap")).json()).catalogs.find(
        (c) => c.id === "team-1",
      ).name,
  );
  await dispatch
    .getByRole("button", { name: `Selecionar ${teamName}`, exact: true })
    .click();
  assert.equal(
    await dialog.getByLabel("Equipe", { exact: true }).inputValue(),
    "team-1",
  );
  await dispatch.getByText(/Via desta ocorrência/).waitFor();
  await dispatch
    .getByText("Chamados vinculados", { exact: true })
    .first()
    .waitFor();
  const loadData = await page.evaluate(async () =>
    (await (await fetch("/api/ordens-servico")).json()).filter(
      (o) =>
        o.team_id === "team-1" &&
        !["CONCLUIDA", "CANCELADA"].includes(o.status),
    ),
  );
  const callCount = new Set(loadData.flatMap((o) => o.occurrence_ids)).size;
  assert.ok(callCount > 0);
  assert.equal(
    await dispatch
      .locator("article.selected dl div")
      .filter({ hasText: "Chamados vinculados" })
      .locator("dd")
      .innerText(),
    String(callCount),
  );
  const commitment = loadData.find(
    (o) =>
      ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"].includes(o.status) &&
      o.scheduled_at,
  );
  assert.ok(commitment);
  await dialog
    .getByLabel("Data programada", { exact: true })
    .fill(commitment.scheduled_at.slice(0, 10));
  await dispatch
    .getByRole("status")
    .filter({ hasText: "já tem serviços na data escolhida" })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: "test-results/triage-dispatch-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/triage-dispatch-desktop.png" });
  await dialog
    .getByRole("button", { name: "Confirmar ordem de serviço", exact: true })
    .click();
  await dialog
    .locator(".linked-row")
    .filter({ hasText: "OS-" })
    .first()
    .waitFor();
  await dialog
    .locator(".linked-row")
    .filter({ hasText: "OS-" })
    .first()
    .click();
  await dialog.getByRole("button", { name: "Execução", exact: true }).waitFor();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  for (const title of [
    "Mapa territorial",
    "Ocorrências",
    "Triagem",
    "Ordens de serviço",
    "Equipes",
    "Materiais",
    "Equipamentos",
    "Administração",
  ]) {
    await navigate(page, title);
    await page
      .getByRole("heading", { name: title, exact: true, level: 1 })
      .waitFor();
  }
  await navigate(page, "Kanban de equipes");
  const board = page.getByRole("region", {
    name: "Quadro de gestão das equipes",
  });
  await board.waitFor();
  const boardData = await page.evaluate(async () => ({
    orders: await (await fetch("/api/ordens-servico")).json(),
    rows: await (await fetch("/api/ocorrencias")).json(),
  }));
  // Padrão do quadro: todas as etapas, inclusive Concluídas; Canceladas e Recusadas ficam ocultas até o filtro.
  const hiddenByDefault = ["CANCELADA", "RECUSADA"];
  // Concluídas: por padrão, só as dos últimos 30 dias (recorte exibido na coluna).
  const concluded = boardData.orders.filter((o) => o.status === "CONCLUIDA");
  const inWindow = (o) =>
    o.status !== "CONCLUIDA" ||
    Date.parse(o.completed_at) >= Date.now() - 30 * 86400000;
  const visibleOrders = boardData.orders.filter(
    (o) => !hiddenByDefault.includes(o.status) && inWindow(o),
  );
  const linkedIds = new Set(boardData.orders.flatMap((o) => o.occurrence_ids));
  const unassigned = boardData.rows.filter(
    (o) => !linkedIds.has(o.id) && !hiddenByDefault.includes(o.status),
  );
  assert.ok(
    boardData.orders.some((o) => o.status === "CONCLUIDA"),
    "seed deve ter OS concluída para exercitar a coluna Concluídas",
  );
  assert.equal(
    await board.locator('.kanban-column[data-status="CONCLUIDA"]').count(),
    1,
  );
  assert.equal(
    await board.locator('.kanban-column[data-status="CANCELADA"]').count(),
    0,
  );
  assert.equal(
    await board.locator('.kanban-column[data-status="RECUSADA"]').count(),
    0,
  );
  assert.equal(
    await board.locator(".kanban-card").count(),
    visibleOrders.length + unassigned.length,
  );
  const doneColumn = board.locator('.kanban-column[data-status="CONCLUIDA"]');
  assert.equal(
    await doneColumn
      .getByLabel("Período de Concluídas", { exact: true })
      .inputValue(),
    "30",
  );
  const recentDone = concluded.filter(inWindow).length;
  assert.equal(
    await doneColumn.locator('.kanban-window small[role="status"]').innerText(),
    recentDone === concluded.length
      ? `Todas as ${concluded.length} exibidas`
      : `${recentDone} de ${concluded.length} · últimos 30 dias`,
  );
  await doneColumn
    .getByLabel("Período de Concluídas", { exact: true })
    .selectOption("0");
  await doneColumn
    .locator('.kanban-window small[role="status"]')
    .filter({ hasText: `Todas as ${concluded.length} exibidas` })
    .waitFor();
  assert.equal(
    await doneColumn.locator(".kanban-card").count(),
    concluded.length,
  );
  await doneColumn
    .getByLabel("Período de Concluídas", { exact: true })
    .selectOption("30");
  await page.waitForFunction(
    (n) => document.querySelectorAll(".kanban-card").length === n,
    visibleOrders.length + unassigned.length,
  );
  await page
    .getByLabel("Equipe do quadro", { exact: true })
    .selectOption("team-1");
  assert.equal(
    await board.locator(".kanban-card").count(),
    visibleOrders.filter((o) => o.team_id === "team-1").length,
  );
  await page
    .getByLabel("Equipe do quadro", { exact: true })
    .selectOption("unassigned");
  assert.equal(await board.locator(".kanban-card").count(), unassigned.length);
  await board
    .getByRole("button", { name: "Fazer triagem", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Gerar ordem de serviço", exact: true })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Recusar", exact: true })
    .click();
  const refusal = page.getByRole("dialog");
  assert.equal(
    await refusal
      .getByRole("region", { name: "Equipes e planejamento de vias" })
      .count(),
    0,
  );
  await refusal
    .getByLabel("Justificativa de recusa", { exact: true })
    .waitFor();
  assert.equal(
    await refusal
      .getByRole("button", { name: "Enviar", exact: true })
      .isDisabled(),
    true,
  );
  await refusal
    .getByLabel("Justificativa de recusa", { exact: true })
    .fill(
      "Demanda fora da competência do setor. Encaminhar ao órgão responsável.",
    );
  await page.screenshot({ path: "test-results/triage-refusal-desktop.png" });
  await refusal.getByRole("button", { name: "Enviar", exact: true }).click();
  await refusal.getByText("Recusada na triagem", { exact: true }).waitFor();
  await refusal.getByRole("button", { name: /Histórico/ }).click();
  await refusal
    .getByText("Demanda recusada na triagem", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  assert.equal(
    await board.locator(".kanban-card").count(),
    unassigned.length - 1,
  );
  await page.getByRole("button", { name: "Filtros", exact: true }).click();
  await page
    .getByRole("button", { name: "Limpar quadro", exact: true })
    .click();
  await board
    .getByRole("button", { name: "Analisar resultado", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Validar e concluir", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await board.evaluate((el) => (el.scrollLeft = 0));
  await board
    .getByRole("region", { name: "Concluídas", exact: true })
    .waitFor();
  assert.equal(
    await board
      .getByRole("region", { name: "Canceladas", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await board.getByRole("region", { name: "Recusadas", exact: true }).count(),
    0,
  );
  await page
    .getByLabel("Mostrar canceladas e recusadas", { exact: true })
    .check();
  await board
    .getByRole("region", { name: "Canceladas", exact: true })
    .waitFor();
  await board.getByRole("region", { name: "Recusadas", exact: true }).waitFor();
  await board
    .getByRole("region", { name: "Concluídas", exact: true })
    .waitFor();
  await page.screenshot({
    path: "test-results/kanban-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "test-results/kanban-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigate(page, "Mapa territorial");
  await page
    .getByRole("button", { name: "Mapa de calor", exact: true })
    .click();
  await page.locator("canvas.territorial-heat-layer").waitFor();
  const hasHeat = () =>
    page.locator("canvas.territorial-heat-layer").evaluate((c) => {
      const pixels = c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height).data;
      return pixels.some((v, i) => i % 4 === 3 && v > 0);
    });
  // Os pontos do mapa chegam de /api/mapa/ocorrencias de forma assíncrona; espera pela condição, não por tempo fixo.
  const mapTotal = await page.evaluate(
    async () =>
      (await (await fetch("/api/mapa/ocorrencias")).json()).features.length,
  );
  const executing = await page.evaluate(
    async () =>
      (await (await fetch("/api/mapa/ocorrencias?status=EM_EXECUCAO")).json())
        .features.length,
  );
  assert.ok(
    executing > 0 && executing < mapTotal,
    "o filtro de status deve reduzir o resultado do mapa",
  );
  await page.waitForFunction(
    (n) => document.querySelectorAll(".map-result").length === n,
    mapTotal,
  );
  await page.waitForFunction(() => {
    const c = document.querySelector("canvas.territorial-heat-layer");
    return (
      !!c &&
      c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height)
        .data.some((v, i) => i % 4 === 3 && v > 0)
    );
  });
  assert.equal(await hasHeat(), true);
  await page
    .getByLabel("Filtrar status", { exact: true })
    .selectOption("EM_EXECUCAO");
  await page.waitForFunction(
    (n) => document.querySelectorAll(".map-result").length === n,
    executing,
  );
  assert.equal(await page.locator(".map-result").count(), executing);
  await page.waitForFunction(() => {
    const c = document.querySelector("canvas.territorial-heat-layer");
    return (
      !!c &&
      c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height)
        .data.some((v, i) => i % 4 === 3 && v > 0)
    );
  });
  assert.equal(await hasHeat(), true);
  await page.locator(".leaflet-control-zoom-in").click();
  await page
    .locator(".leaflet-tile-loaded")
    .first()
    .waitFor({ timeout: 45000 });
  await page.screenshot({ path: "test-results/heatmap-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: "test-results/heatmap-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Pontos de ocorrências", exact: true })
    .click();
  assert.equal(await page.locator("canvas.territorial-heat-layer").count(), 0);
  await page.route("**/api/almoxarifado", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Almoxarifado temporariamente indisponível",
      }),
    }),
  );
  await navigate(page, "Materiais", "Equipamentos");
  await page
    .getByRole("alert")
    .filter({ hasText: "Almoxarifado temporariamente indisponível" })
    .waitFor();
  await page.unroute("**/api/almoxarifado");
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Almoxarifado", exact: true })
    .waitFor();
  await navigate(page, "Ordens de serviço");
  const orderData = await page.evaluate(async () =>
    (await fetch("/api/ordens-servico")).json(),
  );
  const teamId = orderData[0].team_id;
  await page.getByLabel("Filtrar equipe", { exact: true }).selectOption(teamId);
  await page.waitForFunction(
    (n) => document.querySelectorAll("tbody tr").length === n,
    orderData.filter((o) => o.team_id === teamId).length,
  );
  assert.equal(
    await page.locator("tbody tr").count(),
    orderData.filter((o) => o.team_id === teamId).length,
  );
  await page.getByLabel("Filtrar equipe", { exact: true }).selectOption("");
  for (const deadline of ["late", "soon", "ontime"]) {
    await page
      .getByLabel("Filtrar prazo", { exact: true })
      .selectOption(deadline);
    const expected = orderData.filter((o) => {
      if (["CONCLUIDA", "CANCELADA"].includes(o.status)) return false;
      const remaining = Date.parse(o.due_at) - Date.now();
      return deadline === "late"
        ? remaining < 0
        : deadline === "soon"
          ? remaining >= 0 && remaining <= 86400000
          : remaining > 86400000;
    });
    await page.waitForFunction(
      (codes) =>
        JSON.stringify(
          [...document.querySelectorAll("tbody tr td:first-child strong")].map(
            (x) => x.textContent,
          ),
        ) === JSON.stringify(codes),
      expected.map((o) => o.code),
    );
    assert.deepEqual(
      await page.locator("tbody tr td:first-child strong").allTextContents(),
      expected.map((o) => o.code),
    );
  }
  await page
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await page.waitForFunction(
    (n) => document.querySelectorAll("tbody tr").length === n,
    orderData.length,
  );
  assert.equal(await page.locator("tbody tr").count(), orderData.length);
  await navigate(page, "Visão geral");
  await page.evaluate(async () => {
    for (const number of [100, 200]) {
      const result = await fetch("/api/ocorrencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: "category-1",
          subcategory: "Buraco",
          description: "Planejamento territorial de teste",
          origin: "Fiscalização municipal",
          priority: "Baixa",
          lat: -28,
          lng: -48.6,
          address: `Rua Planejamento UI, ${number}`,
          neighborhood: "Centro",
          duplicate_action: "new",
        }),
      });
      if (!result.ok) throw new Error("Failed to create planning fixture");
      const o = await result.json();
      const triage = await fetch(`/api/ocorrencias/${o.id}/classificar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: o.version,
          category_id: "category-1",
          subcategory: "Buraco",
          priority: "Baixa",
          sector_id: "sector-1",
        }),
      });
      if (!triage.ok) throw new Error("Failed to triage planning fixture");
    }
  });
  await page.reload();
  await navigate(page, "Planejamento");
  await page
    .getByRole("heading", { name: "Planejamento", exact: true })
    .waitFor();
  await page.getByRole("tab", { name: /Escolher obras/ }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: /Planos e execução/ })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("Home");
  assert.equal(
    await page
      .getByRole("tab", { name: /Escolher obras/ })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.getByLabel("Buscar rua no planejamento").fill("Planejamento UI");
  await page
    .getByRole("button", { name: "Planejar esta obra", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Emitir ordem de serviço agora" })
    .uncheck();
  await page
    .getByLabel("Responsável pelo plano", { exact: true })
    .fill("Gestor de teste");
  await page.getByLabel("Data planejada", { exact: true }).fill("2026-09-20");
  await page
    .getByRole("button", { name: "Salvar plano de ação", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Programar ordem de serviço", exact: true })
    .click();
  await page
    .getByLabel("Equipe do plano", { exact: true })
    .selectOption("team-1");
  await page
    .getByRole("button", { name: "Confirmar programação", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const planning = await page.evaluate(async () =>
    (await fetch("/api/planejamento")).json(),
  );
  assert.equal(planning.plans[0].occurrences.length, 2);
  assert.equal(planning.plans[0].orders[0].priority, "Alta");
  // R4: planos encerrados não vêm em /planejamento; são carregados sob demanda, com o total visível.
  await page
    .getByLabel("Situação dos planos", { exact: true })
    .selectOption("closed");
  await page
    .getByText(`${planning.closed_plans} planos encerrados no total`)
    .waitFor();
  const closedPage = await page.evaluate(async () =>
    (await fetch("/api/planejamento/encerrados?limit=20")).json(),
  );
  await page.waitForFunction(
    (n) => document.querySelectorAll(".planning-plan").length === n,
    closedPage.items.length,
  );
  await page
    .getByLabel("Situação dos planos", { exact: true })
    .selectOption("active");
  await page.screenshot({
    path: "test-results/planning-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "test-results/planning-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigate(page, "Visão geral");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await navigate(page, "Ocorrências");
  await page
    .getByRole("button", { name: "Nova ocorrência", exact: true })
    .click();
  await page.screenshot({ path: "test-results/new-occurrence-mobile.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await navigate(page, "Ordens de serviço");
  await page.locator("tbody tr").first().click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Execução", exact: true }).click();
  await page.screenshot({ path: "test-results/order-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        desktop: "1440x1000",
        mobile: "390x844",
        mapTiles: tiles,
        consoleErrors: errors,
        screenshots: "test-results",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(temp, { recursive: true, force: true });
}
