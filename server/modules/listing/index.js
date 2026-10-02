import { z } from "zod";
import { unpack } from "../../domain.js";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Data inválida.");
const schema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(2000).optional(),
  from: date.optional(),
  to: date.optional(),
  q: z.string().max(200).optional(),
  status: z.string().max(100).optional(),
  priority: z.string().max(100).optional(),
  sector_id: z.string().max(200).optional(),
  category_id: z.string().max(200).optional(),
  team_id: z.string().max(200).optional(),
  neighborhood: z.string().max(200).optional(),
  entity_type: z.string().max(100).optional(),
  entity_id: z.string().max(200).optional(),
  user_id: z.string().max(200).optional(),
  event: z.string().max(200).optional(),
  material_id: z.string().max(200).optional(),
  order_id: z.string().max(200).optional(),
  type: z.enum(["entrada", "saida"]).optional(),
  deadline: z.enum(["late", "soon", "ontime"]).optional(),
  bbox: z.string().max(200).optional(),
});
const json = (db, key, prefix = "") =>
  db.dialect === "postgres"
    ? `(${prefix}data::jsonb ->> '${key}')`
    : `json_extract(${prefix}data, '$.${key}')`;
export async function listRecords(
  db,
  kind,
  query = {},
  user,
  { paginate = true } = {},
) {
  if (
    !["occurrences", "orders", "audit_logs", "inventory_movements"].includes(
      kind,
    )
  )
    throw new TypeError("Listagem inválida.");
  const q = schema.parse(query),
    params = [],
    conditions = [];
  if (q.from && q.to && q.from > q.to)
    throw Object.assign(new Error("Período inválido."), { status: 400 });
  const audit = kind === "audit_logs",
    inventory = kind === "inventory_movements",
    raw = audit || inventory,
    alias = audit ? "a." : inventory ? "m." : "";
  const add = (sql, ...args) => {
    conditions.push(sql);
    params.push(...args);
  };
  for (const key of audit
    ? ["entity_type", "entity_id", "user_id", "event"]
    : inventory
      ? ["material_id", "order_id", "user_id", "type"]
      : kind === "orders"
        ? ["status", "priority", "sector_id", "team_id"]
        : ["status", "priority", "category_id", "sector_id"])
    if (q[key]) {
      if (key === "status" && q[key].includes(",")) {
        const values = q[key].split(",");
        add(
          `${alias}status IN (${values.map(() => "?").join(",")})`,
          ...values,
        );
      } else add(`${alias}${key}=?`, q[key]);
    }
  if (!audit && q.neighborhood && kind === "occurrences")
    add(`${json(db, "neighborhood")}=?`, q.neighborhood);
  if (q.from) add(`${alias}created_at>=?`, q.from + "T00:00:00.000Z");
  if (q.to) {
    const end = new Date(q.to + "T00:00:00.000Z");
    end.setUTCDate(end.getUTCDate() + 1);
    add(`${alias}created_at<?`, end.toISOString());
  }
  if (q.q && !raw) {
    const fields =
      kind === "occurrences"
        ? [
            "code",
            json(db, "address"),
            json(db, "description"),
            json(db, "neighborhood"),
          ]
        : [
            "code",
            json(db, "responsible"),
            `(SELECT ${json(db, "name", "c.")} FROM catalogs c WHERE c.id=orders.team_id)`,
          ];
    // Escape LIKE metacharacters; substring searches never interpret user wildcards.
    const term =
      "%" + q.q.toLocaleLowerCase("pt-BR").replace(/[!%_]/g, "!$&") + "%";
    add(
      "(" +
        fields
          .map((f) => `LOWER(COALESCE(${f},'')) LIKE ? ESCAPE '!'`)
          .join(" OR ") +
        ")",
      ...fields.map(() => term),
    );
  }
  if (kind === "orders" && user?.role === "Equipe de Campo")
    add(
      `team_id=? AND (${json(db, "assigned_user_id")} IS NULL OR ${json(db, "assigned_user_id")}='' OR ${json(db, "assigned_user_id")}=?)`,
      user.team_id,
      user.id,
    );
  if (kind === "orders" && q.deadline) {
    const stamp = new Date().toISOString(),
      tomorrow = new Date(Date.now() + 86400000).toISOString();
    add("status NOT IN ('CONCLUIDA','CANCELADA','RECUSADA')");
    if (q.deadline === "late") add("due_at<?", stamp);
    else if (q.deadline === "soon")
      add("due_at>=? AND due_at<=?", stamp, tomorrow);
    else add("due_at>?", tomorrow);
  }
  if (q.bbox && kind === "occurrences") {
    const box = q.bbox.split(",").map(Number);
    if (
      box.length !== 4 ||
      !box.every(Number.isFinite) ||
      box[0] < -180 ||
      box[2] > 180 ||
      box[1] < -90 ||
      box[3] > 90 ||
      box[0] >= box[2] ||
      box[1] >= box[3]
    )
      throw Object.assign(new Error("bbox inválido: west,south,east,north."), {
        status: 400,
      });
    if (db.dialect === "postgres")
      add("geom && ST_MakeEnvelope(?,?,?, ?,4326)", ...box);
    else add("lng>=? AND lat>=? AND lng<=? AND lat<=?", ...box);
  }
  const paged = paginate && (q.limit !== undefined || q.cursor !== undefined);
  // Bind cursors to resource and filter context; reject accidental reuse across lists.
  const signature = JSON.stringify([
    kind,
    Object.fromEntries(
      Object.entries(q)
        .filter(([k]) => !["cursor", "limit"].includes(k))
        .sort(),
    ),
    user?.role === "Equipe de Campo" ? [user.id, user.team_id] : null,
  ]);
  if (q.cursor) {
    let c;
    try {
      c = JSON.parse(Buffer.from(q.cursor, "base64url").toString());
    } catch {
      throw Object.assign(new Error("Cursor inválido."), { status: 400 });
    }
    if (
      c?.signature !== signature ||
      typeof c.id !== "string" ||
      typeof c.created_at !== "string"
    )
      throw Object.assign(new Error("Cursor incompatível com os filtros."), {
        status: 400,
      });
    add(
      `(${alias}created_at<? OR (${alias}created_at=? AND ${alias}id<?))`,
      c.created_at,
      c.created_at,
      c.id,
    );
  }
  const limit = q.limit ?? 100;
  const sql = `SELECT ${audit ? "a.*,u.name AS user_name" : inventory ? "m.*,u.name AS user_name,o.code AS order_code" : "*"} FROM ${kind}${audit ? " a JOIN users u ON u.id=a.user_id" : inventory ? " m JOIN users u ON u.id=m.user_id LEFT JOIN orders o ON o.id=m.order_id" : ""}${conditions.length ? " WHERE " + conditions.join(" AND ") : ""} ORDER BY ${alias}created_at DESC,${alias}id DESC${paged ? " LIMIT ?" : audit ? " LIMIT 300" : inventory ? " LIMIT 100" : ""}`;
  const rows = await db.all(sql, paged ? [...params, limit + 1] : params);
  if (!paged) return raw ? rows : rows.map(unpack);
  const more = rows.length > limit,
    items = rows.slice(0, limit).map((r) => (raw ? r : unpack(r))),
    last = items.at(-1);
  return {
    items,
    has_more: more,
    next_cursor: more
      ? Buffer.from(
          JSON.stringify({
            id: last.id,
            created_at: last.created_at,
            signature,
          }),
        ).toString("base64url")
      : null,
  };
}
