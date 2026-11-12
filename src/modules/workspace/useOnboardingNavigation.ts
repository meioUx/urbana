import { useEffect, useRef } from "react";
import { hasModuleAccess } from "../../../shared/authorization.mjs";
import { api } from "../../shared/api";
import type { Boot } from "../../shared/types";
import type { Filters } from "./useFilters";

/**
 * Responde aos eventos do treinamento guiado (`urbana:onboarding-navigate` e
 * `urbana:onboarding-end`), levando a área de gestão até a tela, filtro, aba
 * ou registro de cada passo.
 */
export function useOnboardingNavigation({
  boot,
  filters,
  setMobile,
  setDetail,
  setModal,
  setMapOnly,
  setFieldMode,
  setPage,
  setAdminTab,
}: {
  boot: Boot | null;
  filters: Filters;
  setMobile: (value: boolean) => void;
  setDetail: (value: any) => void;
  setModal: (value: any) => void;
  setMapOnly: (value: boolean) => void;
  setFieldMode: (value: boolean) => void;
  setPage: (value: string) => void;
  setAdminTab: (value: string) => void;
}) {
  const {
    setQ,
    setStatus,
    setPriority,
    setTeam,
    setDeadline,
    setCategory,
    setNeighborhood,
    setFrom,
    setTo,
  } = filters;
  const guideRequest = useRef(0);
  useEffect(() => {
    const prepare = async (event: Event) => {
      const step = (event as CustomEvent).detail?.step;
      if (!boot || !step || !hasModuleAccess(boot.user, step.module)) return;
      const generation = ++guideRequest.current;
      if (step.page === "field") return;
      setMobile(false);
      setDetail(null);
      setModal(null);
      setMapOnly(!!step.fullMap);
      setFieldMode(false);
      setPage(step.page);
      setQ("");
      setStatus(step.filter || "");
      setPriority("");
      setTeam("");
      setDeadline("");
      setCategory("");
      setNeighborhood("");
      setFrom("");
      setTo("");
      history.replaceState(null, "", step.fullMap ? "/mapa" : step.path);
      if (step.adminTab) setAdminTab(step.adminTab);
      if (
        step.guideMode === "new-user" &&
        boot.user.role === "Administrador" &&
        hasModuleAccess(boot.user, "admin")
      )
        setModal({ type: "user" });
      if (step.detail) {
        // Registro mais recente nos estados do passo, buscado no servidor (mesma ordem das listas).
        const resource =
          step.detail === "order" ? "ordens-servico" : "ocorrencias";
        try {
          const params = new URLSearchParams({ limit: "1" });
          if (step.states) params.set("status", step.states.join(","));
          const record = (await api(`/${resource}?${params}`)).items[0];
          if (!record || generation !== guideRequest.current) return;
          const data = await api("/" + resource + "/" + record.id);
          if (generation === guideRequest.current)
            setDetail({
              type: step.detail,
              ...data,
              initialTab: step.detailTab || "overview",
              guideKey: step.id,
              guideMode: step.guideMode,
            });
        } catch {
          /* Keep the real empty/list area available for educational guidance. */
        }
      }
    };
    const end = () => {
      guideRequest.current++;
      setModal(null);
    };
    window.addEventListener("urbana:onboarding-navigate", prepare);
    window.addEventListener("urbana:onboarding-end", end);
    return () => {
      window.removeEventListener("urbana:onboarding-navigate", prepare);
      window.removeEventListener("urbana:onboarding-end", end);
    };
  }, [boot]);
}
