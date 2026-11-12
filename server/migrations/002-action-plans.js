export async function up(db) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS action_plans (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS action_plan_occurrences (plan_id TEXT NOT NULL REFERENCES action_plans(id), occurrence_id TEXT PRIMARY KEY REFERENCES occurrences(id)); CREATE INDEX IF NOT EXISTS idx_action_plan_links ON action_plan_occurrences(plan_id);",
  );
}
