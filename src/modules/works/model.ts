import { geometrySummary, type Geometry } from "../../../shared/geometry.mjs";

export { worksLabels, worksColors, featureStyle } from "./labels";
/** Rótulo do botão que leva a cada situação, a partir da situação atual. */
export const transitionLabel = (from: string, to: string) =>
  to === "EM_ANDAMENTO"
    ? from === "PLANEJADA"
      ? "Iniciar"
      : from === "PARALISADA"
        ? "Retomar"
        : "Reabrir"
    : to === "PARALISADA"
      ? "Paralisar"
      : to === "CONCLUIDA"
        ? "Concluir"
        : to === "CANCELADA"
          ? "Cancelar"
          : to;
export const needsReason = (from: string, to: string) =>
  to === "PARALISADA" ||
  to === "CANCELADA" ||
  (from === "CONCLUIDA" && to === "EM_ANDAMENTO");
export const scopeLabels: Record<string, string> = {
  TRECHO: "Trecho de via",
  AREA: "Área",
  ATIVO: "Ativo / equipamento",
};
export const geometryTypeLabels: Record<string, string> = {
  Point: "Ponto",
  LineString: "Linha",
  Polygon: "Polígono",
  MultiLineString: "Várias linhas",
};

export const dateBR = (value?: string | null) =>
  value ? value.slice(0, 10).split("-").reverse().join("/") : "—";
export const periodBR = (start?: string | null, end?: string | null) =>
  start ? `${dateBR(start)} a ${end ? dateBR(end) : "—"}` : "—";
const number = (n: number) => n.toLocaleString("pt-BR");
const coord = (n: number) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });

/** Alternativa textual à geometria: tipo, pontos, extensão ou área e centro aproximado. */
export function describeGeometry(g: Geometry | null | undefined) {
  if (!g) return "Sem geometria.";
  const s = geometrySummary(g);
  const center = `centro aproximado em latitude ${coord(s.center[1])}, longitude ${coord(s.center[0])}`;
  if (g.type === "Point")
    return `Ponto em latitude ${coord(g.coordinates[1])}, longitude ${coord(g.coordinates[0])}.`;
  if (g.type === "Polygon")
    return `Polígono com ${s.vertices} vértices, área aproximada de ${number(s.area_m2)} m² e perímetro de ${number(s.length_m)} m; ${center}.`;
  return `${g.type === "LineString" ? "Linha" : `${g.coordinates.length} linhas`} com ${s.vertices} pontos e extensão aproximada de ${number(s.length_m)} m; ${center}.`;
}
