import "./support/same-origin-fetch.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import { userModules } from "../server/user-permissions.js";

const dir = mkdtempSync(join(tmpdir(), "urbana-works-"));
process.env.DATA_DIR = dir;
process.env.DEMO_DATA = "true";
process.env.ADMIN_PASSWORD = "Testing@2026";
delete process.env.DATABASE_URL;
let db, server, base;
const cookies = {};
async function request(path, method = "GET", body, who = "gestor") {
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie: cookies[who] || "",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
const login = async (email) => {
  const r = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Testing@2026" }),
  });
  assert.equal(r.status, 200, email);
  return r.headers.get("set-cookie").split(";")[0];
};
const street = {
  type: "LineString",
  coordinates: [
    [-48.64, -26.99],
    [-48.63, -26.99],
  ],
};
const crossing = {
  type: "LineString",
  coordinates: [
    [-48.635, -26.991],
    [-48.635, -26.989],
  ],
};
const square = {
  type: "Polygon",
  coordinates: [
    [
      [-48.66, -27.01],
      [-48.655, -27.01],
      [-48.655, -27.005],
      [-48.66, -27.005],
      [-48.66, -27.01],
    ],
  ],
};
const intervention = (extra = {}) => ({
  title: "Recapeamento da Avenida Central",
  description: "Fresagem e recomposição do pavimento",
  scope: "TRECHO",
  location: "Av. Central, entre Rua 1500 e Rua 1600",
  neighborhood: "Centro",
  sector_id: "sector-1",
  responsible: "Eng. Marta Lima",
  priority: "Alta",
  planned_start: "2026-12-01",
  planned_end: "2026-12-10",
  geometry: street,
  services: [{ description: "Fresagem", quantity: 1200, unit: "m²" }],
  ...extra,
});
const auditCount = async (type, id) =>
  Number(
    (
      await db.get(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type=? AND entity_id=?",
        [type, id],
      )
    ).n,
  );

before(async () => {
  db = await openDatabase();
  await seed(db);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port + "/api";
  cookies.admin = await login("admin@urbana.local");
  for (const name of ["gestor", "triagem", "campo", "fiscal", "consulta"])
    cookies[name] = await login(name + "@urbana.local");
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("intervention CRUD validates input, is idempotent by request_id and audits every mutation", async () => {
  for (const [body, code] of [
    [
      intervention({
        geometry: { type: "LineString", coordinates: [[-48.64, -26.99]] },
      }),
      "INVALID_GEOMETRY",
    ],
    [intervention({ geometry: undefined }), "INVALID_GEOMETRY"],
    [
      intervention({
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-48.6, -27],
              [-48.59, -26.99],
              [-48.59, -27],
              [-48.6, -26.99],
              [-48.6, -27],
            ],
          ],
        },
      }),
      "INVALID_GEOMETRY",
    ],
  ]) {
    const r = await request("/intervencoes", "POST", body);
    assert.equal(r.status, 400);
    assert.equal(r.data.code, code);
  }
  assert.equal(
    (
      await request(
        "/intervencoes",
        "POST",
        intervention({ planned_end: "2026-11-30" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/intervencoes",
        "POST",
        intervention({ planned_start: "2026-02-30" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/intervencoes",
        "POST",
        intervention({ sector_id: "team-1" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await request("/intervencoes", "POST", intervention({ scope: "OBRA" })))
      .status,
    400,
  );
  assert.equal(
    Number((await db.get("SELECT COUNT(*) AS n FROM interventions")).n),
    0,
  );

  const request_id = randomUUID();
  const created = await request(
    "/intervencoes",
    "POST",
    intervention({ request_id }),
  );
  assert.equal(created.status, 200);
  const it = created.data;
  assert.match(it.code, /^INT-\d{4}-00001$/);
  assert.equal(it.status, "PLANEJADA");
  assert.equal(it.version, 1);
  assert.deepEqual(it.geometry, street);
  assert.equal(it.geometry_type, "LineString");
  assert.deepEqual(
    [it.min_lng, it.min_lat, it.max_lng, it.max_lat],
    [-48.64, -26.99, -48.63, -26.99],
  );
  assert.deepEqual(it.allowed_transitions, ["EM_ANDAMENTO", "CANCELADA"]);
  assert.deepEqual(
    [it.occurrences, it.orders, it.conflicts, it.project],
    [[], [], [], null],
  );
  assert.equal(it.services[0].description, "Fresagem");
  assert.equal(it.history[0].event, "Intervenção cadastrada");
  const replay = await request(
    "/intervencoes",
    "POST",
    intervention({ request_id, title: "Outro título" }),
  );
  assert.equal(replay.data.id, it.id);
  assert.equal(replay.data.replayed, true);
  assert.equal(
    Number((await db.get("SELECT COUNT(*) AS n FROM interventions")).n),
    1,
  );
  const reused = await request("/obras", "POST", {
    title: "Obra",
    responsible: "X",
    planned_start: "2026-12-01",
    planned_end: "2026-12-31",
    request_id,
  });
  assert.deepEqual(
    [reused.status, reused.data.code],
    [409, "REQUEST_ID_REUSED"],
  );

  // PATCH: partial, versioned, audited with before/after of the changed fields only.
  const before = await auditCount("intervention", it.id);
  const patched = await request(`/intervencoes/${it.id}`, "PATCH", {
    version: 1,
    responsible: "Eng. Paulo",
    priority: "Média",
  });
  assert.equal(patched.status, 200);
  assert.deepEqual(
    [
      patched.data.version,
      patched.data.responsible,
      patched.data.priority,
      patched.data.title,
    ],
    [2, "Eng. Paulo", "Média", it.title],
  );
  assert.equal(await auditCount("intervention", it.id), before + 1);
  const log = await db.get(
    "SELECT * FROM audit_logs WHERE entity_id=? AND event='Intervenção alterada'",
    [it.id],
  );
  assert.deepEqual(JSON.parse(log.before_value), {
    responsible: "Eng. Marta Lima",
    priority: "Alta",
  });
  assert.deepEqual(JSON.parse(log.after_value), {
    responsible: "Eng. Paulo",
    priority: "Média",
  });
  assert.equal(
    (
      await request(`/intervencoes/${it.id}`, "PATCH", {
        version: 2,
        actual_start: "2026-11-01",
      })
    ).status,
    400,
    "real start only after starting",
  );
  assert.equal(
    (await request(`/intervencoes/${it.id}`, "PATCH", { version: 2 })).status,
    400,
    "empty patch",
  );
  assert.equal((await request("/intervencoes/nao-existe")).status, 404);
});

test("optimistic locking on edits, transitions and deletion", async () => {
  const it = (
    await request(
      "/intervencoes",
      "POST",
      intervention({
        geometry: square,
        scope: "AREA",
        planned_start: "2027-03-01",
        planned_end: "2027-03-05",
      }),
    )
  ).data;
  const missing = await request(`/intervencoes/${it.id}`, "PATCH", {
    title: "Sem versão",
  });
  assert.deepEqual(
    [missing.status, missing.data.code],
    [428, "VERSION_REQUIRED"],
  );
  assert.equal(
    (
      await request(`/intervencoes/${it.id}`, "PATCH", {
        version: "1",
        title: "Texto",
      })
    ).data.code,
    "INVALID_VERSION",
  );
  const results = await Promise.all([
    request(`/intervencoes/${it.id}`, "PATCH", {
      version: 1,
      title: "Primeira edição",
    }),
    request(`/intervencoes/${it.id}`, "PATCH", {
      version: 1,
      title: "Segunda edição",
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const conflict = results.find((r) => r.status === 409).data;
  assert.equal(conflict.code, "VERSION_CONFLICT");
  assert.equal(conflict.details.current_version, 2);
  assert.equal(
    (
      await request(`/intervencoes/${it.id}/transicao`, "POST", {
        version: 1,
        to: "EM_ANDAMENTO",
      })
    ).data.code,
    "VERSION_CONFLICT",
  );
  assert.equal(
    (await request(`/intervencoes/${it.id}`, "DELETE", { version: 1 })).data
      .code,
    "VERSION_CONFLICT",
  );
  assert.equal(
    (await request(`/intervencoes/${it.id}`, "DELETE", {})).data.code,
    "VERSION_REQUIRED",
  );
  const project = (
    await request("/obras", "POST", {
      title: "Obra versionada",
      responsible: "Eng. Ana",
      planned_start: "2027-01-01",
      planned_end: "2027-06-30",
    })
  ).data;
  assert.equal(
    (
      await request(`/obras/${project.id}`, "PATCH", {
        version: 9,
        title: "Nova",
      })
    ).data.code,
    "VERSION_CONFLICT",
  );
  assert.equal(
    (
      await request(`/obras/${project.id}/transicao`, "POST", {
        to: "EM_ANDAMENTO",
      })
    ).data.code,
    "VERSION_REQUIRED",
  );
  assert.equal(
    (await db.get("SELECT version FROM interventions WHERE id=?", [it.id]))
      .version,
    2,
  );
});

test("links are optional, never change occurrences or orders, and closing or deleting keeps them intact", async () => {
  const order = await db.get(
    "SELECT id,code FROM orders WHERE status='EM_EXECUCAO' LIMIT 1",
  );
  const occurrence = await db.get(
    "SELECT id,code FROM occurrences WHERE status='IDENTIFICADA' LIMIT 1",
  );
  const snapshot = async () => ({
    order: (
      await request(`/ordens-servico/${order.id}`, "GET", undefined, "admin")
    ).data,
    occurrence: (
      await request(`/ocorrencias/${occurrence.id}`, "GET", undefined, "admin")
    ).data,
    rows: [
      await db.get("SELECT * FROM orders WHERE id=?", [order.id]),
      await db.get("SELECT * FROM occurrences WHERE id=?", [occurrence.id]),
    ],
  });
  const initial = await snapshot();
  const it = (
    await request(
      "/intervencoes",
      "POST",
      intervention({
        planned_start: "2027-05-01",
        planned_end: "2027-05-10",
        geometry: { type: "Point", coordinates: [-48.7, -27.1] },
        scope: "ATIVO",
      }),
    )
  ).data;
  let detail = (
    await request(`/intervencoes/${it.id}/ocorrencias`, "POST", {
      occurrence_id: occurrence.id,
    })
  ).data;
  assert.deepEqual(
    detail.occurrences.map((o) => o.code),
    [occurrence.code],
  );
  detail = (
    await request(`/intervencoes/${it.id}/ordens-servico`, "POST", {
      order_id: order.id,
    })
  ).data;
  assert.deepEqual(
    detail.orders.map((o) => o.code),
    [order.code],
  );
  assert.equal(
    detail.version,
    it.version,
    "links do not edit the intervention",
  );
  assert.equal(
    (
      await request(`/intervencoes/${it.id}/ordens-servico`, "POST", {
        order_id: order.id,
      })
    ).data.code,
    "ALREADY_LINKED",
  );
  assert.equal(
    (
      await request(`/intervencoes/${it.id}/ordens-servico`, "POST", {
        order_id: "nao-existe",
      })
    ).status,
    404,
  );
  assert.equal(
    (await request(`/intervencoes/${it.id}/ocorrencias`, "POST", {})).status,
    400,
  );
  // The same order can belong to several interventions (N:N).
  const other = (
    await request(
      "/intervencoes",
      "POST",
      intervention({ planned_start: "2028-01-01", planned_end: "2028-01-02" }),
    )
  ).data;
  assert.equal(
    (
      await request(`/intervencoes/${other.id}/ordens-servico`, "POST", {
        order_id: order.id,
      })
    ).status,
    200,
  );
  assert.deepEqual(await snapshot(), initial);

  // Lifecycle: invalid jumps, reasons, real dates.
  let v = detail.version;
  const move = async (to, extra = {}) => {
    const r = await request(`/intervencoes/${it.id}/transicao`, "POST", {
      version: v,
      to,
      ...extra,
    });
    if (r.status === 200) v = r.data.version;
    return r;
  };
  assert.deepEqual(
    [(await move("CONCLUIDA")).status, (await move("CONCLUIDA")).data.code],
    [409, "INVALID_STATUS"],
  );
  assert.equal((await move("INEXISTENTE")).status, 400);
  const started = await move("EM_ANDAMENTO", { date: "2026-11-01" });
  assert.deepEqual(
    [
      started.status,
      started.data.status,
      started.data.actual_start,
      started.data.actual_end ?? null,
    ],
    [200, "EM_ANDAMENTO", "2026-11-01", null],
  );
  assert.deepEqual(started.data.allowed_transitions, [
    "PARALISADA",
    "CONCLUIDA",
    "CANCELADA",
  ]);
  assert.equal((await move("PARALISADA")).data.code, "REASON_REQUIRED");
  assert.equal(
    (await move("PARALISADA", { reason: "Chuva forte" })).data.pause_reason,
    "Chuva forte",
  );
  assert.equal(
    (await move("EM_ANDAMENTO")).data.actual_start,
    "2026-11-01",
    "resuming keeps the real start",
  );
  assert.equal(
    (await move("CONCLUIDA", { date: "2026-10-01" })).status,
    400,
    "end before start",
  );
  assert.equal(
    (await move("CONCLUIDA", { date: "2099-01-01" })).status,
    400,
    "future date",
  );
  const done = await move("CONCLUIDA", { date: "2026-11-05" });
  assert.equal(done.data.actual_end, "2026-11-05");
  assert.equal(
    (
      await request(
        `/intervencoes/${it.id}/ocorrencias/${occurrence.id}`,
        "DELETE",
      )
    ).data.code,
    "RECORD_CLOSED",
  );
  assert.equal((await move("EM_ANDAMENTO")).data.code, "REASON_REQUIRED");
  const reopened = await move("EM_ANDAMENTO", {
    reason: "Falha na sinalização",
  });
  assert.deepEqual(
    [reopened.data.actual_end ?? null, reopened.data.reopen_reason],
    [null, "Falha na sinalização"],
  );
  assert.equal(
    (await move("CANCELADA", { reason: "Projeto revisto" })).data.status,
    "CANCELADA",
  );
  assert.deepEqual(
    (await request(`/intervencoes/${it.id}`)).data.allowed_transitions,
    [],
  );
  assert.equal(
    (
      await request(`/intervencoes/${it.id}`, "PATCH", {
        version: v,
        title: "Nada",
      })
    ).data.code,
    "RECORD_CLOSED",
  );
  assert.equal(
    (
      await request(`/intervencoes/${it.id}/ocorrencias`, "POST", {
        occurrence_id: occurrence.id,
      })
    ).data.code,
    "RECORD_CLOSED",
  );
  assert.equal(
    (await request(`/intervencoes/${it.id}`, "DELETE", { version: v })).data
      .code,
    "INVALID_STATUS",
  );
  const events = (await request(`/intervencoes/${it.id}`)).data.history.map(
    (h) => h.event,
  );
  for (const e of [
    "Intervenção cadastrada",
    "Ocorrência vinculada",
    "Ordem de serviço vinculada",
    "Situação alterada: Planejada → Em andamento",
    "Situação alterada: Em andamento → Paralisada",
    "Situação alterada: Concluída → Em andamento",
    "Situação alterada: Em andamento → Cancelada",
  ])
    assert.ok(events.includes(e), e);
  assert.deepEqual(
    await snapshot(),
    initial,
    "cancelling the intervention leaves OS and occurrence untouched",
  );

  // Unlink and delete a planned intervention: links go away, the OS stays exactly the same.
  assert.equal(
    (
      await request(
        `/intervencoes/${other.id}/ordens-servico/${order.id}`,
        "DELETE",
      )
    ).data.orders.length,
    0,
  );
  assert.equal(
    (
      await request(
        `/intervencoes/${other.id}/ordens-servico/${order.id}`,
        "DELETE",
      )
    ).status,
    404,
  );
  await request(`/intervencoes/${other.id}/ordens-servico`, "POST", {
    order_id: order.id,
  });
  const removed = await request(`/intervencoes/${other.id}`, "DELETE", {
    version: other.version,
  });
  assert.deepEqual(removed, { status: 200, data: { ok: true } });
  assert.equal((await request(`/intervencoes/${other.id}`)).status, 404);
  assert.equal(
    Number(
      (
        await db.get(
          "SELECT COUNT(*) AS n FROM intervention_orders WHERE intervention_id=?",
          [other.id],
        )
      ).n,
    ),
    0,
  );
  const deletion = await db.get(
    "SELECT * FROM audit_logs WHERE entity_id=? AND event='Intervenção excluída'",
    [other.id],
  );
  assert.deepEqual(JSON.parse(deletion.before_value).order_ids, [order.id]);
  assert.deepEqual(await snapshot(), initial);
  // The OS still runs its own workflow while linked.
  const linked = (
    await request(
      "/intervencoes",
      "POST",
      intervention({ planned_start: "2028-02-01", planned_end: "2028-02-02" }),
    )
  ).data;
  await request(`/intervencoes/${linked.id}/ordens-servico`, "POST", {
    order_id: order.id,
  });
  const os = (
    await request(`/ordens-servico/${order.id}`, "GET", undefined, "admin")
  ).data;
  const completed = await request(
    `/ordens-servico/${order.id}/cancelar`,
    "POST",
    { version: os.version, reason: "Teste de independência" },
    "admin",
  );
  assert.equal(completed.data.status, "CANCELADA");
  assert.equal(
    (await request(`/intervencoes/${linked.id}`)).data.status,
    "PLANEJADA",
  );
});

test("spatial-temporal conflicts warn without blocking and can be evaluated", async () => {
  const period = { planned_start: "2029-04-01", planned_end: "2029-04-10" };
  const a = (
    await request(
      "/intervencoes",
      "POST",
      intervention({ ...period, title: "Drenagem da Rua A" }),
    )
  ).data;
  const b = await request(
    "/intervencoes",
    "POST",
    intervention({
      planned_start: "2029-04-10",
      planned_end: "2029-04-20",
      geometry: crossing,
      title: "Rede de água",
    }),
  );
  assert.equal(b.status, 200, "conflict is a warning, not a block");
  assert.deepEqual(
    b.data.conflicts.map((c) => [
      c.id,
      c.overlap_start,
      c.overlap_end,
      c.distance_m,
      c.review,
    ]),
    [[a.id, "2029-04-10", "2029-04-10", 0, null]],
  );
  // Same place, no temporal overlap: no conflict.
  const c = (
    await request(
      "/intervencoes",
      "POST",
      intervention({ planned_start: "2029-05-01", planned_end: "2029-05-02" }),
    )
  ).data;
  assert.deepEqual(c.conflicts, []);
  // Temporal overlap far away: no conflict. Near (within 15 m) counts.
  const far = (
    await request(
      "/intervencoes",
      "POST",
      intervention({
        ...period,
        geometry: { type: "Point", coordinates: [-48.5, -26.9] },
      }),
    )
  ).data;
  assert.deepEqual(far.conflicts, []);
  const near = (
    await request(
      "/intervencoes",
      "POST",
      intervention({
        ...period,
        geometry: { type: "Point", coordinates: [-48.6351, -26.9901] },
      }),
    )
  ).data;
  assert.deepEqual(
    near.conflicts.map((x) => x.id).sort(),
    [a.id, b.data.id].sort(),
  );
  // Unsaved geometry check (form) and per-record query.
  const check = await request("/intervencoes/conflitos", "POST", {
    geometry: crossing,
    ...period,
  });
  assert.deepEqual(
    check.data.conflicts.map((x) => x.id).sort(),
    [a.id, b.data.id, near.id].sort(),
  );
  assert.deepEqual(
    (
      await request("/intervencoes/conflitos", "POST", {
        geometry: crossing,
        ...period,
        exclude_id: b.data.id,
        tolerance_m: 0,
      })
    ).data.conflicts.map((x) => x.id),
    [a.id],
  );
  assert.equal(
    (
      await request("/intervencoes/conflitos", "POST", {
        geometry: { type: "Point" },
        ...period,
      })
    ).data.code,
    "INVALID_GEOMETRY",
  );
  assert.deepEqual(
    (await request(`/intervencoes/${a.id}/conflitos`)).data.conflicts
      .map((x) => x.id)
      .sort(),
    [b.data.id, near.id].sort(),
  );

  // Evaluation: recorded once per pair, visible on both sides, audited.
  assert.equal(
    (
      await request(
        `/intervencoes/${a.id}/conflitos/${c.id}/avaliacao`,
        "POST",
        { note: "Sem relação" },
      )
    ).data.code,
    "NO_CONFLICT",
  );
  assert.equal(
    (
      await request(
        `/intervencoes/${a.id}/conflitos/${b.data.id}/avaliacao`,
        "POST",
        { note: "" },
      )
    ).status,
    400,
  );
  const reviewed = await request(
    `/intervencoes/${b.data.id}/conflitos/${a.id}/avaliacao`,
    "POST",
    { note: "Equipes alinhadas: rede de água começa após a drenagem." },
  );
  assert.equal(
    reviewed.data.conflicts.find((x) => x.id === a.id).review.note,
    "Equipes alinhadas: rede de água começa após a drenagem.",
  );
  assert.equal(
    (await request(`/intervencoes/${a.id}`)).data.conflicts.find(
      (x) => x.id === b.data.id,
    ).review.user_name,
    "Carlos Oliveira",
  );
  assert.ok(
    (await request(`/intervencoes/${b.data.id}`)).data.history.some(
      (h) => h.event === "Conflito avaliado",
    ),
  );
  // Changing area or period discards the evaluation (it referred to the old shape).
  const moved = await request(`/intervencoes/${a.id}`, "PATCH", {
    version: a.version,
    planned_end: "2029-04-11",
  });
  assert.equal(
    moved.data.conflicts.find((x) => x.id === b.data.id).review,
    null,
  );
  assert.ok(
    moved.data.history.some((h) =>
      h.event.startsWith("Avaliações de conflito descartadas"),
    ),
  );
  // Cancelled interventions no longer conflict.
  await request(`/intervencoes/${near.id}/transicao`, "POST", {
    version: near.version,
    to: "CANCELADA",
    reason: "Duplicada",
  });
  assert.ok(
    !(await request(`/intervencoes/${a.id}/conflitos`)).data.conflicts.some(
      (x) => x.id === near.id,
    ),
  );
});

test("listing uses SQL filters, cursor pagination, bbox and a GeoJSON layer", async () => {
  const all = (await request("/intervencoes?limit=200")).data;
  assert.ok(all.items.length >= 5);
  assert.ok(
    all.items.every(
      (i) => i.geometry === undefined && typeof i.occurrence_count === "number",
    ),
  );
  const first = (await request("/intervencoes?limit=2")).data;
  assert.equal(first.items.length, 2);
  assert.equal(first.has_more, true);
  const second = (
    await request(`/intervencoes?limit=2&cursor=${first.next_cursor}`)
  ).data;
  assert.ok(!second.items.some((x) => first.items.some((y) => y.id === x.id)));
  assert.equal(
    (
      await request(
        `/intervencoes?limit=2&status=CANCELADA&cursor=${first.next_cursor}`,
      )
    ).status,
    400,
    "cursor bound to filters",
  );
  assert.ok(
    (await request("/intervencoes?status=CANCELADA")).data.items.every(
      (i) => i.status === "CANCELADA",
    ),
  );
  assert.ok(
    (
      await request("/intervencoes?status=PLANEJADA,EM_ANDAMENTO")
    ).data.items.every((i) => ["PLANEJADA", "EM_ANDAMENTO"].includes(i.status)),
  );
  assert.deepEqual(
    (await request("/intervencoes?q=rede%20de%20%C3%A1gua")).data.items.map(
      (i) => i.title,
    ),
    ["Rede de água"],
  );
  const april = (
    await request("/intervencoes?period_from=2029-04-05&period_to=2029-04-06")
  ).data.items;
  assert.ok(
    april.length >= 2 &&
      april.every(
        (i) => i.planned_start <= "2029-04-06" && i.planned_end >= "2029-04-05",
      ),
  );
  assert.equal(
    (await request("/intervencoes?period_from=2029-04-06&period_to=2029-04-05"))
      .status,
    400,
  );
  const inBox = (await request("/intervencoes?bbox=-48.665,-27.02,-48.65,-27"))
    .data.items;
  assert.ok(
    inBox.length >= 1 && inBox.every((i) => i.geometry_type === "Polygon"),
  );
  assert.deepEqual(
    (await request("/intervencoes?bbox=10,10,11,11")).data.items,
    [],
  );
  assert.equal((await request("/intervencoes?bbox=1,2,3")).status, 400);
  const layer = (
    await request(
      "/intervencoes/geojson?bbox=-48.645,-26.995,-48.625,-26.985&status=PLANEJADA",
    )
  ).data;
  assert.equal(layer.type, "FeatureCollection");
  assert.ok(layer.features.length >= 1);
  assert.ok(
    layer.features.every(
      (f) =>
        f.type === "Feature" &&
        f.geometry.type &&
        f.properties.status === "PLANEJADA" &&
        f.properties.code.startsWith("INT-"),
    ),
  );
});

test("works group interventions and OS, conclude only after their interventions, and never change the OS", async () => {
  const order = await db.get(
    "SELECT id,code FROM orders WHERE status='PROGRAMADA' LIMIT 1",
  );
  const before = (
    await request(`/ordens-servico/${order.id}`, "GET", undefined, "admin")
  ).data;
  assert.equal(
    (
      await request("/obras", "POST", {
        title: "Ob",
        responsible: "",
        planned_start: "2027-01-01",
        planned_end: "2027-01-02",
      })
    ).status,
    400,
  );
  const project = (
    await request("/obras", "POST", {
      title: "Requalificação do Centro",
      description: "Drenagem e pavimento",
      responsible: "Eng. Ana",
      planned_start: "2030-01-01",
      planned_end: "2030-12-31",
    })
  ).data;
  assert.match(project.code, /^OB-\d{4}-\d{5}$/);
  assert.deepEqual(
    [project.status, project.interventions, project.orders, project.extent],
    ["PLANEJADA", [], [], null],
  );
  const i1 = (
    await request(
      "/intervencoes",
      "POST",
      intervention({ planned_start: "2030-02-01", planned_end: "2030-02-10" }),
    )
  ).data;
  const i2 = (
    await request(
      "/intervencoes",
      "POST",
      intervention({
        planned_start: "2030-03-01",
        planned_end: "2030-03-10",
        geometry: square,
        scope: "AREA",
      }),
    )
  ).data;
  await request(`/obras/${project.id}/intervencoes`, "POST", {
    intervention_id: i1.id,
  });
  let p = (
    await request(`/obras/${project.id}/intervencoes`, "POST", {
      intervention_id: i2.id,
    })
  ).data;
  assert.deepEqual(
    p.interventions.map((i) => i.id),
    [i1.id, i2.id],
  );
  assert.deepEqual(p.extent, [-48.66, -27.01, -48.63, -26.99]);
  p = (
    await request(`/obras/${project.id}/ordens-servico`, "POST", {
      order_id: order.id,
    })
  ).data;
  assert.deepEqual(
    p.orders.map((o) => o.code),
    [order.code],
  );
  assert.equal(
    (await request(`/intervencoes/${i1.id}`)).data.project.code,
    project.code,
  );
  const second = (
    await request("/obras", "POST", {
      title: "Outra obra",
      responsible: "Eng. Bia",
      planned_start: "2030-01-01",
      planned_end: "2030-02-01",
    })
  ).data;
  const taken = await request(`/obras/${second.id}/intervencoes`, "POST", {
    intervention_id: i1.id,
  });
  assert.deepEqual(
    [taken.status, taken.data.code, taken.data.details.project_code],
    [409, "ALREADY_LINKED", project.code],
  );
  assert.equal(
    (
      await request(`/obras/${second.id}/ordens-servico`, "POST", {
        order_id: order.id,
      })
    ).data.code,
    "ALREADY_LINKED",
  );
  const list = (await request("/obras?q=centro")).data.items;
  assert.deepEqual(
    list.map((x) => [x.code, x.intervention_count, x.order_count]),
    [[project.code, 2, 1]],
  );
  assert.deepEqual(
    (await request(`/intervencoes?project_id=${project.id}`)).data.items
      .map((i) => i.id)
      .sort(),
    [i1.id, i2.id].sort(),
  );

  let v = p.version;
  const move = async (to, extra = {}) => {
    const r = await request(`/obras/${project.id}/transicao`, "POST", {
      version: v,
      to,
      ...extra,
    });
    if (r.status === 200) v = r.data.version;
    return r;
  };
  assert.equal(
    (await move("EM_ANDAMENTO", { date: "2026-11-02" })).data.actual_start,
    "2026-11-02",
  );
  const blocked = await move("CONCLUIDA");
  assert.deepEqual(
    [blocked.status, blocked.data.code, blocked.data.details.interventions],
    [409, "OPEN_INTERVENTIONS", [i1.code, i2.code].sort()],
  );
  assert.equal(
    await auditCount("project", project.id),
    5,
    "failed transition rolled back without audit",
  );
  await request(`/intervencoes/${i1.id}/transicao`, "POST", {
    version: i1.version,
    to: "CANCELADA",
    reason: "Incorporada à i2",
  });
  const s2 = (
    await request(`/intervencoes/${i2.id}/transicao`, "POST", {
      version: i2.version,
      to: "EM_ANDAMENTO",
      date: "2026-11-02",
    })
  ).data;
  await request(`/intervencoes/${i2.id}/transicao`, "POST", {
    version: s2.version,
    to: "CONCLUIDA",
  });
  const concluded = await move("CONCLUIDA");
  assert.deepEqual(
    [concluded.status, concluded.data.status],
    [200, "CONCLUIDA"],
  );
  assert.equal(
    (await request(`/obras/${project.id}/ordens-servico/${order.id}`, "DELETE"))
      .data.code,
    "RECORD_CLOSED",
  );
  assert.deepEqual(
    (await request(`/ordens-servico/${order.id}`, "GET", undefined, "admin"))
      .data,
    before,
    "OS untouched by the work lifecycle",
  );
  // Deleting a planned work ungroups its interventions without touching them.
  const i3 = (
    await request(
      "/intervencoes",
      "POST",
      intervention({ planned_start: "2031-01-01", planned_end: "2031-01-02" }),
    )
  ).data;
  await request(`/obras/${second.id}/intervencoes`, "POST", {
    intervention_id: i3.id,
  });
  assert.deepEqual(
    (
      await request(`/obras/${second.id}`, "DELETE", {
        version: second.version,
      })
    ).data,
    { ok: true },
  );
  const after = (await request(`/intervencoes/${i3.id}`)).data;
  assert.deepEqual(
    [after.project, after.version, after.status],
    [null, i3.version, "PLANEJADA"],
  );
  assert.ok(
    await db.get(
      "SELECT 1 AS ok FROM audit_logs WHERE entity_id=? AND event='Obra excluída'",
      [second.id],
    ),
  );
});

test("authorization by profile and by module; Equipe de Campo is not affected", async () => {
  const it = (
    await request(
      "/intervencoes",
      "POST",
      intervention({ planned_start: "2032-01-01", planned_end: "2032-01-02" }),
    )
  ).data;
  for (const who of ["fiscal", "consulta"]) {
    assert.equal(
      (await request("/intervencoes", "GET", undefined, who)).status,
      200,
      who,
    );
    assert.equal(
      (await request(`/intervencoes/${it.id}`, "GET", undefined, who)).status,
      200,
      who,
    );
    assert.equal(
      (await request("/obras", "GET", undefined, who)).status,
      200,
      who,
    );
    assert.equal(
      (await request(`/intervencoes/${it.id}/conflitos`, "GET", undefined, who))
        .status,
      200,
      who,
    );
    for (const [path, method, body] of [
      ["/intervencoes", "POST", intervention()],
      [
        `/intervencoes/${it.id}`,
        "PATCH",
        { version: it.version, title: "Fiscal" },
      ],
      [
        `/intervencoes/${it.id}/transicao`,
        "POST",
        { version: it.version, to: "EM_ANDAMENTO" },
      ],
      [`/intervencoes/${it.id}/ocorrencias`, "POST", { occurrence_id: "x" }],
      [`/intervencoes/${it.id}`, "DELETE", { version: it.version }],
      [
        "/intervencoes/conflitos",
        "POST",
        {
          geometry: street,
          planned_start: "2032-01-01",
          planned_end: "2032-01-02",
        },
      ],
      [
        "/obras",
        "POST",
        {
          title: "Obra",
          responsible: "X",
          planned_start: "2032-01-01",
          planned_end: "2032-01-02",
        },
      ],
    ])
      assert.equal(
        (await request(path, method, body, who)).status,
        403,
        `${who} ${method} ${path}`,
      );
  }
  for (const who of ["campo", "triagem"]) {
    assert.deepEqual(await request("/intervencoes", "GET", undefined, who), {
      status: 403,
      data: { error: "Módulo não autorizado." },
    });
    assert.equal(
      (await request("/obras/" + it.id, "GET", undefined, who)).status,
      403,
    );
    assert.equal(
      (await request("/intervencoes", "POST", intervention(), who)).status,
      403,
    );
  }
  const fieldBoot = (await request("/bootstrap", "GET", undefined, "campo"))
    .data;
  assert.deepEqual(fieldBoot.user.modules, ["field"]);
  assert.equal(
    (await request("/campo", "GET", undefined, "campo")).status,
    200,
  );
  assert.ok(
    (
      await request("/bootstrap", "GET", undefined, "admin")
    ).data.user.modules.includes("works"),
    "master receives the new module",
  );

  // Module revoked from the manager: area and API closed even with a management profile.
  const gestor = (
    await request("/users/gestor/permissions", "GET", undefined, "admin")
  ).data;
  const modules = gestor.modules.filter((m) => m !== "works");
  assert.equal(
    (
      await request(
        "/users/gestor",
        "PATCH",
        {
          name: gestor.user?.name || "Carlos Oliveira",
          email: "gestor@urbana.local",
          role: "Gestor",
          team_id: null,
          modules,
        },
        "admin",
      )
    ).status,
    200,
  );
  assert.equal((await request("/intervencoes", "GET")).status, 403);
  assert.equal(
    (
      await request(`/intervencoes/${it.id}/transicao`, "POST", {
        version: it.version,
        to: "EM_ANDAMENTO",
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/ordens-servico?limit=1")).status,
    200,
    "other modules keep working",
  );
  // A reader with only the works module can search occurrences/OS to see links, but not mutate them.
  await request(
    "/users/gestor",
    "PATCH",
    {
      name: "Carlos Oliveira",
      email: "gestor@urbana.local",
      role: "Gestor",
      team_id: null,
      modules: [...modules, "works"],
    },
    "admin",
  );
  assert.equal((await request("/intervencoes", "GET")).status, 200);
});

test("audit and rollback: a failure inside the write leaves no record, link, audit or request key", async () => {
  const run = db.run;
  const counts = async () => ({
    interventions: Number(
      (await db.get("SELECT COUNT(*) AS n FROM interventions")).n,
    ),
    audit: Number((await db.get("SELECT COUNT(*) AS n FROM audit_logs")).n),
    requests: Number(
      (await db.get("SELECT COUNT(*) AS n FROM client_requests")).n,
    ),
    links: Number(
      (await db.get("SELECT COUNT(*) AS n FROM intervention_occurrences")).n,
    ),
  });
  const initial = await counts();
  db.run = (sql, args) =>
    /^INSERT INTO audit_logs/.test(sql) &&
    String(args?.[4]).startsWith("Intervenção cadastrada")
      ? Promise.reject(new Error("falha simulada"))
      : run(sql, args);
  try {
    const r = await request(
      "/intervencoes",
      "POST",
      intervention({
        request_id: randomUUID(),
        planned_start: "2033-01-01",
        planned_end: "2033-01-02",
      }),
    );
    assert.equal(r.status, 500);
  } finally {
    db.run = run;
  }
  assert.deepEqual(await counts(), initial);
  const it = (
    await request(
      "/intervencoes",
      "POST",
      intervention({ planned_start: "2033-01-01", planned_end: "2033-01-02" }),
    )
  ).data;
  assert.match(it.code, /-0+\d+$/);
  const occurrence = await db.get("SELECT id FROM occurrences LIMIT 1");
  db.run = (sql, args) =>
    /^INSERT INTO audit_logs/.test(sql) && args?.[4] === "Ocorrência vinculada"
      ? Promise.reject(new Error("falha simulada"))
      : run(sql, args);
  try {
    assert.equal(
      (
        await request(`/intervencoes/${it.id}/ocorrencias`, "POST", {
          occurrence_id: occurrence.id,
        })
      ).status,
      500,
    );
  } finally {
    db.run = run;
  }
  const after = await counts();
  assert.equal(after.links, initial.links);
  assert.equal(
    after.audit,
    initial.audit + 1,
    "only the successful creation was audited",
  );
});

test("migration 12 applies on an existing database and grants the new module to nobody but the master", async () => {
  const folder = mkdtempSync(join(tmpdir(), "urbana-works-migration-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = folder;
  let legacy;
  try {
    legacy = await openDatabase();
    await seed(legacy);
    // Rebuild the state of an installation that stopped at migration 11, with users granted
    // before the "works" module existed.
    await legacy.run(
      "DELETE FROM user_module_permissions WHERE module='works'",
    );
    for (const table of [
      "intervention_conflict_reviews",
      "intervention_orders",
      "intervention_occurrences",
      "project_orders",
      "project_interventions",
      "interventions",
      "projects",
    ])
      await legacy.exec(`DROP TABLE ${table}`);
    await legacy.run("DELETE FROM schema_migrations WHERE version=12");
    const occurrences = Number(
      (await legacy.get("SELECT COUNT(*) AS n FROM occurrences")).n,
    );
    await legacy.close();
    legacy = await openDatabase();
    assert.deepEqual(
      (
        await legacy.all(
          "SELECT version FROM schema_migrations ORDER BY version",
        )
      ).map((r) => r.version),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    );
    assert.equal(
      Number((await legacy.get("SELECT COUNT(*) AS n FROM occurrences")).n),
      occurrences,
    );
    assert.equal(
      Number((await legacy.get("SELECT COUNT(*) AS n FROM interventions")).n),
      0,
    );
    assert.equal(
      Number(
        (
          await legacy.get(
            "SELECT COUNT(*) AS n FROM user_module_permissions WHERE module='works'",
          )
        ).n,
      ),
      0,
    );
    const users = await legacy.all("SELECT id,email,role FROM users");
    for (const user of users) {
      const modules = await userModules(legacy, user);
      assert.equal(
        modules.includes("works"),
        user.email === "admin@urbana.local",
        user.email,
      );
    }
    // Reopening applies nothing again.
    await legacy.close();
    legacy = await openDatabase();
    assert.equal(
      (await legacy.all("SELECT version FROM schema_migrations")).length,
      13,
    );
  } finally {
    if (legacy) await legacy.close();
    process.env.DATA_DIR = previous;
    rmSync(folder, { recursive: true, force: true });
  }
});

// Opt-in: same contracts on PostgreSQL/PostGIS (generated geom column, GiST index, bbox and
// conflict pre-filters through PostGIS) and migration 12 over an existing PostgreSQL database.
const pgUrl = process.env.URBANA_POSTGRES_TEST_URL;
test(
  "works on PostgreSQL/PostGIS: geometry column, bbox, conflicts, links, locking and migration",
  {
    skip:
      !pgUrl &&
      "URBANA_POSTGRES_TEST_URL ausente: homologação real não executada",
  },
  async () => {
    const { default: pg } = await import("pg");
    const schema = "urbana_works_" + randomUUID().replaceAll("-", "");
    const pool = new pg.Pool({ connectionString: pgUrl });
    const folder = mkdtempSync(join(tmpdir(), "urbana-works-pg-"));
    const original = {
      url: process.env.DATABASE_URL,
      dir: process.env.DATA_DIR,
    };
    let pdb, pserver;
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
      const connection = new URL(pgUrl);
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
      pdb = await openDatabase();
      await seed(pdb);
      assert.equal(pdb.dialect, "postgres");
      // Existing installation: drop what migration 12 created and the grants of the new module.
      await pdb.run("DELETE FROM user_module_permissions WHERE module='works'");
      await pdb.exec(
        "DROP TABLE intervention_conflict_reviews, intervention_orders, intervention_occurrences, project_orders, project_interventions, interventions, projects",
      );
      await pdb.run("DELETE FROM schema_migrations WHERE version=12");
      await pdb.close();
      pdb = await openDatabase();
      assert.equal(
        (await pdb.all("SELECT version FROM schema_migrations")).length,
        13,
      );
      assert.equal(
        Number(
          (
            await pdb.get(
              "SELECT COUNT(*) AS n FROM user_module_permissions WHERE module='works'",
            )
          ).n,
        ),
        0,
      );
      const indexes = (
        await pdb.all("SELECT indexname FROM pg_indexes WHERE schemaname=?", [
          schema,
        ])
      ).map((r) => r.indexname);
      assert.ok(
        indexes.includes("idx_interventions_geom") &&
          indexes.includes("idx_interventions_bbox"),
      );
      // Grant the module to the manager, as an administrator would.
      await pdb.run(
        "INSERT INTO user_module_permissions(user_id,module,allowed,created_at,updated_at) VALUES('gestor','works',1,?,?)",
        [new Date().toISOString(), new Date().toISOString()],
      );
      pserver = createApp(pdb).listen(0, "127.0.0.1");
      await new Promise((r) => pserver.once("listening", r));
      const pbase = `http://127.0.0.1:${pserver.address().port}/api`;
      const cookie = await (async () => {
        const r = await fetch(pbase + "/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "gestor@urbana.local",
            password: "Testing@2026",
          }),
        });
        return r.headers.get("set-cookie").split(";")[0];
      })();
      const call = async (path, method = "GET", body) => {
        const r = await fetch(pbase + path, {
          method,
          headers: {
            cookie,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.status, data: await r.json() };
      };
      const a = (await call("/intervencoes", "POST", intervention())).data;
      assert.match(a.code, /^INT-/);
      const geom = await pdb.get(
        "SELECT ST_GeometryType(geom) AS t, ST_SRID(geom) AS srid FROM interventions WHERE id=?",
        [a.id],
      );
      assert.deepEqual(geom, { t: "ST_LineString", srid: 4326 });
      const b = (
        await call(
          "/intervencoes",
          "POST",
          intervention({
            geometry: crossing,
            planned_start: "2026-12-05",
            planned_end: "2026-12-20",
          }),
        )
      ).data;
      assert.deepEqual(
        b.conflicts.map((c) => c.id),
        [a.id],
      );
      const poly = (
        await call(
          "/intervencoes",
          "POST",
          intervention({ geometry: square, scope: "AREA" }),
        )
      ).data;
      const multi = (
        await call(
          "/intervencoes",
          "POST",
          intervention({
            geometry: {
              type: "MultiLineString",
              coordinates: [street.coordinates, crossing.coordinates],
            },
            planned_start: "2027-01-01",
            planned_end: "2027-01-02",
          }),
        )
      ).data;
      assert.equal(
        (
          await pdb.get(
            "SELECT ST_GeometryType(geom) AS t FROM interventions WHERE id=?",
            [multi.id],
          )
        ).t,
        "ST_MultiLineString",
      );
      assert.deepEqual(
        (
          await call("/intervencoes?bbox=-48.665,-27.02,-48.65,-27")
        ).data.items.map((i) => i.id),
        [poly.id],
      );
      assert.ok(
        (
          await call(
            "/intervencoes/geojson?bbox=-48.645,-26.995,-48.625,-26.985",
          )
        ).data.features.every((f) => [a.id, b.id, multi.id].includes(f.id)),
      );
      const order = await pdb.get("SELECT * FROM orders LIMIT 1");
      await call(`/intervencoes/${a.id}/ordens-servico`, "POST", {
        order_id: order.id,
      });
      const race = await Promise.all([
        call(`/intervencoes/${a.id}`, "PATCH", {
          version: 1,
          title: "Edição A",
        }),
        call(`/intervencoes/${a.id}`, "PATCH", {
          version: 1,
          title: "Edição B",
        }),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
      const project = (
        await call("/obras", "POST", {
          title: "Obra PG",
          responsible: "Eng.",
          planned_start: "2026-12-01",
          planned_end: "2027-12-01",
        })
      ).data;
      await call(`/obras/${project.id}/intervencoes`, "POST", {
        intervention_id: a.id,
      });
      const started = (
        await call(`/obras/${project.id}/transicao`, "POST", {
          version: project.version,
          to: "EM_ANDAMENTO",
        })
      ).data;
      assert.equal(
        (
          await call(`/obras/${project.id}/transicao`, "POST", {
            version: started.version,
            to: "CONCLUIDA",
          })
        ).data.code,
        "OPEN_INTERVENTIONS",
      );
      assert.deepEqual(
        await pdb.get("SELECT * FROM orders WHERE id=?", [order.id]),
        order,
      );
      assert.deepEqual(
        (
          await call(`/intervencoes/${multi.id}`, "DELETE", {
            version: multi.version,
          })
        ).data,
        { ok: true },
      );
    } finally {
      if (pserver) await new Promise((r) => pserver.close(r));
      if (pdb) await pdb.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
      if (original.url === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original.url;
      process.env.DATA_DIR = original.dir;
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
