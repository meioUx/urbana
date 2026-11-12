import {
  canPerformAction,
  hasModuleAccess,
} from "../../shared/authorization.mjs";
import type { Boot } from "./types";

/** Módulos em que cada ação precisa estar liberada, além da permissão do perfil. */
const actionModules: Record<string, string[]> = {
  create: ["occurrences", "field"],
  classify: ["triagem"],
  schedule: ["orders", "planning", "materials", "sector-control"],
  execute: ["field"],
  validate: ["review"],
  admin: ["admin"],
  works: ["works"],
};

/** Indica se o usuário da sessão pode executar a ação na interface. */
export const canAct = (boot: Boot | null, action: string) =>
  !!boot &&
  canPerformAction(boot.user, action) &&
  actionModules[action]?.some((m) => hasModuleAccess(boot.user, m));
