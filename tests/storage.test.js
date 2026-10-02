import { createUploadGuard } from "../server/modules/files/upload-limit.js";
import { EventEmitter } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalFileStorage,
  ObjectFileStorage,
} from "../server/modules/files/storage.js";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV6kAAAAASUVORK5CYII=",
  "base64",
);

test("local FileStorage preserves legacy paths, rejects traversal and supports delete/exists", async () => {
  const folder = mkdtempSync(join(tmpdir(), "urban-storage-"));
  const storage = new LocalFileStorage(folder);
  try {
    await storage.save("uploads/legacy-file", png);
    assert.ok(await storage.exists("uploads/legacy-file"));
    assert.deepEqual(await storage.get("uploads/legacy-file"), png);
    await assert.rejects(storage.save("uploads/legacy-file", png));
    await assert.rejects(storage.get("uploads/../../secret"));
    await assert.rejects(storage.save("invoices/../unsafe.pdf", png));
    await storage.delete("uploads/legacy-file");
    await storage.delete("uploads/legacy-file");
    assert.equal(await storage.exists("uploads/legacy-file"), false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("object provider serves authorized evidence and compensates storage after failed database writes", async () => {
  const folder = mkdtempSync(join(tmpdir(), "urban-object-test-"));
  process.env.DATA_DIR = folder;
  process.env.DEMO_DATA = "false";
  process.env.ADMIN_PASSWORD = "Testing@2026";
  delete process.env.DATABASE_URL;
  const objects = new Map();
  const storage = new ObjectFileStorage({
    bucket: "test",
    client: {
      putObject: async ({ key, body }) => objects.set(key, body),
      getObject: async ({ key }) => objects.get(key),
      deleteObject: async ({ key }) => objects.delete(key),
      headObject: async ({ key }) => objects.has(key),
    },
  });
  let db, server;
  try {
    db = await openDatabase();
    await seed(db);
    server = createApp(db, { storage }).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = "http://127.0.0.1:" + server.address().port;
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@urbana.local",
        password: "Testing@2026",
      }),
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const post = async (path, body) =>
      fetch(base + "/api" + path, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const created = await (
      await post("/ocorrencias", {
        category_id: "category-1",
        subcategory: "Buraco",
        description: "Storage desacoplado",
        origin: "Fiscalização",
        priority: "Alta",
        lat: -27,
        lng: -48,
        address: "Rua Storage, 1",
        neighborhood: "Centro",
      })
    ).json();
    const attach = async () => {
      const form = new FormData();
      form.append("file", new Blob([png], { type: "image/png" }), "teste.png");
      form.append("stage", "registro");
      form.append("lat", "-27");
      form.append("lng", "-48");
      return fetch(base + "/api/ocorrencias/" + created.id + "/anexos", {
        method: "POST",
        headers: { cookie },
        body: form,
      });
    };
    const uploaded = await attach();
    assert.equal(uploaded.status, 200);
    const evidence = await uploaded.json();
    assert.equal(objects.size, 1);
    assert.equal(
      (await fetch(base + "/api/anexos/" + evidence.id)).status,
      401,
    );
    const download = await fetch(base + "/api/anexos/" + evidence.id, {
      headers: { cookie },
    });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
    const originalRun = db.run;
    db.run = async (sql, args) => {
      if (sql.startsWith("INSERT INTO audit_logs"))
        throw Object.assign(
          new Error("Falha de auditoria para teste de rollback"),
          { status: 503 },
        );
      return originalRun(sql, args);
    };
    const rejected = await attach();
    assert.equal(rejected.status, 503);
    assert.equal(objects.size, 1);
    assert.equal(
      (await db.all("SELECT * FROM evidence WHERE entity_id=?", [created.id]))
        .length,
      1,
    );
    db.run = originalRun;
    assert.equal(
      (
        await post("/ocorrencias/" + created.id + "/classificar", {
          version: created.version,
          category_id: "category-1",
          subcategory: "Buraco",
          sector_id: "sector-1",
          priority: "Alta",
        })
      ).status,
      200,
    );
    const order = await (
      await post("/ordens-servico", {
        occurrence_ids: [created.id],
        team_id: "team-1",
        scheduled_at: "2026-10-02",
        responsible: "Gestor",
      })
    ).json();
    assert.ok(order.id);
    const objectsPdf = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      "<< /Length 39 >>\nstream\nBT /F1 12 Tf 20 750 Td (NF 123) Tj ET\nendstream",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (const [i, o] of objectsPdf.entries()) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += i + 1 + " 0 obj\n" + o + "\nendobj\n";
    }
    const xref = Buffer.byteLength(pdf);
    pdf +=
      "xref\n0 6\n0000000000 65535 f \n" +
      offsets
        .slice(1)
        .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
        .join("") +
      "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
      xref +
      "\n%%EOF";
    const invoiceForm = new FormData();
    invoiceForm.append(
      "file",
      new Blob([pdf], { type: "application/pdf" }),
      "nota.pdf",
    );
    const invoiceResponse = await fetch(
      base + "/api/ordens-servico/" + order.id + "/notas-fiscais/extrair",
      { method: "POST", headers: { cookie }, body: invoiceForm },
    );
    assert.equal(
      invoiceResponse.status,
      200,
      await invoiceResponse.clone().text(),
    );
    const invoice = await invoiceResponse.json();
    assert.equal(objects.size, 2);
    const invoiceDownload = await fetch(
      base + "/api/notas-fiscais/" + invoice.id + "/arquivo",
      { headers: { cookie } },
    );
    assert.equal(invoiceDownload.status, 200);
    assert.equal(
      Buffer.from(await invoiceDownload.arrayBuffer()).toString(),
      pdf,
    );
  } finally {
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("multipart capacity is released after finish or disconnect without double release", () => {
  const guard = createUploadGuard(1);
  let accepted = 0;
  const first = new EventEmitter();
  guard({}, first, () => accepted++);
  assert.equal(accepted, 1);
  let status, body;
  const rejected = {
    status: (n) => {
      status = n;
      return rejected;
    },
    json: (v) => {
      body = v;
    },
  };
  guard({}, rejected, () => accepted++);
  assert.equal(status, 429);
  assert.equal(body.code, "UPLOAD_BUSY");
  first.emit("close");
  first.emit("finish");
  const second = new EventEmitter();
  guard({}, second, () => accepted++);
  assert.equal(accepted, 2);
  guard({}, rejected, () => accepted++);
  assert.equal(accepted, 2);
  second.emit("finish");
  guard({}, new EventEmitter(), () => accepted++);
  assert.equal(accepted, 3);
});
