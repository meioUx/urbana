import React, { useEffect, useRef, useState } from "react";
import { colors, inkColor, labels } from "./workflow";
import { fmt } from "./format";
import type { Row } from "./types";
import { ClipboardList, X } from "lucide-react";

export function Badge({ status }: { status: string }) {
  return (
    <span
      className="badge"
      style={{
        color: inkColor(colors[status] || "#555555"),
        background: `${colors[status] || "#555555"}13`,
      }}
    >
      <i style={{ background: colors[status] }} />
      {labels[status] || status}
    </span>
  );
}
export function Priority({ value }: { value: string }) {
  return (
    <span
      className={`priority p-${value === "Emergencial" ? "critical" : value === "Alta" ? "high" : value === "Média" ? "medium" : "low"}`}
    >
      <span /> {value}
    </span>
  );
}
export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const fieldId = React.useId();
  return (
    <label className={wide ? "field wide" : "field"}>
      <span id={fieldId}>{label}</span>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<any>, {
            "aria-labelledby": fieldId,
          })
        : children}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <header role="none">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} title="Fechar">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
export function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <ClipboardList size={28} />
      <p>{text}</p>
    </div>
  );
}
export function Sla({ order: o }: { order: Row }) {
  const end = o.completed_at ? Date.parse(o.completed_at) : Date.now(),
    hours = Math.ceil((Date.parse(o.due_at) - end) / 3600000),
    closed = ["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(o.status);
  return (
    <div className={`sla ${hours < 0 && !closed ? "late" : ""}`}>
      <span>
        {closed
          ? labels[o.status]
          : hours < 0
            ? `${Math.abs(hours)}h em atraso`
            : `${hours}h restantes`}
      </span>
      <small>{fmt(o.due_at)}</small>
    </div>
  );
}

/**
 * Contêiner de tabela com rolagem. Quando o conteúdo ultrapassa a área (celular, zoom), vira uma
 * região rotulada e alcançável pelo teclado, para que quem não usa mouse role a tabela (WCAG 2.1.1).
 */
export function TableScroll({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () =>
      setScrolls(
        el.scrollWidth > el.clientWidth + 1 ||
          el.scrollHeight > el.clientHeight + 1,
      );
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`table-scroll ${className}`.trim()}
      {...(scrolls ? { tabIndex: 0, role: "region", "aria-label": label } : {})}
    >
      {children}
    </div>
  );
}

/**
 * Abre um <dialog> nativo como modal e, ao desmontar (o React remove o elemento, então o navegador
 * não devolve o foco sozinho), devolve o foco ao controle que o abriu; se ele já saiu da tela,
 * ao conteúdo principal.
 */
export function useModalDialog(ref: React.RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      const target =
        opener && opener.isConnected && opener !== document.body
          ? opener
          : document.getElementById("conteudo");
      target?.focus?.();
    };
  }, [ref]);
}
