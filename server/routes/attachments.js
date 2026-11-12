import { randomUUID } from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { now } from "../domain.js";
import { coordinate, parseCapturedAt } from "../http/schemas.js";
import { malwareResponse, scanUpload } from "../modules/files/upload-scan.js";

// Evidence uploads for occurrences and service orders, and the protected download route.
// Uploaded files go to the injected storage and are listed in req.rollbackFiles so route()
// deletes them if the write transaction fails.
export function registerAttachments(app, db, deps) {
  const {
    route,
    allow,
    fail,
    failCode,
    requestIdReused,
    entity,
    audit,
    accessOrder,
    saveClientRequest,
    storage,
    uploadGuard,
    scanner,
    logger,
  } = deps;
  const upload = multer({
    storage: multer.memoryStorage(),
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
      uploadGuard,
      upload.single("file"),
      route(async (req, res) => {
        try {
          const o =
            type === "order"
              ? await accessOrder(req, req.params.id)
              : await entity(table, req.params.id);
          // A field user who registered a duplicate link may add the "registro" photo of that link.
          const linkedOnly =
            type === "occurrence" &&
            req.user.role === "Equipe de Campo" &&
            o.creator_id !== req.user.id;
          if (
            linkedOnly &&
            !(await db.get(
              "SELECT 1 AS found FROM client_requests WHERE user_id=? AND entity_type='occurrence_link' AND entity_id=?",
              [req.user.id, o.id],
            ))
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
                requestIdReused();

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
            failCode(409, "Registro encerrado para anexos.", "RECORD_CLOSED");
          const capturedAt = parseCapturedAt(req.body.captured_at);
          if (!req.file)
            fail(400, "Envie JPG, PNG, WebP, PDF ou MP4 de até 15 MB.");
          const b = req.file.buffer,
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
          if (linkedOnly && stage !== "registro")
            fail(
              403,
              "Você só pode anexar fotos às ocorrências que registrou.",
            );
          if (
            type === "order" &&
            ["durante", "depois"].includes(stage) &&
            o.status !== "EM_EXECUCAO"
          )
            fail(409, "Esta evidência exige execução iniciada.");
          // Absence first: Number(undefined) is NaN and Number("") is 0, so the schema alone would
          // either hide this message or accept an empty field as the coordinate 0.
          const missing = (v) => v === undefined || String(v).trim() === "";
          if (missing(req.body.lat) || missing(req.body.lng))
            fail(400, "Informe a localização da evidência.");
          const point = z
            .object(coordinate)
            .parse({ lat: Number(req.body.lat), lng: Number(req.body.lng) });
          // Optional antimalware scan: after every cheap check, before anything is persisted.
          const scan = await scanUpload({
            scanner,
            logger,
            req,
            bytes: b,
            originalName: req.file.originalname,
          });
          if (scan.infected) {
            await audit(
              req,
              type,
              o.id,
              "Arquivo recusado pela verificação de segurança",
              null,
              {
                stage,
                original_name: req.file.originalname.slice(0, 200),
                request_id: req.id,
              },
            );
            return malwareResponse(res);
          }
          const id = randomUUID();
          const filename = randomUUID();
          const key = `uploads/${filename}`;
          await storage.save(key, b);
          req.rollbackFiles.push(key);
          await db.run(
            "INSERT INTO evidence(id,entity_type,entity_id,stage,filename,original_name,mime,user_id,created_at,lat,lng,captured_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            [
              id,
              type,
              o.id,
              stage,
              filename,
              req.file.originalname.slice(0, 200),
              mime,
              req.user.id,
              now(),
              point.lat,
              point.lng,
              capturedAt,
            ],
          );
          await audit(req, type, o.id, `Evidência registrada: ${stage}`, null, {
            evidence_id: id,
            lat: point.lat,
            lng: point.lng,
            ...(capturedAt ? { captured_at: capturedAt } : {}),
          });
          if (req.body.request_id)
            await saveClientRequest(
              req.user.id,
              req.body.request_id,
              "evidence",
              id,
            );
          return { id };
        } catch (e) {
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
      res.send(await storage.get(`uploads/${e.filename}`));
    } catch (e) {
      next(e);
    }
  });
}
