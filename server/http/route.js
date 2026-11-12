import {
  canPerformAction,
  hasModuleAccess,
  apiModules,
} from "../../shared/authorization.mjs";
import { userModules } from "../user-permissions.js";
import { fail } from "./errors.js";

// Mutations stay serialized in-process: WIP limits, sequential codes and stock balances are
// checked by read-then-write logic that is only safe while one write runs at a time (there is no
// distributed lock yet). Each write runs in db.transaction(), which on PostgreSQL uses a dedicated
// pooled client. On PostgreSQL, GET/HEAD reads skip the queue and run concurrently on the pool,
// seeing only committed data; on SQLite (one shared connection) everything stays queued as before.
//
// Returns { enqueue, route }, both sharing the same in-process queue:
// - enqueue(fn): runs fn after every queued task (exposed as app.locals.enqueue).
// - route(fn, write = false): Express handler. write=true queues the request (always), runs it in
//   db.transaction(), deletes files listed in req.rollbackFiles if it fails, and enforces the
//   kanban WIP limits. Without write, GET/HEAD on PostgreSQL run outside the queue.
export function createRequestPipeline({ db, storage, logger, kanban }) {
  let queue = Promise.resolve();
  const enqueue = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };
  const route =
    (fn, write = false) =>
    async (req, res, next) => {
      const concurrentRead =
        !write &&
        db.dialect === "postgres" &&
        ["GET", "HEAD"].includes(req.method);
      const run = async () => {
        if (write) req.rollbackFiles = [];
        try {
          const result = await (write ? db.transaction(handle) : handle());
          if (!res.headersSent) res.json(result ?? { ok: true });
        } catch (e) {
          // db.transaction has already rolled back; now discard files stored by the failed write.
          if (write) {
            for (const key of req.rollbackFiles) {
              try {
                await storage.delete(key);
              } catch (cleanupError) {
                logger.error("Falha ao limpar arquivo após rollback.", {
                  requestId: req.id,
                  key,
                  err: cleanupError,
                });
              }
            }
          }
          throw e;
        }
      };
      const handle = async () => {
        // Recheck inside the request queue so revocations take effect before writes.
        if (req.user) {
          const currentUser = await db.get(
            "SELECT id,name,email,role,team_id FROM users WHERE id=?",
            [req.user.id],
          );
          req.user = {
            ...currentUser,
            modules: await userModules(db, currentUser),
          };
          if (
            req.requiredAction &&
            !canPerformAction(req.user, req.requiredAction)
          )
            fail(403, "Seu perfil não permite esta ação.");
          const required = apiModules(req.path, req.method);
          if (required && !required.some((m) => hasModuleAccess(req.user, m)))
            fail(403, "Módulo não autorizado.");
          if (
            req.user.role === "Consulta" &&
            !["GET", "HEAD"].includes(req.method) &&
            !req.path.startsWith("/api/auth/") &&
            req.path !== "/api/onboarding"
          )
            fail(403, "Perfil somente leitura.");
        }
        const wip = write ? await kanban.snapshot() : null;
        if (write && req.body?.kanban_expected_status) {
          const match = req.path.match(
            /^\/api\/(ocorrencias|ordens-servico)\/([^/]+)\//,
          );
          const ids = match ? [match[2]] : req.body.occurrence_ids;
          if (ids)
            for (const id of ids) {
              const table =
                match?.[1] === "ordens-servico" ? "orders" : "occurrences";
              const current = await db.get(
                `SELECT status FROM ${table} WHERE id=?`,
                [id],
              );
              if (
                !current ||
                current.status !== req.body.kanban_expected_status
              )
                fail(
                  409,
                  "O cartão mudou de etapa. Atualize o quadro antes de movimentar.",
                );
            }
        }
        const result = await fn(req, res);
        if (write) await kanban.enforce(wip);
        return result;
      };
      let task;
      if (concurrentRead) task = run();
      else {
        task = queue.then(run);
        queue = task.catch(() => {});
      }
      try {
        await task;
      } catch (e) {
        next(e);
      }
    };
  return { enqueue, route };
}
