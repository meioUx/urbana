// T4 hardening: security headers/CSP, same-origin enforcement on mutations, persistent login
// throttling (migration 11) and the refusal to start a public production server with demo credentials.
// Deliberately does NOT import ./support/same-origin-fetch.js: requests here are raw, like curl.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import {
  loginLimiter,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
} from "../server/login-limit.js";
import {
  contentSecurityPolicy,
  isLoopbackHost,
  isPublicProduction,
  tileImageSource,
} from "../server/security.js";

const temp = mkdtempSync(join(tmpdir(), "urbana-security-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "false";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
delete process.env.SECURE_COOKIE;
delete process.env.TRUST_PROXY;
delete process.env.VITE_MAP_TILE_URL;

let db, server, base, port;
const listen = async (app) => {
  const s = app.listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  return s;
};
const close = (s) => new Promise((r) => s.close(r));

before(async () => {
  db = await openDatabase();
  await seed(db);
  server = await listen(createApp(db));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});
after(async () => {
  await close(server);
  await db.close();
  rmSync(temp, { recursive: true, force: true });
});

// Raw HTTP so the Host header can be set as a reverse proxy would forward it.
const raw = (path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolvePromise, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolvePromise({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
const post = (path, headers = {}, body = "{}") =>
  raw(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

test("security headers: CSP, framing, permissions and no HSTS without SECURE_COOKIE", async () => {
  // (Express's own 404 page for unknown non-API paths keeps its stricter "default-src 'none'".)
  for (const path of ["/healthz", "/api/auth/me", "/api/nao-existe"]) {
    const r = await fetch(base + path);
    const csp = r.headers.get("content-security-policy");
    assert.ok(csp, path);
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.match(
      csp,
      /img-src 'self' data: blob: https:\/\/tile\.openstreetmap\.org/,
    );
    assert.match(csp, /style-src 'self' https:\/\/fonts\.googleapis\.com/);
    assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
    assert.match(csp, /connect-src 'self'(;|$)/);
    assert.match(csp, /worker-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /upgrade-insecure-requests/);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      r.headers.get("referrer-policy"),
      "strict-origin-when-cross-origin",
    );
    assert.match(r.headers.get("permissions-policy"), /geolocation=\(self\)/);
    assert.match(r.headers.get("permissions-policy"), /camera=\(self\)/);
    assert.match(r.headers.get("permissions-policy"), /microphone=\(\)/);
    assert.equal(r.headers.get("strict-transport-security"), null);
  }
  assert.equal(
    (await fetch(base + "/api/auth/me")).headers.get("cache-control"),
    "no-store",
  );
});

test("HSTS and upgrade-insecure-requests only with SECURE_COOKIE=true; dev policy is explicit", async () => {
  process.env.SECURE_COOKIE = "true";
  let secure;
  try {
    secure = await listen(createApp(db));
  } finally {
    delete process.env.SECURE_COOKIE;
  }
  try {
    const r = await fetch(`http://127.0.0.1:${secure.address().port}/healthz`);
    assert.equal(
      r.headers.get("strict-transport-security"),
      "max-age=31536000",
    );
    assert.match(
      r.headers.get("content-security-policy"),
      /upgrade-insecure-requests/,
    );
  } finally {
    await close(secure);
  }
  const dev = contentSecurityPolicy({ dev: true, env: {} });
  assert.match(dev, /script-src 'self' 'unsafe-inline'/);
  assert.match(dev, /connect-src 'self' ws: wss:/);
  assert.doesNotMatch(dev, /unsafe-eval/);
});

test("tile provider origin follows VITE_MAP_TILE_URL", () => {
  assert.equal(tileImageSource(""), "https://tile.openstreetmap.org");
  assert.equal(tileImageSource(undefined), "https://tile.openstreetmap.org");
  assert.equal(tileImageSource("/map-development-tile.svg"), null);
  assert.equal(
    tileImageSource("https://tiles.example.gov.br/{z}/{x}/{y}.png"),
    "https://tiles.example.gov.br",
  );
  assert.equal(
    tileImageSource("https://{s}.tiles.example.com:8443/{z}/{x}/{y}.png"),
    "https://*.tiles.example.com:8443",
  );
  assert.equal(
    tileImageSource("//cdn.example.com/{z}/{x}/{y}.png"),
    "https://cdn.example.com",
  );
  const csp = contentSecurityPolicy({
    env: { VITE_MAP_TILE_URL: "https://tiles.example.gov.br/{z}/{x}/{y}.png" },
  });
  assert.match(
    csp,
    /img-src 'self' data: blob: https:\/\/tiles\.example\.gov\.br;/,
  );
  assert.doesNotMatch(csp, /openstreetmap/);
  assert.match(
    contentSecurityPolicy({
      env: { VITE_MAP_TILE_URL: "/map-development-tile.svg" },
    }),
    /img-src 'self' data: blob:;/,
  );
});

test("mutations require same-origin proof; reads and same-origin requests pass", async () => {
  const host = `127.0.0.1:${port}`;
  // Unauthenticated: 401 means the origin check passed, 403 means it rejected the request.
  const missing = await post("/api/ocorrencias");
  assert.equal(missing.status, 403);
  assert.equal(missing.body.code, "ORIGIN_REQUIRED");
  assert.equal((await post("/api/auth/login")).status, 403);
  for (const method of ["PUT", "PATCH", "DELETE"])
    assert.equal(
      (await raw("/api/users/x", { method })).body.code,
      "ORIGIN_REQUIRED",
      method,
    );
  assert.equal((await raw("/api/ocorrencias")).status, 401);
  assert.equal((await raw("/api/ocorrencias", { method: "HEAD" })).status, 401);
  assert.equal(
    (await post("/api/ocorrencias", { origin: `http://${host}` })).status,
    401,
  );
  assert.equal(
    (await post("/api/ocorrencias", { "sec-fetch-site": "same-origin" }))
      .status,
    401,
  );
  const forged = await post("/api/ocorrencias", {
    origin: "https://untrusted.example",
  });
  assert.equal(forged.status, 403);
  assert.equal(forged.body.code, "ORIGIN_FORBIDDEN");
  assert.equal(
    (await post("/api/ocorrencias", { origin: "null" })).status,
    403,
  );
  assert.equal(
    (await post("/api/ocorrencias", { origin: "not a url" })).status,
    403,
  );
  assert.equal(
    (await post("/api/ocorrencias", { origin: `http://${host}.evil.example` }))
      .status,
    403,
  );
  for (const site of ["cross-site", "same-site", "none"])
    assert.equal(
      (
        await post("/api/ocorrencias", {
          origin: `http://${host}`,
          "sec-fetch-site": site,
        })
      ).status,
      403,
      site,
    );
  assert.equal(
    (
      await post("/api/ocorrencias", {
        origin: `http://${host}`,
        "sec-fetch-site": "same-origin",
      })
    ).status,
    401,
  );
  // Behind Caddy: Host is preserved and Origin carries the public https URL.
  assert.equal(
    (
      await post("/api/ocorrencias", {
        host: "campo.example.gov.br",
        origin: "https://campo.example.gov.br",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post("/api/ocorrencias", {
        host: "campo.example.gov.br",
        origin: "https://outro.example.gov.br",
      })
    ).status,
    403,
  );
  // Rejected before the body is parsed: a malformed body still yields the origin error.
  assert.equal(
    (await post("/api/ocorrencias", {}, "{not json")).body.code,
    "ORIGIN_REQUIRED",
  );
});

test("native clients without Origin need X-Urbana-Client; the header never bypasses browser checks", async () => {
  const host = `127.0.0.1:${port}`;
  const native = { "x-urbana-client": "urbana-campo/1.4.0" };
  // No Origin, no Sec-Fetch-Site, no header: still refused.
  assert.equal((await post("/api/ocorrencias")).body.code, "ORIGIN_REQUIRED");
  // No Origin with the header: passes the origin check (401 = reached authentication).
  assert.equal((await post("/api/ocorrencias", native)).status, 401);
  for (const method of ["PUT", "PATCH", "DELETE"])
    assert.equal(
      (await raw("/api/users/x", { method, headers: native })).status,
      401,
      method,
    );
  // Invalid header values are ignored.
  for (const value of [
    "",
    " ",
    "a b",
    "x".repeat(65),
    "<script>",
    "app, other",
  ])
    assert.equal(
      (await post("/api/ocorrencias", { "x-urbana-client": value })).body?.code,
      "ORIGIN_REQUIRED",
      JSON.stringify(value),
    );
  // With Origin or Sec-Fetch-Site present the header changes nothing.
  for (const origin of [
    "https://untrusted.example",
    "null",
    `http://${host}.evil.example`,
  ]) {
    const r = await post("/api/ocorrencias", { ...native, origin });
    assert.equal(r.status, 403, origin);
    assert.equal(r.body.code, "ORIGIN_FORBIDDEN");
  }
  for (const site of ["cross-site", "same-site", "none", ""]) {
    const r = await post("/api/ocorrencias", {
      ...native,
      "sec-fetch-site": site,
    });
    assert.equal(r.status, 403, site);
  }
  assert.equal(
    (
      await post("/api/ocorrencias", {
        ...native,
        origin: `http://${host}`,
        "sec-fetch-site": "cross-site",
      })
    ).status,
    403,
  );
  // The mobile app flow: login without Origin, reuse the cookie on a mutation.
  const login = await post(
    "/api/auth/login",
    native,
    JSON.stringify({ email: "admin@urbana.local", password: "Testing@2026" }),
  );
  assert.equal(login.status, 200);
  const cookie = login.headers["set-cookie"][0].split(";")[0];
  assert.equal(
    (await post("/api/auth/logout", { ...native, cookie })).status,
    200,
  );
  assert.equal(
    (await post("/api/auth/logout", { cookie })).body.code,
    "ORIGIN_REQUIRED",
  );
});

test("login limit is persisted: survives restart, blocks correct password, clears on success", async () => {
  const login = (password, s = server) =>
    raw("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${s.address().port}`,
      },
      body: JSON.stringify({ email: "admin@urbana.local", password }),
    }).then((r) => r.status);
  await db.run("DELETE FROM login_attempts");
  assert.equal(await login("Testing@2026"), 200);
  for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i++)
    assert.equal(await login("errada"), 401);
  assert.equal(
    await login("Testing@2026"),
    200,
    "success before the limit clears the counter",
  );
  assert.equal((await db.all("SELECT * FROM login_attempts")).length, 0);
  for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++)
    assert.equal(await login("errada"), 401);
  assert.equal(await login("Testing@2026"), 429);
  const row = await db.get("SELECT * FROM login_attempts");
  assert.equal(row.client_key, "127.0.0.1");
  assert.equal(Number(row.attempts), LOGIN_MAX_ATTEMPTS);
  // A new app instance (restart) over a reopened database keeps the block.
  const reopened = await openDatabase();
  const restarted = await listen(createApp(reopened));
  try {
    port = restarted.address().port;
    assert.equal(await login("Testing@2026", restarted), 429);
  } finally {
    await close(restarted);
    await reopened.close();
    port = server.address().port;
  }
  await db.run("DELETE FROM login_attempts");
  assert.equal(await login("Testing@2026"), 200);
});

test("login limiter window, expiry and cleanup (same policy as before: 10 per 15 min)", async () => {
  assert.equal(LOGIN_MAX_ATTEMPTS, 10);
  assert.equal(LOGIN_WINDOW_MS, 15 * 60 * 1000);
  await db.run("DELETE FROM login_attempts");
  let clock = Date.parse("2026-11-11T12:00:00.000Z");
  const limiter = loginLimiter(db, { clock: () => clock });
  for (let i = 0; i < 9; i++) await limiter.failure("a");
  assert.equal(await limiter.blocked("a"), false);
  clock += 14 * 60 * 1000; // still inside the window opened by the first failure
  await limiter.failure("a");
  assert.equal(await limiter.blocked("a"), true);
  assert.equal(
    await limiter.blocked("b"),
    false,
    "other clients are independent",
  );
  await limiter.failure("b");
  clock += 60 * 1000 + 1; // window of "a" has ended; "b" is still active
  assert.equal(await limiter.blocked("a"), false);
  assert.deepEqual(
    (await db.all("SELECT client_key FROM login_attempts")).map(
      (r) => r.client_key,
    ),
    ["b"],
    "expired rows removed",
  );
  await limiter.failure("a");
  assert.equal(
    Number(
      (await db.get("SELECT attempts FROM login_attempts WHERE client_key='a'"))
        .attempts,
    ),
    1,
    "new window",
  );
  await limiter.clear("a");
  assert.equal(
    await db.get("SELECT * FROM login_attempts WHERE client_key='a'"),
    undefined,
  );
  await db.run("DELETE FROM login_attempts");
});

test("public production classification", () => {
  for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"])
    assert.equal(isLoopbackHost(host), true, host);
  for (const host of ["0.0.0.0", "::", "192.168.0.10", "campo.example.gov.br"])
    assert.equal(isLoopbackHost(host), false, host);
  const prod = ["node", "server/index.js", "--production"];
  assert.equal(isPublicProduction({ argv: prod, env: {} }), false);
  assert.equal(
    isPublicProduction({ argv: prod, env: { HOST: "0.0.0.0" } }),
    true,
  );
  assert.equal(
    isPublicProduction({ argv: prod, env: { SECURE_COOKIE: "true" } }),
    true,
  );
  assert.equal(
    isPublicProduction({
      argv: ["node", "server/index.js"],
      env: { HOST: "0.0.0.0" },
    }),
    false,
  );
});

// Starts server/index.js like `npm start` (cwd = an empty folder, so no .env is loaded).
const INDEX = resolve("server/index.js");
function start(env, { production = true } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "urbana-start-"));
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !/^(DATABASE_URL|DEMO_DATA|ADMIN_PASSWORD|HOST|PORT|SECURE_COOKIE|URBANA_ALLOW_INSECURE_DEMO|DATA_DIR|TRUST_PROXY)$/.test(
          k,
        ),
    ),
  );
  const child = spawn(
    process.execPath,
    [INDEX, ...(production ? ["--production"] : [])],
    {
      cwd,
      env: { ...clean, PORT: "0", ...env },
    },
  );
  let output = "";
  return new Promise((resolvePromise) => {
    const done = (result) => {
      clearTimeout(timer);
      child.kill();
      rmSync(cwd, { recursive: true, force: true });
      resolvePromise({ ...result, output });
    };
    const timer = setTimeout(
      () => done({ started: false, code: "timeout" }),
      30000,
    );
    const read = (chunk) => {
      output += chunk;
      if (output.includes("Urbana disponível")) done({ started: true });
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => done({ started: false, code }));
  });
}

test(
  "production refuses demonstration credentials when reachable beyond loopback",
  { timeout: 120000 },
  async () => {
    const data = mkdtempSync(join(tmpdir(), "urbana-start-data-"));
    try {
      // README flow: `npm start` on 127.0.0.1 with demo accounts keeps working.
      const local = await start({
        DATA_DIR: join(data, "demo"),
        HOST: "127.0.0.1",
      });
      assert.equal(local.started, true, local.output);

      const publicDemo = await start({
        DATA_DIR: join(data, "demo"),
        HOST: "0.0.0.0",
      });
      assert.equal(publicDemo.started, false);
      assert.equal(publicDemo.code, 1);
      assert.match(publicDemo.output, /DEMO_DATA/);
      assert.match(publicDemo.output, /ADMIN_PASSWORD/);

      // DEMO_DATA=false over a database seeded with the demo password: lists the exposed accounts.
      const legacy = await start({
        DATA_DIR: join(data, "demo"),
        HOST: "0.0.0.0",
        DEMO_DATA: "false",
        ADMIN_PASSWORD: "Unica-Senha-2026",
      });
      assert.equal(legacy.started, false);
      assert.match(legacy.output, /admin@urbana\.local/);
      assert.match(legacy.output, /campo@urbana\.local/);

      const https = await start({
        DATA_DIR: join(data, "demo"),
        HOST: "127.0.0.1",
        SECURE_COOKIE: "true",
      });
      assert.equal(
        https.started,
        false,
        "SECURE_COOKIE=true counts as public even on loopback",
      );

      const demoPassword = await start({
        DATA_DIR: join(data, "fresh"),
        HOST: "0.0.0.0",
        DEMO_DATA: "false",
        ADMIN_PASSWORD: "Urbana@2026",
      });
      assert.equal(demoPassword.started, false);
      assert.match(demoPassword.output, /senha pública de demonstração/);

      const real = await start({
        DATA_DIR: join(data, "real"),
        HOST: "0.0.0.0",
        DEMO_DATA: "false",
        ADMIN_PASSWORD: "Unica-Senha-2026",
        SECURE_COOKIE: "true",
      });
      assert.equal(real.started, true, real.output);

      // compose.local.yaml opt-out: allowed on plain HTTP, never with SECURE_COOKIE=true.
      const optOut = await start({
        DATA_DIR: join(data, "demo"),
        HOST: "0.0.0.0",
        URBANA_ALLOW_INSECURE_DEMO: "true",
      });
      assert.equal(optOut.started, true, optOut.output);
      assert.match(optOut.output, /URBANA_ALLOW_INSECURE_DEMO/);
      const optOutHttps = await start({
        DATA_DIR: join(data, "demo"),
        HOST: "0.0.0.0",
        URBANA_ALLOW_INSECURE_DEMO: "true",
        SECURE_COOKIE: "true",
      });
      assert.equal(optOutHttps.started, false);
    } finally {
      rmSync(data, { recursive: true, force: true });
    }
  },
);
