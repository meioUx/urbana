import { z } from "zod";
import { kanbanColumns, closedStatus } from "../shared/kanban.mjs";
import { permissions } from "./domain.js";

export function kanbanService(db, fail) {
  const read = async () => {
    const row = await db.get("SELECT value FROM settings WHERE id='kanban'");
    return row ? JSON.parse(row.value) : { revision: 0, limits: {}, order: {} };
  };
  const cards = async () => [
    ...(
      await db.all(
        "SELECT id,status FROM occurrences WHERE NOT EXISTS (SELECT 1 FROM order_occurrences r WHERE r.occurrence_id=occurrences.id)",
      )
    ).map((c) => ({ ...c, key: `occurrence:${c.id}` })),
    ...(await db.all("SELECT id,status FROM orders")).map((c) => ({
      ...c,
      key: `order:${c.id}`,
    })),
  ];
  const counts = async () =>
    (await cards()).reduce((result, card) => {
      result[card.status] = (result[card.status] || 0) + 1;
      return result;
    }, {});
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
  const register = (app, { route, audit, allow }) => {
    app.get("/api/kanban", route(read));
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
        const live = (await cards())
          .filter((c) => c.status === status)
          .map((c) => c.key);
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
