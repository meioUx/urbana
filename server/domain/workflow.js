export const workflowStatus = Object.freeze({
  IDENTIFICADA: "IDENTIFICADA",
  EM_TRIAGEM: "EM_TRIAGEM",
  RECUSADA: "RECUSADA",
  PROGRAMADA: "PROGRAMADA",
  EM_DESLOCAMENTO: "EM_DESLOCAMENTO",
  EM_EXECUCAO: "EM_EXECUCAO",
  AGUARDANDO_VALIDACAO: "AGUARDANDO_VALIDACAO",
  DEVOLVIDA: "DEVOLVIDA",
  CONCLUIDA: "CONCLUIDA",
  CANCELADA: "CANCELADA",
});

export const occurrenceStatuses = Object.freeze([
  workflowStatus.IDENTIFICADA,
  workflowStatus.EM_TRIAGEM,
  workflowStatus.RECUSADA,
]);

export const orderStatuses = Object.freeze([
  workflowStatus.PROGRAMADA,
  workflowStatus.EM_DESLOCAMENTO,
  workflowStatus.EM_EXECUCAO,
  workflowStatus.AGUARDANDO_VALIDACAO,
  workflowStatus.DEVOLVIDA,
  workflowStatus.CONCLUIDA,
  workflowStatus.CANCELADA,
]);

export const statuses = Object.freeze([...occurrenceStatuses, ...orderStatuses]);

const freezeTransitions = (table) => Object.freeze(Object.fromEntries(
  Object.entries(table).map(([state, destinations]) => [state, Object.freeze(destinations)]),
));

export const occurrenceTransitions = freezeTransitions({
  [workflowStatus.IDENTIFICADA]: [
    workflowStatus.EM_TRIAGEM,
    workflowStatus.RECUSADA,
  ],
  [workflowStatus.EM_TRIAGEM]: [
    workflowStatus.EM_TRIAGEM,
    workflowStatus.RECUSADA,
  ],
  [workflowStatus.RECUSADA]: [],
});

export const orderTransitions = freezeTransitions({
  [workflowStatus.PROGRAMADA]: [
    workflowStatus.EM_DESLOCAMENTO,
    workflowStatus.EM_EXECUCAO,
    workflowStatus.DEVOLVIDA,
    workflowStatus.CANCELADA,
  ],
  [workflowStatus.EM_DESLOCAMENTO]: [
    workflowStatus.EM_EXECUCAO,
    workflowStatus.DEVOLVIDA,
    workflowStatus.CANCELADA,
  ],
  [workflowStatus.EM_EXECUCAO]: [
    workflowStatus.AGUARDANDO_VALIDACAO,
    workflowStatus.DEVOLVIDA,
    workflowStatus.CANCELADA,
  ],
  [workflowStatus.AGUARDANDO_VALIDACAO]: [
    workflowStatus.CONCLUIDA,
    workflowStatus.EM_EXECUCAO,
  ],
  [workflowStatus.DEVOLVIDA]: [workflowStatus.PROGRAMADA],
  [workflowStatus.CONCLUIDA]: [workflowStatus.EM_EXECUCAO],
  [workflowStatus.CANCELADA]: [],
});

const transitionsFor = (entityType) => {
  if (entityType === "occurrence") return occurrenceTransitions;
  if (entityType === "order") return orderTransitions;
  throw new TypeError(`Tipo de entidade sem fluxo: ${entityType}`);
};

export function getAllowedTransitions(status, entityType = "order") {
  return [...(transitionsFor(entityType)[status] || [])];
}

export function canTransition(from, to, entityType = "order") {
  return getAllowedTransitions(from, entityType).includes(to);
}

export function assertTransition(from, to, entityType = "order") {
  if (!canTransition(from, to, entityType)) {
    const error = new Error(`Transição inválida: ${from} → ${to}.`);
    error.code = "INVALID_TRANSITION";
    error.from = from;
    error.to = to;
    error.entityType = entityType;
    throw error;
  }
}

// Occurrences linked to an order reflect its execution state. This is a projection,
// not a direct occurrence transition, and preserves the existing data model.
export function isProjectedOrderStatus(status) {
  return orderStatuses.includes(status);
}
