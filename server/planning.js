import { randomUUID } from "node:crypto";
import { z } from "zod";
import { priorities, unpack, now, canAccessOrder } from "./domain.js";

const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function streetIdentity(row) {
  const street = String(row.address || "")
    .split(",")[0]
    .replace(/\s+(?:n[º°.]?\s*|numero\s+)\d+.*$/i, "")
    .trim();
  const normalized = normalize(street)
    .replace(/^r\s+/, "rua ")
    .replace(/^av\s+/, "avenida ");
  return {
    street,
    key: JSON.stringify([normalized, normalize(row.neighborhood)]),
  };
}
export function planningPriority(rows) {
  const highest =
    priorities.find((p) => rows.some((o) => o.priority === p)) || "Baixa";
  return rows.length >= 2 && priorities.indexOf(highest) > 1 ? "Alta" : highest;
}
export function groupStreets(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (["CONCLUIDA", "CANCELADA"].includes(row.status)) continue;
    const { street, key } = streetIdentity(row);
    if (!street || !row.neighborhood) continue;
    if (!groups.has(key))
      groups.set(key, {
        key,
        street,
        neighborhood: row.neighborhood,
        occurrences: [],
      });
    groups.get(key).occurrences.push(row);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      priority: planningPriority(g.occurrences),
      oldest_at: g.occurrences.reduce(
        (a, o) => (o.created_at < a ? o.created_at : a),
        g.occurrences[0].created_at,
      ),
    }))
    .sort(
      (a, b) =>
        priorities.indexOf(a.priority) - priorities.indexOf(b.priority) ||
        b.occurrences.length - a.occurrences.length ||
        a.oldest_at.localeCompare(b.oldest_at),
    );
}
export function registerPlanning(app, db, { route, allow, audit, fail }) {
  app.get(
    "/api/planejamento",
    route(async (req) => {
      const occurrences = (
        await db.all("SELECT * FROM occurrences ORDER BY created_at")
      ).map(unpack);
      const links = await db.all("SELECT * FROM action_plan_occurrences");
      const planRows = (
        await db.all("SELECT * FROM action_plans ORDER BY created_at DESC")
      ).map(unpack);
      const orders = (
        await db.all("SELECT * FROM orders ORDER BY created_at DESC")
      ).map(unpack);
      const orderLinks = await db.all("SELECT * FROM order_occurrences");
      const plans = planRows.map((p) => {
        const members = occurrences.filter((o) =>
          links.some((l) => l.plan_id === p.id && l.occurrence_id === o.id),
        );
        const completed = members.filter(
          (o) => o.status === "CONCLUIDA",
        ).length;
        const cancelled = members.filter(
          (o) => o.status === "CANCELADA",
        ).length;
        const status =
          completed === members.length
            ? "Concluído"
            : completed + cancelled === members.length
              ? "Encerrado com cancelamentos"
              : members.some((o) =>
                    [
                      "EM_DESLOCAMENTO",
                      "EM_EXECUCAO",
                      "AGUARDANDO_VALIDACAO",
                    ].includes(o.status),
                  )
                ? "Em execução"
                : "Planejado";
        return {
          ...p,
          occurrences: members,
          completed,
          cancelled,
          status,
          orders: orders.filter(
            (o) =>
              (o.plan_id === p.id ||
                orderLinks.some(
                  (l) =>
                    l.order_id === o.id &&
                    members.some((m) => m.id === l.occurrence_id),
                )) &&
              canAccessOrder(req.user, o),
          ),
        };
      });
      return {
        groups: groupStreets(occurrences).map((g) => ({
          ...g,
          occurrences: g.occurrences.map((o) => ({
            ...o,
            plan_id:
              links.find((l) => l.occurrence_id === o.id)?.plan_id || null,
          })),
        })),
        plans,
      };
    }),
  );
  app.post(
    "/api/planos-acao",
    allow("schedule"),
    route(async (req) => {
      const data = z
        .object({
          occurrence_ids: z.array(z.string().min(1)).min(2).max(100),
          objective: z.string().trim().min(5).max(3000),
          responsible: z.string().trim().min(1).max(200),
          scheduled_at: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine((v) => {
              const d = new Date(v);
              return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
            }, "Data inválida."),
        })
        .parse(req.body);
      if (new Set(data.occurrence_ids).size !== data.occurrence_ids.length)
        fail(400, "Ocorrências repetidas.");
      const rows = [];
      for (const id of data.occurrence_ids) {
        const row = unpack(
          await db.get("SELECT * FROM occurrences WHERE id=?", [id]),
        );
        if (!row) fail(404, "Ocorrência não encontrada.");
        if (["CONCLUIDA", "CANCELADA"].includes(row.status))
          fail(409, "O plano deve conter apenas ocorrências abertas.");
        if (
          await db.get(
            "SELECT plan_id FROM action_plan_occurrences WHERE occurrence_id=?",
            [id],
          )
        )
          fail(
            409,
            "Uma ocorrência já pertence a um plano. Atualize o planejamento.",
          );
        rows.push(row);
      }
      if (new Set(rows.map((o) => streetIdentity(o).key)).size !== 1)
        fail(400, "Selecione ocorrências da mesma rua e bairro.");
      const id = randomUUID(),
        stamp = now(),
        count = await db.get("SELECT COUNT(*) AS n FROM action_plans");
      const plan = {
        ...data,
        street: streetIdentity(rows[0]).street,
        neighborhood: rows[0].neighborhood,
        priority: planningPriority(rows),
      };
      const code = `PA-${new Date().getFullYear()}-${String(Number(count.n) + 1).padStart(5, "0")}`;
      await db.run(
        "INSERT INTO action_plans(id,code,created_at,data) VALUES(?,?,?,?)",
        [id, code, stamp, JSON.stringify(plan)],
      );
      for (const o of rows)
        await db.run(
          "INSERT INTO action_plan_occurrences(plan_id,occurrence_id) VALUES(?,?)",
          [id, o.id],
        );
      await audit(req, "action_plan", id, "Plano de ação criado", null, plan);
      return { id, code, ...plan, created_at: stamp };
    }, true),
  );
}
