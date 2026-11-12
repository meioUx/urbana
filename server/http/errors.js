import multer from "multer";
import { z } from "zod";
import { requestRoute } from "../logger.js";

export const fail = (status, message, details) => {
  throw Object.assign(new Error(message), { status, details });
};
// Same as fail, adding a stable machine-readable code for clients (field app sync).
export const failCode = (status, message, code, details) => {
  throw Object.assign(new Error(message), { status, code, details });
};
export const requestIdReused = () =>
  failCode(409, "Identificador de envio já utilizado.", "REQUEST_ID_REUSED");

// Unknown /api paths answer JSON instead of falling through to the SPA. The marker lets
// moduleAccess (http/auth.js) stop at this layer: routes registered after it never see /api paths.
export const API_NOT_FOUND = Symbol("apiNotFound");
export const apiNotFound = () =>
  Object.assign(
    (req, res) => res.status(404).json({ error: "Rota não encontrada." }),
    { [API_NOT_FOUND]: true },
  );

export const errorHandler = (logger) => (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status =
    err instanceof z.ZodError
      ? 400
      : err instanceof multer.MulterError
        ? 400
        : err.status || 500;
  if (status === 500)
    logger.error("Erro não tratado na requisição", {
      requestId: req.id,
      method: req.method,
      route: requestRoute(req),
      userId: req.user?.id,
      err,
    });
  res.status(status).json({
    error:
      err instanceof z.ZodError
        ? "Revise os campos informados."
        : status === 500
          ? "Não foi possível completar a operação."
          : err.message,
    code: err.code,
    details: err instanceof z.ZodError ? err.flatten() : err.details,
  });
};
