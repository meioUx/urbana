import { useEffect, useState } from "react";
import { moduleForPath } from "../../../shared/authorization.mjs";

/** Página atual, mapa em tela cheia e modo campo, sincronizados com o histórico do navegador. */
export function useNavigationState() {
  const [page, setPage] = useState(
      moduleForPath(window.location.pathname) || "dashboard",
    ),
    [mapOnly, setMapOnly] = useState(window.location.pathname === "/mapa"),
    [fieldMode, setFieldMode] = useState(window.location.pathname === "/campo");
  useEffect(() => {
    const pop = () => {
      setMapOnly(window.location.pathname === "/mapa");
      setFieldMode(window.location.pathname === "/campo");
      setPage(moduleForPath(window.location.pathname) || "dashboard");
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  return { page, setPage, mapOnly, setMapOnly, fieldMode, setFieldMode };
}
