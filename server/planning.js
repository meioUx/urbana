import { randomUUID } from "node:crypto";
import { z } from "zod";
import { unpack, now, canAccessOrder } from "./domain.js";
import { jsonField } from "./modules/listing/index.js";

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
  const CLOSED = "('CONCLUIDA','CANCELADA','RECUSADA')";
  // A plan is closed when every member occurrence is CONCLUIDA, CANCELADA or RECUSADA (statuses
  // "Concluído", "Encerrado com cancelamentos", "Encerrado com recusas"; a plan without members
  // counts as "Concluído"). Open plans have at least one member in another status.
  const openMember = `EXISTS (SELECT 1 FROM action_plan_occurrences l JOIN occurrences c ON c.id=l.occurrence_id WHERE l.plan_id=action_plans.id AND c.status NOT IN ${CLOSED})`;
  // Full plan objects (members, progress, status and visible orders) for the given plan rows.
  const describePlans = async (planRows, user) => {
    if (!planRows.length) return [];
    const ids = planRows.map((p) => p.id);
    const marks = ids.map(() => "?").join(",");
    const links = await db.all(
      `SELECT * FROM action_plan_occurrences WHERE plan_id IN (${marks})`,
      ids,
    );
    const memberIds = [...new Set(links.map((l) => l.occurrence_id))];
    // ", id" reproduces the (created_at,id) index order.
    const members = memberIds.length
      ? (
          await db.all(
            `SELECT * FROM occurrences WHERE id IN (SELECT occurrence_id FROM action_plan_occurrences WHERE plan_id IN (${marks})) ORDER BY created_at,id`,
            ids,
          )
        ).map(unpack)
      : [];
    const orderLinks = memberIds.length
      ? await db.all(
          `SELECT r.* FROM order_occurrences r WHERE r.occurrence_id IN (SELECT occurrence_id FROM action_plan_occurrences WHERE plan_id IN (${marks}))`,
          ids,
        )
      : [];
    // Orders shown under a plan carry its plan_id or serve one of its members.
    const orders = (
      await db.all(
        `SELECT * FROM orders WHERE ${jsonField(db, "plan_id")} IN (${marks}) OR id IN (SELECT r.order_id FROM order_occurrences r JOIN action_plan_occurrences p ON p.occurrence_id=r.occurrence_id WHERE p.plan_id IN (${marks})) ORDER BY created_at DESC,id DESC`,
        [...ids, ...ids],
      )
    ).map(unpack);
    const orderIdsByOccurrence = new Map();
    for (const l of orderLinks) {
      if (!orderIdsByOccurrence.has(l.occurrence_id))
        orderIdsByOccurrence.set(l.occurrence_id, []);
      orderIdsByOccurrence.get(l.occurrence_id).push(l.order_id);
    }
    const orderIds = (id) => orderIdsByOccurrence.get(id) || [];
    const membersByPlan = new Map();
    for (const l of links) {
      if (!membersByPlan.has(l.plan_id))
        membersByPlan.set(l.plan_id, new Set());
      membersByPlan.get(l.plan_id).add(l.occurrence_id);
    }
    const ordersByPlan = new Map();
    for (const o of orders) {
      if (!ordersByPlan.has(o.plan_id)) ordersByPlan.set(o.plan_id, []);
      ordersByPlan.get(o.plan_id).push(o);
    }
    const orderPosition = new Map(orders.map((o, i) => [o.id, i]));
    return planRows.map((p) => {
      const memberSet = membersByPlan.get(p.id) || new Set();
      const planMembers = members.filter((o) => memberSet.has(o.id));
      const planOrders = new Set(ordersByPlan.get(p.id) || []);
      for (const m of planMembers)
        for (const id of orderIds(m.id))
          if (orderPosition.has(id))
            planOrders.add(orders[orderPosition.get(id)]);
      const completed = planMembers.filter(
        (o) => o.status === "CONCLUIDA",
      ).length;
      const cancelled = planMembers.filter(
        (o) => o.status === "CANCELADA",
      ).length;
      const rejected = planMembers.filter(
        (o) => o.status === "RECUSADA",
      ).length;
      const status =
        completed === planMembers.length
          ? "Concluído"
          : completed + cancelled + rejected === planMembers.length
            ? rejected
              ? "Encerrado com recusas"
              : "Encerrado com cancelamentos"
            : planMembers.some((o) =>
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
        occurrences: planMembers.map((o) => ({
          ...o,
          order_ids: orderIds(o.id),
        })),
        completed,
        cancelled,
        rejected,
        status,
        orders: [...planOrders]
          .sort((a, b) => orderPosition.get(a.id) - orderPosition.get(b.id))
          .filter((o) => canAccessOrder(user, o)),
      };
    });
  };
  // Open work, always complete: street groups of open occurrences and the open plans. Closed plans
  // are only counted here and listed page by page in /api/planejamento/encerrados.
  app.get(
    "/api/planejamento",
    route(async (req) => {
      const occurrences = (
        await db.all(
          `SELECT * FROM occurrences WHERE status NOT IN ${CLOSED} ORDER BY created_at,id`,
        )
      ).map(unpack);
      const ids = new Set(occurrences.map((o) => o.id));
      const orderIdsByOccurrence = new Map();
      for (const l of await db.all(
        `SELECT r.* FROM order_occurrences r JOIN occurrences c ON c.id=r.occurrence_id WHERE c.status NOT IN ${CLOSED}`,
      )) {
        if (!ids.has(l.occurrence_id)) continue;
        if (!orderIdsByOccurrence.has(l.occurrence_id))
          orderIdsByOccurrence.set(l.occurrence_id, []);
        orderIdsByOccurrence.get(l.occurrence_id).push(l.order_id);
      }
      const planByOccurrence = new Map();
      for (const l of await db.all(
        `SELECT l.* FROM action_plan_occurrences l JOIN occurrences c ON c.id=l.occurrence_id WHERE c.status NOT IN ${CLOSED}`,
      ))
        if (!planByOccurrence.has(l.occurrence_id))
          planByOccurrence.set(l.occurrence_id, l.plan_id);
      const planRows = (
        await db.all(
          `SELECT * FROM action_plans WHERE ${openMember} ORDER BY created_at DESC,id DESC`,
        )
      ).map(unpack);
      const closedPlans = Number(
        (
          await db.get(
            `SELECT COUNT(*) AS n FROM action_plans WHERE NOT ${openMember}`,
          )
        ).n,
      );
      return {
        groups: groupStreets(occurrences).map((g) => ({
          ...g,
          occurrences: g.occurrences.map((o) => ({
            ...o,
            order_ids: orderIdsByOccurrence.get(o.id) || [],
            plan_id: planByOccurrence.get(o.id) || null,
          })),
        })),
        plans: await describePlans(planRows, req.user),
        closed_plans: closedPlans,
      };
    }),
  );
  // Closed plans, most recent first (created_at DESC, id DESC), with cursor pagination and optional
  // filters: q (code, street, neighborhood, objective, responsible) and sector_id (any member).
  const closedQuery = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(2000).optional(),
    q: z.string().max(200).optional(),
    sector_id: z.string().max(200).optional(),
  });
  app.get(
    "/api/planejamento/encerrados",
    route(async (req) => {
      const q = closedQuery.parse(req.query);
      const conditions = [`NOT ${openMember}`],
        params = [];
      if (q.q?.trim()) {
        const fields = [
          "code",
          ...["street", "neighborhood", "objective", "responsible"].map((k) =>
            jsonField(db, k),
          ),
        ];
        const term =
          "%" +
          q.q.trim().toLocaleLowerCase("pt-BR").replace(/[!%_]/g, "!$&") +
          "%";
        conditions.push(
          "(" +
            fields
              .map((f) => `LOWER(COALESCE(${f},'')) LIKE ? ESCAPE '!'`)
              .join(" OR ") +
            ")",
        );
        params.push(...fields.map(() => term));
      }
      if (q.sector_id) {
        conditions.push(
          "EXISTS (SELECT 1 FROM action_plan_occurrences l JOIN occurrences c ON c.id=l.occurrence_id WHERE l.plan_id=action_plans.id AND c.sector_id=?)",
        );
        params.push(q.sector_id);
      }
      const signature = JSON.stringify([
        "closed_plans",
        q.q?.trim() || "",
        q.sector_id || "",
      ]);
      if (q.cursor) {
        let c;
        try {
          c = JSON.parse(Buffer.from(q.cursor, "base64url").toString());
        } catch {
          fail(400, "Cursor inválido.");
        }
        if (
          c?.signature !== signature ||
          typeof c.id !== "string" ||
          typeof c.created_at !== "string"
        )
          fail(400, "Cursor incompatível com os filtros.");
        conditions.push("(created_at<? OR (created_at=? AND id<?))");
        params.push(c.created_at, c.created_at, c.id);
      }
      const rows = (
        await db.all(
          `SELECT * FROM action_plans WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT ?`,
          [...params, q.limit + 1],
        )
      ).map(unpack);
      const more = rows.length > q.limit,
        page = rows.slice(0, q.limit),
        last = page.at(-1);
      return {
        items: await describePlans(page, req.user),
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
