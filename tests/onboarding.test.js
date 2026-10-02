import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import {
  defaultModules,
  hasModuleAccess,
  actionRoles,
} from "../shared/authorization.mjs";
import {
  getJourney,
  getTutorials,
  getTutorial,
  canOfferOnboarding,
  ONBOARDING_VERSION,
} from "../shared/onboarding.mjs";
import { onboardingState } from "../server/onboarding.js";
const dir = mkdtempSync(join(tmpdir(), "urbana-onboarding-"));
process.env.DATA_DIR = dir;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
let db, server, base;
const cookies = {};
async function request(path, method = "GET", body, cookie = cookies.gestor) {
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie: cookie || "",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
const event = (event, more = {}) => ({
  version: ONBOARDING_VERSION,
  event,
  ...more,
});
before(async () => {
  db = await openDatabase();
  await seed(db);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port + "/api";
  for (const name of [
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
        email: name + "@urbana.local",
        password: "Testing@2026",
      }),
    });
    cookies[name] = r.headers.get("set-cookie").split(";")[0];
  }
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});
test("journeys teach responsibility, handoff and authorized actions for all six roles", () => {
  for (const role of [
    "Administrador",
    "Gestor",
    "Triagem",
    "Equipe de Campo",
    "Fiscalização",
    "Consulta",
  ]) {
    const user = { role, modules: defaultModules(role) };
    const journey = getJourney(user);
    assert.ok(journey.title && journey.description && journey.handoff);
    assert.ok(journey.steps.length >= 4 && journey.steps.length <= 6);
    for (const step of journey.steps) {
      assert.ok(hasModuleAccess(user, step.module));
      assert.ok(step.target && step.path && step.checklist);
      if (step.action) assert.ok(actionRoles[step.action].includes(role));
      if (role !== "Equipe de Campo") assert.notEqual(step.module, "field");
      if (role !== "Administrador") assert.notEqual(step.module, "admin");
      if (role === "Consulta") assert.equal(step.action, undefined);
    }
  }
  assert.ok(
    getJourney({
      role: "Gestor",
      modules: defaultModules("Gestor"),
    }).workflow.includes("Distribuir"),
  );
  assert.ok(
    getJourney({
      role: "Equipe de Campo",
      modules: ["field"],
    }).workflow.includes("Registrar"),
  );
  assert.match(
    getJourney({ role: "Equipe de Campo", modules: ["field"] }).handoff,
    /Aguardando validação/,
  );
  assert.match(
    getJourney({ role: "Triagem", modules: ["triagem"] }).handoff,
    /gestão/,
  );
});
test("critical manager module restriction removes planning and all unauthorized tutorials", () => {
  const user = {
    role: "Gestor",
    modules: ["dashboard", "map", "orders", "field", "admin"],
  };
  const journey = getJourney(user),
    tutorials = getTutorials(user);
  const modules = journey.steps.map((s) => s.module);
  assert.ok(
    modules.includes("dashboard") &&
      modules.includes("map") &&
      modules.includes("orders"),
  );
  assert.ok(!modules.includes("planning"));
  assert.ok(!modules.includes("field"));
  assert.ok(!modules.includes("admin"));
  assert.equal(getTutorial(user, "task:plan"), null);
  assert.ok(
    !JSON.stringify(tutorials).includes("Como utilizar o planejamento"),
  );
});
test("no modules offers no tour, secondary modules receive reading guidance, and lifecycle controls are versioned", () => {
  assert.equal(
    canOfferOnboarding({ role: "Gestor", modules: [] }, null),
    false,
  );
  assert.deepEqual(getTutorials({ role: "Consulta", modules: [] }), []);
  const user = { role: "Gestor", modules: ["dashboard"] };
  assert.equal(canOfferOnboarding(user, { status: "not_started" }), true);
  assert.equal(canOfferOnboarding(user, { status: "started" }), true);
  assert.equal(canOfferOnboarding(user, { status: "skipped" }), false);
  assert.equal(canOfferOnboarding(user, { status: "completed" }), false);
  assert.equal(
    getJourney({ role: "Consulta", modules: ["equipment"] }).steps[0].module,
    "equipment",
  );
  assert.equal(
    getJourney({ role: "Administrador", modules: ["teams"] }).steps[0].action,
    undefined,
  );
});
test("first-access bootstrap and durable start, progress, skip and completion", async () => {
  const first = await request("/bootstrap");
  assert.equal(first.data.onboarding.version, ONBOARDING_VERSION);
  assert.equal(first.data.onboarding.status, "not_started");
  assert.equal(
    (await request("/onboarding", "PATCH", event("started"))).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/onboarding",
        "PATCH",
        event("progress", { step_id: "schedule" }),
      )
    ).status,
    200,
  );
  let current = (await request("/onboarding")).data;
  assert.ok(current.started_at);
  assert.equal(current.step_id, "schedule");
  assert.equal(
    (await request("/onboarding", "PATCH", event("skipped"))).status,
    200,
  );
  current = (await request("/onboarding")).data;
  assert.equal(current.status, "skipped");
  assert.ok(current.skipped_at);
  assert.equal(current.completed_at, null);
  assert.equal(
    (await request("/onboarding", "PATCH", event("replayed"))).status,
    200,
  );
  assert.equal(
    (await request("/onboarding", "PATCH", event("completed"))).status,
    200,
  );
  current = (await request("/onboarding")).data;
  assert.ok(current.completed_at);
  const completed = current.completed_at;
  await request("/onboarding", "PATCH", event("replayed"));
  await request("/onboarding", "PATCH", event("skipped"));
  assert.equal((await request("/onboarding")).data.completed_at, completed);
  assert.equal((await request("/onboarding")).data.status, "completed");
  const names = (
    await db.all("SELECT event FROM onboarding_events WHERE user_id=?", [
      "gestor",
    ])
  ).map((row) => row.event);
  for (const name of [
    "onboarding_started",
    "onboarding_skipped",
    "onboarding_replayed",
    "onboarding_completed",
  ])
    assert.ok(names.includes(name));
});
test("individual tutorial does not complete the main tour and every profile saves only its own state", async () => {
  for (const [name, role] of [
    ["admin", "Administrador"],
    ["triagem", "Triagem"],
    ["campo", "Equipe de Campo"],
    ["fiscal", "Fiscalização"],
    ["consulta", "Consulta"],
  ]) {
    const tutorial = getTutorials({ role, modules: defaultModules(role) })[0];
    assert.equal(
      (
        await request(
          "/onboarding",
          "PATCH",
          event("replayed", { tutorial_id: tutorial.id }),
          cookies[name],
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/onboarding",
          "PATCH",
          event("completed", {
            tutorial_id: tutorial.id,
            step_id: tutorial.steps[0].id,
          }),
          cookies[name],
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/onboarding", "GET", undefined, cookies[name])).data
        .status,
      "not_started",
    );
    assert.ok(
      await db.get(
        "SELECT completed_at FROM user_onboarding WHERE user_id=? AND tutorial_id=?",
        [name, tutorial.id],
      ),
    );
  }
  assert.equal(
    (
      await request("/onboarding", "PATCH", {
        ...event("completed"),
        user_id: "admin",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/onboarding", "PATCH", {
        ...event("completed"),
        role: "Administrador",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/onboarding", "GET", undefined, null)).status,
    401,
  );
  assert.equal(
    (await request("/onboarding/admin", "PATCH", event("completed"))).status,
    403,
  );
});
test("server rejects unavailable modules, unknown steps and versions without changing authorization", async () => {
  const before = await db.all(
    "SELECT * FROM user_module_permissions ORDER BY user_id,module",
  );
  assert.equal(
    (
      await request(
        "/onboarding",
        "PATCH",
        event("started", { step_id: "missing" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/onboarding", "PATCH", {
        ...event("started"),
        version: ONBOARDING_VERSION + 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/onboarding",
        "PATCH",
        event("started", { tutorial_id: "task:assume" }),
      )
    ).status,
    403,
  );
  await db.run(
    "DELETE FROM user_module_permissions WHERE user_id='gestor' AND module='planning'",
  );
  assert.equal(
    (
      await request(
        "/onboarding",
        "PATCH",
        event("completed", { tutorial_id: "task:plan" }),
      )
    ).status,
    403,
  );
  const after = await db.all(
    "SELECT * FROM user_module_permissions ORDER BY user_id,module",
  );
  assert.deepEqual(
    after,
    before.filter(
      (row) => row.user_id !== "gestor" || row.module !== "planning",
    ),
  );
  const mutations = await request(
    "/ordens-servico/missing/validar",
    "POST",
    {},
    cookies.consulta,
  );
  assert.equal(mutations.status, 403);
});
test("onboarding persistence does not mutate business data and migration survives restart", async () => {
  const tables = [
    "users",
    "catalogs",
    "occurrences",
    "orders",
    "evidence",
    "consumption",
    "audit_logs",
  ];
  const before = {};
  for (const table of tables)
    before[table] = await db.all("SELECT * FROM " + table + " ORDER BY id");
  await request("/onboarding", "PATCH", event("replayed"));
  await request(
    "/onboarding",
    "PATCH",
    event("progress", { step_id: "track" }),
  );
  await request("/onboarding", "PATCH", event("completed"));
  for (const table of tables)
    assert.deepEqual(
      await db.all("SELECT * FROM " + table + " ORDER BY id"),
      before[table],
    );
  const state = await onboardingState(db, { id: "gestor" });
  const restored = await openDatabase();
  assert.deepEqual(await onboardingState(restored, { id: "gestor" }), state);
  assert.ok(
    await restored.get("SELECT version FROM schema_migrations WHERE version=9"),
  );
  await restored.close();
});

test("old versions do not suppress the current tour and telemetry failure does not block progress", async () => {
  await db.run(
    "INSERT INTO user_onboarding(user_id,onboarding_version,tutorial_id,status,completed_at,updated_at) VALUES(?,?,'main','completed',?,?)",
    ["fiscal", ONBOARDING_VERSION - 1, "past", "past"],
  );
  assert.equal(
    (await request("/onboarding", "GET", undefined, cookies.fiscal)).data
      .status,
    "not_started",
  );
  const run = db.run;
  db.run = async (sql, args) => {
    if (sql.startsWith("INSERT INTO onboarding_events"))
      throw new Error("telemetry unavailable");
    return run(sql, args);
  };
  try {
    assert.equal(
      (
        await request(
          "/onboarding",
          "PATCH",
          event("started", { step_id: "review" }),
          cookies.fiscal,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/onboarding", "GET", undefined, cookies.fiscal)).data
        .step_id,
      "review",
    );
  } finally {
    db.run = run;
  }
});
