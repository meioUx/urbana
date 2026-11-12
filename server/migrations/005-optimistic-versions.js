export async function up(db) {
  for (const table of ["occurrences", "orders", "action_plans"])
    await db.exec(
      `ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)`,
    );
}
