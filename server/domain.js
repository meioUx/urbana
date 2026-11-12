import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
export { statuses } from "./domain/workflow.js";
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
export { actionRoles as permissions } from "../shared/authorization.mjs";
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function checkPassword(password, hash) {
  const [salt, key] = String(hash ?? "").split(":");
  // Rows without a valid scrypt hash (the portal's system actor) never accept any password.
  const expected = Buffer.from(key ?? "", "hex");
  if (!salt || expected.length !== 64) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), expected);
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
// Occurrence rows that can be within `radius` meters of `point` (by `distance` above): a lat/lng
// box that always contains the circle, so callers still apply the exact distance filter. Rows keep
// the physical table order (what the previous unfiltered `SELECT * FROM occurrences` returned), so
// ties in distance and the duplicate list order stay the same. Falls back to every row when the box
// cannot be bounded safely (invalid radius, poles, antimeridian).
export function nearbyOccurrenceRows(db, point, radius) {
  const order = db.dialect === "postgres" ? "ctid" : "rowid";
  const r = Number(radius);
  const angle = r / 6371000; // radians, same Earth radius as distance()
  const lat = Number(point.lat),
    lng = Number(point.lng);
  const deg = (n) => (n * 180) / Math.PI;
  const margin = (n) => n * 1.01 + 1e-9;
  if (
    !(
      Number.isFinite(r) &&
      r >= 0 &&
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    ) ||
    angle >= 0.5
  )
    return db.all(`SELECT * FROM occurrences ORDER BY ${order}`);
  // Great-circle distance is at least the latitude difference.
  const dLat = margin(deg(angle));
  const conditions = ["lat>=? AND lat<=?"],
    args = [lat - dLat, lat + dLat];
  // Within the band, cos(lat) >= cos(|lat|+dLat): bound the longitude difference from the haversine.
  const polar = (Math.abs(lat) + dLat) * (Math.PI / 180);
  if (polar < Math.PI / 2 - 0.01) {
    const s =
      Math.sin(angle / 2) /
      Math.sqrt(Math.cos((lat * Math.PI) / 180) * Math.cos(polar));
    if (s < 1) {
      const dLng = margin(deg(2 * Math.asin(s)));
      if (lng - dLng > -180 && lng + dLng < 180) {
        conditions.push("lng>=? AND lng<=?");
        args.push(lng - dLng, lng + dLng);
      }
    }
  }
  return db.all(
    `SELECT * FROM occurrences WHERE ${conditions.join(" AND ")} ORDER BY ${order}`,
    args,
  );
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
