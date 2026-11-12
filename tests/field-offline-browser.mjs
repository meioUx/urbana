import { launchBrowser } from "./support/browser.mjs";
// Offline field operation end to end: tasks cached online → device offline → /campo reopens (HTML and
// assets from the service worker; the app boots from the session it saved in IndexedDB, with no /api
// response coming from the service worker) → a full execution cycle is queued offline → back online the
// queue is sent once, in order, with the real work times → a server rejection is shown and decided.
// Then: logout (field and management) leaves nothing to reopen offline; a management profile opens
// /campo offline and gets a clear message for the management area; 401 on revalidation asks for login.
import { skipInitialOnboarding } from "./onboarding-fixture.mjs";
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
const temp = mkdtempSync(join(tmpdir(), "urbana-field-offline-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Urbana@2026";
delete process.env.DATABASE_URL;
const db = await openDatabase();
await seed(db);
await skipInitialOnboarding(db);
// Production-like server: strict CSP from createApp, built app from dist/, SPA fallback.
const app = createApp(db);
app.use(express.static(resolve("dist")));
app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await launchBrowser(chromium);
const errors = [];
const photo = {
  name: "evidencia-offline.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV6kAAAAASUVORK5CYII=",
    "base64",
  ),
};
const login = async (page, email) => {
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("Urbana@2026");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
};
/** Reads an IndexedDB store of the field app inside the page. */
const readStore = (page, store) =>
  page.evaluate(
    (name) =>
      new Promise((done, fail) => {
        const open = indexedDB.open("urbana-field");
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(name)) return done([]);
          const request = db.transaction(name).objectStore(name).getAll();
          request.onsuccess = () => {
            db.close();
            done(
              request.result.map((v) => ({
                ...v,
                file: v.file
                  ? { size: v.file.size, type: v.file.type }
                  : v.file,
              })),
            );
          };
        };
      }),
    store,
  );
/** /api responses answered by the service worker (must stay empty: it never touches /api). */
const apiFromServiceWorker = [];
const watchApi = (page) =>
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/") && r.fromServiceWorker())
      apiFromServiceWorker.push(r.url());
  });
/** Waits until the service worker controls the page and holds the app shell. */
const shellReady = (page) =>
  waitFor(
    () =>
      page.evaluate(async () => {
        if (!navigator.serviceWorker.controller) return false;
        const cache = await caches.open("urbana-shell-v4");
        const keys = (await cache.keys()).map((r) => new URL(r.url).pathname);
        return (
          keys.includes("/__urbana-shell__") &&
          keys.some((k) => /^\/assets\/Operator-.*\.js$/.test(k)) &&
          keys.some((k) => /^\/assets\/index-.*\.js$/.test(k))
        );
      }),
    "shell do app no cache do service worker",
  );
const waitFor = async (check, message, timeout = 15000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`Tempo esgotado: ${message}`);
    await new Promise((r) => setTimeout(r, 150));
  }
};

try {
  // Manager side (always online): two orders assigned to the field operator "campo".
  const adminContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const admin = await adminContext.newPage();
  admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto(url);
  await login(admin, "admin@urbana.local");
  await admin
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  const post = async (path, data) => {
    const r = await admin.request.post(url + "/api" + path, {
      headers: { origin: url },
      data,
    });
    assert.equal(r.status(), 200, `${path}: ${await r.text()}`);
    return r.json();
  };
  const get = async (path) =>
    (await admin.request.get(url + "/api" + path)).json();
  const createOrder = async (address, lat) => {
    const o = await post("/ocorrencias", {
      category_id: "category-1",
      subcategory: "Buraco",
      description: "Buraco profundo na faixa",
      origin: "Fiscalização municipal",
      priority: "Alta",
      lat,
      lng: -48.61,
      address,
      neighborhood: "Centro",
    });
    await post(`/ocorrencias/${o.id}/classificar`, {
      version: o.version,
      category_id: "category-1",
      subcategory: "Buraco",
      priority: "Alta",
      sector_id: "sector-1",
    });
    return post("/ordens-servico", {
      occurrence_ids: [o.id],
      team_id: "team-1",
      assigned_user_id: "campo",
      scheduled_at: "2026-10-10",
      responsible: "Equipe de pavimentação",
      notes: "Executar sem sinal de celular.",
    });
  };
  const orderA = await createOrder("Rua Sem Sinal, 10", -30.11);
  const orderB = await createOrder("Rua Reatribuída, 20", -30.12);

  const fieldContext = await browser.newContext({
    serviceWorkers: "allow",
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: -30.11, longitude: -48.61 },
    permissions: ["geolocation"],
  });
  const field = await fieldContext.newPage();
  field.on("pageerror", (e) => errors.push(e.message));
  watchApi(field);
  field.on("console", (m) => {
    if (
      m.type() === "error" &&
      /Content Security Policy|Refused/i.test(m.text())
    )
      errors.push(m.text());
  });
  await field.goto(url + "/campo");
  // A device that already used the app has a version 1 database with a draft: it must survive the migration.
  await field.evaluate(
    () =>
      new Promise((done, fail) => {
        const open = indexedDB.open("urbana-field", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("drafts");
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("drafts", "readwrite");
          tx.objectStore("drafts").put(
            {
              request_id: crypto.randomUUID(),
              photo_request_id: crypto.randomUUID(),
              category_id: "category-1",
              subcategory: "Buraco",
              address: "Rascunho legado, 10",
              neighborhood: "Centro",
              reference: "",
              description: "Rascunho criado antes da atualização.",
              lat: "",
              lng: "",
              priority: "Média",
              origin: "Equipe de campo",
              file: null,
            },
            "occurrence:campo",
          );
          tx.oncomplete = () => {
            open.result.close();
            done();
          };
        };
      }),
  );
  await login(field, "campo@urbana.local");
  await field
    .getByRole("heading", { name: "Minhas tarefas", exact: true })
    .waitFor();
  await field
    .locator(".operator-task")
    .filter({ hasText: orderA.code })
    .waitFor();
  // Service worker controls the page and holds the app shell (HTML + Operator chunk).
  await field.evaluate(() =>
    navigator.serviceWorker.ready.then(() => undefined),
  );
  await shellReady(field);
  // No authenticated API response is in the Cache Storage.
  assert.equal(
    await field.evaluate(async () => {
      for (const name of await caches.keys())
        for (const r of await (await caches.open(name)).keys())
          if (new URL(r.url).pathname.startsWith("/api/")) return true;
      return false;
    }),
    false,
  );
  // Active orders were prefetched into IndexedDB (detail needed to execute), with the session for offline boot.
  await waitFor(
    async () =>
      (await readStore(field, "cache")).some(
        (e) => e.key === `campo|order|${orderB.id}`,
      ),
    "detalhe das OS no IndexedDB",
  );
  const session = await readStore(field, "session");
  assert.equal(session[0].user_id, "campo");
  // Migrated draft is still there.
  await field.getByRole("button", { name: "Registrar", exact: true }).click();
  await field.getByLabel("Rua e número", { exact: true }).waitFor();
  assert.equal(
    await field.getByLabel("Rua e número", { exact: true }).inputValue(),
    "Rascunho legado, 10",
  );
  await field.getByRole("button", { name: "Tarefas", exact: true }).click();

  // ---- Offline from here on: reload /campo and work.
  await fieldContext.setOffline(true);
  const offlineBootstrap = field.waitForEvent("requestfailed", (r) =>
    r.url().endsWith("/api/bootstrap"),
  );
  await field.reload();
  // The bootstrap request fails (the service worker does not answer it); the app boots from IndexedDB.
  await offlineBootstrap;
  await field
    .getByRole("heading", { name: "Minhas tarefas", exact: true })
    .waitFor();
  await field.getByTestId("cached-notice").first().waitFor();
  await field
    .getByText("Sem conexão. Continue o trabalho", { exact: false })
    .waitFor();
  await field
    .locator(".operator-task")
    .filter({ hasText: orderA.code })
    .click();
  await field
    .getByRole("heading", { name: orderA.code, exact: true })
    .waitFor();
  await field.getByTestId("cached-notice").waitFor();
  await field
    .getByRole("button", { name: "Estou a caminho", exact: true })
    .click();
  await field
    .getByText("Deslocamento guardado neste aparelho", { exact: false })
    .waitFor();
  await field
    .locator(".operator-page-heading .operator-status")
    .getByText("A caminho", { exact: true })
    .waitFor();
  await field
    .getByRole("button", { name: "Capturar GPS do local", exact: true })
    .click();
  await field.getByText("GPS: -30.11000, -48.61000", { exact: true }).waitFor();
  // Local validation: the server rule (before photo) is anticipated, with focus on the message.
  await field
    .getByRole("button", {
      name: "Confirmar chegada e iniciar serviço",
      exact: true,
    })
    .click();
  const beforeMissing = field
    .getByRole("alert")
    .filter({ hasText: "Anexe uma foto antes de iniciar a execução." });
  await beforeMissing.waitFor();
  assert.equal(
    await beforeMissing.evaluate((el) => document.activeElement === el),
    true,
  );
  await field.getByLabel("Foto antes", { exact: true }).setInputFiles(photo);
  await field
    .getByRole("button", { name: "Enviar foto antes", exact: true })
    .click();
  await field
    .getByText("✓ Foto guardada · aguardando envio", { exact: true })
    .waitFor();
  await field
    .getByRole("button", {
      name: "Confirmar chegada e iniciar serviço",
      exact: true,
    })
    .click();
  await field
    .getByRole("heading", { name: "Materiais utilizados", exact: true })
    .waitFor();
  await field
    .getByLabel("Material utilizado", { exact: true })
    .selectOption("material-1");
  await field.getByLabel("Quantidade utilizada", { exact: true }).fill("4");
  await field
    .getByRole("button", { name: "Adicionar material", exact: true })
    .click();
  await field.getByText("CBUQ · 4 kg", { exact: false }).waitFor();
  await field
    .getByLabel("Equipamento utilizado", { exact: true })
    .selectOption("equipment-1");
  await field
    .getByRole("button", { name: "Vincular equipamento", exact: true })
    .click();
  await field
    .getByText("Caminhão basculante · aguardando envio", { exact: false })
    .waitFor();
  await field
    .getByLabel("O que foi feito", { exact: true })
    .fill("Tapa-buraco executado sem sinal de celular.");
  await field
    .getByRole("button", { name: "Enviar para análise", exact: true })
    .click();
  await field
    .getByRole("alert")
    .filter({ hasText: "Anexe uma foto depois do serviço." })
    .waitFor();
  await field.getByLabel("Foto depois", { exact: true }).setInputFiles(photo);
  await field
    .getByRole("button", { name: "Enviar foto depois", exact: true })
    .click();
  await field
    .getByAltText("Foto depois do serviço (aguardando envio)", { exact: true })
    .waitFor();
  await field
    .getByRole("button", { name: "Enviar para análise", exact: true })
    .click();
  await field
    .getByText("Resultado guardado neste aparelho. Será enviado para análise", {
      exact: false,
    })
    .first()
    .waitFor();
  await field
    .locator(".operator-page-heading .operator-status")
    .getByText("Em análise", { exact: true })
    .waitFor();
  await field.screenshot({
    path: "test-results/field-offline-queued.png",
    fullPage: true,
  });
  assert.equal(
    await field.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  // Second order: queued offline, then reassigned by the manager before the device reconnects.
  await field
    .getByRole("button", { name: "Voltar às tarefas", exact: true })
    .click();
  await field
    .locator(".operator-task")
    .filter({ hasText: orderB.code })
    .click();
  await field
    .getByRole("button", { name: "Estou a caminho", exact: true })
    .click();
  await field
    .getByText("Deslocamento guardado neste aparelho", { exact: false })
    .waitFor();
  await field
    .getByRole("button", { name: "Voltar às tarefas", exact: true })
    .click();
  await field
    .getByText("8 ações aguardando envio", { exact: false })
    .first()
    .waitFor();
  const queued = await readStore(field, "outbox");
  assert.equal(queued.length, 8);
  assert.ok(
    queued.every(
      (i) =>
        i.user_id === "campo" && /^[0-9a-f-]{36}$/.test(i.id) && i.captured_at,
    ),
  );
  assert.deepEqual(
    queued.filter((i) => i.kind === "anexo").map((i) => i.file.size),
    [photo.buffer.length, photo.buffer.length],
  );
  const capturedAt = Object.fromEntries(
    queued
      .filter((i) => i.order_id === orderA.id)
      .map((i) => [i.kind === "anexo" ? i.body.stage : i.kind, i.captured_at]),
  );
  // Nothing reached the server yet.
  assert.equal(
    (await get(`/ordens-servico/${orderA.id}`)).status,
    "PROGRAMADA",
  );
  const b = await get(`/ordens-servico/${orderB.id}`);
  assert.equal(
    (
      await admin.request.post(
        url + `/api/ordens-servico/${orderB.id}/programacao`,
        {
          headers: { origin: url },
          data: {
            version: b.version,
            team_id: "team-2",
            responsible: "Equipe de drenagem",
            scheduled_at: "2026-10-12",
          },
        },
      )
    ).status(),
    200,
  );

  // ---- Back online: the queue is sent automatically.
  await fieldContext.setOffline(false);
  await field
    .getByRole("alert")
    .filter({ hasText: "1 ação foi recusada pelo servidor" })
    .waitFor({ timeout: 30000 });
  await waitFor(
    async () => (await readStore(field, "outbox")).length === 1,
    "fila enviada",
  );
  const done = await get(`/ordens-servico/${orderA.id}`);
  assert.equal(done.status, "AGUARDANDO_VALIDACAO");
  assert.equal(done.started_at, capturedAt.iniciar);
  assert.equal(done.finished_at, capturedAt.concluir);
  assert.equal(
    done.completion_notes,
    "Tapa-buraco executado sem sinal de celular.",
  );
  assert.deepEqual(done.evidence.map((e) => [e.stage, e.captured_at]).sort(), [
    ["antes", capturedAt.antes],
    ["depois", capturedAt.depois],
  ]);
  assert.equal(done.materials.length, 1);
  assert.equal(done.materials[0].quantity, 4);
  assert.deepEqual(
    done.equipment.map((e) => e.equipment_id),
    ["equipment-1"],
  );
  const transitions = (
    await db.all(
      "SELECT event FROM audit_logs WHERE entity_type='order' AND entity_id=? AND event LIKE '%→%'",
      [orderA.id],
    )
  )
    .map((r) => r.event.split(":")[0])
    .sort();
  assert.deepEqual(transitions, ["assumir", "concluir", "iniciar"]);
  // The rejection is shown with a readable reason; the reassigned order left the device list.
  const rejected = field.locator(".operator-outbox-item.rejected");
  await rejected
    .getByText("Esta ordem foi transferida para outra equipe ou operador", {
      exact: false,
    })
    .waitFor();
  await rejected.getByText(orderB.code, { exact: false }).waitFor();
  await waitFor(
    async () =>
      (await field
        .locator(".operator-task")
        .filter({ hasText: orderB.code })
        .count()) === 0,
    "OS reatribuída sai da lista",
  );
  await field.screenshot({
    path: "test-results/field-offline-rejected.png",
    fullPage: true,
  });
  await rejected
    .getByRole("button", { name: "Descartar", exact: true })
    .click();
  await field
    .getByRole("button", { name: "Confirmar descarte", exact: true })
    .click();
  await waitFor(
    async () => (await readStore(field, "outbox")).length === 0,
    "ação descartada",
  );
  assert.equal(await field.locator(".operator-outbox").count(), 0);
  assert.equal(
    (await get(`/ordens-servico/${orderB.id}`)).status,
    "PROGRAMADA",
  );
  // Sent order shows the server state (photos from /api/anexos, no pending marks).
  await field
    .locator(".operator-tabs")
    .getByRole("button", { name: "Enviadas e histórico", exact: true })
    .click();
  await field
    .locator(".operator-task")
    .filter({ hasText: orderA.code })
    .click();
  await field
    .getByText(
      "Resultado enviado. Aguarde a análise da gestão para o fechamento.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await field.getByText("aguardando envio", { exact: false }).count(),
    0,
  );

  // ---- Logout clears this user's offline data: reopening offline does not show the tasks.
  await field
    .getByRole("button", { name: "Sair da conta", exact: true })
    .click();
  await field.getByLabel("E-mail", { exact: true }).waitFor();
  await waitFor(
    async () =>
      (await readStore(field, "cache")).length === 0 &&
      (await readStore(field, "session")).length === 0,
    "dados locais apagados no logout",
  );
  await fieldContext.setOffline(true);
  await field.goto(url + "/campo");
  await field.getByLabel("E-mail", { exact: true }).waitFor();
  assert.equal(
    await field
      .getByRole("heading", { name: "Minhas tarefas", exact: true })
      .count(),
    0,
  );
  await fieldContext.setOffline(false);

  // ---- Management profile on /campo: opens offline from its saved session; the management area
  // shows a clear message; management logout (sidebar) also removes the saved session.
  const gestorContext = await browser.newContext({
    serviceWorkers: "allow",
    viewport: { width: 1280, height: 900 },
  });
  const gestor = await gestorContext.newPage();
  gestor.on("pageerror", (e) => errors.push(e.message));
  watchApi(gestor);
  await gestor.goto(url + "/campo");
  await login(gestor, "admin@urbana.local");
  await gestor
    .getByRole("heading", { name: "Minhas tarefas", exact: true })
    .waitFor();
  await shellReady(gestor);
  await waitFor(
    async () => (await readStore(gestor, "session"))[0]?.user_id === "admin",
    "sessão do perfil de gestão salva",
  );
  await gestorContext.setOffline(true);
  await gestor.reload();
  await gestor
    .getByRole("heading", { name: "Minhas tarefas", exact: true })
    .waitFor();
  await gestor
    .getByRole("button", { name: "Voltar ao painel de gestão", exact: true })
    .click();
  await gestor
    .getByRole("heading", { name: "Sem conexão com o servidor", exact: true })
    .waitFor();
  assert.equal(await gestor.getByLabel("E-mail", { exact: true }).count(), 0);
  await gestor
    .getByRole("button", { name: "Abrir o Campo", exact: true })
    .click();
  await gestor
    .getByRole("heading", { name: "Minhas tarefas", exact: true })
    .waitFor();
  // Back online: the real bootstrap replaces the saved one; the management area works again.
  const revalidated = gestor.waitForResponse(
    (r) => r.url().endsWith("/api/bootstrap") && r.status() === 200,
  );
  await gestorContext.setOffline(false);
  await revalidated;
  await gestor
    .getByRole("button", { name: "Voltar ao painel de gestão", exact: true })
    .click();
  await gestor.locator("aside.sidebar button.profile").click();
  await gestor.getByLabel("E-mail", { exact: true }).waitFor();
  assert.deepEqual(await readStore(gestor, "session"), []);
  await gestorContext.setOffline(true);
  await gestor.goto(url + "/campo");
  await gestor.getByLabel("E-mail", { exact: true }).waitFor();
  assert.equal(
    await gestor
      .getByRole("heading", { name: "Minhas tarefas", exact: true })
      .count(),
    0,
  );
  await gestorContext.setOffline(false);

  // ---- Saved session, but the server session is gone (401 on revalidation): asks for login.
  await gestor.goto(url + "/campo");
  await login(gestor, "campo@urbana.local");
  await gestor
    .getByRole("heading", { name: "Minhas tarefas", exact: true })
    .waitFor();
  await waitFor(
    async () => (await readStore(gestor, "session"))[0]?.user_id === "campo",
    "sessão de Campo salva",
  );
  await gestorContext.setOffline(true);
  await gestor.reload();
  await gestor
    .getByRole("heading", { name: "Minhas tarefas", exact: true })
    .waitFor();
  await gestorContext.clearCookies();
  const unauthorized = gestor.waitForResponse(
    (r) => r.url().endsWith("/api/bootstrap") && r.status() === 401,
  );
  await gestorContext.setOffline(false);
  await unauthorized;
  await gestor
    .getByRole("alert")
    .filter({ hasText: "Sua sessão expirou." })
    .waitFor();
  // Reopening online: the real 401 leads to login and removes the saved session.
  await gestor.reload();
  await gestor.getByLabel("E-mail", { exact: true }).waitFor();
  await waitFor(
    async () => (await readStore(gestor, "session")).length === 0,
    "sessão salva apagada após 401",
  );
  await gestorContext.close();

  assert.deepEqual(apiFromServiceWorker, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        field: "390x844",
        shellCached: true,
        offlineReload: true,
        queuedActions: 8,
        syncedInOrder: true,
        capturedAtPreserved: true,
        duplicates: 0,
        rejectionShown: true,
        logoutClearsCache: true,
        apiFromServiceWorker,
        managementOfflineMessage: true,
        managementLogoutClearsSession: true,
        revalidation401AsksLogin: true,
        draftMigrated: true,
        consoleErrors: errors,
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
