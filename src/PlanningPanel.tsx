import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  GitCompareArrows,
  MapPin,
  Search,
  Users,
  X,
} from "lucide-react";
import {
  activePlan,
  buildWorkCandidates,
  filterWorkCandidates,
  occurrenceDeadline,
  unscheduledPlanMembers,
} from "./planning-model.mjs";
import { summarizeTeam } from "./dispatch-model.mjs";
import PlanningPlanDialog from "./PlanningPlanDialog";
import "./planning.css";

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const date = (value: string | null) =>
  value ? value.slice(0, 10).split("-").reverse().join("/") : "Sem data";
const age = (value: number | null) =>
  value === null
    ? "Sem registro de idade"
    : `${Math.floor(value)} ${Math.floor(value) === 1 ? "dia" : "dias"} de espera`;
const labels: Record<string, string> = {
  IDENTIFICADA: "Aguarda triagem",
  EM_TRIAGEM: "Pronta para programar",
  PROGRAMADA: "Programada",
  EM_DESLOCAMENTO: "Em deslocamento",
  EM_EXECUCAO: "Em execução",
  AGUARDANDO_VALIDACAO: "Em validação",
  DEVOLVIDA: "Devolvida",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
  RECUSADA: "Recusada",
};
function Priority({ value }: { value: string }) {
  return <span className={`work-priority priority-${value}`}>{value}</span>;
}

export function PlanningTeamCapacity({
  boot,
  orders,
  sectorId,
  date,
  selectedTeam = "",
  onChoose,
  disabled = false,
}: any) {
  const teams = boot.catalogs
    .filter((c: any) => c.kind === "equipes" && c.sector_id === sectorId)
    .map((team: any) => ({ team, load: summarizeTeam(orders, team.id, date) }))
    .sort(
      (a: any, b: any) =>
        a.load.onDate - b.load.onDate ||
        a.load.running - b.load.running ||
        a.load.open - b.load.open ||
        a.team.name.localeCompare(b.team.name),
    );
  return (
    <section
      className="planning-capacity"
      aria-label="Carga das equipes para planejamento"
    >
      <h3>
        <Users size={16} />
        Equipes do setor
      </h3>
      <p>Compare os serviços registrados para a data escolhida.</p>
      {teams.length === 0 ? (
        <p className="planning-note">Nenhuma equipe cadastrada neste setor.</p>
      ) : (
        <div className="planning-team-options">
          {teams.map(({ team, load }: any) => (
            <article
              key={team.id}
              className={selectedTeam === team.id ? "selected" : ""}
            >
              <div>
                <strong>{team.name}</strong>
                <small>
                  {load.onDate} OS na data · {load.open} abertas
                </small>
                <small>
                  {load.running} em operação
                  {load.overdue ? ` · ${load.overdue} atrasadas` : ""}
                </small>
              </div>
              {onChoose && (
                <button
                  type="button"
                  className="planning-select-team"
                  aria-label={`Usar ${team.name} no planejamento`}
                  disabled={disabled}
                  onClick={() => onChoose(team)}
                >
                  <ArrowRight size={17} />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      <small className="planning-capacity-footnote">
        A carga registrada ajuda a decidir; confirme jornada e recursos com a
        equipe.
      </small>
    </section>
  );
}

export default function PlanningPanel({
  planning,
  boot,
  orders,
  canSchedule,
  api,
  onRefresh,
  onOpen,
  onSchedule,
  onOrders,
  renderMap,
}: any) {
  const [tab, setTab] = useState("choose"),
    [query, setQuery] = useState(""),
    [sector, setSector] = useState(""),
    [neighborhood, setNeighborhood] = useState(""),
    [readiness, setReadiness] = useState("all"),
    [sort, setSort] = useState("priority");
  const [referenceDate, setReferenceDate] = useState(localDate),
    [focusKey, setFocusKey] = useState(""),
    [compareKeys, setCompareKeys] = useState<string[]>([]),
    [compareOpen, setCompareOpen] = useState(false),
    [mapOpen, setMapOpen] = useState(false);
  const [planFilter, setPlanFilter] = useState("active"),
    [proposal, setProposal] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [latest, setLatest] = useState(""),
    [refreshing, setRefreshing] = useState(false);
  const candidates = useMemo(
    () => buildWorkCandidates(planning.groups, boot.catalogs, orders),
    [planning.groups, boot.catalogs, orders],
  );
  const filtered = filterWorkCandidates(candidates, {
    query,
    sector,
    neighborhood,
    readiness,
    sort,
  });
  const focused = filtered.find((c) => c.key === focusKey) || filtered[0];
  const compared = compareKeys
    .map((key) => candidates.find((c) => c.key === key))
    .filter(Boolean);
  const readyCount = candidates.filter((c) => c.ready.length > 0).length,
    waitingCount = candidates.reduce((n, c) => n + c.waiting.length, 0);
  const activePlans = planning.plans.filter(activePlan);
  const name = (id: string) =>
    boot.catalogs.find((c: any) => c.id === id)?.name || "Sem equipe";
  const planRows = planning.plans
    .filter(
      (p: any) =>
        (planFilter !== "active" || activePlan(p)) &&
        (planFilter !== "closed" || !activePlan(p)) &&
        (planFilter !== "unscheduled" ||
          unscheduledPlanMembers(p).length > 0) &&
        (!sector || p.occurrences.some((o: any) => o.sector_id === sector)) &&
        (!query.trim() ||
          `${p.code} ${p.street} ${p.neighborhood} ${p.objective} ${p.responsible}`
            .toLocaleLowerCase("pt-BR")
            .includes(query.trim().toLocaleLowerCase("pt-BR"))),
    )
    .sort(
      (a: any, b: any) =>
        Number(activePlan(b)) - Number(activePlan(a)) ||
        a.scheduled_at.localeCompare(b.scheduled_at),
    );
  const refresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      await onRefresh();
      setMessage("Planejamento atualizado.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  };
  const propose = (candidate: any, team = "") => {
    setError("");
    setProposal({ candidate, team });
  };
  return (
    <div className="planning-workspace">
      <div
        className="planning-tabs"
        role="tablist"
        aria-label="Etapas do planejamento"
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const next = e.key === "Home" ? "choose" : e.key === "End" ? "plans" : tab === "choose" ? "plans" : "choose";
          setTab(next);
          const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("button");
          buttons[next === "choose" ? 0 : 1]?.focus();
        }}
      >
        <button
          role="tab"
          tabIndex={tab === "choose" ? 0 : -1}
          aria-selected={tab === "choose"}
          aria-controls="planning-choice"
          onClick={() => setTab("choose")}
        >
          Escolher obras<span>{candidates.length}</span>
        </button>
        <button
          role="tab"
          tabIndex={tab === "plans" ? 0 : -1}
          aria-selected={tab === "plans"}
          aria-controls="planning-execution"
          onClick={() => setTab("plans")}
        >
          Planos e execução<span>{activePlans.length}</span>
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          <span>{error}</span>
          <button
            className="text-button"
            disabled={refreshing}
            onClick={refresh}
          >
            Atualizar dados
          </button>
        </div>
      )}
      {message && (
        <p className="planning-success" role="status">
          <CheckCircle2 size={16} />
          {message}
          <button
            className="icon"
            aria-label="Dispensar aviso do planejamento"
            onClick={() => setMessage("")}
          >
            <X size={15} />
          </button>
        </p>
      )}
      <div className="planning-overview" aria-label="Resumo do planejamento">
        <span>
          <strong>{candidates.length}</strong> intervenções disponíveis
        </span>
        <span>
          <strong>{readyCount}</strong> com demandas triadas
        </span>
        <span>
          <strong>{waitingCount}</strong> demandas aguardam triagem
        </span>
        <span>
          <strong>{activePlans.length}</strong> planos em andamento
        </span>
      </div>
      <div className="planning-toolbar">
        <label className="planning-search">
          <Search size={17} />
          <input
            aria-label="Buscar rua no planejamento"
            placeholder="Rua, bairro, serviço ou código..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Setor do planejamento"
          value={sector}
          onChange={(e) => setSector(e.target.value)}
        >
          <option value="">Todos os setores</option>
          {boot.catalogs
            .filter((c: any) => c.kind === "setores")
            .map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        {tab === "choose" ? (
          <>
            <select
              aria-label="Situação das demandas no planejamento"
              value={readiness}
              onChange={(e) => setReadiness(e.target.value)}
            >
              <option value="all">Todas as demandas disponíveis</option>
              <option value="ready">Com triagem concluída</option>
              <option value="triage">Com triagem pendente</option>
            </select>
            <select
              aria-label="Ordenar obras"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="priority">Prioridade e prazo</option>
              <option value="deadline">Prazo mais próximo</option>
              <option value="volume">Mais demandas juntas</option>
              <option value="age">Maior tempo de espera</option>
            </select>
          </>
        ) : (
          <select
            aria-label="Situação dos planos"
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
          >
            <option value="active">Planos em andamento</option>
            <option value="unscheduled">Com demandas para programar</option>
            <option value="closed">Planos encerrados</option>
            <option value="all">Todos os planos</option>
          </select>
        )}
      </div>
      {tab === "choose" ? (
        <section
          id="planning-choice"
          role="tabpanel"
          aria-label="Escolher obras"
        >
          <div className="planning-choice-controls">
            <div>
              <label>
                <CalendarDays size={15} />
                Data de referência
                <input
                  type="date"
                  aria-label="Data de referência do planejamento"
                  value={referenceDate}
                  onChange={(e) => setReferenceDate(e.target.value)}
                />
              </label>
              <select
                aria-label="Bairro do planejamento"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
              >
                <option value="">Todos os bairros</option>
                {[...new Set(candidates.map((c) => c.neighborhood))]
                  .sort()
                  .map((n: any) => (
                    <option key={n}>{n}</option>
                  ))}
              </select>
            </div>
            <button
              className="button secondary"
              aria-expanded={compareOpen}
              disabled={compared.length === 0}
              onClick={() => setCompareOpen(!compareOpen)}
            >
              <GitCompareArrows size={16} />
              Comparar opções ({compared.length}/3)
            </button>
          </div>
          <details className="planning-criteria">
            <summary>Como as sugestões são organizadas?</summary>
            <p>
              Emergenciais ficam primeiro. A ordenação padrão considera
              prioridade, prazos vencidos, prazo mais próximo e quantidade de
              demandas. A concentração de duas ou mais demandas eleva a
              prioridade sugerida para Alta, preservando emergenciais. As
              sugestões são separadas por rua, bairro e setor. Serviços já
              incluídos em planos ou OS ficam fora desta lista.
            </p>
            <p>
              A data de referência serve para comparar a agenda das equipes; os
              prazos são calculados a partir do registro e do SLA da categoria.
            </p>
          </details>
          {compareOpen && (
            <section
              className="planning-comparison"
              aria-label="Comparação das obras"
            >
              <div className="planning-section-heading">
                <h2>Compare antes de decidir</h2>
                <button
                  className="text-button"
                  onClick={() => {
                    setCompareKeys([]);
                    setCompareOpen(false);
                  }}
                >
                  Limpar comparação
                </button>
              </div>
              {compared.length < 2 && (
                <p>
                  Marque mais uma intervenção para comparar as opções lado a
                  lado.
                </p>
              )}
              <div className="planning-compare-grid">
                {compared.map((c: any) => (
                  <article key={c.key}>
                    <div>
                      <h3>{c.street}</h3>
                      <button
                        className="icon"
                        aria-label={`Remover ${c.street} da comparação`}
                        onClick={() =>
                          setCompareKeys((keys) =>
                            keys.filter((k) => k !== c.key),
                          )
                        }
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <p>
                      {c.neighborhood} · {c.sector_name}
                    </p>
                    <Priority value={c.priority} />
                    <dl>
                      <div>
                        <dt>Demandas prontas</dt>
                        <dd>{c.ready.length}</dd>
                      </div>
                      <div>
                        <dt>Aguardam triagem</dt>
                        <dd>{c.waiting.length}</dd>
                      </div>
                      <div>
                        <dt>Prazos vencidos</dt>
                        <dd>{c.overdue}</dd>
                      </div>
                      <div>
                        <dt>Prazo mais próximo</dt>
                        <dd>{date(c.earliest_due_at)}</dd>
                      </div>
                      <div>
                        <dt>Maior espera</dt>
                        <dd>{age(c.age_days)}</dd>
                      </div>
                    </dl>
                    <p>{c.categories.join(" · ")}</p>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setFocusKey(c.key);
                        setQuery("");
                        setSector("");
                        setNeighborhood("");
                        setReadiness("all");
                        setCompareOpen(false);
                      }}
                    >
                      Analisar esta opção
                      <ChevronRight size={15} />
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}
          <div className="planning-decision-grid">
            <div className="planning-candidate-list">
              <div className="planning-section-heading">
                <h2>Onde intervir</h2>
                <span>{filtered.length} opções</span>
              </div>
              {filtered.map((c: any, index: number) => (
                <article
                  key={c.key}
                  data-candidate-key={c.key}
                  className={`planning-candidate ${focused?.key === c.key ? "selected" : ""}`}
                >
                  <div className="planning-candidate-top">
                    <span>
                      #{index + 1} · {c.sector_name}
                    </span>
                    <label className="planning-compare-check">
                      <input
                        aria-label={`Comparar ${c.street} · ${c.sector_name}`}
                        type="checkbox"
                        checked={compareKeys.includes(c.key)}
                        disabled={
                          !compareKeys.includes(c.key) && compared.length >= 3
                        }
                        onChange={(e) =>
                          setCompareKeys((keys) =>
                            e.target.checked
                              ? [...keys, c.key]
                              : keys.filter((k) => k !== c.key),
                          )
                        }
                      />
                      Comparar
                    </label>
                  </div>
                  <button
                    className="planning-candidate-main"
                    aria-pressed={focused?.key === c.key}
                    aria-label={`Analisar ${c.street} · ${c.sector_name}`}
                    onClick={() => setFocusKey(c.key)}
                  >
                    <span>
                      <strong>{c.street}</strong>
                      <small>
                        {c.neighborhood} · {c.categories.join(" · ")}
                      </small>
                    </span>
                    <Priority value={c.priority} />
                  </button>
                  <div className="planning-candidate-facts">
                    <span>
                      <strong>{c.ready.length}</strong> prontas
                    </span>
                    <span>
                      <strong>{c.waiting.length}</strong> aguardam triagem
                    </span>
                    <span className={c.overdue ? "late" : ""}>
                      {c.overdue
                        ? `${c.overdue} prazos vencidos`
                        : `Prazo: ${date(c.earliest_due_at)}`}
                    </span>
                  </div>
                  <p className="planning-candidate-reason">
                    {c.reasons.join(" · ")}
                  </p>
                </article>
              ))}
              {filtered.length === 0 && (
                <div className="planning-empty">
                  <h3>Nenhuma intervenção nestes filtros</h3>
                  <p>
                    Demandas reservadas em planos aparecem em Planos e execução. Atendimentos já programados podem ser consultados em Ordens de serviço.
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setQuery("");
                      setSector("");
                      setNeighborhood("");
                      setReadiness("all");
                    }}
                  >
                    Limpar filtros do planejamento
                  </button>
                </div>
              )}
            </div>
            {focused && (
              <aside
                className="planning-analysis"
                aria-label="Análise da intervenção selecionada"
              >
                <div className="planning-analysis-heading">
                  <small>INTERVENÇÃO EM ANÁLISE</small>
                  <h2>{focused.street}</h2>
                  <p>
                    {focused.neighborhood} · {focused.sector_name}
                  </p>
                  <Priority value={focused.priority} />
                </div>
                <div className="planning-analysis-reasons">
                  <h3>Por que considerar esta obra?</h3>
                  <ul>
                    {focused.reasons.map((reason: string) => (
                      <li key={reason}>{reason}</li>
                    ))}
                    <li>{age(focused.age_days)}</li>
                  </ul>
                  {focused.grouped_priority && (
                    <small>
                      A prioridade Alta é uma sugestão pela concentração de
                      demandas.
                    </small>
                  )}
                </div>
                <div className="planning-readiness">
                  <strong>
                    {focused.ready.length} demandas prontas para programar
                  </strong>
                  {focused.waiting.length > 0 && (
                    <span>
                      {focused.waiting.length} precisam concluir a triagem.
                    </span>
                  )}
                </div>
                <details className="planning-demand-details">
                  <summary>
                    Conferir demandas ({focused.occurrences.length})
                  </summary>
                  {focused.occurrences.map((o: any) => (
                    <button
                      className="planning-demand-link"
                      key={o.id}
                      onClick={() => onOpen("occurrence", o.id)}
                    >
                      <span>
                        <strong>{o.code}</strong>
                        <small>{o.address}</small>
                        <small>
                          {labels[o.status]} ·{" "}
                          {date(occurrenceDeadline(o, boot.catalogs))}
                        </small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </details>
                <button
                  className="planning-map-toggle"
                  aria-expanded={mapOpen}
                  onClick={() => setMapOpen(!mapOpen)}
                >
                  <MapPin size={15} />
                  {mapOpen ? "Ocultar localização" : "Ver localização no mapa"}
                </button>
                {mapOpen && renderMap(focused.occurrences)}
                <PlanningTeamCapacity
                  boot={boot}
                  orders={orders}
                  sectorId={focused.sector_id}
                  date={referenceDate}
                  onChoose={
                    canSchedule && focused.ready.length > 0
                      ? (team: any) => propose(focused, team.id)
                      : undefined
                  }
                />
                {canSchedule && (
                  <button
                    className="button primary planning-main-action"
                    onClick={() => propose(focused)}
                  >
                    Planejar esta obra
                    <ArrowRight size={16} />
                  </button>
                )}
                {focused.ready.length === 0 && (
                  <button
                    className="button secondary"
                    onClick={() => onOpen("occurrence", focused.waiting[0].id)}
                  >
                    Conferir triagem
                  </button>
                )}
                <small className="planning-analysis-footnote">
                  O formulário permite escolher o escopo, salvar só o plano ou
                  emitir a OS.
                </small>
              </aside>
            )}
          </div>
        </section>
      ) : (
        <section
          id="planning-execution"
          role="tabpanel"
          aria-label="Planos e execução"
        >
          <div className="planning-section-heading">
            <h2>Da decisão à entrega</h2>
            <span>{planRows.length} planos</span>
            <button type="button" className="button secondary" onClick={onOrders}>Ver todas as ordens</button>
          </div>
          <div className="planning-plan-grid">
            {planRows.map((p: any) => {
              const available = unscheduledPlanMembers(p),
                waiting = p.occurrences.filter(
                  (o: any) => o.status === "IDENTIFICADA",
                ),
                active = activePlan(p);
              return (
                <article
                  key={p.id}
                  data-plan-id={p.id}
                  className={`planning-plan ${latest === p.id ? "recent" : ""}`}
                >
                  <div className="planning-plan-heading">
                    <strong>{p.code}</strong>
                    <span>{p.status}</span>
                  </div>
                  <h3>{p.street}</h3>
                  <p className="planning-plan-location">
                    {p.neighborhood} ·{" "}
                    {Array.from(new Set(p.occurrences.map((o: any) => name(o.sector_id)))).join(", ")}
                  </p>
                  <p className="planning-plan-objective">{p.objective}</p>
                  <div className="planning-plan-metadata">
                    <span>
                      <CalendarDays size={14} />
                      Data alvo: {date(p.scheduled_at)}
                    </span>
                    <span>
                      <Users size={14} />
                      {p.responsible}
                    </span>
                  </div>
                  <progress
                    aria-label={`Progresso do plano ${p.code}`}
                    value={p.completed}
                    max={Math.max(1, p.occurrences.length)}
                  />
                  <p className="planning-progress-caption">
                    {p.completed}/{p.occurrences.length} demandas concluídas
                    {p.cancelled ? ` · ${p.cancelled} canceladas` : ""}
                    {p.rejected ? ` · ${p.rejected} recusadas` : ""}
                  </p>
                  {available.length > 0 && (
                    <p className="planning-note">
                      {available.length} demandas triadas ainda sem OS.
                    </p>
                  )}
                  {waiting.length > 0 && (
                    <p className="planning-note warning">
                      {waiting.length} demandas aguardam triagem.
                    </p>
                  )}
                  <div className="planning-plan-orders">
                    {p.orders.map((o: any) => (
                      <button key={o.id} onClick={() => onOpen("order", o.id)}>
                        <span>
                          <strong>{o.code}</strong>
                          <small>
                            {name(o.team_id)} · {date(o.scheduled_at)}
                          </small>
                        </span>
                        <span>{labels[o.status]}</span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                  <details>
                    <summary>
                      Demandas do plano ({p.occurrences.length})
                    </summary>
                    {p.occurrences.map((o: any) => (
                      <button
                        key={o.id}
                        className="planning-demand-link"
                        onClick={() => onOpen("occurrence", o.id)}
                      >
                        <span>
                          <strong>{o.code}</strong>
                          <small>
                            {o.address} · {labels[o.status]}
                          </small>
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </details>
                  <div className="planning-plan-actions">
                    {canSchedule && available.length > 0 && (
                      <button
                        className="button primary"
                        onClick={() => onSchedule(p)}
                      >
                        Programar ordem de serviço
                      </button>
                    )}
                    {active && waiting.length > 0 && (
                      <button
                        className="button secondary"
                        onClick={() => onOpen("occurrence", waiting[0].id)}
                      >
                        Conferir triagem
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {planRows.length === 0 && (
            <div className="planning-empty">
              <h3>Nenhum plano neste filtro</h3>
              <p>
                Escolha uma intervenção e defina o escopo para iniciar o
                planejamento.
              </p>
              <button
                className="button secondary"
                onClick={() => {
                  setTab("choose");
                  setQuery("");
                }}
              >
                Escolher obras
              </button>
            </div>
          )}
        </section>
      )}
      {proposal && (
        <PlanningPlanDialog
          candidate={proposal.candidate}
          presetTeam={proposal.team}
          referenceDate={referenceDate}
          boot={boot}
          orders={orders}
          onClose={() => setProposal(null)}
          onOpen={onOpen}
          onSave={async (path: string, payload: any) => {
            const result = await api(path, "POST", payload);
            setProposal(null);
            setLatest(result.plan_id || result.id);
            setMessage(
              path === "/ordens-servico"
                ? "Plano e ordem de serviço salvos. A equipe recebeu a programação."
                : "Plano salvo. As demandas ficam reservadas para esta intervenção.",
            );
            setTab("plans");
            setQuery("");
            setPlanFilter("active");
            setCompareKeys((keys) =>
              keys.filter((k) => k !== proposal.candidate.key),
            );
            try {
              await onRefresh();
            } catch {
              setError(
                "O planejamento foi salvo, mas a atualização falhou. Atualize os dados antes de continuar.",
              );
            }
          }}
        />
      )}
    </div>
  );
}
