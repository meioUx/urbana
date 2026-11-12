import { randomUUID } from "node:crypto";
import { z } from "zod";
import webpush from "web-push";
import { canAccessOrder, unpack, now } from "./domain.js";
import { jsonField } from "./modules/listing/index.js";
export const pushConfigured = () =>
  !!(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
export async function queueOrderNotification(db, order) {
  const users = await db.all(
    "SELECT id, role, team_id FROM users WHERE role='Equipe de Campo'",
  );
  for (const user of users.filter((u) => canAccessOrder(u, order)))
    await db.run(
      "INSERT INTO push_jobs(id,user_id,order_id,created_at,next_attempt_at) VALUES(?,?,?,?,?)",
      [randomUUID(), user.id, order.id, now(), now()],
    );
}
export function registerField(app, db, { route, fail }) {
  app.get(
    "/api/campo",
    route(async (req) => {
      // Field users only reach orders of their own team; the exact access rule (assignment) is
      // still applied by canAccessOrder below, so the SQL filter only narrows the candidates.
      const field = req.user.role === "Equipe de Campo";
      const teamLinks =
        "SELECT r.order_id,r.occurrence_id FROM order_occurrences r JOIN orders t ON t.id=r.order_id WHERE t.team_id=?";
      // Management profiles (Administrador, Gestor...) only receive the open orders (not CONCLUIDA or
      // CANCELADA) and their occurrences; the field profile keeps every reachable order.
      const openLinks =
        "SELECT r.order_id,r.occurrence_id FROM order_occurrences r JOIN orders t ON t.id=r.order_id WHERE t.status NOT IN ('CONCLUIDA','CANCELADA','RECUSADA')";
      const links = field
        ? await db.all(teamLinks, [req.user.team_id])
        : await db.all(openLinks);
      // Only occurrences linked to a reachable order or created by this user are returned.
      // ", id DESC" reproduces the (created_at,id) index order used before.
      const occurrences = (
        await db.all(
          `SELECT * FROM occurrences WHERE id IN (${(field ? teamLinks : openLinks).replace("r.order_id,r.occurrence_id", "r.occurrence_id")}) OR ${jsonField(db, "creator_id")}=? ORDER BY created_at DESC,id DESC`,
          field ? [req.user.team_id, req.user.id] : [req.user.id],
        )
      ).map(unpack);
      const position = new Map(occurrences.map((c, i) => [c.id, i]));
      const occurrenceIdsByOrder = new Map();
      for (const l of links) {
        if (!occurrenceIdsByOrder.has(l.order_id))
          occurrenceIdsByOrder.set(l.order_id, new Set());
        occurrenceIdsByOrder.get(l.order_id).add(l.occurrence_id);
      }
      const orders = (
        await db.all(
          field
            ? "SELECT * FROM orders ORDER BY updated_at DESC"
            : "SELECT * FROM orders WHERE status NOT IN ('CONCLUIDA','CANCELADA','RECUSADA') ORDER BY updated_at DESC",
        )
      )
        .map(unpack)
        .filter((o) => canAccessOrder(req.user, o))
        .map((o) => ({
          ...o,
          // Same order as the occurrence list (created_at DESC), without rescanning it per order.
          occurrences: [...(occurrenceIdsByOrder.get(o.id) || [])]
            .filter((id) => position.has(id))
            .sort((a, b) => position.get(a) - position.get(b))
            .map((id) => occurrences[position.get(id)]),
        }));
      return {
        orders,
        records: occurrences.filter((o) => o.creator_id === req.user.id),
        server_time: now(),
        push: {
          configured: pushConfigured(),
          public_key: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null,
        },
      };
    }),
  );
  app.post(
    "/api/campo/notificacoes",
    route(async (req) => {
      if (!pushConfigured())
        fail(
          503,
          "As notificações ainda não foram configuradas na publicação.",
        );
      const data = z
        .object({
          endpoint: z.string().url().max(3000),
          keys: z.object({
            p256dh: z
              .string()
              .regex(/^[A-Za-z0-9_-]+$/)
              .max(200),
            auth: z
              .string()
              .regex(/^[A-Za-z0-9_-]+$/)
              .max(100),
          }),
        })
        .parse(req.body);
      const endpoint = new URL(data.endpoint);
      const permitted = [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "push.services.mozilla.com",
        "web.push.apple.com",
      ];
      if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password ||
        (endpoint.port && endpoint.port !== "443") ||
        !(
          permitted.includes(endpoint.hostname) ||
          endpoint.hostname.endsWith(".push.apple.com") ||
          endpoint.hostname.endsWith(".notify.windows.com")
        )
      )
        fail(400, "Serviço de notificações não reconhecido.");
      await db.run(
        "INSERT INTO push_subscriptions(id,user_id,endpoint,data) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,data=excluded.data",
        [randomUUID(), req.user.id, data.endpoint, JSON.stringify(data)],
      );
      return { ok: true };
    }, true),
  );
  app.delete(
    "/api/campo/notificacoes",
    route(async (req) => {
      const { endpoint } = z
        .object({ endpoint: z.string().url() })
        .parse(req.body);
      await db.run(
        "DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?",
        [req.user.id, endpoint],
      );
      return { ok: true };
    }, true),
  );
}
// A job being delivered is leased: its next_attempt_at is pushed this far ahead, so other instances
// skip it. If the instance dies mid-delivery the lease expires and the job is retried (at least once).
export const PUSH_CLAIM_LEASE_MS = 5 * 60 * 1000;
const affectedRows = (result) => Number(result.rowCount ?? result.changes ?? 0);
export async function deliverNotifications(
  db,
  enqueue,
  send = webpush.sendNotification.bind(webpush),
  { leaseMs = PUSH_CLAIM_LEASE_MS } = {},
) {
  if (!pushConfigured()) return;
  const jobs = await enqueue(() =>
    db.all(
      "SELECT * FROM push_jobs WHERE status='pending' AND next_attempt_at<=? ORDER BY created_at LIMIT 10",
      [now()],
    ),
  );
  for (const candidate of jobs) {
    // Atomic claim: a single conditional UPDATE that only one instance can win. attempts is the
    // compare-and-swap token (it only grows), so a second instance holding the same snapshot
    // matches zero rows on both SQLite and PostgreSQL (READ COMMITTED re-checks the WHERE).
    const claimed = await enqueue(() =>
      db.run(
        "UPDATE push_jobs SET attempts=attempts+1,next_attempt_at=? WHERE id=? AND status='pending' AND attempts=? AND next_attempt_at<=?",
        [
          new Date(Date.now() + leaseMs).toISOString(),
          candidate.id,
          candidate.attempts,
          now(),
        ],
      ),
    );
    if (affectedRows(claimed) !== 1) continue;
    const job = candidate;
    const context = await enqueue(async () => ({
      user: await db.get("SELECT id,role,team_id FROM users WHERE id=?", [
        job.user_id,
      ]),
      order: unpack(
        await db.get("SELECT * FROM orders WHERE id=?", [job.order_id]),
      ),
      subscriptions: await db.all(
        "SELECT * FROM push_subscriptions WHERE user_id=?",
        [job.user_id],
      ),
    }));
    let failed = false;
    if (
      context.user &&
      context.order &&
      canAccessOrder(context.user, context.order) &&
      !["CONCLUIDA", "CANCELADA", "DEVOLVIDA", "AGUARDANDO_VALIDACAO"].includes(
        context.order.status,
      )
    ) {
      for (const sub of context.subscriptions) {
        try {
          await send(
            JSON.parse(sub.data),
            JSON.stringify({
              title: "Urbana · Tarefa atualizada",
              body: `A ordem ${context.order.code} está disponível. Abra para conferir o serviço.`,
              url: `/campo?ordem=${job.order_id}`,
              tag: job.order_id,
            }),
            {
              TTL: 3600,
              timeout: 5000,
              vapidDetails: {
                subject: process.env.VAPID_SUBJECT,
                publicKey: process.env.VAPID_PUBLIC_KEY,
                privateKey: process.env.VAPID_PRIVATE_KEY,
              },
            },
          );
        } catch (error) {
          if ([404, 410].includes(error.statusCode))
            await enqueue(() =>
              db.run("DELETE FROM push_subscriptions WHERE id=?", [sub.id]),
            );
          else failed = true;
        }
      }
    }
    await enqueue(() =>
      db.run(
        // attempts was already incremented by the claim; the guard keeps a slow instance whose lease
        // expired (job reclaimed elsewhere) from overwriting the newer owner's result.
        "UPDATE push_jobs SET status=?,next_attempt_at=? WHERE id=? AND attempts=?",
        [
          failed ? (job.attempts >= 4 ? "failed" : "pending") : "delivered",
          new Date(Date.now() + 60000 * 2 ** job.attempts).toISOString(),
          job.id,
          job.attempts + 1,
        ],
      ),
    );
  }
}
