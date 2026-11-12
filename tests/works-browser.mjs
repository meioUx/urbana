// Obras e intervenções no navegador: desenhar a geometria no mapa, vincular ocorrência e OS, aviso
// de conflito ao criar uma segunda intervenção sobreposta, avaliação do conflito, mudança de
// situação, obra agrupando intervenções, camada no mapa territorial, teclado/celular e um perfil
// sem o módulo (sem a área no menu e sem acesso à API). Requer `npm run build` (usa dist/).
import { launchBrowser } from "./support/browser.mjs";
import { skipInitialOnboarding } from "./onboarding-fixture.mjs";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "./map-browser-fixture.mjs";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";

const temp = mkdtempSync(join(tmpdir(), "urbana-works-browser-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Works@Test2026";
delete process.env.DATABASE_URL;
const db = await openDatabase();
await seed(db);
await skipInitialOnboarding(db);
const app = createApp(db);
app.use(express.static(resolve("dist")));
app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launchBrowser(chromium);
const login = async (page, email, path = "/") => {
  await page.goto(base + path);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("Works@Test2026");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
};
const occurrence = await db.get(
  "SELECT code FROM occurrences WHERE status='IDENTIFICADA' ORDER BY code LIMIT 1",
);
const order = await db.get(
  "SELECT code FROM orders WHERE status='PROGRAMADA' ORDER BY code LIMIT 1",
);
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on(
    "console",
    (m) =>
      m.type() === "error" &&
      !/Failed to load resource/.test(m.text()) &&
      errors.push(m.text()),
  );
  await login(page, "gestor@urbana.local");
  await page.getByRole("button", { name: "Obras e intervenções" }).click();
  await page
    .getByRole("heading", { name: "Obras e intervenções", level: 1 })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, "/obras");
  await page
    .getByText("Nenhuma intervenção encontrada para os filtros.")
    .waitFor();

  // 1. Nova intervenção desenhando uma linha com cliques no mapa e um ponto digitado.
  const create = async (title, { clicks, typed, conflict }) => {
    await page.getByRole("button", { name: "Nova intervenção" }).click();
    const dialog = page.getByRole("dialog", { name: "Nova intervenção" });
    await dialog.getByLabel("Título").fill(title);
    await dialog
      .getByLabel("Local (trecho, área ou ativo)")
      .fill("Av. Central, entre a Rua 1500 e a Rua 1600");
    await dialog.getByLabel("Responsável").fill("Eng. Marta Lima");
    await dialog.getByLabel("Início previsto").fill("2026-12-01");
    await dialog.getByLabel("Término previsto").fill("2026-12-10");
    const map = dialog.locator(".geometry-map .leaflet-container");
    await map.waitFor();
    await page.waitForTimeout(300);
    for (const [x, y] of clicks) await map.click({ position: { x, y } });
    if (typed) {
      await dialog.getByLabel("Latitude").fill(typed[0]);
      await dialog.getByLabel("Longitude").fill(typed[1]);
      await dialog.getByRole("button", { name: "Adicionar ponto" }).click();
    }
    const points = clicks.length + (typed ? 1 : 0);
    await dialog
      .getByText(
        new RegExp(`^Linha com ${points} pontos e extensão aproximada`),
      )
      .waitFor();
    assert.equal(await dialog.locator(".geometry-points li").count(), points);
    if (conflict)
      await dialog
        .locator(".conflict-check .notice.warning")
        .getByText(/Atenção: 1 intervenção ativa ocupa o mesmo local/)
        .waitFor();
    else
      await dialog
        .getByText(
          "Nenhum conflito de local e período com intervenções ativas.",
        )
        .waitFor();
    await dialog.getByRole("button", { name: "Cadastrar intervenção" }).click();
    await page.getByRole("heading", { name: title, level: 2 }).waitFor();
    assert.equal(
      await page
        .getByRole("heading", { name: title, level: 2 })
        .evaluate((el) => el === document.activeElement),
      true,
      "focus moves to the detail heading",
    );
  };
  await create("Recapeamento da Avenida Central", {
    clicks: [
      [200, 150],
      [420, 170],
    ],
    typed: ["-26,9985", "-48,6300"],
  });
  await page.getByText(/^Linha com 3 pontos/).waitFor();
  assert.equal(
    (await page.locator(".works-map .leaflet-overlay-pane path").count()) >= 1,
    true,
  );

  // 2. Vínculos com ocorrência e OS (busca pelo código).
  await page
    .getByRole("textbox", { name: "Buscar ocorrência para vincular" })
    .fill(occurrence.code);
  await page
    .getByRole("search")
    .first()
    .getByRole("button", { name: "Buscar" })
    .click();
  await page
    .getByRole("button", { name: `Vincular ${occurrence.code}` })
    .click();
  await page
    .getByRole("heading", { name: "Ocorrências vinculadas (1)" })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Buscar ordem de serviço para vincular" })
    .fill(order.code);
  await page
    .getByRole("search")
    .nth(1)
    .getByRole("button", { name: "Buscar" })
    .click();
  await page.getByRole("button", { name: `Vincular ${order.code}` }).click();
  await page
    .getByRole("heading", { name: "Ordens de serviço vinculadas (1)" })
    .waitFor();

  // 3. Mudança de situação com motivo obrigatório para paralisar.
  await page.getByRole("button", { name: "Iniciar", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Iniciar", exact: true })
    .click();
  await page
    .locator(".works-detail-badges")
    .getByText("Em andamento")
    .waitFor();
  await page.getByRole("button", { name: "Paralisar", exact: true }).click();
  const pause = page.getByRole("dialog");
  await pause.getByRole("button", { name: "Paralisar", exact: true }).click();
  assert.equal(
    await pause
      .getByLabel("Motivo (obrigatório)")
      .evaluate((el) => el.validity.valueMissing),
    true,
  );
  await pause.getByLabel("Motivo (obrigatório)").fill("Chuva forte prevista");
  await pause.getByRole("button", { name: "Paralisar", exact: true }).click();
  await page.locator(".works-detail-badges").getByText("Paralisada").waitFor();
  await page
    .getByText("Situação alterada: Em andamento → Paralisada")
    .waitFor();

  // 4. Segunda intervenção sobre o mesmo trecho e período: aviso, sem bloqueio; avaliação registrada.
  await page.getByRole("button", { name: "Voltar à lista" }).click();
  await page
    .getByRole("row", { name: /Abrir INT-/ })
    .first()
    .waitFor();
  await create("Rede de água na Avenida Central", {
    clicks: [
      [200, 150],
      [420, 170],
    ],
    conflict: true,
  });
  await page
    .locator(".notice.warning")
    .getByText(/Há 1 conflito de local e período/)
    .waitFor();
  await page.getByRole("button", { name: "Registrar avaliação" }).click();
  await page
    .getByLabel(/Como o conflito com INT-/)
    .fill("Rede de água executada antes do recapeamento.");
  await page.getByRole("button", { name: "Salvar avaliação" }).click();
  await page
    .getByText(
      /Avaliado por Carlos Oliveira em .*: Rede de água executada antes do recapeamento\./,
    )
    .waitFor();
  await page.getByText("(todos avaliados)", { exact: false }).waitFor();

  // 5. Obra agrupando as duas intervenções; abas por teclado.
  await page.getByRole("button", { name: "Voltar à lista" }).click();
  const interventionsTab = page.getByRole("tab", { name: "Intervenções" });
  await interventionsTab.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Nova obra" }).waitFor();
  assert.equal(
    await page
      .getByRole("tab", { name: "Obras" })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await page
      .getByRole("tab", { name: "Obras" })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.getByRole("button", { name: "Nova obra" }).click();
  const projectDialog = page.getByRole("dialog", { name: "Nova obra" });
  await projectDialog
    .getByLabel("Nome da obra")
    .fill("Requalificação da Avenida Central");
  await projectDialog.getByLabel("Responsável").fill("Eng. Ana Prado");
  await projectDialog.getByLabel("Início previsto").fill("2026-11-15");
  await projectDialog.getByLabel("Término previsto").fill("2027-03-31");
  await projectDialog.getByRole("button", { name: "Cadastrar obra" }).click();
  await page
    .getByRole("heading", {
      name: "Requalificação da Avenida Central",
      level: 2,
    })
    .waitFor();
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("textbox", { name: "Buscar intervenção para agrupar" })
      .fill("Avenida Central");
    await page
      .getByRole("search")
      .first()
      .getByRole("button", { name: "Buscar" })
      .click();
    await page
      .getByRole("button", { name: /^Vincular INT-/ })
      .first()
      .click();
    await page
      .getByRole("heading", { name: `Intervenções da obra (${i + 1})` })
      .waitFor();
  }
  assert.ok(
    (await page.locator(".works-map .leaflet-overlay-pane path").count()) >= 2,
  );
  await page.getByRole("button", { name: "Iniciar", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Iniciar", exact: true })
    .click();
  await page
    .locator(".works-detail-badges")
    .getByText("Em andamento")
    .waitFor();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Concluir", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("alert")
    .getByText(
      /Conclua ou cancele as intervenções da obra antes de concluí-la\. Pendentes: INT-/,
    )
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Voltar" })
    .click();

  // 6. Lista de intervenções mostra a obra; detalhe aberto pelo teclado.
  await page.getByRole("button", { name: "Voltar à lista" }).click();
  await page.getByRole("tab", { name: "Intervenções" }).click();
  const firstRow = page.getByRole("row", { name: /Abrir INT-/ }).first();
  await firstRow.waitFor();
  await page
    .getByText(/Obra OB-\d{4}-\d{5}/)
    .first()
    .waitFor();
  await page.getByLabel("Filtrar situação").selectOption("PARALISADA");
  await page
    .getByRole("row", { name: /Abrir INT-/ })
    .nth(1)
    .waitFor({ state: "detached" });
  await page
    .getByRole("row", { name: /Abrir INT-/ })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "Recapeamento da Avenida Central", level: 2 })
    .waitFor();

  // 7. Celular: sem rolagem horizontal na lista e no detalhe.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "detail fits the phone width",
  );
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/works-mobile-detail.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Voltar à lista" }).click();
  await page
    .getByRole("row", { name: /Abrir INT-/ })
    .first()
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "list fits the phone width",
  );
  await page.setViewportSize({ width: 1440, height: 900 });

  // 8. Camada de intervenções no mapa territorial, com lista textual.
  await page.goto(base + "/");
  await page.getByRole("button", { name: "Mapa territorial" }).click();
  await page.locator(".map-layout .leaflet-container").waitFor();
  const before = await page
    .locator(".map-layout .leaflet-overlay-pane path")
    .count();
  await page.getByLabel("Mostrar intervenções no mapa").check();
  await page
    .locator(".works-layer")
    .getByText("Rede de água na Avenida Central")
    .waitFor();
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll(".map-layout .leaflet-overlay-pane path")
        .length >=
      n + 2,
    before,
  );
  await page
    .getByLabel("Situação das intervenções no mapa")
    .selectOption("CONCLUIDA");
  await page
    .locator(".works-layer")
    .getByText("Nenhuma intervenção para a situação escolhida.")
    .waitFor();
  await page
    .getByLabel("Situação das intervenções no mapa")
    .selectOption("PARALISADA");
  await page
    .locator(".works-layer")
    .getByRole("button", { name: /Recapeamento da Avenida Central/ })
    .click();
  await page
    .getByRole("heading", { name: "Recapeamento da Avenida Central", level: 2 })
    .waitFor();
  assert.match(page.url(), /\/obras\?intervencao=/);
  await page.screenshot({ path: "test-results/works-desktop-detail.png" });
  assert.deepEqual(errors, []);

  // 9. Perfil sem o módulo: sem item no menu, rota direta negada e API 403.
  const other = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await login(other, "triagem@urbana.local");
  await other.locator(".sidebar nav").waitFor();
  assert.equal(
    await other.getByRole("button", { name: "Obras e intervenções" }).count(),
    0,
  );
  assert.equal(
    await other.evaluate(async () => (await fetch("/api/intervencoes")).status),
    403,
  );
  assert.equal(
    await other.evaluate(
      async () =>
        (
          await fetch("/api/obras", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
    ),
    403,
  );
  await other.goto(base + "/obras");
  await other.getByRole("heading", { name: "Acesso negado" }).waitFor();
  // Campo continua igual.
  const field = await browser.newPage({
    viewport: { width: 390, height: 780 },
  });
  await login(field, "campo@urbana.local", "/campo");
  await field
    .getByRole("button", { name: /Tarefas/ })
    .first()
    .waitFor();
  assert.equal(await field.getByText("Obras e intervenções").count(), 0);
  console.log(
    "Works UI: draw geometry, links, conflict warning and review, state changes, work grouping, map layer, keyboard, mobile and module denial OK",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(temp, { recursive: true, force: true });
}
