import { useEffect, useState } from "react";
import { summarizeTeam } from "./dispatch-model.mjs";
import "./dispatch-context.css";

const labels: Record<string, string> = { PROGRAMADA: "Programada", EM_DESLOCAMENTO: "Em deslocamento", EM_EXECUCAO: "Em execução", AGUARDANDO_VALIDACAO: "Em validação", DEVOLVIDA: "Devolvida" };
const date = (v: string) => v ? v.slice(0, 10).split("-").reverse().join("/") : "Sem data";

export default function DispatchContext({ boot, api, sectorId, selectedTeam = "", scheduledAt = "", excludeOrderId, occurrenceId, onChoose, onOpen }: any) {
  const [data, setData] = useState<any>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [stamp, setStamp] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [orders, planning, occurrences] = await Promise.all([api("/ordens-servico"), api("/planejamento"), api("/ocorrencias")]);
        if (active) { setData({ orders, planning, occurrences }); setError(""); setStamp(new Date().toLocaleTimeString("pt-BR")); }
      } catch (e: any) { if (active) setError(e.message); }
      finally { if (active) setLoading(false); }
    };
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [api]);
  const teams = boot.catalogs.filter((t: any) => t.kind === "equipes" && t.sector_id === sectorId);
  const name = (id: string) => boot.catalogs.find((c: any) => c.id === id)?.name || "Sem equipe";
  const orders = (data?.orders || []).filter((o: any) => o.id !== excludeOrderId);
  const activeOrders = orders.filter((o: any) => o.sector_id === sectorId && !["CONCLUIDA", "CANCELADA"].includes(o.status));
  const groups = (data?.planning.groups || []).filter((g: any) => g.occurrences.some((o: any) => o.sector_id === sectorId));
  const plans = (data?.planning.plans || []).filter((p: any) => !["Concluído", "Encerrado com cancelamentos", "Encerrado com recusas"].includes(p.status) && p.occurrences.some((o: any) => o.sector_id === sectorId));
  return <section className="dispatch-context" aria-label="Equipes e planejamento de vias">
    <h3>Equipes e planejamento de vias</h3>
    <p>Confira a carga registrada antes de distribuir o serviço. Sem atividade em andamento não significa disponibilidade confirmada: valide jornada, recursos e duração com a equipe.</p>
    {error && <p className="form-error" role="alert">{data ? "Não foi possível atualizar a carga. Os dados abaixo podem estar desatualizados. " : "Não foi possível consultar a carga das equipes. "}{error}<button type="button" className="text-button" onClick={() => { setLoading(true); Promise.all([api("/ordens-servico"), api("/planejamento"), api("/ocorrencias")]).then(([orders, planning, occurrences]) => { setData({ orders, planning, occurrences }); setError(""); setStamp(new Date().toLocaleTimeString("pt-BR")); }).catch((e) => setError(e.message)).finally(() => setLoading(false)); }}>Tentar novamente</button></p>}
    {loading && !data && <p role="status">Consultando operações e equipes...</p>}
    {data && <>
      <small>Atualizado às {stamp} · {scheduledAt ? `programação analisada para ${date(scheduledAt)}` : "selecione a data para conferir a agenda"} · atualização a cada 15 segundos</small>
      <div className="dispatch-teams">{teams.map((t: any) => {
        const summary = summarizeTeam(orders, t.id, scheduledAt);
        return <article key={t.id} className={selectedTeam === t.id ? "selected" : ""}>
          <h4>{t.name}</h4><p>{t.leader || "Responsável não cadastrado"}{t.members ? ` · ${t.members} integrantes` : ""}</p>
          <strong>{summary.running ? "Em operação" : "Sem operação em andamento"}</strong>
          <dl><div><dt>OS abertas</dt><dd>{summary.open}</dd></div><div><dt>Chamados vinculados</dt><dd>{summary.calls}</dd></div><div><dt>Em execução / deslocamento</dt><dd>{summary.running}</dd></div><div><dt>Programadas</dt><dd>{summary.scheduled}</dd></div><div><dt>Em validação / devolvidas</dt><dd>{summary.review} / {summary.returned}</dd></div>{scheduledAt && <div><dt>Compromissos na data</dt><dd>{summary.onDate}</dd></div>}</dl>
          {summary.overdue > 0 && <p className="dispatch-warning">{summary.overdue} OS com prazo vencido</p>}
          {onChoose && <button type="button" className="button secondary" disabled={!!error} onClick={() => onChoose(t)}>{selectedTeam === t.id ? "Equipe selecionada" : `Selecionar ${t.name}`}</button>}
        </article>;
      })}</div>
      {!teams.length && <p>Nenhuma equipe cadastrada para este setor.</p>}
      {selectedTeam && scheduledAt && summarizeTeam(orders, selectedTeam, scheduledAt).onDate > 0 && <p className="dispatch-warning" role="status">A equipe selecionada já tem serviços na data escolhida. Confira a agenda abaixo antes de confirmar.</p>}
      <details open><summary>Operações abertas do setor ({activeOrders.length})</summary>
        {!activeOrders.length && <p>Nenhuma operação aberta registrada para o setor.</p>}
        {activeOrders.map((o: any) => { const locations = data.occurrences.filter((r: any) => (o.occurrence_ids || []).includes(r.id)); return <article className="dispatch-operation" key={o.id}><strong>{o.code} · {name(o.team_id)}</strong><span>{labels[o.status] || o.status} · {o.priority} · {date(o.scheduled_at)}</span><span>{o.assigned_user_id ? `Operador: ${boot.operators.find((u: any) => u.id === o.assigned_user_id)?.name || o.responsible}` : `Responsável: ${o.responsible}`}</span><span>{locations.map((r: any) => `${r.address} (${r.neighborhood})`).join("; ") || "Consulte os endereços no detalhe da OS."}</span>{onOpen && <button type="button" className="text-button" onClick={() => onOpen("order", o.id)}>Ver ordem {o.code}</button>}</article>; })}
      </details>
      <details open><summary>Planejamento de vias do setor ({groups.length} vias · {plans.length} planos ativos)</summary>
        {plans.map((p: any) => <article className="dispatch-operation" key={p.id}><strong>{p.code} · {p.street} · {p.neighborhood}</strong><span>{p.status} · {p.priority} · {date(p.scheduled_at)} · {p.responsible}</span><span>{p.objective}</span><span>{p.occurrences.length} chamados · {p.orders.length} ordens vinculadas</span></article>)}
        {groups.map((g: any) => <article className={`dispatch-operation ${g.occurrences.some((o: any) => o.id === occurrenceId) ? "current-road" : ""}`} key={g.key}><strong>{g.street} · {g.neighborhood}{g.occurrences.some((o: any) => o.id === occurrenceId) ? " · Via desta ocorrência" : ""}</strong><span>{g.priority} · {g.occurrences.filter((o: any) => o.sector_id === sectorId).length} chamados abertos do setor</span><span>{g.occurrences.filter((o: any) => o.sector_id === sectorId).map((o: any) => `${o.code}${o.plan_id ? " (em plano)" : " (sem plano)"}`).join(" · ")}</span></article>)}
        {!groups.length && !plans.length && <p>Nenhuma via com demanda aberta ou plano ativo neste setor.</p>}
      </details>
    </>}
  </section>;
}
