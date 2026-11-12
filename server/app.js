import { registerOnboarding } from "./onboarding.js";
import { createUploadGuard } from "./modules/files/upload-limit.js";
import { createFileStorage } from "./modules/files/storage.js";
import { registerField } from "./field.js";
import { registerSectorControl } from "./sector-control.js";
import { registerPlanning } from "./planning.js";
import { kanbanService } from "./kanban.js";
import { registerInvoices } from "./invoices.js";
import { registerInventory } from "./inventory.js";
import { securityHeaders, sameOriginMutations } from "./security.js";
import { silentLogger, requestLogger } from "./logger.js";
import { now } from "./domain.js";
import express from "express";
import {
  fail,
  failCode,
  requestIdReused,
  apiNotFound,
  errorHandler,
} from "./http/errors.js";
import { createRequestPipeline } from "./http/route.js";
import { moduleAccess, allow } from "./http/auth.js";
import { createRecordHelpers } from "./http/records.js";
import { registerHealth } from "./routes/health.js";
import {
  registerLogin,
  registerSession,
  registerLogout,
} from "./routes/auth.js";
import { registerBootstrap } from "./routes/bootstrap.js";
import { registerOccurrences } from "./routes/occurrences.js";
import { registerOrders } from "./routes/orders.js";
import { registerAttachments } from "./routes/attachments.js";
import { registerCatalogs } from "./routes/catalogs.js";
import { registerAdmin } from "./routes/admin.js";
import { registerDashboard } from "./routes/dashboard.js";
import { registerWorks } from "./routes/works.js";
import {
  registerPublicPortal,
  registerPortalSettings,
} from "./routes/portal.js";

// Composition only: middleware order and route registration order are part of the behavior
// (Express matches in registration order). Route handlers live in server/routes/ and in the
// domain modules (planning, field, kanban...); shared HTTP infrastructure lives in server/http/.
// scanner: optional antimalware scanner for uploads ({ enabled, failMode, scan(bytes) }, see
// modules/files/clamav.js); null (default) leaves uploads exactly as before.
// portalClock: clock of the public portal's rate limits and form token (tests control it).
export function createApp(
  db,
  {
    storage = createFileStorage(),
    maxConcurrentUploads = 4,
    contentSecurityPolicy,
    logger = silentLogger,
    healthTimeoutMs = 2000,
    scanner = null,
    portalClock,
  } = {},
) {
  const app = express();
  const uploadGuard = createUploadGuard(maxConcurrentUploads);
  const kanban = kanbanService(db, fail);
  app.disable("x-powered-by");
  // Behind a reverse proxy (Caddy), TRUST_PROXY makes req.ip the client address for the login limit.
  if (process.env.TRUST_PROXY)
    app.set(
      "trust proxy",
      /^\d+$/.test(process.env.TRUST_PROXY)
        ? Number(process.env.TRUST_PROXY)
        : process.env.TRUST_PROXY,
    );
  // contentSecurityPolicy: undefined = strict production policy; the Vite dev server passes a relaxed one.
  app.use(
    securityHeaders(
      contentSecurityPolicy === undefined ? {} : { csp: contentSecurityPolicy },
    ),
  );
  // Request id + one structured log line per request (no bodies, cookies or tokens).
  app.use(requestLogger(logger));
  // Single in-process queue shared by route() and app.locals.enqueue (see http/route.js).
  const { enqueue, route } = createRequestPipeline({
    db,
    storage,
    logger,
    kanban,
  });
  app.locals.enqueue = enqueue;
  const records = createRecordHelpers(db);
  const { audit, accessOrder } = records;
  const deps = {
    ...records,
    route,
    allow,
    fail,
    failCode,
    requestIdReused,
    storage,
    uploadGuard,
    kanban,
    scanner,
    logger,
  };
  registerHealth(app, db, { logger, healthTimeoutMs });
  app.use(sameOriginMutations());
  // Portal do cidadão (routes/portal.js): public /api/publico routes, after the security headers, the
  // logger and the same-origin check, and before the JSON parser and the session middleware. Disabled
  // by default (404); they never set req.user and never fall through to the authenticated routes.
  registerPublicPortal(app, db, {
    ...records,
    route,
    enqueue,
    fail,
    failCode,
    requestIdReused,
    storage,
    scanner,
    logger,
    ...(portalClock ? { portalClock } : {}),
  });
  app.use(express.json({ limit: "1mb" }));

  // Authentication: public login, then the session middleware for the rest of /api.
  registerLogin(app, db, deps);
  registerSession(app, db, deps);
  app.use("/api", moduleAccess());
  registerOnboarding(app, db, { route, fail });
  kanban.register(app, { route, audit, allow });
  registerLogout(app, db, deps);
  registerBootstrap(app, db, deps);

  // Domain modules that predate server/routes/ (signatures unchanged).
  const planningModule = registerPlanning(app, db, {
    route,
    allow,
    audit,
    fail,
  });
  registerField(app, db, { route, fail });
  registerSectorControl(app, db, { route, allow });
  registerInventory(app, db, { route, allow, audit, fail, now });
  const invoiceModule = registerInvoices(app, db, {
    route,
    allow,
    audit,
    fail,
    accessOrder,
    now,
    storage,
    uploadGuard,
    scanner,
    logger,
  });

  // Occurrences (and map) must precede orders: /api/ocorrencias/proximas before /api/ocorrencias/:id.
  const { classifyOccurrence } = registerOccurrences(app, db, deps);
  registerOrders(app, db, {
    ...deps,
    classifyOccurrence,
    planningModule,
    invoiceModule,
  });
  registerAttachments(app, db, deps);
  registerCatalogs(app, db, deps);
  registerAdmin(app, db, deps);
  registerPortalSettings(app, db, deps);
  registerDashboard(app, db, deps);
  registerWorks(app, db, deps);

  app.use("/api", apiNotFound());
  app.use(errorHandler(logger));
  return app;
}
