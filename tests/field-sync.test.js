// Field app sync contract: request_id replay, captured_at, structured error codes and duplicate links.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";

let db, server, base, admin, opA, opB, opC, opAId;
const temp = mkdtempSync(join(tmpdir(), "urbana-sync-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "false";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;

const photo = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV6kAAAAASUVORK5CYII=",
  "base64",
);
const call = async (path, method = "GET", body, cookie = admin) => {
  const r = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0] };
};
const version = async (path, cookie = admin) => (await call(path, "GET", undefined, cookie)).data.version;
// Transition with the version read just before (as the web client does).
const act = async (path, action, body, cookie) =>
  call(`${path}/${action}`, "POST", { version: await version(path), ...body }, cookie);
const attach = async (path, stage, cookie, extra = {}) => {
  const f = new FormData();
  f.append("file", new Blob([photo], { type: "image/png" }), "foto.png");
  f.append("stage", stage);
  f.append("lat", "-27.1");
  f.append("lng", "-48.6");
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  const r = await fetch(base + path + "/anexos", { method: "POST", headers: { cookie }, body: f });
  return { status: r.status, data: await r.json() };
};
const draft = (lat) => ({
  category_id: "category-1", subcategory: "Buraco", description: "Falha no pavimento",
  origin: "Fiscalização municipal", priority: "Alta", lat, lng: -48.6,
  address: "Rua de teste, 100", neighborhood: "Centro",
});
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
async function orderFor(lat, assigned = opAId) {
  const o = await call("/ocorrencias", "POST", draft(lat));
  assert.equal(o.status, 200);
  const c = await call(`/ocorrencias/${o.data.id}/classificar`, "POST", {
    version: o.data.version, category_id: "category-1", subcategory: "Buraco", priority: "Alta", sector_id: "sector-1",
  });
  assert.equal(c.status, 200);
  const s = await call("/ordens-servico", "POST", {
    occurrence_ids: [o.data.id], team_id: "team-1", assigned_user_id: assigned,
    scheduled_at: "2026-10-10", responsible: "Responsável",
  });
  assert.equal(s.status, 200);
  return `/ordens-servico/${s.data.id}`;
}
const reprogram = async (path) => {
  const r = await act(path, "programacao", { team_id: "team-1", assigned_user_id: opAId, responsible: "Gestão", scheduled_at: "2026-10-11" }, admin);
  assert.equal(r.status, 200);
  return r.data;
};
const count = async (sql, args = []) => Number((await db.get(sql, args)).n);

before(async () => {
  db = await openDatabase();
  await seed(db);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  admin = (await call("/auth/login", "POST", { email: "admin@urbana.local", password: "Testing@2026" }, null)).cookie;
  const cookies = {};
  for (const [key, team] of [["a", "team-1"], ["b", "team-1"], ["c", "team-2"]]) {
    const email = `sync-${key}@test.local`;
    const u = await call("/users", "POST", { name: `Operador ${key}`, email, password: "Testing@2026", role: "Equipe de Campo", team_id: team });
    assert.equal(u.status, 200);
    cookies[key] = (await call("/auth/login", "POST", { email, password: "Testing@2026" }, null)).cookie;
  }
  ({ a: opA, b: opB, c: opC } = cookies);
  opAId = (await call("/auth/me", "GET", undefined, opA)).data.user.id;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(temp, { recursive: true, force: true });
});

test("migration 10 adds evidence.captured_at and is registered", async () => {
  assert.ok(await db.get("SELECT version FROM schema_migrations WHERE version=10"));
  assert.ok(await db.get("SELECT name FROM pragma_table_info('evidence') WHERE name='captured_at'"));
});

test("calls without the new fields keep the legacy behavior and responses", async () => {
  const path = await orderFor(-27.01);
  const requests = await count("SELECT COUNT(*) AS n FROM client_requests");
  const start = await act(path, "iniciar", { lat: -27.01, lng: -48.6 }, opA);
  assert.equal(start.status, 400);
  assert.deepEqual(Object.keys(start.data).sort(), ["code", "error"]);
  assert.equal(start.data.error, "Anexe uma foto antes de iniciar a execução.");
  const photoResult = await attach(path, "antes", opA);
  assert.equal(photoResult.status, 200);
  assert.deepEqual(Object.keys(photoResult.data), ["id"]);
  const before = Date.now();
  const assumed = await act(path, "assumir", {}, opA);
  assert.equal(assumed.status, 200);
  assert.equal(assumed.data.replayed, undefined);
  assert.equal(assumed.data.assumed_by, opAId);
  assert.equal(assumed.data.assumed_by_name, "Operador a");
  assert.equal(assumed.data.assigned_user_id, opAId);
  const started = await act(path, "iniciar", { lat: -27.01, lng: -48.6 }, opA);
  assert.equal(started.status, 200);
  assert.equal(started.data.replayed, undefined);
  assert.ok(Date.parse(started.data.started_at) >= before - 1000);
  const material = await call(`${path}/material`, "POST", { material_id: "material-1", quantity: 2 }, opA);
  assert.deepEqual(material, { status: 200, data: { ok: true }, cookie: undefined });
  assert.equal(await count("SELECT COUNT(*) AS n FROM client_requests"), requests);
  const detail = (await call(path, "GET", undefined, opA)).data;
  assert.equal(detail.evidence[0].captured_at, null);
  // Without request_id a repeated transition is still rejected by version/status as before.
  const repeated = await call(`${path}/iniciar`, "POST", { version: started.data.version - 1, lat: -27.01, lng: -48.6 }, opA);
  assert.equal(repeated.status, 409);
  assert.equal(repeated.data.code, "VERSION_CONFLICT");
});

test("transition replay with the same request_id after reprogramming is not reapplied", async () => {
  const path = await orderFor(-27.02);
  const assumeId = randomUUID(), returnId = randomUUID();
  assert.equal((await act(path, "assumir", { request_id: assumeId }, opA)).status, 200);
  const returned = await act(path, "devolver", { request_id: returnId, reason: "Rua interditada" }, opA);
  assert.equal(returned.status, 200);
  assert.equal(returned.data.status, "DEVOLVIDA");
  const reprogrammed = await reprogram(path);
  assert.equal(reprogrammed.status, "PROGRAMADA");
  assert.equal(reprogrammed.assumed_by, null);
  assert.equal(reprogrammed.assumed_by_name, null);
  const audits = await count("SELECT COUNT(*) AS n FROM audit_logs");
  // Replays carry a stale version: must not be validated nor reapplied.
  for (const [action, id, body] of [["devolver", returnId, { reason: "Rua interditada" }], ["assumir", assumeId, {}]]) {
    const replay = await call(`${path}/${action}`, "POST", { version: 1, request_id: id, ...body }, opA);
    assert.equal(replay.status, 200, action);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.status, "PROGRAMADA");
    assert.equal(replay.data.version, reprogrammed.version);
  }
  assert.equal(await count("SELECT COUNT(*) AS n FROM audit_logs"), audits);
  // Same key on another order or another entity type is rejected.
  const other = await orderFor(-27.03);
  const reused = await act(other, "assumir", { request_id: assumeId }, opA);
  assert.equal(reused.status, 409);
  assert.equal(reused.data.code, "REQUEST_ID_REUSED");
  assert.equal(reused.data.error, "Identificador de envio já utilizado.");
  const occurrenceKey = randomUUID();
  assert.equal((await call("/ocorrencias", "POST", { ...draft(-27.04), request_id: occurrenceKey }, opA)).status, 200);
  const crossed = await act(other, "assumir", { request_id: occurrenceKey }, opA);
  assert.equal(crossed.status, 409);
  assert.equal(crossed.data.code, "REQUEST_ID_REUSED");
  const materialReuse = await call(`${other}/material`, "POST", { material_id: "material-1", quantity: 1, request_id: assumeId }, opA);
  assert.equal(materialReuse.status, 409);
  assert.equal(materialReuse.data.code, "REQUEST_ID_REUSED");
  assert.equal((await call(other, "GET", undefined, opA)).data.status, "PROGRAMADA");
  // A failed transition does not consume the key.
  const failedKey = randomUUID();
  assert.equal((await act(other, "concluir", { request_id: failedKey, notes: "x" }, opA)).status, 409);
  assert.equal((await act(other, "assumir", { request_id: failedKey }, opA)).data.status, "EM_DESLOCAMENTO");
});

test("captured_at drives work times and photo rules; material is idempotent", async () => {
  const path = await orderFor(-27.05);
  // Photo taken (offline) before the reprogramming does not count for starting.
  const takenBefore = iso(0);
  await new Promise((r) => setTimeout(r, 15));
  await reprogram(path);
  assert.equal((await attach(path, "antes", opA, { captured_at: takenBefore })).status, 200);
  const blocked = await act(path, "iniciar", { lat: -27.05, lng: -48.6, captured_at: iso(0) }, opA);
  assert.equal(blocked.status, 400);
  assert.equal(blocked.data.code, "BEFORE_PHOTO_REQUIRED");
  const fresh = await attach(path, "antes", opA, { captured_at: iso(0) });
  assert.equal(fresh.status, 200);
  const startedAt = iso(-1000);
  const started = await act(path, "iniciar", { lat: -27.05, lng: -48.6, captured_at: startedAt }, opA);
  assert.equal(started.status, 200);
  assert.equal(started.data.started_at, startedAt);
  const evidence = (await call(path, "GET", undefined, opA)).data.evidence;
  assert.equal(evidence.find((e) => e.id === fresh.data.id).captured_at !== null, true);
  assert.ok(evidence.every((e) => typeof e.created_at === "string"));

  const key = randomUUID();
  const first = await call(`${path}/material`, "POST", { material_id: "material-1", quantity: 3, request_id: key, captured_at: iso(0) }, opA);
  assert.deepEqual(first.data, { ok: true });
  const again = await call(`${path}/material`, "POST", { material_id: "material-1", quantity: 3, request_id: key }, opA);
  assert.deepEqual(again.data, { ok: true, replayed: true });
  assert.equal((await call(path, "GET", undefined, opA)).data.materials.length, 1);

  // "Depois" photo captured before the start is not accepted for completion.
  assert.equal((await attach(path, "depois", opA, { captured_at: iso(-60 * 60 * 1000) })).status, 200);
  const early = await act(path, "concluir", { notes: "Reparo concluído" }, opA);
  assert.equal(early.status, 400);
  assert.equal(early.data.code, "AFTER_PHOTO_REQUIRED");
  assert.equal((await attach(path, "depois", opA, { captured_at: iso(0) })).status, 200);
  const finishedAt = iso(0);
  const done = await act(path, "concluir", { notes: "Reparo concluído", captured_at: finishedAt }, opA);
  assert.equal(done.status, 200);
  assert.equal(done.data.finished_at, finishedAt);
  // Material replay still succeeds after the order left execution.
  assert.deepEqual((await call(`${path}/material`, "POST", { material_id: "material-1", quantity: 3, request_id: key }, opA)).data, { ok: true, replayed: true });
  const closed = await attach(path, "depois", opA);
  assert.equal(closed.status, 409);
  assert.equal(closed.data.code, "RECORD_CLOSED");
  assert.equal(closed.data.error, "Registro encerrado para anexos.");

  const other = await orderFor(-27.06);
  const returnedAt = iso(-5 * 60 * 1000);
  const returned = await act(other, "devolver", { reason: "Sem acesso", captured_at: returnedAt }, opA);
  assert.equal(returned.data.returned_at, returnedAt);
});

test("invalid captured_at is rejected with INVALID_CAPTURED_AT and changes nothing", async () => {
  const path = await orderFor(-27.07);
  for (const value of ["ontem", iso(60 * 60 * 1000), iso(-31 * 24 * 3600 * 1000), "2026-13-45T00:00:00Z", 12345]) {
    const r = await act(path, "assumir", { captured_at: value }, opA);
    assert.equal(r.status, 400, String(value));
    assert.equal(r.data.code, "INVALID_CAPTURED_AT");
    const photoResult = await attach(path, "antes", opA, { captured_at: String(value) });
    assert.equal(photoResult.status, 400);
    assert.equal(photoResult.data.code, "INVALID_CAPTURED_AT");
  }
  assert.equal((await call(path, "GET", undefined, opA)).data.status, "PROGRAMADA");
  assert.equal((await call(path, "GET", undefined, opA)).data.evidence.length, 0);
  assert.equal((await attach(path, "antes", opA)).status, 200);
  assert.equal((await act(path, "iniciar", { lat: -27.07, lng: -48.6 }, opA)).status, 200);
  const material = await call(`${path}/material`, "POST", { material_id: "material-1", quantity: 1, captured_at: "amanhã" }, opA);
  assert.equal(material.status, 400);
  assert.equal(material.data.code, "INVALID_CAPTURED_AT");
  // A future time within the 5 minute tolerance is accepted.
  assert.equal((await call(`${path}/material`, "POST", { material_id: "material-1", quantity: 1, captured_at: iso(2 * 60 * 1000) }, opA)).status, 200);
});

test("structured codes keep the same status and message", async () => {
  const path = await orderFor(-27.08);
  const foreign = await act(path, "assumir", {}, opC);
  assert.equal(foreign.status, 403);
  assert.equal(foreign.data.code, "ORDER_NOT_ACCESSIBLE");
  assert.equal(foreign.data.error, "Esta ordem pertence a outra equipe.");
  assert.equal((await call(path, "GET", undefined, opB)).data.code, "ORDER_NOT_ACCESSIBLE");
  const wrong = await act(path, "concluir", { notes: "x" }, opA);
  assert.equal(wrong.status, 409);
  assert.equal(wrong.data.code, "INVALID_STATUS");
  assert.equal(wrong.data.error, "Ação incompatível com o status atual.");
  assert.equal((await attach(path, "antes", opA)).status, 200);
  assert.equal((await act(path, "iniciar", { lat: -27.08, lng: -48.6 }, opA)).status, 200);
  assert.equal((await attach(path, "depois", opA)).status, 200);
  const noMaterial = await act(path, "concluir", { notes: "Pronto" }, opA);
  assert.equal(noMaterial.status, 400);
  assert.equal(noMaterial.data.code, "MATERIAL_REQUIRED");
  assert.equal(noMaterial.data.error, "Registre o material utilizado antes de concluir.");
  // Keys are per user: another team's operator using the same key gets no replay nor data.
  const key = randomUUID();
  assert.equal((await act(path, "concluir", { notes: "Pronto", request_id: key }, opA)).data.code, "MATERIAL_REQUIRED");
  const intruder = await act(path, "concluir", { notes: "Pronto", request_id: key }, opC);
  assert.equal(intruder.status, 403);
  assert.equal(intruder.data.code, "ORDER_NOT_ACCESSIBLE");
});

test("duplicate link is idempotent and only its author may add the registro photo", async () => {
  const target = (await call("/ocorrencias", "POST", draft(-27.09))).data;
  const invalid = await call("/ocorrencias", "POST", { ...draft(-27.09), duplicate_action: "link", duplicate_id: "nope", request_id: randomUUID() }, opC);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, "INVALID_DUPLICATE_LINK");
  assert.equal(invalid.data.error, "Vínculo de duplicidade inválido.");
  const key = randomUUID();
  const linked = await call("/ocorrencias", "POST", { ...draft(-27.09), duplicate_action: "link", duplicate_id: target.id, request_id: key }, opC);
  assert.equal(linked.status, 200);
  assert.equal(linked.data.id, target.id);
  assert.equal(linked.data.linked, true);
  const audits = await count("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id=?", [target.id]);
  const occurrences = await count("SELECT COUNT(*) AS n FROM occurrences");
  for (const action of ["link", "new"]) {
    const replay = await call("/ocorrencias", "POST", { ...draft(-27.09), duplicate_action: action, duplicate_id: target.id, request_id: key }, opC);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.id, target.id);
    assert.equal(replay.data.linked, true);
  }
  assert.equal(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id=?", [target.id]), audits);
  assert.equal(await count("SELECT COUNT(*) AS n FROM occurrences"), occurrences);
  // The link author may attach the registro photo, and only that stage.
  const registro = await attach(`/ocorrencias/${target.id}`, "registro", opC, { request_id: randomUUID(), captured_at: iso(0) });
  assert.equal(registro.status, 200);
  assert.equal((await attach(`/ocorrencias/${target.id}`, "antes", opC)).status, 403);
  // Others (and a link without request_id) keep the existing restriction.
  assert.equal((await attach(`/ocorrencias/${target.id}`, "registro", opA)).status, 403);
  const legacy = await call("/ocorrencias", "POST", { ...draft(-27.09), duplicate_action: "link", duplicate_id: target.id }, opB);
  assert.equal(legacy.data.linked, true);
  assert.equal((await attach(`/ocorrencias/${target.id}`, "registro", opB)).status, 403);
  // The link key cannot be reused by its author for a transition.
  const path = await orderFor(-27.11);
  const reused = await act(path, "assumir", { request_id: key }, opC);
  assert.equal(reused.status, 409);
  assert.equal(reused.data.code, "REQUEST_ID_REUSED");
});
