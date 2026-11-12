import { deliverNotifications } from "./field.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "./db.js";
import { seed } from "./seed.js";
import { createApp } from "./app.js";
import { logger } from "./logger.js";
import { createScannerFromEnv } from "./modules/files/clamav.js";
import { createFileStorage } from "./modules/files/storage.js";
import { DEFAULT_GRACE_MS, sweepOrphans } from "./modules/files/orphans.js";
import express from "express";
import { isPortalPage, registerPortalPages } from "./routes/portal.js";
import {
  allowsInsecureDemo,
  contentSecurityPolicy,
  demoAccountProblems,
  demoEnvironmentProblems,
  isPublicProduction,
  productionSafetyError,
} from "./security.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const production = process.argv.includes("--production");
// Public production (non-loopback HOST or SECURE_COOKIE=true) refuses demonstration credentials.
const guardDemo = isPublicProduction() && !allowsInsecureDemo();
const fatal = (error) => {
  logger.error(error.message);
  process.exit(1);
};
if (isPublicProduction() && allowsInsecureDemo())
  logger.warn(
    "URBANA_ALLOW_INSECURE_DEMO=true; contas demonstrativas expostas fora deste computador.",
  );
if (guardDemo && demoEnvironmentProblems().length)
  fatal(productionSafetyError(demoEnvironmentProblems()));
let scanner;
try {
  scanner = createScannerFromEnv();
} catch (error) {
  fatal(error);
}
if (scanner)
  logger.info("Verificação antimalware (ClamAV) ativa para uploads.", {
    host: scanner.host,
    port: scanner.port,
    failMode: scanner.failMode,
  });
const db = await openDatabase();
await seed(db);
if (guardDemo) {
  const problems = await demoAccountProblems(db);
  if (problems.length) {
    await db.close();
    fatal(productionSafetyError(problems));
  }
}
const app = createApp(
  db,
  production
    ? { logger, scanner }
    : {
        logger,
        scanner,
        contentSecurityPolicy: contentSecurityPolicy({ dev: true }),
      },
);
if (production) {
  // Portal do cidadão: its own small page (dist/portal.html), before the static files and the SPA fallback.
  registerPortalPages(app, db, { file: resolve("dist/portal.html") });
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react");
  const vite = await createServer({
    configFile: false,
    plugins: [react()],
    server: { middlewareMode: true },
    appType: "spa",
  });
  // Portal do cidadão in development: /portal and /portal/* are served from portal.html by Vite.
  app.use((req, res, next) => {
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      isPortalPage(req.path)
    )
      req.url = "/portal.html";
    next();
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  logger.info(`Urbana disponível em http://${host}:${port}`, { host, port }),
);
let sendingPush = false;
const pushTimer = setInterval(async () => {
  if (sendingPush) return;
  sendingPush = true;
  try {
    await deliverNotifications(db, app.locals.enqueue);
  } catch (e) {
    logger.error("Falha na entrega de notificações push.", { err: e });
  } finally {
    sendingPush = false;
  }
}, 15000);
pushTimer.unref();
// Orphan upload sweep: opt-in (UPLOAD_SWEEP_INTERVAL_HOURS > 0). Removes only files with no database
// reference older than UPLOAD_SWEEP_GRACE_HOURS (default 24). Local file storage only.
// Interval is capped at 168 h (a timer above ~596 h would overflow Node's 32-bit delay).
const sweepHours = Math.min(
  168,
  Number(process.env.UPLOAD_SWEEP_INTERVAL_HOURS) || 0,
);
const sweepGraceHours = Math.max(
  1,
  Number(process.env.UPLOAD_SWEEP_GRACE_HOURS) || DEFAULT_GRACE_MS / 3600000,
);
let sweepTimer;
if (sweepHours > 0) {
  const storage = createFileStorage();
  let sweeping = false;
  sweepTimer = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      await sweepOrphans({
        db,
        storage,
        graceMs: sweepGraceHours * 3600000,
        logger,
      });
    } catch (e) {
      logger.error("Falha na varredura de uploads órfãos.", { err: e });
    } finally {
      sweeping = false;
    }
  }, sweepHours * 3600000);
  sweepTimer.unref();
  logger.info("Varredura de uploads órfãos agendada.", {
    everyHours: sweepHours,
    graceHours: sweepGraceHours,
  });
}
process.on("SIGTERM", () => {
  clearInterval(pushTimer);
  clearInterval(sweepTimer);
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
});
