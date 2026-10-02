import {
  defaultModules,
  isMasterUser,
  moduleCatalog,
  canRoleAccessModule,
} from "../shared/authorization.mjs";
export async function userModules(db, user) {
  if (isMasterUser(user)) return moduleCatalog.map((m) => m.key);
  return (
    await db.all(
      "SELECT module FROM user_module_permissions WHERE user_id=? AND allowed=1",
      [user.id],
    )
  )
    .map((r) => r.module)
    .filter((m) => canRoleAccessModule(user.role, m));
}
export async function saveModules(db, user, modules) {
  const identity = await db.get("SELECT email,role FROM users WHERE id=?", [
    user.id,
  ]);
  if (isMasterUser(identity)) modules = moduleCatalog.map((m) => m.key);
  await db.run("DELETE FROM user_module_permissions WHERE user_id=?", [
    user.id,
  ]);
  const now = new Date().toISOString();
  for (const module of modules)
    await db.run(
      "INSERT INTO user_module_permissions(user_id,module,allowed,created_at,updated_at) VALUES(?,?,1,?,?)",
      [user.id, module, now, now],
    );
}
export async function initializeModules(db) {
  for (const user of await db.all("SELECT id,email,role FROM users"))
    await saveModules(db, user, defaultModules(user.role));
}
