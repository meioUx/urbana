import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { listRecords } from "../server/modules/listing/index.js";
import { updateVersioned } from "../server/modules/concurrency/index.js";
// Opt-in only: a dedicated test database with PostGIS preinstalled. Never uses DATABASE_URL implicitly.
const url = process.env.URBANA_POSTGRES_TEST_URL;
test(
  "PostgreSQL/PostGIS migrations, geometry, SQL pagination, two-connection CAS and rollback",
  {
    skip:
      !url &&
      "URBANA_POSTGRES_TEST_URL ausente: homologação real não executada",
  },
  async () => {
    const schema = "urbana_test_" + randomUUID().replaceAll("-", "");
    const pool = new pg.Pool({ connectionString: url });
    const folder = mkdtempSync(join(tmpdir(), "urbana-postgres-"));
    let db,
      other,
      created = false;
    const original = process.env.DATABASE_URL;
    try {
      assert.ok(
        (
          await pool.query(
            "SELECT extname FROM pg_extension WHERE extname='postgis'",
          )
        ).rows.length,
        "Instale PostGIS previamente no banco isolado de testes.",
      );
      await pool.query('CREATE SCHEMA "' + schema + '"');
      created = true;
      const connection = new URL(url);
      connection.searchParams.set(
        "options",
        (
          (connection.searchParams.get("options") || "") +
          " -c search_path=" +
          schema +
          ",public"
        ).trim(),
      );
      process.env.DATABASE_URL = connection.toString();
      process.env.DATA_DIR = folder;
      process.env.DEMO_DATA = "false";
      process.env.ADMIN_PASSWORD = "Testing@2026";
      db = await openDatabase();
      await seed(db);
      assert.equal(db.dialect, "postgres");
      assert.equal(
        (await db.all("SELECT version FROM schema_migrations")).length,
        7,
      );
      await db.run(
        "INSERT INTO occurrences(id,code,category_id,sector_id,status,priority,lat,lng,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [
          "spatial",
          "OC-test",
          "category-1",
          "sector-1",
          "IDENTIFICADA",
          "Alta",
          -27,
          -48,
          "2026-10-02T12:00:00.000Z",
          "2026-10-02T12:00:00.000Z",
          JSON.stringify({
            address: "Rua de teste",
            description: "ÁRVORE",
            neighborhood: "Centro",
          }),
        ],
      );
      const geom = await db.get(
        "SELECT ST_SRID(geom) AS srid,ST_X(geom) AS lng,ST_Y(geom) AS lat FROM occurrences WHERE id=?",
        ["spatial"],
      );
      assert.deepEqual(geom, { srid: 4326, lng: -48, lat: -27 });
      const page = await listRecords(db, "occurrences", {
        limit: "1",
        q: "árvore",
        bbox: "-49,-28,-47,-26",
      });
      assert.equal(page.items[0].id, "spatial");
      assert.equal(
        (
          await db.get(
            "SELECT COUNT(*) AS n FROM occurrences WHERE ST_DWithin(geom::geography,ST_SetSRID(ST_MakePoint(?,?),4326)::geography,?)",
            [-48, -27, 10],
          )
        ).n,
        "1",
      );
      const indexes = await db.all(
        "SELECT indexname FROM pg_indexes WHERE schemaname=?",
        [schema],
      );
      assert.ok(indexes.some((x) => x.indexname === "idx_occurrences_geom"));
      const row = await db.get("SELECT * FROM occurrences WHERE id=?", [
        "spatial",
      ]);
      other = await openDatabase();
      const results = await Promise.allSettled([
        updateVersioned(db, "occurrences", row, "priority=?", ["Baixa"]),
        updateVersioned(other, "occurrences", row, "priority=?", ["Média"]),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        results.find((r) => r.status === "rejected").reason.code,
        "VERSION_CONFLICT",
      );
      const latest = await db.get("SELECT * FROM occurrences WHERE id=?", [
        "spatial",
      ]);
      assert.equal(latest.version, 2);
      await db.exec("BEGIN");
      await updateVersioned(db, "occurrences", latest, "priority=?", ["Alta"]);
      await db.exec("ROLLBACK");
      assert.equal(
        (
          await db.get("SELECT version FROM occurrences WHERE id=?", [
            "spatial",
          ])
        ).version,
        2,
      );
      await other.close();
      other = null;
      await db.close();
      db = await openDatabase();
      assert.equal(
        (
          await db.get("SELECT version FROM occurrences WHERE id=?", [
            "spatial",
          ])
        ).version,
        2,
      );
    } finally {
      if (other) await other.close();
      if (db) await db.close();
      if (created) await pool.query('DROP SCHEMA "' + schema + '" CASCADE');
      await pool.end();
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
