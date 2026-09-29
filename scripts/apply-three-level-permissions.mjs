import { readFileSync, writeFileSync } from "node:fs";
const edit=(path,fn)=>{const before=readFileSync(path,"utf8"),after=fn(before);if(after===before)throw new Error(`Sem alteração: ${path}`);writeFileSync(path,after)};

edit("server/domain.js",s=>s
 .replace(/export const roles = \[[\s\S]*?\];\nexport const permissions = \{[\s\S]*?\n\};/,`export const roles = ["Coordenador", "Secretário", "Coordenador de Campo"];
export const permissions = {
  create: ["Coordenador", "Coordenador de Campo"],
  classify: ["Coordenador"],
  schedule: ["Coordenador", "Coordenador de Campo"],
  execute: ["Coordenador", "Coordenador de Campo"],
  validate: ["Coordenador"],
  analytics: ["Coordenador", "Secretário"],
  inventory: ["Coordenador"],
  admin: ["Coordenador"],
};`)
 .replace('user.role !== "Equipe de Campo"','user.role !== "Coordenador de Campo"'));

edit("server/user-permissions.js",s=>s
 .replace('{ key: "validate", label: "Analisar, validar e reabrir serviços", group: "Fiscalização" },','{ key: "validate", label: "Analisar, validar e reabrir serviços", group: "Gestão" },\n  { key: "analytics", label: "Consultar painéis analíticos", group: "Análise" },\n  { key: "inventory", label: "Gerenciar almoxarifado e notas fiscais", group: "Financeiro" },')
 .replace('user.role === "Administrador"','user.role === "Coordenador"'));

edit("server/db.js",s=>s.replace("  return db;\n}",`  if (!(await db.get("SELECT version FROM schema_migrations WHERE version=5"))) {
    await db.exec("BEGIN");
    try {
      await db.exec("CREATE TABLE IF NOT EXISTS user_permission_overrides (user_id TEXT NOT NULL REFERENCES users(id), permission TEXT NOT NULL, allowed INTEGER NOT NULL CHECK(allowed IN (0,1)), updated_at TEXT NOT NULL, PRIMARY KEY(user_id,permission)); CREATE INDEX IF NOT EXISTS idx_user_permission_user ON user_permission_overrides(user_id);");
      await db.run("UPDATE users SET role='Coordenador' WHERE role IN ('Administrador','Gestor')");
      await db.run("UPDATE users SET role='Secretário' WHERE role IN ('Triagem','Fiscalização','Consulta')");
      await db.run("UPDATE users SET role='Coordenador de Campo' WHERE role='Equipe de Campo'");
      await db.run("INSERT INTO schema_migrations(version, applied_at) VALUES(5, ?)", [new Date().toISOString()]);
      await db.exec("COMMIT");
    } catch (error) { await db.exec("ROLLBACK"); throw error; }
  }
  return db;
}`));

edit("server/seed.js",s=>s
 .replace(/"Administrador"/g,'"Coordenador"').replace(/"Gestor"/g,'"Coordenador"')
 .replace(/"Triagem"/g,'"Secretário"').replace(/"Fiscalização"/g,'"Secretário"').replace(/"Consulta"/g,'"Secretário"')
 .replace(/"Equipe de Campo"/g,'"Coordenador de Campo"'));

edit("server/field.js",s=>s.replace(/Equipe de Campo/g,"Coordenador de Campo"));
edit("server/sector-control.js",s=>s.replace('allow("schedule")','allow("analytics")'));
edit("server/inventory.js",s=>s.replace(/allow\("schedule"\)/g,'allow("inventory")'));
edit("server/invoices.js",s=>s.replace(/allow\("schedule"\)/g,'allow("inventory")'));

edit("server/app.js",s=>{
 s=s.replace('import { registerInventory, inventoryBalance } from "./inventory.js";','import { registerInventory, inventoryBalance } from "./inventory.js";\nimport { effectivePermissions, hasPermission, permissionCatalog, roleDefaults } from "./user-permissions.js";');
 s=s.replace(/  const allow = \(action\) => \(req, res, next\) =>\n    permissions\[action\]\.includes\(req\.user\.role\)\n      \? next\(\)\n      : res\.status\(403\)\.json\(\{ error: "[^"]+" \}\);/,`  const allow = (action) => async (req, res, next) => {
    try { if (await hasPermission(db, req.user, action)) return next(); return res.status(403).json({ error: "Você não tem permissão para esta ação." }); }
    catch (error) { next(error); }
  };`);
 s=s.replace('        user: req.user,\n        catalogs:','        user: req.user,\n        effective_permissions: await effectivePermissions(db, req.user),\n        permission_catalog: permissionCatalog,\n        catalogs:');
 s=s.replace('        operators: permissions.schedule.includes(req.user.role)','        operators: (await hasPermission(db, req.user, "schedule"))');
 s=s.replace(/role='Equipe de Campo'/g,"role='Coordenador de Campo'").replace(/!== "Equipe de Campo"/g,'!== "Coordenador de Campo"').replace(/=== "Equipe de Campo"/g,'=== "Coordenador de Campo"');
 const marker='  app.patch(\n    "/api/settings",';
 const routes=`  app.get("/api/users/:id/permissions", allow("admin"), route(async (req) => {
    const user=await db.get("SELECT id,name,email,role,team_id FROM users WHERE id=?",[req.params.id]); if(!user) fail(404,"Usuário não encontrado.");
    const rows=await db.all("SELECT permission,allowed FROM user_permission_overrides WHERE user_id=?",[user.id]);
    return {user,catalog:permissionCatalog,defaults:roleDefaults(user.role),effective:await effectivePermissions(db,user),overrides:Object.fromEntries(rows.map(row=>[row.permission,Boolean(row.allowed)]))};
  }));
  app.patch("/api/users/:id/permissions", allow("admin"), route(async (req) => {
    const user=await db.get("SELECT id,name,email,role,team_id FROM users WHERE id=?",[req.params.id]); if(!user) fail(404,"Usuário não encontrado.");
    const values=req.body?.permissions,valid=new Set(permissionCatalog.map(item=>item.key));
    if(!values||typeof values!=="object"||Array.isArray(values)||Object.keys(values).some(key=>!valid.has(key)||![true,false,null].includes(values[key]))) fail(400,"Existe uma permissão inválida.");
    if(user.role==="Coordenador"&&values.admin===false) fail(400,"O acesso administrativo do Coordenador não pode ser bloqueado.");
    const before=await effectivePermissions(db,user); await db.run("DELETE FROM user_permission_overrides WHERE user_id=?",[user.id]);
    for(const [permission,allowed] of Object.entries(values)) if(allowed!==null) await db.run("INSERT INTO user_permission_overrides(user_id,permission,allowed,updated_at) VALUES(?,?,?,?)",[user.id,permission,allowed?1:0,now()]);
    const after=await effectivePermissions(db,user); await audit(req,"user",user.id,"Permissões individuais atualizadas",before,after); return {effective:after};
  },true));
`;
 if(!s.includes(marker))throw new Error("Marcador de rotas não encontrado"); s=s.replace(marker,routes+marker); return s;
});

edit("src/main.tsx",s=>{
 s=s.replace('import InvoicePanel from "./InvoicePanel";','import InvoicePanel from "./InvoicePanel";\nimport PermissionForm from "./PermissionForm";\nimport "./permissions.css";');
 s=s.replace('  operators: Row[];\n};','  operators: Row[];\n  effective_permissions: Record<string, boolean>;\n  permission_catalog: Row[];\n};');
 s=s.replace(/    if \(b\.user\.role === "Administrador"\)/g,'    if (b.effective_permissions.admin)').replace(/Equipe de Campo/g,'Coordenador de Campo').replace(/role: "Consulta"/g,'role: "Secretário"');
 s=s.replace(/  const can = \(action: string\) =>[\s\S]*?\[action\]\.includes\(boot\.user\.role\);/,'  const can = (action: string) => Boolean(boot?.effective_permissions?.[action]);');
 s=s.replace('<th>Equipe</th>\n                        </tr>','<th>Equipe</th>\n                          <th>Permissões</th>\n                        </tr>');
 s=s.replace('<td>{name(u.team_id)}</td>\n                          </tr>','<td>{name(u.team_id)}</td>\n                            <td><button className="button secondary" onClick={() => setModal({ type: "permissions", user: u })}><ShieldCheck size={15}/>Configurar</button></td>\n                          </tr>');
 s=s.replace('      {modal?.type === "user" && (','      {modal?.type === "permissions" && (\n        <PermissionForm user={modal.user} api={api} onClose={() => setModal(null)} onSaved={async () => { await refresh(); setToast("Permissões atualizadas."); }} />\n      )}\n      {modal?.type === "user" && (');
 s=s.replace('{can("schedule") && <InventoryPanel','{can("inventory") && <InventoryPanel');
 s=s.replace('canManage={can("schedule")}', 'canManage={can("inventory")}');
 return s;
});

edit("src/PermissionForm.tsx",s=>s.replace('user.role === "Administrador"','user.role === "Coordenador"'));

for(const path of ["tests/api.test.js"]){edit(path,s=>s.replace(/'Consulta'/g,"'Secretário'").replace(/'Equipe de Campo'/g,"'Coordenador de Campo'"));}
