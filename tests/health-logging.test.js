import "./support/same-origin-fetch.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import { createLogger, validRequestId } from "../server/logger.js";

const temp = mkdtempSync(join(tmpdir(), "urbana-health-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "false";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;

let db, server, base;
const lines = [];
const logger = createLogger({
  level: "debug",
  format: "json",
  write: (line) => lines.push(JSON.parse(line)),
});
let broken = false;
const listen = async (app) => {
  const s = app.listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  return s;
};
const close = (s) => new Promise((r) => s.close(r));

before(async () => {
  db = await openDatabase();
  await seed(db);
  // Proxy that can simulate a failing database without closing the real one.
  const flaky = new Proxy(db, {
    get: (target, prop) =>
      ["get", "all", "run", "exec"].includes(prop) && broken
        ? async () => {
            throw new Error("falha simulada do banco: segredo-interno");
          }
        : target[prop],
  });
  server = await listen(createApp(flaky, { logger }));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await close(server);
  await db.close();
  rmSync(temp, { recursive: true, force: true });
});

test("healthz queries the database and answers ok", async () => {
  const r = await fetch(`${base}/healthz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("healthz answers 503 without internal details when the database fails", async () => {
  broken = true;
  try {
    const r = await fetch(`${base}/healthz`);
    assert.equal(r.status, 503);
    const text = await r.text();
    assert.deepEqual(JSON.parse(text), { ok: false });
    assert.ok(!text.includes("segredo-interno"));
  } finally {
    broken = false;
  }
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
});

test("healthz answers 503 with a closed SQLite database", async () => {
  const closedDir = mkdtempSync(join(tmpdir(), "urbana-health-closed-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = closedDir;
  const closedDb = await openDatabase();
  process.env.DATA_DIR = previous;
  const s = await listen(
    createApp(closedDb, { logger: createLogger({ level: "silent" }) }),
  );
  try {
    const url = `http://127.0.0.1:${s.address().port}/healthz`;
    assert.equal((await fetch(url)).status, 200);
    await closedDb.close();
    const r = await fetch(url);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { ok: false });
  } finally {
    await close(s);
    rmSync(closedDir, { recursive: true, force: true });
  }
});

test("healthz times out on a database that never answers", async () => {
  const hanging = {
    dialect: "sqlite",
    get: () => new Promise(() => {}),
    all: async () => [],
    run: async () => ({}),
    exec: async () => {},
    transaction: async (fn) => fn(),
  };
  const s = await listen(
    createApp(hanging, {
      logger: createLogger({ level: "silent" }),
      healthTimeoutMs: 50,
    }),
  );
  try {
    const started = Date.now();
    const r = await fetch(`http://127.0.0.1:${s.address().port}/healthz`);
    assert.equal(r.status, 503);
    assert.ok(Date.now() - started < 2000);
  } finally {
    await close(s);
  }
});

test("request id is generated, accepted when valid, replaced when invalid, and logged", async () => {
  lines.length = 0;
  const generated = (await fetch(`${base}/healthz`)).headers.get(
    "x-request-id",
  );
  assert.match(generated, /^[0-9a-f-]{36}$/);
  const mine = "front-end-req-12345";
  const echoed = await fetch(`${base}/api/auth/me`, {
    headers: { "X-Request-Id": mine },
  });
  assert.equal(echoed.headers.get("x-request-id"), mine);
  const replaced = (
    await fetch(`${base}/healthz`, {
      headers: { "X-Request-Id": "bad id\twith spaces" },
    })
  ).headers.get("x-request-id");
  assert.notEqual(replaced, "bad id\twith spaces");
  assert.ok(validRequestId(replaced));
  assert.equal(validRequestId("x".repeat(129)), false);
  const entry = lines.find((l) => l.requestId === mine);
  assert.equal(entry.msg, "request");
  assert.equal(entry.method, "GET");
  assert.equal(entry.route, "/api/auth/me");
  assert.equal(entry.status, 401);
  assert.equal(typeof entry.durationMs, "number");
  assert.equal(entry.level, "warn");
  // Probes are logged only at debug level.
  assert.equal(lines.find((l) => l.requestId === generated).level, "debug");
});

test("request log records the user id but never body, cookie or password", async () => {
  lines.length = 0;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@urbana.local",
      password: "Testing@2026",
    }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const cookieValue = cookie.split("=")[1];
  const me = await fetch(`${base}/api/auth/me?token=query-secret`, {
    headers: { cookie },
  });
  assert.equal(me.status, 200);
  const user = (await me.json()).user;
  const entry = lines.find(
    (l) => l.requestId === me.headers.get("x-request-id"),
  );
  assert.equal(entry.userId, user.id);
  const dump = JSON.stringify(lines);
  assert.ok(!dump.includes("Testing@2026"));
  assert.ok(!dump.includes(cookieValue));
  assert.ok(!dump.includes("query-secret"));
  assert.ok(!dump.includes("admin@urbana.local"));
});

test("500 errors are logged with the request id and not leaked to the client", async () => {
  lines.length = 0;
  broken = true;
  let r;
  try {
    r = await fetch(`${base}/api/ocorrencias`, {
      headers: {
        cookie: "urban_session=x",
        "X-Request-Id": "failing-request-1",
      },
    });
  } finally {
    broken = false;
  }
  assert.equal(r.status, 500);
  assert.equal(r.headers.get("x-request-id"), "failing-request-1");
  const text = await r.text();
  assert.ok(!text.includes("segredo-interno"));
  const error = lines.find(
    (l) => l.level === "error" && l.msg === "Erro não tratado na requisição",
  );
  assert.equal(error.requestId, "failing-request-1");
  assert.equal(error.err.message, "falha simulada do banco: segredo-interno");
});

test("logger formats: JSON per line, readable text, level filter and redaction", () => {
  const out = [];
  const json = createLogger({
    level: "info",
    format: "json",
    write: (l) => out.push(l),
  });
  json.debug("hidden");
  json.info("hello", {
    password: "p",
    nested: { token: "t", ok: 1 },
    err: new Error("boom"),
  });
  assert.equal(out.length, 1);
  const parsed = JSON.parse(out[0]);
  assert.equal(parsed.level, "info");
  assert.equal(parsed.password, "[omitido]");
  assert.equal(parsed.nested.token, "[omitido]");
  assert.equal(parsed.nested.ok, 1);
  assert.equal(parsed.err.message, "boom");
  const text = [];
  createLogger({
    level: "warn",
    format: "text",
    write: (l) => text.push(l),
  }).warn("careful", { status: 404, route: "/a b" });
  assert.match(text[0], /WARN\s+careful status=404 route="\/a b"$/);
  const silent = [];
  createLogger({ level: "silent", write: (l) => silent.push(l) }).error("x");
  assert.equal(silent.length, 0);
});
