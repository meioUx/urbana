import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import { contactChannel, serviceCode } from "../server/sector-control.js";

test("sector service and contact codes match the 2026 control legend", () => {
  assert.equal(serviceCode({ subcategory: "Boca de lobo" }).code, "BC");
  assert.equal(
    serviceCode({ subcategory: "Buraco" }, { name: "Pavimentação" }).code,
    "BU",
  );
  assert.equal(
    serviceCode({ description: "Reparo com asfalto quente" }).code,
    "ASF",
  );
  assert.equal(
    serviceCode({ description: "Serviço não catalogado" }).code,
    "OUT",
  );
  assert.equal(
    contactChannel({ requested_by: "Ouvidoria 123/2026" }),
    "Ouvidoria",
  );
  assert.equal(contactChannel({ origin: "WhatsApp" }), "Whats");
  assert.equal(contactChannel({ origin: "Fiscalização municipal" }), "Geral");
});

test("sector control is managerial and reconciles orders, services and contacts", async () => {
  const folder = mkdtempSync(join(tmpdir(), "urbana-sector-control-"));
  process.env.DATA_DIR = folder;
  process.env.DEMO_DATA = "true";
  process.env.ADMIN_PASSWORD = "Urbana@2026";
  const db = await openDatabase();
  await seed(db);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (email) => {
    const response = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Urbana@2026" }),
    });
    return response.headers.get("set-cookie").split(";")[0];
  };
  try {
    const admin = await login("admin@urbana.local");
    const field = await login("campo@urbana.local");
    const month = new Date().toISOString().slice(0, 7);
    const response = await fetch(`${base}/controle-setor?month=${month}`, {
      headers: { cookie: admin },
    });
    assert.equal(response.status, 200);
    const control = await response.json();
    assert.equal(control.summary.orders, control.rows.length);
    assert.equal(
      control.summary.services,
      control.rows.reduce((total, row) => total + row.service_quantity, 0),
    );
    assert.equal(
      control.summary.codes.reduce((total, item) => total + item.quantity, 0),
      control.summary.services,
    );
    assert.equal(
      control.summary.contacts.reduce(
        (total, item) => total + item.quantity,
        0,
      ),
      control.summary.orders,
    );
    const denied = await fetch(`${base}/controle-setor?month=${month}`, {
      headers: { cookie: field },
    });
    assert.equal(denied.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
