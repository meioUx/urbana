import { useEffect, useRef, useState } from "react";
import { api } from "../../shared/api";
import type { Row } from "../../shared/types";

/** Estados das OS abertas (as que entram na carga das equipes; concluídas e canceladas ficam fora). */
export const OPEN_ORDER_STATUSES = [
  "PROGRAMADA",
  "EM_DESLOCAMENTO",
  "EM_EXECUCAO",
  "AGUARDANDO_VALIDACAO",
  "DEVOLVIDA",
];
/** Estados das ocorrências ainda em andamento. */
export const OPEN_OCCURRENCE_STATUSES = [
  "IDENTIFICADA",
  "EM_TRIAGEM",
  ...OPEN_ORDER_STATUSES,
];

/**
 * Leitura de um endpoint JSON com estados de carregamento e erro. Recarrega quando `path` ou
 * `refreshKey` (ex.: a hora da última sincronização) mudam; com `path` nulo não busca nada.
 * Em uma atualização com falha, os dados anteriores continuam disponíveis junto com o erro.
 */
export function useServerData<T>(path: string | null, refreshKey?: unknown) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const current = useRef(path);
  useEffect(() => {
    current.current = path;
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    api(path)
      .then((result) => {
        if (active) {
          setData(result);
          setError("");
        }
      })
      .catch((e: any) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, refreshKey, nonce]);
  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

/** OS abertas (sem concluídas e canceladas), usadas para a carga das equipes. */
export function useOpenOrders(refreshKey?: unknown, enabled = true) {
  const { data, ...rest } = useServerData<Row[]>(
    enabled ? `/ordens-servico?status=${OPEN_ORDER_STATUSES.join(",")}` : null,
    refreshKey,
  );
  return { orders: data || [], ...rest };
}

/**
 * Lista paginada por cursor ({ items, has_more, next_cursor }) com "Carregar mais". Quando `path`
 * muda, volta à primeira página; quando só `refreshKey` muda, recarrega as páginas já abertas.
 */
export function useCursorPages<T = Row>(
  path: string | null,
  refreshKey?: unknown,
) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const lastPath = useRef<string | null>(null);
  const separator = (p: string) => (p.includes("?") ? "&" : "?");
  useEffect(() => {
    if (!path) {
      setItems([]);
      setCursor(null);
      lastPath.current = null;
      return;
    }
    const reset = lastPath.current !== path;
    lastPath.current = path;
    const wanted = reset ? 1 : pages;
    if (reset) setPages(1);
    let active = true;
    setLoading(true);
    (async () => {
      const loaded: T[] = [];
      let next: string | null = null;
      for (let page = 0; page < wanted; page++) {
        const result: any = await api(
          path +
            (next
              ? `${separator(path)}cursor=${encodeURIComponent(next)}`
              : ""),
        );
        loaded.push(...result.items);
        next = result.next_cursor;
        if (!result.has_more) break;
      }
      return { loaded, next };
    })()
      .then(({ loaded, next }) => {
        if (active) {
          setItems(loaded);
          setCursor(next);
          setError("");
        }
      })
      .catch((e: any) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, refreshKey, nonce]); // eslint-disable-line react-hooks/exhaustive-deps -- pages só conta páginas já abertas
  const loadMore = async () => {
    if (!path || !cursor || loading) return;
    setLoading(true);
    setError("");
    try {
      const result: any = await api(
        path + `${separator(path)}cursor=${encodeURIComponent(cursor)}`,
      );
      if (lastPath.current !== path) return;
      setItems((old) => [...old, ...result.items]);
      setCursor(result.next_cursor);
      setPages((n) => n + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  /** Nova tentativa: refaz a primeira carga ou, se ela já veio, a próxima página. */
  const retry = () =>
    cursor && items.length ? loadMore() : setNonce((n) => n + 1);
  return { items, hasMore: !!cursor, loading, error, loadMore, retry };
}
