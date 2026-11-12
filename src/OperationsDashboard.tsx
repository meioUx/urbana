import { useMemo, useState } from "react";
import { teamColor } from "./kanban-model.mjs";
import "./operations-dashboard.css";

const number = (v: number) => v.toLocaleString("pt-BR");
const states = [
  { status: "PROGRAMADA", label: "Programadas", color: "#d48c28" },
  { status: "EM_DESLOCAMENTO", label: "Em deslocamento", color: "#929527" },
  { status: "EM_EXECUCAO", label: "Em execução", color: "#3e86c8" },
  { status: "AGUARDANDO_VALIDACAO", label: "Em validação", color: "#8470b3" },
  { status: "DEVOLVIDA", label: "Devolvidas", color: "#a46a1c" },
];

/** Visão geral: indicadores agregados no servidor (`GET /api/dashboard`), sem listas de registros. */
export default function OperationsDashboard({
  dashboard,
  boot,
  lastSync,
  syncError,
  syncing,
  onRefresh,
}: any) {
  const [days, setDays] = useState(14);
  const openOrders = dashboard.open_orders;
  const teams = boot.catalogs.filter((c: any) => c.kind === "equipes");
  const overdue = dashboard.overdue;
  const byStatus = dashboard.orders_by_status;
  // O servidor envia os últimos 90 dias (no fuso do navegador); o seletor recorta o fim da série.
  const trend = useMemo(
    () =>
      dashboard.trend.slice(-days).map((t: any) => ({
        ...t,
        key: t.day,
        label: t.day.slice(8, 10) + "/" + t.day.slice(5, 7),
      })),
    [dashboard.trend, days],
  ) as { key: string; label: string; incoming: number; completed: number }[];
  const priorities = boot.priorities.map((label: string) => ({
    label,
    value: dashboard.open_by_priority[label] || 0,
  }));
  const neighborhoods = dashboard.open_by_neighborhood.map((n: any) => ({
    label: n.name,
    value: n.value,
  }));
  const statusData = states.map((s) => ({
    ...s,
    value: byStatus[s.status] || 0,
  }));
  const teamLoad = (id: string) => dashboard.open_orders_by_team[id] || 0;
  const maxTeams = Math.max(1, ...teams.map((t: any) => teamLoad(t.id)));
  const maxTrend = Math.max(
    1,
    ...trend.flatMap((t) => [t.incoming, t.completed]),
  );
  const plotY = (n: number) => 150 - (n / maxTrend) * 120;
  const plotX = (i: number) => 35 + (i / (days - 1)) * 520;
  const line = (kind: "incoming" | "completed") =>
    trend.map((t, i) => `${plotX(i)},${plotY(t[kind])}`).join(" ");
  return (
    <div className="operations-dashboard">
      <div className="dashboard-context">
        <span>Panorama atual das operações · indicadores consolidados</span>
        <button className="text-button" disabled={syncing} onClick={onRefresh}>
          {syncing ? "Atualizando..." : "Atualizar indicadores"}
        </button>
      </div>
      {syncError && (
        <div className="notice error" role="alert">
          {syncError}
        </div>
      )}
      <div className="operations-kpis">
        {[
          {
            label: "Demandas abertas",
            value: dashboard.open,
            detail: `${dashboard.emergency} emergenciais`,
            color: "#db5350",
          },
          {
            label: "Ordens abertas",
            value: openOrders,
            detail: `${dashboard.triage} demandas em triagem`,
            color: "#26896b",
          },
          {
            label: "Equipes em operação",
            value: dashboard.busy_teams,
            detail: `de ${teams.length} equipes cadastradas`,
            color: "#3e86c8",
          },
          {
            label: "Prazo vencido",
            value: overdue,
            detail: `${openOrders ? Math.round((overdue / openOrders) * 100) : 0}% das OS abertas`,
            color: "#b97521",
          },
          {
            label: "Aguardando validação",
            value: byStatus.AGUARDANDO_VALIDACAO || 0,
            detail: "Serviços enviados para análise",
            color: "#8470b3",
          },
          {
            label: "Serviços concluídos",
            value: byStatus.CONCLUIDA || 0,
            detail: "Total de OS atualmente concluídas",
            color: "#26896b",
          },
        ].map((k) => (
          <article
            className="operations-kpi"
            key={k.label}
            style={{ borderTopColor: k.color }}
          >
            <span>{k.label}</span>
            <strong>{number(k.value)}</strong>
            <small>{k.detail}</small>
          </article>
        ))}
      </div>
      <div className="operations-charts">
        <section className="operations-chart">
          <div className="chart-heading">
            <div>
              <h2>Evolução das operações</h2>
              <p>Novas demandas e OS validadas por dia</p>
            </div>
            <label>
              Período do gráfico
              <select
                aria-label="Período do gráfico"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={14}>14 dias</option>
                <option value={30}>30 dias</option>
                <option value={90}>90 dias</option>
              </select>
            </label>
          </div>
          <div className="chart-legend">
            <span>
              <i style={{ background: "#3e86c8" }} />
              Novas demandas: {trend.reduce((s, t) => s + t.incoming, 0)}
            </span>
            <span>
              <i style={{ background: "#26896b" }} />
              OS validadas: {trend.reduce((s, t) => s + t.completed, 0)}
            </span>
          </div>
          <svg
            viewBox="0 0 590 190"
            role="img"
            aria-label={`Evolução nos últimos ${days} dias: ${trend.reduce((s, t) => s + t.incoming, 0)} novas demandas e ${trend.reduce((s, t) => s + t.completed, 0)} OS validadas`}
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1="35"
                  x2="555"
                  y1={plotY(maxTrend * f)}
                  y2={plotY(maxTrend * f)}
                  stroke="#e1e9e4"
                />
                <text x="26" y={plotY(maxTrend * f) + 4} textAnchor="end">
                  {(maxTrend * f).toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })}
                </text>
              </g>
            ))}
            <polyline
              points={line("incoming")}
              stroke="#3e86c8"
              strokeWidth="3"
              fill="none"
            />
            <polyline
              points={line("completed")}
              stroke="#26896b"
              strokeWidth="3"
              fill="none"
            />
            {trend.map((t, i) => (
              <g key={t.key}>
                <circle
                  cx={plotX(i)}
                  cy={plotY(t.incoming)}
                  r="3"
                  fill="#3e86c8"
                >
                  <title>
                    {t.label}: {t.incoming} novas demandas
                  </title>
                </circle>
                <circle
                  cx={plotX(i)}
                  cy={plotY(t.completed)}
                  r="3"
                  fill="#26896b"
                >
                  <title>
                    {t.label}: {t.completed} OS validadas
                  </title>
                </circle>
              </g>
            ))}
            {[0, Math.floor((days - 1) / 2), days - 1].map((i) => (
              <text key={i} x={plotX(i)} y="176" textAnchor="middle">
                {trend[i].label}
              </text>
            ))}
          </svg>
          <small>
            Demandas e OS são unidades diferentes: uma OS pode reunir vários
            chamados. O período altera apenas este gráfico.
          </small>
        </section>
        <section className="operations-chart">
          <h2>Andamento das ordens</h2>
          <p>Distribuição das {openOrders} OS abertas</p>
          <div
            className="status-composition"
            role="img"
            aria-label={statusData
              .map((s) => `${s.label}: ${s.value}`)
              .join("; ")}
          >
            {statusData
              .filter((s) => s.value)
              .map((s) => (
                <span
                  key={s.status}
                  style={{
                    background: s.color,
                    width: `${(s.value / Math.max(1, openOrders)) * 100}%`,
                  }}
                  title={`${s.label}: ${s.value}`}
                />
              ))}
          </div>
          <div className="status-breakdown">
            {statusData.map((s) => (
              <div key={s.status}>
                <span>
                  <i style={{ background: s.color }} />
                  {s.label}
                </span>
                <strong>{s.value}</strong>
                <small>
                  {openOrders ? Math.round((s.value / openOrders) * 100) : 0}%
                </small>
              </div>
            ))}
          </div>
        </section>
        <section className="operations-chart">
          <h2>Carga das equipes</h2>
          <p>Quantidade de OS abertas por equipe</p>
          <div className="dashboard-bars">
            {teams.map((t: any) => {
              const count = teamLoad(t.id);
              return (
                <div className="dashboard-bar-row" key={t.id}>
                  <span>{t.name}</span>
                  <div>
                    <i
                      style={{
                        width: `${(count / maxTeams) * 100}%`,
                        background: teamColor(t.id),
                      }}
                    />
                  </div>
                  <strong>{count}</strong>
                </div>
              );
            })}
          </div>
          {!teams.length && <p>Nenhuma equipe cadastrada.</p>}
          <small>
            Uma equipe pode ter várias OS. A carga registrada não confirma
            disponibilidade de jornada.
          </small>
        </section>
        <section className="operations-chart">
          <h2>Prioridade das demandas</h2>
          <p>Distribuição das ocorrências abertas</p>
          <div className="dashboard-bars">
            {priorities.map((p: any) => (
              <div className="dashboard-bar-row" key={p.label}>
                <span>{p.label}</span>
                <div>
                  <i
                    style={{
                      width: `${(p.value / Math.max(1, dashboard.open)) * 100}%`,
                      background:
                        p.label === "Emergencial"
                          ? "#db5350"
                          : p.label === "Alta"
                            ? "#d48c28"
                            : "#26896b",
                    }}
                  />
                </div>
                <strong>{p.value}</strong>
              </div>
            ))}
          </div>
          <div className="dashboard-neighborhoods">
            <h3>Maior concentração por bairro</h3>
            {neighborhoods.map((n: any) => (
              <span key={n.label}>
                {n.label}
                <strong>{n.value}</strong>
              </span>
            ))}
            {!neighborhoods.length && <small>Nenhuma demanda aberta.</small>}
          </div>
        </section>
      </div>
      <p className="dashboard-sync">
        {lastSync
          ? `Última atualização: ${new Date(lastSync).toLocaleString("pt-BR")} · atualização automática a cada 15 segundos`
          : ""}
      </p>
    </div>
  );
}
