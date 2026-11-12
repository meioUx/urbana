// Portal do cidadão (R6): public registration and tracking under /api/publico, without a session.
// Covers: disabled → 404 everywhere (setting and URBANA_PUBLIC_PORTAL kill switch); a valid demand
// becomes an occurrence to triage with the portal origin, consent and system-actor audit; validation;
// idempotent resend; photo upload; anti-robot traps; per-address limits, the portal-wide cap and
// TRUST_PROXY with a controllable clock; tracking with right/wrong code and unknown number
// (indistinguishable); the public answer never carries internal or personal data; no authenticated
// route becomes reachable through the new prefix; same origin still required for public mutations.
import { rawFetch } from "./support/same-origin-fetch.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import {
  PORTAL_ACTOR,
  PORTAL_ORIGIN,
  publicTracking,
  PUBLIC_REASONS,
  CANCELLED_TEXT,
  DEFAULT_REFUSAL_TEXT,
  newTrackingCode,
  TRACKING_ALPHABET,
} from "../server/modules/portal/index.js";

const temp = mkdtempSync(join(tmpdir(), "urbana-portal-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "false";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
delete process.env.URBANA_PUBLIC_PORTAL;
delete process.env.TRUST_PROXY;

let db, app, server, base, admin, executor;
let clock = Date.parse("2026-11-12T12:00:00.000Z");
const portalClock = () => clock;
const advance = (ms) => (clock += ms);
const HOUR = 3600 * 1000;
const NOT_FOUND = { error: "Rota não encontrada." };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV6kAAAAASUVORK5CYII=",
  "base64",
);

const call = async (
  path,
  { method = "GET", body, cookie, headers = {} } = {},
) => {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body && !(body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...headers,
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: r.status, data, text, headers: r.headers };
};
const login = async (email) => {
  const r = await call("/api/auth/login", {
    method: "POST",
    body: { email, password: "Testing@2026" },
  });
  assert.equal(r.status, 200, email);
  return r.headers.get("set-cookie").split(";")[0];
};
const generous = {
  create_per_ip_hour: 100,
  track_per_ip_15min: 500,
  global_per_hour: 10000,
  min_fill_seconds: 5,
};
const configure = async (changes) => {
  const current = (await call("/api/settings/portal", { cookie: admin })).data;
  const body = {
    enabled: current.enabled,
    consent_text: current.consent_text,
    create_per_ip_hour: current.create_per_ip_hour,
    track_per_ip_15min: current.track_per_ip_15min,
    global_per_hour: current.global_per_hour,
    min_fill_seconds: current.min_fill_seconds,
    ...changes,
  };
  const r = await call("/api/settings/portal", {
    method: "PATCH",
    body,
    cookie: admin,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
// A fresh window for every limit (fixed windows of at most one hour).
const freshWindows = () => advance(2 * HOUR);
const token = async () => {
  const r = await call("/api/publico/catalogo");
  assert.equal(r.status, 200);
  advance(10_000); // a person takes longer than min_fill_seconds to fill the form
  return r.data.form_token;
};
const citizen = {
  category_id: "category-1",
  subcategory: "Buraco",
  description: "Buraco grande na pista em frente à escola municipal.",
  address: "Rua das Flores, 120",
  neighborhood: "Jardim Primavera",
  reference: "Em frente à padaria do Seu Zé",
  lat: "-27.5012",
  lng: "-48.6011",
  location_source: "gps",
  name: "Maria Cidadã da Silva",
  phone: "(47) 99999-1234",
};
const form = async (fields = {}, { file, formToken } = {}) => {
  const values = {
    form_token: formToken ?? (await token()),
    consent: "true",
    website: "",
    ...citizen,
    ...fields,
  };
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    if (v !== undefined) f.append(k, v);
  if (file)
    f.append(
      "photo",
      new Blob([file.content], { type: file.type }),
      file.name || "foto.png",
    );
  return f;
};
const submit = async (fields, options = {}) =>
  call("/api/publico/demandas", {
    method: "POST",
    body: await form(fields, options),
    headers: options.headers,
  });
const track = (protocol, code, headers) =>
  call("/api/publico/acompanhar", {
    method: "POST",
    body: { protocol, code },
    headers,
  });
const occurrenceByCode = async (code) => {
  const row = await db.get("SELECT * FROM occurrences WHERE code=?", [code]);
  return row ? { ...JSON.parse(row.data), ...row } : null;
};
const versioned = async (path, body, cookie = admin) => {
  const kind = path.match(/^\/api\/(ocorrencias|ordens-servico)\/([^/]+)/);
  const current = (await call(`/api/${kind[1]}/${kind[2]}`, { cookie: admin }))
    .data;
  return call(path, {
    method: "POST",
    body: { ...body, version: current.version },
    cookie,
  });
};
const attach = async (orderId, stage) => {
  const f = new FormData();
  f.append("file", new Blob([PNG], { type: "image/png" }), "p.png");
  f.append("stage", stage);
  f.append("lat", "-27.5");
  f.append("lng", "-48.6");
  return call(`/api/ordens-servico/${orderId}/anexos`, {
    method: "POST",
    body: f,
    cookie: executor,
  });
};

before(async () => {
  db = await openDatabase();
  await seed(db);
  app = createApp(db, { portalClock });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login("admin@urbana.local");
  assert.equal(
    (
      await call("/api/users", {
        method: "POST",
        cookie: admin,
        body: {
          name: "Executor Campo",
          email: "executor-portal@test.local",
          password: "Testing@2026",
          role: "Equipe de Campo",
          team_id: "team-1",
        },
      })
    ).status,
    200,
  );
  executor = await login("executor-portal@test.local");
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(temp, { recursive: true, force: true });
});

test("disabled by default: every public path answers 404 like an unknown route", async () => {
  const settings = (await call("/api/settings/portal", { cookie: admin })).data;
  assert.equal(settings.enabled, false);
  assert.equal(settings.forced_off, false);
  for (const [path, method, body] of [
    ["/api/publico/catalogo", "GET"],
    ["/api/publico/demandas", "POST", { description: "x" }],
    [
      "/api/publico/acompanhar",
      "POST",
      { protocol: "OC-2026-00001", code: "AAAA" },
    ],
    ["/api/publico/qualquer", "GET"],
    ["/api/publico", "GET"],
  ]) {
    const r = await call(path, { method, body });
    assert.equal(r.status, 404, path);
    assert.deepEqual(r.data, NOT_FOUND, path);
  }
  // Nothing was counted or registered while disabled.
  assert.equal(
    Number((await db.get("SELECT COUNT(*) AS n FROM portal_rate_limits")).n),
    0,
  );
  assert.equal(
    Number((await db.get("SELECT COUNT(*) AS n FROM portal_tracking")).n),
    0,
  );
});

test("administration: only admins read/change the portal settings; changes are validated and audited", async () => {
  const reader = await (async () => {
    await call("/api/users", {
      method: "POST",
      cookie: admin,
      body: {
        name: "Leitor",
        email: "leitor-portal@test.local",
        password: "Testing@2026",
        role: "Consulta",
      },
    });
    return login("leitor-portal@test.local");
  })();
  assert.equal(
    (await call("/api/settings/portal", { cookie: reader })).status,
    403,
  );
  assert.equal(
    (
      await call("/api/settings/portal", {
        method: "PATCH",
        cookie: reader,
        body: { enabled: true },
      })
    ).status,
    403,
  );
  assert.equal((await call("/api/settings/portal")).status, 401);
  const bad = await call("/api/settings/portal", {
    method: "PATCH",
    cookie: admin,
    body: {
      enabled: true,
      consent_text: "curto",
      create_per_ip_hour: 0,
      track_per_ip_15min: 30,
      global_per_hour: 30,
      min_fill_seconds: 5,
    },
  });
  assert.equal(bad.status, 400);
  const saved = await configure({ enabled: true, ...generous });
  assert.equal(saved.enabled, true);
  const audit = await db.get(
    "SELECT * FROM audit_logs WHERE entity_type='settings' AND entity_id='portal' ORDER BY created_at DESC",
  );
  assert.equal(audit.event, "Configurações do portal do cidadão atualizadas");
  assert.equal(JSON.parse(audit.after_value).enabled, true);
  // The general settings and the bootstrap stay as they were (the portal lives in its own row).
  const boot = (await call("/api/bootstrap", { cookie: admin })).data;
  assert.equal(boot.settings.portal, undefined);
  assert.equal(boot.settings.enabled, undefined);
});

test("URBANA_PUBLIC_PORTAL=off wins over the setting", async () => {
  process.env.URBANA_PUBLIC_PORTAL = "off";
  try {
    assert.deepEqual((await call("/api/publico/catalogo")).data, NOT_FOUND);
    assert.equal((await call("/api/publico/catalogo")).status, 404);
    assert.equal(
      (await call("/api/settings/portal", { cookie: admin })).data.forced_off,
      true,
    );
  } finally {
    delete process.env.URBANA_PUBLIC_PORTAL;
  }
  assert.equal((await call("/api/publico/catalogo")).status, 200);
});

test("public catalog exposes only category ids, names and subcategories", async () => {
  const r = await call("/api/publico/catalogo");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data).sort(), [
    "categories",
    "consent_text",
    "form_token",
    "municipality",
    "photo_max_bytes",
  ]);
  assert.ok(r.data.categories.length > 0);
  for (const c of r.data.categories)
    assert.deepEqual(Object.keys(c).sort(), ["id", "name", "subcategories"]);
  assert.match(r.data.consent_text, /Lei Geral de Proteção de Dados/);
  for (const internal of [
    "sector-1",
    "team-1",
    "Equipe 01",
    "Ana Martins",
    "admin@urbana.local",
    "sla",
    "Manutenção Viária",
  ])
    assert.ok(!r.text.includes(internal), internal);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("a valid demand becomes an occurrence to triage with the portal origin, consent, system audit and a one-time code", async () => {
  freshWindows();
  const r = await submit({
    request_id: "6f0f6c0e-1c3e-4e55-9a55-2f6f2b5a0001",
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data).sort(), ["protocol", "tracking_code"]);
  assert.match(r.data.protocol, /^OC-\d{4}-\d{5}$/);
  assert.match(
    r.data.tracking_code,
    new RegExp(`^[${TRACKING_ALPHABET}]{4}(-[${TRACKING_ALPHABET}]{4}){3}$`),
  );
  const o = await occurrenceByCode(r.data.protocol);
  assert.equal(o.status, "IDENTIFICADA");
  assert.equal(o.origin, PORTAL_ORIGIN);
  assert.equal(o.priority, "Média");
  assert.equal(
    o.sector_id,
    "sector-1",
    "sector comes from the category, never from the citizen",
  );
  assert.equal(o.creator_id, PORTAL_ACTOR.id);
  assert.equal(o.requested_by, citizen.name);
  assert.equal(o.phone, citizen.phone);
  assert.equal(o.public_portal.location_source, "gps");
  assert.ok(o.public_portal.consent_at);
  assert.match(o.public_portal.consent_version, /^[0-9a-f]{16}$/);
  // No client address and no request id/code in clear on the record.
  for (const secret of [
    "127.0.0.1",
    "::ffff",
    r.data.tracking_code,
    r.data.tracking_code.replace(/-/g, ""),
    "6f0f6c0e-1c3e-4e55-9a55-2f6f2b5a0001",
  ])
    assert.ok(!o.data.includes(secret), secret);
  const stored = await db.get(
    "SELECT * FROM portal_tracking WHERE occurrence_id=?",
    [o.id],
  );
  assert.match(stored.tracking_hash, /^[0-9a-f]{64}$/);
  assert.ok(
    !JSON.stringify(stored).includes(r.data.tracking_code.replace(/-/g, "")),
  );
  // Audit by the system actor; the internal detail shows the history with its name.
  const detail = (await call(`/api/ocorrencias/${o.id}`, { cookie: admin }))
    .data;
  const event = detail.history.find(
    (h) => h.event === "Ocorrência registrada pelo portal do cidadão",
  );
  assert.equal(event.user_id, PORTAL_ACTOR.id);
  assert.equal(event.user_name, PORTAL_ACTOR.name);
  // It enters the normal triage queue.
  const queue = (
    await call("/api/ocorrencias?status=IDENTIFICADA&pageSize=100", {
      cookie: admin,
    })
  ).data;
  const rows = Array.isArray(queue)
    ? queue
    : queue.items || queue.rows || queue.data;
  assert.ok(rows.some((row) => row.id === o.id));
});

test("the system actor cannot sign in, is hidden from the user list and cannot be edited", async () => {
  const u = await db.get("SELECT * FROM users WHERE id=?", [PORTAL_ACTOR.id]);
  assert.equal(u.role, "Sistema");
  for (const password of ["", "!sistema-sem-login", "Testing@2026", u.password])
    assert.equal(
      (
        await call("/api/auth/login", {
          method: "POST",
          body: { email: PORTAL_ACTOR.email, password: password || "x" },
        })
      ).status,
      401,
    );
  const users = (await call("/api/users", { cookie: admin })).data;
  assert.ok(!users.some((x) => x.id === PORTAL_ACTOR.id));
  assert.equal(
    (await call(`/api/users/${PORTAL_ACTOR.id}/permissions`, { cookie: admin }))
      .status,
    404,
  );
  assert.equal(
    (
      await call(`/api/users/${PORTAL_ACTOR.id}`, {
        method: "PATCH",
        cookie: admin,
        body: {
          name: "X",
          email: "x@x.local",
          role: "Administrador",
          team_id: null,
          modules: ["admin"],
        },
      })
    ).status,
    404,
  );
});

test("validation: required fields, limits, category, consent and coordinates", async () => {
  freshWindows();
  const cases = [
    [{ description: "curto" }, "description"],
    [{ description: "x".repeat(2001) }, "description"],
    [{ address: "" }, "address"],
    [{ neighborhood: "   " }, "neighborhood"],
    [{ lat: "" }, "lat"],
    [{ lat: "91" }, "lat"],
    [{ lng: "abc" }, "lng"],
    [{ phone: "ligue-me <script>" }, "phone"],
    [{ name: "n".repeat(201) }, "name"],
    [{ location_source: "satelite" }, "location_source"],
    [{ request_id: "nao-e-uuid" }, "request_id"],
  ];
  for (const [fields, key] of cases) {
    const r = await submit(fields);
    assert.equal(r.status, 400, key);
    assert.ok(r.data.details.fieldErrors[key]?.length, key);
    assert.match(r.data.details.fieldErrors[key][0], /[a-zà-ú]/i);
  }
  const category = await submit({ subcategory: "Inexistente" });
  assert.equal(category.status, 400);
  assert.equal(category.data.code, "INVALID_CATEGORY");
  assert.equal(
    (await submit({ category_id: "sector-1" })).data.code,
    "INVALID_CATEGORY",
    "an internal sector id is not a category",
  );
  const consent = await submit({ consent: "false" });
  assert.equal(consent.status, 400);
  assert.equal(consent.data.code, "CONSENT_REQUIRED");
  // Optional fields really are optional.
  const minimal = await submit({
    name: undefined,
    phone: undefined,
    reference: undefined,
    location_source: undefined,
  });
  assert.equal(minimal.status, 201);
  const o = await occurrenceByCode(minimal.data.protocol);
  assert.equal(o.requested_by, "");
  assert.equal(o.phone, "");
  assert.equal(o.public_portal.location_source, "mapa");
});

test("anti-robot traps: honeypot, minimum filling time and forged or expired token", async () => {
  freshWindows();
  const before = Number(
    (await db.get("SELECT COUNT(*) AS n FROM occurrences")).n,
  );
  const honeypot = await submit({ website: "http://spam.example" });
  assert.equal(honeypot.status, 400);
  assert.equal(honeypot.data.code, "SUBMISSION_REJECTED");
  const fast = await call("/api/publico/catalogo");
  advance(1000);
  const tooFast = await submit({}, { formToken: fast.data.form_token });
  assert.equal(tooFast.data.code, "SUBMISSION_REJECTED");
  const [issued] = fast.data.form_token.split(".");
  assert.equal(
    (await submit({}, { formToken: `${issued}.${"0".repeat(32)}` })).data.code,
    "SUBMISSION_REJECTED",
  );
  assert.equal(
    (await submit({}, { formToken: "" })).data.code,
    "SUBMISSION_REJECTED",
  );
  advance(25 * HOUR);
  assert.equal(
    (await submit({}, { formToken: fast.data.form_token })).data.code,
    "SUBMISSION_REJECTED",
    "expired",
  );
  assert.equal(
    Number((await db.get("SELECT COUNT(*) AS n FROM occurrences")).n),
    before,
  );
});

test("idempotent resend: same request_id → same protocol, a new code, and the old code stops working", async () => {
  freshWindows();
  const request_id = "6f0f6c0e-1c3e-4e55-9a55-2f6f2b5a0002";
  const first = await submit({ request_id });
  assert.equal(first.status, 201);
  const count = Number(
    (await db.get("SELECT COUNT(*) AS n FROM occurrences")).n,
  );
  const again = await submit({
    request_id,
    description: "Outro texto qualquer, com mais de dez letras.",
  });
  assert.equal(again.status, 200);
  assert.equal(again.data.protocol, first.data.protocol);
  assert.equal(again.data.replayed, true);
  assert.notEqual(again.data.tracking_code, first.data.tracking_code);
  assert.equal(
    Number((await db.get("SELECT COUNT(*) AS n FROM occurrences")).n),
    count,
  );
  assert.equal(
    (await track(first.data.protocol, first.data.tracking_code)).status,
    404,
  );
  assert.equal(
    (await track(again.data.protocol, again.data.tracking_code)).status,
    200,
  );
  // After 24 h the key is no longer a resend.
  advance(25 * HOUR);
  const late = await submit({ request_id });
  assert.equal(late.status, 409);
  assert.equal(late.data.code, "REQUEST_ID_REUSED");
});

test("photo upload: valid image becomes registration evidence; type, signature and size are enforced", async () => {
  freshWindows();
  const ok = await submit({}, { file: { content: PNG, type: "image/png" } });
  assert.equal(ok.status, 201);
  const o = await occurrenceByCode(ok.data.protocol);
  const evidence = await db.all(
    "SELECT * FROM evidence WHERE entity_type='occurrence' AND entity_id=?",
    [o.id],
  );
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].stage, "registro");
  assert.equal(evidence[0].user_id, PORTAL_ACTOR.id);
  assert.equal(
    evidence[0].original_name,
    "foto-portal.png",
    "the citizen's file name is not kept",
  );
  assert.ok(existsSync(join(temp, "uploads", evidence[0].filename)));
  const files = readdirSync(join(temp, "uploads")).length;
  const forged = await submit(
    {},
    {
      file: {
        content: Buffer.from("<script>alert(1)</script>"),
        type: "image/png",
      },
    },
  );
  assert.equal(forged.status, 400);
  assert.equal(forged.data.code, "INVALID_FILE");
  const pdf = await submit(
    {},
    {
      file: {
        content: Buffer.from("%PDF-1.4"),
        type: "application/pdf",
        name: "a.pdf",
      },
    },
  );
  assert.equal(pdf.status, 400);
  assert.equal(pdf.data.code, "INVALID_FILE");
  const big = Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]);
  const large = await submit({}, { file: { content: big, type: "image/png" } });
  assert.equal(large.status, 413);
  assert.equal(large.data.code, "FILE_TOO_LARGE");
  assert.equal(
    readdirSync(join(temp, "uploads")).length,
    files,
    "nothing left behind",
  );
  // Oversized JSON body on the tracking route.
  const huge = await call("/api/publico/acompanhar", {
    method: "POST",
    body: { protocol: "x".repeat(9000), code: "y" },
  });
  assert.equal(huge.status, 413);
});

test("antimalware: infected photo is refused with 422 and nothing is registered", async () => {
  const scanned = createApp(db, {
    portalClock,
    scanner: {
      enabled: true,
      failMode: "closed",
      scan: async () => ({ status: "infected", signature: "Eicar-Test" }),
    },
  });
  const s = scanned.listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  try {
    freshWindows();
    const url = `http://127.0.0.1:${s.address().port}`;
    const t = (await (await fetch(url + "/api/publico/catalogo")).json())
      .form_token;
    advance(10_000);
    const before = Number(
      (await db.get("SELECT COUNT(*) AS n FROM occurrences")).n,
    );
    const f = await form(
      {},
      { formToken: t, file: { content: PNG, type: "image/png" } },
    );
    const r = await fetch(url + "/api/publico/demandas", {
      method: "POST",
      body: f,
    });
    assert.equal(r.status, 422);
    assert.equal((await r.json()).code, "MALWARE_DETECTED");
    assert.equal(
      Number((await db.get("SELECT COUNT(*) AS n FROM occurrences")).n),
      before,
    );
  } finally {
    await new Promise((r) => s.close(r));
  }
});

test("duplicates are not exposed: a demand next to an active occurrence is registered and flagged for triage", async () => {
  freshWindows();
  const first = await submit({ lat: "-27.6100", lng: "-48.6100" });
  const second = await submit({ lat: "-27.6100", lng: "-48.6100" });
  assert.equal(second.status, 201);
  assert.deepEqual(Object.keys(second.data).sort(), [
    "protocol",
    "tracking_code",
  ]);
  assert.ok(!second.text.includes(first.data.protocol));
  const o = await occurrenceByCode(second.data.protocol);
  assert.deepEqual(o.public_portal.possible_duplicates, [first.data.protocol]);
});

test("limits: per address for creation and tracking, portal-wide hourly cap, Retry-After and window reset", async () => {
  freshWindows();
  await configure({
    create_per_ip_hour: 3,
    track_per_ip_15min: 5,
    global_per_hour: 10000,
  });
  // Creation: every attempt counts (also invalid ones).
  assert.equal((await submit({ description: "curto" })).status, 400);
  assert.equal((await submit()).status, 201);
  assert.equal((await submit()).status, 201);
  const limited = await submit();
  assert.equal(limited.status, 429);
  assert.equal(limited.data.code, "RATE_LIMITED");
  const retry = Number(limited.headers.get("retry-after"));
  assert.ok(retry > 0 && retry <= 3600, String(retry));
  // Tracking: right or wrong, every lookup counts.
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await track("OC-2026-99999", "AAAA-BBBB-CCCC-DDDD")).status,
      404,
    );
  const blocked = await track("OC-2026-99999", "AAAA-BBBB-CCCC-DDDD");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) <= 900);
  advance(16 * 60 * 1000);
  assert.equal(
    (await track("OC-2026-99999", "AAAA-BBBB-CCCC-DDDD")).status,
    404,
    "tracking window reset",
  );
  advance(HOUR);
  assert.equal((await submit()).status, 201, "creation window reset");
  // Portal-wide cap: counts accepted demands only, whatever the address.
  freshWindows();
  await configure({ ...generous, global_per_hour: 2 });
  assert.equal((await submit()).status, 201);
  assert.equal((await submit({ description: "curto" })).status, 400);
  assert.equal((await submit()).status, 201);
  const busy = await submit();
  assert.equal(busy.status, 429);
  assert.equal(busy.data.code, "PORTAL_BUSY");
  assert.ok(Number(busy.headers.get("retry-after")) > 0);
  freshWindows();
  assert.equal((await submit()).status, 201);
  await configure(generous);
  // Addresses are stored only hashed, and always with expiry.
  for (const row of await db.all("SELECT * FROM portal_rate_limits")) {
    assert.ok(!row.bucket.includes("127.0.0.1"));
    assert.ok(row.expires_at);
  }
});

test("TRUST_PROXY: X-Forwarded-For identifies the client only when the proxy is trusted", async () => {
  freshWindows();
  await configure({ track_per_ip_15min: 5 });
  const forwarded = (ip) => ({ "x-forwarded-for": ip });
  // Untrusted (default): the header is ignored, so changing it does not escape the limit.
  for (let i = 0; i < 5; i++)
    await track("OC-2026-99999", "X", forwarded(`198.51.100.${i}`));
  assert.equal(
    (await track("OC-2026-99999", "X", forwarded("198.51.100.200"))).status,
    429,
  );
  process.env.TRUST_PROXY = "1";
  const proxied = createApp(db, { portalClock });
  delete process.env.TRUST_PROXY;
  const s = proxied.listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  try {
    freshWindows();
    const url = `http://127.0.0.1:${s.address().port}/api/publico/acompanhar`;
    const lookup = (ip) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...forwarded(ip) },
        body: JSON.stringify({ protocol: "OC-2026-99999", code: "X" }),
      });
    for (let i = 0; i < 5; i++)
      assert.equal((await lookup("203.0.113.1")).status, 404);
    assert.equal((await lookup("203.0.113.1")).status, 429);
    assert.equal(
      (await lookup("203.0.113.2")).status,
      404,
      "another client behind the proxy has its own counter",
    );
  } finally {
    await new Promise((r) => s.close(r));
  }
  await configure(generous);
});

test("tracking: right code shows the public view; wrong code and unknown number are indistinguishable", async () => {
  freshWindows();
  const created = await submit();
  const right = await track(
    created.data.protocol,
    created.data.tracking_code.toLowerCase().replace(/-/g, " "),
  );
  assert.equal(right.status, 200, "case, spaces and dashes are ignored");
  assert.equal(right.data.protocol, created.data.protocol);
  assert.equal(right.data.status.code, "recebida");
  assert.equal(right.data.category, "Pavimentação");
  assert.equal(right.data.neighborhood, citizen.neighborhood);
  const wrong = await track(created.data.protocol, newTrackingCode());
  const unknown = await track("OC-2099-99999", created.data.tracking_code);
  const internal = await db.get(
    "SELECT code FROM occurrences WHERE data NOT LIKE '%public_portal%' LIMIT 1",
  );
  const notPortal = internal
    ? await track(internal.code, created.data.tracking_code)
    : wrong;
  const empty = await call("/api/publico/acompanhar", {
    method: "POST",
    body: {},
  });
  for (const r of [wrong, unknown, notPortal, empty]) {
    assert.equal(r.status, 404);
    assert.equal(r.text, wrong.text);
    assert.deepEqual(
      [...r.headers.keys()]
        .filter(
          (k) =>
            !["date", "x-request-id", "content-length", "etag"].includes(k),
        )
        .sort(),
      [...wrong.headers.keys()]
        .filter(
          (k) =>
            !["date", "x-request-id", "content-length", "etag"].includes(k),
        )
        .sort(),
    );
  }
  assert.equal(wrong.data.code, "TRACKING_NOT_FOUND");
  // Comparable time: medians of wrong-code and unknown-number lookups.
  const median = async (fn) => {
    const times = [];
    for (let i = 0; i < 25; i++) {
      const start = process.hrtime.bigint();
      await fn();
      times.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    return times.sort((a, b) => a - b)[12];
  };
  const a = await median(() =>
    track(created.data.protocol, "ZZZZ-ZZZZ-ZZZZ-ZZZZ"),
  );
  const b = await median(() => track("OC-2099-99999", "ZZZZ-ZZZZ-ZZZZ-ZZZZ"));
  assert.ok(
    Math.abs(a - b) < 15,
    `medians ${a.toFixed(2)} ms vs ${b.toFixed(2)} ms`,
  );
});

// Keys and values that must never appear in a public answer.
const FORBIDDEN_KEYS = new Set([
  "id",
  "requested_by",
  "name",
  "phone",
  "description",
  "address",
  "reference",
  "lat",
  "lng",
  "data",
  "team",
  "team_id",
  "team_name",
  "user",
  "user_id",
  "user_name",
  "assigned_user_id",
  "responsible",
  "rejection_reason",
  "rejected_by",
  "notes",
  "completion_notes",
  "evidence",
  "photo",
  "photos",
  "history",
  "orders",
  "sector_id",
  "creator_id",
  "public_portal",
  "priority",
  "possible_duplicates",
  "consent_at",
  "tracking_hash",
  "portal_tracking_hash",
  "request_hash",
  "before_value",
  "after_value",
  "event",
]);
const keysOf = (value, out = []) => {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) (out.push(k), keysOf(v, out));
  return out;
};
const assertPublicSafe = (response, sensitive) => {
  const leaked = keysOf(response.data).filter((k) => FORBIDDEN_KEYS.has(k));
  assert.deepEqual(leaked, [], `forbidden keys: ${leaked}`);
  for (const value of sensitive)
    assert.ok(!response.text.includes(value), `value leaked: ${value}`);
};

test("public view follows triage, scheduling, execution and validation and never leaks internal or personal data", async () => {
  freshWindows();
  const created = await submit(
    {},
    { file: { content: PNG, type: "image/png" } },
  );
  const o = await occurrenceByCode(created.data.protocol);
  const look = () => track(created.data.protocol, created.data.tracking_code);
  const sensitive = [
    citizen.name,
    citizen.phone,
    citizen.description,
    citizen.address,
    citizen.reference,
    "-27.5012",
    "-48.6011",
    o.id,
    "Ana Martins",
    "Executor Campo",
    "Equipe 01",
    "sector-1",
    "team-1",
    "Manutenção Viária",
    "anexos",
    "uploads",
    "Responsável interno",
  ];
  let r = await look();
  assert.equal(r.data.status.code, "recebida");
  assert.deepEqual(
    r.data.steps.map((s) => [s.code, s.done, s.current]),
    [
      ["recebida", true, true],
      ["em_analise", false, false],
      ["programada", false, false],
      ["em_execucao", false, false],
      ["concluida", false, false],
    ],
  );
  assertPublicSafe(r, sensitive);

  assert.equal(
    (
      await versioned(`/api/ocorrencias/${o.id}/classificar`, {
        category_id: "category-1",
        subcategory: "Buraco",
        priority: "Alta",
        sector_id: "sector-1",
      })
    ).status,
    200,
  );
  r = await look();
  assert.equal(r.data.status.code, "em_analise");
  assert.ok(r.data.steps[1].at);
  assertPublicSafe(r, sensitive);

  const order = await call("/api/ordens-servico", {
    method: "POST",
    cookie: admin,
    body: {
      occurrence_ids: [o.id],
      team_id: "team-1",
      scheduled_at: "2026-11-20",
      responsible: "Responsável interno",
    },
  });
  assert.equal(order.status, 200, JSON.stringify(order.data));
  r = await look();
  assert.equal(r.data.status.code, "programada");
  assertPublicSafe(r, [...sensitive, order.data.code, order.data.id]);

  const orderPath = `/api/ordens-servico/${order.data.id}`;
  assert.equal((await attach(order.data.id, "antes")).status, 200);
  assert.equal(
    (await versioned(orderPath + "/assumir", {}, executor)).status,
    200,
  );
  assert.equal(
    (
      await versioned(
        orderPath + "/iniciar",
        { lat: -27.5, lng: -48.6 },
        executor,
      )
    ).status,
    200,
  );
  r = await look();
  assert.equal(r.data.status.code, "em_execucao");
  assertPublicSafe(r, [...sensitive, order.data.code]);

  assert.equal(
    (
      await versioned(
        orderPath + "/material",
        { material_id: "material-1", quantity: 2 },
        executor,
      )
    ).status,
    200,
  );
  assert.equal((await attach(order.data.id, "depois")).status, 200);
  assert.equal(
    (
      await versioned(
        orderPath + "/concluir",
        { notes: "Nota interna da equipe: buraco tapado" },
        executor,
      )
    ).status,
    200,
  );
  r = await look();
  assert.equal(
    r.data.status.code,
    "em_execucao",
    "waiting for validation is still 'em execução' for the citizen",
  );
  assert.equal((await versioned(orderPath + "/validar", {})).status, 200);
  r = await look();
  assert.equal(r.data.status.code, "concluida");
  assert.ok(
    r.data.steps.every((s) => s.done && s.at),
    JSON.stringify(r.data.steps),
  );
  assertPublicSafe(r, [
    ...sensitive,
    order.data.code,
    "Nota interna da equipe",
  ]);
  assert.equal(r.data.reason, null);
});

test("refusal: the internal free-text reason stays internal; the public text is fixed (optional public_reason)", async () => {
  freshWindows();
  const plain = await submit();
  const coded = await submit();
  const internalReason =
    "Motivo interno: morador já reclamou 5 vezes, vereador pediu";
  const a = await occurrenceByCode(plain.data.protocol);
  const b = await occurrenceByCode(coded.data.protocol);
  assert.equal(
    (
      await versioned(`/api/ocorrencias/${b.id}/recusar`, {
        reason: "x",
        public_reason: "inventado",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await versioned(`/api/ocorrencias/${a.id}/recusar`, {
        reason: internalReason,
      })
    ).status,
    200,
  );
  const refused = await versioned(`/api/ocorrencias/${b.id}/recusar`, {
    reason: internalReason,
    public_reason: "fora_competencia",
  });
  assert.equal(refused.status, 200);
  assert.equal(refused.data.public_reason, "fora_competencia");
  const ra = await track(plain.data.protocol, plain.data.tracking_code);
  const rb = await track(coded.data.protocol, coded.data.tracking_code);
  assert.equal(ra.data.status.code, "nao_atendida");
  assert.equal(ra.data.reason, DEFAULT_REFUSAL_TEXT);
  assert.equal(rb.data.reason, PUBLIC_REASONS.fora_competencia);
  for (const r of [ra, rb])
    assertPublicSafe(r, [
      internalReason,
      "Ana Martins",
      citizen.name,
      citizen.phone,
    ]);
  // Internal refusals without public_reason keep their previous answer shape.
  const internal = await call("/api/ocorrencias", {
    method: "POST",
    cookie: admin,
    body: {
      category_id: "category-1",
      subcategory: "Buraco",
      description: "Interna",
      origin: "Fiscalização municipal",
      priority: "Alta",
      lat: -28.9,
      lng: -48.1,
      address: "Rua X",
      neighborhood: "Centro",
    },
  });
  const refusedInternal = await versioned(
    `/api/ocorrencias/${internal.data.id}/recusar`,
    { reason: "Sem motivo público" },
  );
  assert.equal(refusedInternal.status, 200);
  assert.equal("public_reason" in refusedInternal.data, false);
});

test("mapping of every internal state to the public steps", () => {
  const base = {
    code: "OC-2026-00001",
    neighborhood: "Centro",
    created_at: "2026-11-01T10:00:00.000Z",
  };
  const expected = {
    IDENTIFICADA: "recebida",
    EM_TRIAGEM: "em_analise",
    PROGRAMADA: "programada",
    DEVOLVIDA: "programada",
    EM_DESLOCAMENTO: "em_execucao",
    EM_EXECUCAO: "em_execucao",
    AGUARDANDO_VALIDACAO: "em_execucao",
    CONCLUIDA: "concluida",
    RECUSADA: "nao_atendida",
    CANCELADA: "nao_atendida",
  };
  for (const [status, stage] of Object.entries(expected))
    assert.equal(
      publicTracking({ ...base, status }, [], "Cat").status.code,
      stage,
      status,
    );
  const cancelled = publicTracking(
    { ...base, status: "CANCELADA" },
    [
      {
        event: "Status atualizado pela OS-1",
        after_value: JSON.stringify({ status: "CANCELADA" }),
        created_at: "2026-11-03T10:00:00.000Z",
      },
    ],
    "Cat",
  );
  assert.equal(cancelled.reason, CANCELLED_TEXT);
  assert.equal(cancelled.steps.at(-1).at, "2026-11-03T10:00:00.000Z");
  // A reopened service goes back to "em execução" with the latest date.
  const reopened = publicTracking(
    { ...base, status: "EM_EXECUCAO" },
    [
      {
        event: "Triagem e encaminhamento registrados",
        after_value: "{}",
        created_at: "2026-11-02T00:00:00.000Z",
      },
      {
        event: "x",
        after_value: JSON.stringify({ status: "EM_EXECUCAO" }),
        created_at: "2026-11-03T00:00:00.000Z",
      },
      {
        event: "x",
        after_value: JSON.stringify({ status: "CONCLUIDA" }),
        created_at: "2026-11-04T00:00:00.000Z",
      },
      {
        event: "x",
        after_value: JSON.stringify({ status: "EM_EXECUCAO" }),
        created_at: "2026-11-05T00:00:00.000Z",
      },
      {
        event: "x",
        after_value: "not json",
        created_at: "2026-11-06T00:00:00.000Z",
      },
    ],
    "Cat",
  );
  assert.equal(reopened.status.code, "em_execucao");
  assert.equal(
    reopened.steps.find((s) => s.code === "em_execucao").at,
    "2026-11-05T00:00:00.000Z",
  );
  assert.equal(reopened.steps.find((s) => s.code === "concluida").at, null);
  assert.equal(reopened.steps.find((s) => s.code === "concluida").done, false);
  // Tracking codes: 16 symbols of a 31-letter alphabet (≈79 bits) without ambiguous characters.
  assert.ok(Math.log2(TRACKING_ALPHABET.length) * 16 >= 64);
  for (const ambiguous of ["0", "O", "1", "I", "L"])
    assert.ok(!TRACKING_ALPHABET.includes(ambiguous));
  assert.equal(new Set(Array.from({ length: 200 }, newTrackingCode)).size, 200);
});

// Raw HTTP so the client does not normalize the path (dot segments, encoded slashes).
const raw = (path, { method = "GET", headers = {} } = {}) =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: server.address().port, path, method, headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });

test("no authenticated route becomes reachable without a session through the new prefix", async () => {
  const sample = (path) =>
    path.replace(/\{\*\w+\}/g, "x").replace(/:(\w+)/g, "zz-$1");
  const routes = [];
  for (const layer of app.router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods))
      routes.push([method.toUpperCase(), layer.route.path]);
  }
  const publicPaths = new Set([
    "/healthz",
    "/api/auth/login",
    "/api/publico/catalogo",
    "/api/publico/demandas",
    "/api/publico/acompanhar",
  ]);
  let checked = 0;
  for (const [method, path] of routes) {
    if (publicPaths.has(path)) continue;
    // 1. Without a session every other route answers 401, as before.
    const direct = await call(sample(path), {
      method,
      body: method === "GET" ? undefined : {},
    });
    assert.equal(direct.status, 401, `${method} ${path}`);
    // 2. The same path under the public prefix (and traversal attempts) never reaches it.
    const tail = sample(path).replace(/^\/api/, "");
    for (const variant of [
      `/api/publico${tail}`,
      `/api/publico/..${tail}`,
      `/api/publico/%2e%2e${tail}`,
      `/api/publico/%2F..%2F${tail.slice(1)}`,
      `/api/publico/catalogo/..${tail}`,
    ]) {
      const r = await raw(variant, {
        method,
        headers: {
          origin: base,
          "content-type": "application/json",
          "content-length": "0",
        },
      });
      assert.ok(
        [404, 401].includes(r.status),
        `${method} ${variant} → ${r.status}`,
      );
      if (r.status === 200) assert.fail(`${variant} answered 200`);
      if (
        variant.startsWith("/api/publico/") &&
        !variant.includes("..") &&
        !variant.includes("%2e")
      )
        assert.deepEqual(JSON.parse(r.body), NOT_FOUND, variant);
    }
    checked++;
  }
  assert.ok(checked > 100, `checked ${checked} routes`);
  // A session cookie does not change anything on the public prefix either.
  const withCookie = await call("/api/publico/ocorrencias", { cookie: admin });
  assert.equal(withCookie.status, 404);
  assert.deepEqual(withCookie.data, NOT_FOUND);
});

test("same origin is still required for public mutations", async () => {
  freshWindows();
  const f = await form();
  const forged = await call("/api/publico/demandas", {
    method: "POST",
    body: f,
    headers: { origin: "https://evil.example" },
  });
  assert.equal(forged.status, 403);
  assert.equal(forged.data.code, "ORIGIN_FORBIDDEN");
  const missing = await rawFetch(base + "/api/publico/demandas", {
    method: "POST",
    body: await form(),
  });
  assert.equal(missing.status, 403);
  assert.equal((await missing.json()).code, "ORIGIN_REQUIRED");
  const crossSite = await call("/api/publico/acompanhar", {
    method: "POST",
    body: { protocol: "x", code: "y" },
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(crossSite.status, 403);
  const trackMissing = await rawFetch(base + "/api/publico/acompanhar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(trackMissing.status, 403);
});

test("public pages: portal.html with 200 when enabled and 404 when disabled, before the SPA fallback", async () => {
  const { writeFileSync } = await import("node:fs");
  const { registerPortalPages } = await import("../server/routes/portal.js");
  const file = join(temp, "portal.html");
  writeFileSync(
    file,
    '<!doctype html><title>Portal</title><main id="conteudo"></main>',
  );
  const pages = createApp(db, { portalClock });
  registerPortalPages(pages, db, { file });
  pages.get("/{*path}", (req, res) => res.send("SPA"));
  const s = pages.listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  try {
    const url = `http://127.0.0.1:${s.address().port}`;
    for (const path of [
      "/portal",
      "/portal/",
      "/portal/acompanhar",
      "/portal.html",
    ]) {
      const r = await fetch(url + path);
      assert.equal(r.status, 200, path);
      assert.match(await r.text(), /id="conteudo"/);
      assert.match(
        r.headers.get("content-security-policy"),
        /script-src 'self'(;|$)/,
      );
      assert.equal(r.headers.get("x-frame-options"), "DENY");
    }
    assert.equal(await (await fetch(url + "/ocorrencias")).text(), "SPA");
    await configure({ enabled: false });
    const off = await fetch(url + "/portal/acompanhar");
    assert.equal(off.status, 404);
    assert.match(await off.text(), /id="conteudo"/);
  } finally {
    await configure({ enabled: true });
    await new Promise((r) => s.close(r));
  }
});

// Opt-in: the same public flow on PostgreSQL (upserts of the rate limits, tracking join, lazy system
// actor, migration 13 rows).
const pgUrl = process.env.URBANA_POSTGRES_TEST_URL;
test(
  "portal on PostgreSQL: migration rows, create, idempotent resend, tracking and limits",
  {
    skip:
      !pgUrl &&
      "URBANA_POSTGRES_TEST_URL ausente: homologação real não executada",
  },
  async () => {
    const { default: pg } = await import("pg");
    const { randomUUID } = await import("node:crypto");
    const schema = "urbana_portal_" + randomUUID().replaceAll("-", "");
    const pool = new pg.Pool({ connectionString: pgUrl });
    const folder = mkdtempSync(join(tmpdir(), "urbana-portal-pg-"));
    const original = {
      url: process.env.DATABASE_URL,
      dir: process.env.DATA_DIR,
    };
    let pdb, pserver;
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
      const connection = new URL(pgUrl);
      connection.searchParams.set(
        "options",
        (
          (connection.searchParams.get("options") || "") +
          " -c search_path=" +
          schema +
          ",public"
        ).trim(),
      );
      process.env.DATABASE_URL = connection.toString();
      process.env.DATA_DIR = folder;
      pdb = await openDatabase();
      await seed(pdb);
      assert.equal(pdb.dialect, "postgres");
      assert.ok(
        await pdb.get("SELECT 1 AS ok FROM settings WHERE id='portal_secret'"),
      );
      let pclock = Date.parse("2026-11-12T12:00:00.000Z");
      pserver = createApp(pdb, { portalClock: () => pclock }).listen(
        0,
        "127.0.0.1",
      );
      await new Promise((r) => pserver.once("listening", r));
      const url = `http://127.0.0.1:${pserver.address().port}`;
      const pcall = async (path, method = "GET", body, cookie) => {
        const r = await fetch(url + path, {
          method,
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(body && !(body instanceof FormData)
              ? { "content-type": "application/json" }
              : {}),
          },
          body:
            body instanceof FormData
              ? body
              : body
                ? JSON.stringify(body)
                : undefined,
        });
        return { status: r.status, data: await r.json(), headers: r.headers };
      };
      const login = await fetch(url + "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "admin@urbana.local",
          password: "Testing@2026",
        }),
      });
      const cookie = login.headers.get("set-cookie").split(";")[0];
      assert.equal((await pcall("/api/publico/catalogo")).status, 404);
      const current = (
        await pcall("/api/settings/portal", "GET", undefined, cookie)
      ).data;
      assert.equal(
        (
          await pcall(
            "/api/settings/portal",
            "PATCH",
            {
              enabled: true,
              consent_text: current.consent_text,
              create_per_ip_hour: 100,
              track_per_ip_15min: 5,
              global_per_hour: 100,
              min_fill_seconds: 5,
            },
            cookie,
          )
        ).status,
        200,
      );
      const send = async (fields = {}) => {
        const t = (await pcall("/api/publico/catalogo")).data.form_token;
        pclock += 10_000;
        const f = new FormData();
        for (const [k, v] of Object.entries({
          form_token: t,
          consent: "true",
          website: "",
          ...citizen,
          ...fields,
        }))
          f.append(k, v);
        return pcall("/api/publico/demandas", "POST", f);
      };
      const request_id = randomUUID();
      const created = await send({ request_id });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const again = await send({ request_id });
      assert.equal(again.data.protocol, created.data.protocol);
      assert.equal(again.data.replayed, true);
      const o = await pdb.get("SELECT * FROM occurrences WHERE code=?", [
        created.data.protocol,
      ]);
      assert.equal(JSON.parse(o.data).origin, PORTAL_ORIGIN);
      assert.equal(
        (
          await pdb.get(
            "SELECT user_id FROM audit_logs WHERE entity_id=? ORDER BY created_at LIMIT 1",
            [o.id],
          )
        ).user_id,
        PORTAL_ACTOR.id,
      );
      const ok = await pcall("/api/publico/acompanhar", "POST", {
        protocol: again.data.protocol,
        code: again.data.tracking_code,
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.data.status.code, "recebida");
      assert.equal(
        (
          await pcall("/api/publico/acompanhar", "POST", {
            protocol: again.data.protocol,
            code: created.data.tracking_code,
          })
        ).status,
        404,
      );
      for (let i = 0; i < 3; i++)
        assert.equal(
          (
            await pcall("/api/publico/acompanhar", "POST", {
              protocol: "OC-2099-00001",
              code: "x",
            })
          ).status,
          404,
        );
      const limited = await pcall("/api/publico/acompanhar", "POST", {
        protocol: "OC-2099-00001",
        code: "x",
      });
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get("retry-after")) > 0);
      pclock += 16 * 60 * 1000;
      assert.equal(
        (
          await pcall("/api/publico/acompanhar", "POST", {
            protocol: "OC-2099-00001",
            code: "x",
          })
        ).status,
        404,
      );
    } finally {
      if (pserver) await new Promise((r) => pserver.close(r));
      if (pdb) await pdb.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
      if (original.url === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original.url;
      process.env.DATA_DIR = original.dir;
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
