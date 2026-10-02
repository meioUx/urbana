import { randomUUID } from "node:crypto";
import { z } from "zod";
import { unpack, now, canAccessOrder } from "./domain.js";

import {
  streetIdentity,
  planningPriority,
  groupStreets,
} from "../shared/planning.mjs";
export {
  streetIdentity,
  planningPriority,
  groupStreets,
} from "../shared/planning.mjs";

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
        const rejected = members.filter((o) => o.status === "RECUSADA").length;
        const status =
          completed === members.length
            ? "Concluído"
            : completed + cancelled + rejected === members.length
              ? rejected
                ? "Encerrado com recusas"
                : "Encerrado com cancelamentos"
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
          occurrences: members.map((o) => ({
            ...o,
            order_ids: orderLinks
              .filter((l) => l.occurrence_id === o.id)
              .map((l) => l.order_id),
          })),
          completed,
          cancelled,
          rejected,
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
            order_ids: orderLinks
              .filter((l) => l.occurrence_id === o.id)
              .map((l) => l.order_id),
            plan_id:
              links.find((l) => l.occurrence_id === o.id)?.plan_id || null,
          })),
        })),
        plans,
      };
    }),
  );
  const createPlan = async (req, payload = req.body) => {
    const data = z
      .object({
        occurrence_ids: z.array(z.string().min(1)).min(1).max(100),
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
      .parse(payload);
    if (new Set(data.occurrence_ids).size !== data.occurrence_ids.length)
      fail(400, "Ocorrências repetidas.");
    const rows = [];
    for (const id of data.occurrence_ids) {
      const row = unpack(
        await db.get("SELECT * FROM occurrences WHERE id=?", [id]),
      );
      if (!row) fail(404, "Ocorrência não encontrada.");
      if (!["IDENTIFICADA", "EM_TRIAGEM"].includes(row.status))
        fail(409, "Escolha demandas ainda não programadas para criar o plano.");
      if (
        await db.get(
          "SELECT order_id FROM order_occurrences WHERE occurrence_id=?",
          [id],
        )
      )
        fail(
          409,
          "Uma demanda já possui ordem de serviço. Atualize o planejamento.",
        );
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
    if (new Set(rows.map((o) => o.sector_id)).size !== 1)
      fail(
        400,
        "Selecione demandas do mesmo setor para planejar a intervenção.",
      );
    const id = randomUUID(),
      stamp = now();
    const plan = {
      ...data,
      street: streetIdentity(rows[0]).street,
      neighborhood: rows[0].neighborhood,
      priority: planningPriority(rows),
      sector_id: rows[0].sector_id,
    };
    const prefix = `PA-${new Date().getFullYear()}-`;
    const previous = await db.all(
      "SELECT code FROM action_plans WHERE code LIKE ?",
      [`${prefix}%`],
    );
    const highest = previous.reduce((n, row) => {
      const suffix = row.code.slice(prefix.length);
      return /^\d+$/.test(suffix) ? Math.max(n, Number(suffix)) : n;
    }, 0);
    const code = `${prefix}${String(highest + 1).padStart(5, "0")}`;
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
  };
  app.post(
    "/api/planos-acao",
    allow("schedule"),
    route((req) => createPlan(req), true),
  );
  return { createPlan };
}
