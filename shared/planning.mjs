const planningPriorities = [
  "Emergencial",
  "Alta",
  "Média",
  "Baixa",
  "Programada",
];

const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function streetIdentity(row) {
  const street = String(row.address || "")
    .split(",")[0]
    .replace(/\s+(?:n[º°.]?\s*|numero\s+)\d+.*$/i, "")
    .trim();
  const normalized = normalize(street)
    .replace(/^r\s+/, "rua ")
    .replace(/^av\s+/, "avenida ");
  return {
    street,
    key: JSON.stringify([normalized, normalize(row.neighborhood)]),
  };
}
export function planningPriority(rows) {
  const highest =
    planningPriorities.find((p) => rows.some((o) => o.priority === p)) ||
    "Baixa";
  return rows.length >= 2 && planningPriorities.indexOf(highest) > 1
    ? "Alta"
    : highest;
}
export function groupStreets(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(row.status)) continue;
    const { street, key } = streetIdentity(row);
    if (!street || !row.neighborhood) continue;
    if (!groups.has(key))
      groups.set(key, {
        key,
        street,
        neighborhood: row.neighborhood,
        occurrences: [],
      });
    groups.get(key).occurrences.push(row);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      priority: planningPriority(g.occurrences),
      oldest_at: g.occurrences.reduce(
        (a, o) => (o.created_at < a ? o.created_at : a),
        g.occurrences[0].created_at,
      ),
    }))
    .sort(
      (a, b) =>
        planningPriorities.indexOf(a.priority) -
          planningPriorities.indexOf(b.priority) ||
        b.occurrences.length - a.occurrences.length ||
        a.oldest_at.localeCompare(b.oldest_at),
    );
}

export function occurrenceDeadline(row, catalogs, groupPriority) {
  const category = catalogs.find(
    (c) => c.id === row.category_id && c.kind === "categorias",
  );
  const priority = groupPriority
    ? planningPriorities.find((p) => p === row.priority || p === groupPriority)
    : row.priority;
  const hours = Number(category?.sla?.[priority]);
  const created = Date.parse(row.created_at);
  return Number.isFinite(hours) && hours >= 0 && Number.isFinite(created)
    ? new Date(created + hours * 3600000).toISOString()
    : null;
}

export function buildWorkCandidates(
  groups,
  catalogs,
  orders = [],
  time = Date.now(),
) {
  const linked = new Set(orders.flatMap((o) => o.occurrence_ids || []));
  const candidates = [];
  for (const group of groups) {
    const sectors = new Map();
    for (const row of group.occurrences) {
      if (
        row.plan_id ||
        row.order_ids?.length ||
        linked.has(row.id) ||
        !["IDENTIFICADA", "EM_TRIAGEM"].includes(row.status)
      )
        continue;
      if (!sectors.has(row.sector_id)) sectors.set(row.sector_id, new Map());
      sectors.get(row.sector_id).set(row.id, row);
    }
    for (const [sector_id, byId] of sectors) {
      const occurrences = [...byId.values()];
      const ready = occurrences.filter((o) => o.status === "EM_TRIAGEM");
      const waiting = occurrences.filter((o) => o.status === "IDENTIFICADA");
      const priority = planningPriority(occurrences);
      const highest =
        planningPriorities.find((p) =>
          occurrences.some((o) => o.priority === p),
        ) || "Baixa";
      const deadlines = occurrences
        .map((o) => occurrenceDeadline(o, catalogs))
        .filter(Boolean)
        .sort();
      const overdue = occurrences.filter((o) => {
        const due = occurrenceDeadline(o, catalogs);
        return due && Date.parse(due) < time;
      }).length;
      const oldest_at =
        occurrences
          .map((o) => o.created_at)
          .filter((v) => Number.isFinite(Date.parse(v)))
          .sort()[0] || null;
      const reasons = [];
      if (highest === "Emergencial") reasons.push("Demanda emergencial");
      if (overdue)
        reasons.push(
          `${overdue} ${overdue === 1 ? "prazo vencido" : "prazos vencidos"}`,
        );
      if (occurrences.length > 1)
        reasons.push(`${occurrences.length} demandas na mesma via`);
      if (!reasons.length)
        reasons.push(`Prioridade ${highest.toLocaleLowerCase("pt-BR")}`);
      candidates.push({
        key: JSON.stringify([group.key, sector_id]),
        street: group.street,
        neighborhood: group.neighborhood,
        sector_id,
        sector_name:
          catalogs.find((c) => c.id === sector_id)?.name ||
          "Setor não informado",
        occurrences,
        ready,
        waiting,
        priority,
        highest_priority: highest,
        grouped_priority: priority !== highest,
        oldest_at,
        age_days: oldest_at
          ? Math.max(0, (time - Date.parse(oldest_at)) / 86400000)
          : null,
        earliest_due_at: deadlines[0] || null,
        overdue,
        categories: [
          ...new Set(
            occurrences.map(
              (o) =>
                catalogs.find((c) => c.id === o.category_id)?.name ||
                "Categoria não informada",
            ),
          ),
        ],
        reasons,
      });
    }
  }
  return sortWorkCandidates(candidates);
}

export function sortWorkCandidates(candidates, mode = "priority") {
  const priority = (c) => planningPriorities.indexOf(c.priority);
  const deadline = (c) => Date.parse(c.earliest_due_at) || Infinity;
  const oldest = (c) => Date.parse(c.oldest_at) || Infinity;
  return [...candidates].sort((a, b) => {
    const emergency =
      Number(b.highest_priority === "Emergencial") -
      Number(a.highest_priority === "Emergencial");
    if (emergency) return emergency;
    if (mode === "volume")
      return (
        b.occurrences.length - a.occurrences.length ||
        priority(a) - priority(b) ||
        oldest(a) - oldest(b) ||
        a.key.localeCompare(b.key)
      );
    if (mode === "deadline")
      return (
        deadline(a) - deadline(b) ||
        priority(a) - priority(b) ||
        a.key.localeCompare(b.key)
      );
    if (mode === "age")
      return (
        oldest(a) - oldest(b) ||
        priority(a) - priority(b) ||
        a.key.localeCompare(b.key)
      );
    return (
      priority(a) - priority(b) ||
      b.overdue - a.overdue ||
      deadline(a) - deadline(b) ||
      b.occurrences.length - a.occurrences.length ||
      oldest(a) - oldest(b) ||
      a.key.localeCompare(b.key)
    );
  });
}

const searchText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
export function filterWorkCandidates(
  candidates,
  {
    query = "",
    sector = "",
    neighborhood = "",
    readiness = "all",
    sort = "priority",
  } = {},
) {
  const terms = searchText(query).split(/\s+/).filter(Boolean);
  return sortWorkCandidates(
    candidates.filter(
      (c) =>
        (!sector || c.sector_id === sector) &&
        (!neighborhood || c.neighborhood === neighborhood) &&
        (readiness !== "ready" || c.ready.length > 0) &&
        (readiness !== "triage" || c.waiting.length > 0) &&
        terms.every((term) =>
          searchText(
            [
              c.street,
              c.neighborhood,
              c.sector_name,
              ...c.categories,
              ...c.occurrences.map((o) => o.code),
            ].join(" "),
          ).includes(term),
        ),
    ),
    sort,
  );
}

export const activePlan = (plan) =>
  ![
    "Concluído",
    "Encerrado com cancelamentos",
    "Encerrado com recusas",
  ].includes(plan.status);
export const unscheduledPlanMembers = (plan) =>
  plan.occurrences.filter(
    (o) => o.status === "EM_TRIAGEM" && !o.order_ids?.length,
  );
