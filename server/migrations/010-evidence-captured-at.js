// Version 10: real capture time of field evidence (offline sync). created_at keeps the server receipt time.
export async function up(db) {
  // Idempotent on both dialects, so a re-run after a partial restore does not fail.
  if (db.dialect === "postgres")
    await db.exec(
      "ALTER TABLE evidence ADD COLUMN IF NOT EXISTS captured_at TEXT",
    );
  else if (
    !(await db.get(
      "SELECT name FROM pragma_table_info('evidence') WHERE name='captured_at'",
    ))
  )
    await db.exec("ALTER TABLE evidence ADD COLUMN captured_at TEXT");
}
