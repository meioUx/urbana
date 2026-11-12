import { geometryDistance } from "../../shared/geometry.mjs";

// Lifecycles of interventions and works (obras). They are independent of the occurrence/OS
// workflow (workflow.js): no transition here changes an occurrence or a service order, and no OS
// state is reused. Links to occurrences and OS are optional and never drive these states.

const freeze = (table) =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(table).map(([k, v]) => [k, Object.freeze(v)]),
    ),
  );

export const interventionStatus = Object.freeze({
  PLANEJADA: "PLANEJADA",
  EM_ANDAMENTO: "EM_ANDAMENTO",
  PARALISADA: "PARALISADA",
  CONCLUIDA: "CONCLUIDA",
  CANCELADA: "CANCELADA",
});
export const projectStatus = Object.freeze({
  PLANEJADA: "PLANEJADA",
  EM_ANDAMENTO: "EM_ANDAMENTO",
  PARALISADA: "PARALISADA",
  CONCLUIDA: "CONCLUIDA",
  CANCELADA: "CANCELADA",
});

const I = interventionStatus;
export const interventionTransitions = freeze({
  [I.PLANEJADA]: [I.EM_ANDAMENTO, I.CANCELADA],
  [I.EM_ANDAMENTO]: [I.PARALISADA, I.CONCLUIDA, I.CANCELADA],
  [I.PARALISADA]: [I.EM_ANDAMENTO, I.CANCELADA],
  [I.CONCLUIDA]: [I.EM_ANDAMENTO], // reabertura, com motivo
  [I.CANCELADA]: [],
});
const P = projectStatus;
export const projectTransitions = freeze({
  [P.PLANEJADA]: [P.EM_ANDAMENTO, P.CANCELADA],
  [P.EM_ANDAMENTO]: [P.PARALISADA, P.CONCLUIDA, P.CANCELADA],
  [P.PARALISADA]: [P.EM_ANDAMENTO, P.CANCELADA],
  [P.CONCLUIDA]: [P.EM_ANDAMENTO],
  [P.CANCELADA]: [],
});

const tables = {
  intervention: interventionTransitions,
  project: projectTransitions,
};
const tableFor = (kind) => {
  if (!tables[kind]) throw new TypeError(`Tipo sem ciclo de vida: ${kind}`);
  return tables[kind];
};
export const worksStatuses = (kind) => Object.keys(tableFor(kind));
export const allowedWorksTransitions = (kind, from) => [
  ...(tableFor(kind)[from] || []),
];
export const canWorksTransition = (kind, from, to) =>
  allowedWorksTransitions(kind, from).includes(to);
export function assertWorksTransition(kind, from, to) {
  if (!canWorksTransition(kind, from, to))
    throw Object.assign(new Error(`Transição inválida: ${from} → ${to}.`), {
      status: 409,
      code: "INVALID_STATUS",
      from,
      to,
      entityType: kind,
    });
}
// Pausing, cancelling and reopening a concluded record need a justification.
export const transitionNeedsReason = (kind, from, to) => {
  tableFor(kind);
  return (
    to === "PARALISADA" ||
    to === "CANCELADA" ||
    (from === "CONCLUIDA" && to === "EM_ANDAMENTO")
  );
};
export const closedStatuses = Object.freeze(["CONCLUIDA", "CANCELADA"]);
export const isClosedStatus = (status) => closedStatuses.includes(status);
// Interventions that still occupy their area/segment and can conflict with others.
export const activeInterventionStatuses = Object.freeze([
  I.PLANEJADA,
  I.EM_ANDAMENTO,
  I.PARALISADA,
]);

export const DEFAULT_CONFLICT_TOLERANCE_M = 15;

/** Inclusive overlap of two date ranges (YYYY-MM-DD strings); null when they do not overlap. */
export function periodOverlap(aStart, aEnd, bStart, bEnd) {
  const start = aStart > bStart ? aStart : bStart,
    end = aEnd < bEnd ? aEnd : bEnd;
  return start <= end ? { start, end } : null;
}

/**
 * Spatial and temporal conflicts of `target` ({id, geometry, planned_start, planned_end, status})
 * among `candidates`: active interventions whose geometries are within `tolerance` meters and whose
 * planned periods overlap. Pure; callers pre-filter candidates by bbox and period in SQL.
 */
export function findConflicts(
  target,
  candidates,
  tolerance = DEFAULT_CONFLICT_TOLERANCE_M,
) {
  if (target.status && !activeInterventionStatuses.includes(target.status))
    return [];
  const result = [];
  for (const other of candidates) {
    if (
      other.id === target.id ||
      !activeInterventionStatuses.includes(other.status)
    )
      continue;
    const overlap = periodOverlap(
      target.planned_start,
      target.planned_end,
      other.planned_start,
      other.planned_end,
    );
    if (!overlap) continue;
    const distance = geometryDistance(target.geometry, other.geometry);
    if (distance > tolerance) continue;
    result.push({ other, distance_m: Math.round(distance * 10) / 10, overlap });
  }
  return result.sort(
    (a, b) =>
      a.distance_m - b.distance_m ||
      a.other.planned_start.localeCompare(b.other.planned_start),
  );
}
