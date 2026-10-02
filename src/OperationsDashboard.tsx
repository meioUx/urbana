import { useMemo, useState } from "react";
import { teamColor } from "./kanban-model.mjs";
import "./operations-dashboard.css";

const closed = (s: string) => ["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(s);
const number = (v: number) => v.toLocaleString("pt-BR");
const localDay = (value: Date) => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
const states = [
  {status:"PROGRAMADA", label:"Programadas",color:"#d48c28"},
  {status:"EM_DESLOCAMENTO",label:"Em deslocamento",color:"#929527"},
  {status:"EM_EXECUCAO",label:"Em execução",color:"#3e86c8"},
  {status:"AGUARDANDO_VALIDACAO",label:"Em validação",color:"#8470b3"},
  {status:"DEVOLVIDA",label:"Devolvidas",color:"#a46a1c"},
];

export default function OperationsDashboard({ rows, orders, boot, lastSync, syncError, syncing, onRefresh }: any) {
  const [days, setDays] = useState(14);
  const activeRows = rows.filter((r: any) => !closed(r.status));
  const openOrders = orders.filter((o: any) => !closed(o.status));
  const running = openOrders.filter((o: any) => ["EM_EXECUCAO","EM_DESLOCAMENTO"].includes(o.status));
  const teams = boot.catalogs.filter((c: any) => c.kind === "equipes");
  const busyTeams = new Set(running.map((o: any) => o.team_id)).size;
  const overdue = openOrders.filter((o: any) => Date.parse(o.due_at) < Date.now()).length;
  const trend = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return Array.from({length:days},(_,index) => {
      const day = new Date(today); day.setDate(today.getDate()-days+1+index);
      const key = localDay(day);
      return {key,label:day.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"}),incoming:rows.filter((r:any) => r.created_at && localDay(new Date(r.created_at))===key).length,completed:orders.filter((o:any) => o.status==="CONCLUIDA" && o.completed_at && localDay(new Date(o.completed_at))===key).length};
    });
  },[rows,orders,days]);
  const priorities = boot.priorities.map((label:string) => ({label,value:activeRows.filter((r:any)=>r.priority===label).length}));
  const neighborhoods = Object.entries(activeRows.reduce((sum:any,r:any)=>{const label=r.neighborhood || "Não informado";sum[label]=(sum[label]||0)+1;return sum;},{})).map(([label,value])=>({label,value:Number(value)})).sort((a,b)=>b.value-a.value).slice(0,5);
  const statusData = states.map(s=>({...s,value:openOrders.filter((o:any)=>o.status===s.status).length}));
  const maxTeams = Math.max(1,...teams.map((t:any)=>openOrders.filter((o:any)=>o.team_id===t.id).length));
  const maxTrend = Math.max(1,...trend.flatMap(t=>[t.incoming,t.completed]));
  const plotY = (n:number)=>150-(n/maxTrend)*120;
  const plotX = (i:number)=>35+(i/(days-1))*520;
  const line = (kind:"incoming"|"completed")=>trend.map((t,i)=>`${plotX(i)},${plotY(t[kind])}`).join(" ");
  return <div className="operations-dashboard">
    <div className="dashboard-context"><span>Panorama atual das operações · indicadores consolidados</span><button className="text-button" disabled={syncing} onClick={onRefresh}>{syncing?"Atualizando...":"Atualizar indicadores"}</button></div>
    {syncError && <div className="notice error" role="alert">{syncError}</div>}
    <div className="operations-kpis">
      {[
        {label:"Demandas abertas",value:activeRows.length,detail:`${activeRows.filter((r:any)=>r.priority==="Emergencial").length} emergenciais`,color:"#db5350"},
        {label:"Ordens abertas",value:openOrders.length,detail:`${rows.filter((r:any)=>["IDENTIFICADA","EM_TRIAGEM"].includes(r.status)).length} demandas em triagem`,color:"#26896b"},
        {label:"Equipes em operação",value:busyTeams,detail:`de ${teams.length} equipes cadastradas`,color:"#3e86c8"},
        {label:"Prazo vencido",value:overdue,detail:`${openOrders.length?Math.round(overdue/openOrders.length*100):0}% das OS abertas`,color:"#b97521"},
        {label:"Aguardando validação",value:orders.filter((o:any)=>o.status==="AGUARDANDO_VALIDACAO").length,detail:"Serviços enviados para análise",color:"#8470b3"},
        {label:"Serviços concluídos",value:orders.filter((o:any)=>o.status==="CONCLUIDA").length,detail:"Total de OS atualmente concluídas",color:"#26896b"},
      ].map(k=><article className="operations-kpi" key={k.label} style={{borderTopColor:k.color}}><span>{k.label}</span><strong>{number(k.value)}</strong><small>{k.detail}</small></article>)}
    </div>
    <div className="operations-charts">
      <section className="operations-chart"><div className="chart-heading"><div><h2>Evolução das operações</h2><p>Novas demandas e OS validadas por dia</p></div><label>Período do gráfico<select aria-label="Período do gráfico" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={14}>14 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option></select></label></div>
        <div className="chart-legend"><span><i style={{background:"#3e86c8"}}/>Novas demandas: {trend.reduce((s,t)=>s+t.incoming,0)}</span><span><i style={{background:"#26896b"}}/>OS validadas: {trend.reduce((s,t)=>s+t.completed,0)}</span></div>
        <svg viewBox="0 0 590 190" role="img" aria-label={`Evolução nos últimos ${days} dias: ${trend.reduce((s,t)=>s+t.incoming,0)} novas demandas e ${trend.reduce((s,t)=>s+t.completed,0)} OS validadas`}>
          {[0,0.5,1].map(f=><g key={f}><line x1="35" x2="555" y1={plotY(maxTrend*f)} y2={plotY(maxTrend*f)} stroke="#e1e9e4"/><text x="26" y={plotY(maxTrend*f)+4} textAnchor="end">{(maxTrend*f).toLocaleString("pt-BR",{maximumFractionDigits:1})}</text></g>)}
          <polyline points={line("incoming")} stroke="#3e86c8" strokeWidth="3" fill="none"/><polyline points={line("completed")} stroke="#26896b" strokeWidth="3" fill="none"/>
          {trend.map((t,i)=><g key={t.key}><circle cx={plotX(i)} cy={plotY(t.incoming)} r="3" fill="#3e86c8"><title>{t.label}: {t.incoming} novas demandas</title></circle><circle cx={plotX(i)} cy={plotY(t.completed)} r="3" fill="#26896b"><title>{t.label}: {t.completed} OS validadas</title></circle></g>)}
          {[0,Math.floor((days-1)/2),days-1].map(i=><text key={i} x={plotX(i)} y="176" textAnchor="middle">{trend[i].label}</text>)}
        </svg><small>Demandas e OS são unidades diferentes: uma OS pode reunir vários chamados. O período altera apenas este gráfico.</small>
      </section>
      <section className="operations-chart"><h2>Andamento das ordens</h2><p>Distribuição das {openOrders.length} OS abertas</p><div className="status-composition" role="img" aria-label={statusData.map(s=>`${s.label}: ${s.value}`).join("; ")}>{statusData.filter(s=>s.value).map(s=><span key={s.status} style={{background:s.color,width:`${s.value/Math.max(1,openOrders.length)*100}%`}} title={`${s.label}: ${s.value}`}/>)}</div><div className="status-breakdown">{statusData.map(s=><div key={s.status}><span><i style={{background:s.color}}/>{s.label}</span><strong>{s.value}</strong><small>{openOrders.length?Math.round(s.value/openOrders.length*100):0}%</small></div>)}</div></section>
      <section className="operations-chart"><h2>Carga das equipes</h2><p>Quantidade de OS abertas por equipe</p><div className="dashboard-bars">{teams.map((t:any)=>{const count=openOrders.filter((o:any)=>o.team_id===t.id).length;return <div className="dashboard-bar-row" key={t.id}><span>{t.name}</span><div><i style={{width:`${count/maxTeams*100}%`,background:teamColor(t.id)}}/></div><strong>{count}</strong></div>;})}</div>{!teams.length&&<p>Nenhuma equipe cadastrada.</p>}<small>Uma equipe pode ter várias OS. A carga registrada não confirma disponibilidade de jornada.</small></section>
      <section className="operations-chart"><h2>Prioridade das demandas</h2><p>Distribuição das ocorrências abertas</p><div className="dashboard-bars">{priorities.map((p:any)=><div className="dashboard-bar-row" key={p.label}><span>{p.label}</span><div><i style={{width:`${p.value/Math.max(1,activeRows.length)*100}%`,background:p.label==="Emergencial"?"#db5350":p.label==="Alta"?"#d48c28":"#26896b"}}/></div><strong>{p.value}</strong></div>)}</div><div className="dashboard-neighborhoods"><h3>Maior concentração por bairro</h3>{neighborhoods.map(n=><span key={n.label}>{n.label}<strong>{n.value}</strong></span>)}{!neighborhoods.length&&<small>Nenhuma demanda aberta.</small>}</div></section>
    </div>
    <p className="dashboard-sync" role="status">{lastSync?`Última atualização: ${new Date(lastSync).toLocaleString("pt-BR")} · atualização automática a cada 15 segundos`:""}</p>
  </div>;
}
