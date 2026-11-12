import { randomUUID } from "node:crypto";
import { z } from "zod";
import { listRecords, orderAccess } from "../modules/listing/index.js";
import {
  assertExpectedVersion,
  updateVersioned,
} from "../modules/concurrency/index.js";
import { queueOrderNotification } from "../field.js";
import { inventoryBalance } from "../inventory.js";
import { canAccessOrder, priorities, unpack, now } from "../domain.js";
import { canTransition } from "../domain/workflow.js";
import {
  text,
  coordinate,
  optionalRequestId,
  parseCapturedAt,
} from "../http/schemas.js";
import { evidenceTime } from "../http/records.js";

// Service orders: listing, scheduling (with optional integrated triage and new action plan),
// detail, reprogramming, status transitions and field records (material, equipment).
export function registerOrders(app, db, deps) {
  const {
    route,
    allow,
    fail,
    failCode,
    requestIdReused,
    catalog,
    entity,
    audit,
    accessOrder,
    clientRequest,
    saveClientRequest,
    code,
    history,
    evidence,
    related,
    propagate,
    classifyOccurrence,
    planningModule,
    invoiceModule,
  } = deps;
  app.get(
    "/api/ordens-servico",
    route(async (req) => {
      const result = await listRecords(db, "orders", req.query, req.user);
      const rows = Array.isArray(result) ? result : result.items;
      const links = rows.length
        ? await db.all(
            `SELECT order_id,occurrence_id FROM order_occurrences WHERE order_id IN (${rows.map(() => "?").join(",")})`,
            rows.map((o) => o.id),
          )
        : [];
      const byOrder = new Map();
      for (const link of links) {
        if (!byOrder.has(link.order_id)) byOrder.set(link.order_id, []);
        byOrder.get(link.order_id).push(link.occurrence_id);
      }
      const items = rows.map((o) => ({
        ...o,
        occurrence_ids: byOrder.get(o.id) || [],
      }));
      return Array.isArray(result) ? items : { ...result, items };
    }),
  );
  // Orders per team and status (team cards), counted in the database with the same access rule
  // as the list. Registered before /api/ordens-servico/:id.
  app.get(
    "/api/ordens-servico/resumo",
    route(async (req) => {
      const access = orderAccess(db, req.user);
      const byTeam = {};
      for (const row of await db.all(
        `SELECT team_id,status,COUNT(*) AS n FROM orders WHERE ${access.sql} GROUP BY team_id,status`,
        access.params,
      ))
        (byTeam[row.team_id] ||= {})[row.status] = Number(row.n);
      return { by_team: byTeam };
    }),
  );
  app.post(
    "/api/ordens-servico",
    allow("schedule"),
    route(async (req) => {
      const data = z
        .object({
          occurrence_ids: z.array(text).min(1).max(100),
          plan_id: text.optional(),
          assigned_user_id: z.string().nullable().optional(),
          team_id: text,
          scheduled_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          responsible: text,
          notes: z.string().max(3000).default(""),
          triage: z
            .object({
              version: z.number().int().positive(),
              priority: z.enum(priorities),
              sector_id: text,
              category_id: text,
              subcategory: text,
            })
            .optional(),
          new_plan: z
            .object({
              objective: z.string().trim().min(5).max(3000),
              responsible: z.string().trim().min(1).max(200),
            })
            .optional(),
        })
        .parse(req.body);
      if (new Set(data.occurrence_ids).size !== data.occurrence_ids.length)
        fail(400, "Ocorrências repetidas.");
      if (data.triage) {
        if (data.occurrence_ids.length !== 1)
          fail(400, "A triagem integrada deve tratar uma ocorrência por vez.");
        await classifyOccurrence(req, data.occurrence_ids[0], data.triage);
      }
      const occurrences = [];
      for (const id of data.occurrence_ids) {
        const o = await entity("occurrences", id);
        if (o.status !== "EM_TRIAGEM")
          fail(409, "Conclua a triagem antes de gerar a ordem.");
        occurrences.push(o);
      }
      const first = occurrences[0],
        team = await catalog(data.team_id, "equipes");
      if (
        occurrences.some((o) => o.sector_id !== first.sector_id) ||
        team.sector_id !== first.sector_id
      )
        fail(400, "A equipe e as ocorrências devem pertencer ao mesmo setor.");
      if (data.assigned_user_id) {
        const operator = await db.get(
          "SELECT id,role,team_id FROM users WHERE id=?",
          [data.assigned_user_id],
        );
        if (
          !operator ||
          operator.role !== "Equipe de Campo" ||
          operator.team_id !== data.team_id
        )
          fail(400, "Selecione um operador da equipe escolhida.");
      }
      if (data.new_plan) {
        if (data.plan_id)
          fail(400, "Escolha um plano existente ou crie um novo plano.");
        const createdPlan = await planningModule.createPlan(req, {
          occurrence_ids: data.occurrence_ids,
          objective: data.new_plan.objective,
          responsible: data.new_plan.responsible,
          scheduled_at: data.scheduled_at,
        });
        data.plan_id = createdPlan.id;
        delete data.new_plan;
      }
      data.issued_by = req.user.name;
      data.issued_by_id = req.user.id;
      const planIds = new Set();
      for (const o of occurrences) {
        const link = await db.get(
          "SELECT plan_id FROM action_plan_occurrences WHERE occurrence_id=?",
          [o.id],
        );
        if (link) planIds.add(link.plan_id);
        else planIds.add(null);
      }
      if (planIds.size > 1)
        fail(
          400,
          "Não misture ocorrências de planos diferentes na mesma ordem.",
        );
      const linkedPlanId = [...planIds][0];
      if (data.plan_id && data.plan_id !== linkedPlanId)
        fail(400, "As ocorrências não pertencem ao plano informado.");
      let plan;
      if (linkedPlanId) {
        data.plan_id = linkedPlanId;
        plan = await entity("action_plans", linkedPlanId);
      }
      const priority = priorities.find(
        (p) =>
          occurrences.some((o) => o.priority === p) || plan?.priority === p,
      );
      const deadlines = [];
      for (const o of occurrences) {
        const cat = await catalog(o.category_id, "categorias");
        deadlines.push(
          new Date(o.created_at).getTime() +
            cat.sla[
              priorities.find((p) => p === o.priority || p === plan?.priority)
            ] *
              3600000,
        );
      }
      const due = new Date(Math.min(...deadlines)).toISOString();
      const stamp = now(),
        id = randomUUID(),
        protocol = await code("orders", "OS");
      await db.run(
        "INSERT INTO orders(id,code,sector_id,team_id,status,priority,due_at,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          protocol,
          first.sector_id,
          data.team_id,
          "PROGRAMADA",
          priority,
          due,
          stamp,
          stamp,
          JSON.stringify(data),
        ],
      );
      for (const o of occurrences)
        await db.run("INSERT INTO order_occurrences VALUES(?,?)", [id, o.id]);
      await audit(req, "order", id, "Ordem de serviço programada", null, data);
      await propagate(req, { id, code: protocol }, "PROGRAMADA");
      await queueOrderNotification(db, await entity("orders", id));
      return entity("orders", id);
    }, true),
  );
  app.get(
    "/api/ordens-servico/:id",
    route(async (req) => {
      const o = await accessOrder(req, req.params.id);
      return {
        ...o,
        occurrences: await Promise.all(
          (
            await db.all(
              "SELECT c.* FROM occurrences c JOIN order_occurrences r ON r.occurrence_id=c.id WHERE r.order_id=?",
              [o.id],
            )
          )
            .map(unpack)
            .map(async (occurrence) => ({
              ...occurrence,
              evidence: await evidence("occurrence", occurrence.id),
            })),
        ),
        history: await history("order", o.id),
        evidence: await evidence("order", o.id),
        materials: await db.all("SELECT * FROM consumption WHERE order_id=?", [
          o.id,
        ]),
        invoices: await Promise.all(
          (
            await db.all(
              "SELECT * FROM invoices WHERE order_id=? ORDER BY created_at DESC",
              [o.id],
            )
          ).map(invoiceModule.hydrateInvoice),
        ),
        cost_by_stage: await db.all(
          "SELECT stage,SUM(quantity*unit_cost) AS value FROM inventory_movements WHERE order_id=? AND type='saida' GROUP BY stage",
          [o.id],
        ),
        equipment: await db.all(
          "SELECT equipment_id FROM order_equipment WHERE order_id=?",
          [o.id],
        ),
      };
    }),
  );
  // Field actions that accept request_id (idempotent replay) and captured_at (offline work time).
  const fieldSyncActions = ["assumir", "iniciar", "concluir", "devolver"];
  const transition = (action, from, to, permission) =>
    app.post(
      `/api/ordens-servico/:id/${action}`,
      allow(permission),
      route(async (req) => {
        const sync = fieldSyncActions.includes(action);
        const requestId = sync
          ? optionalRequestId(req.body.request_id)
          : undefined;
        if (requestId) {
          const previous = await clientRequest(req.user.id, requestId);
          if (previous) {
            if (
              previous.entity_type !== "order_transition" ||
              previous.entity_id !== req.params.id
            )
              requestIdReused();
            // Already applied: never reapply nor revalidate version/status.
            const current = await entity("orders", req.params.id);
            return canAccessOrder(req.user, current)
              ? { ...current, replayed: true }
              : { id: current.id, replayed: true };
          }
        }
        const capturedAt = sync ? parseCapturedAt(req.body.captured_at) : null;
        const old = await accessOrder(req, req.params.id);
        assertExpectedVersion(old, req.body.version);
        if (
          !from.includes(old.status) ||
          !canTransition(old.status, to, "order")
        )
          failCode(
            409,
            "Ação incompatível com o status atual.",
            "INVALID_STATUS",
          );
        const data = { ...old };
        const stamp = now();
        const workedAt = capturedAt ?? stamp;
        if (action === "assumir") {
          data.assumed_by = req.user.id;
          data.assumed_by_name = req.user.name;
        }
        if (action === "iniciar") {
          const point = z.object(coordinate).parse(req.body);
          data.arrival_location = point;
          data.started_at = workedAt;
          for (const { occurrence_id: id } of await related(old.id)) {
            const oc = await entity("occurrences", id),
              cat = await catalog(oc.category_id, "categorias");
            if (
              cat.require_before &&
              !(await evidence("order", old.id)).some(
                (e) =>
                  e.stage === "antes" &&
                  e.mime.startsWith("image/") &&
                  evidenceTime(e) >= (old.reprogrammed_at || old.created_at),
              )
            )
              failCode(
                400,
                "Anexe uma foto antes de iniciar a execução.",
                "BEFORE_PHOTO_REQUIRED",
              );
          }
        }
        if (action === "concluir") {
          const { notes } = z.object({ notes: text }).parse(req.body);
          data.completion_notes = notes;
          data.finished_at = workedAt;
          const ev = await evidence("order", old.id),
            materials = await db.all(
              "SELECT * FROM consumption WHERE order_id=?",
              [old.id],
            );
          for (const { occurrence_id: id } of await related(old.id)) {
            const oc = await entity("occurrences", id),
              cat = await catalog(oc.category_id, "categorias");
            if (
              cat.require_after &&
              !ev.some(
                (e) =>
                  e.stage === "depois" &&
                  e.mime.startsWith("image/") &&
                  evidenceTime(e) >=
                    [
                      old.started_at,
                      old.reopened_at,
                      old.reprogrammed_at,
                      old.created_at,
                    ]
                      .filter(Boolean)
                      .sort()
                      .at(-1),
              )
            )
              failCode(
                400,
                "Anexe uma foto depois do serviço.",
                "AFTER_PHOTO_REQUIRED",
              );
            if (cat.require_material && !materials.length)
              failCode(
                400,
                "Registre o material utilizado antes de concluir.",
                "MATERIAL_REQUIRED",
              );
          }
        }
        if (action === "validar") {
          data.completed_at = stamp;
          data.validated_by = req.user.name;
        }
        if (action === "concluir") data.executed_by = req.user.name;
        if (action === "reabrir") {
          data.reopened_at = stamp;
          data.finished_at = null;
          data.completion_notes = null;
        }
        if (action === "devolver") {
          data.return_reason = z
            .object({ reason: text })
            .parse(req.body).reason;
          data.returned_at = workedAt;
          data.returned_by = req.user.name;
        }
        if (["reabrir", "cancelar"].includes(action)) {
          data.reason = z.object({ reason: text }).parse(req.body).reason;
          data.completed_at = null;
        }
        await updateVersioned(
          db,
          "orders",
          old,
          "status=?,updated_at=?,data=?",
          [to, stamp, JSON.stringify(data)],
        );
        await audit(
          req,
          "order",
          old.id,
          `${action}: ${old.status} → ${to}`,
          { status: old.status },
          { status: to, ...req.body },
        );
        await propagate(req, old, to);
        if (action === "reabrir")
          await queueOrderNotification(db, await entity("orders", old.id));
        if (requestId)
          await saveClientRequest(
            req.user.id,
            requestId,
            "order_transition",
            old.id,
          );
        return entity("orders", old.id);
      }, true),
    );
  app.post(
    "/api/ordens-servico/:id/programacao",
    allow("schedule"),
    route(async (req) => {
      const old = await accessOrder(req, req.params.id);
      assertExpectedVersion(old, req.body.version);
      if (!["PROGRAMADA", "DEVOLVIDA"].includes(old.status))
        fail(
          409,
          "A programação só pode ser alterada antes do deslocamento ou após devolução.",
        );
      const data = z
        .object({
          team_id: text,
          assigned_user_id: z.string().nullable().optional(),
          responsible: text,
          scheduled_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          notes: z.string().max(3000).default(""),
        })
        .parse(req.body);
      const team = await catalog(data.team_id, "equipes");
      if (team.sector_id !== old.sector_id)
        fail(400, "A equipe deve pertencer ao setor da ordem.");
      if (data.assigned_user_id) {
        const operator = await db.get(
          "SELECT role,team_id FROM users WHERE id=?",
          [data.assigned_user_id],
        );
        if (
          !operator ||
          operator.role !== "Equipe de Campo" ||
          operator.team_id !== team.id
        )
          fail(400, "Selecione um operador da equipe escolhida.");
      }
      const updated = {
        ...old,
        ...data,
        assigned_user_id: data.assigned_user_id || null,
        reprogrammed_at: now(),
        started_at: null,
        finished_at: null,
        completion_notes: null,
        executed_by: null,
        arrival_location: null,
        reason: null,
        reopened_at: null,
        ...("assumed_by" in old
          ? { assumed_by: null, assumed_by_name: null }
          : {}),
      };
      await updateVersioned(
        db,
        "orders",
        old,
        "team_id=?,status='PROGRAMADA',updated_at=?,data=?",
        [team.id, now(), JSON.stringify(updated)],
      );
      await audit(req, "order", old.id, "Programação atualizada", old, updated);
      if (old.status === "DEVOLVIDA") await propagate(req, old, "PROGRAMADA");
      await queueOrderNotification(db, await entity("orders", old.id));
      return entity("orders", old.id);
    }, true),
  );
  transition(
    "devolver",
    ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"],
    "DEVOLVIDA",
    "execute",
  );
  transition("assumir", ["PROGRAMADA"], "EM_DESLOCAMENTO", "execute");
  transition(
    "iniciar",
    ["PROGRAMADA", "EM_DESLOCAMENTO"],
    "EM_EXECUCAO",
    "execute",
  );
  transition("concluir", ["EM_EXECUCAO"], "AGUARDANDO_VALIDACAO", "execute");
  transition("validar", ["AGUARDANDO_VALIDACAO"], "CONCLUIDA", "validate");
  transition(
    "reabrir",
    ["AGUARDANDO_VALIDACAO", "CONCLUIDA"],
    "EM_EXECUCAO",
    "validate",
  );
  transition(
    "cancelar",
    ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"],
    "CANCELADA",
    "schedule",
  );
  app.post(
    "/api/ordens-servico/:id/material",
    allow("execute"),
    route(async (req) => {
      const requestId = optionalRequestId(req.body?.request_id);
      if (requestId) {
        const previous = await clientRequest(req.user.id, requestId);
        if (previous) {
          const consumption =
            previous.entity_type === "consumption" &&
            (await db.get("SELECT order_id FROM consumption WHERE id=?", [
              previous.entity_id,
            ]));
          if (!consumption || consumption.order_id !== req.params.id)
            requestIdReused();
          return { ok: true, replayed: true };
        }
      }
      const capturedAt = parseCapturedAt(req.body?.captured_at);
      const o = await accessOrder(req, req.params.id);
      if (o.status !== "EM_EXECUCAO")
        fail(409, "Inicie a execução antes de registrar materiais.");
      const data = z
          .object({
            material_id: text,
            quantity: z.number().positive().max(1000000),
          })
          .parse(req.body),
        mat = await catalog(data.material_id, "materiais");
      const balance = await inventoryBalance(db, data.material_id);
      if (balance.controlled && data.quantity > balance.quantity)
        fail(
          409,
          "Saldo insuficiente no almoxarifado para registrar este consumo.",
        );
      const unitCost = balance.averageCost || mat.unit_cost;
      const consumptionId = randomUUID();
      await db.run(
        "INSERT INTO consumption(id,order_id,material_id,quantity,unit_cost,created_at) VALUES(?,?,?,?,?,?)",
        [consumptionId, o.id, data.material_id, data.quantity, unitCost, now()],
      );
      if (balance.controlled)
        await db.run(
          "INSERT INTO inventory_movements(id,material_id,order_id,invoice_id,type,quantity,unit_cost,stage,notes,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          [
            randomUUID(),
            data.material_id,
            o.id,
            null,
            "saida",
            data.quantity,
            unitCost,
            "execucao",
            `Consumo na ${o.code}`,
            req.user.id,
            now(),
          ],
        );
      await audit(
        req,
        "order",
        o.id,
        "Material registrado",
        null,
        capturedAt ? { ...data, captured_at: capturedAt } : data,
      );
      if (requestId)
        await saveClientRequest(
          req.user.id,
          requestId,
          "consumption",
          consumptionId,
        );
    }, true),
  );
  app.post(
    "/api/ordens-servico/:id/equipamento",
    allow("execute"),
    route(async (req) => {
      const requestId = optionalRequestId(req.body?.request_id);
      if (requestId) {
        const previous = await clientRequest(req.user.id, requestId);
        if (previous) {
          if (
            previous.entity_type !== "order_equipment" ||
            previous.entity_id !== req.params.id
          )
            requestIdReused();
          return { ok: true, replayed: true };
        }
      }
      const capturedAt = parseCapturedAt(req.body?.captured_at);
      const o = await accessOrder(req, req.params.id);
      if (o.status !== "EM_EXECUCAO")
        fail(409, "Inicie a execução antes de registrar equipamentos.");
      const { equipment_id } = z.object({ equipment_id: text }).parse(req.body);
      await catalog(equipment_id, "equipamentos");
      await db.run(
        "INSERT INTO order_equipment VALUES(?,?) ON CONFLICT DO NOTHING",
        [o.id, equipment_id],
      );
      await audit(
        req,
        "order",
        o.id,
        "Equipamento registrado",
        null,
        capturedAt
          ? { equipment_id, captured_at: capturedAt }
          : { equipment_id },
      );
      if (requestId)
        await saveClientRequest(
          req.user.id,
          requestId,
          "order_equipment",
          o.id,
        );
    }, true),
  );
}
