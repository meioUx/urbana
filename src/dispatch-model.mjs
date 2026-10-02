export function summarizeTeam(orders, teamId, scheduledAt, now = Date.now()) {
  const open = orders.filter(o => o.team_id === teamId && !["CONCLUIDA", "CANCELADA"].includes(o.status));
  return {
    open: open.length,
    calls: new Set(open.flatMap(o => o.occurrence_ids || [])).size,
    running: open.filter(o => ["EM_DESLOCAMENTO", "EM_EXECUCAO"].includes(o.status)).length,
    scheduled: open.filter(o => o.status === "PROGRAMADA").length,
    review: open.filter(o => o.status === "AGUARDANDO_VALIDACAO").length,
    returned: open.filter(o => o.status === "DEVOLVIDA").length,
    onDate: scheduledAt ? open.filter(o => ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"].includes(o.status) && o.scheduled_at?.slice(0, 10) === scheduledAt).length : 0,
    overdue: open.filter(o => Date.parse(o.due_at) < now).length,
  };
}
