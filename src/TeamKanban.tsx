import { useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Filter,
  GripVertical,
  Search,
  Settings2,
  Users,
  X,
} from "lucide-react";
import {
  availableMoves,
  buildKanbanCards,
  cardKey,
  closedStatus,
  flowMetrics,
  kanbanColumns,
  sortKanbanCards,
  teamColor,
} from "./kanban-model.mjs";
import { summarizeTeam } from "./dispatch-model.mjs";
import KanbanMoveDialog from "./KanbanMoveDialog";
import "./team-kanban.css";

const date = (value: string) =>
  value ? value.slice(0, 10).split("-").reverse().join("/") : "Sem data";
const days = (value: number | null) =>
  value === null
    ? "—"
    : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`;
export default function TeamKanban({
  rows,
  orders,
  boot,
  can,
  onOpen,
  api,
  onRefresh,
}: any) {
  const [team, setTeam] = useState(""),
    [sector, setSector] = useState(""),
    [query, setQuery] = useState(""),
    [priority, setPriority] = useState(""),
    [showClosed, setShowClosed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false),
    [loadsOpen, setLoadsOpen] = useState(false),
    [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [dragging, setDragging] = useState<string | null>(null),
    [hover, setHover] = useState<{ status: string; before?: string } | null>(
      null,
    );
  const [touchGhost, setTouchGhost] = useState<{
    x: number;
    y: number;
    code: string;
  } | null>(null);
  const [pending, setPending] = useState<any>(null),
    [limitsDraft, setLimitsDraft] = useState<Record<string, number>>({});
  const board = useRef<HTMLDivElement>(null),
    dragRef = useRef<string | null>(null),
    touchTarget = useRef<{ status: string; before?: string } | null>(null);
  const config = boot.kanban || { revision: 0, limits: {}, order: {} };
  const canSort = can("classify") || can("schedule") || can("validate");
  const teams = boot.catalogs.filter(
    (t: any) => t.kind === "equipes" && (!sector || t.sector_id === sector),
  );
  const name = (id: string) =>
    boot.catalogs.find((c: any) => c.id === id)?.name || "Sem equipe";
  const cards = useMemo(
    () => sortKanbanCards(buildKanbanCards(rows, orders), config.order),
    [rows, orders, config.order],
  );
  const scoped = cards.filter(
    (card) =>
      (!sector || card.sector_id === sector) &&
      (!team ||
        (team === "unassigned" ? !card.team_id : card.team_id === team)),
  );
  const metrics = flowMetrics(scoped);
  const filtered = scoped.filter(
    (card) =>
      (!priority || card.priority === priority) &&
      (showClosed || !closedStatus(card.status)) &&
      (!query.trim() ||
        [
          card.code,
          card.responsible,
          name(card.team_id),
          ...card.occurrences.flatMap((o: any) => [
            o.address,
            o.neighborhood,
            o.description,
            o.code,
          ]),
        ].some((v) =>
          String(v || "")
            .toLocaleLowerCase("pt-BR")
            .includes(query.trim().toLocaleLowerCase("pt-BR")),
        )),
  );
  const dragCard = cards.find((c) => cardKey(c) === dragging);
  const activeFilters =
    Number(!!sector) + Number(!!priority) + Number(showClosed);
  const resetDrag = () => {
    dragRef.current = null;
    touchTarget.current = null;
    setDragging(null);
    setHover(null);
    setTouchGhost(null);
  };
  const validTarget = (card: any, status: string) =>
    card &&
    (card.status === status
      ? canSort
      : availableMoves(card, can).some((m) => m.status === status));
  const fullCount = (status: string) =>
    cards.filter((c) => c.status === status).length;
  const capacity = (status: string) =>
    !config.limits[status] || fullCount(status) < config.limits[status];
  const action = (card: any) => {
    if (card.status === "IDENTIFICADA" && can("classify"))
      return "Fazer triagem";
    if (card.status === "EM_TRIAGEM" && can("schedule"))
      return "Programar equipe";
    if (card.status === "EM_TRIAGEM" && can("classify"))
      return "Revisar triagem";
    if (card.status === "DEVOLVIDA" && can("schedule"))
      return "Reprogramar equipe";
    if (card.status === "AGUARDANDO_VALIDACAO" && can("validate"))
      return "Analisar resultado";
    return "Abrir detalhes";
  };
  const perform = async (fn: () => Promise<any>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(success);
      try {
        await onRefresh();
      } catch {
        setError(
          "A alteração foi salva, mas o quadro não foi atualizado. Atualize os dados antes de continuar.",
        );
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const reorder = async (card: any, before?: string) => {
    const keys = cards.filter((c) => c.status === card.status).map(cardKey),
      key = cardKey(card);
    if (before === key) return;
    const next = keys.filter((k) => k !== key),
      index = before ? next.indexOf(before) : next.length;
    next.splice(index < 0 ? next.length : index, 0, key);
    if (keys.every((k, i) => k === next[i])) return;
    await perform(
      () =>
        api("/kanban/ordem", "POST", {
          revision: config.revision,
          status: card.status,
          keys: next,
        }),
      "Ordem dos cartões salva para toda a equipe.",
    );
  };
  const moveTo = (card: any, status: string) => {
    if (busy || pending) return;
    const move = availableMoves(card, can).find((m) => m.status === status);
    if (!move) {
      setError(
        "Esta movimentação não está disponível para a etapa ou para o seu perfil.",
      );
      return;
    }
    if (!capacity(status)) {
      setError(
        `${move.label} atingiu o limite de trabalho. Libere uma vaga antes de receber outro cartão.`,
      );
      return;
    }
    setError("");
    setMessage("");
    setPending({ card, move });
  };
  const drop = (status: string, before?: string) => {
    const card = cards.find((c) => cardKey(c) === dragRef.current);
    resetDrag();
    if (!card || busy || pending) return;
    if (card.status === status && canSort) void reorder(card, before);
    else moveTo(card, status);
  };
  const edgeScroll = (x: number, y: number) => {
    const el = board.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (x > rect.right - 55) el.scrollLeft += 18;
    else if (x < rect.left + 55) el.scrollLeft -= 18;
    const column = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>(".kanban-column");
    if (column) {
      const bounds = column.getBoundingClientRect();
      if (y > bounds.bottom - 45) column.scrollTop += 14;
      else if (y < bounds.top + 45) column.scrollTop -= 14;
    }
  };
  return (
    <div className="team-kanban" aria-busy={busy}>
      <div className="kanban-toolbar">
        <label className="kanban-search">
          <Search size={17} />
          <input
            aria-label="Buscar no quadro"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cartões..."
          />
        </label>
        <label className="kanban-team-select">
          <Users size={17} />
          <select
            aria-label="Equipe do quadro"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">Todas as equipes</option>
            <option value="unassigned">Sem equipe · triagem</option>
            {teams.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`kanban-tool ${filtersOpen || activeFilters ? "selected" : ""}`}
          aria-expanded={filtersOpen}
          aria-controls="kanban-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <Filter size={16} />
          Filtros{activeFilters > 0 && <b>{activeFilters}</b>}
        </button>
        <button
          className="kanban-tool"
          aria-expanded={loadsOpen}
          aria-controls="kanban-loads"
          onClick={() => setLoadsOpen(!loadsOpen)}
        >
          <Users size={16} />
          Carga das equipes
        </button>
        <button
          className={`kanban-tool ${rulesOpen ? "selected" : ""}`}
          aria-expanded={rulesOpen}
          aria-controls="kanban-rules"
          onClick={() => {
            setLimitsDraft({ ...config.limits });
            setRulesOpen(!rulesOpen);
          }}
        >
          <Settings2 size={16} />
          Regras do quadro
        </button>
      </div>
      {filtersOpen && (
        <div id="kanban-filters" className="kanban-filters">
          <label>
            Setor do quadro
            <select
              aria-label="Setor do quadro"
              value={sector}
              onChange={(e) => {
                setSector(e.target.value);
                setTeam("");
              }}
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
          </label>
          <label>
            Prioridade do quadro
            <select
              aria-label="Prioridade do quadro"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="">Todas as prioridades</option>
              {boot.priorities.map((p: string) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="kanban-checkbox">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
            />
            Mostrar encerradas (concluídas, canceladas e recusadas)
          </label>
          <button
            className="kanban-tool"
            onClick={() => {
              setQuery("");
              setTeam("");
              setSector("");
              setPriority("");
              setShowClosed(false);
            }}
          >
            <X size={16} />
            Limpar quadro
          </button>
        </div>
      )}
      {loadsOpen && (
        <div
          id="kanban-loads"
          className="kanban-team-load"
          aria-label="Cores e carga das equipes"
        >
          <button
            style={{ borderLeftColor: teamColor("") }}
            aria-pressed={team === "unassigned"}
            onClick={() => setTeam(team === "unassigned" ? "" : "unassigned")}
          >
            <strong>Sem equipe</strong>
            <span>
              {
                cards.filter(
                  (c) =>
                    !c.team_id &&
                    !closedStatus(c.status) &&
                    (!sector || c.sector_id === sector),
                ).length
              }{" "}
              demandas abertas
            </span>
          </button>
          {teams.map((t: any) => {
            const load = summarizeTeam(orders, t.id, "");
            return (
              <button
                key={t.id}
                style={{ borderLeftColor: teamColor(t.id) }}
                aria-pressed={team === t.id}
                onClick={() => setTeam(team === t.id ? "" : t.id)}
              >
                <strong>{t.name}</strong>
                <span>
                  {load.open} OS · {load.calls} chamados
                </span>
                <small>
                  {load.running} em operação · {load.scheduled} programadas ·{" "}
                  {load.review} em validação
                </small>
              </button>
            );
          })}
        </div>
      )}
      {rulesOpen && (
        <section
          id="kanban-rules"
          className="kanban-rules"
          aria-label="Regras do quadro"
        >
          <div>
            <h2>Acordos de trabalho</h2>
            <p>
              Uma demanda é um cartão até a programação. Depois, cada OS é um
              cartão, mesmo com vários chamados. O trabalho começa na
              programação e termina na validação.
            </p>
            <p>
              Puxe trabalho quando houver capacidade. Arraste na mesma coluna
              para ordenar; entre colunas, confirme a etapa. Os requisitos de
              fotos, materiais e aprovação continuam obrigatórios.
            </p>
            <p>
              Na reunião diária, confira prazos, devoluções e os cartões mais
              antigos antes de iniciar novos serviços. A idade e o tempo de
              ciclo incluem espera e reprogramações; cancelamentos e recusas não
              contam como entregas.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(
                () =>
                  api("/kanban", "PATCH", {
                    revision: config.revision,
                    limits: limitsDraft,
                  }),
                "Limites de trabalho atualizados.",
              );
            }}
          >
            <h3>Limites de trabalho por etapa</h3>
            <p>
              Compartilhados por todos os setores e equipes. Zero significa sem
              limite. O servidor impede novas entradas quando a etapa está
              cheia, inclusive fora do quadro.
            </p>
            <div className="kanban-limit-grid">
              {kanbanColumns
                .filter((c) => !closedStatus(c.status))
                .map((col) => (
                  <label key={col.status}>
                    {col.title}
                    <input
                      type="number"
                      aria-label={`Limite de ${col.title}`}
                      min={0}
                      max={999}
                      step={1}
                      required
                      disabled={!can("schedule") || busy}
                      value={limitsDraft[col.status] || 0}
                      onChange={(e) =>
                        setLimitsDraft((d) => ({
                          ...d,
                          [col.status]: Number(e.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
            </div>
            {can("schedule") && (
              <button className="button primary" disabled={busy}>
                Salvar limites
              </button>
            )}
          </form>
        </section>
      )}
      <div className="kanban-flow" aria-label="Indicadores de fluxo">
        <span>
          <strong>{metrics.wip}</strong> OS em andamento
        </span>
        <span>
          <strong>{metrics.throughput}</strong> entregas · 30 dias
        </span>
        <span>
          <strong>{days(metrics.oldest)}</strong> OS mais antiga
        </span>
        <span>
          <strong>{days(metrics.cycle)}</strong> ciclo médio · 30 dias
        </span>
      </div>
      {error && (
        <div className="notice error" role="alert">
          <span>{error}</span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void perform(onRefresh, "Quadro atualizado.")}
          >
            Atualizar quadro
          </button>
        </div>
      )}
      <div className="kanban-caption">
        <span role="status" aria-live="polite">
          {message || `${filtered.length} cartões · atualizado automaticamente`}
        </span>
        <span>Arraste para ordenar ou mudar de etapa</span>
      </div>
      <div
        ref={board}
        className="kanban-board"
        role="region"
        aria-label="Quadro de gestão das equipes"
        tabIndex={0}
      >
        {kanbanColumns
          .filter((col) => showClosed || !closedStatus(col.status))
          .map((col) => {
            const members = filtered.filter((c) => c.status === col.status),
              limit = config.limits[col.status] || 0,
              count = fullCount(col.status);
            const target =
                dragging &&
                validTarget(dragCard, col.status) &&
                (dragCard.status === col.status || capacity(col.status)),
              isOver = target && hover?.status === col.status;
            return (
              <section
                className={`kanban-column ${target ? "can-drop" : ""} ${isOver ? "drop-over" : ""} ${limit && count >= limit ? "at-capacity" : ""}`}
                key={col.status}
                data-status={col.status}
                aria-label={col.title}
                onDragOver={(e) => {
                  if (!dragRef.current) return;
                  e.preventDefault();
                  edgeScroll(e.clientX, e.clientY);
                  const card = cards.find(
                    (c) => cardKey(c) === dragRef.current,
                  );
                  e.dataTransfer.dropEffect = validTarget(card, col.status)
                    ? "move"
                    : "none";
                  setHover({ status: col.status });
                }}
                onDrop={(e) => {
                  if (!dragRef.current) return;
                  e.preventDefault();
                  drop(col.status);
                }}
              >
                <header>
                  <h2>
                    <i className={`kanban-stage-dot stage-${col.status}`} />
                    {col.title}
                  </h2>
                  <span
                    title={
                      limit
                        ? `${count} cartões de ${limit} vagas no quadro completo`
                        : "Cartões nos filtros atuais"
                    }
                  >
                    {members.length}
                    {limit > 0 && <small> / {limit}</small>}
                  </span>
                </header>
                <p className="kanban-column-hint">
                  {col.hint}
                  {limit > 0 && (
                    <em>
                      {count >= limit
                        ? "Limite atingido"
                        : `${limit - count} vagas no quadro`}
                    </em>
                  )}
                </p>
                {members.length === 0 && (
                  <p className="kanban-empty">
                    {isOver ? "Solte o cartão aqui" : "Nenhum cartão"}
                  </p>
                )}
                {members.map((card) => {
                  const key = cardKey(card),
                    moves = availableMoves(card, can),
                    draggable =
                      !busy && !pending && (canSort || moves.length > 0);
                  const late =
                    !closedStatus(card.status) &&
                    card.due_at &&
                    Date.parse(card.due_at) < Date.now();
                  const age =
                    card.type === "order" &&
                    !closedStatus(card.status) &&
                    Number.isFinite(Date.parse(card.created_at))
                      ? Math.max(
                          0,
                          (Date.now() - Date.parse(card.created_at)) / 86400000,
                        )
                      : null;
                  return (
                    <article
                      className={`kanban-card ${dragging === key ? "is-dragging" : ""} ${hover?.before === key ? "insert-before" : ""}`}
                      key={key}
                      data-card-key={key}
                      aria-label={`${card.code} · ${col.title}`}
                      style={{ borderLeftColor: teamColor(card.team_id) }}
                      draggable={draggable}
                      onDragStart={(e) => {
                        if (!draggable) {
                          e.preventDefault();
                          return;
                        }
                        dragRef.current = key;
                        setDragging(key);
                        setError("");
                        e.dataTransfer.setData("text/plain", key);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={resetDrag}
                      onDragOver={(e) => {
                        if (!dragRef.current) return;
                        e.preventDefault();
                        e.stopPropagation();
                        edgeScroll(e.clientX, e.clientY);
                        setHover({ status: col.status, before: key });
                      }}
                      onDrop={(e) => {
                        if (!dragRef.current) return;
                        e.preventDefault();
                        e.stopPropagation();
                        drop(col.status, key);
                      }}
                    >
                      <div className="kanban-card-top">
                        <button
                          type="button"
                          className="kanban-grip"
                          disabled={!draggable}
                          aria-label={`Arrastar ${card.code}`}
                          title="Arraste pelo puxador ou use Mover"
                          onPointerDown={(e) => {
                            if (e.pointerType === "mouse" || !draggable) return;
                            e.preventDefault();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            dragRef.current = key;
                            setDragging(key);
                            setTouchGhost({
                              x: e.clientX,
                              y: e.clientY,
                              code: card.code,
                            });
                          }}
                          onPointerMove={(e) => {
                            if (
                              e.pointerType === "mouse" ||
                              dragRef.current !== key
                            )
                              return;
                            edgeScroll(e.clientX, e.clientY);
                            setTouchGhost({
                              x: e.clientX,
                              y: e.clientY,
                              code: card.code,
                            });
                            const element = document.elementFromPoint(
                              e.clientX,
                              e.clientY,
                            );
                            const column =
                              element?.closest<HTMLElement>(".kanban-column");
                            const cardEl =
                              element?.closest<HTMLElement>(".kanban-card");
                            const target = column?.dataset.status
                              ? {
                                  status: column.dataset.status,
                                  before: cardEl?.dataset.cardKey,
                                }
                              : null;
                            touchTarget.current = target;
                            setHover(target);
                          }}
                          onPointerUp={(e) => {
                            if (
                              e.pointerType === "mouse" ||
                              dragRef.current !== key
                            )
                              return;
                            const target = touchTarget.current;
                            if (target) drop(target.status, target.before);
                            else resetDrag();
                          }}
                          onPointerCancel={resetDrag}
                        >
                          <GripVertical size={16} />
                        </button>
                        <strong>{card.code}</strong>
                        <span
                          className={`kanban-priority priority-${card.priority}`}
                        >
                          {card.priority}
                        </span>
                      </div>
                      <button
                        className="kanban-card-title"
                        onClick={() => onOpen(card.type, card.id, "overview")}
                      >
                        {card.occurrences[0]?.address || name(card.sector_id)}
                      </button>
                      <p className="kanban-neighborhood">
                        {[
                          ...new Set(
                            card.occurrences.map((o: any) => o.neighborhood),
                          ),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <div className="kanban-card-meta">
                        <span className="kanban-team">
                          <i style={{ background: teamColor(card.team_id) }} />
                          {name(card.team_id)}
                        </span>
                        {card.type === "order" && (
                          <span>{card.occurrences.length} chamados</span>
                        )}
                      </div>
                      {card.type === "order" && (
                        <div className="kanban-card-meta">
                          <span className={late ? "kanban-late" : ""}>
                            {late ? "Prazo vencido" : "Programada"} ·{" "}
                            {date(late ? card.due_at : card.scheduled_at)}
                          </span>
                          {age !== null && (
                            <span title="Tempo desde a programação inicial da OS">
                              {days(age)} no fluxo
                            </span>
                          )}
                        </div>
                      )}
                      {card.status === "DEVOLVIDA" && (
                        <p className="kanban-blocked">
                          Devolução:{" "}
                          {card.return_reason || "Consulte o histórico"}
                        </p>
                      )}
                      {card.status === "RECUSADA" && (
                        <p className="kanban-blocked">
                          Recusa: {card.rejection_reason}
                        </p>
                      )}
                      <div className="kanban-card-actions">
                        <button
                          className="kanban-open"
                          onClick={() =>
                            onOpen(
                              card.type,
                              card.id,
                              card.type === "order" &&
                                [
                                  "EM_DESLOCAMENTO",
                                  "EM_EXECUCAO",
                                  "AGUARDANDO_VALIDACAO",
                                ].includes(card.status)
                                ? "execution"
                                : "overview",
                            )
                          }
                        >
                          {action(card)}
                        </button>
                        {moves.length > 0 && (
                          <select
                            aria-label={`Mover ${card.code}`}
                            value=""
                            disabled={busy || !!pending}
                            onChange={(e) => moveTo(card, e.target.value)}
                          >
                            <option value="">Mover...</option>
                            {moves.map((m) => (
                              <option key={m.status} value={m.status}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        )}
                        {canSort && (
                          <button
                            className="kanban-prioritize"
                            title="Mover para o topo desta coluna"
                            aria-label={`Priorizar ${card.code}`}
                            disabled={busy || members[0]?.id === card.id}
                            onClick={() =>
                              void reorder(
                                card,
                                cardKey(
                                  cards.find((c) => c.status === card.status),
                                ),
                              )
                            }
                          >
                            <ArrowUp size={15} />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
      </div>
      {touchGhost && (
        <div
          className="kanban-touch-ghost"
          style={{ left: touchGhost.x + 12, top: touchGhost.y - 35 }}
        >
          <GripVertical size={16} />
          {touchGhost.code}
        </div>
      )}
      {pending && (
        <KanbanMoveDialog
          card={pending.card}
          move={pending.move}
          boot={boot}
          api={api}
          onClose={() => setPending(null)}
          onOpen={onOpen}
          onSaved={async () => {
            await onRefresh();
            setMessage("Etapa atualizada e registrada no histórico.");
            setPending(null);
          }}
        />
      )}
    </div>
  );
}
