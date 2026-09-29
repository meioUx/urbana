import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  ClipboardList,
  Search,
} from "lucide-react";
import "./sector-control.css";

const fmtDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("pt-BR") : "—";

const escapeCsv = (value: unknown) =>
  `"${String(value ?? "")
    .replace(/^[=+@\-]/, "'$&")
    .replace(/"/g, '""')}"`;

export default function SectorControl({ api, boot, onOpen }: any) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [sector, setSector] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const sectors = boot.catalogs.filter((item: any) => item.kind === "setores");

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ month });
    if (sector) params.set("sector_id", sector);
    api(`/controle-setor?${params}`)
      .then((result: any) => active && (setData(result), setError("")))
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, [month, sector]);

  const rows = useMemo(() => {
    const term = query.toLocaleLowerCase("pt-BR");
    return (data?.rows || []).filter((row: any) =>
      [
        row.order_number,
        row.requester,
        row.address,
        row.description,
        row.responsible,
      ].some((value) => value?.toLocaleLowerCase("pt-BR").includes(term)),
    );
  }, [data, query]);

  const exportCsv = () => {
    const header = [
      "Data Entrada",
      "Código",
      "Qta",
      "nº O.S.",
      "Nomes",
      "Endereço",
      "Assunto/Descrição",
      "Contato",
      "Qta",
      "Responsável",
      "Data",
      "Concl.",
    ];
    const lines = rows.map((row: any) => [
      fmtDate(row.entry_date),
      row.service_code,
      row.service_quantity,
      row.order_number,
      row.requester,
      row.address,
      row.description,
      row.contact,
      row.contact_quantity,
      row.responsible,
      fmtDate(row.completion_date),
      row.completed,
    ]);
    const blob = new Blob(
      [
        "\ufeff" +
          [header, ...lines]
            .map((line) => line.map(escapeCsv).join(";"))
            .join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `controle-setor-${month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (error) return <div className="notice error">{error}</div>;
  if (!data) return <p>Carregando controle do setor...</p>;
  const summary = data.summary;

  return (
    <div className="sector-control">
      <div className="notice">
        <ClipboardList size={21} />
        <span>
          Visão mensal baseada no controle usado pelo setor em 2026. Os dados
          vêm das ocorrências e ordens registradas no sistema.
        </span>
      </div>
      <div className="sector-toolbar">
        <label>
          <span>Mês de entrada</span>
          <input
            aria-label="Mês de entrada"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <label>
          <span>Setor responsável</span>
          <select
            aria-label="Setor responsável no controle"
            value={sector}
            onChange={(event) => setSector(event.target.value)}
          >
            <option value="">Todos os setores</option>
            {sectors.map((item: any) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="search">
          <Search size={17} />
          <input
            aria-label="Buscar no controle do setor"
            placeholder="OS, nome, endereço ou responsável..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button className="button secondary" onClick={exportCsv}>
          <ArrowDownToLine size={17} />
          Exportar CSV
        </button>
      </div>
      <div className="sector-kpis">
        <article>
          <ClipboardList />
          <span>Ordens no mês</span>
          <strong>{summary.orders}</strong>
        </article>
        <article>
          <span>Serviços solicitados</span>
          <strong>{summary.services}</strong>
        </article>
        <article>
          <CheckCircle2 />
          <span>Ordens concluídas</span>
          <strong>{summary.completed}</strong>
        </article>
        <article>
          <span>Conclusão</span>
          <strong>
            {(summary.completion_rate * 100).toLocaleString("pt-BR", {
              maximumFractionDigits: 1,
            })}
            %
          </strong>
        </article>
      </div>
      <div className="sector-layout">
        <div className="table-scroll sector-table">
          <table>
            <thead>
              <tr>
                <th>Data entrada</th>
                <th>Código</th>
                <th>Qta</th>
                <th>nº O.S.</th>
                <th>Nomes</th>
                <th>Endereço</th>
                <th>Assunto/Descrição</th>
                <th>Contato</th>
                <th>Qta</th>
                <th>Responsável</th>
                <th>Data</th>
                <th>Concl.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  onClick={() => onOpen("order", row.id)}
                  onKeyDown={(event) =>
                    event.key === "Enter" && onOpen("order", row.id)
                  }
                >
                  <td>{fmtDate(row.entry_date)}</td>
                  <td>
                    <strong>{row.service_code}</strong>
                    <small>{row.service_label}</small>
                  </td>
                  <td>{row.service_quantity}</td>
                  <td>
                    <strong>{row.order_number}</strong>
                    <small>{row.status}</small>
                  </td>
                  <td>{row.requester}</td>
                  <td>{row.address}</td>
                  <td>{row.description}</td>
                  <td>{row.contact}</td>
                  <td>{row.contact_quantity}</td>
                  <td>{row.responsible}</td>
                  <td>{fmtDate(row.completion_date)}</td>
                  <td>{row.completed ? "1" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="sector-empty">
              Nenhuma ordem encontrada para o período e os filtros.
            </p>
          )}
        </div>
        <aside className="sector-summaries">
          <section>
            <h2>Somatória O.S.</h2>
            {summary.codes.map((item: any) => (
              <div key={item.code}>
                <span>
                  <b>{item.code}</b> {item.label}
                </span>
                <strong>{item.quantity}</strong>
              </div>
            ))}
          </section>
          <section>
            <h2>Somatório dos contatos</h2>
            {summary.contacts.map((item: any) => (
              <div key={item.channel}>
                <span>{item.channel}</span>
                <strong>{item.quantity}</strong>
              </div>
            ))}
          </section>
          <section>
            <h2>Conclusão</h2>
            <div>
              <span>Total de ordens</span>
              <strong>{summary.orders}</strong>
            </div>
            <div>
              <span>Realizadas</span>
              <strong>{summary.completed}</strong>
            </div>
            <div>
              <span>Percentual</span>
              <strong>
                {(summary.completion_rate * 100).toLocaleString("pt-BR", {
                  maximumFractionDigits: 1,
                })}
                %
              </strong>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
