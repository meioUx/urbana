import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db.js";
import { updateVersioned } from "../server/modules/concurrency/index.js";

test("version migration is additive, restart safe and CAS rejects database races", async () => {
  const folder = mkdtempSync(join(tmpdir(), "urbana-version-"));
  process.env.DATA_DIR = folder;
  delete process.env.DATABASE_URL;
  let db;
  try {
    db = await openDatabase();
    await db.run(
      "INSERT INTO action_plans(id,code,created_at,data) VALUES(?,?,?,?)",
      [
        "plan",
        "PA-test",
        new Date().toISOString(),
        JSON.stringify({ objective: "Preservar dados" }),
      ],
    );
    await db.close();
    db = null;
    // Reconstruct a pre-version installation with existing data before exercising the upgrade.
    const legacy = new DatabaseSync(join(folder, "urban.sqlite"));
    for (const table of ["occurrences", "orders", "action_plans"])
      legacy.exec("ALTER TABLE " + table + " DROP COLUMN version");
    legacy.exec("DELETE FROM schema_migrations WHERE version>=5");
    legacy.close();
    db = await openDatabase();
    const old = await db.get("SELECT * FROM action_plans WHERE id=?", ["plan"]);
    assert.equal(old.version, 1);
    assert.equal(JSON.parse(old.data).objective, "Preservar dados");
    await db.exec("BEGIN");
    await updateVersioned(db, "action_plans", old, "data=?", [
      JSON.stringify({ objective: "Primeira altera??o" }),
    ]);
    await db.exec("COMMIT");
    await assert.rejects(
      updateVersioned(db, "action_plans", old, "data=?", ["{}"]),
      (e) => e.status === 409 && e.details.current_version === 2,
    );
    assert.equal(
      (await db.get("SELECT version FROM action_plans WHERE id='plan'"))
        .version,
      2,
    );
    await db.exec("BEGIN");
    await updateVersioned(
      db,
      "action_plans",
      { id: "plan", version: 2 },
      "data=?",
      ["{}"],
    );
    await db.exec("ROLLBACK");
    assert.equal(
      (await db.get("SELECT version FROM action_plans WHERE id='plan'"))
        .version,
      2,
    );
  } finally {
    if (db) await db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
