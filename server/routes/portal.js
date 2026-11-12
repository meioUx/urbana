// Portal do cidadão: public routes (no session) under /api/publico, the administrative settings of
// the portal and the two public pages (/portal and /portal/acompanhar).
//
// Public surface, registered by server/app.js after the security headers, request logger and
// same-origin check, and BEFORE the session middleware and the JSON parser of the authenticated API:
//   USE  /api/publico              gate: portal disabled → 404 for everything (nothing is read)
//   USE  /api/publico              JSON parser limited to 8 kB
//   GET  /api/publico/catalogo     categories (id, name, subcategories), consent text, form token
//   POST /api/publico/demandas     register a demand (multipart, optional photo)
//   POST /api/publico/acompanhar   public status by protocol number + tracking code
//   USE  /api/publico              any other path → 404 (never falls through to the session layer)
// These handlers only touch occurrences/evidence/audit_logs/portal_* tables and never set req.user.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { nearbyOccurrenceRows, distance, now, unpack } from "../domain.js";
import { createUploadGuard } from "../modules/files/upload-limit.js";
import { scanUpload, MALWARE_MESSAGE } from "../modules/files/upload-scan.js";
import {
  PORTAL_ACTOR,
  PORTAL_ORIGIN,
  PORTAL_DEFAULTS,
  checkFormToken,
  consentVersion,
  ensurePortalActor,
  issueFormToken,
  newTrackingCode,
  portalEnabled,
  portalForcedOff,
  portalSecret,
  portalSettingsSchema,
  publicTracking,
  readPortalSettings,
  requestKeyHash,
  sameDigest,
  trackingHash,
} from "../modules/portal/index.js";
import {
  HOUR_MS,
  QUARTER_HOUR_MS,
  clientBucket,
  windowCounter,
} from "../modules/portal/limits.js";

export const PORTAL_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const GLOBAL_BUCKET = "global:create";
const REPLAY_WINDOW_MS = 24 * 3600 * 1000;
// Compared against when the protocol does not exist, so both failures do the same work.
const DUMMY_HASH = "0".repeat(64);
const NOT_FOUND_BODY = { error: "Rota não encontrada." };
const TRACKING_FAILED = {
  error:
    "O número da demanda ou o código de acompanhamento não conferem. Confira e tente de novo.",
  code: "TRACKING_NOT_FOUND",
};
const REJECTED_MESSAGE =
  "Não foi possível confirmar o envio. Aguarde alguns segundos, recarregue a página e tente de novo.";

const signatureMatches = (mime, b) =>
  (mime === "image/jpeg" && b[0] === 255 && b[1] === 216 && b[2] === 255) ||
  (mime === "image/png" &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
  (mime === "image/webp" &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP");

const blankToUndefined = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;
const requiredText = (message, max, maxMessage) =>
  z
    .string({ required_error: message, invalid_type_error: message })
    .trim()
    .min(1, message)
    .max(max, maxMessage);
const coordinateField = (min, max) =>
  z.preprocess(
    (v) =>
      blankToUndefined(v) === undefined
        ? undefined
        : Number(String(v).replace(",", ".")),
    z
      .number({
        required_error: "Marque o local do problema pelo GPS ou no mapa.",
        invalid_type_error: "Localização inválida.",
      })
      .finite("Localização inválida.")
      .min(min, "Localização inválida.")
      .max(max, "Localização inválida."),
  );
export const publicDemandSchema = z.object({
  request_id: z.preprocess(
    blankToUndefined,
    z.string().uuid("Identificador de envio inválido.").optional(),
  ),
  category_id: requiredText(
    "Escolha o tipo de problema.",
    100,
    "Tipo de problema inválido.",
  ),
  subcategory: requiredText(
    "Escolha o detalhe do problema.",
    100,
    "Detalhe inválido.",
  ),
  description: z
    .string({
      required_error: "Descreva o problema.",
      invalid_type_error: "Descreva o problema.",
    })
    .trim()
    .min(10, "Descreva o problema com pelo menos 10 caracteres.")
    .max(2000, "A descrição pode ter até 2.000 caracteres."),
  address: requiredText(
    "Informe o endereço (rua e número aproximado).",
    300,
    "O endereço pode ter até 300 caracteres.",
  ),
  neighborhood: requiredText(
    "Informe o bairro.",
    120,
    "O bairro pode ter até 120 caracteres.",
  ),
  reference: z.preprocess(
    (v) => blankToUndefined(v) ?? "",
    z
      .string()
      .trim()
      .max(500, "O ponto de referência pode ter até 500 caracteres."),
  ),
  lat: coordinateField(-90, 90),
  lng: coordinateField(-180, 180),
  location_source: z.preprocess(
    (v) => blankToUndefined(v) ?? "mapa",
    z.enum(["gps", "mapa"]),
  ),
  name: z.preprocess(
    (v) => blankToUndefined(v) ?? "",
    z.string().trim().max(200, "O nome pode ter até 200 caracteres."),
  ),
  phone: z.preprocess(
    (v) => blankToUndefined(v) ?? "",
    z
      .string()
      .trim()
      .max(40, "O telefone pode ter até 40 caracteres.")
      .regex(/^[0-9()+\-.\s]*$/, "Use apenas números no telefone."),
  ),
});

export function registerPublicPortal(app, db, deps) {
  const {
    route,
    enqueue,
    failCode,
    requestIdReused,
    code,
    audit,
    storage,
    scanner,
    logger,
    portalClock = () => Date.now(),
    env = process.env,
  } = deps;
  const counter = windowCounter(db, { clock: portalClock });
  // Own concurrency guard: public uploads never take the slots of the field teams' uploads.
  const uploadGuard = createUploadGuard(2);
  const systemReq = (req) => ({ id: req.id, user: { id: PORTAL_ACTOR.id } });
  const tooMany = (res, counted, error, code) => {
    res.set("Retry-After", String(counter.retryAfter(counted)));
    return res.status(429).json({ error, code });
  };

  // Gate: with the portal disabled every /api/publico path answers exactly like an unknown route.
  app.use("/api/publico", async (req, res, next) => {
    try {
      const settings = portalForcedOff(env)
        ? null
        : await readPortalSettings(db);
      if (!settings?.enabled) return res.status(404).json(NOT_FOUND_BODY);
      req.portal = settings;
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use("/api/publico", express.json({ limit: "8kb" }));

  app.get(
    "/api/publico/catalogo",
    route(async (req) => {
      const general = JSON.parse(
        (await db.get("SELECT value FROM settings WHERE id='general'"))
          ?.value || "{}",
      );
      const categories = (
        await db.all("SELECT * FROM catalogs WHERE kind='categorias'")
      )
        .map(unpack)
        .map((c) => ({
          id: c.id,
          name: c.name,
          subcategories: Array.isArray(c.subcategories) ? c.subcategories : [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      return {
        municipality:
          typeof general.municipality === "string" ? general.municipality : "",
        consent_text: req.portal.consent_text,
        categories,
        form_token: issueFormToken(await portalSecret(db), portalClock()),
        photo_max_bytes: PORTAL_PHOTO_MAX_BYTES,
      };
    }),
  );

  // Per-address limit (every attempt counts) and the portal-wide cap, checked before the body is read.
  const createLimits = async (req, res, next) => {
    try {
      const settings = req.portal;
      const verdict = await enqueue(async () => {
        const ip = await counter.hit(clientBucket("create", req.ip), HOUR_MS);
        if (ip.hits > settings.create_per_ip_hour)
          return [
            ip,
            "Muitas tentativas de envio a partir desta conexão. Tente novamente mais tarde.",
            "RATE_LIMITED",
          ];
        const global = await counter.peek(GLOBAL_BUCKET);
        if (global.hits >= settings.global_per_hour)
          return [
            global,
            "O portal recebeu muitas demandas nesta hora. Tente novamente mais tarde.",
            "PORTAL_BUSY",
          ];
        return null;
      });
      if (verdict) return tooMany(res, ...verdict);
      next();
    } catch (error) {
      next(error);
    }
  };
  const multipart = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: PORTAL_PHOTO_MAX_BYTES,
      files: 1,
      fields: 20,
      fieldSize: 8 * 1024,
      parts: 21,
      headerPairs: 50,
    },
    fileFilter: (req, file, cb) => {
      if (PHOTO_TYPES.includes(file.mimetype)) return cb(null, true);
      req.portalFileRejected = true;
      cb(null, false);
    },
  }).single("photo");
  const parseMultipart = (req, res, next) =>
    multipart(req, res, (error) => {
      if (!error) return next();
      if (
        error instanceof multer.MulterError &&
        error.code === "LIMIT_FILE_SIZE"
      )
        return res.status(413).json({
          error: "A foto deve ter no máximo 8 MB.",
          code: "FILE_TOO_LARGE",
        });
      if (error instanceof multer.MulterError)
        return res.status(400).json({
          error: "O envio tem campos demais ou grandes demais.",
          code: "INVALID_SUBMISSION",
        });
      next(error);
    });

  app.post(
    "/api/publico/demandas",
    createLimits,
    uploadGuard,
    parseMultipart,
    route(async (req, res) => {
      const settings = req.portal;
      const body = req.body ?? {};
      // Anti-robot traps: honeypot field and minimum filling time from the signed form token.
      const verdict =
        String(body.website ?? "").trim() !== ""
          ? "honeypot"
          : checkFormToken(
              await portalSecret(db),
              body.form_token,
              portalClock(),
              settings.min_fill_seconds * 1000,
            );
      if (verdict !== "ok") {
        logger.info(
          "Portal do cidadão: envio recusado pela proteção contra robôs.",
          { requestId: req.id, reason: verdict },
        );
        failCode(400, REJECTED_MESSAGE, "SUBMISSION_REJECTED");
      }
      if (String(body.consent ?? "") !== "true")
        failCode(
          400,
          "Para enviar, marque que você leu e concorda com o uso dos dados.",
          "CONSENT_REQUIRED",
          {
            fieldErrors: {
              consent: ["Marque que você leu e concorda com o uso dos dados."],
            },
          },
        );
      const data = publicDemandSchema.parse(body);

      // Idempotent resend: the same request_id returns the same protocol. The code is shown only once
      // and only its hash is stored, so a resend issues a new code and the previous one stops working
      // (the first answer never reached the citizen when the form resends).
      if (data.request_id) {
        const previous = await db.get(
          "SELECT t.occurrence_id,t.created_at,o.code FROM portal_tracking t JOIN occurrences o ON o.id=t.occurrence_id WHERE t.request_hash=?",
          [requestKeyHash(data.request_id)],
        );
        if (previous) {
          if (
            portalClock() - Date.parse(previous.created_at) >
            REPLAY_WINDOW_MS
          )
            requestIdReused();
          const tracking = newTrackingCode();
          await db.transaction(async () => {
            await db.run(
              "UPDATE portal_tracking SET tracking_hash=? WHERE occurrence_id=?",
              [trackingHash(tracking), previous.occurrence_id],
            );
            await audit(
              systemReq(req),
              "occurrence",
              previous.occurrence_id,
              "Código de acompanhamento reemitido (reenvio pelo portal)",
              null,
              null,
            );
          });
          return {
            protocol: previous.code,
            tracking_code: tracking,
            replayed: true,
          };
        }
      }

      const category = unpack(
        await db.get(
          "SELECT * FROM catalogs WHERE id=? AND kind='categorias'",
          [data.category_id],
        ),
      );
      if (
        !category ||
        !Array.isArray(category.subcategories) ||
        !category.subcategories.includes(data.subcategory)
      )
        failCode(
          400,
          "Escolha um tipo de problema da lista.",
          "INVALID_CATEGORY",
          {
            fieldErrors: {
              category_id: ["Escolha um tipo de problema da lista."],
            },
          },
        );
      if (
        !(await db.get(
          "SELECT id FROM catalogs WHERE id=? AND kind='setores'",
          [category.sector_id],
        ))
      )
        failCode(
          400,
          "Este tipo de problema não está disponível no momento.",
          "INVALID_CATEGORY",
          {
            fieldErrors: {
              category_id: [
                "Este tipo de problema não está disponível no momento.",
              ],
            },
          },
        );

      if (req.portalFileRejected)
        failCode(400, "A foto deve ser JPG, PNG ou WebP.", "INVALID_FILE", {
          fieldErrors: { photo: ["A foto deve ser JPG, PNG ou WebP."] },
        });
      const file = req.file || null;
      if (
        file &&
        (!file.buffer?.length || !signatureMatches(file.mimetype, file.buffer))
      )
        failCode(400, "O arquivo não é uma imagem válida.", "INVALID_FILE", {
          fieldErrors: { photo: ["O arquivo não é uma imagem válida."] },
        });
      if (file) {
        const scan = await scanUpload({
          scanner,
          logger,
          req,
          bytes: file.buffer,
          originalName: file.originalname,
        });
        if (scan.infected) {
          res.status(422);
          return { error: MALWARE_MESSAGE, code: "MALWARE_DETECTED" };
        }
      }

      // The cap may have been reached while this request waited in the queue.
      const global = await counter.peek(GLOBAL_BUCKET);
      if (global.hits >= settings.global_per_hour) {
        res.set("Retry-After", String(counter.retryAfter(global)));
        res.status(429);
        return {
          error:
            "O portal recebeu muitas demandas nesta hora. Tente novamente mais tarde.",
          code: "PORTAL_BUSY",
        };
      }

      // Duplicates are never exposed to the citizen: the demand is registered and triage decides.
      // Nearby active occurrences are kept on the record (internal) as a suspicion for triage.
      const general = JSON.parse(
        (await db.get("SELECT value FROM settings WHERE id='general'")).value,
      );
      const nearby = (
        await nearbyOccurrenceRows(db, data, general.duplicate_radius)
      )
        .map(unpack)
        .filter(
          (o) =>
            !["CANCELADA", "RECUSADA"].includes(o.status) &&
            distance(data, o) <= general.duplicate_radius,
        );
      const possibleDuplicates = nearby
        .filter((o) => o.status !== "CONCLUIDA")
        .map((o) => o.code);

      const key = file ? `uploads/${randomUUID()}` : null;
      if (file) await storage.save(key, file.buffer);
      try {
        return await db.transaction(async () => {
          await ensurePortalActor(db);
          const id = randomUUID(),
            stamp = now(),
            protocol = await code("occurrences", "OC"),
            tracking = newTrackingCode();
          const record = {
            requested_by: data.name,
            phone: data.phone,
            category_id: category.id,
            subcategory: data.subcategory,
            sector_id: category.sector_id,
            description: data.description,
            origin: PORTAL_ORIGIN,
            address: data.address,
            neighborhood: data.neighborhood,
            reference: data.reference,
            priority: "Média",
            lat: data.lat,
            lng: data.lng,
            creator_id: PORTAL_ACTOR.id,
            recurrence: nearby.some((o) => o.status === "CONCLUIDA"),
            public_portal: {
              consent_at: stamp,
              consent_version: consentVersion(settings.consent_text),
              location_source: data.location_source,
              possible_duplicates: possibleDuplicates,
            },
          };
          await db.run(
            "INSERT INTO occurrences(id,code,category_id,sector_id,status,priority,lat,lng,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            [
              id,
              protocol,
              record.category_id,
              record.sector_id,
              "IDENTIFICADA",
              record.priority,
              record.lat,
              record.lng,
              stamp,
              stamp,
              JSON.stringify(record),
            ],
          );
          await db.run(
            "INSERT INTO portal_tracking(occurrence_id,tracking_hash,request_hash,created_at) VALUES(?,?,?,?)",
            [
              id,
              trackingHash(tracking),
              data.request_id ? requestKeyHash(data.request_id) : null,
              new Date(portalClock()).toISOString(),
            ],
          );
          await audit(
            systemReq(req),
            "occurrence",
            id,
            "Ocorrência registrada pelo portal do cidadão",
            null,
            record,
          );
          if (file) {
            const evidenceId = randomUUID();
            await db.run(
              "INSERT INTO evidence(id,entity_type,entity_id,stage,filename,original_name,mime,user_id,created_at,lat,lng,captured_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
              [
                evidenceId,
                "occurrence",
                id,
                "registro",
                key.slice("uploads/".length),
                "foto-portal." + file.mimetype.split("/")[1],
                file.mimetype,
                PORTAL_ACTOR.id,
                stamp,
                data.lat,
                data.lng,
                null,
              ],
            );
            await audit(
              systemReq(req),
              "occurrence",
              id,
              "Evidência registrada: registro",
              null,
              { evidence_id: evidenceId, lat: data.lat, lng: data.lng },
            );
          }
          await counter.hit(GLOBAL_BUCKET, HOUR_MS);
          res.status(201);
          return { protocol, tracking_code: tracking };
        });
      } catch (error) {
        if (key)
          await storage.delete(key).catch((cleanupError) =>
            logger.error("Falha ao limpar foto do portal após erro.", {
              requestId: req.id,
              key,
              err: cleanupError,
            }),
          );
        throw error;
      }
    }),
  );

  app.post(
    "/api/publico/acompanhar",
    route(async (req, res) => {
      const ip = await counter.hit(
        clientBucket("track", req.ip),
        QUARTER_HOUR_MS,
      );
      if (ip.hits > req.portal.track_per_ip_15min) {
        res.set("Retry-After", String(counter.retryAfter(ip)));
        res.status(429);
        return {
          error:
            "Muitas consultas a partir desta conexão. Tente novamente em alguns minutos.",
          code: "RATE_LIMITED",
        };
      }
      const parsed = z
        .object({ protocol: z.string().max(40), code: z.string().max(60) })
        .safeParse(req.body ?? {});
      const protocol = parsed.success
        ? parsed.data.protocol.trim().toUpperCase()
        : "";
      const given = trackingHash(parsed.success ? parsed.data.code : "");
      // One query and one constant-time comparison whether or not the protocol exists.
      const row = await db.get(
        "SELECT o.*, t.tracking_hash AS portal_tracking_hash FROM occurrences o JOIN portal_tracking t ON t.occurrence_id=o.id WHERE o.code=?",
        [protocol],
      );
      const matches = sameDigest(
        given,
        row?.portal_tracking_hash ?? DUMMY_HASH,
      );
      if (!row || !matches) {
        res.status(404);
        return TRACKING_FAILED;
      }
      const occurrence = unpack(row);
      const history = await db.all(
        "SELECT event,after_value,created_at FROM audit_logs WHERE entity_type='occurrence' AND entity_id=?",
        [occurrence.id],
      );
      const category = unpack(
        await db.get("SELECT * FROM catalogs WHERE id=?", [
          occurrence.category_id,
        ]),
      );
      return publicTracking(occurrence, history, category?.name);
    }),
  );

  // Anything else under the prefix stops here: never reaches the session middleware or another route.
  app.use("/api/publico", (req, res) => res.status(404).json(NOT_FOUND_BODY));
}

// Administração > Configurações > Portal do cidadão (module admin, action admin).
export function registerPortalSettings(
  app,
  db,
  { route, allow, audit, env = process.env },
) {
  const view = (settings) => ({
    ...settings,
    forced_off: portalForcedOff(env),
    defaults: PORTAL_DEFAULTS,
  });
  app.get(
    "/api/settings/portal",
    allow("admin"),
    route(async () => view(await readPortalSettings(db))),
  );
  app.patch(
    "/api/settings/portal",
    allow("admin"),
    route(async (req) => {
      const data = portalSettingsSchema.parse(req.body);
      const old = await readPortalSettings(db);
      await db.run(
        "INSERT INTO settings(id,value) VALUES('portal',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        [JSON.stringify(data)],
      );
      await audit(
        req,
        "settings",
        "portal",
        "Configurações do portal do cidadão atualizadas",
        old,
        data,
      );
      return view(data);
    }, true),
  );
}

// Public pages. Production serves dist/portal.html (a separate Vite entry, without the authenticated
// bundle) for /portal, /portal/* and /portal.html, before the static files and the SPA fallback.
// With the portal disabled the same page is sent with status 404 (it then shows "indisponível").
export const isPortalPage = (path) =>
  path === "/portal" || path === "/portal.html" || path.startsWith("/portal/");
export function registerPortalPages(app, db, { file, env = process.env }) {
  let html = null;
  app.get(
    ["/portal", "/portal.html", "/portal/{*path}"],
    async (req, res, next) => {
      try {
        html ??= await readFile(file, "utf8");
        res.status((await portalEnabled(db, env)) ? 200 : 404);
        res.set("Cache-Control", "no-cache");
        res.type("html").send(html);
      } catch (error) {
        next(error);
      }
    },
  );
}
