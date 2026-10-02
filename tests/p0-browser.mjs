import { chromium, expect } from "./map-browser-fixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import { navigate } from "./navigation.mjs";
const folder = mkdtempSync(join(tmpdir(), "urbana-p0-browser-"));
process.env.DATA_DIR = folder;
process.env.DEMO_DATA = "false";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
let db, server, browser;
const errors = [];
try {
  db = await openDatabase();
  await seed(db);
  for (let i = 0; i < 51; i++)
    await db.run(
      "INSERT INTO occurrences(id,code,category_id,sector_id,status,priority,lat,lng,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        "OC-P0-" + String(i).padStart(3, "0"),
        "category-1",
        "sector-1",
        "IDENTIFICADA",
        "Alta",
        -27,
        -48,
        "2026-10-02T12:00:00.000Z",
        "2026-10-02T12:00:00.000Z",
        JSON.stringify({
          address: "Rua Paginação P0, " + i,
          description: "Registro para verificar páginas",
          neighborhood: "Centro",
          subcategory: "Buraco",
          origin: "Fiscalização",
        }),
      ],
    );
  const app = createApp(db);
  app.use(express.static(resolve("dist")));
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByLabel("E-mail", { exact: true }).fill("admin@urbana.local");
  await page.getByLabel("Senha", { exact: true }).fill("Testing@2026");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  await navigate(page, "Ocorrências");
  await expect(page.locator("tbody tr")).toHaveCount(50);
  const first = await page
    .locator("tbody tr td:first-child strong")
    .allTextContents();
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  const second = await page
    .locator("tbody tr td:first-child strong")
    .allTextContents();
  assert.ok(!first.includes(second[0]));
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await page.locator("tbody tr").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const code = await dialog.locator("h2").first().innerText();
  const row = await db.get("SELECT id,version FROM occurrences WHERE code=?", [
    code,
  ]);
  assert.ok(row);
  await dialog.getByLabel("Prioridade", { exact: true }).selectOption("Baixa");
  const changed = await page.request.post(
    base + "/api/ocorrencias/" + row.id + "/classificar",
    {
      data: {
        version: row.version,
        category_id: "category-1",
        subcategory: "Buraco",
        sector_id: "sector-1",
        priority: "Alta",
      },
    },
  );
  assert.equal(changed.status(), 200);
  await dialog
    .getByRole("button", {
      name: "Concluir triagem e programar depois",
      exact: true,
    })
    .click();
  await dialog
    .getByText("Registro alterado por outro usuário.", { exact: true })
    .waitFor();
  await expect(dialog.getByLabel("Prioridade", { exact: true })).toHaveValue(
    "Baixa",
  );
  await dialog
    .getByRole("button", { name: "Atualizar dados", exact: true })
    .click();
  await expect(
    dialog.getByText("Registro alterado por outro usuário.", { exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByLabel("Prioridade", { exact: true })).toHaveValue(
    "Baixa",
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
  assert.equal(
    (
      await db.get("SELECT priority,version FROM occurrences WHERE id=?", [
        row.id,
      ])
    ).priority,
    "Baixa",
  );
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await navigate(page, "Administração");
  await page.getByRole("button", { name: "Auditoria", exact: true }).click();
  const audit = page.getByRole("region", { name: "Pesquisa de auditoria" });
  await audit.getByLabel("ID da entidade", { exact: true }).fill(row.id);
  await audit.getByRole("button", { name: "Pesquisar", exact: true }).click();
  await expect(audit.locator("tbody tr")).toHaveCount(2);
  assert.ok(
    (await audit.locator("tbody tr td:last-child").allTextContents()).every(
      (v) => v.includes(row.id),
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      pagination: true,
      conflictPreservesForm: true,
      explicitRefresh: true,
      auditSearch: true,
      consoleErrors: errors,
    }),
  );
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
  rmSync(folder, { recursive: true, force: true });
}
