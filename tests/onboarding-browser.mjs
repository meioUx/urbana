import { chromium } from "./map-browser-fixture.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/domain.js";
import { saveModules } from "../server/user-permissions.js";
import { ONBOARDING_VERSION } from "../shared/onboarding-version.mjs";
const dir = mkdtempSync(join(tmpdir(), "urbana-training-browser-"));
process.env.DATA_DIR = dir;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
const db = await openDatabase();
await seed(db);
mkdirSync("test-results", { recursive: true });
await saveModules(db, { id: "gestor", role: "Gestor" }, [
  "dashboard",
  "map",
  "orders",
]);
for (const [id, modules] of [
  ["no-modules", []],
  ["missing-target", ["equipment"]],
]) {
  await db.run("INSERT INTO users VALUES(?,?,?,?,?,?)", [
    id,
    id,
    id + "@test.local",
    hashPassword("Testing@2026"),
    "Consulta",
    null,
  ]);
  await saveModules(db, { id, role: "Consulta" }, modules);
}
await db.run("INSERT INTO users VALUES(?,?,?,?,?,?)", [
  "empty-field",
  "Equipe sem tarefas",
  "empty-field@test.local",
  hashPassword("Testing@2026"),
  "Equipe de Campo",
  "team-3",
]);
await saveModules(db, { id: "empty-field", role: "Equipe de Campo" }, [
  "field",
]);
const tables = [
  "users",
  "catalogs",
  "occurrences",
  "orders",
  "evidence",
  "consumption",
  "audit_logs",
  "action_plans",
  "inventory_movements",
  "user_module_permissions",
];
const before = {};
for (const table of tables)
  before[table] = await db.all("SELECT * FROM " + table);
const app = createApp(db);
app.use(express.static(resolve("dist")));
app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const errors = [],
  writes = [];
async function session(
  name,
  { mobile = false, loginUI = false, reduce = false, missing = false } = {},
) {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    reducedMotion: reduce ? "reduce" : "no-preference",
  });
  if (missing)
    await context.addInitScript(() => {
      const strip = () =>
        document
          .querySelectorAll('[data-guide="page-heading"]')
          .forEach((e) => e.removeAttribute("data-guide"));
      document.addEventListener("DOMContentLoaded", () => {
        strip();
        new MutationObserver(strip).observe(document.body, {
          childList: true,
          subtree: true,
        });
      });
    });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      !["GET", "HEAD"].includes(r.method()) &&
      r.url().includes("/api/") &&
      !r.url().includes("/api/auth/") &&
      !r.url().endsWith("/api/onboarding")
    )
      writes.push(r.method() + " " + r.url());
  });
  const email = name.includes("@") ? name : name + "@urbana.local";
  if (!loginUI) {
    assert.equal(
      (
        await context.request.post(base + "/api/auth/login", {
          data: { email, password: "Testing@2026" },
        })
      ).status(),
      200,
    );
  }
  await page.goto(base + "/");
  if (loginUI) {
    await page.locator("input[type=email]").fill(email);
    await page.locator("input[type=password]").fill("Testing@2026");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
  }
  return { context, page };
}
async function begin(page) {
  await page
    .getByRole("heading", { name: "Bem-vindo ao Urbana", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Conhecer o Urbana", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Como o Urbana funciona", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: /Aprender meu fluxo|Continuar meu fluxo/ })
    .click();
}
async function finish(page, name) {
  const visited = [];
  for (let i = 0; i < 12; i++) {
    const done = await page.locator('[data-onboarding-phase="finish"]').count();
    if (done) break;
    const layer = page.locator('[data-onboarding-phase="tour"]');
    await layer.waitFor();
    const next = layer.getByRole("button", { name: /^(Próximo|Concluir)$/ });
    await next.waitFor();
    await page.waitForFunction(() => {
      const b = document.querySelector(".onboarding-actions .button.primary");
      return (
        document.querySelector('[data-onboarding-phase="finish"]') ||
        (b &&
          !b.disabled &&
          !!document.querySelector('[data-onboarding-phase="tour"]'))
      );
    });
    if (await page.locator('[data-onboarding-phase="finish"]').count()) break;
    const id = await layer.getAttribute("data-onboarding-step");
    visited.push(id);
    const tooltip = await page.locator(".onboarding-tooltip").boundingBox();
    assert.ok(
      tooltip.x >= 0 &&
        tooltip.y >= 0 &&
        tooltip.x + tooltip.width <=
          (await page.evaluate(() => innerWidth)) + 1 &&
        tooltip.y + tooltip.height <=
          (await page.evaluate(() => innerHeight)) + 1,
      name + " tooltip outside viewport",
    );
    if (name === "gestor" && id === "map") {
      await layer.getByRole("button", { name: "Abrir mapa completo" }).click();
      await page.locator(".onboarding-highlight").waitFor();
      assert.equal(await layer.getAttribute("data-onboarding-step"), "map");
    }
    if (name === "campo" && id === "send") {
      const highlight = await page
        .locator(".onboarding-highlight")
        .boundingBox();
      assert.ok(
        highlight.y + highlight.height <= tooltip.y,
        "Highlighted send action covered by mobile card",
      );
      await page.screenshot({
        path: "test-results/onboarding-field-mobile.png",
      });
      assert.match(await layer.innerText(), /Aguardando validação/);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    await next.click();
    await page.waitForFunction(
      (previous) =>
        document.querySelector('[data-onboarding-phase="finish"]') ||
        document
          .querySelector("[data-onboarding-step]")
          ?.getAttribute("data-onboarding-step") !== previous,
      id,
    );
  }
  await page
    .getByRole("heading", { name: "Tudo pronto!", exact: true })
    .waitFor();
  return visited;
}
try {
  for (const name of [
    "admin",
    "gestor",
    "triagem",
    "campo",
    "fiscal",
    "consulta",
  ]) {
    const { context, page } = await session(name, {
      mobile: name === "campo",
      loginUI: name === "campo",
      reduce: name === "campo",
    });
    await page
      .getByRole("heading", { name: "Bem-vindo ao Urbana", exact: true })
      .waitFor();
    if (name === "admin")
      await page.screenshot({ path: "test-results/onboarding-welcome.png" });
    await begin(page);
    if (name === "gestor") {
      assert.equal(
        await page
          .locator(".onboarding-card")
          .getByText("Planejamento", { exact: true })
          .count(),
        0,
      );
    }
    const steps = await finish(page, name);
    assert.ok(steps.length >= 3, name + " insufficient steps");
    if (name === "gestor") assert.ok(!steps.includes("plan"));
    if (name === "campo") {
      assert.ok(steps.includes("send") && steps.includes("return"));
      assert.match(page.url(), /\/campo/);
    }
    const state = await (
      await context.request.get(base + "/api/onboarding")
    ).json();
    assert.equal(state.status, "completed");
    assert.ok(state.completed_at);
    await page
      .getByRole("button", {
        name: /^(Começar a administrar|Ir para a operação|Ir para minhas demandas|Ver minhas tarefas|Ver serviços para conferência|Começar a consultar)$/,
      })
      .click();
    await page.reload();
    await page
      .getByRole("button", { name: "Ajuda: Como usar o Urbana" })
      .waitFor();
    assert.equal(await page.locator(".onboarding-layer").count(), 0);
    console.log("Onboarding " + name + ": " + steps.join(" → "));
    await context.close();
  }
  const { context: replayContext, page: replay } = await session("campo", {
    mobile: true,
    reduce: true,
  });
  const completion = (
    await (await replayContext.request.get(base + "/api/onboarding")).json()
  ).completed_at;
  await replay
    .getByRole("button", { name: "Ajuda: Como usar o Urbana" })
    .click();
  await replay.getByRole("heading", { name: "Como usar o Urbana" }).waitFor();
  assert.equal(
    await replay
      .getByRole("button", { name: "Como gerenciar acessos" })
      .count(),
    0,
  );
  await replay
    .getByRole("button", {
      name: "O que fazer quando não consigo executar",
      exact: true,
    })
    .click();
  await replay
    .getByRole("heading", { name: "Não conseguiu executar? Informe o motivo" })
    .waitFor();
  await replay.waitForFunction(
    () =>
      !document.querySelector(".onboarding-actions .button.primary")?.disabled,
  );
  await replay.keyboard.press("Tab");
  assert.ok(
    await replay.evaluate(() =>
      document
        .querySelector(".onboarding-card")
        ?.contains(document.activeElement),
    ),
  );
  assert.equal(
    await replay
      .locator(".onboarding-card")
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await replay.getByRole("button", { name: "Concluir", exact: true }).click();
  await replay
    .getByRole("heading", { name: "Tudo pronto!", exact: true })
    .waitFor();
  assert.equal(
    (await (await replayContext.request.get(base + "/api/onboarding")).json())
      .completed_at,
    completion,
  );
  await replay.getByRole("button", { name: "Começar", exact: true }).click();
  assert.ok(
    (
      await (await replayContext.request.get(base + "/api/onboarding")).json()
    ).tutorials.some((t) => t.tutorial_id === "task:return" && t.completed_at),
  );
  await replayContext.close();
  const { context: photosContext, page: photos } = await session("campo", {
    mobile: true,
  });
  await photos
    .getByRole("button", { name: "Ajuda: Como usar o Urbana" })
    .click();
  await photos
    .getByRole("button", { name: "Como registrar a foto depois", exact: true })
    .click();
  await photos
    .getByRole("heading", {
      name: "Registre o resultado do atendimento",
      exact: true,
    })
    .waitFor();
  await photos.waitForFunction(
    () =>
      !document.querySelector(".onboarding-actions .button.primary")?.disabled,
  );
  await photos.getByRole("button", { name: "Concluir", exact: true }).click();
  await photos
    .getByRole("heading", { name: "Tudo pronto!", exact: true })
    .waitFor();
  await photos.getByRole("button", { name: "Começar", exact: true }).click();
  await photosContext.close();
  const { context: emptyFieldContext, page: emptyField } = await session(
    "empty-field@test.local",
    { mobile: true },
  );
  await begin(emptyField);
  const emptySteps = await finish(emptyField, "empty-field");
  assert.equal(emptySteps.length, 6);
  await emptyFieldContext.close();
  // A missing final target completes the available steps, without inventing a checklist item.
  await db.run(
    "DELETE FROM user_onboarding WHERE user_id='consulta' AND tutorial_id='main'",
  );
  const { context: lastContext, page: last } = await session("consulta");
  await last.evaluate(() => {
    const strip = () => {
      if (document.querySelector('[data-onboarding-step="map"]')) {
        document
          .querySelectorAll('[data-guide="map"], [data-guide="page-heading"]')
          .forEach((e) => e.removeAttribute("data-guide"));
      }
    };
    new MutationObserver(strip).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-onboarding-step"],
    });
  });
  await begin(last);
  const available = await finish(last, "missing-final");
  assert.deepEqual(available, ["dashboard", "search", "occurrence", "orders"]);
  assert.equal(
    (await (await lastContext.request.get(base + "/api/onboarding")).json())
      .status,
    "completed",
  );
  assert.equal(await last.locator(".onboarding-checklist li").count(), 4);
  await lastContext.close();
  // Reloading an interrupted journey resumes at its persisted step.
  await db.run(
    "DELETE FROM user_onboarding WHERE user_id='gestor' AND tutorial_id='main'",
  );
  await db.run(
    "INSERT INTO user_onboarding(user_id,onboarding_version,tutorial_id,status,started_at,step_id,updated_at) VALUES(?,?,?,'started',?,?,?)",
    [
      "gestor",
      ONBOARDING_VERSION,
      "main",
      new Date().toISOString(),
      "track",
      new Date().toISOString(),
    ],
  );
  const { context: resumeContext, page: resume } = await session("gestor");
  await begin(resume);
  const resumed = await finish(resume, "resume");
  assert.deepEqual(resumed, ["track", "returned"]);
  await resumeContext.close();
  // Skip is durable and Escape restores normal interaction.
  await db.run(
    "DELETE FROM user_onboarding WHERE user_id='triagem' AND tutorial_id='main'",
  );
  const { context: skipContext, page: skip } = await session("triagem");
  await skip.getByRole("heading", { name: "Bem-vindo ao Urbana" }).waitFor();
  await skip.keyboard.press("Escape");
  await skip.locator(".onboarding-layer").waitFor({ state: "detached" });
  await skip.waitForFunction(() => !document.getElementById("root").inert);
  assert.equal(
    (await (await skipContext.request.get(base + "/api/onboarding")).json())
      .status,
    "skipped",
  );
  await skip.reload();
  await skip
    .getByRole("button", { name: "Ajuda: Como usar o Urbana" })
    .waitFor();
  assert.equal(await skip.locator(".onboarding-layer").count(), 0);
  await skipContext.close();
  const { context: emptyContext, page: empty } = await session(
    "no-modules@test.local",
  );
  await empty
    .getByRole("heading", { name: "Sem módulos disponíveis" })
    .waitFor();
  assert.equal(await empty.locator(".onboarding-layer").count(), 0);
  await empty
    .getByRole("button", { name: "Ajuda: Como usar o Urbana" })
    .click();
  await empty.getByRole("heading", { name: "Como usar o Urbana" }).waitFor();
  assert.equal(await empty.locator(".onboarding-tutorials button").count(), 0);
  await empty
    .getByRole("button", { name: "Fechar ajuda", exact: true })
    .click();
  await emptyContext.close();
  const { context: missingContext, page: missing } = await session(
    "missing-target@test.local",
    { missing: true },
  );
  await begin(missing);
  await missing
    .getByRole("heading", {
      name: "Nenhuma etapa disponível nesta tela",
      exact: true,
    })
    .waitFor();
  assert.equal(await missing.locator(".onboarding-highlight").count(), 0);
  await missing
    .getByRole("button", { name: "Começar a consultar", exact: true })
    .click();
  await missingContext.close();
  for (const table of tables)
    assert.deepEqual(
      await db.all("SELECT * FROM " + table),
      before[table],
      table + " changed during training",
    );
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  console.log(
    "Onboarding: replay, tutorials, skip, empty access, absent target, keyboard, reduced motion and zero business mutations approved.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
}
