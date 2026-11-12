import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import type { Boot, Row } from "../../shared/types";
import type { Filters } from "./useFilters";

/** Listagem paginada no servidor (cursor) para ocorrências, triagem e ordens de serviço. */
export function usePagedList({
  boot,
  page,
  filters,
  lastSync,
}: {
  boot: Boot | null;
  page: string;
  filters: Filters;
  lastSync: string;
}) {
  const {
    q,
    status,
    priority,
    category,
    team,
    deadline,
    from,
    to,
    neighborhood,
  } = filters;
  const pagedScope = ["occurrences", "triagem", "orders"].includes(page);
  const [listPage, setListPage] = useState<any>({
    items: [],
    has_more: false,
    next_cursor: null,
  });
  const [listCursor, setListCursor] = useState("");
  const [listBack, setListBack] = useState<string[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const listKey = JSON.stringify([
    page,
    q,
    status,
    priority,
    category,
    team,
    deadline,
    from,
    to,
    neighborhood,
  ]);
  useEffect(() => {
    setListCursor("");
    setListBack([]);
  }, [listKey]);
  useEffect(() => {
    if (!boot || !pagedScope) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setListBusy(true);
      setListError("");
      const params = new URLSearchParams({ limit: "50" });
      for (const [key, value] of Object.entries({
        q,
        status: status || (page === "triagem" ? "IDENTIFICADA,EM_TRIAGEM" : ""),
        priority,
        category_id: page === "orders" ? "" : category,
        team_id: page === "orders" ? team : "",
        deadline: page === "orders" ? deadline : "",
        from,
        to,
        neighborhood,
        cursor: listCursor,
      }))
        if (value) params.set(key, value);
      try {
        const result = await api(
          `/${page === "orders" ? "ordens-servico" : "ocorrencias"}?${params}`,
        );
        if (!cancelled) setListPage({ ...result, key: listKey });
      } catch (e: any) {
        if (!cancelled) setListError(e.message);
      } finally {
        if (!cancelled) setListBusy(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [boot?.user.id, pagedScope, listKey, listCursor, lastSync]);
  return {
    pagedScope,
    listPage,
    listCursor,
    setListCursor,
    listBack,
    setListBack,
    listBusy,
    listError,
    listKey,
  };
}

export type PagedList = ReturnType<typeof usePagedList>;

/** Ocorrências georreferenciadas do mapa territorial, recarregadas conforme os filtros. */
export function useMapRows({
  boot,
  page,
  filters,
  lastSync,
  setSyncError,
}: {
  boot: Boot | null;
  page: string;
  filters: Filters;
  lastSync: string;
  setSyncError: (message: string) => void;
}) {
  const { q, status, priority, category, neighborhood, from, to } = filters;
  const [mapRows, setMapRows] = useState<Row[]>([]);
  const [mapNeighborhoods, setMapNeighborhoods] = useState<string[]>([]);
  useEffect(() => {
    if (!boot || page !== "map") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries({
        q,
        status,
        priority,
        category_id: category,
        neighborhood,
        from,
        to,
      }))
        if (value) params.set(key, value);
      api(`/mapa/ocorrencias?${params}`)
        .then((data) => {
          if (!cancelled) {
            const next = data.features.map((f: any) => f.properties);
            setMapRows((previous) =>
              JSON.stringify(previous) === JSON.stringify(next)
                ? previous
                : next,
            );
            setMapNeighborhoods((previous) =>
              [
                ...new Set([
                  ...previous,
                  ...next.map((r: Row) => r.neighborhood).filter(Boolean),
                ]),
              ].sort(),
            );
            setSyncError("");
          }
        })
        .catch((e) => {
          if (!cancelled) setSyncError(e.message);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    boot?.user.id,
    page,
    q,
    status,
    priority,
    category,
    neighborhood,
    from,
    to,
    lastSync,
  ]);
  return { mapRows, mapNeighborhoods };
}
