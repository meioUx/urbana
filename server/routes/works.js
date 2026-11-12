import { randomUUID } from "node:crypto";
import { z } from "zod";
import { listRecords } from "../modules/listing/index.js";
import {
  assertExpectedVersion,
  updateVersioned,
  versionConflict,
} from "../modules/concurrency/index.js";
import { canAccessOrder, priorities, unpack, now } from "../domain.js";
import {
  activeInterventionStatuses,
  allowedWorksTransitions,
  assertWorksTransition,
  DEFAULT_CONFLICT_TOLERANCE_M,
  findConflicts,
  isClosedStatus,
  transitionNeedsReason,
  worksStatuses,
} from "../domain/works.js";
import {
  GeometryError,
  geometryBBox,
  normalizeGeometry,
} from "../../shared/geometry.mjs";

// Works (obras) and interventions (P1): CRUD, lifecycle transitions, optional links to
// occurrences and service orders, SQL listings with cursor, bbox/GeoJSON layer and spatial-temporal
// conflict warnings. Links never modify occurrences or orders, and closing or deleting a work or
// an intervention never changes the linked records (simple maintenance stays independent).
// Every write runs through route(..., true) (queue + transaction) and is audited.

const statusLabel = {
  PLANEJADA: "Planejada",
  EM_ANDAMENTO: "Em andamento",
  PARALISADA: "Paralisada",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
};
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.")
  .refine((v) => {
    const d = new Date(v + "T00:00:00.000Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Data inválida.");
const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () =>
  new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const tolerance = (value) =>
  value === undefined || value === ""
    ? DEFAULT_CONFLICT_TOLERANCE_M
    : z.coerce.number().min(0).max(200).parse(value);
const service = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(1e9).nullable().optional(),
  unit: z.string().trim().max(20).optional(),
});
const interventionFields = {
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(3000),
  scope: z.enum(["TRECHO", "AREA", "ATIVO"]),
  location: z.string().trim().min(1).max(300),
  neighborhood: z.string().trim().max(120),
  sector_id: z.string().trim().min(1).max(200).nullable(),
  responsible: z.string().trim().min(1).max(200),
  priority: z.enum(priorities),
  planned_start: isoDate,
  planned_end: isoDate,
  geometry: z.unknown(),
  services: z.array(service).max(100),
};
const projectFields = {
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(3000),
  responsible: z.string().trim().min(1).max(200),
  planned_start: isoDate,
  planned_end: isoDate,
};
const createIntervention = z.object({
  ...interventionFields,
  description: interventionFields.description.default(""),
  neighborhood: interventionFields.neighborhood.default(""),
  sector_id: interventionFields.sector_id.optional(),
  services: interventionFields.services.default([]),
  request_id: z.string().uuid().optional(),
});
const actualDates = {
  actual_start: isoDate.nullable().optional(),
  actual_end: isoDate.nullable().optional(),
};
const patchIntervention = z
  .object({ ...interventionFields, ...actualDates })
  .partial();
const createProject = z.object({
  ...projectFields,
  description: projectFields.description.default(""),
  request_id: z.string().uuid().optional(),
});
const patchProject = z.object({ ...projectFields, ...actualDates }).partial();
const transitionBody = (kind) =>
  z.object({
    to: z.enum(worksStatuses(kind)),
    reason: z.string().trim().max(2000).optional(),
    date: isoDate.optional(),
  });

const INTERVENTION_COLUMNS = [
  "id",
  "code",
  "status",
  "priority",
  "sector_id",
  "planned_start",
  "planned_end",
  "actual_start",
  "actual_end",
  "geometry",
  "geometry_type",
  "min_lng",
  "min_lat",
  "max_lng",
  "max_lat",
  "created_at",
  "updated_at",
  "version",
  "geom",
];
const PROJECT_COLUMNS = [
  "id",
  "code",
  "status",
  "planned_start",
  "planned_end",
  "actual_start",
  "actual_end",
  "created_at",
  "updated_at",
  "version",
];
const omit = (record, keys) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => !keys.includes(k)));

export function registerWorks(app, db, deps) {
  const {
    route,
    allow,
    fail,
    failCode,
    requestIdReused,
    catalog,
    entity,
    audit,
    clientRequest,
    saveClientRequest,
    code,
    history,
  } = deps;

  const parseGeometry = (value) => {
    try {
      return normalizeGeometry(value);
    } catch (e) {
      if (e instanceof GeometryError)
        failCode(400, e.message, "INVALID_GEOMETRY");
      throw e;
    }
  };
  const checkPeriods = (x) => {
    if (x.planned_end < x.planned_start)
      fail(
        400,
        "A data final prevista deve ser igual ou posterior à data inicial.",
      );
    if (x.actual_end && !x.actual_start)
      fail(400, "Informe a data real de início antes da data real de término.");
    if (x.actual_start && x.actual_end && x.actual_end < x.actual_start)
      fail(
        400,
        "A data real de término deve ser igual ou posterior à de início.",
      );
    if (
      (x.actual_start && x.actual_start > tomorrow()) ||
      (x.actual_end && x.actual_end > tomorrow())
    )
      fail(400, "Datas reais não podem estar no futuro.");
    if (x.status === "PLANEJADA" && x.actual_start)
      fail(400, "A data real de início só existe depois de iniciar.");
    if (x.status !== "CONCLUIDA" && x.actual_end)
      fail(400, "A data real de término só existe na conclusão.");
  };
  const toIntervention = (row) => {
    const r = unpack(row);
    if (!r) return r;
    if (typeof r.geometry === "string") r.geometry = JSON.parse(r.geometry);
    delete r.geom;
    return r;
  };
  const loadIntervention = async (id) =>
    toIntervention(await entity("interventions", id));
  const loadProject = (id) => entity("projects", id);
  const assertOpen = (record, what) => {
    if (isClosedStatus(record.status))
      failCode(
        409,
        `${what} encerrada: reabra para alterar vínculos.`,
        "RECORD_CLOSED",
      );
  };

  // ---- Conflicts --------------------------------------------------------------------------
  // Candidates pre-filtered in SQL (active status, overlapping planned period, bbox expanded by
  // the tolerance); the exact spatial test runs in JS (shared/geometry.mjs) on both dialects.
  const candidates = async (target, meters) => {
    const [w, s, e, n] = geometryBBox(target.geometry);
    const dLat = meters / 111320 + 1e-7;
    const dLng =
      meters /
        (111320 * Math.max(Math.cos(((s + n) / 2) * (Math.PI / 180)), 0.01)) +
      1e-7;
    const box = [w - dLng, s - dLat, e + dLng, n + dLat];
    const spatial =
      db.dialect === "postgres"
        ? "geom && ST_MakeEnvelope(?,?,?,?,4326)"
        : "max_lng>=? AND max_lat>=? AND min_lng<=? AND min_lat<=?";
    const rows = await db.all(
      `SELECT * FROM interventions WHERE status IN (${activeInterventionStatuses.map(() => "?").join(",")}) AND planned_start<=? AND planned_end>=? AND id<>? AND ${spatial} ORDER BY planned_start,id`,
      [
        ...activeInterventionStatuses,
        target.planned_end,
        target.planned_start,
        target.id || "",
        ...box,
      ],
    );
    return rows.map(toIntervention);
  };
  const pair = (a, b) => (a < b ? [a, b] : [b, a]);
  const conflictsFor = async (
    target,
    meters = DEFAULT_CONFLICT_TOLERANCE_M,
  ) => {
    const found = findConflicts(
      target,
      await candidates(target, meters),
      meters,
    );
    const reviews = new Map();
    if (target.id && found.length)
      for (const r of await db.all(
        "SELECT r.*,u.name AS user_name FROM intervention_conflict_reviews r JOIN users u ON u.id=r.user_id WHERE r.intervention_a=? OR r.intervention_b=?",
        [target.id, target.id],
      ))
        reviews.set(
          r.intervention_a === target.id ? r.intervention_b : r.intervention_a,
          { note: r.note, user_name: r.user_name, created_at: r.created_at },
        );
    return found.map(({ other, distance_m, overlap }) => ({
      id: other.id,
      code: other.code,
      title: other.title,
      status: other.status,
      location: other.location,
      planned_start: other.planned_start,
      planned_end: other.planned_end,
      geometry_type: other.geometry_type,
      distance_m,
      overlap_start: overlap.start,
      overlap_end: overlap.end,
      review: reviews.get(other.id) || null,
    }));
  };

  // ---- Details -----------------------------------------------------------------------------
  const interventionDetail = async (req, id) => {
    const it = await loadIntervention(id);
    const occurrences = (
      await db.all(
        "SELECT o.*,l.created_at AS linked_at FROM occurrences o JOIN intervention_occurrences l ON l.occurrence_id=o.id WHERE l.intervention_id=? ORDER BY l.created_at,o.code",
        [id],
      )
    )
      .map(unpack)
      .map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        priority: o.priority,
        address: o.address,
        neighborhood: o.neighborhood,
        linked_at: o.linked_at,
      }));
    const orders = (
      await db.all(
        "SELECT o.*,l.created_at AS linked_at FROM orders o JOIN intervention_orders l ON l.order_id=o.id WHERE l.intervention_id=? ORDER BY l.created_at,o.code",
        [id],
      )
    )
      .map(unpack)
      .filter((o) => canAccessOrder(req.user, o))
      .map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        priority: o.priority,
        team_id: o.team_id,
        responsible: o.responsible,
        due_at: o.due_at,
        linked_at: o.linked_at,
      }));
    const project = unpack(
      await db.get(
        "SELECT p.* FROM projects p JOIN project_interventions l ON l.project_id=p.id WHERE l.intervention_id=?",
        [id],
      ),
    );
    return {
      ...it,
      project: project
        ? {
            id: project.id,
            code: project.code,
            title: project.title,
            status: project.status,
          }
        : null,
      occurrences,
      orders,
      conflicts: await conflictsFor(it),
      allowed_transitions: allowedWorksTransitions("intervention", it.status),
      history: await history("intervention", id),
    };
  };
  const projectDetail = async (req, id) => {
    const p = await loadProject(id);
    const interventions = (
      await db.all(
        "SELECT i.* FROM interventions i JOIN project_interventions l ON l.intervention_id=i.id WHERE l.project_id=? ORDER BY i.planned_start,i.code",
        [id],
      )
    ).map(toIntervention);
    const orders = (
      await db.all(
        "SELECT o.* FROM orders o JOIN project_orders l ON l.order_id=o.id WHERE l.project_id=? ORDER BY l.created_at,o.code",
        [id],
      )
    )
      .map(unpack)
      .filter((o) => canAccessOrder(req.user, o))
      .map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        priority: o.priority,
        team_id: o.team_id,
        responsible: o.responsible,
        due_at: o.due_at,
      }));
    const boxes = interventions.map((i) => [
      i.min_lng,
      i.min_lat,
      i.max_lng,
      i.max_lat,
    ]);
    return {
      ...p,
      interventions: interventions.map((i) => ({
        id: i.id,
        code: i.code,
        title: i.title,
        status: i.status,
        priority: i.priority,
        location: i.location,
        planned_start: i.planned_start,
        planned_end: i.planned_end,
        geometry_type: i.geometry_type,
        geometry: i.geometry,
      })),
      orders,
      extent: boxes.length
        ? [
            Math.min(...boxes.map((b) => b[0])),
            Math.min(...boxes.map((b) => b[1])),
            Math.max(...boxes.map((b) => b[2])),
            Math.max(...boxes.map((b) => b[3])),
          ]
        : null,
      allowed_transitions: allowedWorksTransitions("project", p.status),
      history: await history("project", id),
    };
  };

  // ---- Writes ------------------------------------------------------------------------------
  const writeIntervention = (old, next) =>
    updateVersioned(
      db,
      "interventions",
      old,
      "status=?,priority=?,sector_id=?,planned_start=?,planned_end=?,actual_start=?,actual_end=?,geometry=?,geometry_type=?,min_lng=?,min_lat=?,max_lng=?,max_lat=?,updated_at=?,data=?",
      [
        next.status,
        next.priority,
        next.sector_id || null,
        next.planned_start,
        next.planned_end,
        next.actual_start || null,
        next.actual_end || null,
        JSON.stringify(next.geometry),
        next.geometry.type,
        ...geometryBBox(next.geometry),
        next.updated_at,
        JSON.stringify(omit(next, INTERVENTION_COLUMNS)),
      ],
    );
  const writeProject = (old, next) =>
    updateVersioned(
      db,
      "projects",
      old,
      "status=?,planned_start=?,planned_end=?,actual_start=?,actual_end=?,updated_at=?,data=?",
      [
        next.status,
        next.planned_start,
        next.planned_end,
        next.actual_start || null,
        next.actual_end || null,
        next.updated_at,
        JSON.stringify(omit(next, PROJECT_COLUMNS)),
      ],
    );
  const deleteVersioned = async (table, current) => {
    const result = await db.run(
      `DELETE FROM ${table} WHERE id=? AND version=?`,
      [current.id, current.version],
    );
    if (Number(result.rowCount ?? result.changes) !== 1)
      throw versionConflict(
        (await db.get(`SELECT version FROM ${table} WHERE id=?`, [current.id]))
          ?.version ?? null,
      );
  };
  const replay = async (req, requestId, type, detail) => {
    if (!requestId) return null;
    const previous = await clientRequest(req.user.id, requestId);
    if (!previous) return null;
    if (previous.entity_type !== type) requestIdReused();
    return { ...(await detail(req, previous.entity_id)), replayed: true };
  };
  // Lifecycle transition shared by interventions and works. Real dates follow the transition:
  // starting sets actual_start (kept on resume), concluding sets actual_end, reopening clears it.
  const transition = (kind, current, body, user) => {
    assertWorksTransition(kind, current.status, body.to);
    if (transitionNeedsReason(kind, current.status, body.to) && !body.reason)
      failCode(
        400,
        "Informe o motivo desta mudança de situação.",
        "REASON_REQUIRED",
      );
    const day = body.date || today();
    const next = {
      ...current,
      status: body.to,
      updated_at: now(),
      status_changed_by: user.name,
      status_reason: body.reason || null,
    };
    if (body.to === "EM_ANDAMENTO") {
      if (current.status === "CONCLUIDA") {
        next.actual_end = null;
        next.reopen_reason = body.reason;
      }
      if (!next.actual_start) next.actual_start = day;
    }
    if (body.to === "CONCLUIDA") next.actual_end = day;
    if (body.to === "PARALISADA") next.pause_reason = body.reason;
    if (body.to === "CANCELADA") next.cancel_reason = body.reason;
    checkPeriods(next);
    return next;
  };
  const stateSnapshot = (x) => ({
    status: x.status,
    actual_start: x.actual_start || null,
    actual_end: x.actual_end || null,
  });

  // ---- Interventions -----------------------------------------------------------------------
  const listItems = async (rows) => {
    const ids = rows.map((r) => r.id);
    const counts = async (table) => {
      if (!ids.length) return new Map();
      const result = await db.all(
        `SELECT intervention_id AS id,COUNT(*) AS n FROM ${table} WHERE intervention_id IN (${ids.map(() => "?").join(",")}) GROUP BY intervention_id`,
        ids,
      );
      return new Map(result.map((r) => [r.id, Number(r.n)]));
    };
    const occ = await counts("intervention_occurrences"),
      ord = await counts("intervention_orders");
    const projects = new Map();
    if (ids.length)
      for (const r of await db.all(
        `SELECT l.intervention_id,p.id,p.code,p.data FROM project_interventions l JOIN projects p ON p.id=l.project_id WHERE l.intervention_id IN (${ids.map(() => "?").join(",")})`,
        ids,
      ))
        projects.set(r.intervention_id, {
          id: r.id,
          code: r.code,
          title: JSON.parse(r.data).title,
        });
    return rows.map((r) => {
      const item = omit(toIntervention(r), ["geometry"]);
      return {
        ...item,
        occurrence_count: occ.get(r.id) || 0,
        order_count: ord.get(r.id) || 0,
        project: projects.get(r.id) || null,
      };
    });
  };
  app.get(
    "/api/intervencoes",
    route(async (req) => {
      const page = await listRecords(
        db,
        "interventions",
        { ...req.query, limit: req.query.limit ?? "50" },
        req.user,
      );
      return { ...page, items: await listItems(page.items) };
    }),
  );
  // Map layer: GeoJSON of the filtered interventions (bbox=west,south,east,north), not paginated.
  app.get(
    "/api/intervencoes/geojson",
    route(async (req) => {
      const query = { ...req.query };
      delete query.limit;
      delete query.cursor;
      const rows = await listRecords(db, "interventions", query, req.user, {
        paginate: false,
      });
      return {
        type: "FeatureCollection",
        features: rows.map(toIntervention).map((i) => ({
          type: "Feature",
          id: i.id,
          geometry: i.geometry,
          properties: {
            id: i.id,
            code: i.code,
            title: i.title,
            status: i.status,
            priority: i.priority,
            location: i.location,
            planned_start: i.planned_start,
            planned_end: i.planned_end,
          },
        })),
      };
    }),
  );
  // Conflict check of an unsaved geometry/period (form warning). Reads only.
  app.post(
    "/api/intervencoes/conflitos",
    allow("works"),
    route(async (req) => {
      const body = z
        .object({
          planned_start: isoDate,
          planned_end: isoDate,
          exclude_id: z.string().max(200).optional(),
        })
        .parse(req.body);
      checkPeriods(body);
      const target = {
        id: body.exclude_id,
        geometry: parseGeometry(req.body.geometry),
        planned_start: body.planned_start,
        planned_end: body.planned_end,
      };
      return {
        tolerance_m: tolerance(req.body.tolerance_m),
        conflicts: await conflictsFor(target, tolerance(req.body.tolerance_m)),
      };
    }),
  );
  app.post(
    "/api/intervencoes",
    allow("works"),
    route(async (req) => {
      const body = createIntervention.parse(req.body);
      const replayed = await replay(
        req,
        body.request_id,
        "intervention",
        interventionDetail,
      );
      if (replayed) return replayed;
      const geometry = parseGeometry(body.geometry);
      checkPeriods(body);
      if (body.sector_id) await catalog(body.sector_id, "setores");
      const id = randomUUID(),
        stamp = now(),
        protocol = await code("interventions", "INT");
      const data = {
        title: body.title,
        description: body.description,
        scope: body.scope,
        location: body.location,
        neighborhood: body.neighborhood,
        responsible: body.responsible,
        services: body.services,
        created_by: req.user.id,
        created_by_name: req.user.name,
      };
      await db.run(
        "INSERT INTO interventions(id,code,status,priority,sector_id,planned_start,planned_end,actual_start,actual_end,geometry,geometry_type,min_lng,min_lat,max_lng,max_lat,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          protocol,
          "PLANEJADA",
          body.priority,
          body.sector_id || null,
          body.planned_start,
          body.planned_end,
          null,
          null,
          JSON.stringify(geometry),
          geometry.type,
          ...geometryBBox(geometry),
          stamp,
          stamp,
          JSON.stringify(data),
        ],
      );
      await audit(req, "intervention", id, "Intervenção cadastrada", null, {
        ...data,
        code: protocol,
        status: "PLANEJADA",
        priority: body.priority,
        sector_id: body.sector_id || null,
        planned_start: body.planned_start,
        planned_end: body.planned_end,
        geometry,
      });
      if (body.request_id)
        await saveClientRequest(
          req.user.id,
          body.request_id,
          "intervention",
          id,
        );
      return interventionDetail(req, id);
    }, true),
  );
  app.get(
    "/api/intervencoes/:id",
    route((req) => interventionDetail(req, req.params.id)),
  );
  app.get(
    "/api/intervencoes/:id/conflitos",
    route(async (req) => {
      const meters = tolerance(req.query.tolerance_m);
      return {
        tolerance_m: meters,
        conflicts: await conflictsFor(
          await loadIntervention(req.params.id),
          meters,
        ),
      };
    }),
  );
  // Records that a human evaluated the conflict between two interventions (warning, not a block).
  app.post(
    "/api/intervencoes/:id/conflitos/:otherId/avaliacao",
    allow("works"),
    route(async (req) => {
      const { note } = z
        .object({ note: z.string().trim().min(3).max(1000) })
        .parse(req.body);
      const it = await loadIntervention(req.params.id);
      await loadIntervention(req.params.otherId);
      if (!(await conflictsFor(it)).some((c) => c.id === req.params.otherId))
        failCode(
          409,
          "Não há conflito atual entre estas intervenções.",
          "NO_CONFLICT",
        );
      const [a, b] = pair(it.id, req.params.otherId);
      const before = await db.get(
        "SELECT note,user_id,created_at FROM intervention_conflict_reviews WHERE intervention_a=? AND intervention_b=?",
        [a, b],
      );
      await db.run(
        "DELETE FROM intervention_conflict_reviews WHERE intervention_a=? AND intervention_b=?",
        [a, b],
      );
      await db.run(
        "INSERT INTO intervention_conflict_reviews(intervention_a,intervention_b,note,user_id,created_at) VALUES(?,?,?,?,?)",
        [a, b, note, req.user.id, now()],
      );
      await audit(
        req,
        "intervention",
        it.id,
        "Conflito avaliado",
        before ? { other_id: req.params.otherId, ...before } : null,
        { other_id: req.params.otherId, note },
      );
      return interventionDetail(req, it.id);
    }, true),
  );
  app.patch(
    "/api/intervencoes/:id",
    allow("works"),
    route(async (req) => {
      const old = await loadIntervention(req.params.id);
      assertExpectedVersion(old, req.body.version);
      if (old.status === "CANCELADA")
        failCode(
          409,
          "Intervenção cancelada não pode ser alterada.",
          "RECORD_CLOSED",
        );
      const body = patchIntervention.parse(req.body);
      if (!Object.keys(body).length) fail(400, "Nenhuma alteração informada.");
      const next = { ...old, ...body, updated_at: now() };
      if ("geometry" in body) next.geometry = parseGeometry(body.geometry);
      checkPeriods(next);
      if (body.sector_id) await catalog(body.sector_id, "setores");
      const changed = Object.keys(body).filter(
        (k) =>
          JSON.stringify(old[k] ?? null) !== JSON.stringify(next[k] ?? null),
      );
      if (!changed.length) return interventionDetail(req, old.id);
      await writeIntervention(old, next);
      // An evaluation refers to the area and period evaluated: changing either discards it.
      if (
        changed.some((k) =>
          ["geometry", "planned_start", "planned_end"].includes(k),
        )
      ) {
        const reviews = await db.all(
          "SELECT * FROM intervention_conflict_reviews WHERE intervention_a=? OR intervention_b=?",
          [old.id, old.id],
        );
        if (reviews.length) {
          await db.run(
            "DELETE FROM intervention_conflict_reviews WHERE intervention_a=? OR intervention_b=?",
            [old.id, old.id],
          );
          await audit(
            req,
            "intervention",
            old.id,
            "Avaliações de conflito descartadas pela mudança de área ou período",
            { reviews },
            null,
          );
        }
      }
      await audit(
        req,
        "intervention",
        old.id,
        "Intervenção alterada",
        Object.fromEntries(changed.map((k) => [k, old[k] ?? null])),
        Object.fromEntries(changed.map((k) => [k, next[k] ?? null])),
      );
      return interventionDetail(req, old.id);
    }, true),
  );
  app.post(
    "/api/intervencoes/:id/transicao",
    allow("works"),
    route(async (req) => {
      const old = await loadIntervention(req.params.id);
      assertExpectedVersion(old, req.body.version);
      const body = transitionBody("intervention").parse(req.body);
      const next = transition("intervention", old, body, req.user);
      await writeIntervention(old, next);
      await audit(
        req,
        "intervention",
        old.id,
        `Situação alterada: ${statusLabel[old.status]} → ${statusLabel[next.status]}`,
        stateSnapshot(old),
        { ...stateSnapshot(next), reason: body.reason || null },
      );
      return interventionDetail(req, old.id);
    }, true),
  );
  // Only a planned intervention can be deleted (no execution history); the others are cancelled.
  // Links, conflict evaluations and the work grouping go away; occurrences and orders do not change.
  app.delete(
    "/api/intervencoes/:id",
    allow("works"),
    route(async (req) => {
      const old = await loadIntervention(req.params.id);
      assertExpectedVersion(old, req.body?.version);
      if (old.status !== "PLANEJADA")
        failCode(
          409,
          "Só é possível excluir uma intervenção planejada. Para encerrar, cancele-a.",
          "INVALID_STATUS",
        );
      const links = {
        occurrence_ids: (
          await db.all(
            "SELECT occurrence_id FROM intervention_occurrences WHERE intervention_id=?",
            [old.id],
          )
        ).map((r) => r.occurrence_id),
        order_ids: (
          await db.all(
            "SELECT order_id FROM intervention_orders WHERE intervention_id=?",
            [old.id],
          )
        ).map((r) => r.order_id),
        project_id:
          (
            await db.get(
              "SELECT project_id FROM project_interventions WHERE intervention_id=?",
              [old.id],
            )
          )?.project_id || null,
      };
      for (const sql of [
        "DELETE FROM intervention_occurrences WHERE intervention_id=?",
        "DELETE FROM intervention_orders WHERE intervention_id=?",
        "DELETE FROM project_interventions WHERE intervention_id=?",
        "DELETE FROM intervention_conflict_reviews WHERE intervention_a=? OR intervention_b=?",
      ])
        await db.run(sql, sql.includes(" OR ") ? [old.id, old.id] : [old.id]);
      await deleteVersioned("interventions", old);
      await audit(
        req,
        "intervention",
        old.id,
        "Intervenção excluída",
        { ...omit(old, ["geom"]), ...links },
        null,
      );
      return { ok: true };
    }, true),
  );
  const linkRoutes = (
    base,
    {
      table,
      column,
      fkTable,
      label,
      load,
      ownerTable,
      ownerLabel,
      ownerType,
      detail,
      verify,
    },
  ) => {
    app.post(
      `${base}`,
      allow("works"),
      route(async (req) => {
        const owner =
          ownerTable === "interventions"
            ? await loadIntervention(req.params.id)
            : await loadProject(req.params.id);
        assertOpen(owner, ownerLabel);
        const { target_id } = z
          .object({ target_id: z.string().trim().min(1).max(200) })
          .parse({ target_id: req.body?.[column] });
        const target = await load(req, target_id);
        await verify?.(target, owner);
        if (
          await db.get(
            `SELECT 1 AS ok FROM ${table} WHERE ${ownerType}_id=? AND ${column}=?`,
            [owner.id, target.id],
          )
        )
          failCode(
            409,
            `${label} já vinculada a este registro.`,
            "ALREADY_LINKED",
          );
        await db.run(
          `INSERT INTO ${table}(${ownerType}_id,${column},user_id,created_at) VALUES(?,?,?,?)`,
          [owner.id, target.id, req.user.id, now()],
        );
        await audit(
          req,
          ownerType === "project" ? "project" : "intervention",
          owner.id,
          `${label} vinculada`,
          null,
          { [column]: target.id, code: target.code },
        );
        return detail(req, owner.id);
      }, true),
    );
    app.delete(
      `${base}/:targetId`,
      allow("works"),
      route(async (req) => {
        const owner =
          ownerTable === "interventions"
            ? await loadIntervention(req.params.id)
            : await loadProject(req.params.id);
        assertOpen(owner, ownerLabel);
        const link = await db.get(
          `SELECT * FROM ${table} WHERE ${ownerType}_id=? AND ${column}=?`,
          [owner.id, req.params.targetId],
        );
        if (!link) fail(404, "Vínculo não encontrado.");
        const target = await db.get(`SELECT code FROM ${fkTable} WHERE id=?`, [
          req.params.targetId,
        ]);
        await db.run(
          `DELETE FROM ${table} WHERE ${ownerType}_id=? AND ${column}=?`,
          [owner.id, req.params.targetId],
        );
        await audit(
          req,
          ownerType === "project" ? "project" : "intervention",
          owner.id,
          `${label} desvinculada`,
          { [column]: req.params.targetId, code: target?.code || null },
          null,
        );
        return detail(req, owner.id);
      }, true),
    );
  };
  const loadOccurrence = (req, id) => entity("occurrences", id);
  const loadOrder = async (req, id) => {
    const o = await entity("orders", id);
    if (!canAccessOrder(req.user, o))
      failCode(
        403,
        "Esta ordem pertence a outra equipe.",
        "ORDER_NOT_ACCESSIBLE",
      );
    return o;
  };
  linkRoutes("/api/intervencoes/:id/ocorrencias", {
    table: "intervention_occurrences",
    column: "occurrence_id",
    fkTable: "occurrences",
    label: "Ocorrência",
    load: loadOccurrence,
    ownerTable: "interventions",
    ownerLabel: "Intervenção",
    ownerType: "intervention",
    detail: interventionDetail,
  });
  linkRoutes("/api/intervencoes/:id/ordens-servico", {
    table: "intervention_orders",
    column: "order_id",
    fkTable: "orders",
    label: "Ordem de serviço",
    load: loadOrder,
    ownerTable: "interventions",
    ownerLabel: "Intervenção",
    ownerType: "intervention",
    detail: interventionDetail,
  });

  // ---- Works (obras) -----------------------------------------------------------------------
  app.get(
    "/api/obras",
    route(async (req) => {
      const page = await listRecords(
        db,
        "projects",
        { ...req.query, limit: req.query.limit ?? "50" },
        req.user,
      );
      const ids = page.items.map((p) => p.id);
      const counts = async (table) =>
        ids.length
          ? new Map(
              (
                await db.all(
                  `SELECT project_id AS id,COUNT(*) AS n FROM ${table} WHERE project_id IN (${ids.map(() => "?").join(",")}) GROUP BY project_id`,
                  ids,
                )
              ).map((r) => [r.id, Number(r.n)]),
            )
          : new Map();
      const interventions = await counts("project_interventions"),
        orders = await counts("project_orders");
      return {
        ...page,
        items: page.items.map((p) => ({
          ...p,
          intervention_count: interventions.get(p.id) || 0,
          order_count: orders.get(p.id) || 0,
        })),
      };
    }),
  );
  app.post(
    "/api/obras",
    allow("works"),
    route(async (req) => {
      const body = createProject.parse(req.body);
      const replayed = await replay(
        req,
        body.request_id,
        "project",
        projectDetail,
      );
      if (replayed) return replayed;
      checkPeriods(body);
      const id = randomUUID(),
        stamp = now(),
        protocol = await code("projects", "OB");
      const data = {
        title: body.title,
        description: body.description,
        responsible: body.responsible,
        created_by: req.user.id,
        created_by_name: req.user.name,
      };
      await db.run(
        "INSERT INTO projects(id,code,status,planned_start,planned_end,actual_start,actual_end,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          protocol,
          "PLANEJADA",
          body.planned_start,
          body.planned_end,
          null,
          null,
          stamp,
          stamp,
          JSON.stringify(data),
        ],
      );
      await audit(req, "project", id, "Obra cadastrada", null, {
        ...data,
        code: protocol,
        status: "PLANEJADA",
        planned_start: body.planned_start,
        planned_end: body.planned_end,
      });
      if (body.request_id)
        await saveClientRequest(req.user.id, body.request_id, "project", id);
      return projectDetail(req, id);
    }, true),
  );
  app.get(
    "/api/obras/:id",
    route((req) => projectDetail(req, req.params.id)),
  );
  app.patch(
    "/api/obras/:id",
    allow("works"),
    route(async (req) => {
      const old = await loadProject(req.params.id);
      assertExpectedVersion(old, req.body.version);
      if (old.status === "CANCELADA")
        failCode(409, "Obra cancelada não pode ser alterada.", "RECORD_CLOSED");
      const body = patchProject.parse(req.body);
      if (!Object.keys(body).length) fail(400, "Nenhuma alteração informada.");
      const next = { ...old, ...body, updated_at: now() };
      checkPeriods(next);
      const changed = Object.keys(body).filter(
        (k) =>
          JSON.stringify(old[k] ?? null) !== JSON.stringify(next[k] ?? null),
      );
      if (!changed.length) return projectDetail(req, old.id);
      await writeProject(old, next);
      await audit(
        req,
        "project",
        old.id,
        "Obra alterada",
        Object.fromEntries(changed.map((k) => [k, old[k] ?? null])),
        Object.fromEntries(changed.map((k) => [k, next[k] ?? null])),
      );
      return projectDetail(req, old.id);
    }, true),
  );
  app.post(
    "/api/obras/:id/transicao",
    allow("works"),
    route(async (req) => {
      const old = await loadProject(req.params.id);
      assertExpectedVersion(old, req.body.version);
      const body = transitionBody("project").parse(req.body);
      const next = transition("project", old, body, req.user);
      // A work concludes only when its interventions are concluded or cancelled. Linked service
      // orders follow their own workflow and do not block (nor are changed by) the work.
      if (body.to === "CONCLUIDA") {
        const open = await db.all(
          `SELECT i.code FROM interventions i JOIN project_interventions l ON l.intervention_id=i.id WHERE l.project_id=? AND i.status IN (${activeInterventionStatuses.map(() => "?").join(",")}) ORDER BY i.code`,
          [old.id, ...activeInterventionStatuses],
        );
        if (open.length)
          failCode(
            409,
            "Conclua ou cancele as intervenções da obra antes de concluí-la.",
            "OPEN_INTERVENTIONS",
            { interventions: open.map((r) => r.code) },
          );
      }
      await writeProject(old, next);
      await audit(
        req,
        "project",
        old.id,
        `Situação alterada: ${statusLabel[old.status]} → ${statusLabel[next.status]}`,
        stateSnapshot(old),
        { ...stateSnapshot(next), reason: body.reason || null },
      );
      return projectDetail(req, old.id);
    }, true),
  );
  app.delete(
    "/api/obras/:id",
    allow("works"),
    route(async (req) => {
      const old = await loadProject(req.params.id);
      assertExpectedVersion(old, req.body?.version);
      if (old.status !== "PLANEJADA")
        failCode(
          409,
          "Só é possível excluir uma obra planejada. Para encerrar, cancele-a.",
          "INVALID_STATUS",
        );
      const links = {
        intervention_ids: (
          await db.all(
            "SELECT intervention_id FROM project_interventions WHERE project_id=?",
            [old.id],
          )
        ).map((r) => r.intervention_id),
        order_ids: (
          await db.all(
            "SELECT order_id FROM project_orders WHERE project_id=?",
            [old.id],
          )
        ).map((r) => r.order_id),
      };
      await db.run("DELETE FROM project_interventions WHERE project_id=?", [
        old.id,
      ]);
      await db.run("DELETE FROM project_orders WHERE project_id=?", [old.id]);
      await deleteVersioned("projects", old);
      await audit(
        req,
        "project",
        old.id,
        "Obra excluída",
        { ...old, ...links },
        null,
      );
      return { ok: true };
    }, true),
  );
  // An intervention and an OS belong directly to at most one work.
  const onlyOneWork = (column) => async (target, owner) => {
    const other = await db.get(
      `SELECT p.id,p.code FROM ${column === "intervention_id" ? "project_interventions" : "project_orders"} l JOIN projects p ON p.id=l.project_id WHERE l.${column}=?`,
      [target.id],
    );
    if (other && other.id !== owner.id)
      failCode(
        409,
        `Registro já agrupado na obra ${other.code}.`,
        "ALREADY_LINKED",
        { project_id: other.id, project_code: other.code },
      );
  };
  linkRoutes("/api/obras/:id/intervencoes", {
    table: "project_interventions",
    column: "intervention_id",
    fkTable: "interventions",
    label: "Intervenção",
    load: (req, id) => loadIntervention(id),
    ownerTable: "projects",
    ownerLabel: "Obra",
    ownerType: "project",
    detail: projectDetail,
    verify: onlyOneWork("intervention_id"),
  });
  linkRoutes("/api/obras/:id/ordens-servico", {
    table: "project_orders",
    column: "order_id",
    fkTable: "orders",
    label: "Ordem de serviço",
    load: loadOrder,
    ownerTable: "projects",
    ownerLabel: "Obra",
    ownerType: "project",
    detail: projectDetail,
    verify: onlyOneWork("order_id"),
  });
}
