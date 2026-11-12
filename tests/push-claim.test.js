import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { deliverNotifications } from "../server/field.js";

// Runs against SQLite here; tests/postgres.test.js repeats the concurrent claim on PostgreSQL.
const temp = mkdtempSync(join(tmpdir(), "urbana-push-"));
process.env.DATA_DIR = temp;
process.env.DEMO_DATA = "false";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
process.env.VAPID_PUBLIC_KEY = "test-public";
process.env.VAPID_PRIVATE_KEY = "test-private";
process.env.VAPID_SUBJECT = "mailto:example@example.test";

let db, user, team, sector;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Each "instance" has its own in-process queue, like two server processes sharing one database.
const instance = () => {
  let queue = Promise.resolve();
  return (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };
};

before(async () => {
  db = await openDatabase();
  await seed(db);
  team = (await db.get("SELECT id FROM catalogs WHERE kind='equipes' LIMIT 1"))
    .id;
  sector = (
    await db.get("SELECT id FROM catalogs WHERE kind='setores' LIMIT 1")
  ).id;
  user = randomUUID();
  await db.run(
    "INSERT INTO users(id,name,email,password,role,team_id) VALUES(?,?,?,?,?,?)",
    [user, "Campo", "push-claim@test.local", "x", "Equipe de Campo", team],
  );
  await db.run(
    "INSERT INTO push_subscriptions(id,user_id,endpoint,data) VALUES(?,?,?,?)",
    [
      randomUUID(),
      user,
      "https://fcm.googleapis.com/fcm/send/claim",
      JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/claim",
        keys: { p256dh: "a", auth: "a" },
      }),
    ],
  );
});
after(async () => {
  await db.close();
  rmSync(temp, { recursive: true, force: true });
});

async function job() {
  const orderId = randomUUID();
  await db.run(
    "INSERT INTO orders(id,code,sector_id,team_id,status,priority,due_at,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
    [
      orderId,
      `OS-${orderId.slice(0, 8)}`,
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
  const id = randomUUID();
  await db.run(
    "INSERT INTO push_jobs(id,user_id,order_id,created_at,next_attempt_at) VALUES(?,?,?,?,?)",
    [id, user, orderId, new Date().toISOString(), "2000-01-01T00:00:00Z"],
  );
  return { id, orderId };
}
const row = (id) =>
  db.get("SELECT status,attempts,next_attempt_at FROM push_jobs WHERE id=?", [
    id,
  ]);
const retire = () =>
  db.run("UPDATE push_jobs SET status='delivered' WHERE status='pending'");

test("concurrent instances deliver each job exactly once", async () => {
  await retire();
  const jobs = [];
  for (let i = 0; i < 8; i++) jobs.push(await job());
  const sent = new Map();
  const send = async (sub, payload) => {
    await sleep(15); // keep the claim window open
    const tag = JSON.parse(payload).tag;
    sent.set(tag, (sent.get(tag) || 0) + 1);
  };
  await Promise.all(
    [1, 2, 3].map(() => deliverNotifications(db, instance(), send)),
  );
  for (const j of jobs) {
    assert.equal(sent.get(j.orderId), 1, `job ${j.id} sent once`);
    const state = await row(j.id);
    assert.equal(state.status, "delivered");
    assert.equal(Number(state.attempts), 1);
  }
  assert.equal(sent.size, 8);
});

test("a job claimed by a crashed instance is retried only after its lease expires", async () => {
  await retire();
  const j = await job();
  // What an instance that crashed right after claiming leaves behind: attempts bumped, lease in the future.
  await db.run("UPDATE push_jobs SET attempts=1,next_attempt_at=? WHERE id=?", [
    new Date(Date.now() + 5 * 60000).toISOString(),
    j.id,
  ]);
  let sent = 0;
  const send = async () => void sent++;
  await deliverNotifications(db, instance(), send);
  assert.equal(sent, 0, "leased job is skipped");
  await db.run(
    "UPDATE push_jobs SET next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?",
    [j.id],
  );
  await deliverNotifications(db, instance(), send);
  assert.equal(sent, 1, "expired lease is reclaimed");
  const state = await row(j.id);
  assert.equal(state.status, "delivered");
  assert.equal(Number(state.attempts), 2);
});

test("a failed delivery keeps the retry/backoff semantics and the final attempt marks it failed", async () => {
  await retire();
  const j = await job();
  const fail = async () => {
    throw new Error("offline");
  };
  for (let attempt = 1; attempt <= 5; attempt++) {
    await db.run(
      "UPDATE push_jobs SET next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?",
      [j.id],
    );
    await deliverNotifications(db, instance(), fail);
    const state = await row(j.id);
    assert.equal(Number(state.attempts), attempt);
    assert.equal(state.status, attempt < 5 ? "pending" : "failed");
  }
});

test("a slow instance whose lease expired cannot overwrite the newer owner's result", async () => {
  await retire();
  const j = await job();
  let release;
  const gate = new Promise((r) => (release = r));
  let sentByA = 0;
  const a = deliverNotifications(
    db,
    instance(),
    async () => {
      sentByA++;
      await gate;
      throw new Error("A fails late");
    },
    { leaseMs: 1 },
  );
  await sleep(30); // A's lease (1 ms) has expired while it is still sending
  let sentByB = 0;
  await deliverNotifications(db, instance(), async () => void sentByB++);
  release();
  await a;
  assert.equal(sentByA, 1);
  assert.equal(sentByB, 1);
  const state = await row(j.id);
  assert.equal(state.status, "delivered", "B's result stands");
  assert.equal(Number(state.attempts), 2);
});
