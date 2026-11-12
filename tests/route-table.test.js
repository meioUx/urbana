// Pins the Express registration order and the write flag of every route registered by createApp.
// Order matters (Express matches in registration order) and write=true in route() decides the
// write queue and db.transaction; losing it is a concurrency bug on PostgreSQL. Each row is
// "METHOD path xN [write]" (N = handlers on the route, incl. allow/upload middlewares) or
// "USE <mount>" for middlewares ("api" = matches /api/*, "+root" = also matches other paths).
// "write" is observed: an empty-body request by an administrator or a field user opened a transaction.
import "./support/same-origin-fetch.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";

const expected = [
  "USE api+root",
  "USE api+root",
  "GET /healthz x1",
  "USE api+root",
  // Portal do cidadão (/api/publico, mounted below /api so it matches neither probe path): gate,
  // 8 kB JSON parser, three public routes and the terminal 404 of the prefix. Disabled by default,
  // so none of them opens a transaction here.
  "USE ",
  "USE ",
  "GET /api/publico/catalogo x1",
  "POST /api/publico/demandas x4",
  "POST /api/publico/acompanhar x1",
  "USE ",
  "USE api+root",
  "POST /api/auth/login x1",
  "USE api",
  "GET /api/auth/me x1",
  "USE api",
  "GET /api/onboarding x1",
  "PATCH /api/onboarding x1 write",
  "GET /api/kanban x1",
  "GET /api/kanban/cartoes x1",
  "PATCH /api/kanban x2 write",
  "POST /api/kanban/ordem x1 write",
  "POST /api/auth/logout x1",
  "GET /api/bootstrap x1",
  "GET /api/planejamento x1",
  "GET /api/planejamento/encerrados x1",
  "POST /api/planos-acao x2 write",
  "GET /api/campo x1",
  "POST /api/campo/notificacoes x1 write",
  "DELETE /api/campo/notificacoes x1 write",
  "GET /api/controle-setor x2",
  "GET /api/almoxarifado x1",
  "GET /api/almoxarifado/movimentos x1",
  "POST /api/almoxarifado/movimentos x2 write",
  "POST /api/ordens-servico/:id/notas-fiscais/extrair x4 write",
  "POST /api/notas-fiscais/:id/confirmar x2 write",
  "GET /api/notas-fiscais/:id/arquivo x1",
  "GET /api/ocorrencias x1",
  "GET /api/ocorrencias/resumo x1",
  "GET /api/mapa/ocorrencias x1",
  "GET /api/ocorrencias/proximas x1",
  "POST /api/ocorrencias x2 write",
  "GET /api/mapa/ocorrencias/:id/resumo x1",
  "GET /api/ocorrencias/:id x1",
  "POST /api/ocorrencias/:id/classificar x2 write",
  "PATCH /api/ocorrencias/:id x2 write",
  "POST /api/ocorrencias/:id/encaminhar x2 write",
  "POST /api/ocorrencias/:id/recusar x2 write",
  "GET /api/ordens-servico x1",
  "GET /api/ordens-servico/resumo x1",
  "POST /api/ordens-servico x2 write",
  "GET /api/ordens-servico/:id x1",
  "POST /api/ordens-servico/:id/programacao x2 write",
  "POST /api/ordens-servico/:id/devolver x2 write",
  "POST /api/ordens-servico/:id/assumir x2 write",
  "POST /api/ordens-servico/:id/iniciar x2 write",
  "POST /api/ordens-servico/:id/concluir x2 write",
  "POST /api/ordens-servico/:id/validar x2 write",
  "POST /api/ordens-servico/:id/reabrir x2 write",
  "POST /api/ordens-servico/:id/cancelar x2 write",
  "POST /api/ordens-servico/:id/material x2 write",
  "POST /api/ordens-servico/:id/equipamento x2 write",
  "POST /api/ocorrencias/:id/anexos x4 write",
  "POST /api/ordens-servico/:id/anexos x4 write",
  "GET /api/anexos/:id x1",
  "GET /api/secretarias x1",
  "POST /api/secretarias x2 write",
  "PATCH /api/secretarias/:id x2 write",
  "GET /api/departamentos x1",
  "POST /api/departamentos x2 write",
  "PATCH /api/departamentos/:id x2 write",
  "GET /api/setores x1",
  "POST /api/setores x2 write",
  "PATCH /api/setores/:id x2 write",
  "GET /api/equipes x1",
  "POST /api/equipes x2 write",
  "PATCH /api/equipes/:id x2 write",
  "GET /api/categorias x1",
  "POST /api/categorias x2 write",
  "PATCH /api/categorias/:id x2 write",
  "GET /api/materiais x1",
  "POST /api/materiais x2 write",
  "PATCH /api/materiais/:id x2 write",
  "GET /api/equipamentos x1",
  "POST /api/equipamentos x2 write",
  "PATCH /api/equipamentos/:id x2 write",
  "GET /api/users x2",
  "POST /api/users x2 write",
  "GET /api/users/:id/permissions x2",
  "PATCH /api/users/:id x2 write",
  "PATCH /api/users/:id/permissions x2",
  "PATCH /api/settings x2 write",
  "GET /api/auditoria x2",
  "GET /api/settings/portal x2",
  "PATCH /api/settings/portal x2 write",
  "GET /api/dashboard x1",
  "GET /api/intervencoes x1",
  "GET /api/intervencoes/geojson x1",
  "POST /api/intervencoes/conflitos x2",
  "POST /api/intervencoes x2 write",
  "GET /api/intervencoes/:id x1",
  "GET /api/intervencoes/:id/conflitos x1",
  "POST /api/intervencoes/:id/conflitos/:otherId/avaliacao x2 write",
  "PATCH /api/intervencoes/:id x2 write",
  "POST /api/intervencoes/:id/transicao x2 write",
  "DELETE /api/intervencoes/:id x2 write",
  "POST /api/intervencoes/:id/ocorrencias x2 write",
  "DELETE /api/intervencoes/:id/ocorrencias/:targetId x2 write",
  "POST /api/intervencoes/:id/ordens-servico x2 write",
  "DELETE /api/intervencoes/:id/ordens-servico/:targetId x2 write",
  "GET /api/obras x1",
  "POST /api/obras x2 write",
  "GET /api/obras/:id x1",
  "PATCH /api/obras/:id x2 write",
  "POST /api/obras/:id/transicao x2 write",
  "DELETE /api/obras/:id x2 write",
  "POST /api/obras/:id/intervencoes x2 write",
  "DELETE /api/obras/:id/intervencoes/:targetId x2 write",
  "POST /api/obras/:id/ordens-servico x2 write",
  "DELETE /api/obras/:id/ordens-servico/:targetId x2 write",
  "USE api",
  "USE api+root",
];

const temp = mkdtempSync(join(tmpdir(), "urbana-routes-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "false";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
let db,
  app,
  server,
  base,
  transactions = 0;
const login = async (email) => {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Testing@2026" }),
  });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
};
before(async () => {
  db = await openDatabase();
  await seed(db);
  const transaction = db.transaction.bind(db);
  db.transaction = (fn) => {
    transactions++;
    return transaction(fn);
  };
  app = createApp(db);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close?.();
  rmSync(temp, { recursive: true, force: true });
});

test("route table keeps registration order, handlers and write flags", async () => {
  const admin = await login("admin@urbana.local");
  const created = await fetch(base + "/api/users", {
    method: "POST",
    headers: { cookie: admin, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Campo",
      email: "campo-routes@test.local",
      password: "Testing@2026",
      role: "Equipe de Campo",
      team_id: "team-1",
    }),
  });
  assert.equal(created.status, 200);
  const users = { admin, field: await login("campo-routes@test.local") };
  const emails = {
    admin: "admin@urbana.local",
    field: "campo-routes@test.local",
  };
  const rows = [];
  for (const layer of app.router.stack) {
    if (!layer.route) {
      rows.push(
        `USE ${layer.match("/api/x") ? "api" : ""}${layer.match("/x") ? "+root" : ""}`,
      );
      continue;
    }
    for (const method of Object.keys(layer.route.methods).map((m) =>
      m.toUpperCase(),
    )) {
      let write = false;
      for (const who of ["admin", "field"]) {
        const start = transactions;
        const res = await fetch(
          base + layer.route.path.replace(/:(\w+)/g, "zz-$1"),
          {
            method,
            headers: { cookie: users[who], "content-type": "application/json" },
            body: ["GET", "HEAD"].includes(method) ? undefined : "{}",
          },
        );
        await res.arrayBuffer();
        if (transactions > start) write = true;
        if (layer.route.path === "/api/auth/logout")
          users[who] = await login(emails[who]);
      }
      rows.push(
        `${method} ${layer.route.path} x${layer.route.stack.length}${write ? " write" : ""}`,
      );
    }
  }
  assert.deepEqual(rows, expected);
});
