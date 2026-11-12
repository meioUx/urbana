// Regression guard for T7 (broad queries) and R4 (contract changes): the endpoints whose reads were
// narrowed or batched must answer exactly what the previous whole-table implementations answered.
// The previous algorithms are kept below as reference implementations ("legacy*") and run against
// the same deterministic data. Where R4 changed a contract on purpose (open plans only, closed plans
// paginated, /api/campo for management limited to open orders, dashboard with aggregates only,
// board cards), the reference is the previous answer with the documented cut applied, and the
// dashboard indicators are recomputed exactly as the interface used to compute them from the full
// lists (OperationsDashboard, menu badge, triage queues, team cards and material consumption).
import "./support/same-origin-fetch.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { openDatabase } from "../server/db.js";
import { seed } from "../server/seed.js";
import { createApp } from "../server/app.js";
import {
  canAccessOrder,
  distance,
  hashPassword,
  unpack,
} from "../server/domain.js";
import { initializeModules } from "../server/user-permissions.js";
import { kanbanService } from "../server/kanban.js";
import { groupStreets } from "../server/planning.js";
import { contactChannel, serviceCode } from "../server/sector-control.js";
import {
  buildKanbanCards,
  cardKey,
  closedStatus,
  flowMetrics,
  sortKanbanCards,
} from "../shared/kanban.mjs";

const PASSWORD = "Urbana@2026";

// ---- Deterministic fixture -------------------------------------------------------------------
async function populate(db, { ties }) {
  const stamp = (minutes) =>
    new Date(
      Date.parse("2026-03-01T08:00:00.000Z") + minutes * 60000,
    ).toISOString();
  const hash = hashPassword(PASSWORD);
  await db.run("INSERT INTO users VALUES(?,?,?,?,?,?)", [
    "op-a",
    "Operador A",
    "op-a@urbana.local",
    hash,
    "Equipe de Campo",
    "team-1",
  ]);
  await db.run("INSERT INTO users VALUES(?,?,?,?,?,?)", [
    "op-b",
    "Operador B",
    "op-b@urbana.local",
    hash,
    "Equipe de Campo",
    "team-2",
  ]);
  await initializeModules(db);
  const statuses = [
    "IDENTIFICADA",
    "EM_TRIAGEM",
    "PROGRAMADA",
    "EM_EXECUCAO",
    "AGUARDANDO_VALIDACAO",
    "CONCLUIDA",
    "CANCELADA",
    "RECUSADA",
    "CONCLUIDA",
    "IDENTIFICADA",
  ];
  const categories = [
    ["category-1", "sector-1", "Buraco"],
    ["category-2", "sector-2", "Boca de lobo"],
    ["category-3", "sector-2", "Poda"],
  ];
  const streets = [
    "Rua Brasil",
    "Av. União",
    "Rua 1500",
    "Rua Itália",
    "Av. Atlântica",
    "Rua 3100",
  ];
  const hoods = ["Centro", "Nações", "Municípios", "Barra Sul"];
  const creators = ["admin", "campo", "op-a", "gestor", "triagem"];
  const rows = [];
  let minutes = 0;
  for (let i = 0; i < 240; i++) {
    const [category, sector, sub] = categories[i % 3];
    minutes = ties && i % 9 === 4 ? minutes : minutes + 97 + (i % 13) * 41; // repeated created_at
    const same = i % 10 === 3 && rows.length; // identical coordinates
    const lat = same ? rows.at(-1).lat : -27 + ((i * 37) % 100) / 10000;
    const lng = same ? rows.at(-1).lng : -48.63 + ((i * 53) % 100) / 10000;
    const row = {
      id: `q-occ-${String(i).padStart(3, "0")}-${(i * 7919) % 97}`,
      status: statuses[(i * 3) % 10],
      sector,
      lat,
      lng,
      created: stamp(minutes),
    };
    rows.push(row);
    await db.run(
      "INSERT INTO occurrences(id,code,category_id,sector_id,status,priority,lat,lng,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [
        row.id,
        `OC-Q-${String(i).padStart(4, "0")}`,
        category,
        sector,
        row.status,
        ["Emergencial", "Alta", "Média", "Baixa", "Programada"][i % 5],
        lat,
        lng,
        row.created,
        row.created,
        JSON.stringify({
          address: `${streets[i % 6]}, ${100 + i}`,
          neighborhood: hoods[i % 4],
          description: `Demanda ${i}`,
          subcategory: sub,
          origin: ["WhatsApp", "Ouvidoria 9", "Fiscalização municipal"][i % 3],
          requested_by: i % 4 ? "" : "Ouvidoria 77",
          creator_id: creators[i % 5],
        }),
      ],
    );
  }
  // Plans before orders, so orders can carry plan_id as POST /ordens-servico does.
  const planOf = new Map();
  for (let i = 0, p = 0; i + 3 < rows.length; i += 11, p++) {
    const id = `q-plan-${p}`;
    await db.run(
      "INSERT INTO action_plans(id,code,created_at,data) VALUES(?,?,?,?)",
      [
        id,
        `PA-Q-${p}`,
        ties && p % 4 === 1 ? stamp(p * 300 - 300) : stamp(p * 300),
        JSON.stringify({
          objective: "Plano de teste",
          responsible: "Gestor",
          scheduled_at: "2026-03-10",
          street: "Rua",
          neighborhood: "Centro",
          priority: "Alta",
          sector_id: rows[i].sector,
        }),
      ],
    );
    for (const member of rows.slice(i, i + 2 + (p % 2))) {
      planOf.set(member.id, id);
      await db.run(
        "INSERT INTO action_plan_occurrences(plan_id,occurrence_id) VALUES(?,?)",
        [id, member.id],
      );
    }
  }
  // Closed plans (every member CONCLUIDA, CANCELADA or RECUSADA), enough for several pages (R4).
  const closedRows = rows.filter(
    (r) =>
      !planOf.has(r.id) &&
      ["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(r.status),
  );
  for (let p = 0; p < 8; p++) {
    const id = `q-plan-closed-${p}`;
    await db.run(
      "INSERT INTO action_plans(id,code,created_at,data) VALUES(?,?,?,?)",
      [
        id,
        `PA-Q-C${p}`,
        ties && p % 3 === 1
          ? stamp(4000 + (p - 1) * 200)
          : stamp(4000 + p * 200),
        JSON.stringify({
          objective: p % 2 ? "Plano encerrado" : "Plano histórico",
          responsible: "Gestor",
          scheduled_at: "2026-02-10",
          street: "Rua",
          neighborhood: "Centro",
          priority: "Baixa",
          sector_id: closedRows[p * 2].sector,
        }),
      ],
    );
    for (const member of closedRows.slice(p * 2, p * 2 + 2)) {
      planOf.set(member.id, id);
      await db.run(
        "INSERT INTO action_plan_occurrences(plan_id,occurrence_id) VALUES(?,?)",
        [id, member.id],
      );
    }
  }
  const ordered = new Set([
    "PROGRAMADA",
    "EM_EXECUCAO",
    "AGUARDANDO_VALIDACAO",
    "CONCLUIDA",
    "CANCELADA",
  ]);
  let o = 0;
  const addOrder = async (members, status, offset) => {
    const id = `q-ord-${String(o).padStart(3, "0")}`;
    const team =
      members[0].sector === "sector-1"
        ? o % 2
          ? "team-1"
          : "team-2"
        : "team-3";
    const created = new Date(
      Date.parse(members[0].created) + offset * 60000,
    ).toISOString();
    const updated =
      ties && o % 6 === 2
        ? created
        : new Date(Date.parse(created) + (o % 17) * 3600000).toISOString();
    const data = {
      scheduled_at: created.slice(0, 10),
      responsible: `Responsável ${o % 3}`,
      notes: o % 4 ? "" : "Nota",
      assigned_user_id:
        team === "team-1" && o % 3 === 0
          ? "op-a"
          : team === "team-1" && o % 3 === 1
            ? "campo"
            : null,
      plan_id: planOf.get(members[0].id) || null,
      completed_at: status === "CONCLUIDA" ? updated : null,
    };
    await db.run(
      "INSERT INTO orders(id,code,sector_id,team_id,status,priority,due_at,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        `OS-Q-${String(o).padStart(4, "0")}`,
        members[0].sector,
        team,
        status,
        "Alta",
        new Date(Date.parse(created) + 48 * 3600000).toISOString(),
        created,
        updated,
        JSON.stringify(data),
      ],
    );
    for (const m of members)
      await db.run("INSERT INTO order_occurrences VALUES(?,?)", [id, m.id]);
    if (o % 3 === 0) {
      await db.run(
        "INSERT INTO consumption(id,order_id,material_id,quantity,unit_cost,created_at) VALUES(?,?,?,?,?,?)",
        [`q-cs-${o}`, id, "material-1", 1 + (o % 5), 0.85, updated],
      );
      await db.run(
        "INSERT INTO inventory_movements(id,material_id,order_id,invoice_id,type,quantity,unit_cost,stage,notes,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [
          `q-mv-${o}`,
          "material-1",
          id,
          null,
          "saida",
          1 + (o % 4),
          1.25,
          ["execucao", "triagem"][o % 2],
          "Consumo",
          "admin",
          updated,
        ],
      );
    }
    o++;
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!ordered.has(row.status)) continue;
    // Some occurrences were reprogrammed: an older cancelled order plus the current one.
    if (i % 7 === 0) await addOrder([row], "CANCELADA", 30);
    const next = rows[i + 1];
    const pair =
      i % 5 === 0 &&
      next &&
      next.sector === row.sector &&
      ordered.has(next.status);
    await addOrder(pair ? [row, next] : [row], row.status, 60 + (i % 4) * 600);
    if (pair) i++;
  }
  await db.run(
    "INSERT INTO settings(id,value) VALUES('kanban',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    [JSON.stringify({ revision: 3, limits: { EM_EXECUCAO: 500 }, order: {} })],
  );
  return rows;
}

// Recent rows around "now" for the dashboard trend and the board window (R4): created and completed
// at varied hours, including near local midnight, some without neighborhood.
async function populateRecent(db) {
  const time = Date.now();
  for (let k = 0; k < 130; k++) {
    const created = new Date(
      time - k * 17 * 3600000 - (k % 4) * 23 * 60000,
    ).toISOString();
    const id = `q-recent-${String(k).padStart(3, "0")}`;
    const status = [
      "IDENTIFICADA",
      "EM_TRIAGEM",
      "CONCLUIDA",
      "EM_EXECUCAO",
      "RECUSADA",
      "DEVOLVIDA",
    ][k % 6];
    const neighborhood =
      k % 3 === 0 ? "" : ["Centro", "Nações", "Barra Sul", "Pioneiros"][k % 4];
    await db.run(
      "INSERT INTO occurrences(id,code,category_id,sector_id,status,priority,lat,lng,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        `OC-R-${k}`,
        "category-1",
        "sector-1",
        status,
        ["Emergencial", "Alta", "Média", "Baixa", "Programada"][k % 5],
        -27.01,
        -48.62,
        created,
        created,
        JSON.stringify({
          address: `Rua Recente, ${k}`,
          ...(k % 13 === 0 ? {} : { neighborhood }),
          description: `Recente ${k}`,
          subcategory: "Buraco",
          origin: "WhatsApp",
          creator_id: "gestor",
        }),
      ],
    );
    if (["CONCLUIDA", "EM_EXECUCAO", "DEVOLVIDA"].includes(status)) {
      const completed =
        status === "CONCLUIDA"
          ? new Date(time - k * 11 * 3600000 - 7 * 60000).toISOString()
          : null;
      const due = new Date(
        time + (k % 3 === 0 ? -1 : 1) * (5 + k) * 3600000,
      ).toISOString();
      await db.run(
        "INSERT INTO orders(id,code,sector_id,team_id,status,priority,due_at,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
          `q-recent-ord-${k}`,
          `OS-R-${k}`,
          "sector-1",
          k % 2 ? "team-1" : "team-2",
          status === "EM_EXECUCAO" && k % 4 === 3 ? "EM_DESLOCAMENTO" : status,
          "Alta",
          due,
          created,
          completed || created,
          JSON.stringify({
            scheduled_at: created.slice(0, 10),
            responsible: "Responsável R",
            notes: "",
            assigned_user_id: null,
            plan_id: null,
            completed_at: completed,
            ...(status === "DEVOLVIDA" ? { return_reason: "Sem acesso" } : {}),
          }),
        ],
      );
      await db.run("INSERT INTO order_occurrences VALUES(?,?)", [
        `q-recent-ord-${k}`,
        id,
      ]);
      await db.run(
        "INSERT INTO consumption(id,order_id,material_id,quantity,unit_cost,created_at) VALUES(?,?,?,?,?,?)",
        [
          `q-recent-cs-${k}`,
          `q-recent-ord-${k}`,
          k % 2 ? "material-2" : "material-1",
          1 + (k % 3),
          2.5,
          created,
        ],
      );
    }
  }
}

// ---- Previous implementations (reference) -----------------------------------------------------
async function legacyPlanning(db, user) {
  const occurrences = (
    await db.all("SELECT * FROM occurrences ORDER BY created_at")
  ).map(unpack);
  const links = await db.all("SELECT * FROM action_plan_occurrences");
  const planRows = (
    await db.all("SELECT * FROM action_plans ORDER BY created_at DESC")
  ).map(unpack);
  const orders = (
    await db.all("SELECT * FROM orders ORDER BY created_at DESC")
  ).map(unpack);
  const orderLinks = await db.all("SELECT * FROM order_occurrences");
  const plans = planRows.map((p) => {
    const members = occurrences.filter((o) =>
      links.some((l) => l.plan_id === p.id && l.occurrence_id === o.id),
    );
    const completed = members.filter((o) => o.status === "CONCLUIDA").length;
    const cancelled = members.filter((o) => o.status === "CANCELADA").length;
    const rejected = members.filter((o) => o.status === "RECUSADA").length;
    const status =
      completed === members.length
        ? "Concluído"
        : completed + cancelled + rejected === members.length
          ? rejected
            ? "Encerrado com recusas"
            : "Encerrado com cancelamentos"
          : members.some((o) =>
                [
                  "EM_DESLOCAMENTO",
                  "EM_EXECUCAO",
                  "AGUARDANDO_VALIDACAO",
                ].includes(o.status),
              )
            ? "Em execução"
            : "Planejado";
    return {
      ...p,
      occurrences: members.map((o) => ({
        ...o,
        order_ids: orderLinks
          .filter((l) => l.occurrence_id === o.id)
          .map((l) => l.order_id),
      })),
      completed,
      cancelled,
      rejected,
      status,
      orders: orders.filter(
        (o) =>
          (o.plan_id === p.id ||
            orderLinks.some(
              (l) =>
                l.order_id === o.id &&
                members.some((m) => m.id === l.occurrence_id),
            )) &&
          canAccessOrder(user, o),
      ),
    };
  });
  return {
    groups: groupStreets(occurrences).map((g) => ({
      ...g,
      occurrences: g.occurrences.map((o) => ({
        ...o,
        order_ids: orderLinks
          .filter((l) => l.occurrence_id === o.id)
          .map((l) => l.order_id),
        plan_id: links.find((l) => l.occurrence_id === o.id)?.plan_id || null,
      })),
    })),
    plans,
  };
}
async function legacyField(db, user) {
  const occurrences = (
    await db.all("SELECT * FROM occurrences ORDER BY created_at DESC")
  ).map(unpack);
  const links = await db.all("SELECT * FROM order_occurrences");
  const orders = (await db.all("SELECT * FROM orders ORDER BY updated_at DESC"))
    .map(unpack)
    .filter((o) => canAccessOrder(user, o))
    .map((o) => ({
      ...o,
      occurrences: occurrences.filter((c) =>
        links.some((l) => l.order_id === o.id && l.occurrence_id === c.id),
      ),
    }));
  return {
    orders,
    records: occurrences.filter((o) => o.creator_id === user.id),
  };
}
async function legacySectorControl(db, month, sectorId) {
  const orders = (await db.all("SELECT * FROM orders ORDER BY created_at"))
    .map(unpack)
    .filter((order) => !sectorId || order.sector_id === sectorId);
  const categories = new Map(
    (await db.all("SELECT * FROM catalogs WHERE kind='categorias'"))
      .map(unpack)
      .map((c) => [c.id, c]),
  );
  const rows = [];
  for (const order of orders) {
    const occurrences = (
      await db.all(
        "SELECT c.* FROM occurrences c JOIN order_occurrences r ON r.occurrence_id=c.id WHERE r.order_id=? ORDER BY c.created_at",
        [order.id],
      )
    ).map(unpack);
    const primary = occurrences[0] || {};
    const entryDate = primary.created_at || order.created_at;
    if (entryDate.slice(0, 7) !== month) continue;
    const classification = serviceCode(
      primary,
      categories.get(primary.category_id),
    );
    rows.push({
      id: order.id,
      entry_date: entryDate,
      service_code: classification.code,
      service_label: classification.label,
      service_quantity: occurrences.length,
      order_number: order.code,
      requester: primary.requested_by || primary.origin || "—",
      address: occurrences
        .map((item) => item.address)
        .filter(Boolean)
        .join("; "),
      description:
        order.notes ||
        occurrences
          .map((item) => item.description)
          .filter(Boolean)
          .join("; "),
      contact: contactChannel(primary),
      contact_quantity: 1,
      responsible: order.responsible,
      team_id: order.team_id,
      sector_id: order.sector_id,
      completion_date: order.completed_at || null,
      completed: order.status === "CONCLUIDA" ? 1 : 0,
      status: order.status,
    });
  }
  return rows;
}
async function legacyDashboardCosts(db, user) {
  const orders = (await db.all("SELECT * FROM orders"))
    .map(unpack)
    .filter((o) => canAccessOrder(user, o));
  const mats = (await db.all("SELECT * FROM consumption")).filter((m) =>
    orders.some((o) => o.id === m.order_id),
  );
  const stockCosts = (
    await db.all(
      "SELECT * FROM inventory_movements WHERE type='saida' AND order_id IS NOT NULL",
    )
  ).filter((item) => orders.some((o) => o.id === item.order_id));
  return {
    materials: mats,
    actual_cost: stockCosts.reduce(
      (sum, item) => sum + item.quantity * item.unit_cost,
      0,
    ),
    cost: mats.reduce((s, m) => s + m.quantity * m.unit_cost, 0),
  };
}
async function legacyNearby(db, point, radius) {
  return (await db.all("SELECT * FROM occurrences"))
    .map(unpack)
    .map((o) => ({ ...o, distance: distance(point, o) }))
    .filter(
      (o) =>
        o.distance <= radius && !["CANCELADA", "RECUSADA"].includes(o.status),
    )
    .sort((a, b) => a.distance - b.distance);
}
async function legacyKanbanCounts(db) {
  const cards = [
    ...(await db.all(
      "SELECT id,status FROM occurrences WHERE NOT EXISTS (SELECT 1 FROM order_occurrences r WHERE r.occurrence_id=occurrences.id)",
    )),
    ...(await db.all("SELECT id,status FROM orders")),
  ];
  return cards.reduce(
    (result, card) => (
      (result[card.status] = (result[card.status] || 0) + 1),
      result
    ),
    {},
  );
}

// ---- Previous interface computations (R4 reference) -------------------------------------------
const CLOSED_PLAN = [
  "Concluído",
  "Encerrado com cancelamentos",
  "Encerrado com recusas",
];
const closed = (status) =>
  ["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(status);
const byRecent = (a, b) =>
  a.created_at < b.created_at
    ? 1
    : a.created_at > b.created_at
      ? -1
      : a.id < b.id
        ? 1
        : a.id > b.id
          ? -1
          : 0;
// OperationsDashboard, menu badge, triage queues, team cards and material consumption as they were
// computed in the browser from GET /ocorrencias, GET /ordens-servico and the old dashboard
// "materials" list. `localDay` emulates the browser time zone `tz`.
function legacyIndicators({
  rows,
  orders,
  materials,
  catalogs,
  priorities,
  tz,
  time,
}) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDay = (value) => day.format(new Date(value));
  const activeRows = rows.filter((r) => !closed(r.status));
  const openOrders = orders.filter((o) => !closed(o.status));
  const running = openOrders.filter((o) =>
    ["EM_EXECUCAO", "EM_DESLOCAMENTO"].includes(o.status),
  );
  const teams = catalogs.filter((c) => c.kind === "equipes");
  const [y, m, d] = localDay(time).split("-").map(Number);
  const trend = Array.from({ length: 90 }, (_, index) => {
    const key = new Date(Date.UTC(y, m - 1, d - 90 + 1 + index))
      .toISOString()
      .slice(0, 10);
    return {
      day: key,
      incoming: rows.filter(
        (r) => r.created_at && localDay(r.created_at) === key,
      ).length,
      completed: orders.filter(
        (o) =>
          o.status === "CONCLUIDA" &&
          o.completed_at &&
          localDay(o.completed_at) === key,
      ).length,
    };
  });
  return {
    open: activeRows.length,
    emergency: activeRows.filter((r) => r.priority === "Emergencial").length,
    open_orders: openOrders.length,
    triage: rows.filter((r) =>
      ["IDENTIFICADA", "EM_TRIAGEM"].includes(r.status),
    ).length,
    busy_teams: new Set(running.map((o) => o.team_id)).size,
    overdue: openOrders.filter((o) => Date.parse(o.due_at) < time).length,
    validation: orders.filter((o) => o.status === "AGUARDANDO_VALIDACAO")
      .length,
    completed: orders.filter((o) => o.status === "CONCLUIDA").length,
    trend,
    priorities: priorities.map((label) => ({
      label,
      value: activeRows.filter((r) => r.priority === label).length,
    })),
    neighborhoods: Object.entries(
      activeRows.reduce((sum, r) => {
        const label = r.neighborhood || "Não informado";
        sum[label] = (sum[label] || 0) + 1;
        return sum;
      }, {}),
    )
      .map(([label, value]) => ({ label, value: Number(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
    statuses: [
      "PROGRAMADA",
      "EM_DESLOCAMENTO",
      "EM_EXECUCAO",
      "AGUARDANDO_VALIDACAO",
      "DEVOLVIDA",
    ].map((status) => ({
      status,
      value: openOrders.filter((o) => o.status === status).length,
    })),
    team_load: teams.map((t) => ({
      id: t.id,
      value: openOrders.filter((o) => o.team_id === t.id).length,
    })),
    team_cards: teams.map((t) => ({
      id: t.id,
      active: orders.filter((o) => o.team_id === t.id && !closed(o.status))
        .length,
      done: orders.filter((o) => o.team_id === t.id && o.status === "CONCLUIDA")
        .length,
    })),
    materials: catalogs
      .filter((c) => c.kind === "materiais")
      .map((mat) => ({
        id: mat.id,
        value: materials
          .filter((x) => x.material_id === mat.id)
          .reduce((s, x) => s + x.quantity, 0),
      })),
    queues: [
      ["IDENTIFICADA"],
      ["EM_TRIAGEM"],
      ["IDENTIFICADA", "EM_TRIAGEM"],
    ].map((set) => rows.filter((r) => set.includes(r.status)).length),
    map_neighborhoods: [
      ...new Set(rows.map((r) => r.neighborhood).filter(Boolean)),
    ].sort(),
  };
}
// The same indicators read from the new aggregate endpoints.
function newIndicators({
  dashboard,
  occurrenceSummary,
  orderSummary,
  catalogs,
  priorities,
}) {
  const teams = catalogs.filter((c) => c.kind === "equipes");
  const status = occurrenceSummary.by_status;
  return {
    open: dashboard.open,
    emergency: dashboard.emergency,
    open_orders: dashboard.open_orders,
    triage: dashboard.triage,
    busy_teams: dashboard.busy_teams,
    overdue: dashboard.overdue,
    validation: dashboard.orders_by_status.AGUARDANDO_VALIDACAO || 0,
    completed: dashboard.orders_by_status.CONCLUIDA || 0,
    trend: dashboard.trend,
    priorities: priorities.map((label) => ({
      label,
      value: dashboard.open_by_priority[label] || 0,
    })),
    neighborhoods: dashboard.open_by_neighborhood.map((n) => ({
      label: n.name,
      value: n.value,
    })),
    statuses: [
      "PROGRAMADA",
      "EM_DESLOCAMENTO",
      "EM_EXECUCAO",
      "AGUARDANDO_VALIDACAO",
      "DEVOLVIDA",
    ].map((s) => ({ status: s, value: dashboard.orders_by_status[s] || 0 })),
    team_load: teams.map((t) => ({
      id: t.id,
      value: dashboard.open_orders_by_team[t.id] || 0,
    })),
    team_cards: teams.map((t) => {
      const counts = orderSummary.by_team[t.id] || {};
      return {
        id: t.id,
        active: Object.entries(counts)
          .filter(([s]) => !closed(s))
          .reduce((n, [, v]) => n + v, 0),
        done: counts.CONCLUIDA || 0,
      };
    }),
    materials: catalogs
      .filter((c) => c.kind === "materiais")
      .map((mat) => ({
        id: mat.id,
        value: dashboard.consumption_by_material[mat.id] || 0,
      })),
    queues: [
      status.IDENTIFICADA || 0,
      status.EM_TRIAGEM || 0,
      (status.IDENTIFICADA || 0) + (status.EM_TRIAGEM || 0),
    ],
    map_neighborhoods: occurrenceSummary.neighborhoods,
  };
}
// Board card fields the interface reads (card, filters, sorting, WIP, team load, move dialog).
const CARD_FIELDS = [
  "type",
  "id",
  "code",
  "status",
  "priority",
  "sector_id",
  "team_id",
  "created_at",
  "due_at",
  "scheduled_at",
  "completed_at",
  "responsible",
  "return_reason",
  "rejection_reason",
  "version",
  "assigned_user_id",
  "category_id",
  "subcategory",
  "occurrence_ids",
];
const OCCURRENCE_FIELDS = [
  "id",
  "code",
  "address",
  "neighborhood",
  "description",
  "category_id",
  "subcategory",
];
const pick = (row, fields) =>
  Object.fromEntries(
    fields
      .filter((f) => row[f] !== null && row[f] !== undefined)
      .map((f) => [f, row[f]]),
  );
const projectCard = (card) => ({
  ...pick(card, CARD_FIELDS),
  ...(card.type === "occurrence" ? { team_id: "" } : {}),
  occurrences: card.occurrences.map((o) => pick(o, OCCURRENCE_FIELDS)),
});

// ---- Comparison ------------------------------------------------------------------------------
async function compareAll(db, { ties }) {
  const rows = await populate(db, { ties });
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (email) =>
    (
      await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
      })
    ).headers
      .get("set-cookie")
      .split(";")[0];
  const get = async (cookie, path) => {
    const response = await fetch(base + path, { headers: { cookie } });
    assert.equal(response.status, 200, `${path}: ${response.status}`);
    return response.json();
  };
  const user = async (email) => ({
    cookie: await login(email),
    ...(await db.get(
      "SELECT id,name,email,role,team_id FROM users WHERE email=?",
      [email],
    )),
  });
  const json = (value) => JSON.parse(JSON.stringify(value));
  try {
    const admin = await user("admin@urbana.local");
    const gestor = await user("gestor@urbana.local");
    const field = [
      await user("campo@urbana.local"),
      await user("op-a@urbana.local"),
      await user("op-b@urbana.local"),
    ];

    // R4: /planejamento keeps the open work complete (groups and open plans, now ordered by
    // created_at DESC, id DESC) and only counts closed plans, listed by /planejamento/encerrados.
    for (const u of [admin, gestor]) {
      const legacy = json(await legacyPlanning(db, u));
      const ordered = [...legacy.plans].sort(byRecent);
      const closedPlans = ordered.filter((p) => CLOSED_PLAN.includes(p.status));
      assert.deepEqual(
        await get(u.cookie, "/planejamento"),
        {
          groups: legacy.groups,
          plans: ordered.filter((p) => !CLOSED_PLAN.includes(p.status)),
          closed_plans: closedPlans.length,
        },
        `planejamento (${u.email})`,
      );
      for (const [filter, keep] of [
        ["", () => true],
        [
          "&q=pa-q-1",
          (p) =>
            `${p.code} ${p.street} ${p.neighborhood} ${p.objective} ${p.responsible}`
              .toLocaleLowerCase("pt-BR")
              .includes("pa-q-1"),
        ],
        [
          "&sector_id=sector-2",
          (p) => p.occurrences.some((o) => o.sector_id === "sector-2"),
        ],
      ]) {
        const pages = [];
        let cursor = "";
        do {
          const page = await get(
            u.cookie,
            `/planejamento/encerrados?limit=3${filter}${cursor ? `&cursor=${cursor}` : ""}`,
          );
          pages.push(...page.items);
          cursor = page.next_cursor;
          assert.equal(page.has_more, !!cursor);
        } while (cursor);
        assert.deepEqual(
          pages,
          closedPlans.filter(keep),
          `planejamento/encerrados ${filter} (${u.email})`,
        );
      }
    }
    const plans = await get(admin.cookie, "/planejamento");
    assert.ok(
      plans.plans.some((p) => p.orders.length > 1) && plans.groups.length,
      "fixture covers plans with orders",
    );
    assert.ok(
      plans.closed_plans > 3,
      "fixture covers more than one page of closed plans",
    );

    for (const u of [admin, ...field]) {
      const { server_time, ...answer } = await get(u.cookie, "/campo");
      assert.ok(server_time);
      const expected = await legacyField(db, u);
      // R4: management profiles only receive the open orders; Equipe de Campo is unchanged.
      if (u.role !== "Equipe de Campo")
        expected.orders = expected.orders.filter((o) => !closed(o.status));
      assert.deepEqual(
        { orders: answer.orders, records: answer.records },
        json(expected),
        `campo (${u.email})`,
      );
    }

    for (const [month, sector] of [
      ["2026-03", ""],
      ["2026-04", ""],
      ["2026-04", "sector-2"],
      ["2026-05", "sector-1"],
      ["2025-01", ""],
    ]) {
      const answer = await get(
        admin.cookie,
        `/controle-setor?month=${month}${sector ? `&sector_id=${sector}` : ""}`,
      );
      assert.deepEqual(
        answer.rows,
        json(await legacySectorControl(db, month, sector)),
        `controle-setor ${month} ${sector}`,
      );
    }

    const radius = JSON.parse(
      (await db.get("SELECT value FROM settings WHERE id='general'")).value,
    ).duplicate_radius;
    let withNeighbours = 0;
    for (const point of [
      rows[3],
      rows[13],
      rows[40],
      rows[41],
      { lat: -26.5, lng: -48 },
    ]) {
      const query = { lat: point.lat, lng: point.lng };
      const answer = await get(
        admin.cookie,
        `/ocorrencias/proximas?lat=${query.lat}&lng=${query.lng}`,
      );
      assert.deepEqual(
        answer,
        json(await legacyNearby(db, query, radius)),
        `proximas ${query.lat},${query.lng}`,
      );
      if (answer.length > 1) withNeighbours++;
    }
    assert.ok(
      withNeighbours > 0,
      "fixture covers occurrences at the same point",
    );
    // Wider radius exercises the bounding box on a larger neighbourhood.
    await db.run("UPDATE settings SET value=? WHERE id='general'", [
      JSON.stringify({
        duplicate_radius: 800,
        municipality: "Teste",
        demo: true,
      }),
    ]);
    const wide = await get(
      admin.cookie,
      `/ocorrencias/proximas?lat=${rows[20].lat}&lng=${rows[20].lng}`,
    );
    assert.ok(wide.length > 5);
    assert.deepEqual(wide, json(await legacyNearby(db, rows[20], 800)));

    const snapshot = await kanbanService(db, () => {}).snapshot();
    assert.deepEqual(
      Object.entries(snapshot.counts).sort(),
      Object.entries(await legacyKanbanCounts(db)).sort(),
    );

    // ---- R4: dashboard aggregates, summaries and board cards ----
    await populateRecent(db);
    const boot = await get(admin.cookie, "/bootstrap");
    for (const tz of ["America/Sao_Paulo", "Asia/Kolkata", "UTC"]) {
      const time = Date.now();
      const dashboard = await get(
        admin.cookie,
        `/dashboard?tz=${encodeURIComponent(tz)}`,
      );
      const rowsList = await get(admin.cookie, "/ocorrencias");
      const ordersList = await get(admin.cookie, "/ordens-servico");
      const costs = json(await legacyDashboardCosts(db, admin));
      const expected = legacyIndicators({
        rows: rowsList,
        orders: ordersList,
        materials: costs.materials,
        catalogs: boot.catalogs,
        priorities: boot.priorities,
        tz,
        time,
      });
      const actual = newIndicators({
        dashboard,
        occurrenceSummary: await get(
          admin.cookie,
          "/ocorrencias/resumo?bairros=1",
        ),
        orderSummary: await get(admin.cookie, "/ordens-servico/resumo"),
        catalogs: boot.catalogs,
        priorities: boot.priorities,
      });
      assert.deepEqual(actual, expected, `painel (${tz})`);
      assert.ok(
        expected.trend.some((t) => t.incoming) &&
          expected.trend.some((t) => t.completed),
        "fixture covers the trend",
      );
      assert.ok(
        expected.neighborhoods.some((n) => n.label === "Não informado"),
        "fixture covers occurrences without neighborhood",
      );
      assert.equal(dashboard.actual_cost, costs.actual_cost);
      assert.ok(Math.abs(dashboard.cost - costs.cost) < 1e-9);
      assert.equal(dashboard.total, rowsList.length);
      for (const key of ["orders", "occurrences", "materials"])
        assert.equal(key in dashboard, false, `dashboard sem ${key}`);
    }
    assert.equal(
      (
        await fetch(`${base}/dashboard?tz=Lua/Base`, {
          headers: { cookie: admin.cookie },
        })
      ).status,
      400,
    );

    // Board cards: the full projection equals the cards built from the previous lists, and the
    // default answer is every open card plus the Concluídas of the last 30 days.
    const time = Date.now();
    const legacyCards = buildKanbanCards(
      await get(admin.cookie, "/ocorrencias"),
      await get(admin.cookie, "/ordens-servico"),
    );
    const config = await get(admin.cookie, "/kanban");
    const full = await get(
      admin.cookie,
      "/kanban/cartoes?concluidas_dias=0&encerradas=1",
    );
    const byKey = (cards) =>
      new Map(cards.map((c) => [cardKey(c), projectCard(c)]));
    assert.deepEqual(byKey(full.cards), byKey(legacyCards));
    assert.deepEqual(
      { revision: full.revision, limits: full.limits, order: full.order },
      config,
    );
    assert.deepEqual(
      Object.entries(full.counts).sort(),
      Object.entries(await legacyKanbanCounts(db)).sort(),
    );
    const since = time - 30 * 86400000;
    const updated = new Map(
      (await db.all("SELECT id,updated_at FROM occurrences")).map((r) => [
        r.id,
        r.updated_at,
      ]),
    );
    const inWindow = (c) =>
      !closedStatus(c.status) ||
      (c.status === "CONCLUIDA" &&
        Date.parse(c.type === "order" ? c.completed_at : updated.get(c.id)) >=
          since);
    const recent = await get(admin.cookie, "/kanban/cartoes");
    assert.equal(recent.concluidas_dias, 30);
    assert.deepEqual(byKey(recent.cards), byKey(legacyCards.filter(inWindow)));
    assert.ok(
      recent.cards.some((c) => c.status === "CONCLUIDA") &&
        legacyCards.some((c) => c.status === "CONCLUIDA" && !inWindow(c)),
      "fixture covers both sides of the window",
    );
    assert.deepEqual(
      sortKanbanCards(recent.cards, config.order).map(cardKey),
      sortKanbanCards(legacyCards.filter(inWindow), config.order).map(cardKey),
    );
    assert.deepEqual(
      flowMetrics(recent.cards, time),
      flowMetrics(legacyCards, time),
      "flow metrics only need the last 30 days",
    );
    assert.equal(
      recent.cards.filter((c) => c.status === "CONCLUIDA").length <=
        recent.counts.CONCLUIDA,
      true,
    );
  } finally {
    server.close();
  }
}

test("narrowed planning, field, sector control, dashboard, proximity and kanban reads match the previous implementations (SQLite)", async () => {
  const folder = mkdtempSync(join(tmpdir(), "urbana-equivalence-"));
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.DATA_DIR = folder;
  process.env.DEMO_DATA = "true";
  process.env.ADMIN_PASSWORD = PASSWORD;
  const db = await openDatabase();
  try {
    await seed(db);
    await compareAll(db, { ties: true });
  } finally {
    await db.close();
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
    rmSync(folder, { recursive: true, force: true });
  }
});

// PostgreSQL ordered ties arbitrarily before, so this run uses distinct timestamps.
const url = process.env.URBANA_POSTGRES_TEST_URL;
test(
  "narrowed reads match the previous implementations (PostgreSQL)",
  {
    skip:
      !url &&
      "URBANA_POSTGRES_TEST_URL ausente: homologação real não executada",
  },
  async () => {
    const schema = "urbana_eq_" + randomUUID().replaceAll("-", "");
    const pool = new pg.Pool({ connectionString: url });
    const folder = mkdtempSync(join(tmpdir(), "urbana-equivalence-pg-"));
    const original = process.env.DATABASE_URL;
    let db;
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
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
      process.env.DEMO_DATA = "true";
      process.env.ADMIN_PASSWORD = PASSWORD;
      db = await openDatabase();
      await seed(db);
      assert.equal(db.dialect, "postgres");
      await compareAll(db, { ties: false });
    } finally {
      await db?.close();
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
