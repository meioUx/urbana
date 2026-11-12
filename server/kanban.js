import { z } from "zod";
import { kanbanColumns, closedStatus } from "../shared/kanban.mjs";
import { permissions } from "./domain.js";
import { jsonField, orderAccess } from "./modules/listing/index.js";

export function kanbanService(db, fail) {
  const read = async () => {
    const row = await db.get("SELECT value FROM settings WHERE id='kanban'");
    return row ? JSON.parse(row.value) : { revision: 0, limits: {}, order: {} };
  };
  // A board card is an occurrence without an order, or an order.
  const looseOccurrences =
    "SELECT id,status FROM occurrences WHERE NOT EXISTS (SELECT 1 FROM order_occurrences r WHERE r.occurrence_id=occurrences.id)";
  const cardKeys = async (status) => [
    ...(await db.all(`${looseOccurrences} AND status=?`, [status])).map(
      (c) => `occurrence:${c.id}`,
    ),
    ...(await db.all("SELECT id FROM orders WHERE status=?", [status])).map(
      (c) => `order:${c.id}`,
    ),
  ];
  // Cards per status, counted in the database (runs before and after every write when WIP limits
  // are set). One statement, so both halves come from the same snapshot.
  const counts = async () =>
    Object.fromEntries(
      (
        await db.all(
          `SELECT status,COUNT(*) AS total FROM (${looseOccurrences} UNION ALL SELECT id,status FROM orders) cards GROUP BY status`,
        )
      ).map((row) => [row.status, Number(row.total)]),
    );
  const snapshot = async () => {
    const config = await read();
    return Object.values(config.limits).some((n) => n > 0)
      ? { config, counts: await counts() }
      : null;
  };
  const enforce = async (before) => {
    if (!before) return;
    const after = await counts();
    for (const [status, limit] of Object.entries(before.config.limits)) {
      if (
        limit > 0 &&
        (after[status] || 0) > limit &&
        (after[status] || 0) > (before.counts[status] || 0)
      ) {
        const column = kanbanColumns.find((c) => c.status === status);
        fail(
          409,
          `${column.title} atingiu o limite de trabalho (${limit}). Finalize ou mova um cartão antes de receber outro.`,
          { wip: status },
        );
      }
    }
  };
  const save = async (config) => {
    const next = { ...config, revision: config.revision + 1 };
    await db.run(
      "INSERT INTO settings(id,value) VALUES('kanban',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      [JSON.stringify(next)],
    );
    return next;
  };
  // Board cards with the minimal projection the board uses (card, filters, sorting, WIP, team load
  // and move dialog). Every open card is returned; Concluídas are limited to the ones completed in
  // the last `concluidas_dias` days (0 = all) and Canceladas/Recusadas are only returned with
  // `encerradas=1` (same window, by updated_at). `counts` always has the full board per status.
  const cardsQuery = z.object({
    concluidas_dias: z.coerce.number().int().min(0).max(36500).default(30),
    encerradas: z.enum(["0", "1"]).default("0"),
  });
  const cards = async (req) => {
    const q = cardsQuery.parse(req.query);
    const j = (key, prefix = "") => jsonField(db, key, prefix);
    const since = q.concluidas_dias
      ? new Date(Date.now() - q.concluidas_dias * 86400000).toISOString()
      : null;
    const window = (expr) => (since ? ` AND ${expr}>=?` : "");
    const windowArgs = since ? [since] : [];
    // Config is read first: if a write lands in between, the revision is older than the cards and
    // POST /api/kanban/ordem answers 409 (it checks the live cards), so nothing is lost.
    {
      const config = await read();
      const access = orderAccess(db, req.user, "o.");
      const occurrenceFields = (p) =>
        `${p}id AS id,${p}code AS code,${j("address", p)} AS address,${j("neighborhood", p)} AS neighborhood,${j("description", p)} AS description,${p}category_id AS category_id,${j("subcategory", p)} AS subcategory`;
      const looseRows = await db.all(
        `SELECT ${occurrenceFields("c.")},c.status,c.priority,c.sector_id,c.created_at,${j("rejection_reason", "c.")} AS rejection_reason,c.version FROM occurrences c WHERE NOT EXISTS (SELECT 1 FROM order_occurrences r WHERE r.occurrence_id=c.id) AND (c.status NOT IN ('CONCLUIDA','CANCELADA','RECUSADA') OR (c.status='CONCLUIDA'${window("c.updated_at")})${q.encerradas === "1" ? ` OR (c.status IN ('CANCELADA','RECUSADA')${window("c.updated_at")})` : ""})`,
        [...windowArgs, ...(q.encerradas === "1" ? windowArgs : [])],
      );
      const orderRows = await db.all(
        `SELECT o.id,o.code,o.status,o.priority,o.sector_id,o.team_id,o.due_at,o.created_at,o.version,${j("scheduled_at", "o.")} AS scheduled_at,${j("completed_at", "o.")} AS completed_at,${j("responsible", "o.")} AS responsible,${j("return_reason", "o.")} AS return_reason,${j("assigned_user_id", "o.")} AS assigned_user_id FROM orders o WHERE ${access.sql} AND (o.status NOT IN ('CONCLUIDA','CANCELADA','RECUSADA') OR (o.status='CONCLUIDA'${window(j("completed_at", "o."))})${q.encerradas === "1" ? ` OR (o.status IN ('CANCELADA','RECUSADA')${window("o.updated_at")})` : ""})`,
        [
          ...access.params,
          ...windowArgs,
          ...(q.encerradas === "1" ? windowArgs : []),
        ],
      );
      // Occurrences of the returned orders, in link order (order_id, occurrence_id) as occurrence_ids before.
      const ids = orderRows.map((o) => o.id);
      const linked = new Map();
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        for (const row of await db.all(
          `SELECT r.order_id,${occurrenceFields("c.")} FROM order_occurrences r JOIN occurrences c ON c.id=r.occurrence_id WHERE r.order_id IN (${chunk.map(() => "?").join(",")}) ORDER BY r.order_id,r.occurrence_id`,
          chunk,
        )) {
          const { order_id, ...occurrence } = row;
          if (!linked.has(order_id)) linked.set(order_id, []);
          linked.get(order_id).push(occurrence);
        }
      }
      const clean = (row) =>
        Object.fromEntries(
          Object.entries(row).filter(([, v]) => v !== null && v !== undefined),
        );
      const cardsList = [
        ...looseRows.map((row) => {
          const { address, neighborhood, description, ...card } = clean(row);
          const occurrence = clean({
            id: row.id,
            code: row.code,
            address,
            neighborhood,
            description,
            category_id: row.category_id,
            subcategory: row.subcategory,
          });
          return {
            ...card,
            type: "occurrence",
            team_id: "",
            occurrences: [occurrence],
          };
        }),
        ...orderRows.map((row) => {
          const occurrences = (linked.get(row.id) || []).map(clean);
          return {
            ...clean(row),
            type: "order",
            occurrence_ids: occurrences.map((o) => o.id),
            occurrences,
          };
        }),
      ];
      return {
        ...config,
        counts: await counts(),
        concluidas_dias: q.concluidas_dias,
        encerradas: q.encerradas === "1",
        cards: cardsList,
      };
    }
  };
  const register = (app, { route, audit, allow }) => {
    app.get("/api/kanban", route(read));
    app.get("/api/kanban/cartoes", route(cards));
    app.patch(
      "/api/kanban",
      allow("schedule"),
      route(async (req) => {
        const { revision, limits } = z
          .object({
            revision: z.number().int().min(0),
            limits: z.record(
              z.enum(
                kanbanColumns
                  .filter((c) => !closedStatus(c.status))
                  .map((c) => c.status),
              ),
              z.number().int().min(0).max(999),
            ),
          })
          .parse(req.body);
        const current = await read();
        if (current.revision !== revision)
          fail(
            409,
            "O quadro foi atualizado por outra pessoa. Atualize e tente novamente.",
          );
        const next = await save({ ...current, limits });
        await audit(
          req,
          "kanban",
          "board",
          "Limites de trabalho atualizados",
          current.limits,
          limits,
        );
        return next;
      }, true),
    );
    app.post(
      "/api/kanban/ordem",
      route(async (req) => {
        if (
          ![
            ...permissions.classify,
            ...permissions.schedule,
            ...permissions.validate,
          ].includes(req.user.role)
        )
          fail(403, "Seu perfil não permite ordenar o quadro.");
        const { revision, status, keys } = z
          .object({
            revision: z.number().int().min(0),
            status: z.enum(kanbanColumns.map((c) => c.status)),
            keys: z.array(z.string().max(100)).max(10000),
          })
          .parse(req.body);
        const current = await read();
        if (revision !== current.revision)
          fail(409, "A ordem do quadro mudou. Atualize e tente novamente.");
        const live = await cardKeys(status);
        const requested = new Set(keys);
        if (
          requested.size !== keys.length ||
          keys.length !== live.length ||
          live.some((key) => !requested.has(key))
        )
          fail(
            409,
            "Os cartões desta etapa mudaram. Atualize o quadro antes de ordenar.",
          );
        const next = await save({
          ...current,
          order: { ...current.order, [status]: keys },
        });
        await audit(
          req,
          "kanban",
          status,
          "Ordem dos cartões atualizada",
          current.order[status],
          keys,
        );
        return next;
      }, true),
    );
  };
  return { read, snapshot, enforce, register };
}
