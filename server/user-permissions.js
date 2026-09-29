import { permissions as rolePermissions } from "./domain.js";

export const permissionCatalog = [
  { key: "create", label: "Registrar ocorrências", group: "Operação" },
  { key: "classify", label: "Classificar e fazer triagem", group: "Operação" },
  { key: "schedule", label: "Planejar, distribuir OS e gerir estoque", group: "Gestão" },
  { key: "execute", label: "Executar OS e registrar materiais", group: "Campo" },
  { key: "validate", label: "Analisar, validar e reabrir serviços", group: "Fiscalização" },
  { key: "admin", label: "Administrar usuários e cadastros", group: "Administração" },
];

export const roleDefaults = (role) => Object.fromEntries(permissionCatalog.map(({ key }) => [key, rolePermissions[key]?.includes(role) || false]));

export async function effectivePermissions(db, user) {
  const result = roleDefaults(user.role);
  const overrides = await db.all("SELECT permission,allowed FROM user_permission_overrides WHERE user_id=?", [user.id]);
  for (const override of overrides) if (override.permission in result) result[override.permission] = Boolean(override.allowed);
  if (user.role === "Administrador") result.admin = true;
  return result;
}

export async function hasPermission(db, user, permission) {
  return Boolean((await effectivePermissions(db, user))[permission]);
}
