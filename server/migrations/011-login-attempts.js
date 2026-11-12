// Version 11: persistent login throttling (replaces the in-memory counter lost on every restart).
// client_key = client address; expires_at = end of the 15-minute window (ISO text, like other timestamps).
export async function up(db) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS login_attempts (client_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL CHECK(attempts > 0), expires_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS login_attempts_expires_idx ON login_attempts(expires_at);",
  );
}
