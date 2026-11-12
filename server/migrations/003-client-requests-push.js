export async function up(db) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS client_requests (user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY(user_id, request_id)); CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), endpoint TEXT UNIQUE NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS push_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), order_id TEXT NOT NULL REFERENCES orders(id), created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');",
  );
}
