import { z } from "zod";
import { jsonField, orderAccess } from "../modules/listing/index.js";

const CLOSED = "('CONCLUIDA','CANCELADA','RECUSADA')";
const closed = (status) =>
  ["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(status);
export const TREND_DAYS = 90;

// Calendar day (YYYY-MM-DD) of an instant in an IANA time zone.
const dayFormatter = (timeZone) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
const shiftDay = (day, delta) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};
// 15-minute UTC bucket of an ISO timestamp ("YYYY-MM-DDTHH:" + quarter). Every IANA offset is a
// multiple of 15 minutes, so all instants of a bucket fall on the same local day in any zone.
const quarter = (expr) =>
  `substr(${expr},1,14) || CAST(CAST(substr(${expr},15,2) AS INTEGER)/15 AS TEXT)`;
const bucketStart = (bucket) =>
  `${bucket.slice(0, 14)}${String(Number(bucket.slice(14)) * 15).padStart(2, "0")}:00.000Z`;

const query = z.object({
  tz: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        dayFormatter(tz);
        return true;
      } catch {
        return false;
      }
    }, "Fuso horário inválido.")
    .optional(),
});

// Overview panel: only aggregates computed in the database. Occurrences are not restricted by
// profile (as before); orders, consumption and stock costs follow canAccessOrder (orderAccess).
export async function dashboardAggregates(
  db,
  user,
  { tz = "UTC", time = Date.now() } = {},
) {
  const stamp = new Date(time).toISOString();
  const access = orderAccess(db, user);
  const ordersWhere = (extra = "") =>
    `WHERE ${access.sql}${extra ? ` AND ${extra}` : ""}`;
  const visibleOrder = `order_id IN (SELECT id FROM orders ${ordersWhere()})`;

  // Occurrences by status and priority.
  let total = 0,
    open = 0,
    emergency = 0,
    triage = 0;
  const openByPriority = {};
  for (const row of await db.all(
    "SELECT status,priority,COUNT(*) AS n FROM occurrences GROUP BY status,priority",
  )) {
    const n = Number(row.n);
    total += n;
    if (["IDENTIFICADA", "EM_TRIAGEM"].includes(row.status)) triage += n;
    if (closed(row.status)) continue;
    open += n;
    if (row.priority === "Emergencial") emergency += n;
    openByPriority[row.priority] = (openByPriority[row.priority] || 0) + n;
  }
  // Open occurrences by neighborhood, top 5. Ties keep the order of the previous list (most recent
  // first, created_at DESC, id DESC): the group whose newest occurrence comes first wins.
  const hood = jsonField(db, "neighborhood");
  const neighborhoods = (
    await db.all(
      `SELECT COALESCE(NULLIF(${hood},''),'Não informado') AS name,COUNT(*) AS n,MAX(created_at || '|' || id) AS newest FROM occurrences WHERE status NOT IN ${CLOSED} GROUP BY 1`,
    )
  )
    .map((r) => ({ name: r.name, value: Number(r.n), newest: r.newest }))
    .sort(
      (a, b) =>
        b.value - a.value ||
        (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0),
    )
    .slice(0, 5)
    .map(({ name, value }) => ({ name, value }));

  // Orders by status and team, with the overdue count of each group.
  const ordersByStatus = {},
    openOrdersByTeam = {},
    busy = new Set();
  let openOrders = 0,
    overdue = 0;
  for (const row of await db.all(
    `SELECT status,team_id,COUNT(*) AS n,SUM(CASE WHEN due_at<? THEN 1 ELSE 0 END) AS late FROM orders ${ordersWhere()} GROUP BY status,team_id`,
    [stamp, ...access.params],
  )) {
    const n = Number(row.n);
    ordersByStatus[row.status] = (ordersByStatus[row.status] || 0) + n;
    if (closed(row.status)) continue;
    openOrders += n;
    overdue += Number(row.late);
    openOrdersByTeam[row.team_id] = (openOrdersByTeam[row.team_id] || 0) + n;
    if (["EM_EXECUCAO", "EM_DESLOCAMENTO"].includes(row.status))
      busy.add(row.team_id);
  }

  // Costs: registered consumption and stock movements of visible orders.
  const consumption = await db.all(
    `SELECT material_id,SUM(quantity) AS quantity,SUM(quantity*unit_cost) AS cost FROM consumption WHERE ${visibleOrder} GROUP BY material_id ORDER BY material_id`,
    access.params,
  );
  const cost = Number(
    (
      await db.get(
        `SELECT COALESCE(SUM(quantity*unit_cost),0) AS v FROM consumption WHERE ${visibleOrder}`,
        access.params,
      )
    ).v,
  );
  const stages = await db.all(
    `SELECT stage,SUM(quantity*unit_cost) AS value FROM inventory_movements WHERE type='saida' AND order_id IS NOT NULL AND ${visibleOrder} GROUP BY stage ORDER BY stage`,
    access.params,
  );
  const actualCost = Number(
    (
      await db.get(
        `SELECT COALESCE(SUM(quantity*unit_cost),0) AS v FROM inventory_movements WHERE type='saida' AND order_id IS NOT NULL AND ${visibleOrder}`,
        access.params,
      )
    ).v,
  );

  // Daily trend of the last TREND_DAYS local days (including today) in the requested zone:
  // new occurrences by created_at and completed orders by completed_at.
  const format = dayFormatter(tz);
  const today = format.format(new Date(time));
  const days = Array.from({ length: TREND_DAYS }, (_, i) =>
    shiftDay(today, i - TREND_DAYS + 1),
  );
  const trend = new Map(
    days.map((day) => [day, { day, incoming: 0, completed: 0 }]),
  );
  const since = new Date(time - (TREND_DAYS + 2) * 86400000).toISOString();
  const completedAt = jsonField(db, "completed_at");
  const series = [
    [
      "incoming",
      await db.all(
        `SELECT ${quarter("created_at")} AS bucket,COUNT(*) AS n FROM occurrences WHERE created_at>=? GROUP BY 1`,
        [since],
      ),
    ],
    [
      "completed",
      await db.all(
        `SELECT ${quarter(completedAt)} AS bucket,COUNT(*) AS n FROM orders ${ordersWhere(`status='CONCLUIDA' AND ${completedAt}>=?`)} GROUP BY 1`,
        [...access.params, since],
      ),
    ],
  ];
  for (const [kind, rows] of series)
    for (const row of rows) {
      const entry = trend.get(format.format(new Date(bucketStart(row.bucket))));
      if (entry) entry[kind] += Number(row.n);
    }

  return {
    total,
    open,
    emergency,
    triage,
    open_by_priority: openByPriority,
    open_by_neighborhood: neighborhoods,
    open_orders: openOrders,
    orders_by_status: ordersByStatus,
    executing: ordersByStatus.EM_EXECUCAO || 0,
    validation: ordersByStatus.AGUARDANDO_VALIDACAO || 0,
    completed: ordersByStatus.CONCLUIDA || 0,
    overdue,
    busy_teams: busy.size,
    open_orders_by_team: openOrdersByTeam,
    cost,
    actual_cost: actualCost,
    cost_by_stage: stages.map((s) => ({
      stage: s.stage,
      value: Number(s.value),
    })),
    consumption_by_material: Object.fromEntries(
      consumption.map((m) => [m.material_id, Number(m.quantity)]),
    ),
    trend_timezone: tz,
    trend: [...trend.values()],
  };
}

export function registerDashboard(app, db, { route }) {
  app.get(
    "/api/dashboard",
    route(async (req) =>
      dashboardAggregates(db, req.user, query.parse(req.query)),
    ),
  );
}
