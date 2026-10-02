export const kanbanColumns = [
  {
    status: "IDENTIFICADA",
    title: "Identificadas",
    hint: "Conferir a demanda recebida",
  },
  {
    status: "EM_TRIAGEM",
    title: "Em triagem",
    hint: "Classificar e programar a equipe",
  },
  {
    status: "PROGRAMADA",
    title: "Programadas",
    hint: "Equipe e data definidas",
  },
  {
    status: "EM_DESLOCAMENTO",
    title: "Em deslocamento",
    hint: "A caminho do serviço",
  },
  {
    status: "EM_EXECUCAO",
    title: "Em execução",
    hint: "Fotos, materiais e relato",
  },
  {
    status: "AGUARDANDO_VALIDACAO",
    title: "Em validação",
    hint: "Conferir resultado e aprovar",
  },
  {
    status: "DEVOLVIDA",
    title: "Devolvidas",
    hint: "Analisar motivo e reprogramar",
  },
  {
    status: "CANCELADA",
    title: "Canceladas",
    hint: "Consultar a justificativa",
  },
  {
    status: "RECUSADA",
    title: "Recusadas",
    hint: "Justificativa registrada na triagem",
  },
  {
    status: "CONCLUIDA",
    title: "Concluídas",
    hint: "Resultado validado e conclusão registrada",
  },
];

export function buildKanbanCards(occurrences, orders) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const represented = new Set(orders.flatMap((o) => o.occurrence_ids || []));
  return [
    ...occurrences
      .filter((o) => !represented.has(o.id))
      .map((o) => ({
        ...o,
        type: "occurrence",
        team_id: "",
        occurrences: [o],
      })),
    ...orders.map((o) => ({
      ...o,
      type: "order",
      occurrences: (o.occurrence_ids || [])
        .map((id) => byId.get(id))
        .filter(Boolean),
    })),
  ];
}

export function teamColor(id) {
  if (!id) return "#64748b";
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return `hsl(${((hash >>> 0) * 137.508) % 360} 60% 35%)`;
}

export const closedStatus = (status) =>
  ["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(status);
export const cardKey = (card) => `${card.type}:${card.id}`;

export function availableMoves(card, can) {
  const moves = [];
  const add = (status, action, permission, form, label) => {
    if (can(permission))
      moves.push({
        status,
        action,
        form,
        label: label || kanbanColumns.find((c) => c.status === status).title,
      });
  };
  if (card.type === "occurrence") {
    if (card.status === "IDENTIFICADA")
      add("EM_TRIAGEM", "classificar", "classify", "triage");
    if (card.status === "EM_TRIAGEM")
      add("PROGRAMADA", "programar", "schedule", "schedule");
    if (["IDENTIFICADA", "EM_TRIAGEM"].includes(card.status))
      add("RECUSADA", "recusar", "classify", "reason");
  } else {
    if (card.status === "PROGRAMADA")
      add("EM_DESLOCAMENTO", "assumir", "execute", "confirm");
    if (["PROGRAMADA", "EM_DESLOCAMENTO"].includes(card.status))
      add("EM_EXECUCAO", "iniciar", "execute", "location");
    if (card.status === "EM_EXECUCAO")
      add("AGUARDANDO_VALIDACAO", "concluir", "execute", "notes");
    if (card.status === "AGUARDANDO_VALIDACAO")
      add("CONCLUIDA", "validar", "validate", "confirm");
    if (["AGUARDANDO_VALIDACAO", "CONCLUIDA"].includes(card.status))
      add("EM_EXECUCAO", "reabrir", "validate", "reason", "Reabrir execução");
    if (
      ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"].includes(card.status)
    ) {
      add("DEVOLVIDA", "devolver", "execute", "reason");
      add("CANCELADA", "cancelar", "schedule", "reason");
    }
    if (card.status === "DEVOLVIDA")
      add("PROGRAMADA", "programacao", "schedule", "schedule");
  }
  return moves;
}

export function sortKanbanCards(cards, order = {}) {
  const ranks = new Map(
    Object.values(order)
      .flat()
      .map((key, i) => [key, i]),
  );
  const priority = ["Emergencial", "Alta", "Média", "Baixa", "Programada"];
  return [...cards].sort((a, b) => {
    const rankA = ranks.get(cardKey(a)),
      rankB = ranks.get(cardKey(b));
    if (rankA !== undefined || rankB !== undefined)
      return (rankA ?? Infinity) - (rankB ?? Infinity);
    const p = priority.indexOf(a.priority) - priority.indexOf(b.priority);
    return (
      p ||
      (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) ||
      cardKey(a).localeCompare(cardKey(b))
    );
  });
}

export function flowMetrics(cards, time = Date.now()) {
  const started = cards.filter(
    (c) => c.type === "order" && !closedStatus(c.status),
  );
  const done = cards.filter(
    (c) =>
      c.type === "order" &&
      c.status === "CONCLUIDA" &&
      Date.parse(c.completed_at) >= time - 30 * 86400000 &&
      Date.parse(c.completed_at) <= time,
  );
  const cycle = done
    .map(
      (c) => (Date.parse(c.completed_at) - Date.parse(c.created_at)) / 86400000,
    )
    .filter((n) => Number.isFinite(n) && n >= 0);
  const ages = started
    .map((c) => (time - Date.parse(c.created_at)) / 86400000)
    .filter((n) => Number.isFinite(n) && n >= 0);
  return {
    wip: started.length,
    throughput: done.length,
    oldest: ages.length ? Math.max(...ages) : null,
    cycle: cycle.length
      ? cycle.reduce((a, b) => a + b, 0) / cycle.length
      : null,
  };
}
