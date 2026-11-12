// Version 13: portal do cidadão. Additive only.
// - portal_tracking: one row per occurrence registered through the public portal, with the SHA-256 of
//   the citizen's tracking code (the code itself is never stored) and of the client's request_id
//   (idempotent resend). No personal data.
// - portal_rate_limits: fixed-window counters (per hashed client address and the portal-wide cap),
//   always with expiry.
// - settings rows: 'portal' (disabled by default) and 'portal_secret' (key of the anti-robot form token).
// No existing table or row changes. The system actor (users row) is created on the first public
// registration, not here, so the first-boot seed (which checks for an empty users table) is unaffected.
import { randomBytes } from "node:crypto";

export async function up(db) {
  await db.exec(`
CREATE TABLE IF NOT EXISTS portal_tracking (occurrence_id TEXT PRIMARY KEY REFERENCES occurrences(id), tracking_hash TEXT NOT NULL, request_hash TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS portal_rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL CHECK(hits > 0), expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS portal_rate_limits_expires_idx ON portal_rate_limits(expires_at);
`);
  await db.run(
    "INSERT INTO settings(id,value) VALUES('portal',?) ON CONFLICT(id) DO NOTHING",
    [JSON.stringify({ enabled: false })],
  );
  await db.run(
    "INSERT INTO settings(id,value) VALUES('portal_secret',?) ON CONFLICT(id) DO NOTHING",
    [randomBytes(32).toString("hex")],
  );
}
