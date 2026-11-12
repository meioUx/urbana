/** Atalhos de fila da triagem com a contagem de demandas em cada situação (resumo calculado no servidor). */
export default function TriageQueue({
  counts,
  status,
  setStatus,
}: {
  counts: Record<string, number> | null;
  status: string;
  setStatus: (value: string) => void;
}) {
  const count = (value: string) =>
    value
      ? counts?.[value] || 0
      : (counts?.IDENTIFICADA || 0) + (counts?.EM_TRIAGEM || 0);
  return (
    <section
      data-guide="triage-queue"
      className="demand-queue"
      aria-label="Filas de triagem"
    >
      <p>
        Analise a demanda e depois escolha quando atender. Planejamento é
        opcional para comparar obras e agrupar demandas da mesma via.
      </p>
      <div className="form-actions">
        {[
          ["IDENTIFICADA", "A analisar"],
          ["EM_TRIAGEM", "Prontas para programar"],
          ["", "Todas da triagem"],
        ].map(([value, title]) => (
          <button
            key={value}
            type="button"
            className={`button ${status === value ? "primary" : "secondary"}`}
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
          >
            {title}
            {counts ? ` (${count(value)})` : ""}
          </button>
        ))}
      </div>
    </section>
  );
}
