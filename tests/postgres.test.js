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
import { loginLimiter } from "../server/login-limit.js";
import { deliverNotifications } from "../server/field.js";
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
        13,
      );
      // Migration 11: persistent login limit (upsert window and cleanup) on PostgreSQL.
      let clock = Date.parse("2026-11-11T12:00:00.000Z");
      const limiter = loginLimiter(db, { clock: () => clock });
      for (let i = 0; i < 10; i++) await limiter.failure("10.0.0.1");
      assert.equal(await limiter.blocked("10.0.0.1"), true);
      assert.equal(
        Number(
          (
            await db.get(
              "SELECT attempts FROM login_attempts WHERE client_key=?",
              ["10.0.0.1"],
            )
          ).attempts,
        ),
        10,
      );
      clock += 15 * 60 * 1000;
      assert.equal(await limiter.blocked("10.0.0.1"), false);
      assert.equal((await db.all("SELECT * FROM login_attempts")).length, 0);
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
      await assert.rejects(
        db.transaction(async () => {
          await updateVersioned(db, "occurrences", latest, "priority=?", [
            "Alta",
          ]);
          throw new Error("rollback");
        }),
        /rollback/,
      );
      assert.equal(
        (
          await db.get("SELECT version FROM occurrences WHERE id=?", [
            "spatial",
          ])
        ).version,
        2,
      );
      // Push jobs: two instances (separate pools) claim jobs atomically; each job is sent exactly once.
      {
        const team = (
          await db.get("SELECT id FROM catalogs WHERE kind='equipes' LIMIT 1")
        ).id;
        const sector = (
          await db.get("SELECT id FROM catalogs WHERE kind='setores' LIMIT 1")
        ).id;
        const userId = randomUUID();
        await db.run(
          "INSERT INTO users(id,name,email,password,role,team_id) VALUES(?,?,?,?,?,?)",
          [userId, "Campo", "pg-push@test.local", "x", "Equipe de Campo", team],
        );
        const endpoint = "https://fcm.googleapis.com/fcm/send/pg";
        await db.run(
          "INSERT INTO push_subscriptions(id,user_id,endpoint,data) VALUES(?,?,?,?)",
          [
            randomUUID(),
            userId,
            endpoint,
            JSON.stringify({ endpoint, keys: { p256dh: "a", auth: "a" } }),
          ],
        );
        const orders = [];
        for (let i = 0; i < 6; i++) {
          const orderId = randomUUID();
          orders.push(orderId);
          await db.run(
            "INSERT INTO orders(id,code,sector_id,team_id,status,priority,due_at,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
            [
              orderId,
              "PG-" + orderId.slice(0, 8),
              sector,
              team,
              "PROGRAMADA",
              "Alta",
              "2030-01-01",
              "2026-01-01",
              "2026-01-01",
              "{}",
            ],
          );
          await db.run(
            "INSERT INTO push_jobs(id,user_id,order_id,created_at,next_attempt_at) VALUES(?,?,?,?,?)",
            [
              randomUUID(),
              userId,
              orderId,
              "2026-01-01T00:00:00Z",
              "2000-01-01T00:00:00Z",
            ],
          );
        }
        const queueOf = () => {
          let queue = Promise.resolve();
          return (fn) => {
            const task = queue.then(fn);
            queue = task.catch(() => {});
            return task;
          };
        };
        const sent = new Map();
        const send = async (sub, payload) => {
          await new Promise((r) => setTimeout(r, 20));
          const tag = JSON.parse(payload).tag;
          sent.set(tag, (sent.get(tag) || 0) + 1);
        };
        process.env.VAPID_PUBLIC_KEY = "test-public";
        process.env.VAPID_PRIVATE_KEY = "test-private";
        process.env.VAPID_SUBJECT = "mailto:example@example.test";
        try {
          await Promise.all([
            deliverNotifications(db, queueOf(), send),
            deliverNotifications(other, queueOf(), send),
          ]);
        } finally {
          delete process.env.VAPID_PUBLIC_KEY;
          delete process.env.VAPID_PRIVATE_KEY;
          delete process.env.VAPID_SUBJECT;
        }
        for (const orderId of orders)
          assert.equal(
            sent.get(orderId),
            1,
            "job sent exactly once across instances",
          );
        const states = await db.all(
          "SELECT status,attempts FROM push_jobs WHERE user_id=?",
          [userId],
        );
        assert.ok(
          states.every(
            (j) => j.status === "delivered" && Number(j.attempts) === 1,
          ),
        );
      }
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

test(
  "PostgreSQL pool: concurrent reads, dedicated transaction client, isolated rollback and idle-connection loss",
  {
    skip:
      !url &&
      "URBANA_POSTGRES_TEST_URL ausente: homologação real não executada",
  },
  async () => {
    const schema = "urbana_test_" + randomUUID().replaceAll("-", "");
    const admin = new pg.Pool({ connectionString: url });
    const folder = mkdtempSync(join(tmpdir(), "urbana-postgres-"));
    const original = process.env.DATABASE_URL;
    let db,
      created = false;
    try {
      await admin.query('CREATE SCHEMA "' + schema + '"');
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
      db = await openDatabase();
      // Migrations are recorded once; reopening applies nothing again.
      const applied = await db.all(
        "SELECT version,applied_at FROM schema_migrations ORDER BY version",
      );
      assert.deepEqual(
        applied.map((r) => r.version),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      );
      await db.close();
      db = await openDatabase();
      assert.deepEqual(
        await db.all(
          "SELECT version,applied_at FROM schema_migrations ORDER BY version",
        ),
        applied,
      );

      // Reads outside a transaction run in parallel on different pooled connections.
      const started = Date.now();
      const reads = await Promise.all(
        [1, 2, 3].map(() =>
          db.get(
            "SELECT pg_backend_pid() AS pid, pg_sleep(0.5)::text AS slept",
          ),
        ),
      );
      assert.equal(new Set(reads.map((r) => r.pid)).size, 3);
      assert.ok(
        Date.now() - started < 1400,
        "leituras deveriam rodar em paralelo",
      );

      // A bare BEGIN would split the transaction across pooled connections: it is refused.
      await assert.rejects(db.exec("BEGIN"), /db\.transaction/);

      const insert = (id) => db.run("INSERT INTO probe(token) VALUES(?)", [id]);
      await db.exec("CREATE TABLE probe (token TEXT PRIMARY KEY)");
      let release;
      const gate = new Promise((r) => (release = r));
      let insideReady;
      const ready = new Promise((r) => (insideReady = r));
      // Transaction A: writes, then waits while others run.
      const a = db.transaction(async () => {
        const first = (await db.get("SELECT pg_backend_pid() AS pid")).pid;
        await insert("tx-a");
        insideReady();
        await gate;
        // Same dedicated client for the whole transaction, and it sees its own write.
        assert.equal(
          (await db.get("SELECT pg_backend_pid() AS pid")).pid,
          first,
        );
        assert.ok(
          await db.get("SELECT token FROM probe WHERE token=?", ["tx-a"]),
        );
        return first;
      });
      await ready;
      // Outside reads use another connection and do not see A's uncommitted row.
      assert.equal(
        await db.get("SELECT token FROM probe WHERE token=?", ["tx-a"]),
        undefined,
      );
      // Transaction B fails while A is open: only B is rolled back.
      await assert.rejects(
        db.transaction(async () => {
          await insert("tx-b");
          throw new Error("falha em B");
        }),
        /falha em B/,
      );
      release();
      const pidA = await a;
      assert.ok(
        await db.get("SELECT token FROM probe WHERE token=?", ["tx-a"]),
      );
      assert.equal(
        await db.get("SELECT token FROM probe WHERE token=?", ["tx-b"]),
        undefined,
      );
      // A failing SQL statement aborts and rolls back its transaction; the client returns usable.
      await assert.rejects(
        db.transaction(async () => {
          await insert("tx-c");
          await db.run("SELECT * FROM tabela_inexistente");
        }),
      );
      assert.equal(
        await db.get("SELECT token FROM probe WHERE token=?", ["tx-c"]),
        undefined,
      );

      // An idle pooled connection killed by the server must not crash the process.
      const idle = (await db.get("SELECT pg_backend_pid() AS pid")).pid;
      const victims = [idle, pidA, ...reads.map((r) => r.pid)];
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid = ANY($1::int[])",
        [victims],
      );
      await new Promise((r) => setTimeout(r, 300));
      assert.equal((await db.get("SELECT 1 AS ok")).ok, 1);
      assert.equal(
        (await db.all("SELECT token FROM probe WHERE token=?", ["tx-a"]))
          .length,
        1,
      );
    } finally {
      if (db) await db.close();
      if (created) await admin.query('DROP SCHEMA "' + schema + '" CASCADE');
      await admin.end();
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
