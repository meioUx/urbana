// Manual check against a real clamd (not part of `npm test`).
//   docker run -d --name urbana-clamav -p 127.0.0.1:3310:3310 clamav/clamav:stable   (wait for clamd)
//   CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=3310 node tests/clamav-integration.mjs
// 1. Sends the EICAR test file (built at run time, never stored in the repository) straight to clamd.
// 2. Starts the production server on a free port with a temporary DATA_DIR and uploads a clean file
//    and an infected one through both upload flows. clamd only flags EICAR at the very start of a
//    file, which the upload signature checks (PNG/PDF/MP4 magic bytes) never let through, so the
//    infected upload carries a marker matched by a custom signature registered in the container
//    (set CLAMAV_CONTAINER to the container name; the marker is also built at run time).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV6kAAAAASUVORK5CYII=",
  "base64",
);
// Standard EICAR test string, assembled here so no scanner flags this source file.
const eicar = [
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$",
  "EICAR-STANDARD-ANTIVIRUS-TEST-FILE",
  "!$H+H*",
].join("");
const marker = ["URBANA", "TEST", "MARKER", "4f19c2"].join("-");
const { scanWithClamd } = await import("../server/modules/files/clamav.js");
const direct = {
  host: process.env.CLAMAV_HOST,
  port: Number(process.env.CLAMAV_PORT || 3310),
  timeoutMs: 30000,
};
console.log(
  "clamd direto, EICAR:",
  await scanWithClamd(Buffer.from(eicar), direct),
);
console.log("clamd direto, limpo:", await scanWithClamd(png, direct));
assert.equal(
  (await scanWithClamd(Buffer.from(eicar), direct)).status,
  "infected",
);
assert.equal((await scanWithClamd(png, direct)).status, "clean");
if (process.env.CLAMAV_CONTAINER) {
  const hex = Buffer.from(marker).toString("hex");
  const container = process.env.CLAMAV_CONTAINER;
  execFileSync("docker", [
    "exec",
    container,
    "sh",
    "-c",
    `echo 'Urbana.Test.Marker:0:*:${hex}' > /var/lib/clamav/urbana-test.ndb && clamdscan --reload`,
  ]);
  // Reloading the databases takes a while; wait until the marker is recognised.
  for (
    let i = 0;
    i < 90 &&
    (await scanWithClamd(Buffer.from(marker), direct).catch(() => ({})))
      .status !== "infected";
    i++
  )
    await new Promise((r) => setTimeout(r, 2000));
  assert.equal(
    (await scanWithClamd(Buffer.from(marker), direct)).status,
    "infected",
    "assinatura de teste carregada",
  );
}
const pdf = (extra = "") =>
  `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n${extra}`;

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const dataDir = mkdtempSync(join(tmpdir(), "urbana-clamav-"));
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/index.js", "--production"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    DATABASE_URL: "",
    DEMO_DATA: "false",
    ADMIN_PASSWORD: "Testing@2026",
    CLAMAV_FAIL_MODE: "closed",
    CLAMAV_TIMEOUT_MS: "30000",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin}/healthz`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const json = (path, body, cookie) =>
    fetch(origin + "/api" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  const login = await json("/auth/login", {
    email: "admin@urbana.local",
    password: "Testing@2026",
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const occurrence = await (
    await json(
      "/ocorrencias",
      {
        category_id: "category-1",
        subcategory: "Buraco",
        description: "ClamAV real",
        origin: "Fiscalização",
        priority: "Alta",
        lat: -27,
        lng: -48,
        address: "Rua Scan, 1",
        neighborhood: "Centro",
      },
      cookie,
    )
  ).json();
  assert.ok(occurrence.id, "ocorrência criada");
  await json(
    `/ocorrencias/${occurrence.id}/classificar`,
    {
      version: occurrence.version,
      category_id: "category-1",
      subcategory: "Buraco",
      sector_id: "sector-1",
      priority: "Alta",
    },
    cookie,
  );
  const order = await (
    await json(
      "/ordens-servico",
      {
        occurrence_ids: [occurrence.id],
        team_id: "team-1",
        scheduled_at: "2026-10-02",
        responsible: "Gestor",
      },
      cookie,
    )
  ).json();
  assert.ok(order.id, "OS criada");
  const upload = (path, content, type, name, extra = {}) => {
    const form = new FormData();
    form.append("file", new Blob([content], { type }), name);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return fetch(origin + "/api" + path, {
      method: "POST",
      headers: { cookie, Origin: origin },
      body: form,
    });
  };
  const evidence = { stage: "registro", lat: "-27", lng: "-48" };
  const stored = () =>
    ["uploads", "invoices"].flatMap((d) => {
      try {
        return readdirSync(join(dataDir, d));
      } catch {
        return [];
      }
    });

  const clean = await upload(
    `/ocorrencias/${occurrence.id}/anexos`,
    png,
    "image/png",
    "foto.png",
    evidence,
  );
  console.log("evidência limpa:", clean.status);
  assert.equal(clean.status, 200);
  assert.equal(stored().length, 1);
  const badPdf = await upload(
    `/ocorrencias/${occurrence.id}/anexos`,
    pdf(marker),
    "application/pdf",
    "infectado.pdf",
    evidence,
  );
  const badBody = await badPdf.text();
  console.log("evidência infectada:", badPdf.status, badBody);
  assert.equal(badPdf.status, 422);
  assert.equal(JSON.parse(badBody).code, "MALWARE_DETECTED");
  assert.ok(!/marker/i.test(badBody));
  assert.equal(stored().length, 1, "nada novo no storage");

  const cleanInvoice = await upload(
    `/ordens-servico/${order.id}/notas-fiscais/extrair`,
    pdf(),
    "application/pdf",
    "nota.pdf",
  );
  console.log("nota limpa:", cleanInvoice.status);
  assert.equal(cleanInvoice.status, 200);
  assert.equal(stored().length, 2);
  const badInvoice = await upload(
    `/ordens-servico/${order.id}/notas-fiscais/extrair`,
    pdf(marker),
    "application/pdf",
    "nota-infectada.pdf",
  );
  const badInvoiceBody = await badInvoice.text();
  console.log("nota infectada:", badInvoice.status, badInvoiceBody);
  assert.equal(badInvoice.status, 422);
  assert.equal(stored().length, 2, "nada novo no storage");
  const logged = output
    .split("\n")
    .filter((l) => /malware|antimalware/i.test(l));
  console.log("log do servidor:\n" + logged.join("\n"));
  assert.ok(
    logged.some((l) => /Urbana\.Test\.Marker/.test(l)),
    "assinatura no log",
  );
  console.log("OK");
} catch (error) {
  console.error(output.slice(-3000));
  throw error;
} finally {
  child.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true });
}
