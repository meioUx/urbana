import { skipInitialOnboarding } from "./onboarding-fixture.mjs";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { moduleCatalog } from "../shared/authorization.mjs";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
const dir = mkdtempSync(join(tmpdir(), "urbana-auth-browser-"));
process.env.DATA_DIR = dir;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
const db = await openDatabase();
await seed(db);
await skipInitialOnboarding(db);
const app = createApp(db);
app.use(express.static(resolve("dist")));
app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true, channel: "msedge" });
async function session(name) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.request.post(base + "/api/auth/login", {
    data: { email: name + "@urbana.local", password: "Testing@2026" },
  });
  return { context, page: await context.newPage() };
}
try {
  const { context: adminContext, page: admin } = await session("admin");
  await admin.goto(base + "/admin/usuarios");
  await admin.getByRole("button", { name: "Usuários", exact: true }).click();
  await admin
    .getByRole("row")
    .filter({ hasText: "admin@urbana.local" })
    .getByRole("button", { name: "Editar usuário" })
    .click();
  const masterDialog = admin.getByRole("dialog");
  assert.equal(
    await masterDialog
      .getByLabel("E-mail", { exact: true })
      .getAttribute("readonly"),
    "",
  );
  assert.equal(
    await masterDialog.getByLabel("Perfil", { exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await masterDialog.getByRole("checkbox").count(),
    moduleCatalog.length,
  );
  for (const checkbox of await masterDialog.getByRole("checkbox").all()) {
    assert.equal(await checkbox.isChecked(), true);
    assert.equal(await checkbox.isDisabled(), true);
  }
  await masterDialog
    .getByRole("button", { name: "Fechar", exact: true })
    .click();
  await admin
    .getByRole("button", { name: "Novo usuário", exact: true })
    .click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByLabel("Perfil", { exact: true }).selectOption("Gestor");
  assert.equal(
    await dialog.getByLabel("Operação de campo", { exact: true }).count(),
    0,
  );
  assert.equal(
    await dialog.getByLabel("Administração", { exact: true }).count(),
    0,
  );
  assert.ok(
    await dialog.getByLabel("Planejamento", { exact: true }).isChecked(),
  );
  await dialog
    .getByLabel("Perfil", { exact: true })
    .selectOption("Equipe de Campo");
  assert.equal(await dialog.getByRole("checkbox").count(), 1);
  assert.ok(
    await dialog.getByLabel("Operação de campo", { exact: true }).isChecked(),
  );
  await dialog.getByLabel("Perfil", { exact: true }).selectOption("Gestor");
  await dialog.getByLabel("Nome", { exact: true }).fill("Teste navegador");
  await dialog.getByLabel("E-mail", { exact: true }).fill("browser@test.local");
  await dialog
    .getByLabel("Senha (mínimo 10 caracteres)", { exact: true })
    .fill("Testing@2026");
  for (const checkbox of await dialog.getByRole("checkbox").all())
    await checkbox.uncheck();
  await dialog.getByLabel("Planejamento", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Criar usuário", exact: true })
    .click();
  await admin
    .getByRole("row")
    .filter({ hasText: "browser@test.local" })
    .getByRole("button", { name: "Editar usuário" })
    .click();
  await admin
    .getByRole("dialog")
    .getByLabel("Perfil", { exact: true })
    .selectOption("Triagem");
  await admin
    .getByText("Acessos incompatíveis removidos: Planejamento", { exact: true })
    .waitFor();
  await admin.screenshot({
    path: "test-results/authorization-edit.png",
    fullPage: true,
  });
  await admin
    .getByRole("button", { name: "Salvar usuário", exact: true })
    .click();
  const restrictedContext = await browser.newContext();
  await restrictedContext.request.post(base + "/api/auth/login", {
    data: { email: "browser@test.local", password: "Testing@2026" },
  });
  const restricted = await restrictedContext.newPage();
  await restricted.goto(base);
  await restricted
    .getByRole("heading", { name: "Sem módulos disponíveis" })
    .waitFor();
  const { page: manager } = await session("gestor");
  await manager.goto(base + "/");
  await manager.getByRole("navigation", { name: "Menu principal" }).waitFor();
  assert.equal(
    await manager
      .getByRole("navigation")
      .getByRole("button", { name: "Administração", exact: true })
      .count(),
    0,
  );
  await manager.goto(base + "/admin/usuarios");
  await manager.getByRole("heading", { name: "Acesso negado" }).waitFor();
  await manager.goto(base + "/campo");
  await manager.getByRole("heading", { name: "Acesso negado" }).waitFor();
  await admin.goto(base + "/campo");
  await admin
    .getByRole("heading", { name: "Minhas tarefas", exact: true })
    .waitFor();
  const managerInfo = await (
    await adminContext.request.get(base + "/api/users/gestor/permissions")
  ).json();
  const { id, ...managerData } = managerInfo.user;
  assert.equal(
    (
      await adminContext.request.patch(base + "/api/users/gestor", {
        data: { ...managerData, modules: ["dashboard"] },
      })
    ).status(),
    200,
  );
  await manager.goto(base + "/planejamento");
  await manager.getByRole("heading", { name: "Acesso negado" }).waitFor();
  await manager.goto(base + "/");
  await manager.getByRole("navigation", { name: "Menu principal" }).waitFor();
  assert.equal(
    await manager.getByRole("navigation").getByRole("button").count(),
    1,
  );
  const { page: field } = await session("campo");
  await field.goto(base + "/admin/usuarios");
  await field.getByRole("heading", { name: "Acesso negado" }).waitFor();
  await field.goto(base + "/");
  await field.waitForURL(base + "/campo");
  const { page: reader } = await session("consulta");
  await reader.goto(base + "/materiais");
  await reader
    .getByRole("heading", { name: "Almoxarifado", exact: true })
    .waitFor();
  assert.equal(
    await reader
      .getByRole("heading", { name: "Ajuste manual", exact: true })
      .count(),
    0,
  );
  console.log(
    "Autorização UI: formulário, compatibilidade, edição, menu, URLs, Campo e acesso vazio aprovados.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
}
