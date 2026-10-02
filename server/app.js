import { registerField, queueOrderNotification } from "./field.js";
import { registerSectorControl } from "./sector-control.js";
import { registerPlanning } from "./planning.js";
import { kanbanService } from "./kanban.js";
import { registerInvoices } from "./invoices.js";
import { registerInventory, inventoryBalance } from "./inventory.js";
import express from "express";
import multer from "multer";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  canAccessOrder,
  checkPassword,
  hashPassword,
  permissions,
  roles,
  priorities,
  unpack,
  distance,
  now,
} from "./domain.js";
import {
  canTransition,
  isProjectedOrderStatus,
  workflowStatus as status,
} from "./domain/workflow.js";

const text = z.string().trim().min(1).max(2000);
const coordinate = {
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
};
const occurrenceSchema = z.object({
  request_id: z.string().uuid().optional(),
  requested_by: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(40).default(""),
  category_id: text,
  subcategory: text,
  sector_id: text.optional(),
  description: text,
  origin: text,
  address: text,
  neighborhood: text,
  reference: z.string().max(1000).default(""),
  priority: z.enum(priorities),
  ...coordinate,
  duplicate_action: z.enum(["new", "link"]).optional(),
  duplicate_id: z.string().optional(),
});
const fail = (status, message, details) => {
  throw Object.assign(new Error(message), { status, details });
};
const tokenHash = (s) => createHash("sha256").update(s).digest("hex");
const kinds = [
  "secretarias",
  "departamentos",
  "setores",
  "equipes",
  "categorias",
  "materiais",
  "equipamentos",
];

export function createApp(db) {
  const app = express();
  const kanban = kanbanService(db, fail);
  const folder = resolve(process.env.DATA_DIR || "data", "uploads");
  mkdirSync(folder, { recursive: true });
  app.disable("x-powered-by");
  app.get("/healthz", (req, res) => res.json({ ok: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    )
      return res.status(403).json({ error: "Origem não autorizada." });
    next();
  });
  // A single connection and serialized requests keep multi-entity changes atomic on both databases.
  let queue = Promise.resolve();
  app.locals.enqueue = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };
  const route =
    (fn, write = false) =>
    async (req, res, next) => {
      const task = queue.then(async () => {
        if (write) await db.exec("BEGIN");
        try {
          const wip = write ? await kanban.snapshot() : null;
          if (write && req.body?.kanban_expected_status) {
            const match = req.path.match(/^\/api\/(ocorrencias|ordens-servico)\/([^/]+)\//);
            const ids = match ? [match[2]] : req.body.occurrence_ids;
            if (ids) for (const id of ids) {
              const table = match?.[1] === "ordens-servico" ? "orders" : "occurrences";
              const current = await db.get(`SELECT status FROM ${table} WHERE id=?`, [id]);
              if (!current || current.status !== req.body.kanban_expected_status) fail(409, "O cartão mudou de etapa. Atualize o quadro antes de movimentar.");
            }
          }
          const result = await fn(req, res);
          if (write) await kanban.enforce(wip);
          if (write) await db.exec("COMMIT");
          if (!res.headersSent) res.json(result ?? { ok: true });
        } catch (e) {
          if (write) await db.exec("ROLLBACK");
          throw e;
        }
      });
      queue = task.catch(() => {});
      try {
        await task;
      } catch (e) {
        next(e);
      }
    };
  const catalog = async (id, kind) => {
    const row = unpack(
      await db.get("SELECT * FROM catalogs WHERE id = ?", [id]),
    );
    if (!row || (kind && row.kind !== kind)) fail(400, "Cadastro inválido.");
    return row;
  };
  const entity = async (table, id) => {
    const row = unpack(
      await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]),
    );
    if (!row) fail(404, "Registro não encontrado.");
    return row;
  };
  const audit = (req, type, id, event, before, after) =>
    db.run("INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?)", [
      randomUUID(),
      type,
      id,
      req.user.id,
      event,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      now(),
    ]);
  const allow = (action) => (req, res, next) =>
    permissions[action].includes(req.user.role)
      ? next()
      : res.status(403).json({ error: "Seu perfil não permite esta ação." });
  const accessOrder = async (req, id) => {
    const o = await entity("orders", id);
    if (!canAccessOrder(req.user, o))
      fail(403, "Esta ordem pertence a outra equipe.");
    return o;
  };
  const code = async (table, prefix) => {
    const base = `${prefix}-${new Date().getFullYear()}-`;
    const rows = await db.all(`SELECT code FROM ${table} WHERE code LIKE ?`, [
      `${base}%`,
    ]);
    const maximum = rows.reduce((max, row) => {
      const suffix = row.code.slice(base.length);
      return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
    }, 0);
    return `${base}${String(maximum + 1).padStart(5, "0")}`;
  };
  const history = (type, id) =>
    db.all(
      "SELECT a.*, u.name AS user_name FROM audit_logs a JOIN users u ON a.user_id=u.id WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC",
      [type, id],
    );
  const evidence = (type, id) =>
    db.all(
      "SELECT e.*, u.name AS user_name FROM evidence e JOIN users u ON e.user_id=u.id WHERE entity_type=? AND entity_id=? ORDER BY created_at",
      [type, id],
    );
  const related = (id) =>
    db.all("SELECT occurrence_id FROM order_occurrences WHERE order_id=?", [
      id,
    ]);
  const propagate = async (req, order, status) => {
    if (!isProjectedOrderStatus(status))
      fail(500, "Status de atendimento inválido para propagação.");
    for (const { occurrence_id: id } of await related(order.id)) {
      const old = await entity("occurrences", id);
      const siblings = await db.all(
        "SELECT o.status FROM orders o JOIN order_occurrences r ON r.order_id=o.id WHERE r.occurrence_id=? AND o.id<>?",
        [id, order.id],
      );
      const active = siblings.filter(
        (x) => !["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(x.status),
      );
      const resulting =
        ["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(status) && active.length
          ? active[0].status
          : status;
      await db.run("UPDATE occurrences SET status=?,updated_at=? WHERE id=?", [
        resulting,
        now(),
        id,
      ]);
      await audit(
        req,
        "occurrence",
        id,
        `Status atualizado pela ${order.code}`,
        { status: old.status },
        { status: resulting },
      );

    }
  };
  const loginAttempts = new Map();
  app.post(
    "/api/auth/login",
    route(async (req, res) => {
      const { email, password } = z
        .object({
          email: z.string().email(),
          password: z.string().min(1).max(200),
        })
        .parse(req.body);
      const key = req.ip,
        attempt = loginAttempts.get(key);
      if (attempt && attempt.until > Date.now() && attempt.count >= 10)
        fail(429, "Muitas tentativas. Tente novamente em 15 minutos.");
      const u = await db.get("SELECT * FROM users WHERE email=?", [
        email.toLowerCase(),
      ]);
      if (!u || !checkPassword(password, u.password)) {
        const current =
          attempt?.until > Date.now()
            ? attempt
            : { count: 0, until: Date.now() + 900000 };
        current.count++;
        loginAttempts.set(key, current);
        fail(401, "E-mail ou senha incorretos.");
      }
      loginAttempts.delete(key);
      const token = randomBytes(32).toString("hex");
      await db.run("DELETE FROM sessions WHERE expires_at<?", [now()]);
      await db.run("INSERT INTO sessions VALUES(?,?,?)", [
        tokenHash(token),
        u.id,
        new Date(Date.now() + 8 * 3600000).toISOString(),
      ]);
      res.cookie("urban_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.SECURE_COOKIE === "true",
        maxAge: 8 * 3600000,
        path: "/",
      });
      return {
        user: {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          team_id: u.team_id,
        },
      };
    }),
  );
  app.use("/api", async (req, res, next) => {
    try {
      const token = req.headers.cookie
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("urban_session="))
        ?.split("=")[1];
      if (!token)
        return res.status(401).json({ error: "Entre para continuar." });
      const u = await db.get(
        "SELECT u.id,u.name,u.email,u.role,u.team_id FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires_at>?",
        [tokenHash(token), now()],
      );
      if (!u) return res.status(401).json({ error: "Sessão expirada." });
      req.user = u;
      req.sessionToken = tokenHash(token);
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get(
    "/api/auth/me",
    route((req) => ({ user: req.user })),
  );
  kanban.register(app, { route, audit, allow });
  app.post(
    "/api/auth/logout",
    route(async (req, res) => {
      await db.run("DELETE FROM sessions WHERE token=?", [req.sessionToken]);
      res.clearCookie("urban_session", { path: "/" });
    }),
  );
  app.get(
    "/api/bootstrap",
    route(async (req) => {
      const settings = JSON.parse(
        (await db.get("SELECT value FROM settings WHERE id='general'")).value,
      );
      return {
        user: req.user,
        catalogs: (await db.all("SELECT * FROM catalogs")).map(unpack),
        settings,
        kanban: await kanban.read(),
        operators: permissions.schedule.includes(req.user.role)
          ? await db.all(
              "SELECT id,name,team_id FROM users WHERE role='Equipe de Campo' ORDER BY name",
            )
          : [],
        roles,
        priorities,
      };
    }),
  );
  const listOccurrences = async (req) => {
    let list = (
      await db.all("SELECT * FROM occurrences ORDER BY created_at DESC")
    ).map(unpack);
    for (const k of [
      "status",
      "priority",
      "category_id",
      "sector_id",
      "neighborhood",
    ])
      if (req.query[k]) list = list.filter((r) => r[k] === req.query[k]);
    if (req.query.q) {
      const q = String(req.query.q).toLocaleLowerCase("pt-BR");
      list = list.filter((r) =>
        [r.code, r.address, r.description, r.neighborhood].some((v) =>
          v?.toLocaleLowerCase("pt-BR").includes(q),
        ),
      );
    }
    if (req.query.from)
      list = list.filter((r) => r.created_at.slice(0, 10) >= req.query.from);
    if (req.query.to)
      list = list.filter((r) => r.created_at.slice(0, 10) <= req.query.to);
    return list;
  };
  const planningModule = registerPlanning(app, db, { route, allow, audit, fail });
  registerField(app, db, { route, fail });
  registerSectorControl(app, db, { route, allow });
  registerInventory(app, db, { route, allow, audit, fail, now });
  const invoiceModule = registerInvoices(app, db, { route, allow, audit, fail, accessOrder, now });
  app.get("/api/ocorrencias", route(listOccurrences));
  app.get(
    "/api/mapa/ocorrencias",
    route(async (req) => ({
      type: "FeatureCollection",
      features: (await listOccurrences(req)).map((r) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        properties: r,
      })),
    })),
  );
  app.get(
    "/api/ocorrencias/proximas",
    route(async (req) => {
      const point = z
        .object(coordinate)
        .parse({ lat: Number(req.query.lat), lng: Number(req.query.lng) });
      const settings = JSON.parse(
        (await db.get("SELECT value FROM settings WHERE id='general'")).value,
      );
      return (await db.all("SELECT * FROM occurrences"))
        .map(unpack)
        .map((o) => ({ ...o, distance: distance(point, o) }))
        .filter(
          (o) =>
            o.distance <= settings.duplicate_radius && !["CANCELADA", "RECUSADA"].includes(o.status),
        )
        .sort((a, b) => a.distance - b.distance);
    }),
  );
  app.post(
    "/api/ocorrencias",
    allow("create"),
    route(async (req) => {
      const data = occurrenceSchema.parse(req.body),
        cat = await catalog(data.category_id, "categorias");
      if (data.request_id) {
        const previous = await db.get(
          "SELECT * FROM client_requests WHERE user_id=? AND request_id=?",
          [req.user.id, data.request_id],
        );
        if (previous) {
          if (previous.entity_type !== "occurrence")
            fail(409, "Identificador de envio já utilizado.");
          return entity("occurrences", previous.entity_id);
        }
      }
      if (!cat.subcategories.includes(data.subcategory))
        fail(400, "Subcategoria não pertence à categoria.");
      data.sector_id = data.sector_id || cat.sector_id;
      await catalog(data.sector_id, "setores");
      const settings = JSON.parse(
        (await db.get("SELECT value FROM settings WHERE id='general'")).value,
      );
      const nearby = (await db.all("SELECT * FROM occurrences"))
        .map(unpack)
        .filter(
          (o) =>
            !["CANCELADA", "RECUSADA"].includes(o.status) &&
            distance(data, o) <= settings.duplicate_radius,
        );
      const active = nearby.filter((o) => o.status !== "CONCLUIDA");
      if (active.length && !data.duplicate_action)
        fail(409, "Possível ocorrência duplicada.", { nearby: active });
      if (data.duplicate_action === "link") {
        const target = active.find((o) => o.id === data.duplicate_id);
        if (!target) fail(400, "Vínculo de duplicidade inválido.");
        await audit(
          req,
          "occurrence",
          target.id,
          "Solicitação relacionada recebida",
          null,
          { description: data.description, origin: data.origin },
        );
        return { ...target, linked: true };
      }
      const id = randomUUID(),
        stamp = now(),
        protocol = await code("occurrences", "OC");
      const extra = {
        ...data,
        creator_id: req.user.id,
        recurrence: nearby.some((o) => o.status === "CONCLUIDA"),
      };
      delete extra.duplicate_action;
      delete extra.duplicate_id;
      await db.run(
        "INSERT INTO occurrences(id,code,category_id,sector_id,status,priority,lat,lng,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          protocol,
          data.category_id,
          data.sector_id,
          "IDENTIFICADA",
          data.priority,
          data.lat,
          data.lng,
          stamp,
          stamp,
          JSON.stringify(extra),
        ],
      );
      await audit(req, "occurrence", id, "Ocorrência registrada", null, extra);

      if (data.request_id)
        await db.run("INSERT INTO client_requests VALUES(?,?,?,?)", [
          req.user.id,
          data.request_id,
          "occurrence",
          id,
        ]);
      return entity("occurrences", id);
    }, true),
  );
  app.get(
    "/api/ocorrencias/:id",
    route(async (req) => {
      const o = await entity("occurrences", req.params.id);
      return {
        ...o,
        history: await history("occurrence", o.id),
        evidence: await evidence("occurrence", o.id),
        orders: (
          await db.all(
            "SELECT o.* FROM orders o JOIN order_occurrences r ON r.order_id=o.id WHERE r.occurrence_id=?",
            [o.id],
          )
        )
          .map(unpack)
          .filter((order) => canAccessOrder(req.user, order)),
      };
    }),
  );
  const classifyOccurrence = async (req, id, payload) => {
    const old = await entity("occurrences", id);
    if (!canTransition(old.status, status.EM_TRIAGEM, "occurrence"))
      fail(409, "Só é possível classificar antes da programação.");
    const data = z
      .object({
        priority: z.enum(priorities),
        sector_id: text,
        category_id: text,
        subcategory: text,
      })
      .parse(payload);
    const cat = await catalog(data.category_id, "categorias");
    await catalog(data.sector_id, "setores");
    if (!cat.subcategories.includes(data.subcategory))
      fail(400, "Subcategoria inválida.");
    await db.run(
      "UPDATE occurrences SET category_id=?,sector_id=?,priority=?,status=?,updated_at=?,data=? WHERE id=?",
      [
        data.category_id,
        data.sector_id,
        data.priority,
        status.EM_TRIAGEM,
        now(),
        JSON.stringify({ ...old, ...data }),
        old.id,
      ],
    );
    await audit(
      req,
      "occurrence",
      old.id,
      "Triagem e encaminhamento registrados",
      old,
      data,
    );

    return entity("occurrences", old.id);
  };
  const classify = route(req => classifyOccurrence(req, req.params.id, req.body), true);
  app.post("/api/ocorrencias/:id/classificar", allow("classify"), classify);
  app.patch("/api/ocorrencias/:id", allow("classify"), classify);
  app.post("/api/ocorrencias/:id/encaminhar", allow("classify"), classify);
  app.post("/api/ocorrencias/:id/recusar", allow("classify"), route(async req => {
    const old = await entity("occurrences", req.params.id);
    if (!canTransition(old.status, status.RECUSADA, "occurrence")) fail(409, "Só é possível recusar uma demanda antes da programação.");
    const { reason } = z.object({ reason: text }).parse(req.body);
    const links = await db.all("SELECT order_id FROM order_occurrences WHERE occurrence_id=?", [old.id]);
    if (links.length) fail(409, "Esta demanda já possui ordem de serviço. Revise a ordem antes de alterar o atendimento.");
    const stamp = now();
    const data = { ...old, status: status.RECUSADA, updated_at: stamp, rejection_reason: reason, rejected_at: stamp, rejected_by: req.user.name };
    await db.run("UPDATE occurrences SET status=?,updated_at=?,data=? WHERE id=?", [status.RECUSADA, stamp, JSON.stringify(data), old.id]);
    await audit(req, "occurrence", old.id, "Demanda recusada na triagem", old, data);

    return entity("occurrences", old.id);
  }, true));
  app.get(
    "/api/ordens-servico",
    route(async (req) => {
      const rows = await db.all(
        "SELECT * FROM orders ORDER BY created_at DESC",
      );
      const links = await db.all("SELECT order_id,occurrence_id FROM order_occurrences");
      const byOrder = new Map();
      for (const link of links) {
        if (!byOrder.has(link.order_id)) byOrder.set(link.order_id, []);
        byOrder.get(link.order_id).push(link.occurrence_id);
      }
      return rows.map(unpack).filter((o) => canAccessOrder(req.user, o)).map(o => ({ ...o, occurrence_ids: byOrder.get(o.id) || [] }));
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
          triage: z.object({ priority: z.enum(priorities), sector_id: text, category_id: text, subcategory: text }).optional(),
          new_plan: z.object({ objective: z.string().trim().min(5).max(3000), responsible: z.string().trim().min(1).max(200) }).optional(),
        })
        .parse(req.body);
      if (new Set(data.occurrence_ids).size !== data.occurrence_ids.length)
        fail(400, "Ocorrências repetidas.");
      if (data.triage) {
        if (data.occurrence_ids.length !== 1) fail(400, "A triagem integrada deve tratar uma ocorrência por vez.");
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
        if (data.plan_id) fail(400, "Escolha um plano existente ou crie um novo plano.");
        const createdPlan = await planningModule.createPlan(req, { occurrence_ids: data.occurrence_ids, objective: data.new_plan.objective, responsible: data.new_plan.responsible, scheduled_at: data.scheduled_at });
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
      await db.run("INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)", [
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
      ]);
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
        invoices: await Promise.all((await db.all("SELECT * FROM invoices WHERE order_id=? ORDER BY created_at DESC", [o.id])).map(invoiceModule.hydrateInvoice)),
        cost_by_stage: await db.all("SELECT stage,SUM(quantity*unit_cost) AS value FROM inventory_movements WHERE order_id=? AND type='saida' GROUP BY stage", [o.id]),
        equipment: await db.all(
          "SELECT equipment_id FROM order_equipment WHERE order_id=?",
          [o.id],
        ),
      };
    }),
  );
  const transition = (action, from, to, permission) =>
    app.post(
      `/api/ordens-servico/:id/${action}`,
      allow(permission),
      route(async (req) => {
        const old = await accessOrder(req, req.params.id);
        if (!from.includes(old.status) || !canTransition(old.status, to, "order"))
          fail(409, "Ação incompatível com o status atual.");
        const data = { ...old };
        const stamp = now();
        if (action === "iniciar") {
          const point = z.object(coordinate).parse(req.body);
          data.arrival_location = point;
          data.started_at = stamp;
          for (const { occurrence_id: id } of await related(old.id)) {
            const oc = await entity("occurrences", id),
              cat = await catalog(oc.category_id, "categorias");
            if (
              cat.require_before &&
              !(await evidence("order", old.id)).some(
                (e) =>
                  e.stage === "antes" &&
                  e.mime.startsWith("image/") &&
                  e.created_at >= (old.reprogrammed_at || old.created_at),
              )
            )
              fail(400, "Anexe uma foto antes de iniciar a execução.");
          }
        }
        if (action === "concluir") {
          const { notes } = z.object({ notes: text }).parse(req.body);
          data.completion_notes = notes;
          data.finished_at = stamp;
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
                  e.created_at >=
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
              fail(400, "Anexe uma foto depois do serviço.");
            if (cat.require_material && !materials.length)
              fail(400, "Registre o material utilizado antes de concluir.");
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
          data.returned_at = stamp;
          data.returned_by = req.user.name;
        }
        if (["reabrir", "cancelar"].includes(action)) {
          data.reason = z.object({ reason: text }).parse(req.body).reason;
          data.completed_at = null;
        }
        await db.run(
          "UPDATE orders SET status=?,updated_at=?,data=? WHERE id=?",
          [to, stamp, JSON.stringify(data), old.id],
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
        return entity("orders", old.id);
      }, true),
    );
  app.post(
    "/api/ordens-servico/:id/programacao",
    allow("schedule"),
    route(async (req) => {
      const old = await accessOrder(req, req.params.id);
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
      };
      await db.run(
        "UPDATE orders SET team_id=?,status='PROGRAMADA',updated_at=?,data=? WHERE id=?",
        [team.id, now(), JSON.stringify(updated), old.id],
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
      if (balance.controlled && data.quantity > balance.quantity) fail(409, "Saldo insuficiente no almoxarifado para registrar este consumo.");
      const unitCost = balance.averageCost || mat.unit_cost;
      await db.run("INSERT INTO consumption(id,order_id,material_id,quantity,unit_cost,created_at) VALUES(?,?,?,?,?,?)", [
        randomUUID(), o.id, data.material_id, data.quantity, unitCost, now(),
      ]);
      if (balance.controlled) await db.run("INSERT INTO inventory_movements(id,material_id,order_id,invoice_id,type,quantity,unit_cost,stage,notes,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(), data.material_id, o.id, null, "saida", data.quantity, unitCost, "execucao", `Consumo na ${o.code}`, req.user.id, now()]);
      await audit(req, "order", o.id, "Material registrado", null, data);
    }, true),
  );
  app.post(
    "/api/ordens-servico/:id/equipamento",
    allow("execute"),
    route(async (req) => {
      const o = await accessOrder(req, req.params.id);
      if (o.status !== "EM_EXECUCAO")
        fail(409, "Inicie a execução antes de registrar equipamentos.");
      const { equipment_id } = z.object({ equipment_id: text }).parse(req.body);
      await catalog(equipment_id, "equipamentos");
      await db.run(
        "INSERT INTO order_equipment VALUES(?,?) ON CONFLICT DO NOTHING",
        [o.id, equipment_id],
      );
      await audit(req, "order", o.id, "Equipamento registrado", null, {
        equipment_id,
      });
    }, true),
  );
  const upload = multer({
    dest: folder,
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) =>
      cb(
        null,
        [
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
          "video/mp4",
        ].includes(file.mimetype),
      ),
  });
  for (const [path, type, table] of [
    ["ocorrencias", "occurrence", "occurrences"],
    ["ordens-servico", "order", "orders"],
  ]) {
    app.post(
      `/api/${path}/:id/anexos`,
      allow(type === "order" ? "execute" : "create"),
      upload.single("file"),
      route(async (req) => {
        try {
          const o =
            type === "order"
              ? await accessOrder(req, req.params.id)
              : await entity(table, req.params.id);
          if (
            type === "occurrence" &&
            req.user.role === "Equipe de Campo" &&
            o.creator_id !== req.user.id
          )
            fail(
              403,
              "Você só pode anexar fotos às ocorrências que registrou.",
            );
          if (req.body.request_id) {
            z.string().uuid().parse(req.body.request_id);
            const previous = await db.get(
              "SELECT * FROM client_requests WHERE user_id=? AND request_id=?",
              [req.user.id, req.body.request_id],
            );
            if (previous) {
              const attachment = await db.get(
                "SELECT * FROM evidence WHERE id=?",
                [previous.entity_id],
              );
              if (
                previous.entity_type !== "evidence" ||
                !attachment ||
                attachment.entity_id !== o.id ||
                attachment.entity_type !== type
              )
                fail(409, "Identificador de envio já utilizado.");
              if (req.file) unlinkSync(req.file.path);
              return { id: attachment.id };
            }
          }
          if (
            [
              "AGUARDANDO_VALIDACAO",
              "DEVOLVIDA",
              "CONCLUIDA",
              "CANCELADA",
              "RECUSADA",
            ].includes(o.status)
          )
            fail(409, "Registro encerrado para anexos.");
          if (!req.file)
            fail(400, "Envie JPG, PNG, WebP, PDF ou MP4 de até 15 MB.");
          const b = readFileSync(req.file.path),
            mime = req.file.mimetype;
          const valid =
            (mime === "image/jpeg" &&
              b[0] === 255 &&
              b[1] === 216 &&
              b[2] === 255) ||
            (mime === "image/png" &&
              b
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
            (mime === "image/webp" &&
              b.toString("ascii", 0, 4) === "RIFF" &&
              b.toString("ascii", 8, 12) === "WEBP") ||
            (mime === "application/pdf" &&
              b.toString("ascii", 0, 5) === "%PDF-") ||
            (mime === "video/mp4" && b.toString("ascii", 4, 8) === "ftyp");
          if (!valid)
            fail(
              400,
              "O conteúdo do arquivo não corresponde ao tipo informado.",
            );
          const stage = z
            .enum(["registro", "antes", "durante", "depois", "documento"])
            .parse(req.body.stage);
          if (
            type === "order" &&
            ["durante", "depois"].includes(stage) &&
            o.status !== "EM_EXECUCAO"
          )
            fail(409, "Esta evidência exige execução iniciada.");
          const point = z
            .object(coordinate)
            .parse({ lat: Number(req.body.lat), lng: Number(req.body.lng) });
          if (req.body.lat === undefined || req.body.lng === undefined)
            fail(400, "Informe a localização da evidência.");
          const id = randomUUID();
          await db.run("INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)", [
            id,
            type,
            o.id,
            stage,
            req.file.filename,
            req.file.originalname.slice(0, 200),
            mime,
            req.user.id,
            now(),
            point.lat,
            point.lng,
          ]);
          await audit(req, type, o.id, `Evidência registrada: ${stage}`, null, {
            evidence_id: id,
            lat: point.lat,
            lng: point.lng,
          });
          if (req.body.request_id)
            await db.run("INSERT INTO client_requests VALUES(?,?,?,?)", [
              req.user.id,
              req.body.request_id,
              "evidence",
              id,
            ]);
          return { id };
        } catch (e) {
          if (req.file) unlinkSync(req.file.path);
          throw e;
        }
      }, true),
    );
  }
  app.get("/api/anexos/:id", async (req, res, next) => {
    try {
      const e = await db.get("SELECT * FROM evidence WHERE id=?", [
        req.params.id,
      ]);
      if (!e) fail(404, "Anexo não encontrado.");
      if (e.entity_type === "order") await accessOrder(req, e.entity_id);
      res.type(e.mime);
      res.setHeader(
        "Content-Disposition",
        `${e.mime.startsWith("image/") ? "inline" : "attachment"}; filename="anexo.${e.mime.split("/")[1]}"`,
      );
      res.sendFile(resolve(folder, e.filename));
    } catch (e) {
      next(e);
    }
  });
  for (const kind of kinds) {
    app.get(
      `/api/${kind}`,
      route(async () =>
        (await db.all("SELECT * FROM catalogs WHERE kind=?", [kind])).map(
          unpack,
        ),
      ),
    );
    for (const method of ["post", "patch"])
      app[method](
        `/api/${kind}${method === "patch" ? "/:id" : ""}`,
        allow("admin"),
        route(async (req) => {
          let schema = z.object({ name: z.string().trim().min(2).max(120) });
          if (kind === "categorias")
            schema = schema.extend({
              subcategories: z.array(z.string().trim().min(1).max(100)).min(1),
              sector_id: text,
              sla: z.object(
                Object.fromEntries(
                  priorities.map((p) => [
                    p,
                    z.number().int().positive().max(8760),
                  ]),
                ),
              ),
              require_before: z.boolean(),
              require_after: z.boolean(),
              require_material: z.boolean(),
            });
          if (kind === "materiais")
            schema = schema.extend({
              unit: z.string().trim().min(1).max(10),
              unit_cost: z.number().min(0),
              minimum_stock: z.number().min(0).default(0),
            });
          if (kind === "equipes")
            schema = schema.extend({
              sector_id: text,
              leader: text,
              members: z.number().int().min(1).max(500),
            });
          if (kind === "equipamentos") schema = schema.extend({ code: text });
          if (["departamentos", "setores"].includes(kind))
            schema = schema.extend({ parent_id: text });
          const data = schema.parse(req.body);
          if (data.sector_id) await catalog(data.sector_id, "setores");
          if (data.parent_id)
            await catalog(
              data.parent_id,
              kind === "setores" ? "departamentos" : "secretarias",
            );
          const id = req.params.id || randomUUID(),
            old = req.params.id ? await catalog(id, kind) : null;
          await db.run(
            "INSERT INTO catalogs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            [id, kind, JSON.stringify(data)],
          );
          await audit(
            req,
            "catalog",
            id,
            `${kind}: cadastro ${old ? "alterado" : "criado"}`,
            old,
            data,
          );
          return { id, kind, ...data };
        }, true),
      );
  }
  app.get(
    "/api/users",
    allow("admin"),
    route(() =>
      db.all("SELECT id,name,email,role,team_id FROM users ORDER BY name"),
    ),
  );
  app.post(
    "/api/users",
    allow("admin"),
    route(async (req) => {
      const data = z
        .object({
          name: text,
          email: z.string().email(),
          password: z.string().min(10).max(200),
          role: z.enum(roles),
          team_id: z.string().nullable().optional(),
        })
        .parse(req.body);
      if (data.role === "Equipe de Campo" && !data.team_id)
        fail(400, "Selecione a equipe do usuário.");
      if (data.team_id) await catalog(data.team_id, "equipes");
      if (
        await db.get("SELECT id FROM users WHERE email=?", [
          data.email.toLowerCase(),
        ])
      )
        fail(409, "E-mail já cadastrado.");
      const id = randomUUID();
      await db.run("INSERT INTO users VALUES(?,?,?,?,?,?)", [
        id,
        data.name,
        data.email.toLowerCase(),
        hashPassword(data.password),
        data.role,
        data.team_id || null,
      ]);
      await audit(req, "user", id, "Usuário criado", null, {
        name: data.name,
        role: data.role,
      });
      return { id };
    }, true),
  );
  app.patch(
    "/api/settings",
    allow("admin"),
    route(async (req) => {
      const data = z
        .object({
          duplicate_radius: z.number().min(1).max(500),
          municipality: text,
        })
        .parse(req.body);
      const old = JSON.parse(
        (await db.get("SELECT value FROM settings WHERE id='general'")).value,
      );
      await db.run("UPDATE settings SET value=? WHERE id='general'", [
        JSON.stringify({ ...old, ...data }),
      ]);
      await audit(
        req,
        "settings",
        "general",
        "Configurações atualizadas",
        old,
        data,
      );
    }, true),
  );
  app.get(
    "/api/auditoria",
    allow("admin"),
    route(() =>
      db.all(
        "SELECT a.*,u.name AS user_name FROM audit_logs a JOIN users u ON u.id=a.user_id ORDER BY created_at DESC LIMIT 300",
      ),
    ),
  );
  app.get(
    "/api/dashboard",
    route(async (req) => {
      const occurrences = (await db.all("SELECT * FROM occurrences")).map(
          unpack,
        ),
        orders = (await db.all("SELECT * FROM orders"))
          .map(unpack)
          .filter((o) => canAccessOrder(req.user, o));
      const mats = (await db.all("SELECT * FROM consumption")).filter((m) =>
        orders.some((o) => o.id === m.order_id),
      );
      const stockCosts = (await db.all("SELECT * FROM inventory_movements WHERE type='saida' AND order_id IS NOT NULL")).filter((item) => orders.some((o) => o.id === item.order_id));
      const costByStage = Object.entries(stockCosts.reduce((sum, item) => { sum[item.stage] = (sum[item.stage] || 0) + item.quantity * item.unit_cost; return sum; }, {})).map(([stage, value]) => ({ stage, value }));
      const active = occurrences.filter(
        (o) => !["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(o.status),
      );
      return {
        total: occurrences.length,
        open: active.length,
        emergency: active.filter((o) => o.priority === "Emergencial").length,
        executing: orders.filter((o) => o.status === "EM_EXECUCAO").length,
        validation: orders.filter((o) => o.status === "AGUARDANDO_VALIDACAO")
          .length,
        completed: orders.filter((o) => o.status === "CONCLUIDA").length,
        overdue: orders.filter(
          (o) =>
            !["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(o.status) && o.due_at < now(),
        ).length,
        cost: mats.reduce((s, m) => s + m.quantity * m.unit_cost, 0),
        actual_cost: stockCosts.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0),
        cost_by_stage: costByStage,
        byNeighborhood: Object.entries(
          occurrences.reduce(
            (a, o) => ((a[o.neighborhood] = (a[o.neighborhood] || 0) + 1), a),
            {},
          ),
        ).map(([name, value]) => ({ name, value })),
        byCategory: Object.entries(
          occurrences.reduce(
            (a, o) => ((a[o.category_id] = (a[o.category_id] || 0) + 1), a),
            {},
          ),
        ).map(([id, value]) => ({ id, value })),
        materials: mats,
        orders,
        occurrences,
      };
    }),
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Rota não encontrada." }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status =
      err instanceof z.ZodError
        ? 400
        : err instanceof multer.MulterError
          ? 400
          : err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({
      error:
        err instanceof z.ZodError
          ? "Revise os campos informados."
          : status === 500
            ? "Não foi possível completar a operação."
            : err.message,
      details: err instanceof z.ZodError ? err.flatten() : err.details,
    });
  });
  return app;
}
