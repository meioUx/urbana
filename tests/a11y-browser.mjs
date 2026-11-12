// Auditoria AUTOMATIZADA de acessibilidade (R7). Percorre as telas da gestão, do Campo e do portal
// público em desktop (1440x900) e celular (390x844) com o axe (WCAG 2.1 A/AA + boas práticas) e
// complementa com verificações que o axe não faz: teclado (ordem, foco visível, armadilha, Escape),
// alvo de toque (24x24), reflow a 320 px e 200% de zoom, prefers-reduced-motion, lang e <title>.
//
// Falha em violação WCAG de impacto serious/critical; moderate/minor e boas práticas são só listadas.
// Isto NÃO é certificação de conformidade: leitor de tela, usuários reais e aparelhos seguem pendentes.
// Requer `npm run build` (usa dist/). Relatório completo em test-results/a11y-report.json.
import { launchBrowser } from "./support/browser.mjs";
import { skipInitialOnboarding } from "./onboarding-fixture.mjs";
import { navigate } from "./navigation.mjs";
import { chromium } from "./map-browser-fixture.mjs";
import {
  Report,
  scan,
  summarize,
  tabThrough,
  hasVisibleFocus,
  visualOrderJumps,
  undersizedTargets,
  overflowReport,
  motionReport,
} from "./support/a11y.mjs";
import assert from "node:assert/strict";
import express from "express";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import { registerPortalPages } from "../server/routes/portal.js";

mkdirSync("test-results", { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "urbana-a11y-browser-"));
const PASSWORD = "A11y@Test2026";
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = PASSWORD;
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
const report = new Report();
const pageErrors = [];
const VIEWPORTS = {
  desktop: { name: "desktop", width: 1440, height: 900, mobile: false },
  celular: { name: "celular", width: 390, height: 844, mobile: true },
};
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV6kAAAAASUVORK5CYII=",
  "base64",
);

// Exceções: só por regra + seletor, com o motivo, nunca desligando a regra para a página toda
// (`report.allow(regra, seletor, motivo)`; as ocorrências ficam no relatório como "excecoes").
// A auditoria atual não precisou de nenhuma: o que sobrou de achado está em "notas" do relatório
// (marcadores do Leaflet com 16 px e resultados que o axe não consegue decidir).

const newContext = (vp, extra = {}) =>
  browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    locale: "pt-BR",
    permissions: ["geolocation"],
    geolocation: { latitude: -26.9931, longitude: -48.6342 },
    ...extra,
  });
const watch = (page) => {
  page.on("pageerror", (e) => pageErrors.push(e.message));
};
const login = async (page, email, path = "/") => {
  await page.goto(base + path);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
};
const post = async (page, path, data) => {
  const r = await page.request.post(base + "/api" + path, {
    headers: { origin: base },
    data,
  });
  assert.ok(r.ok(), `${path}: ${r.status()} ${await r.text()}`);
  return r.json();
};
const settle = (page, ms = 450) => page.waitForTimeout(ms);
async function openMenu(page, vp) {
  if (vp.mobile && !(await page.locator(".sidebar.open").count()))
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
}
/** Menu lateral: no celular ele é gaveta e precisa ser aberto antes. */
async function go(page, vp, title) {
  if (process.env.A11Y_VERBOSE) console.error(`[a11y]   ir para ${title}`);
  await openMenu(page, vp);
  await navigate(page, title);
  await page.locator("main h1").first().waitFor();
  await settle(page);
}
const phasesRequested = () =>
  new Set(
    (
      process.env.A11Y_PHASES ||
      "management,field,portal,keyboard,reflow,motion"
    ).split(","),
  );
const targets = [];
const pageInfo = [];
async function audit(page, vp, screen, options = {}) {
  if (process.env.A11Y_VERBOSE) console.error(`[a11y] ${vp.name} · ${screen}`);
  await scan(report, page, screen, vp.name, options);
  pageInfo.push({
    vp: vp.name,
    screen,
    ...(await page.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang,
    }))),
  });
  const small = await page.evaluate(undersizedTargets);
  if (small.length) targets.push({ vp: vp.name, screen, small });
}

// ------------------------------------------------------------------------ dados de apoio
const admin0 = await browser.newContext({ locale: "pt-BR" });
const api = await admin0.newPage();
await api.goto(base);
await api.getByLabel("E-mail", { exact: true }).fill("admin@urbana.local");
await api.getByLabel("Senha", { exact: true }).fill(PASSWORD);
await api.getByRole("button", { name: "Entrar", exact: true }).click();
await api.getByRole("heading", { name: "Visão geral", exact: true }).waitFor();
// Duas demandas na mesma rua, triadas: viram candidatas do Planejamento.
for (const number of [100, 200]) {
  const o = await post(api, "/ocorrencias", {
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
  });
  await post(api, `/ocorrencias/${o.id}/classificar`, {
    version: o.version,
    category_id: "category-1",
    subcategory: "Buraco",
    priority: "Baixa",
    sector_id: "sector-1",
  });
}
// Uma OS do operador de campo, em execução, para a tela de execução do Campo.
const fieldOccurrence = await post(api, "/ocorrencias", {
  category_id: "category-1",
  subcategory: "Buraco",
  description: "Buraco na pista para auditoria de acessibilidade",
  origin: "Fiscalização municipal",
  priority: "Alta",
  lat: -27,
  lng: -48.6,
  address: "Rua Acessível, 10",
  neighborhood: "Centro",
  duplicate_action: "new",
});
await post(api, `/ocorrencias/${fieldOccurrence.id}/classificar`, {
  version: fieldOccurrence.version,
  category_id: "category-1",
  subcategory: "Buraco",
  priority: "Alta",
  sector_id: "sector-1",
});
const fieldOrder = await post(api, "/ordens-servico", {
  occurrence_ids: [fieldOccurrence.id],
  team_id: "team-1",
  scheduled_at: "2026-12-01",
  responsible: "Equipe de pavimentação",
  assigned_user_id: "campo",
  operator_instructions: "Sinalizar a via e reparar o pavimento.",
});
await db.run("UPDATE orders SET status='EM_EXECUCAO' WHERE id=?", [
  fieldOrder.id,
]);

// Outra OS do operador, ainda a fazer, para gerar uma pendência de envio sem rede.
const pendingOccurrence = await post(api, "/ocorrencias", {
  category_id: "category-1",
  subcategory: "Buraco",
  description: "Segunda demanda para auditoria de acessibilidade",
  origin: "Fiscalização municipal",
  priority: "Média",
  lat: -27.01,
  lng: -48.61,
  address: "Rua Pendente, 20",
  neighborhood: "Centro",
  duplicate_action: "new",
});
await post(api, `/ocorrencias/${pendingOccurrence.id}/classificar`, {
  version: pendingOccurrence.version,
  category_id: "category-1",
  subcategory: "Buraco",
  priority: "Média",
  sector_id: "sector-1",
});
const pendingOrder = await post(api, "/ordens-servico", {
  occurrence_ids: [pendingOccurrence.id],
  team_id: "team-1",
  scheduled_at: "2026-12-02",
  responsible: "Equipe de pavimentação",
  assigned_user_id: "campo",
});

// Portal público: primeiro a página "indisponível" (desligado), depois liga pela API de configurações
// (a tela de Administração, com o portal ligado, é auditada em management()).
for (const vp of Object.values(VIEWPORTS)) {
  const ctx = await newContext(vp);
  const page = await ctx.newPage();
  const response = await page.goto(base + "/portal");
  assert.equal(response.status(), 404);
  await page
    .getByRole("heading", { name: "Portal indisponível", level: 1 })
    .waitFor();
  if (phasesRequested().has("portal") || phasesRequested().has("management"))
    await audit(page, vp, "Portal · indisponível");
  await ctx.close();
}
const portalSettings = await (
  await api.request.get(`${base}/api/settings/portal`)
).json();
const enabledPortal = await api.request.patch(`${base}/api/settings/portal`, {
  headers: { origin: base },
  data: {
    enabled: true,
    consent_text: portalSettings.consent_text,
    create_per_ip_hour: portalSettings.create_per_ip_hour,
    track_per_ip_15min: portalSettings.track_per_ip_15min,
    global_per_hour: portalSettings.global_per_hour,
    min_fill_seconds: portalSettings.min_fill_seconds,
  },
});
assert.ok(
  enabledPortal.ok(),
  `ligar o portal: ${enabledPortal.status()} ${await enabledPortal.text()}`,
);

// ------------------------------------------------------------------------ gestão
async function management(vp) {
  const ctx = await newContext(vp);
  const page = await ctx.newPage();
  watch(page);
  // Login e mensagem de erro
  await page.goto(base);
  await page.getByLabel("E-mail", { exact: true }).waitFor();
  await audit(page, vp, "Login");
  await page.getByLabel("E-mail", { exact: true }).fill("admin@urbana.local");
  await page.getByLabel("Senha", { exact: true }).fill("senha-incorreta");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("alert").first().waitFor();
  await audit(page, vp, "Login com erro");
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Evolução das operações", exact: true })
    .waitFor();
  await audit(page, vp, "Visão geral");

  await openMenu(page, vp);
  await page
    .getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name: "Ocorrências", exact: true })
    .click();
  await audit(page, vp, "Menu lateral com grupo expandido");

  // Ocorrências
  await go(page, vp, "Ocorrências");
  await page.locator("tbody tr").first().waitFor();
  await audit(page, vp, "Ocorrências (lista)");
  await page
    .getByLabel("Buscar registros", { exact: true })
    .fill("zzz-sem-resultado");
  await settle(page, 700);
  await audit(page, vp, "Ocorrências (estado vazio)");
  await page.getByLabel("Buscar registros", { exact: true }).fill("");
  await page.locator("tbody tr").first().waitFor();
  await page
    .getByRole("button", { name: "Nova ocorrência", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await audit(page, vp, "Nova ocorrência (modal)");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Registrar ocorrência", exact: true })
    .click();
  await settle(page);
  await audit(page, vp, "Nova ocorrência (validação)");
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog")
    .waitFor({ state: "hidden" })
    .catch(async () => {
      await page.getByRole("button", { name: "Fechar", exact: true }).click();
    });
  await page.locator("tbody tr").first().click();
  await page.getByRole("dialog").waitFor();
  await audit(page, vp, "Ocorrência (detalhe)");
  await page.getByRole("button", { name: "Fechar", exact: true }).click();

  // Triagem
  await go(page, vp, "Triagem");
  await page
    .locator("tbody tr")
    .first()
    .waitFor()
    .catch(() => {});
  await audit(page, vp, "Triagem");

  // Ordens de serviço
  await go(page, vp, "Ordens de serviço");
  await page.locator("tbody tr").first().waitFor();
  await audit(page, vp, "Ordens de serviço (lista)");
  await page.locator("tbody tr").first().click();
  await page.getByRole("dialog").waitFor();
  await audit(page, vp, "Ordem de serviço (detalhe)");
  await page.getByRole("button", { name: "Execução", exact: true }).click();
  await audit(page, vp, "Ordem de serviço (execução)");
  await page.getByRole("button", { name: "Fechar", exact: true }).click();

  // Planejamento
  await go(page, vp, "Planejamento");
  await page
    .getByRole("heading", { name: "Planejamento", exact: true, level: 1 })
    .waitFor();
  await audit(page, vp, "Planejamento (escolher obras)");
  await page.getByLabel("Buscar rua no planejamento").fill("Planejamento UI");
  await page
    .getByRole("button", { name: "Planejar esta obra", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await audit(page, vp, "Planejamento (diálogo de plano)");
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog")
    .waitFor({ state: "hidden" })
    .catch(() => {});
  await page.getByRole("tab", { name: /Planos e execução/ }).click();
  await audit(page, vp, "Planejamento (planos e execução)");

  // Kanban
  await go(page, vp, "Kanban de equipes");
  await page
    .getByRole("region", { name: "Quadro de gestão das equipes" })
    .waitFor();
  await audit(page, vp, "Kanban");
  const move = page.locator('select[aria-label^="Mover "]').first();
  await move.scrollIntoViewIfNeeded();
  await move.selectOption({ index: 1 });
  await page.getByRole("dialog").waitFor();
  await audit(page, vp, "Kanban (diálogo de mover)");
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog")
    .waitFor({ state: "hidden" })
    .catch(() => {});

  // Mapa territorial
  await go(page, vp, "Mapa territorial");
  await page.locator(".leaflet-container").first().waitFor();
  await page
    .locator(".leaflet-tile-loaded")
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  await audit(page, vp, "Mapa territorial");
  // Tela cheia do mapa (/mapa): painel de filtros e resumo operacional de um marcador.
  await page.goto(base + "/mapa");
  await page.locator(".territorial-view .leaflet-container").waitFor();
  const marker = page
    .locator(".leaflet-overlay-pane path[role=button]")
    .first();
  await marker.waitFor();
  await audit(page, vp, "Mapa territorial (tela cheia)");
  const filters = page.getByRole("button", { name: /^Filtros/ });
  await filters.click();
  await audit(page, vp, "Mapa territorial (filtros abertos)");
  await page.keyboard.press("Escape");
  await marker.focus();
  await page.keyboard.press("Enter");
  await page.locator(".operational-popup .operational-summary").waitFor();
  await audit(page, vp, "Mapa territorial (resumo da ocorrência)");
  await page.goto(base + "/");
  await page
    .getByRole("heading", { name: "Evolução das operações", exact: true })
    .waitFor();

  // Obras e intervenções
  await openMenu(page, vp);
  await page
    .getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name: "Obras e intervenções" })
    .click();
  await page
    .getByRole("heading", { name: "Obras e intervenções", level: 1 })
    .waitFor();
  await settle(page);
  await audit(page, vp, "Obras (lista, estado vazio)");
  await page.getByRole("button", { name: "Nova intervenção" }).click();
  const form = page.getByRole("dialog", { name: "Nova intervenção" });
  await form.getByLabel("Título").fill("Recapeamento da Avenida Central");
  await form.locator(".geometry-map .leaflet-container").waitFor();
  await audit(page, vp, "Obras (formulário com editor de geometria)");
  await page.keyboard.press("Escape");
  await form.waitFor({ state: "hidden" }).catch(() => {});
  // Cria uma intervenção e uma obra pela API para auditar lista, detalhe e abas preenchidos.
  const geometry = {
    type: "LineString",
    coordinates: [
      [-48.64, -26.99],
      [-48.63, -26.99],
    ],
  };
  if (
    !(await api.evaluate(
      async () =>
        (await (await fetch("/api/intervencoes")).json()).items?.length,
    ))
  ) {
    const it = await post(api, "/intervencoes", {
      title: "Recapeamento da Avenida Central",
      description: "Fresagem e recomposição do pavimento",
      scope: "TRECHO",
      location: "Av. Central, entre Rua 1500 e Rua 1600",
      neighborhood: "Centro",
      sector_id: "sector-1",
      responsible: "Eng. Marta Lima",
      priority: "Alta",
      planned_start: "2026-12-01",
      planned_end: "2026-12-10",
      geometry,
      services: [{ description: "Fresagem", quantity: 1200, unit: "m²" }],
    });
    await post(api, "/obras", {
      title: "Requalificação da Avenida Central",
      responsible: "Eng. Marta Lima",
      planned_start: "2026-12-01",
      planned_end: "2026-12-31",
      intervention_ids: [it.id],
    }).catch(() => {});
  }
  await page.reload();
  await page
    .getByRole("heading", { name: "Obras e intervenções", level: 1 })
    .waitFor();
  const row = page.getByRole("row", { name: /Abrir INT-/ }).first();
  await row.waitFor();
  await audit(page, vp, "Obras (lista de intervenções)");
  await row.click();
  await page
    .getByRole("heading", { name: "Recapeamento da Avenida Central", level: 2 })
    .waitFor();
  await page
    .locator(".works-map .leaflet-container")
    .first()
    .waitFor()
    .catch(() => {});
  await audit(page, vp, "Obras (detalhe da intervenção)");
  await page.getByRole("button", { name: "Voltar à lista" }).click();
  await page.getByRole("tab", { name: /Obras/ }).last().click();
  await settle(page);
  await audit(page, vp, "Obras (lista de obras)");
  const project = page.getByRole("row", { name: /Abrir OB-/ }).first();
  if (await project.count()) {
    await project.click();
    await settle(page);
    await audit(page, vp, "Obras (detalhe da obra)");
  }

  // Equipes: primeiro o fallback de carregamento do módulo (chunk atrasado), depois a tela.
  let release;
  const gate = new Promise((r) => (release = r));
  await ctx.route("**/assets/TeamsPage-*.js", async (route) => {
    await gate;
    await route.continue();
  });
  const nav = page.getByRole("navigation", { name: "Menu principal" });
  await openMenu(page, vp);
  await nav.getByRole("button", { name: "Operações", exact: true }).click();
  await nav.getByRole("button", { name: "Equipes", exact: true }).click();
  await page.getByText("Carregando módulo...").waitFor();
  await audit(page, vp, "Carregando módulo");
  release();
  await page.locator("main h1", { hasText: "Equipes" }).waitFor();
  await settle(page);
  await audit(page, vp, "Equipes");
  await go(page, vp, "Controle do setor");
  await page
    .locator(".sector-table tbody tr")
    .first()
    .waitFor()
    .catch(() => {});
  await audit(page, vp, "Controle do setor");
  await go(page, vp, "Materiais");
  await page
    .getByRole("heading", { name: "Almoxarifado", exact: true })
    .waitFor();
  await audit(page, vp, "Almoxarifado");
  await go(page, vp, "Equipamentos");
  await audit(page, vp, "Equipamentos");
  await go(page, vp, "Análise de campo");
  await audit(page, vp, "Análise de campo");

  // Administração
  await go(page, vp, "Administração");
  await audit(page, vp, "Administração (categorias)");
  await page.getByRole("button", { name: "Usuários", exact: true }).click();
  await settle(page);
  await audit(page, vp, "Administração (usuários)");
  const edit = page.locator("tbody tr").first().getByRole("button").first();
  await edit.click();
  await page.getByRole("dialog").waitFor();
  await audit(page, vp, "Administração (usuário e permissões)");
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog")
    .waitFor({ state: "hidden" })
    .catch(() =>
      page.getByRole("button", { name: "Fechar", exact: true }).click(),
    );
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  const portalForm = page.locator("form.portal-settings");
  await portalForm
    .getByRole("heading", { name: "Portal do cidadão" })
    .waitFor();
  await audit(page, vp, "Administração (configurações)");
  const enabled = portalForm.getByLabel(
    "Portal ligado (aceita registros e consultas públicas)",
  );
  if (!(await enabled.isChecked())) {
    await enabled.check();
    await portalForm
      .getByRole("button", { name: "Salvar portal do cidadão" })
      .click();
    await portalForm
      .getByText("Configurações do portal salvas. O portal está ligado.")
      .waitFor();
  }
  await page.getByRole("button", { name: "Auditoria", exact: true }).click();
  await settle(page, 700);
  await audit(page, vp, "Administração (auditoria)");

  // Ajuda / onboarding com um passo aberto
  await page.getByRole("button", { name: "Ajuda: Como usar o Urbana" }).click();
  await page.getByRole("heading", { name: "Como usar o Urbana" }).waitFor();
  await audit(page, vp, "Ajuda (lista de tutoriais)");
  const topic = page
    .locator(".onboarding-layer button, [role=dialog] button")
    .filter({ hasText: /Como|O que|Primeiros/ })
    .first();
  await topic.click();
  await settle(page, 700);
  await audit(page, vp, "Ajuda (passo aberto)");
  return { ctx, page };
}

// ------------------------------------------------------------------------ Campo
async function field(vp) {
  const ctx = await newContext(vp, { serviceWorkers: "block" });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base + "/campo");
  await page.getByLabel("E-mail", { exact: true }).waitFor();
  await page.getByLabel("E-mail", { exact: true }).fill("campo@urbana.local");
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Minhas tarefas", exact: true })
    .waitFor();
  await page.locator(".operator-task").first().waitFor();
  await audit(page, vp, "Campo · Tarefas");
  await page
    .locator(".operator-task")
    .filter({ hasText: fieldOrder.code })
    .click();
  await page
    .getByRole("heading", { name: fieldOrder.code, exact: true })
    .waitFor();
  await audit(page, vp, "Campo · OS em execução");
  await page.getByRole("button", { name: "Tarefas", exact: true }).click();
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByLabel("Rua e número", { exact: true }).waitFor();
  await audit(page, vp, "Campo · Registrar");
  await page
    .getByRole("button", { name: "Enviar ocorrência", exact: true })
    .click();
  await settle(page);
  await audit(page, vp, "Campo · Registrar (validação)");
  await page
    .getByRole("button", { name: "Meus registros", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Meus registros", exact: true })
    .waitFor();
  await audit(page, vp, "Campo · Meus registros");
  // Painel de pendências: uma ação feita sem rede fica na fila do aparelho.
  await page.getByRole("button", { name: "Tarefas", exact: true }).click();
  await page
    .locator(".operator-task")
    .filter({ hasText: pendingOrder.code })
    .click();
  await page
    .getByRole("heading", { name: pendingOrder.code, exact: true })
    .waitFor();
  await ctx.setOffline(true);
  await page
    .getByRole("button", { name: "Estou a caminho", exact: true })
    .click();
  await page.getByRole("heading", { name: "Pendências de envio" }).waitFor();
  await audit(page, vp, "Campo · Painel de pendências");
  await ctx.setOffline(false);
  await ctx.close();
}

// ------------------------------------------------------------------------ portal público
async function portal(vp) {
  const ctx = await newContext(vp);
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base + "/portal");
  await page
    .getByRole("heading", { name: "Registrar uma demanda", level: 1 })
    .waitFor();
  const loadedAt = Date.now();
  await settle(page);
  await audit(page, vp, "Portal · registrar (vazio)");
  await page.getByRole("button", { name: "Enviar demanda" }).click();
  await page.locator("#error-summary").waitFor();
  await audit(page, vp, "Portal · registrar (erros de validação)");
  await page
    .getByLabel("Tipo de problema")
    .selectOption({ label: "Pavimentação" });
  await page.getByLabel("Detalhe do problema").selectOption("Buraco");
  await page
    .getByLabel("Descrição")
    .fill("Buraco fundo na faixa da direita, perto do ponto de ônibus.");
  await page.getByLabel("Endereço").fill("Avenida Brasil, 1500");
  await page.getByLabel("Bairro").fill("Centro");
  await page.getByLabel("Ponto de referência").fill("Em frente ao mercado");
  await page
    .getByRole("button", { name: "Usar minha localização (GPS)" })
    .click();
  await page.getByText(/Local marcado pelo GPS/).waitFor();
  await page.getByRole("button", { name: "Marcar no mapa" }).click();
  const map = page.locator("#location-map.leaflet-container");
  await map.waitFor();
  await page.waitForTimeout(300);
  await map.click({ position: { x: 120, y: 150 } });
  await page.getByText(/Local marcado no mapa:/).waitFor();
  await page
    .getByLabel("Foto")
    .setInputFiles({ name: "buraco.png", mimeType: "image/png", buffer: PNG });
  await page.getByLabel("Nome").fill("Joana Cidadã");
  await page.getByLabel("Telefone").fill("(47) 98888-0000");
  await audit(page, vp, "Portal · registrar (preenchido, com mapa)");
  await page.getByLabel(/Li e concordo/).check();
  const wait = 5600 - (Date.now() - loadedAt);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.getByRole("button", { name: "Enviar demanda" }).click();
  const receipt = page.getByRole("heading", {
    name: "Demanda registrada",
    level: 1,
  });
  await receipt.waitFor();
  await audit(page, vp, "Portal · comprovante");
  const protocol = (await page.locator("#receipt-protocol").innerText()).trim();
  const code = (
    await page.locator("#receipt-code [aria-hidden=true]").innerText()
  ).trim();
  await page.getByRole("link", { name: "Acompanhar esta demanda" }).click();
  await page
    .getByRole("heading", { name: "Acompanhar demanda", level: 1 })
    .waitFor();
  await audit(page, vp, "Portal · acompanhar (vazio)");
  await page.getByLabel("Código de acompanhamento").fill("2222-3333-4444-5555");
  await page.getByRole("button", { name: "Consultar" }).click();
  await page.locator("#track-error").waitFor();
  await audit(page, vp, "Portal · acompanhar (erro)");
  await page.getByLabel("Código de acompanhamento").fill(code);
  await page.getByRole("button", { name: "Consultar" }).click();
  await page.getByRole("heading", { name: /Situação:/ }).waitFor();
  await audit(page, vp, "Portal · acompanhar (resultado)");
  await ctx.close();
  return protocol;
}

// ------------------------------------------------------------------------ teclado
const keyOf = (e) => `${e.tag}|${e.name}|${e.top}|${e.left}`;
const nameOf = (page) =>
  page.evaluate(() =>
    (
      document.activeElement?.getAttribute("aria-label") ||
      document.activeElement?.innerText ||
      document.activeElement?.tagName ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60),
  );
/** Percorre `steps` Tab e confere foco visível, ausência de armadilha e (opcional) contenção/ordem visual. */
async function keyboardPass(page, label, steps, { scope, order = false } = {}) {
  const visited = await tabThrough(page, steps, { scope });
  // Um campo de data tem vários Tab (segmentos e botão do calendário); basta o foco aparecer em algum deles.
  for (const e of visited)
    if (hasVisibleFocus(e)) report.focusSeen.add(`${e.tag}|${e.name}`);
  const seenVisible = new Set(visited.filter(hasVisibleFocus).map(keyOf));
  const invisible = visited
    .filter(
      (e) =>
        !hasVisibleFocus(e) &&
        !seenVisible.has(keyOf(e)) &&
        !(
          /^(date|time|datetime-local|month|week)$/.test(e.type) &&
          report.focusSeen.has(`${e.tag}|${e.name}`)
        ),
    )
    .map((e) => `${e.tag} "${e.name}"`);
  if (invisible.length)
    report.fail(
      `Teclado · ${label}: sem indicador de foco visível em ${[...new Set(invisible)].slice(0, 5).join("; ")}`,
    );
  // Em <dialog> nativo o foco passa uma vez pela interface do navegador (document.body) antes de voltar ao início do diálogo.
  const outside = scope
    ? visited.filter((e) => !e.inside && e.tag !== "body").length
    : 0;
  if (outside)
    report.fail(
      `Teclado · ${label}: o foco escapou do diálogo (${outside} de ${steps} passos)`,
    );
  let run = 1;
  for (let i = 1; i < visited.length; i++) {
    run =
      keyOf(visited[i]) === keyOf(visited[i - 1]) && visited[i].tag !== "body"
        ? run + 1
        : 1;
    // Campos de data/hora têm um Tab por segmento (dia, mês, ano...), todos no mesmo elemento.
    const segments = /^(date|time|datetime-local|month|week)$/.test(
      visited[i].type,
    )
      ? 6
      : 3;
    if (run >= segments) {
      report.fail(
        `Teclado · ${label}: possível armadilha de foco em "${visited[i].name}"`,
      );
      break;
    }
  }
  if (order) {
    const jumps = visualOrderJumps(visited);
    if (jumps.length)
      report.fail(
        `Teclado · ${label}: ordem de foco contraria a ordem visual (${jumps.slice(0, 3).join("; ")})`,
      );
  }
  report.note(
    `Teclado · ${label}: ${steps} Tab, ${new Set(visited.map(keyOf)).size} paradas distintas, foco visível em todas`,
  );
  return visited;
}
/** Abre com Enter, confere foco dentro, ciclo de Tab, Escape fechando e devolvendo o foco ao acionador. */
async function modalKeyboard(
  page,
  label,
  opener,
  {
    dialog = '[role="dialog"], dialog[open]',
    steps = 40,
    openKey = "Enter",
    returnTo,
  } = {},
) {
  await opener.scrollIntoViewIfNeeded();
  await opener.focus();
  const openerHandle = await opener.elementHandle();
  const dlg = page.locator(dialog).first();
  if (openKey === "select") {
    // Lista de seleção por teclado: digitar o início do rótulo da opção escolhe-a (funciona em qualquer sistema).
    const option = await opener.evaluate((el) => el.options[1].text);
    await page.keyboard.type(option.slice(0, 2));
  } else await page.keyboard.press(openKey);
  await dlg.waitFor();
  await settle(page, 300);
  const initiallyInside = await page.evaluate(
    (sel) => Boolean(document.activeElement?.closest(sel)),
    dialog,
  );
  if (!initiallyInside)
    report.fail(`Teclado · ${label}: o foco não entrou no diálogo ao abrir`);
  await keyboardPass(page, `${label} (Tab)`, steps, { scope: dialog });
  await keyboardPass(page, `${label} (Shift+Tab)`, 8, { scope: dialog }).catch(
    () => {},
  );
  await page.keyboard.press("Escape");
  await dlg
    .waitFor({ state: "hidden", timeout: 4000 })
    .catch(() =>
      report.fail(`Teclado · ${label}: Escape não fechou o diálogo`),
    );
  await settle(page, 200);
  // Se o acionador saiu da tela (ex.: o cartão mudou de coluna), o foco deve ir ao conteúdo principal.
  const back = await page.evaluate(
    (el) =>
      document.activeElement === el ||
      Boolean(el?.contains(document.activeElement)) ||
      (!el?.isConnected && document.activeElement?.id === "conteudo"),
    returnTo ? await returnTo.elementHandle() : openerHandle,
  );
  if (!back)
    report.fail(
      `Teclado · ${label}: o foco não voltou ao acionador depois do Escape (${await nameOf(page)})`,
    );
}

async function keyboardChecks() {
  const vp = VIEWPORTS.desktop;
  // Login: ordem e foco.
  let ctx = await newContext(vp);
  let page = await ctx.newPage();
  watch(page);
  await page.goto(base);
  await page.getByLabel("E-mail", { exact: true }).waitFor();
  const loginSeq = await keyboardPass(page, "login", 3, { order: true });
  const kinds = loginSeq.map((e) => e.tag);
  if (kinds.join() !== "input,input,button")
    report.fail(
      `Teclado · login: ordem esperada e-mail, senha, entrar; obtido ${kinds.join(", ")}`,
    );
  await login(page, "admin@urbana.local");
  await page
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Evolução das operações", exact: true })
    .waitFor();
  await page.evaluate(() => document.activeElement?.blur?.());
  // Atalho para o conteúdo e percurso do shell.
  await page.keyboard.press("Tab");
  if ((await nameOf(page)) !== "Ir para o conteúdo")
    report.fail(
      `Teclado · shell: o primeiro Tab deveria cair no atalho "Ir para o conteúdo" (caiu em "${await nameOf(page)}")`,
    );
  await page.keyboard.press("Enter");
  if (!(await page.evaluate(() => document.activeElement?.id === "conteudo")))
    report.fail("Teclado · shell: o atalho não levou o foco ao conteúdo");
  await page.evaluate(() => document.querySelector(".skip-link")?.focus());
  await keyboardPass(page, "shell (visão geral)", 45);
  // Grupo do menu por teclado.
  const toggle = page
    .getByRole("navigation", { name: "Menu principal" })
    .getByRole("button", { name: "Operações", exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    report.fail("Teclado · menu: Enter não expandiu o grupo");
  await page.keyboard.press("Space");
  if ((await toggle.getAttribute("aria-expanded")) !== "false")
    report.fail("Teclado · menu: Espaço não recolheu o grupo");
  // Nova ocorrência
  await go(page, vp, "Ocorrências");
  await page.locator("tbody tr").first().waitFor();
  await modalKeyboard(
    page,
    "nova ocorrência",
    page.getByRole("button", { name: "Nova ocorrência", exact: true }),
    { steps: 40 },
  );
  // Detalhe pela linha (Enter)
  await modalKeyboard(
    page,
    "detalhe da ocorrência",
    page.locator("tbody tr").first(),
    { steps: 30 },
  );
  // Planejamento
  await go(page, vp, "Planejamento");
  await page.getByLabel("Buscar rua no planejamento").fill("Planejamento UI");
  await settle(page, 500);
  await modalKeyboard(
    page,
    "plano de ação",
    page
      .getByRole("button", { name: "Planejar esta obra", exact: true })
      .first(),
    { steps: 35 },
  );
  // Kanban
  await go(page, vp, "Kanban de equipes");
  await page
    .getByRole("region", { name: "Quadro de gestão das equipes" })
    .waitFor();
  const select = page.locator('select[aria-label^="Mover "]').first();
  await modalKeyboard(page, "mover no Kanban", select, {
    steps: 25,
    openKey: "select",
  });
  // Ajuda
  await go(page, vp, "Visão geral");
  await modalKeyboard(
    page,
    "ajuda (onboarding)",
    page.getByRole("button", { name: "Ajuda: Como usar o Urbana" }),
    { dialog: '[role="dialog"], .onboarding-layer', steps: 25 },
  );
  await ctx.close();

  // Portal: atalho, ordem do formulário e foco.
  ctx = await newContext(vp);
  page = await ctx.newPage();
  watch(page);
  await page.goto(base + "/portal");
  await page
    .getByRole("heading", { name: "Registrar uma demanda", level: 1 })
    .waitFor();
  const portalSeq = await keyboardPass(page, "portal (formulário)", 30, {
    order: true,
  });
  if (portalSeq[0].name !== "Ir para o conteúdo")
    report.fail(
      `Teclado · portal: o primeiro Tab deveria cair no atalho (caiu em "${portalSeq[0].name}")`,
    );
  await ctx.close();

  // Campo: barra inferior e tarefa por teclado.
  ctx = await newContext(VIEWPORTS.celular, { serviceWorkers: "block" });
  page = await ctx.newPage();
  watch(page);
  await login(page, "campo@urbana.local", "/campo");
  await page
    .getByRole("heading", { name: "Minhas tarefas", exact: true })
    .waitFor();
  await page.locator(".operator-task").first().waitFor();
  await keyboardPass(page, "Campo (tarefas)", 14);
  const task = page
    .locator(".operator-task")
    .filter({ hasText: fieldOrder.code });
  await task.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: fieldOrder.code, exact: true })
    .waitFor();
  await keyboardPass(page, "Campo (OS em execução)", 30);
  await ctx.close();
}

// ------------------------------------------------------------------------ reflow e zoom
const ZOOM = {
  name: "zoom 200% (640x360)",
  width: 640,
  height: 360,
  mobile: true,
};
const REFLOW = { name: "reflow 320 px", width: 320, height: 568, mobile: true };
async function reflowCheck(page, vp, screen) {
  await settle(page, 300);
  const r = await page.evaluate(overflowReport);
  if (r.pageScroll || r.offenders.length)
    report.fail(
      `Reflow · ${vp.name} · ${screen}: rolagem horizontal da página (scrollWidth ${r.scrollWidth} > ${r.vw})${r.offenders.length ? ` por ${r.offenders.slice(0, 3).join("; ")}` : ""}`,
    );
  if (r.clipped.length)
    report.note(
      `Reflow · ${vp.name} · ${screen}: texto possivelmente cortado em ${r.clipped.slice(0, 3).join("; ")}`,
    );
}
async function reflowChecks() {
  for (const vp of [ZOOM, REFLOW]) {
    const ctx = await newContext(vp, { serviceWorkers: "block" });
    const page = await ctx.newPage();
    watch(page);
    await login(page, "admin@urbana.local");
    await page
      .getByRole("heading", { name: "Evolução das operações", exact: true })
      .waitFor();
    await reflowCheck(page, vp, "Visão geral");
    for (const title of [
      "Ocorrências",
      "Triagem",
      "Ordens de serviço",
      "Planejamento",
      "Kanban de equipes",
      "Mapa territorial",
      "Obras e intervenções",
      "Equipes",
      "Controle do setor",
      "Materiais",
      "Equipamentos",
      "Análise de campo",
      "Administração",
    ]) {
      if (title === "Obras e intervenções") {
        await openMenu(page, vp);
        await page
          .getByRole("navigation", { name: "Menu principal" })
          .getByRole("button", { name: title })
          .click();
        await page.locator("main h1").first().waitFor();
        await settle(page);
      } else await go(page, vp, title);
      await reflowCheck(page, vp, title);
    }
    await go(page, vp, "Ocorrências");
    await page.locator("tbody tr").first().waitFor();
    await page
      .getByRole("button", { name: "Nova ocorrência", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await reflowCheck(page, vp, "Nova ocorrência (modal)");
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog")
      .waitFor({ state: "hidden" })
      .catch(() => {});
    await page.locator("tbody tr").first().click();
    await page.getByRole("dialog").waitFor();
    await reflowCheck(page, vp, "Ocorrência (detalhe)");
    await ctx.close();

    // Campo
    const field = await newContext(vp, { serviceWorkers: "block" });
    const f = await field.newPage();
    watch(f);
    await login(f, "campo@urbana.local", "/campo");
    await f
      .getByRole("heading", { name: "Minhas tarefas", exact: true })
      .waitFor();
    await f.locator(".operator-task").first().waitFor();
    await reflowCheck(f, vp, "Campo · Tarefas");
    await f
      .locator(".operator-task")
      .filter({ hasText: fieldOrder.code })
      .click();
    await f
      .getByRole("heading", { name: fieldOrder.code, exact: true })
      .waitFor();
    await reflowCheck(f, vp, "Campo · OS em execução");
    await f.getByRole("button", { name: "Tarefas", exact: true }).click();
    await f.getByRole("button", { name: "Registrar", exact: true }).click();
    await f.getByLabel("Rua e número", { exact: true }).waitFor();
    await reflowCheck(f, vp, "Campo · Registrar");
    await field.close();

    // Portal
    const citizen = await newContext(vp);
    const c = await citizen.newPage();
    watch(c);
    await c.goto(base + "/portal");
    await c
      .getByRole("heading", { name: "Registrar uma demanda", level: 1 })
      .waitFor();
    await reflowCheck(c, vp, "Portal · registrar");
    await c.getByRole("button", { name: "Enviar demanda" }).click();
    await c.locator("#error-summary").waitFor();
    await reflowCheck(c, vp, "Portal · erros de validação");
    await c.goto(base + "/portal/acompanhar");
    await c
      .getByRole("heading", { name: "Acompanhar demanda", level: 1 })
      .waitFor();
    await reflowCheck(c, vp, "Portal · acompanhar");
    await citizen.close();
  }
}

// ------------------------------------------------------------------------ movimento reduzido
async function motionChecks() {
  const vp = VIEWPORTS.desktop;
  const probe = async (page, label, reduced) => {
    await page.waitForTimeout(120);
    const m = await page.evaluate(motionReport);
    const infinite = m.running.filter((a) => a.infinite);
    if (reduced) {
      if (infinite.length)
        report.fail(
          `Movimento reduzido · ${label}: animação contínua em execução (${infinite
            .map((a) => `${a.name} em ${a.target}`)
            .slice(0, 3)
            .join("; ")})`,
        );
      if (m.animated.length)
        report.fail(
          `Movimento reduzido · ${label}: animações mantidas (${m.animated.slice(0, 3).join("; ")})`,
        );
      if (m.transitions.length)
        report.fail(
          `Movimento reduzido · ${label}: transições longas mantidas (${m.transitions.slice(0, 3).join("; ")})`,
        );
      if (m.smoothScroll)
        report.fail(
          `Movimento reduzido · ${label}: scroll-behavior: smooth ativo`,
        );
    } else {
      if (infinite.length)
        report.note(
          `Movimento (sem preferência) · ${label}: animação contínua ${infinite
            .map((a) => a.name)
            .slice(0, 3)
            .join(", ")}`,
        );
      if (m.animated.length || m.transitions.length)
        report.note(
          `Movimento (sem preferência) · ${label}: ${[...m.animated, ...m.transitions].slice(0, 4).join("; ")}`,
        );
    }
  };
  for (const reduced of [false, true]) {
    const ctx = await newContext(vp, {
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    const page = await ctx.newPage();
    watch(page);
    await page.goto(base);
    await page.getByLabel("E-mail", { exact: true }).waitFor();
    if (!reduced) {
      // Autoverificação do detector: um elemento com animação contínua e transição longa precisa aparecer no relatório.
      await page.evaluate(() => {
        // Só CSSOM (a CSP do app proíbe <style> e script injetados).
        const sheet = [...document.styleSheets].find((s) => {
          try {
            return s.cssRules.length >= 0;
          } catch {
            return false;
          }
        });
        sheet.insertRule(
          "@keyframes a11y-probe{to{opacity:.5}}",
          sheet.cssRules.length,
        );
        const el = document.createElement("div");
        el.id = "a11y-probe";
        el.style.animation = "a11y-probe 1s infinite";
        el.style.transition = "opacity 1s";
        document.body.append(el);
      });
      await page.waitForTimeout(150);
      const seen = await page.evaluate(motionReport);
      await page.evaluate(() =>
        document.getElementById("a11y-probe")?.remove(),
      );
      assert.ok(
        seen.running.some((a) => a.infinite) &&
          seen.animated.some((a) => a.includes("a11y-probe")) &&
          seen.transitions.length > 0,
        "o detector de movimento não enxergou a animação de teste",
      );
    }
    await probe(page, "login", reduced);
    await login(page, "admin@urbana.local");
    await page
      .getByRole("heading", { name: "Evolução das operações", exact: true })
      .waitFor();
    await probe(page, "visão geral", reduced);
    await page
      .getByRole("navigation", { name: "Menu principal" })
      .getByRole("button", { name: "Ocorrências", exact: true })
      .click();
    await probe(page, "menu expandido", reduced);
    await go(page, vp, "Ocorrências");
    await page
      .getByRole("button", { name: "Nova ocorrência", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await probe(page, "modal aberto", reduced);
    await page.keyboard.press("Escape");
    await go(page, vp, "Kanban de equipes");
    await page
      .getByRole("region", { name: "Quadro de gestão das equipes" })
      .waitFor();
    await probe(page, "Kanban", reduced);
    await go(page, vp, "Planejamento");
    await probe(page, "Planejamento", reduced);
    await page
      .getByRole("button", { name: "Ajuda: Como usar o Urbana" })
      .click();
    await probe(page, "ajuda", reduced);
    await ctx.close();
    const citizen = await newContext(vp, {
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    const c = await citizen.newPage();
    watch(c);
    await c.goto(base + "/portal");
    await c
      .getByRole("heading", { name: "Registrar uma demanda", level: 1 })
      .waitFor();
    await probe(c, "portal", reduced);
    await citizen.close();
    const fieldCtx = await newContext(VIEWPORTS.celular, {
      reducedMotion: reduced ? "reduce" : "no-preference",
      serviceWorkers: "block",
    });
    const f = await fieldCtx.newPage();
    watch(f);
    await login(f, "campo@urbana.local", "/campo");
    await f
      .getByRole("heading", { name: "Minhas tarefas", exact: true })
      .waitFor();
    await probe(f, "Campo", reduced);
    await fieldCtx.close();
  }
}

const failures = [];
// A11Y_PHASES / A11Y_VIEWPORTS (separados por vírgula) permitem rodar só uma parte ao depurar.
const phases = phasesRequested();
const only = (process.env.A11Y_VIEWPORTS || "desktop,celular").split(",");
try {
  for (const vp of Object.values(VIEWPORTS).filter((v) =>
    only.includes(v.name),
  )) {
    if (phases.has("management")) {
      const { ctx } = await management(vp);
      await ctx.close();
    }
    if (phases.has("field")) await field(vp);
    if (phases.has("portal")) await portal(vp);
  }
  if (phases.has("keyboard")) await keyboardChecks();
  if (phases.has("reflow")) await reflowChecks();
  if (phases.has("motion")) await motionChecks();
} catch (error) {
  failures.push(error);
}

// ------------------------------------------------------------------------ lang, título e alvos
// Telas inteiras (não estados internos) que precisam de título próprio.
const PAGE_SCREENS = new Set([
  "Login",
  "Visão geral",
  "Ocorrências (lista)",
  "Triagem",
  "Ordens de serviço (lista)",
  "Planejamento (escolher obras)",
  "Kanban",
  "Mapa territorial",
  "Obras (lista, estado vazio)",
  "Equipes",
  "Controle do setor",
  "Almoxarifado",
  "Equipamentos",
  "Análise de campo",
  "Administração (categorias)",
  "Campo · Tarefas",
  "Campo · Registrar",
  "Campo · Meus registros",
  "Portal · registrar (vazio)",
  "Portal · comprovante",
  "Portal · acompanhar (vazio)",
]);
const badLang = pageInfo.filter((p) => p.lang !== "pt-BR");
if (badLang.length)
  report.fail(
    `lang: ${badLang.length} telas sem lang="pt-BR" (${badLang
      .slice(0, 3)
      .map((p) => p.screen)
      .join("; ")})`,
  );
const emptyTitle = pageInfo.filter((p) => !p.title.trim());
if (emptyTitle.length)
  report.fail(
    `<title> vazio em ${emptyTitle
      .slice(0, 3)
      .map((p) => p.screen)
      .join("; ")}`,
  );
const titles = new Map();
for (const p of pageInfo.filter(
  (x) => x.vp === "desktop" && PAGE_SCREENS.has(x.screen),
)) {
  if (titles.has(p.title))
    report.fail(
      `<title> repetido "${p.title}" em "${titles.get(p.title)}" e "${p.screen}"`,
    );
  else titles.set(p.title, p.screen);
}
// Alvo de toque (WCAG 2.2, 2.5.8): relatório geral; falha só nos controles principais do Campo e do portal, no celular.
const MAIN_TARGET_SCREENS = /^(Campo|Portal)/;
const targetFailures = [];
for (const entry of targets) {
  const main = MAIN_TARGET_SCREENS.test(entry.screen) && entry.vp === "celular";
  for (const t of entry.small) {
    const line = `${entry.vp} · ${entry.screen}: ${t.tag} "${t.name}" ${t.w}x${t.h}`;
    if (main) targetFailures.push(line);
  }
}
for (const line of targetFailures)
  report.fail(`Alvo de toque < 24x24: ${line}`);
const targetCount = targets.reduce((n, e) => n + e.small.length, 0);
report.note(
  `Alvos de toque menores que 24x24 (sem a exceção de espaçamento), todas as telas auditadas: ${targetCount} em ${targets.length} telas (detalhe em test-results/a11y-targets.json)`,
);

for (const [rule, where] of report.incomplete)
  report.note(
    `axe sem resultado conclusivo (revisão humana): ${rule} em ${where.nodes} elementos de ${where.screens.size} telas`,
  );
const summary = summarize(report);
writeFileSync(
  "test-results/a11y-targets.json",
  JSON.stringify({ targets, pageInfo }, null, 2),
);
writeFileSync(
  "test-results/a11y-report.json",
  JSON.stringify(
    {
      summary: {
        screens: summary.screens,
        nodes: summary.nodes,
        byImpact: summary.byImpact,
        byRule: summary.byRule,
      },
      blocking: summary.blocking,
      violations: report.axe,
      incomplete: report.incompleteNodes,
      manualContrast: report.manualContrast,
      exceptions: report.exceptions,
      problems: report.problems,
      notes: report.notes,
      pageErrors,
    },
    null,
    2,
  ),
);
await browser.close();
await new Promise((r) => server.close(r));
await db.close();
rmSync(temp, { recursive: true, force: true });
console.log(
  JSON.stringify(
    {
      telas: summary.screens,
      violacoesAbertas: summary.nodes,
      porImpacto: summary.byImpact,
      porRegra: summary.byRule,
      excecoes: summary.excepted.length,
    },
    null,
    2,
  ),
);
for (const note of report.notes) console.log("  nota:", note);
if (summary.blocking.length)
  report.fail(
    `axe: ${summary.blocking.length} violações WCAG serious/critical`,
  );
for (const v of summary.blocking.slice(0, 15))
  console.log(
    `  ${v.impact} ${v.rule} · ${v.viewport} · ${v.screen} · ${v.target}${v.colors ? ` · ${v.colors}` : ""}`,
  );
if (pageErrors.length)
  report.fail(`erros de página: ${pageErrors.slice(0, 3).join(" | ")}`);
if (failures.length)
  report.fail(`execução interrompida: ${failures[0].message.slice(0, 900)}`);
if (report.problems.length) {
  console.error("\nFALHAS:");
  for (const p of report.problems) console.error(" -", p);
  process.exitCode = 1;
} else
  console.log(
    "a11y-browser: ok (auditoria automatizada; não substitui avaliação com tecnologias assistivas e usuários reais)",
  );
