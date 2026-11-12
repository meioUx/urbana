import { Search, X } from "lucide-react";
import { labels } from "../../shared/workflow";
import type { Boot } from "../../shared/types";
import type { Filters } from "./useFilters";
import type { PagedList } from "./useRecordLists";

export function FilterBar({
  page,
  filters,
  boot,
  neighborhoods,
  mapNeighborhoods,
}: {
  page: string;
  filters: Filters;
  boot: Boot;
  neighborhoods: string[];
  mapNeighborhoods: string[];
}) {
  const {
    q,
    setQ,
    status,
    setStatus,
    priority,
    setPriority,
    team,
    setTeam,
    deadline,
    setDeadline,
    category,
    setCategory,
    neighborhood,
    setNeighborhood,
    from,
    setFrom,
    to,
    setTo,
  } = filters;
  const catalogs = (kind: string) =>
    boot?.catalogs.filter((c) => c.kind === kind) || [];
  return (
    <div className="filters" data-guide="filters">
      <div className="search">
        <Search size={17} />
        <input
          aria-label="Buscar registros"
          placeholder={
            page === "orders"
              ? "Buscar por código, equipe ou responsável..."
              : "Buscar por endereço, bairro ou código..."
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <select
        aria-label="Filtrar status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">Todos os status</option>
        {Object.entries(labels).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <select
        aria-label="Filtrar prioridade"
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
      >
        <option value="">Todas as prioridades</option>
        {boot.priorities.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      {page !== "orders" && (
        <select
          aria-label="Filtrar categoria"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Todas as categorias</option>
          {catalogs("categorias").map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {page === "orders" && (
        <>
          <select
            aria-label="Filtrar equipe"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">Todas as equipes</option>
            {catalogs("equipes").map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar prazo"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          >
            <option value="">Todos os prazos</option>
            <option value="late">Atrasadas</option>
            <option value="soon">Vencem em até 24 horas</option>
            <option value="ontime">Prazo acima de 24 horas</option>
          </select>
        </>
      )}
      {page === "map" && (
        <select
          aria-label="Filtrar bairro"
          value={neighborhood}
          onChange={(e) => setNeighborhood(e.target.value)}
        >
          <option value="">Todos os bairros</option>
          {[
            ...new Set(
              [...mapNeighborhoods, ...neighborhoods, neighborhood].filter(
                Boolean,
              ),
            ),
          ]
            .sort()
            .map((n) => (
              <option key={n}>{n}</option>
            ))}
        </select>
      )}
      <input
        type="date"
        title="Data inicial"
        aria-label="Data inicial"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />
      <input
        type="date"
        title="Data final"
        aria-label="Data final"
        value={to}
        min={from}
        onChange={(e) => setTo(e.target.value)}
      />
      {(q ||
        status ||
        priority ||
        team ||
        deadline ||
        category ||
        from ||
        to ||
        neighborhood) && (
        <button
          className="icon"
          title="Limpar filtros"
          onClick={() => {
            setQ("");
            setStatus("");
            setPriority("");
            setTeam("");
            setDeadline("");
            setCategory("");
            setFrom("");
            setTo("");
            setNeighborhood("");
          }}
        >
          <X size={17} />
        </button>
      )}
    </div>
  );
}

export function Pagination({ list }: { list: PagedList }) {
  const {
    listBusy,
    listBack,
    setListCursor,
    setListBack,
    listPage,
    listCursor,
  } = list;
  return (
    <div className="form-actions" role="group" aria-label="Paginação">
      <button
        className="button secondary"
        disabled={listBusy || !listBack.length}
        onClick={() => {
          setListCursor(listBack.at(-1) || "");
          setListBack(listBack.slice(0, -1));
        }}
      >
        Anterior
      </button>
      <span role="status">
        Página {listBack.length + 1} ·{" "}
        {listBusy ? "Atualizando..." : listPage.items.length + " registros"}
      </span>
      <button
        className="button secondary"
        disabled={listBusy || !listPage.has_more}
        onClick={() => {
          setListBack([...listBack, listCursor]);
          setListCursor(listPage.next_cursor);
        }}
      >
        Próxima
      </button>
    </div>
  );
}
