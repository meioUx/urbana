// Fixed-window counters persisted in the database (table portal_rate_limits, migration 13), in the
// same pattern as server/login-limit.js: the window starts at the first hit and expired rows are
// deleted on every hit, so the table only holds active counters. Restarts and multiple instances
// share the counts. Client addresses are stored only as a truncated SHA-256 and always with expiry.
import { createHash } from "node:crypto";

export const HOUR_MS = 3600 * 1000;
export const QUARTER_HOUR_MS = 15 * 60 * 1000;

export const clientBucket = (kind, ip) =>
  `${kind}:${createHash("sha256")
    .update(`urbana-portal:${ip || "unknown"}`)
    .digest("hex")
    .slice(0, 32)}`;

export function windowCounter(db, { clock = () => Date.now() } = {}) {
  const iso = (ms) => new Date(ms).toISOString();
  const read = async (bucket, current) => {
    const row = await db.get(
      "SELECT hits,expires_at FROM portal_rate_limits WHERE bucket=? AND expires_at>?",
      [bucket, iso(current)],
    );
    return row
      ? { hits: Number(row.hits), expiresAt: Date.parse(row.expires_at) }
      : { hits: 0, expiresAt: current };
  };
  return {
    // Counts one hit (atomic upsert, works on SQLite and PostgreSQL) and returns the counter after it.
    async hit(bucket, windowMs) {
      const current = clock();
      await db.run("DELETE FROM portal_rate_limits WHERE expires_at<=?", [
        iso(current),
      ]);
      await db.run(
        "INSERT INTO portal_rate_limits(bucket,hits,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET " +
          "hits=CASE WHEN portal_rate_limits.expires_at>? THEN portal_rate_limits.hits+1 ELSE 1 END, " +
          "expires_at=CASE WHEN portal_rate_limits.expires_at>? THEN portal_rate_limits.expires_at ELSE excluded.expires_at END",
        [bucket, iso(current + windowMs), iso(current), iso(current)],
      );
      return read(bucket, current);
    },
    peek: (bucket) => read(bucket, clock()),
    // Seconds until the window ends (at least 1), for Retry-After.
    retryAfter: (counter) =>
      Math.max(1, Math.ceil((counter.expiresAt - clock()) / 1000)),
  };
}
