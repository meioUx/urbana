import { useLayoutEffect, useState } from "react";
import { ChevronDown, ClipboardList, HardHat } from "lucide-react";

const groups = [
  {
    id: "occurrences",
    title: "Ocorrências",
    Icon: ClipboardList,
    pages: ["occurrences", "triagem", "orders", "review"],
  },
  {
    id: "operations",
    title: "Operações",
    Icon: HardHat,
    pages: ["sector-control", "teams", "materials", "equipment", "field"],
  },
];
export default function SidebarNav({ nav, page, rows, onNavigate }: any) {
  const [open, setOpen] = useState("");
  useLayoutEffect(() => {
    setOpen(groups.find((g) => g.pages.includes(page))?.id || "");
  }, [page]);
  const entry = ([id, label, Icon]: any, nested = false) => (
    <button
      key={id}
      className={`nav-item ${nested ? "nav-child" : ""} ${page === id ? "active" : ""}`}
      aria-current={page === id ? "page" : undefined}
      onClick={() => onNavigate(id)}
    >
      <Icon size={nested ? 16 : 18} />
      <span>
        {id === "occurrences" && nested ? "Todas as ocorrências" : label}
      </span>
      {id === "triagem" && (
        <b aria-label="Demandas em triagem">
          {
            rows.filter((r: any) =>
              ["IDENTIFICADA", "EM_TRIAGEM"].includes(r.status),
            ).length
          }
        </b>
      )}
    </button>
  );
  return (
    <nav aria-label="Menu principal">
      {nav
        .filter(([id]: any) =>
          ["dashboard", "map", "kanban", "planning"].includes(id),
        )
        .map((item: any) => entry(item))}
      <div className="nav-separator" />
      {groups.filter(group=>group.pages.some(id=>nav.some((item:any)=>item[0]===id))).map((group) => (
        <div className="nav-group" key={group.id}>
          <button
            className={`nav-item nav-group-toggle ${group.pages.includes(page) ? "group-active" : ""}`}
            aria-expanded={open === group.id}
            aria-controls={`nav-${group.id}`}
            onClick={() => setOpen(open === group.id ? "" : group.id)}
          >
            <group.Icon size={18} />
            <span>{group.title}</span>
            <ChevronDown
              size={15}
              className={open === group.id ? "rotated" : ""}
            />
          </button>
          {open === group.id && (
            <div id={`nav-${group.id}`} className="nav-submenu">
              {group.pages
                .map((id) => nav.find((item: any) => item[0] === id))
                .filter(Boolean)
                .map((item) => entry(item, true))}
            </div>
          )}
        </div>
      ))}
      {nav
        .filter(([id]: any) => id === "admin")
        .map((item: any) => entry(item))}
    </nav>
  );
}
