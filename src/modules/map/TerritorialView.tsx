import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Filter, X } from "lucide-react";
import "./territorial.css";
export default function TerritorialView({ children, filters, activeCount, onClear, onBack, error }: {children: ReactNode; filters: ReactNode; activeCount: number; onClear: () => void; onBack: () => void; error?: string}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); toggle.current?.focus(); };
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("button")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && open) { e.preventDefault(); close(); } };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  return <main className="territorial-view" aria-label="Mapa territorial municipal">
    <div className="territorial-map" data-guide="map">{children}</div>
    <button className="button secondary territorial-back" onClick={onBack}><ArrowLeft size={16}/>Voltar ao sistema</button>
    <div className="territorial-filters">
      <button ref={toggle} className="button secondary" aria-expanded={open} aria-controls="territorial-filter-panel" onClick={() => open ? close() : setOpen(true)}><Filter size={18}/>Filtros{activeCount > 0 && <span className="filter-count" aria-label={`${activeCount} filtros ativos`}>{activeCount}</span>}</button>
      <div id="territorial-filter-panel" ref={panel} className={`territorial-filter-panel ${open ? "is-open" : ""}`} inert={!open} aria-hidden={!open}>
        <header><strong>Filtros</strong><button className="icon" aria-label="Fechar filtros" onClick={close}><X size={20}/></button></header>
        {filters}
        <button className="text-button" onClick={onClear}>Limpar filtros</button>
      </div>
    </div>
    {error && <div className="territorial-error notice error" role="alert">{error}</div>}
  </main>;
}
