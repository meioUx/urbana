import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { backupName, createBackup, postgresEnv } from "../scripts/backup.mjs";

const temp = mkdtempSync(join(tmpdir(), "urbana-backup-"));
const data = join(temp, "data");
const out = join(temp, "out");
process.env.DATA_DIR = data;
process.env.DEMO_DATA = "false";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
let db;

before(async () => {
  db = await openDatabase();
  await seed(db);
  mkdirSync(join(data, "uploads"), { recursive: true });
  mkdirSync(join(data, "invoices"), { recursive: true });
  writeFileSync(join(data, "uploads", "foto-1"), "imagem");
  writeFileSync(join(data, "invoices", "nota-1.pdf"), "pdf");
});
after(async () => {
  await db.close();
  rmSync(temp, { recursive: true, force: true });
});

test("SQLite backup taken while the database is open (WAL) can be restored", async () => {
  // Rows written through the live WAL connection, not checkpointed into the main file.
  const admin = await db.get("SELECT id FROM users LIMIT 1");
  await db.run("INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?)", [
    "wal-row",
    "test",
    "x",
    admin.id,
    "Linha apenas no WAL",
    null,
    null,
    new Date().toISOString(),
  ]);
  assert.ok(
    existsSync(join(data, "urban.sqlite-wal")),
    "database is in WAL mode",
  );
  const rowsBefore = (await db.get("SELECT COUNT(*) AS n FROM audit_logs")).n;
  const result = await createBackup({ dataDir: data, outDir: out, keep: 5 });
  assert.match(result.manifest.name, /^urbana-\d{8}-\d{6}Z$/);
  assert.equal(result.manifest.dialect, "sqlite");
  assert.equal(result.manifest.database.schemaVersion, 13);
  assert.deepEqual(result.manifest.files, { uploads: 1, invoices: 1 });
  assert.deepEqual(
    readdirSync(out).filter((n) => n.startsWith(".tmp-")),
    [],
  );
  // The live database keeps working after the backup.
  await db.run("INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?)", [
    "after-backup",
    "test",
    "x",
    admin.id,
    "Depois",
    null,
    null,
    new Date().toISOString(),
  ]);

  // Restore into a clean data dir and open it with the application's own opener.
  const restored = join(temp, "restored");
  mkdirSync(restored);
  cpSync(result.dir, restored, { recursive: true });
  rmSync(join(restored, "manifest.json"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = restored;
  const copy = await openDatabase();
  process.env.DATA_DIR = previous;
  try {
    assert.equal(
      (await copy.get("SELECT COUNT(*) AS n FROM audit_logs")).n,
      rowsBefore,
    );
    assert.ok(await copy.get("SELECT id FROM audit_logs WHERE id='wal-row'"));
    assert.equal(
      await copy.get("SELECT id FROM audit_logs WHERE id='after-backup'"),
      undefined,
    );
    assert.equal(
      (await copy.get("SELECT COUNT(*) AS n FROM users")).n,
      (await db.get("SELECT COUNT(*) AS n FROM users")).n,
    );
  } finally {
    await copy.close();
  }
  assert.equal(
    readFileSync(join(restored, "uploads", "foto-1"), "utf8"),
    "imagem",
  );
  assert.equal(
    readFileSync(join(restored, "invoices", "nota-1.pdf"), "utf8"),
    "pdf",
  );
  // The raw source file is untouched and integrity is verified on the copy itself.
  const raw = new DatabaseSync(join(result.dir, "urban.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    Object.values(raw.prepare("PRAGMA integrity_check").get())[0],
    "ok",
  );
  raw.close();
});

test("retention keeps the newest N complete backups and never touches other folders", async () => {
  const dir = join(temp, "retention");
  mkdirSync(dir);
  mkdirSync(join(dir, "minhas-fotos"));
  mkdirSync(join(dir, "urbana-20200101-000000Z")); // matches the name but has no manifest: not ours to remove
  const base = Date.UTC(2026, 0, 1, 12, 0, 0);
  const made = [];
  for (let i = 0; i < 4; i++)
    made.push(
      (
        await createBackup({
          dataDir: data,
          outDir: dir,
          keep: 2,
          date: new Date(base + i * 1000),
        })
      ).manifest.name,
    );
  const left = readdirSync(dir).sort();
  assert.deepEqual(
    left.filter((n) => /^urbana-2026/.test(n)),
    made.slice(2),
  );
  assert.ok(left.includes("minhas-fotos"));
  assert.ok(left.includes("urbana-20200101-000000Z"));
  // keep=0 keeps everything.
  await createBackup({
    dataDir: data,
    outDir: dir,
    keep: 0,
    date: new Date(base + 10_000),
  });
  assert.equal(
    readdirSync(dir).filter((n) => /^urbana-2026/.test(n)).length,
    3,
  );
});

test("a failed backup leaves no partial folder", async () => {
  const dir = join(temp, "failed");
  await assert.rejects(
    createBackup({ dataDir: join(temp, "nao-existe"), outDir: dir }),
    /não encontrado/,
  );
  assert.deepEqual(readdirSync(dir), []);
  await assert.rejects(
    createBackup({
      dataDir: data,
      outDir: dir,
      databaseUrl: "postgres://u:p@127.0.0.1:1/x",
      pgDump: "pg_dump_inexistente_urbana",
    }),
    /não encontrado/,
  );
  assert.deepEqual(readdirSync(dir), []);
});

test("PostgreSQL connection goes through PG* variables, not the command line", () => {
  const env = postgresEnv(
    "postgres://urbana:p%40ss@db.example:5433/urbana?sslmode=require",
    {},
  );
  assert.deepEqual(env, {
    PGHOST: "db.example",
    PGPORT: "5433",
    PGUSER: "urbana",
    PGPASSWORD: "p@ss",
    PGDATABASE: "urbana",
    PGSSLMODE: "require",
  });
});

test("backupName is a sortable UTC stamp", () => {
  assert.equal(
    backupName(new Date("2026-11-11T09:08:07.123Z")),
    "urbana-20261111-090807Z",
  );
});

test("npm script entry point: --out and --keep", () => {
  const dir = join(temp, "cli");
  const run = spawnSync(
    process.execPath,
    ["scripts/backup.mjs", `--out=${dir}`, "--keep=3"],
    { env: { ...process.env, DATA_DIR: data }, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Backup criado: /);
  assert.equal(readdirSync(dir).length, 1);
  assert.equal(
    spawnSync(process.execPath, ["scripts/backup.mjs", "--keep=-1"], {
      env: process.env,
      encoding: "utf8",
    }).status,
    2,
  );
});
