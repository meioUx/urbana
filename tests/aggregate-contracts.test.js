// R4 contracts: dashboard with aggregates only, occurrence/order summaries, board cards with a
// visible window for Concluídas, closed plans paginated and /api/campo limited to open orders for
// management profiles. Values are checked against the previous algorithms in
// query-equivalence.test.js; this file pins shapes, validation and authorization.
import "./support/same-origin-fetch.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";

const temp = mkdtempSync(join(tmpdir(), "urbana-r4-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Urbana@2026";
delete process.env.DATABASE_URL;
let db, server, base;
const cookies = {};
const get = async (path, who = "admin") => {
  const r = await fetch(base + path, { headers: { cookie: cookies[who] } });
  return { status: r.status, data: await r.json() };
};
before(async () => {
  db = await openDatabase();
  await seed(db);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const who of [
    "admin",
    "gestor",
    "triagem",
    "campo",
    "fiscal",
    "consulta",
  ]) {
    const r = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${who}@urbana.local`,
        password: "Urbana@2026",
      }),
    });
    assert.equal(r.status, 200, who);
    cookies[who] = r.headers.get("set-cookie").split(";")[0];
  }
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(temp, { recursive: true, force: true });
});

test("dashboard answers aggregates only, with a 90-day trend in the requested time zone", async () => {
  const { status, data } = await get("/dashboard?tz=America%2FSao_Paulo");
  assert.equal(status, 200);
  for (const key of [
    "orders",
    "occurrences",
    "materials",
    "byNeighborhood",
    "byCategory",
  ])
    assert.equal(key in data, false, key);
  for (const key of [
    "total",
    "open",
    "emergency",
    "triage",
    "open_orders",
    "executing",
    "validation",
    "completed",
    "overdue",
    "busy_teams",
    "cost",
    "actual_cost",
  ])
    assert.equal(typeof data[key], "number", key);
  assert.equal(data.trend.length, 90);
  assert.equal(data.trend_timezone, "America/Sao_Paulo");
  assert.match(data.trend.at(-1).day, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(data.open_by_neighborhood.length <= 5);
  assert.equal(
    Object.values(data.orders_by_status).reduce((a, b) => a + b, 0) >=
      data.open_orders,
    true,
  );
  assert.equal((await get("/dashboard")).data.trend_timezone, "UTC");
  assert.equal((await get("/dashboard?tz=Fuso%2FInexistente")).status, 400);
  assert.ok(
    JSON.stringify(data).length < 20000,
    "aggregate answer stays small",
  );
  assert.equal((await get("/dashboard", "campo")).status, 403);
});

test("occurrence and order summaries follow the list permissions", async () => {
  assert.deepEqual(
    Object.keys((await get("/ocorrencias/resumo", "triagem")).data),
    ["by_status"],
  );
  assert.equal((await get("/ocorrencias/resumo?bairros=talvez")).status, 400);
  const occurrences = await get("/ocorrencias/resumo?bairros=1", "triagem");
  assert.equal(occurrences.status, 200);
  const all = (await get("/ocorrencias")).data;
  assert.equal(
    Object.values(occurrences.data.by_status).reduce((a, b) => a + b, 0),
    all.length,
  );
  assert.deepEqual(
    occurrences.data.neighborhoods,
    [...new Set(all.map((r) => r.neighborhood).filter(Boolean))].sort(),
  );
  const orders = await get("/ordens-servico/resumo", "consulta");
  assert.equal(orders.status, 200);
  const total = (summary) =>
    Object.values(summary.by_team)
      .flatMap(Object.values)
      .reduce((a, b) => a + b, 0);
  assert.equal(total(orders.data), (await get("/ordens-servico")).data.length);
  // Equipe de Campo: the same restriction as GET /ordens-servico.
  const field = await get("/ordens-servico/resumo", "campo");
  assert.equal(
    total(field.data),
    (await get("/ordens-servico", "campo")).data.length,
  );
  assert.ok(Object.keys(field.data.by_team).every((team) => team === "team-1"));
});

test("board cards: projection, window for Concluídas, closed columns on demand and permissions", async () => {
  const { status, data } = await get("/kanban/cartoes", "consulta");
  assert.equal(status, 200);
  const config = (await get("/kanban")).data;
  assert.deepEqual(
    { revision: data.revision, limits: data.limits, order: data.order },
    config,
  );
  assert.equal(data.concluidas_dias, 30);
  assert.equal(data.encerradas, false);
  assert.ok(
    data.cards.every((c) => !["CANCELADA", "RECUSADA"].includes(c.status)),
  );
  const order = data.cards.find((c) => c.type === "order");
  assert.ok(
    order &&
      Array.isArray(order.occurrence_ids) &&
      order.occurrences.every((o) => o.id && o.code),
  );
  for (const card of data.cards)
    for (const key of [
      "lat",
      "lng",
      "data",
      "updated_at",
      "origin",
      "creator_id",
      "notes",
    ])
      assert.equal(key in card, false, key);
  const everything = (
    await get("/kanban/cartoes?concluidas_dias=0&encerradas=1")
  ).data;
  for (const s of ["CONCLUIDA", "CANCELADA", "RECUSADA"])
    assert.equal(
      everything.cards.filter((c) => c.status === s).length,
      everything.counts[s] || 0,
      s,
    );
  assert.equal((await get("/kanban/cartoes?concluidas_dias=-1")).status, 400);
  assert.equal((await get("/kanban/cartoes?encerradas=sim")).status, 400);
  assert.equal((await get("/kanban/cartoes", "campo")).status, 403);
});

test("closed plans are paginated and /campo for management only lists open orders", async () => {
  const page = await get("/planejamento/encerrados?limit=1", "consulta");
  assert.equal(page.status, 200);
  assert.deepEqual(Object.keys(page.data).sort(), [
    "has_more",
    "items",
    "next_cursor",
  ]);
  assert.equal((await get("/planejamento/encerrados?limit=0")).status, 400);
  assert.equal((await get("/planejamento/encerrados", "triagem")).status, 403);
  // Close every order of the seed except one, then compare /campo for management and field.
  await db.run(
    "UPDATE orders SET status='CONCLUIDA' WHERE id <> (SELECT MIN(id) FROM orders)",
  );
  const management = await get("/campo");
  assert.equal(management.status, 200);
  assert.ok(
    management.data.orders.every(
      (o) => !["CONCLUIDA", "CANCELADA"].includes(o.status),
    ),
  );
  const field = await get("/campo", "campo");
  assert.ok(
    field.data.orders.some((o) => o.status === "CONCLUIDA"),
    "Equipe de Campo keeps its history",
  );
  assert.deepEqual(Object.keys(field.data).sort(), [
    "orders",
    "push",
    "records",
    "server_time",
  ]);
});
