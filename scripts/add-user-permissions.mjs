import { readFileSync, writeFileSync } from "node:fs";
const edit = (path, transform) => { const before = readFileSync(path, "utf8"); const after = transform(before); if (after === before) throw new Error(`Nenhuma alteração aplicada em ${path}`); writeFileSync(path, after); };

edit("server/db.js", (source) => source.replace(
  "  return db;\n}",
  `  if (!(await db.get("SELECT version FROM schema_migrations WHERE version=5"))) {
    await db.exec("BEGIN");
    try {
      await db.exec("CREATE TABLE IF NOT EXISTS user_permission_overrides (user_id TEXT NOT NULL REFERENCES users(id), permission TEXT NOT NULL, allowed INTEGER NOT NULL CHECK(allowed IN (0,1)), updated_at TEXT NOT NULL, PRIMARY KEY(user_id,permission)); CREATE INDEX IF NOT EXISTS idx_user_permission_user ON user_permission_overrides(user_id);");
      await db.run("INSERT INTO schema_migrations(version, applied_at) VALUES(5, ?)", [new Date().toISOString()]);
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  }
  return db;
}`,
));

edit("server/app.js", (source) => {
  source = source.replace('import { registerInventory, inventoryBalance } from "./inventory.js";', 'import { registerInventory, inventoryBalance } from "./inventory.js";\nimport { effectivePermissions, hasPermission, permissionCatalog, roleDefaults } from "./user-permissions.js";');
  source = source.replace(
    '  const allow = (action) => (req, res, next) =>\n    permissions[action].includes(req.user.role)\n      ? next()\n      : res.status(403).json({ error: "Seu perfil não permite esta ação." });',
    '  const allow = (action) => async (req, res, next) => {\n    try {\n      if (await hasPermission(db, req.user, action)) return next();\n      return res.status(403).json({ error: "Você não tem permissão para esta ação." });\n    } catch (error) { next(error); }\n  };',
  );
  source = source.replace(
    '        user: req.user,\n        catalogs:',
    '        user: req.user,\n        effective_permissions: await effectivePermissions(db, req.user),\n        permission_catalog: permissionCatalog,\n        catalogs:',
  );
  source = source.replace(
    '        operators: permissions.schedule.includes(req.user.role)\n          ? await db.all(',
    '        operators: (await hasPermission(db, req.user, "schedule"))\n          ? await db.all(',
  );
  const marker = '  app.patch(\n    "/api/settings",';
  const routes = `  app.get(
    "/api/users/:id/permissions",
    allow("admin"),
    route(async (req) => {
      const user = await db.get("SELECT id,name,email,role,team_id FROM users WHERE id=?", [req.params.id]);
      if (!user) fail(404, "Usuário não encontrado.");
      const rows = await db.all("SELECT permission,allowed FROM user_permission_overrides WHERE user_id=?", [user.id]);
      return { user, catalog: permissionCatalog, defaults: roleDefaults(user.role), effective: await effectivePermissions(db, user), overrides: Object.fromEntries(rows.map((row) => [row.permission, Boolean(row.allowed)])) };
    }),
  );
  app.patch(
    "/api/users/:id/permissions",
    allow("admin"),
    route(async (req) => {
      const user = await db.get("SELECT id,name,email,role,team_id FROM users WHERE id=?", [req.params.id]);
      if (!user) fail(404, "Usuário não encontrado.");
      const values = req.body?.permissions;
      if (!values || typeof values !== "object" || Array.isArray(values)) fail(400, "Informe as permissões do usuário.");
      const valid = new Set(permissionCatalog.map((item) => item.key));
      if (Object.keys(values).some((key) => !valid.has(key) || ![true, false, null].includes(values[key]))) fail(400, "Existe uma permissão inválida.");
      if (user.role === "Administrador" && values.admin === false) fail(400, "O acesso administrativo de um Administrador não pode ser bloqueado.");
      const before = await effectivePermissions(db, user);
      await db.run("DELETE FROM user_permission_overrides WHERE user_id=?", [user.id]);
      for (const [permission, allowed] of Object.entries(values)) if (allowed !== null) await db.run("INSERT INTO user_permission_overrides(user_id,permission,allowed,updated_at) VALUES(?,?,?,?)", [user.id, permission, allowed ? 1 : 0, now()]);
      const after = await effectivePermissions(db, user);
      await audit(req, "user", user.id, "Permissões individuais atualizadas", before, after);
      return { effective: after };
    }, true),
  );
`;
  if (!source.includes(marker)) throw new Error("Ponto das rotas de configuração não encontrado");
  source = source.replace(marker, routes + marker);
  return source;
});

edit("src/main.tsx", (source) => {
  source = source.replace('import InvoicePanel from "./InvoicePanel";', 'import InvoicePanel from "./InvoicePanel";\nimport PermissionForm from "./PermissionForm";\nimport "./permissions.css";');
  source = source.replace('  operators: Row[];\n};', '  operators: Row[];\n  effective_permissions: Record<string, boolean>;\n  permission_catalog: Row[];\n};');
  const oldCan = `  const can = (action: string) =>
    !!boot &&
    (
      {
        create: [
          "Administrador",
          "Gestor",
          "Triagem",
          "Fiscalização",
          "Equipe de Campo",
        ],
        classify: ["Administrador", "Gestor", "Triagem"],
        schedule: ["Administrador", "Gestor"],
        execute: ["Administrador", "Gestor", "Equipe de Campo"],
        validate: ["Administrador", "Gestor", "Fiscalização"],
        admin: ["Administrador"],
      } as Record<string, string[]>
    )[action].includes(boot.user.role);`;
  source = source.replace(oldCan, '  const can = (action: string) => Boolean(boot?.effective_permissions?.[action]);');
  source = source.replace('<th>Equipe</th>\n                        </tr>', '<th>Equipe</th>\n                          <th>Permissões</th>\n                        </tr>');
  source = source.replace('<td>{name(u.team_id)}</td>\n                          </tr>', '<td>{name(u.team_id)}</td>\n                            <td><button className="button secondary" onClick={() => setModal({ type: "permissions", user: u })}><ShieldCheck size={15}/>Configurar</button></td>\n                          </tr>');
  source = source.replace(
    '      {modal?.type === "user" && (',
    '      {modal?.type === "permissions" && (\n        <PermissionForm user={modal.user} api={api} onClose={() => setModal(null)} onSaved={async () => { await refresh(); setToast("Permissões atualizadas."); }} />\n      )}\n      {modal?.type === "user" && (',
  );
  return source;
});
