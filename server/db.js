import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "./logger.js";

const CONTROL = /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK)\s*;?\s*$/i;

// PostgreSQL: statements outside a transaction go to the pool (any idle connection, so reads run
// concurrently and a dropped connection is simply replaced). db.transaction(fn) checks out one
// dedicated client, binds it to fn's async context and returns it to the pool on COMMIT/ROLLBACK,
// so every db.all/get/run/exec issued inside fn runs on that client.
function postgresDatabase(url) {
  const pool = new pg.Pool({ connectionString: url });
  // An idle client that loses its connection emits here; without a listener the process would crash.
  pool.on("error", (error) =>
    logger.warn("PostgreSQL: conexão ociosa descartada.", { err: error }),
  );
  const context = new AsyncLocalStorage();
  const target = () => context.getStore()?.client ?? pool;
  const query = (sql, args = []) => {
    let i = 0;
    return target().query(
      sql.replace(/\?/g, () => `$${++i}`),
      args,
    );
  };
  const exec = (sql) => {
    // A bare BEGIN on a pool would open the transaction on one connection and run the next
    // statements on others. Transactions must go through db.transaction().
    if (CONTROL.test(sql) && !context.getStore()?.client)
      throw new Error("Use db.transaction(fn) para transações no PostgreSQL.");
    return target().query(sql);
  };
  return {
    dialect: "postgres",
    all: async (s, a) => (await query(s, a)).rows,
    get: async (s, a) => (await query(s, a)).rows[0],
    run: query,
    exec: async (s) => exec(s),
    async transaction(fn) {
      // Nested calls join the enclosing transaction (use SAVEPOINTs explicitly for partial rollback).
      if (context.getStore()?.client) return fn();
      const client = await pool.connect();
      const store = { client };
      let broken;
      try {
        await client.query("BEGIN");
        const result = await context.run(store, fn);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          broken = rollbackError; // connection is unusable: destroy it instead of returning it
        }
        throw error;
      } finally {
        // Async work spawned inside fn that outlives it falls back to the pool, never to a released client.
        store.client = null;
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}

function sqliteDatabase(file) {
  const sqlite = new DatabaseSync(file);
  sqlite.function("lower", { deterministic: true }, (value) =>
    value == null ? null : String(value).toLocaleLowerCase("pt-BR"),
  );
  sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  const db = {
    dialect: "sqlite",
    all: async (s, a = []) => sqlite.prepare(s).all(...a),
    get: async (s, a = []) => sqlite.prepare(s).get(...a),
    run: async (s, a = []) => sqlite.prepare(s).run(...a),
    exec: async (s) => sqlite.exec(s),
    // Single connection: same BEGIN/COMMIT/ROLLBACK sequence used before db.transaction existed.
    async transaction(fn) {
      await db.exec("BEGIN");
      try {
        const result = await fn();
        await db.exec("COMMIT");
        return result;
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    },
    close: async () => sqlite.close(),
  };
  return db;
}

// Migrations live in server/migrations/NNN-name.js and export up(db). They are applied in numeric
// order; each one runs in its own transaction and is recorded in schema_migrations. Modules that
// export `repeatable = true` (the schema.sql baseline and the version 9 marker) run on every boot,
// outside a transaction, and are recorded idempotently, exactly as before.
async function loadMigrations() {
  const folder = new URL("./migrations/", import.meta.url);
  const files = readdirSync(folder)
    .filter((f) => /^\d+-.+\.js$/.test(f))
    .sort();
  const migrations = [];
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (version !== migrations.length + 1)
      throw new Error(`Migration fora de sequência: ${file}`);
    const module = await import(new URL(file, folder));
    if (typeof module.up !== "function")
      throw new Error(`Migration sem up(db): ${file}`);
    migrations.push({
      version,
      up: module.up,
      repeatable: module.repeatable === true,
    });
  }
  return migrations;
}

export async function migrate(db) {
  for (const { version, up, repeatable } of await loadMigrations()) {
    if (repeatable) {
      await up(db);
      await db.run(
        "INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?) ON CONFLICT(version) DO NOTHING",
        [version, new Date().toISOString()],
      );
      continue;
    }
    if (
      await db.get("SELECT version FROM schema_migrations WHERE version=?", [
        version,
      ])
    )
      continue;
    await db.transaction(async () => {
      await up(db);
      await db.run(
        "INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)",
        [version, new Date().toISOString()],
      );
    });
  }
}

export async function openDatabase() {
  const folder = resolve(process.env.DATA_DIR || "data");
  mkdirSync(folder, { recursive: true });
  const db = process.env.DATABASE_URL
    ? postgresDatabase(process.env.DATABASE_URL)
    : sqliteDatabase(resolve(folder, "urban.sqlite"));
  try {
    await migrate(db);
  } catch (error) {
    await db.close();
    throw error;
  }
  return db;
}
