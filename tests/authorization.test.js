import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import {
  isMasterUser,
  canPerformAction,
  moduleCatalog,
  defaultModules,
  hasModuleAccess,
  landingModule,
  canRoleAccessModule,
} from "../shared/authorization.mjs";
const dir = mkdtempSync(join(tmpdir(), "urbana-auth-"));
process.env.DATA_DIR = dir;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
let db, server, base, admin, ordinaryAdmin, ordinaryId;
const cookies = {};
async function request(path, method = "GET", body, cookie = admin) {
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie: cookie || "",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
const login = async (email) =>
  (
    await request(
      "/auth/login",
      "POST",
      { email, password: "Testing@2026" },
      null,
    )
  ).cookie;
before(async () => {
  db = await openDatabase();
  await seed(db);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port + "/api";
  admin = await login("admin@urbana.local");
  ordinaryId = (
    await request("/users", "POST", {
      name: "Admin comum",
      email: "ordinary-admin@test.local",
      password: "Testing@2026",
      role: "Administrador",
      team_id: null,
    })
  ).data.id;
  ordinaryAdmin = await login("ordinary-admin@test.local");
  for (const name of ["gestor", "triagem", "campo", "fiscal", "consulta"])
    cookies[name] = await login(name + "@urbana.local");
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});
test("every non-administrator is denied direct access administration requests", async () => {
  for (const cookie of Object.values(cookies))
    for (const [path, method, body] of [
      ["/users", "GET"],
      ["/users", "POST", {}],
      ["/users/gestor", "PATCH", {}],
      ["/users/gestor/permissions", "GET"],
      ["/users/gestor/permissions", "PATCH", { permissions: { admin: true } }],
    ])
      assert.equal((await request(path, method, body, cookie)).status, 403);
});
test("field remains exclusive for ordinary accounts even with forged grants", async () => {
  for (const [name, cookie] of [
    ["ordinary-admin", ordinaryAdmin],
    ...Object.entries(cookies).filter(([name]) => name !== "campo"),
  ]) {
    assert.equal(
      (await request("/campo", "GET", undefined, cookie)).status,
      403,
      name,
    );
    for (const action of [
      "assumir",
      "iniciar",
      "concluir",
      "devolver",
      "material",
      "equipamento",
    ])
      assert.equal(
        (await request("/ordens-servico/missing/" + action, "POST", {}, cookie))
          .status,
        403,
      );
  }
  assert.equal(
    (await request("/campo", "GET", undefined, cookies.campo)).status,
    200,
  );
  await db.run("INSERT INTO user_module_permissions VALUES(?,?,1,?,?)", [
    "gestor",
    "field",
    "now",
    "now",
  ]);
  assert.equal(
    (await request("/campo", "GET", undefined, cookies.gestor)).status,
    403,
  );
  await db.run(
    "DELETE FROM user_module_permissions WHERE user_id='gestor' AND module='field'",
  );
});
test("administrator creates, edits, revokes modules and audits complete before/after values", async () => {
  const created = await request("/users", "POST", {
    name: "Restrito",
    email: "restricted@test.local",
    password: "Testing@2026",
    role: "Gestor",
    modules: ["dashboard", "materials"],
    team_id: null,
  });
  assert.equal(created.status, 200);
  const id = created.data.id,
    cookie = await login("restricted@test.local");
  let info = (await request("/users/" + id + "/permissions")).data;
  assert.deepEqual(info.modules.sort(), ["dashboard", "materials"]);
  const update = {
    name: "Restrito editado",
    email: "restricted@test.local",
    role: "Gestor",
    team_id: null,
    modules: ["dashboard"],
  };
  assert.equal((await request("/users/" + id, "PATCH", update)).status, 200);
  assert.equal(
    (await request("/almoxarifado", "GET", undefined, cookie)).status,
    403,
  );
  assert.equal(
    (await request("/almoxarifado/movimentos", "POST", {}, cookie)).status,
    403,
  );
  assert.deepEqual(
    (await request("/auth/me", "GET", undefined, cookie)).data.user.modules,
    ["dashboard"],
  );
  assert.equal(
    (
      await request("/users/" + id, "PATCH", {
        ...update,
        role: "Triagem",
        modules: ["triagem"],
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/users/" + id, "PATCH", { ...update, modules: ["field"] }))
      .status,
    400,
  );
  assert.equal(
    (await request("/users/" + id, "PATCH", { ...update, modules: ["admin"] }))
      .status,
    400,
  );
  const audit = await db.get(
    "SELECT * FROM audit_logs WHERE entity_id=? AND event='Acessos do usuário atualizados' ORDER BY created_at LIMIT 1",
    [id],
  );
  assert.equal(audit.user_id, "admin");
  assert.deepEqual(JSON.parse(audit.before_value).modules.sort(), [
    "dashboard",
    "materials",
  ]);
  assert.deepEqual(JSON.parse(audit.after_value).modules, ["dashboard"]);
  assert.ok(audit.created_at);
  assert.equal(
    (await request("/users/" + id, "PATCH", { ...update, modules: [] })).status,
    200,
  );
  const user = (await request("/bootstrap", "GET", undefined, cookie)).data
    .user;
  assert.deepEqual(user.modules, []);
  assert.equal(landingModule(user), undefined);
  assert.equal(
    (await request("/dashboard", "GET", undefined, cookie)).status,
    403,
  );
});
test("readers cannot mutate even authorized modules, and users cannot elevate themselves", async () => {
  for (const [path, method] of [
    ["/ocorrencias", "POST"],
    ["/ordens-servico", "POST"],
    ["/kanban", "PATCH"],
    ["/ocorrencias/missing/classificar", "POST"],
    ["/ordens-servico/missing/validar", "POST"],
    ["/ordens-servico/missing/cancelar", "POST"],
    ["/ordens-servico/missing/reabrir", "POST"],
  ])
    assert.equal(
      (await request(path, method, {}, cookies.consulta)).status,
      403,
    );
  assert.equal(
    (await request("/ordens-servico", "GET", undefined, cookies.consulta))
      .status,
    200,
  );
  assert.equal(
    (
      await request(
        "/users/" + ordinaryId,
        "PATCH",
        {
          name: "Admin comum",
          email: "ordinary-admin@test.local",
          role: "Administrador",
          team_id: null,
          modules: ["admin"],
        },
        ordinaryAdmin,
      )
    ).status,
    403,
  );
  for (const cookie of Object.values(cookies))
    assert.equal(
      (
        await request(
          "/users/gestor",
          "PATCH",
          { role: "Administrador", modules: ["admin"] },
          cookie,
        )
      ).status,
      403,
    );
});
test("maintenance master always has every module and action, and its identity cannot be revoked", async () => {
  await db.run("DELETE FROM user_module_permissions WHERE user_id='admin'");
  const master = (await request("/bootstrap")).data.user;
  assert.deepEqual(
    master.modules.sort(),
    moduleCatalog.map((m) => m.key).sort(),
  );
  for (const m of moduleCatalog)
    assert.equal(hasModuleAccess({ ...master, modules: [] }, m.key), true);
  assert.equal(hasModuleAccess(master, "unknown-module"), false);
  assert.equal(canPerformAction(master, "execute"), true);
  assert.equal(
    isMasterUser({ email: "admin@urbana.local", role: "Consulta" }),
    false,
  );
  assert.equal((await request("/campo")).status, 200);
  assert.equal(
    (await request("/ordens-servico/missing/assumir", "POST", {})).status,
    404,
  );
  const data = {
    name: master.name,
    email: master.email,
    role: master.role,
    team_id: master.team_id,
    modules: [],
  };
  assert.equal(
    (await request("/users/admin", "PATCH", data, ordinaryAdmin)).status,
    200,
  );
  assert.equal(
    (await request("/auth/me")).data.user.modules.length,
    moduleCatalog.length,
  );
  assert.equal(
    (
      await db.all(
        "SELECT module FROM user_module_permissions WHERE user_id='admin' AND allowed=1",
      )
    ).length,
    moduleCatalog.length,
  );
  assert.equal(
    (
      await request(
        "/users/admin",
        "PATCH",
        { ...data, email: "maintenance@test.local" },
        ordinaryAdmin,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/users/admin",
        "PATCH",
        { ...data, role: "Consulta" },
        ordinaryAdmin,
      )
    ).status,
    400,
  );
  const ordinary = (await request("/auth/me", "GET", undefined, ordinaryAdmin))
    .data.user;
  assert.equal(hasModuleAccess(ordinary, "field"), false);
  assert.equal(canPerformAction(ordinary, "execute"), false);
});

test("migration is compatible, persistent, restart safe and preserves explicit empty grants", async () => {
  for (const role of [
    "Administrador",
    "Gestor",
    "Triagem",
    "Equipe de Campo",
    "Fiscalização",
    "Consulta",
  ])
    for (const module of defaultModules(role))
      assert.ok(canRoleAccessModule(role, module));
  const all = await db.all("SELECT id,email,role FROM users");
  await db.run("DELETE FROM schema_migrations WHERE version=8");
  await db.close();
  db = await openDatabase();
  for (const user of all) {
    const grants = (
      await db.all(
        "SELECT module FROM user_module_permissions WHERE user_id=?",
        [user.id],
      )
    ).map((r) => r.module);
    assert.deepEqual(
      grants.sort(),
      (isMasterUser(user)
        ? moduleCatalog.map((m) => m.key)
        : defaultModules(user.role)
      ).sort(),
    );
  }
  await db.run("DELETE FROM user_module_permissions WHERE user_id='gestor'");
  await db.close();
  db = await openDatabase();
  assert.equal(
    (
      await db.all(
        "SELECT * FROM user_module_permissions WHERE user_id='gestor'",
      )
    ).length,
    0,
  );
  for (const module of moduleCatalog)
    assert.equal(
      hasModuleAccess({ role: "Gestor", modules: [] }, module.key),
      false,
    );
});
