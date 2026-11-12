import { randomUUID } from "node:crypto";
import { z } from "zod";
import { listRecords, jsonField } from "../modules/listing/index.js";
import {
  assertExpectedVersion,
  updateVersioned,
} from "../modules/concurrency/index.js";
import {
  canAccessOrder,
  priorities,
  unpack,
  distance,
  nearbyOccurrenceRows,
  now,
} from "../domain.js";
import { canTransition, workflowStatus as status } from "../domain/workflow.js";
import { text, coordinate, occurrenceSchema } from "../http/schemas.js";
import { evidenceTime } from "../http/records.js";
import { PUBLIC_REASON_CODES } from "../modules/portal/index.js";

// Occurrences: listing, territorial map, duplicate check, registration, triage and refusal.
// The two /api/mapa routes stay interleaved here to keep the original registration order.
// Returns { classifyOccurrence }, reused by the integrated triage in POST /api/ordens-servico.
export function registerOccurrences(app, db, deps) {
  const {
    route,
    allow,
    fail,
    failCode,
    requestIdReused,
    catalog,
    entity,
    audit,
    saveClientRequest,
    code,
    history,
    evidence,
  } = deps;
  const listOccurrences = (req) =>
    listRecords(db, "occurrences", req.query, req.user);
  app.get("/api/ocorrencias", route(listOccurrences));
  // Counters for the menu badge and the triage queues and, with ?bairros=1, the neighborhoods for
  // the map filter: computed in the database instead of loading every occurrence. Same access as
  // the list.
  app.get(
    "/api/ocorrencias/resumo",
    route(async (req) => {
      const { bairros } = z
        .object({ bairros: z.enum(["0", "1"]).default("0") })
        .parse(req.query);
      const byStatus = {};
      for (const row of await db.all(
        "SELECT status,COUNT(*) AS n FROM occurrences GROUP BY status",
      ))
        byStatus[row.status] = Number(row.n);
      if (bairros !== "1") return { by_status: byStatus };
      const hood = jsonField(db, "neighborhood");
      const neighborhoods = (
        await db.all(
          `SELECT DISTINCT ${hood} AS name FROM occurrences WHERE ${hood} IS NOT NULL AND ${hood}<>''`,
        )
      )
        .map((r) => r.name)
        .sort();
      return { by_status: byStatus, neighborhoods };
    }),
  );
  app.get(
    "/api/mapa/ocorrencias",
    route(async (req) => ({
      type: "FeatureCollection",
      features: (
        await listRecords(db, "occurrences", req.query, req.user, {
          paginate: false,
        })
      ).map((r) => ({
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
      return (await nearbyOccurrenceRows(db, point, settings.duplicate_radius))
        .map(unpack)
        .map((o) => ({ ...o, distance: distance(point, o) }))
        .filter(
          (o) =>
            o.distance <= settings.duplicate_radius &&
            !["CANCELADA", "RECUSADA"].includes(o.status),
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
          // A link already registered with this key is replayed, never turned into a new occurrence.
          if (previous.entity_type === "occurrence_link")
            return {
              ...(await entity("occurrences", previous.entity_id)),
              linked: true,
            };
          if (previous.entity_type !== "occurrence") requestIdReused();
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
      const nearby = (
        await nearbyOccurrenceRows(db, data, settings.duplicate_radius)
      )
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
        if (!target)
          failCode(
            400,
            "Vínculo de duplicidade inválido.",
            "INVALID_DUPLICATE_LINK",
          );
        await audit(
          req,
          "occurrence",
          target.id,
          "Solicitação relacionada recebida",
          null,
          { description: data.description, origin: data.origin },
        );
        if (data.request_id)
          await saveClientRequest(
            req.user.id,
            data.request_id,
            "occurrence_link",
            target.id,
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
        await saveClientRequest(req.user.id, data.request_id, "occurrence", id);
      return entity("occurrences", id);
    }, true),
  );
  // Lightweight operational details, requested only when a territorial point opens.
  app.get(
    "/api/mapa/ocorrencias/:id/resumo",
    route(async (req) => {
      const occurrence = await entity("occurrences", req.params.id);
      const linked = (
        await db.all(
          "SELECT o.* FROM orders o JOIN order_occurrences r ON r.order_id=o.id WHERE r.occurrence_id=? ORDER BY o.created_at DESC,o.id",
          [occurrence.id],
        )
      )
        .map(unpack)
        .filter((o) => canAccessOrder(req.user, o));
      return {
        code: occurrence.code,
        address: occurrence.address,
        orders: await Promise.all(
          linked.map(async (o) => {
            const photos = (await evidence("order", o.id))
              .filter(
                (e) =>
                  e.mime.startsWith("image/") &&
                  evidenceTime(e) >= (o.reprogrammed_at || o.created_at),
              )
              .sort(
                (a, b) =>
                  b.created_at.localeCompare(a.created_at) ||
                  b.id.localeCompare(a.id),
              );
            const photo = (stage) => {
              const e = photos.find(
                (e) =>
                  e.stage === stage &&
                  (stage !== "depois" ||
                    evidenceTime(e) >=
                      [
                        o.started_at,
                        o.reopened_at,
                        o.reprogrammed_at,
                        o.created_at,
                      ]
                        .filter(Boolean)
                        .sort()
                        .at(-1)),
              );
              return e ? `/api/anexos/${e.id}` : null;
            };
            const team = o.team_id
              ? unpack(
                  await db.get("SELECT * FROM catalogs WHERE id=?", [
                    o.team_id,
                  ]),
                )
              : null;
            return {
              code: o.code,
              started_at: o.started_at || null,
              attendance_at: o.finished_at || o.scheduled_at || null,
              completed_at: o.completed_at || null,
              expected_completion_at: o.due_at || null,
              team: team?.name || null,
              before: photo("antes"),
              after: photo("depois"),
            };
          }),
        ),
      };
    }),
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
    assertExpectedVersion(old, payload.version);
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
    await updateVersioned(
      db,
      "occurrences",
      old,
      "category_id=?,sector_id=?,priority=?,status=?,updated_at=?,data=?",
      [
        data.category_id,
        data.sector_id,
        data.priority,
        status.EM_TRIAGEM,
        now(),
        JSON.stringify({ ...old, ...data }),
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
  const classify = route(
    (req) => classifyOccurrence(req, req.params.id, req.body),
    true,
  );
  app.post("/api/ocorrencias/:id/classificar", allow("classify"), classify);
  app.patch("/api/ocorrencias/:id", allow("classify"), classify);
  app.post("/api/ocorrencias/:id/encaminhar", allow("classify"), classify);
  app.post(
    "/api/ocorrencias/:id/recusar",
    allow("classify"),
    route(async (req) => {
      const old = await entity("occurrences", req.params.id);
      assertExpectedVersion(old, req.body.version);
      if (!canTransition(old.status, status.RECUSADA, "occurrence"))
        fail(409, "Só é possível recusar uma demanda antes da programação.");
      // public_reason (optional): fixed text shown on the citizen portal; the free-text reason stays internal.
      const { reason, public_reason } = z
        .object({
          reason: text,
          public_reason: z.enum(PUBLIC_REASON_CODES).optional(),
        })
        .parse(req.body);
      const links = await db.all(
        "SELECT order_id FROM order_occurrences WHERE occurrence_id=?",
        [old.id],
      );
      if (links.length)
        fail(
          409,
          "Esta demanda já possui ordem de serviço. Revise a ordem antes de alterar o atendimento.",
        );
      const stamp = now();
      const data = {
        ...old,
        status: status.RECUSADA,
        updated_at: stamp,
        rejection_reason: reason,
        rejected_at: stamp,
        rejected_by: req.user.name,
        ...(public_reason ? { public_reason } : {}),
      };
      await updateVersioned(
        db,
        "occurrences",
        old,
        "status=?,updated_at=?,data=?",
        [status.RECUSADA, stamp, JSON.stringify(data)],
      );
      await audit(
        req,
        "occurrence",
        old.id,
        "Demanda recusada na triagem",
        old,
        data,
      );

      return entity("occurrences", old.id);
    }, true),
  );
  return { classifyOccurrence };
}
