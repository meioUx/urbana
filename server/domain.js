import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
export const statuses = [
  "IDENTIFICADA",
  "EM_TRIAGEM",
  "PROGRAMADA",
  "EM_DESLOCAMENTO",
  "EM_EXECUCAO",
  "AGUARDANDO_VALIDACAO",
  "DEVOLVIDA",
  "CONCLUIDA",
  "CANCELADA",
];
export const priorities = [
  "Emergencial",
  "Alta",
  "Média",
  "Baixa",
  "Programada",
];
export const roles = [
  "Administrador",
  "Gestor",
  "Triagem",
  "Equipe de Campo",
  "Fiscalização",
  "Consulta",
];
export const permissions = {
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
};
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function checkPassword(password, hash) {
  const [salt, key] = hash.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(key, "hex"),
  );
}
export function distance(a, b) {
  const rad = (n) => (n * Math.PI) / 180;
  const dLat = rad(a.lat - b.lat),
    dLng = rad(a.lng - b.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export const unpack = (row) =>
  row
    ? {
        ...JSON.parse(row.data || "{}"),
        ...Object.fromEntries(
          Object.entries(row).filter(([k]) => k !== "data"),
        ),
      }
    : null;
export const now = () => new Date().toISOString();

export const canAccessOrder = (user, order) =>
  user.role !== "Equipe de Campo" ||
  (order.team_id === user.team_id &&
    (!order.assigned_user_id || order.assigned_user_id === user.id));
