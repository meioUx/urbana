import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export async function openDatabase() {
  const folder = resolve(process.env.DATA_DIR || "data");
  mkdirSync(folder, { recursive: true });
  let db;
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    const query = (sql, args = []) => {
      let i = 0;
      return client.query(
        sql.replace(/\?/g, () => `$${++i}`),
        args,
      );
    };
    db = {
      dialect: "postgres",
      all: async (s, a) => (await query(s, a)).rows,
      get: async (s, a) => (await query(s, a)).rows[0],
      run: query,
      exec: (s) => client.query(s),
      close: () => {
        client.release();
        return pool.end();
      },
    };
  } else {
    const sqlite = new DatabaseSync(resolve(folder, "urban.sqlite"));
    sqlite.function("lower", {deterministic:true}, value => value == null ? null : String(value).toLocaleLowerCase("pt-BR"));
    sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    db = {
      dialect: "sqlite",
      all: async (s, a = []) => sqlite.prepare(s).all(...a),
      get: async (s, a = []) => sqlite.prepare(s).get(...a),
      run: async (s, a = []) => sqlite.prepare(s).run(...a),
      exec: async (s) => sqlite.exec(s),
      close: async () => sqlite.close(),
    };
  }
  await db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  if (process.env.DATABASE_URL) {
    await db.exec(
      "CREATE EXTENSION IF NOT EXISTS postgis; ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS geom geometry(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng,lat),4326)) STORED; CREATE INDEX IF NOT EXISTS idx_occurrences_geom ON occurrences USING GIST(geom);",
    );
  }
  await db.run(
    "INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?) ON CONFLICT(version) DO NOTHING",
    [new Date().toISOString()],
  );
  if (
    !(await db.get("SELECT version FROM schema_migrations WHERE version=2"))
  ) {
    await db.exec("BEGIN");
    try {
      await db.exec(
        "CREATE TABLE IF NOT EXISTS action_plans (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS action_plan_occurrences (plan_id TEXT NOT NULL REFERENCES action_plans(id), occurrence_id TEXT PRIMARY KEY REFERENCES occurrences(id)); CREATE INDEX IF NOT EXISTS idx_action_plan_links ON action_plan_occurrences(plan_id);",
      );
      await db.run(
        "INSERT INTO schema_migrations(version, applied_at) VALUES(2, ?)",
        [new Date().toISOString()],
      );
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  }
  if (
    !(await db.get("SELECT version FROM schema_migrations WHERE version=3"))
  ) {
    await db.exec("BEGIN");
    try {
      await db.exec(
        "CREATE TABLE IF NOT EXISTS client_requests (user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY(user_id, request_id)); CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), endpoint TEXT UNIQUE NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS push_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), order_id TEXT NOT NULL REFERENCES orders(id), created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');",
      );
      await db.run(
        "INSERT INTO schema_migrations(version, applied_at) VALUES(3, ?)",
        [new Date().toISOString()],
      );
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  }
  if (!(await db.get("SELECT version FROM schema_migrations WHERE version=4"))) {
    await db.exec("BEGIN");
    try {
      await db.exec(`CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), status TEXT NOT NULL, supplier TEXT NOT NULL DEFAULT '', invoice_number TEXT NOT NULL DEFAULT '', issue_date TEXT, total_value DOUBLE PRECISION NOT NULL DEFAULT 0, filename TEXT NOT NULL, original_name TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS invoice_items (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), material_id TEXT REFERENCES catalogs(id), stage TEXT NOT NULL, description TEXT NOT NULL, purchased_quantity DOUBLE PRECISION NOT NULL CHECK(purchased_quantity > 0), used_quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(used_quantity >= 0), unit TEXT NOT NULL, unit_value DOUBLE PRECISION NOT NULL CHECK(unit_value >= 0), product_total DOUBLE PRECISION NOT NULL CHECK(product_total >= 0), position INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS inventory_movements (id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES catalogs(id), order_id TEXT REFERENCES orders(id), invoice_id TEXT REFERENCES invoices(id), type TEXT NOT NULL CHECK(type IN ('entrada','saida')), quantity DOUBLE PRECISION NOT NULL CHECK(quantity > 0), unit_cost DOUBLE PRECISION NOT NULL CHECK(unit_cost >= 0), stage TEXT NOT NULL, notes TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_invoice_order ON invoices(order_id, status); CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id); CREATE INDEX IF NOT EXISTS idx_inventory_material ON inventory_movements(material_id, created_at);`);
      await db.run("INSERT INTO schema_migrations(version, applied_at) VALUES(4, ?)", [new Date().toISOString()]);
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  }
  if (!(await db.get("SELECT version FROM schema_migrations WHERE version=5"))) {
    await db.exec("BEGIN");
    try {
      for (const table of ["occurrences", "orders", "action_plans"])
        await db.exec(`ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)`);
      await db.run("INSERT INTO schema_migrations(version, applied_at) VALUES(5, ?)", [new Date().toISOString()]);
      await db.exec("COMMIT");
    } catch (error) { await db.exec("ROLLBACK"); throw error; }
  }
  if (!(await db.get("SELECT version FROM schema_migrations WHERE version=6"))) {
    await db.exec("BEGIN");
    try {
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_occurrences_page ON occurrences(created_at,id);
        CREATE INDEX IF NOT EXISTS idx_occurrences_sector_status ON occurrences(sector_id,status,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_occurrences_priority ON occurrences(priority,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_occurrences_category ON occurrences(category_id,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_orders_page ON orders(created_at,id);
        CREATE INDEX IF NOT EXISTS idx_orders_sector_status ON orders(sector_id,status,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_orders_priority ON orders(priority,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_orders_due ON orders(due_at,status);
        CREATE INDEX IF NOT EXISTS idx_order_occurrence_reverse ON order_occurrences(occurrence_id,order_id);
        CREATE INDEX IF NOT EXISTS idx_audit_page ON audit_logs(created_at,id);
        CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_consumption_order ON consumption(order_id);
        CREATE INDEX IF NOT EXISTS idx_consumption_material ON consumption(material_id,created_at);`);
      await db.run("INSERT INTO schema_migrations(version, applied_at) VALUES(6, ?)", [new Date().toISOString()]);
      await db.exec("COMMIT");
    } catch (error) { await db.exec("ROLLBACK"); throw error; }
  }
  if (!(await db.get("SELECT version FROM schema_migrations WHERE version=7"))) {
    await db.exec("BEGIN");
    try {
      await db.exec("CREATE INDEX IF NOT EXISTS idx_inventory_page ON inventory_movements(created_at,id); CREATE INDEX IF NOT EXISTS idx_inventory_order ON inventory_movements(order_id,created_at,id); CREATE INDEX IF NOT EXISTS idx_inventory_invoice ON inventory_movements(invoice_id);");
      await db.run("INSERT INTO schema_migrations(version, applied_at) VALUES(7, ?)", [new Date().toISOString()]);
      await db.exec("COMMIT");
    } catch (error) {await db.exec("ROLLBACK");throw error;}
  }
  return db;
}
