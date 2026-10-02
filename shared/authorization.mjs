export const actionRoles = {
  create: [
    "Administrador",
    "Gestor",
    "Triagem",
    "Fiscalização",
    "Equipe de Campo",
  ],
  classify: ["Administrador", "Gestor", "Triagem"],
  schedule: ["Administrador", "Gestor"],
  execute: ["Equipe de Campo"],
  validate: ["Administrador", "Gestor", "Fiscalização"],
  admin: ["Administrador"],
};
export const moduleCatalog = [
  ["dashboard", "Visão geral", "/"],
  ["map", "Mapa territorial", "/mapa"],
  ["occurrences", "Ocorrências", "/ocorrencias"],
  ["triagem", "Triagem", "/triagem"],
  ["kanban", "Kanban de equipes", "/kanban"],
  ["planning", "Planejamento", "/planejamento"],
  ["orders", "Ordens de serviço", "/ordens-servico"],
  ["sector-control", "Controle do setor", "/controle-setor"],
  ["review", "Análise de campo", "/fiscalizacao"],
  ["field", "Operação de campo", "/campo"],
  ["teams", "Equipes", "/equipes"],
  ["materials", "Materiais / Almoxarifado", "/materiais"],
  ["equipment", "Equipamentos", "/equipamentos"],
  ["admin", "Administração", "/admin"],
].map(([key, label, path]) => ({ key, label, path }));
const management = [
  "dashboard",
  "map",
  "occurrences",
  "triagem",
  "kanban",
  "planning",
  "orders",
  "sector-control",
  "review",
  "teams",
  "materials",
  "equipment",
];
export const roleModules = {
  Administrador: [...management, "admin"],
  Gestor: management,
  Triagem: ["dashboard", "map", "occurrences", "triagem", "kanban"],
  "Equipe de Campo": ["field"],
  Fiscalização: [
    "dashboard",
    "map",
    "occurrences",
    "orders",
    "review",
    "kanban",
  ],
  Consulta: [
    "dashboard",
    "map",
    "occurrences",
    "orders",
    "kanban",
    "planning",
    "teams",
    "materials",
    "equipment",
  ],
};
export const canRoleAccessModule = (role, module) =>
  (roleModules[role] || []).includes(module);
export const defaultModules = (role) => [...(roleModules[role] || [])];
export const MASTER_EMAIL = "admin@urbana.local";
export const isMasterUser = (user) =>
  user?.role === "Administrador" &&
  user?.email?.trim().toLowerCase() === MASTER_EMAIL;
export const canPerformAction = (user, action) =>
  !!actionRoles[action] &&
  (isMasterUser(user) || actionRoles[action].includes(user?.role));
export const hasModuleAccess = (user, module) =>
  moduleCatalog.some((m) => m.key === module) &&
  (isMasterUser(user) ||
    (canRoleAccessModule(user?.role, module) &&
      Array.isArray(user?.modules) &&
      user.modules.includes(module)));
export const moduleForPath = (path) =>
  path.startsWith("/admin")
    ? "admin"
    : moduleCatalog.find((m) => m.path === path)?.key;
export const landingModule = (user) => {
  const preferred = {
    "Equipe de Campo": "field",
    Triagem: "triagem",
    Fiscalização: "review",
    Administrador: "dashboard",
    Gestor: "dashboard",
    Consulta: "dashboard",
  }[user.role];
  return hasModuleAccess(user, preferred)
    ? preferred
    : moduleCatalog.find((m) => hasModuleAccess(user, m.key))?.key;
};
// API dependencies share record reads, while each mutation requires its own module.
export function apiModules(path, method) {
  const p = path.replace(/^\/api/, "");
  const read = ["GET", "HEAD"].includes(method);
  if (p.startsWith("/auth/") || p === "/bootstrap" || p === "/onboarding")
    return null;
  if (/^\/users(?:\/|$)|^\/settings|^\/auditoria/.test(p)) return ["admin"];
  if (p.startsWith("/campo")) return ["field"];
  if (p.startsWith("/dashboard")) return ["dashboard"];
  if (p.startsWith("/mapa")) return ["map"];
  if (p.startsWith("/planejamento") || p.startsWith("/planos-acao"))
    return ["planning"];
  if (p.startsWith("/controle-setor")) return ["sector-control"];
  if (p.startsWith("/kanban")) return ["kanban"];
  if (
    p.startsWith("/almoxarifado") ||
    p.startsWith("/notas-fiscais") ||
    p.includes("/notas-fiscais/")
  )
    return ["materials"];
  if (p.startsWith("/ocorrencias")) {
    if (read)
      return [
        "occurrences",
        "triagem",
        "planning",
        "kanban",
        "orders",
        "review",
        "map",
        "dashboard",
        "field",
      ];
    if (/\/(classificar|encaminhar|recusar)$/.test(p) || method === "PATCH")
      return ["triagem"];
    return ["occurrences", "field"];
  }
  if (p.startsWith("/ordens-servico")) {
    if (read)
      return [
        "orders",
        "planning",
        "kanban",
        "review",
        "dashboard",
        "sector-control",
        "field",
      ];
    if (
      /\/(assumir|iniciar|chegada|concluir|devolver|material|equipamento)$/.test(
        p,
      )
    )
      return ["field"];
    if (/\/(validar|reabrir)$/.test(p)) return ["review"];
    if (p.endsWith("/anexos")) return ["field"];
    return ["orders", "planning"];
  }
  if (p.startsWith("/anexos"))
    return ["occurrences", "triagem", "orders", "review", "field"];
  const kind = p.split("/")[1];
  if (
    [
      "secretarias",
      "departamentos",
      "setores",
      "equipes",
      "categorias",
      "materiais",
      "equipamentos",
    ].includes(kind)
  ) {
    if (!read) return ["admin"];
    return kind === "equipes"
      ? ["teams", "planning", "orders", "field"]
      : kind === "materiais"
        ? ["materials", "field"]
        : kind === "equipamentos"
          ? ["equipment", "field"]
          : ["admin", "triagem", "occurrences", "planning", "orders", "field"];
  }
  return [];
}
