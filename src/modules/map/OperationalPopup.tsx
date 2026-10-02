import { useEffect, useRef, useState } from "react";
type Summary = { code: string; address: string; orders: {code: string; started_at?: string; attendance_at?: string; completed_at?: string; expected_completion_at?: string; team?: string; before?: string; after?: string}[] };
function date(value?: string) {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", {dateStyle:"short", ...(value.length > 10 ? {timeStyle:"short" as const} : {})}) : "—";
}
function Photo({src, label}: {src?: string; label: string}) {
  const [failed, setFailed] = useState(false);
  return <figure><figcaption>{label}</figcaption>{src && !failed ? <a href={src} target="_blank" rel="noopener noreferrer" aria-label={`Ampliar foto ${label.toLowerCase()}`}><img src={src} alt={`Evidência ${label.toLowerCase()} do serviço`} onError={() => setFailed(true)}/></a> : <div className="operational-photo-empty">{failed ? "Foto indisponível" : "Foto ainda não registrada"}</div>}</figure>;
}
export default function OperationalPopup({id, load, onOpen}: {id: string; load: (id: string) => Promise<Summary>; onOpen?: () => void}) {
  const [data, setData] = useState<Summary | null>(null), [error,setError] = useState("");
  const pending = useRef<Promise<Summary> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    pending.current ||= load(id);
    pending.current.then(value => {if(active) setData(value);}).catch(e => {if(active) setError(e.message);});
    return () => {active = false;};
  }, [id,attempt]);
  if (error) return <div role="alert">{error}<button className="text-button" onClick={() => {pending.current = null; setAttempt(attempt+1);}}>Tentar novamente</button></div>;
  if (!data) return <p role="status">Carregando serviço…</p>;
  const openButton = onOpen && <button type="button" className="button primary operational-open" onClick={onOpen}>Abrir ocorrência</button>;
  return <div className="operational-summary">{data.orders.length ? data.orders.map(o => <article key={o.code}>
    <h2>{o.code}</h2><p className="operational-address">{data.address || "—"}</p>
    <dl><div><dt>Início</dt><dd>{date(o.started_at)}</dd></div><div><dt>Atendimento</dt><dd>{date(o.attendance_at)}</dd></div><div><dt>Finalização{o.completed_at ? "" : o.expected_completion_at ? " prevista" : ""}</dt><dd>{date(o.completed_at || o.expected_completion_at)}</dd></div>{o.team && <div><dt>Equipe responsável</dt><dd>{o.team}</dd></div>}</dl>
    <h3>Antes e depois</h3><div className="operational-photos"><Photo src={o.before} label="Antes"/><Photo src={o.after} label="Depois"/></div>
    {openButton}
  </article>) : <article><h2>{data.code}</h2><p>{data.address || "—"}</p><p>Sem ordem de serviço vinculada disponível.</p>{openButton}</article>}</div>;
}
