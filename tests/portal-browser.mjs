// Portal do cidadão no navegador (viewport de celular): portal desligado (página "indisponível" com
// 404), administrador liga o portal em Administração > Configurações, cidadão registra uma demanda
// (erros associados aos campos, GPS, mapa, foto, consentimento), guarda número e código, acompanha,
// erra o código, vê a situação mudar depois que a triagem e a programação andam pela área interna
// (que mostra a origem "Portal do cidadão"), e o portal volta a ser desligado. Nenhuma violação de
// CSP no console. Requer `npm run build` (usa dist/ com a CSP estrita de produção).
import { launchBrowser } from "./support/browser.mjs";
import { skipInitialOnboarding } from "./onboarding-fixture.mjs";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "./map-browser-fixture.mjs";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import { registerPortalPages } from "../server/routes/portal.js";

const temp = mkdtempSync(join(tmpdir(), "urbana-portal-browser-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Portal@Test2026";
delete process.env.DATABASE_URL;
delete process.env.URBANA_PUBLIC_PORTAL;
const db = await openDatabase();
await seed(db);
await skipInitialOnboarding(db);
const app = createApp(db);
registerPortalPages(app, db, { file: resolve("dist/portal.html") });
app.use(express.static(resolve("dist")));
app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launchBrowser(chromium);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV6kAAAAASUVORK5CYII=",
  "base64",
);

// Collects CSP violations (event in the page) and console errors.
const watch = async (page, label) => {
  const problems = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations = window.__cspViolations || [];
      window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on("pageerror", (e) =>
    problems.push(`${label} pageerror: ${e.message}`),
  );
  page.on("console", (m) => {
    if (/Content.Security.Policy|Refused to/i.test(m.text()))
      problems.push(`${label} CSP: ${m.text()}`);
    else if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
      problems.push(`${label} console: ${m.text()}`);
  });
  return async () => [
    ...problems,
    ...(
      (await page
        .evaluate(() => window.__cspViolations || [])
        .catch(() => [])) || []
    ).map((v) => `${label} CSP event: ${v}`),
  ];
};
const noHorizontalScroll = (page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );

try {
  // ---------------------------------------------------------------- área interna (administrador)
  const adminContext = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const admin = await adminContext.newPage();
  const adminProblems = await watch(admin, "admin");
  await admin.goto(base + "/admin");
  await admin.getByLabel("E-mail", { exact: true }).fill("admin@urbana.local");
  await admin.getByLabel("Senha", { exact: true }).fill("Portal@Test2026");
  await admin.getByRole("button", { name: "Entrar", exact: true }).click();
  await admin
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  const portalForm = admin.locator("form.portal-settings");
  await portalForm
    .getByRole("heading", { name: "Portal do cidadão" })
    .waitFor();
  const enabled = portalForm.getByLabel(
    "Portal ligado (aceita registros e consultas públicas)",
  );
  assert.equal(await enabled.isChecked(), false, "portal vem desligado");
  assert.match(
    await portalForm
      .getByLabel("Texto de finalidade e consentimento (LGPD)")
      .inputValue(),
    /Lei Geral de Proteção de Dados/,
  );

  // ---------------------------------------------------------------- cidadão, portal desligado
  const citizenContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    permissions: ["geolocation"],
    geolocation: { latitude: -26.9931, longitude: -48.6342 },
    locale: "pt-BR",
  });
  const citizen = await citizenContext.newPage();
  const citizenProblems = await watch(citizen, "cidadão");
  const off = await citizen.goto(base + "/portal");
  assert.equal(off.status(), 404);
  await citizen
    .getByRole("heading", { name: "Portal indisponível", level: 1 })
    .waitFor();

  // ---------------------------------------------------------------- administrador liga o portal
  await enabled.check();
  await portalForm
    .getByRole("button", { name: "Salvar portal do cidadão" })
    .click();
  await portalForm
    .getByText("Configurações do portal salvas. O portal está ligado.")
    .waitFor();

  // ---------------------------------------------------------------- cidadão registra a demanda
  const page = await citizen.goto(base + "/portal");
  assert.equal(page.status(), 200);
  await citizen
    .getByRole("heading", { name: "Registrar uma demanda", level: 1 })
    .waitFor();
  await citizen.getByText("Prefeitura de Balneário Camboriú").waitFor();
  const formLoadedAt = Date.now();
  // Envio vazio: resumo de erros com foco e erros associados aos campos.
  await citizen.getByRole("button", { name: "Enviar demanda" }).click();
  const summary = citizen.locator("#error-summary");
  await summary.waitFor();
  assert.equal(
    await summary.evaluate((el) => el === document.activeElement),
    true,
    "foco vai para o resumo de erros",
  );
  const description = citizen.getByLabel("Descrição");
  assert.equal(await description.getAttribute("aria-invalid"), "true");
  assert.match(
    await description.getAttribute("aria-describedby"),
    /f-description-error/,
  );
  assert.match(
    await citizen.locator("#f-description-error").innerText(),
    /pelo menos 10 caracteres/,
  );
  await summary.getByRole("link", { name: /Descrição/ }).click();
  assert.equal(
    await description.evaluate((el) => el === document.activeElement),
    true,
    "link do resumo leva ao campo",
  );

  await citizen
    .getByLabel("Tipo de problema")
    .selectOption({ label: "Pavimentação" });
  await citizen.getByLabel("Detalhe do problema").selectOption("Buraco");
  await description.fill(
    "Buraco fundo na faixa da direita, perto do ponto de ônibus.",
  );
  await citizen.getByLabel("Endereço").fill("Avenida Brasil, 1500");
  await citizen.getByLabel("Bairro").fill("Centro");
  await citizen.getByLabel("Ponto de referência").fill("Em frente ao mercado");
  await citizen
    .getByRole("button", { name: "Usar minha localização (GPS)" })
    .click();
  await citizen.getByText(/Local marcado pelo GPS: -26\.9931/).waitFor();
  // Alternativa pelo mapa (carregado só agora).
  await citizen.getByRole("button", { name: "Marcar no mapa" }).click();
  const map = citizen.locator("#location-map.leaflet-container");
  await map.waitFor();
  await citizen.waitForTimeout(300);
  await map.click({ position: { x: 120, y: 150 } });
  await citizen.getByText(/Local marcado no mapa:/).waitFor();
  await citizen.getByRole("button", { name: "Usar o centro do mapa" }).click();
  await citizen
    .getByLabel("Foto")
    .setInputFiles({ name: "buraco.png", mimeType: "image/png", buffer: PNG });
  await citizen.getByLabel("Nome").fill("Joana Cidadã");
  await citizen.getByLabel("Telefone").fill("(47) 98888-0000");
  assert.equal(
    await noHorizontalScroll(citizen),
    true,
    "sem rolagem horizontal no celular",
  );
  // Sem consentimento ainda: erro só nesse campo.
  await citizen.getByRole("button", { name: "Enviar demanda" }).click();
  await summary.getByText(/Uso dos dados/).waitFor();
  assert.equal(
    await citizen.getByLabel(/Li e concordo/).getAttribute("aria-invalid"),
    "true",
  );
  await citizen.getByLabel(/Li e concordo/).check();
  // Tempo mínimo de preenchimento (5 s por padrão), como uma pessoa.
  const wait = 5500 - (Date.now() - formLoadedAt);
  if (wait > 0) await citizen.waitForTimeout(wait);
  await citizen.getByRole("button", { name: "Enviar demanda" }).click();
  const done = citizen.getByRole("heading", {
    name: "Demanda registrada",
    level: 1,
  });
  await done.waitFor();
  assert.equal(
    await done.evaluate((el) => el === document.activeElement),
    true,
    "foco no título do comprovante",
  );
  const protocol = (
    await citizen.locator("#receipt-protocol").innerText()
  ).trim();
  const code = (
    await citizen.locator("#receipt-code [aria-hidden=true]").innerText()
  ).trim();
  assert.match(protocol, /^OC-\d{4}-\d{5}$/);
  assert.match(code, /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/);
  const occurrence = await db.get("SELECT * FROM occurrences WHERE code=?", [
    protocol,
  ]);
  const data = JSON.parse(occurrence.data);
  assert.equal(data.origin, "Portal do cidadão");
  assert.equal(data.requested_by, "Joana Cidadã");
  assert.equal(data.public_portal.location_source, "mapa");
  assert.equal(
    Number(
      (
        await db.get("SELECT COUNT(*) AS n FROM evidence WHERE entity_id=?", [
          occurrence.id,
        ])
      ).n,
    ),
    1,
  );
  assert.equal(await noHorizontalScroll(citizen), true);

  // ---------------------------------------------------------------- acompanhar
  await citizen.getByRole("link", { name: "Acompanhar esta demanda" }).click();
  await citizen
    .getByRole("heading", { name: "Acompanhar demanda", level: 1 })
    .waitFor();
  assert.equal(
    await citizen.getByLabel("Número da demanda").inputValue(),
    protocol,
  );
  const codeField = citizen.getByLabel("Código de acompanhamento");
  // Código errado: mesma mensagem que um número inexistente, associada ao campo.
  await codeField.fill("2222-3333-4444-5555");
  await citizen.getByRole("button", { name: "Consultar" }).click();
  await citizen
    .locator("#track-error")
    .getByText(/não conferem/)
    .waitFor();
  assert.equal(await codeField.getAttribute("aria-invalid"), "true");
  await codeField.fill(code.toLowerCase());
  await citizen.getByRole("button", { name: "Consultar" }).click();
  await citizen.getByRole("heading", { name: "Situação: Recebida" }).waitFor();
  const result = citizen.locator("#tracking-result");
  assert.match(await result.innerText(), /Pavimentação/);
  assert.match(await result.innerText(), /Centro/);
  for (const secret of [
    "Joana",
    "98888",
    "Avenida Brasil",
    "Buraco fundo",
    "mercado",
  ])
    assert.ok(!(await result.innerText()).includes(secret), secret);
  assert.equal(
    await result
      .locator("li[aria-current=step]")
      .innerText()
      .then((t) => /Recebida/.test(t)),
    true,
  );

  // ---------------------------------------------------------------- triagem e programação (área interna)
  await admin.goto(base + "/ocorrencias");
  const row = admin.getByRole("row").filter({ hasText: protocol });
  await row.getByText(/Portal do cidadão/).waitFor();
  await row.click();
  await admin.getByText("Registrada pelo portal do cidadão").waitFor();
  await admin
    .getByText("Joana Cidadã")
    .first()
    .waitFor()
    .catch(() => {});
  const internal = async (path, body) => {
    const current = await (
      await admin.request.get(
        `${base}/api/${path.split("/")[1]}/${path.split("/")[2]}`,
      )
    ).json();
    const r = await admin.request.post(`${base}/api${path}`, {
      headers: { origin: base },
      data: { ...body, version: current.version },
    });
    assert.equal(r.status(), 200, `${path}: ${await r.text()}`);
    return r.json();
  };
  await internal(`/ocorrencias/${occurrence.id}/classificar`, {
    category_id: occurrence.category_id,
    subcategory: "Buraco",
    priority: "Alta",
    sector_id: occurrence.sector_id,
  });
  await citizen.getByRole("button", { name: "Atualizar" }).click();
  await citizen
    .getByRole("heading", { name: "Situação: Em análise" })
    .waitFor();
  const team = await db.get(
    "SELECT id FROM catalogs WHERE kind='equipes' AND data LIKE ?",
    [`%"sector_id":"${occurrence.sector_id}"%`],
  );
  const order = await admin.request.post(`${base}/api/ordens-servico`, {
    headers: { origin: base },
    data: {
      occurrence_ids: [occurrence.id],
      team_id: team.id,
      scheduled_at: "2026-12-01",
      responsible: "Supervisor interno",
    },
  });
  assert.equal(order.status(), 200, await order.text());
  await citizen.getByRole("button", { name: "Atualizar" }).click();
  await citizen
    .getByRole("heading", { name: "Situação: Programada" })
    .waitFor();
  const steps = await result.locator("ol.steps li").allInnerTexts();
  assert.equal(steps.length, 5);
  assert.match(steps[2], /Programada/);
  assert.ok(!(await result.innerText()).includes("Supervisor interno"));
  assert.ok(!(await result.innerText()).includes((await order.json()).code));

  // ---------------------------------------------------------------- portal desligado de novo
  await admin.goto(base + "/admin");
  await admin
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await portalForm
    .getByLabel("Portal ligado (aceita registros e consultas públicas)")
    .uncheck();
  await portalForm
    .getByRole("button", { name: "Salvar portal do cidadão" })
    .click();
  await portalForm
    .getByText("Configurações do portal salvas. O portal está desligado.")
    .waitFor();
  await citizen.getByRole("button", { name: "Atualizar" }).click();
  await citizen
    .getByRole("heading", { name: "Portal indisponível", level: 1 })
    .waitFor();
  const offAgain = await citizen.goto(base + "/portal/acompanhar");
  assert.equal(offAgain.status(), 404);
  await citizen
    .getByRole("heading", { name: "Portal indisponível", level: 1 })
    .waitFor();

  // The portal page never downloads the authenticated bundle.
  const requested = [];
  citizen.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await citizen.reload();
  await citizen
    .getByRole("heading", { name: "Portal indisponível", level: 1 })
    .waitFor();
  assert.ok(
    !requested.some((p) => /\/assets\/main-/.test(p)),
    requested.join(", "),
  );

  const problems = [...(await citizenProblems()), ...(await adminProblems())];
  assert.deepEqual(problems, [], problems.join("\n"));
  console.log("portal-browser: ok");
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(temp, { recursive: true, force: true });
}
