// Persistent login throttling (migration 11). Same policy as the former in-memory Map: 10 failed
// attempts per client address within a 15-minute window that starts at the first failure; a success
// clears the counter. Stored in the database so restarts and multiple instances share the count.
export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function loginLimiter(
  db,
  {
    maxAttempts = LOGIN_MAX_ATTEMPTS,
    windowMs = LOGIN_WINDOW_MS,
    clock = () => Date.now(),
  } = {},
) {
  const iso = (ms) => new Date(ms).toISOString();
  return {
    async blocked(key) {
      const current = iso(clock());
      // Expired windows are removed on every attempt, so the table only holds active counters.
      await db.run("DELETE FROM login_attempts WHERE expires_at<=?", [current]);
      const row = await db.get(
        "SELECT attempts FROM login_attempts WHERE client_key=? AND expires_at>?",
        [key, current],
      );
      return Number(row?.attempts ?? 0) >= maxAttempts;
    },
    // Atomic upsert: increments inside the active window or opens a new one (works on SQLite and PostgreSQL).
    async failure(key) {
      const current = clock();
      await db.run(
        "INSERT INTO login_attempts(client_key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(client_key) DO UPDATE SET " +
          "attempts=CASE WHEN login_attempts.expires_at>? THEN login_attempts.attempts+1 ELSE 1 END, " +
          "expires_at=CASE WHEN login_attempts.expires_at>? THEN login_attempts.expires_at ELSE excluded.expires_at END",
        [key, iso(current + windowMs), iso(current), iso(current)],
      );
    },
    clear: (key) =>
      db.run("DELETE FROM login_attempts WHERE client_key=?", [key]),
  };
}
