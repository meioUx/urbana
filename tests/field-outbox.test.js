import "./support/same-origin-fetch.js";
// Offline field queue (src/modules/field/outbox-model.mjs): ordering, local validation, optimistic
// projection, conflict policy and a full queued cycle replayed against the real API.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyAccepted,
  backoffDelay,
  buildRequest,
  capturedNow,
  classifyFailure,
  clockOffset,
  flushQueue,
  nextSendable,
  prepareRetry,
  projectList,
  projectOrder,
  queueStates,
  rejectionText,
  resequenceForRetry,
  validateAction,
} from "../src/modules/field/outbox-model.mjs";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";

let seq = 0;
const item = (kind, body = {}, extra = {}) => ({
  id: randomUUID(),
  user_id: "u1",
  user_name: "Operador",
  order_id: "o1",
  kind,
  body,
  captured_at: new Date(Date.UTC(2026, 9, 10, 12, 0, ++seq)).toISOString(),
  created_at: new Date().toISOString(),
  seq,
  base_version: 3,
  status: "pending",
  attempts: 0,
  ...extra,
});
const catalogs = [
  {
    id: "cat",
    kind: "categorias",
    require_before: true,
    require_after: true,
    require_material: true,
  },
  {
    id: "free",
    kind: "categorias",
    require_before: false,
    require_after: false,
    require_material: false,
  },
];
const order = (extra = {}) => ({
  id: "o1",
  code: "OS-1",
  status: "PROGRAMADA",
  version: 3,
  created_at: "2026-10-10T10:00:00.000Z",
  occurrences: [{ id: "c1", category_id: "cat" }],
  evidence: [],
  materials: [],
  equipment: [],
  ...extra,
});

test("failures are classified: network/timeout, expired session, temporary and definitive", () => {
  assert.equal(classifyFailure(new Error("offline")), "network");
  assert.equal(classifyFailure({ status: 0 }), "network");
  assert.equal(classifyFailure({ status: 401 }), "auth");
  for (const status of [408, 429, 500, 502, 503])
    assert.equal(classifyFailure({ status }), "retry", String(status));
  for (const status of [400, 403, 404, 409, 413, 428])
    assert.equal(classifyFailure({ status }), "rejected", String(status));
});

test("backoff grows exponentially with jitter and is capped at five minutes", () => {
  const mid = () => 0.5;
  assert.equal(backoffDelay(1, mid), 2000);
  assert.equal(backoffDelay(2, mid), 4000);
  assert.equal(backoffDelay(4, mid), 16000);
  assert.equal(backoffDelay(30, mid), 300000);
  assert.ok(
    backoffDelay(1, () => 0) >= 1500 && backoffDelay(1, () => 1) <= 2500,
  );
});

test("a rejected action blocks only the following actions of the same order", () => {
  const a1 = item("assumir", {}, { status: "rejected" });
  const a2 = item("iniciar", { lat: 1, lng: 1 });
  const b1 = item("assumir", {}, { order_id: "o2" });
  assert.equal(nextSendable([a2, b1, a1]).id, b1.id);
  assert.deepEqual(
    queueStates([a1, a2, b1]).map((s) => s.state),
    ["rejected", "waiting", "pending"],
  );
  assert.equal(nextSendable([a1, a2]), null);
});

test("local validation anticipates the server rules using pending actions", () => {
  const programmed = order();
  assert.equal(
    validateAction(programmed, "concluir", { notes: "x" }, catalogs).code,
    "INVALID_STATUS",
  );
  assert.equal(
    validateAction(programmed, "iniciar", { lat: "", lng: "" }, catalogs).code,
    "START_GPS_REQUIRED",
  );
  assert.equal(
    validateAction(programmed, "iniciar", { lat: -27, lng: -48 }, catalogs)
      .message,
    "Anexe uma foto antes de iniciar a execução.",
  );
  // A queued "antes" photo satisfies the rule in the projected order.
  const photo = item("anexo", {
    stage: "antes",
    lat: -27,
    lng: -48,
    mime: "image/png",
  });
  const projected = projectOrder(programmed, [item("assumir"), photo]);
  assert.equal(projected.status, "EM_DESLOCAMENTO");
  assert.equal(
    validateAction(projected, "iniciar", { lat: -27, lng: -48 }, catalogs),
    null,
  );
  // A photo captured before the reprogramming does not count (captured_at ?? created_at).
  const reprogrammed = order({ reprogrammed_at: "2026-10-11T00:00:00.000Z" });
  assert.equal(
    validateAction(
      projectOrder(reprogrammed, [photo]),
      "iniciar",
      { lat: 1, lng: 1 },
      catalogs,
    ).code,
    "BEFORE_PHOTO_REQUIRED",
  );
  // Categories without requirements accept the transition right away.
  assert.equal(
    validateAction(
      order({ occurrences: [{ category_id: "free" }] }),
      "iniciar",
      { lat: 1, lng: 1 },
      catalogs,
    ),
    null,
  );
  // "depois" photos and materials need execution; completion needs notes, after photo and material.
  assert.equal(
    validateAction(
      projected,
      "anexo",
      { stage: "depois", lat: 1, lng: 1 },
      catalogs,
    ).code,
    "EXECUTION_REQUIRED_PHOTO",
  );
  assert.equal(
    validateAction(
      projected,
      "material",
      { material_id: "m", quantity: 1 },
      catalogs,
    ).code,
    "EXECUTION_REQUIRED_MATERIAL",
  );
  assert.equal(
    validateAction(projected, "anexo", { stage: "antes" }, catalogs).code,
    "GPS_REQUIRED",
  );
  const started = projectOrder(programmed, [
    photo,
    item("iniciar", { lat: 1, lng: 1 }),
  ]);
  assert.equal(started.status, "EM_EXECUCAO");
  assert.equal(
    validateAction(started, "concluir", { notes: " " }, catalogs).code,
    "NOTES_REQUIRED",
  );
  assert.equal(
    validateAction(started, "concluir", { notes: "ok" }, catalogs).code,
    "AFTER_PHOTO_REQUIRED",
  );
  const withAfter = projectOrder(programmed, [
    photo,
    item("iniciar", { lat: 1, lng: 1 }),
    item("anexo", { stage: "depois", lat: 1, lng: 1 }),
  ]);
  assert.equal(
    validateAction(withAfter, "concluir", { notes: "ok" }, catalogs).code,
    "MATERIAL_REQUIRED",
  );
  assert.equal(
    validateAction(
      withAfter,
      "material",
      { material_id: "m", quantity: 0 },
      catalogs,
    ).code,
    "QUANTITY_INVALID",
  );
  const complete = projectOrder(programmed, [
    photo,
    item("iniciar", { lat: 1, lng: 1 }),
    item("anexo", { stage: "depois", lat: 1, lng: 1 }),
    item("material", { material_id: "m", quantity: 2 }),
  ]);
  assert.equal(
    validateAction(complete, "concluir", { notes: "ok" }, catalogs),
    null,
  );
  assert.equal(
    validateAction(complete, "devolver", { reason: "" }, catalogs).code,
    "REASON_REQUIRED",
  );
  assert.equal(
    validateAction(
      order({ status: "AGUARDANDO_VALIDACAO" }),
      "anexo",
      { stage: "antes", lat: 1, lng: 1 },
      catalogs,
    ).code,
    "RECORD_CLOSED",
  );
});

test("projection marks local entries and skips rejected or out-of-order transitions", () => {
  const actions = [
    item("assumir"),
    item("anexo", { stage: "antes", lat: 1, lng: 2, mime: "image/png" }),
    item("iniciar", { lat: 1, lng: 2 }),
    item("material", { material_id: "m", quantity: 2 }),
    item("equipamento", { equipment_id: "e" }),
    item("concluir", { notes: "Feito" }),
  ];
  const projected = projectOrder(order(), actions);
  assert.equal(projected.status, "AGUARDANDO_VALIDACAO");
  assert.equal(projected.started_at, actions[2].captured_at);
  assert.equal(projected.finished_at, actions[5].captured_at);
  assert.equal(projected.completion_notes, "Feito");
  assert.equal(projected.evidence[0].pending, true);
  assert.equal(projected.materials[0].local_item, actions[3].id);
  assert.deepEqual(
    projected.equipment.map((e) => e.equipment_id),
    ["e"],
  );
  assert.equal(
    projected.version,
    3,
    "the server version is never invented locally",
  );
  // Actions behind a rejected one are not shown as done: they wait for the operator decision.
  const rejected = projectOrder(order(), [
    { ...actions[0], status: "rejected" },
    actions[2],
    actions[5],
  ]);
  assert.equal(rejected.status, "PROGRAMADA");
  assert.deepEqual(
    rejected.pending_actions.map((p) => p.state),
    ["rejected", "waiting", "waiting"],
  );
  // A transition that no longer fits the state also waits.
  const stale = projectOrder(order({ status: "EM_EXECUCAO" }), [
    actions[0],
    actions[3],
  ]);
  assert.deepEqual(
    stale.pending_actions.map((p) => p.state),
    ["waiting", "pending"],
  );
  assert.equal(stale.materials.length, 1);
  const list = projectList([order(), order({ id: "o2" })], actions);
  assert.equal(list[0].status, "AGUARDANDO_VALIDACAO");
  assert.equal(list[0].pending_count, 6);
  assert.equal(list[1].pending_count, undefined);
});

test("requests carry the stable request_id, captured_at and the expected version", () => {
  const start = item("iniciar", { lat: "1.5", lng: "2" });
  assert.deepEqual(buildRequest(start), {
    path: "/ordens-servico/o1/iniciar",
    method: "POST",
    json: {
      lat: 1.5,
      lng: 2,
      version: 3,
      request_id: start.id,
      captured_at: start.captured_at,
    },
  });
  const photo = item("anexo", { stage: "depois", lat: 1, lng: 2 });
  assert.deepEqual(buildRequest(photo).multipart, {
    stage: "depois",
    lat: "1",
    lng: "2",
    request_id: photo.id,
    captured_at: photo.captured_at,
  });
  const material = item("material", { material_id: "m", quantity: "3" });
  assert.deepEqual(buildRequest(material).json, {
    material_id: "m",
    quantity: 3,
    request_id: material.id,
    captured_at: material.captured_at,
  });
  const equipment = item("equipamento", { equipment_id: "e" });
  assert.deepEqual(buildRequest(equipment).json, {
    equipment_id: "e",
    request_id: equipment.id,
    captured_at: equipment.captured_at,
  });
  assert.equal(
    buildRequest({ ...equipment, drop_captured_at: true }).json.captured_at,
    undefined,
  );
  assert.equal(
    buildRequest({ ...start, drop_captured_at: true }).json.captured_at,
    undefined,
  );
});

test("retry after a rejection uses the current version and drops a refused device time", () => {
  const rejected = item(
    "iniciar",
    { lat: 1, lng: 1 },
    { status: "rejected", attempts: 1, error: { code: "INVALID_CAPTURED_AT" } },
  );
  const retried = prepareRetry(rejected, 9);
  assert.equal(retried.status, "pending");
  assert.equal(retried.base_version, 9);
  assert.equal(retried.drop_captured_at, true);
  assert.equal(retried.error, undefined);
  assert.equal(
    retried.id,
    rejected.id,
    "the request_id is kept: a rejected transition does not consume it",
  );
  assert.equal(
    prepareRetry(
      item(
        "material",
        {},
        { status: "rejected", error: { code: "INVALID_STATUS" } },
      ),
      9,
    ).base_version,
    3,
  );
  assert.match(
    rejectionText({ status: 409, code: "VERSION_CONFLICT", message: "x" }),
    /alterada pela gestão/,
  );
  assert.match(
    rejectionText({ status: 403, code: "ORDER_NOT_ACCESSIBLE" }),
    /outra equipe/,
  );
  assert.equal(
    rejectionText({ status: 400, message: "Mensagem do servidor." }),
    "Mensagem do servidor.",
  );
});

test("a retried action goes after what the operator did once it was rejected", () => {
  const rejectedAt = "2026-10-10T12:00:10.000Z";
  const start = item(
    "iniciar",
    { lat: 1, lng: 1 },
    {
      seq: 10,
      status: "rejected",
      rejected_at: rejectedAt,
      created_at: "2026-10-10T12:00:00.000Z",
    },
  );
  const material = item(
    "material",
    { material_id: "m", quantity: 1 },
    { seq: 11, created_at: "2026-10-10T12:00:05.000Z" },
  );
  const newPhoto = item(
    "anexo",
    { stage: "antes", lat: 1, lng: 1 },
    { seq: 12, created_at: "2026-10-10T12:00:20.000Z" },
  );
  const otherOrder = item("assumir", {}, { seq: 13, order_id: "o2" });
  let n = 100;
  const next = resequenceForRetry(
    [start, material, newPhoto, otherOrder],
    start.id,
    () => ++n,
  );
  const byId = Object.fromEntries(next.map((i) => [i.id, i.seq]));
  assert.ok(
    byId[newPhoto.id] < byId[start.id] && byId[start.id] < byId[material.id],
  );
  assert.equal(byId[otherOrder.id], undefined, "other orders keep their place");
  assert.equal(next.length, 3);
});

test("accepted actions update the cached order before the full reload", () => {
  const cached = order({ evidence: [{ id: "e0" }], materials: [] });
  const moved = applyAccepted(
    cached,
    item("assumir"),
    { id: "o1", status: "EM_DESLOCAMENTO", version: 4, replayed: true },
    "now",
  );
  assert.equal(moved.status, "EM_DESLOCAMENTO");
  assert.equal(moved.version, 4);
  assert.equal(moved.replayed, undefined);
  assert.deepEqual(moved.evidence, [{ id: "e0" }]);
  assert.equal(
    applyAccepted(cached, item("assumir"), { id: "o1", replayed: true }, "now"),
    cached,
  );
  const photo = applyAccepted(
    cached,
    item("anexo", { stage: "antes", lat: 1, lng: 1, mime: "image/png" }),
    { id: "e1" },
    "now",
  );
  assert.deepEqual(
    photo.evidence.map((e) => e.id),
    ["e0", "e1"],
  );
  assert.equal(
    applyAccepted(
      photo,
      item("anexo", { stage: "antes" }),
      { id: "e1" },
      "now",
    ),
    photo,
  );
});

test("server clock offset corrects captured_at", () => {
  assert.equal(
    clockOffset(
      "2026-10-10T10:00:10.000Z",
      Date.parse("2026-10-10T10:00:00.000Z"),
      Date.parse("2026-10-10T10:00:02.000Z"),
    ),
    9000,
  );
  assert.equal(clockOffset("invalid", 1, 2), 0);
  assert.equal(
    capturedNow(1000, Date.parse("2026-10-10T10:00:00.000Z")),
    "2026-10-10T10:00:01.000Z",
  );
});

/** In-memory outbox for flushQueue. */
function memory(items) {
  const store = new Map(items.map((i) => [i.id, i]));
  return {
    store,
    list: async () => [...store.values()],
    save: async (i) => void store.set(i.id, i),
    remove: async (id) => void store.delete(id),
  };
}

test("flush sends in order, rebases versions on own transitions and isolates rejections", async () => {
  const a1 = item("assumir"),
    a2 = item("anexo", { stage: "antes", lat: 1, lng: 1 }),
    a3 = item("iniciar", { lat: 1, lng: 1 }),
    b1 = item("assumir", {}, { order_id: "o2", base_version: 7 }),
    b2 = item("anexo", { stage: "antes", lat: 1, lng: 1 }, { order_id: "o2" }),
    c1 = item("assumir", {}, { order_id: "o3" });
  const mem = memory([a3, b2, c1, a1, b1, a2]);
  const sent = [];
  const accepted = [],
    rejected = [];
  const result = await flushQueue({
    ...mem,
    send: async (i) => {
      const request = buildRequest(i);
      sent.push([i.order_id, i.kind, request.json?.version]);
      if (i.order_id === "o2")
        throw Object.assign(new Error("Registro alterado por outro usuário."), {
          status: 409,
          code: "VERSION_CONFLICT",
        });
      return i.kind === "assumir"
        ? { id: i.order_id, status: "EM_DESLOCAMENTO", version: 4 }
        : i.kind === "iniciar"
          ? { id: i.order_id, version: 5 }
          : { id: "ev" };
    },
    accepted: async (i) => void accepted.push(i.id),
    rejected: async (i) => void rejected.push(i.id),
    now: () => 0,
  });
  assert.deepEqual(sent, [
    ["o1", "assumir", 3],
    ["o1", "anexo", undefined],
    ["o1", "iniciar", 4],
    ["o2", "assumir", 7],
    ["o3", "assumir", 3],
  ]);
  assert.deepEqual(result, {
    sent: 4,
    rejected: 1,
    stop: null,
    retryIn: 0,
    touched: ["o1", "o2", "o3"],
  });
  assert.deepEqual(rejected, [b1.id]);
  assert.deepEqual([...mem.store.keys()].sort(), [b1.id, b2.id].sort());
  const stored = mem.store.get(b1.id);
  assert.equal(stored.status, "rejected");
  assert.equal(stored.error.code, "VERSION_CONFLICT");
  assert.match(stored.error.reason, /alterada pela gestão/);
  assert.equal(
    mem.store.get(b2.id).status,
    "pending",
    "following actions wait for the operator decision",
  );
});

test("flush stops on network errors and expired sessions without losing anything", async () => {
  const a = item("assumir"),
    b = item("material", { material_id: "m", quantity: 1 }, { order_id: "o2" });
  const offline = memory([a, b]);
  const network = await flushQueue({
    ...offline,
    send: async () => {
      throw new Error("Failed to fetch");
    },
    now: () => 0,
  });
  assert.equal(network.stop, "network");
  assert.ok(network.retryIn >= 1500);
  assert.equal(offline.store.size, 2);
  assert.equal(offline.store.get(a.id).attempts, 1);
  const auth = await flushQueue({
    ...offline,
    send: async () => {
      throw Object.assign(new Error("Sessão expirada."), { status: 401 });
    },
    now: () => 0,
  });
  assert.equal(auth.stop, "auth");
  assert.equal(offline.store.get(a.id).status, "pending");
  const busy = await flushQueue({
    ...offline,
    send: async () => {
      throw Object.assign(new Error("Ocupado"), { status: 503 });
    },
    now: () => 0,
  });
  assert.equal(busy.stop, "retry");
  assert.equal(offline.store.size, 2);
});

test("service worker leaves /api alone and does not read the field IndexedDB", () => {
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  // Offline boot is done by the app (ADR-020): the service worker never answers or stores /api.
  assert.doesNotMatch(
    sw,
    /indexedDB|\/api\/bootstrap|offline: true|X-Urbana-Offline/,
  );
  assert.match(sw, /if \(url\.pathname\.startsWith\("\/api\/"\)\) return;/);
  assert.doesNotMatch(sw, /cache\.put\([^)]*api/i);
});

// Full offline cycle replayed against the real API, including a lost response (network error after
// the server applied the action) and a rejection caused by the manager reassigning an order.
let db, server, base, admin, operator, operatorId;
const temp = mkdtempSync(join(tmpdir(), "urbana-outbox-"));
const photo = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV6kAAAAASUVORK5CYII=",
  "base64",
);
const call = async (path, method = "GET", body, cookie = admin) => {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
};
async function createOrder(lat) {
  const o = await call("/ocorrencias", "POST", {
    category_id: "category-1",
    subcategory: "Buraco",
    description: "Falha",
    origin: "Fiscalização municipal",
    priority: "Alta",
    lat,
    lng: -48.6,
    address: "Rua da fila, 1",
    neighborhood: "Centro",
  });
  await call(`/ocorrencias/${o.data.id}/classificar`, "POST", {
    version: o.data.version,
    category_id: "category-1",
    subcategory: "Buraco",
    priority: "Alta",
    sector_id: "sector-1",
  });
  const s = await call("/ordens-servico", "POST", {
    occurrence_ids: [o.data.id],
    team_id: "team-1",
    assigned_user_id: operatorId,
    scheduled_at: "2026-10-10",
    responsible: "Equipe",
  });
  return (
    await call(`/ordens-servico/${s.data.id}`, "GET", undefined, operator)
  ).data;
}
/** Same transport as src/modules/field/sync.ts, with Node's fetch and the operator cookie. */
async function transport(i) {
  const req = buildRequest(i);
  let init;
  if (req.multipart) {
    const form = new FormData();
    form.append("file", new Blob([photo], { type: "image/png" }), "foto.png");
    for (const [k, v] of Object.entries(req.multipart)) form.append(k, v);
    init = { method: "POST", headers: { cookie: operator }, body: form };
  } else
    init = {
      method: "POST",
      headers: { cookie: operator, "Content-Type": "application/json" },
      body: JSON.stringify(req.json),
    };
  const r = await fetch(base + req.path, init);
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error), {
      status: r.status,
      code: data.code,
    });
  return data;
}

before(async () => {
  process.env.DATA_DIR = temp;
  process.env.DEMO_DATA = "false";
  process.env.ADMIN_PASSWORD = "Testing@2026";
  delete process.env.DATABASE_URL;
  db = await openDatabase();
  await seed(db);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  admin = (
    await call(
      "/auth/login",
      "POST",
      { email: "admin@urbana.local", password: "Testing@2026" },
      null,
    )
  ).cookie;
  assert.equal(
    (
      await call("/users", "POST", {
        name: "Operador fila",
        email: "fila@test.local",
        password: "Testing@2026",
        role: "Equipe de Campo",
        team_id: "team-1",
      })
    ).status,
    200,
  );
  operator = (
    await call(
      "/auth/login",
      "POST",
      { email: "fila@test.local", password: "Testing@2026" },
      null,
    )
  ).cookie;
  operatorId = (await call("/auth/me", "GET", undefined, operator)).data.user
    .id;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(temp, { recursive: true, force: true });
});

test("a queued offline cycle reaches the server once, in order, with the real work times", async () => {
  const cached = await createOrder(-27.21);
  const other = await createOrder(-27.22);
  // Work happens after the order was issued (photo rules compare with created_at); n seconds ahead.
  const t0 = Date.now();
  const t = (seconds) => new Date(t0 + seconds * 1000).toISOString();
  const make = (o, kind, body, seconds, n) => ({
    id: randomUUID(),
    user_id: operatorId,
    user_name: "Operador fila",
    order_id: o.id,
    order_code: o.code,
    kind,
    body,
    captured_at: t(seconds),
    created_at: t(seconds),
    seq: n,
    base_version: o.version,
    status: "pending",
    attempts: 0,
  });
  const queue = [
    make(cached, "assumir", {}, 1, 1),
    make(
      cached,
      "anexo",
      { stage: "antes", lat: -27.21, lng: -48.6, mime: "image/png" },
      2,
      2,
    ),
    make(cached, "iniciar", { lat: -27.21, lng: -48.6 }, 3, 3),
    make(cached, "material", { material_id: "material-1", quantity: 2 }, 4, 4),
    make(
      cached,
      "anexo",
      { stage: "depois", lat: -27.21, lng: -48.6, mime: "image/png" },
      5,
      5,
    ),
    make(cached, "concluir", { notes: "Reparo feito sem sinal." }, 6, 6),
    make(other, "assumir", {}, 1, 7),
  ];
  // Local validation accepts the whole chain on the projected order.
  const catalogsFromBoot = (
    await call("/bootstrap", "GET", undefined, operator)
  ).data.catalogs;
  assert.ok(
    catalogsFromBoot.some((c) => c.kind === "categorias" && c.require_before),
  );
  for (const [index, action] of queue.slice(0, 6).entries())
    assert.equal(
      validateAction(
        projectOrder(cached, queue.slice(0, index)),
        action.kind,
        action.body,
        catalogsFromBoot,
      ),
      null,
      action.kind,
    );
  assert.equal(
    validateAction(cached, "iniciar", { lat: 1, lng: 1 }, catalogsFromBoot)
      .code,
    "BEFORE_PHOTO_REQUIRED",
  );
  // The manager moves the second order to another team while the operator is offline.
  const reassigned = await call(
    `/ordens-servico/${other.id}/programacao`,
    "POST",
    {
      version: other.version,
      team_id: "team-2",
      responsible: "Outra equipe",
      scheduled_at: "2026-10-12",
    },
  );
  assert.equal(reassigned.status, 200);
  const mem = memory(queue);
  let lost = 0;
  const result = await flushQueue({
    ...mem,
    send: async (i) => {
      const response = await transport(i);
      // The response of the "depois" photo and of iniciar is lost: same request_id is sent again.
      if (
        (i.kind === "iniciar" ||
          (i.kind === "anexo" && i.body.stage === "depois")) &&
        i.attempts === 0
      ) {
        lost++;
        throw new Error("Failed to fetch");
      }
      return response;
    },
  });
  assert.equal(result.stop, "network");
  assert.equal(lost, 1);
  // Reconnect: the remaining items go out; the lost one is replayed without duplicating.
  let final = result;
  for (let round = 0; round < 3 && final.stop; round++)
    final = await flushQueue({
      ...mem,
      send: async (i) => {
        const response = await transport(i);
        if (i.kind === "anexo" && i.body.stage === "depois" && i.attempts === 0)
          throw new Error("Failed to fetch");
        return response;
      },
    });
  assert.equal(final.stop, null);
  assert.equal(final.rejected, 1);
  const left = [...mem.store.values()];
  assert.equal(left.length, 1);
  assert.equal(left[0].order_id, other.id);
  assert.equal(left[0].error.code, "ORDER_NOT_ACCESSIBLE");

  const done = (
    await call(`/ordens-servico/${cached.id}`, "GET", undefined, operator)
  ).data;
  assert.equal(done.status, "AGUARDANDO_VALIDACAO");
  assert.equal(done.started_at, queue[2].captured_at);
  assert.equal(done.finished_at, queue[5].captured_at);
  assert.equal(done.assumed_by, operatorId);
  assert.equal(done.completion_notes, "Reparo feito sem sinal.");
  assert.deepEqual(
    done.evidence.map((e) => [e.stage, e.captured_at]),
    [
      ["antes", queue[1].captured_at],
      ["depois", queue[4].captured_at],
    ],
  );
  assert.equal(done.materials.length, 1);
  const transitions = (
    await db.all(
      "SELECT event FROM audit_logs WHERE entity_type='order' AND entity_id=? AND event LIKE '%→%'",
      [cached.id],
    )
  ).map((r) => r.event.split(":")[0]);
  assert.deepEqual(transitions.sort(), ["assumir", "concluir", "iniciar"]);
});
