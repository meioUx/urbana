import { useEffect, useState } from "react";
const fields = {
  entity_type: "Tipo de entidade",
  entity_id: "ID da entidade",
  user_id: "ID do usuário",
  event: "Evento",
  from: "Desde",
  to: "Até",
};
export default function AuditPanel({
  api,
}: {
  api: (path: string) => Promise<any>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState("");
  const [back, setBack] = useState<string[]>([]);
  const [page, setPage] = useState<any>({ items: [], has_more: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError("");
    const q = new URLSearchParams({ limit: "50" });
    for (const [k, v] of Object.entries({ ...filters, cursor }))
      if (v) q.set(k, v);
    api("/auditoria?" + q)
      .then((v) => {
        if (!cancelled) setPage(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, filters, cursor, refresh]);
  return (
    <section aria-label="Pesquisa de auditoria">
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...draft });
          setCursor("");
          setBack([]);
        }}
      >
        {Object.entries(fields).map(([key, label]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input
              type={["from", "to"].includes(key) ? "date" : "text"}
              value={draft[key] || ""}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <button className="button primary" disabled={busy}>
          Pesquisar
        </button>
      </form>
      {error && (
        <p role="alert">
          {error}
          <button
            className="button secondary"
            onClick={() => setRefresh((v) => v + 1)}
          >
            Tentar novamente
          </button>
        </p>
      )}
      <div className="form-actions">
        <button
          className="button secondary"
          disabled={busy || !back.length}
          onClick={() => {
            setCursor(back.at(-1) || "");
            setBack(back.slice(0, -1));
          }}
        >
          Anterior
        </button>
        <span role="status">
          {busy ? "Carregando auditoria..." : "Página " + (back.length + 1)}
        </span>
        <button
          className="button secondary"
          disabled={busy || !page.has_more}
          onClick={() => {
            setBack([...back, cursor]);
            setCursor(page.next_cursor);
          }}
        >
          Próxima
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Usuário</th>
              <th>Evento</th>
              <th>Entidade</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((row: any) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString("pt-BR")}</td>
                <td>{row.user_name}</td>
                <td>{row.event}</td>
                <td>
                  {row.entity_type} · {row.entity_id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!busy && !page.items.length && !error && (
        <p>Nenhum evento nos filtros selecionados.</p>
      )}
    </section>
  );
}
