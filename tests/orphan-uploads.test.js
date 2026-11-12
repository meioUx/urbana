import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import {
  LocalFileStorage,
  ObjectFileStorage,
} from "../server/modules/files/storage.js";
import { sweepOrphans } from "../server/modules/files/orphans.js";
import { createLogger } from "../server/logger.js";

const temp = mkdtempSync(join(tmpdir(), "urbana-orphans-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "false";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
const quiet = createLogger({ level: "silent" });
const HOUR = 3600 * 1000;
let db, storage;

const put = (key, ageMs) => {
  const path = join(temp, key);
  mkdirSync(join(temp, key.split("/")[0]), { recursive: true });
  writeFileSync(path, "x");
  const t = new Date(Date.now() - ageMs);
  utimesSync(path, t, t);
  return key;
};
const exists = (key) => existsSync(join(temp, key));

before(async () => {
  db = await openDatabase();
  await seed(db);
  storage = new LocalFileStorage(temp);
});
after(async () => {
  await db.close();
  rmSync(temp, { recursive: true, force: true });
});

async function scenario() {
  const admin = await db.get("SELECT id FROM users LIMIT 1");
  const sector = await db.get(
    "SELECT id FROM catalogs WHERE kind='setores' LIMIT 1",
  );
  const team = await db.get(
    "SELECT id FROM catalogs WHERE kind='equipes' LIMIT 1",
  );
  const orderId = randomUUID();
  await db.run(
    "INSERT INTO orders(id,code,sector_id,team_id,status,priority,due_at,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
    [
      orderId,
      `OS-${orderId.slice(0, 8)}`,
      sector.id,
      team.id,
      "PROGRAMADA",
      "Alta",
      "2030-01-01",
      "2026-01-01",
      "2026-01-01",
      "{}",
    ],
  );
  const refEvidence = randomUUID();
  const refInvoice = `${randomUUID()}.pdf`;
  await db.run(
    "INSERT INTO evidence(id,entity_type,entity_id,stage,filename,original_name,mime,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    [
      randomUUID(),
      "order",
      orderId,
      "antes",
      refEvidence,
      "a.png",
      "image/png",
      admin.id,
      "2026-01-01",
    ],
  );
  await db.run(
    "INSERT INTO invoices(id,order_id,status,filename,original_name,user_id,created_at,data) VALUES(?,?,?,?,?,?,?,?)",
    [
      randomUUID(),
      orderId,
      "RASCUNHO",
      refInvoice,
      "n.pdf",
      admin.id,
      "2026-01-01",
      "{}",
    ],
  );
  return {
    refUpload: put(`uploads/${refEvidence}`, 10 * 24 * HOUR),
    refInvoice: put(`invoices/${refInvoice}`, 10 * 24 * HOUR),
    oldOrphanUpload: put(`uploads/${randomUUID()}`, 3 * 24 * HOUR),
    oldOrphanInvoice: put(`invoices/${randomUUID()}.pdf`, 3 * 24 * HOUR),
    recentOrphan: put(`uploads/${randomUUID()}`, 2 * HOUR),
    futureOrphan: put(`uploads/${randomUUID()}`, -5 * HOUR),
  };
}

test("dry run lists orphans past the grace period and deletes nothing", async () => {
  const f = await scenario();
  const result = await sweepOrphans({
    db,
    storage,
    graceMs: 24 * HOUR,
    dryRun: true,
    logger: quiet,
  });
  assert.equal(result.dryRun, true);
  assert.deepEqual(
    result.orphans.map((o) => o.key).sort(),
    [f.oldOrphanUpload, f.oldOrphanInvoice].sort(),
  );
  assert.deepEqual(result.deleted, []);
  for (const key of Object.values(f)) assert.ok(exists(key), key);
});

test("sweep removes only old unreferenced files; referenced and recent files stay", async () => {
  const f = await scenario();
  const result = await sweepOrphans({
    db,
    storage,
    graceMs: 24 * HOUR,
    logger: quiet,
  });
  assert.ok(result.deleted.includes(f.oldOrphanUpload));
  assert.ok(result.deleted.includes(f.oldOrphanInvoice));
  assert.equal(result.failed.length, 0);
  assert.equal(exists(f.oldOrphanUpload), false);
  assert.equal(exists(f.oldOrphanInvoice), false);
  assert.ok(exists(f.refUpload), "referenced upload kept");
  assert.ok(exists(f.refInvoice), "referenced invoice PDF kept");
  assert.ok(exists(f.recentOrphan), "upload inside the grace period kept");
  assert.ok(exists(f.futureOrphan), "file with a future mtime kept");
  // Second run is a no-op.
  assert.equal(
    (await sweepOrphans({ db, storage, graceMs: 24 * HOUR, logger: quiet }))
      .orphans.length,
    0,
  );
});

test("files that are not storage keys are ignored", async () => {
  mkdirSync(join(temp, "uploads", "sub"), { recursive: true });
  writeFileSync(join(temp, "uploads", ".hidden"), "x");
  const t = new Date(Date.now() - 9 * 24 * HOUR);
  utimesSync(join(temp, "uploads", ".hidden"), t, t);
  const result = await sweepOrphans({
    db,
    storage,
    graceMs: HOUR,
    logger: quiet,
  });
  assert.ok(
    !result.orphans.some(
      (o) => o.key.includes(".hidden") || o.key.includes("sub"),
    ),
  );
  assert.ok(exists("uploads/.hidden"));
});

test("a database without any file reference refuses to sweep", async () => {
  const other = mkdtempSync(join(tmpdir(), "urbana-orphans-empty-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = other;
  const emptyDb = await openDatabase();
  process.env.DATA_DIR = previous;
  try {
    mkdirSync(join(other, "uploads"));
    writeFileSync(join(other, "uploads", "abc"), "x");
    const t = new Date(Date.now() - 9 * 24 * HOUR);
    utimesSync(join(other, "uploads", "abc"), t, t);
    const guarded = await sweepOrphans({
      db: emptyDb,
      storage: new LocalFileStorage(other),
      graceMs: HOUR,
      logger: quiet,
    });
    assert.ok(guarded.refused);
    assert.deepEqual(guarded.deleted, []);
    assert.ok(existsSync(join(other, "uploads", "abc")));
    const forced = await sweepOrphans({
      db: emptyDb,
      storage: new LocalFileStorage(other),
      graceMs: HOUR,
      allowEmptyReferences: true,
      logger: quiet,
    });
    assert.deepEqual(forced.deleted, ["uploads/abc"]);
  } finally {
    await emptyDb.close();
    rmSync(other, { recursive: true, force: true });
  }
});

test("storage without listing (object storage) is reported as unsupported and untouched", async () => {
  let calls = 0;
  const client = new Proxy({}, { get: () => async () => void calls++ });
  const result = await sweepOrphans({
    db,
    storage: new ObjectFileStorage({ client, bucket: "b" }),
    logger: quiet,
  });
  assert.equal(result.supported, false);
  assert.equal(calls, 0);
});

test("script: --dry-run lists without deleting; refuses a missing database", async () => {
  const f = await scenario();
  const run = (env, ...args) =>
    spawnSync(
      process.execPath,
      ["scripts/cleanup-orphan-uploads.mjs", ...args],
      { env: { ...process.env, ...env }, encoding: "utf8" },
    );
  const dry = run({ DATA_DIR: temp }, "--dry-run", "--grace-hours=24");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /\[simulação\]/);
  assert.ok(dry.stdout.includes(f.oldOrphanUpload));
  assert.ok(exists(f.oldOrphanUpload));
  assert.equal(run({ DATA_DIR: temp }, "--grace-hours=0").status, 2);
  const missing = mkdtempSync(join(tmpdir(), "urbana-orphans-missing-"));
  try {
    assert.equal(run({ DATA_DIR: missing }, "--dry-run").status, 2);
    assert.equal(
      existsSync(join(missing, "urban.sqlite")),
      false,
      "must not create a database",
    );
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }
  const real = run({ DATA_DIR: temp }, "--grace-hours=24");
  assert.equal(real.status, 0, real.stderr);
  assert.equal(exists(f.oldOrphanUpload), false);
  assert.ok(exists(f.refUpload));
});
