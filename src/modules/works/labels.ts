/** Situações próprias de obras e intervenções (não são as situações de OS). Arquivo leve: usado também pelo mapa territorial. */
export const worksLabels: Record<string, string> = {
  PLANEJADA: "Planejada",
  EM_ANDAMENTO: "Em andamento",
  PARALISADA: "Paralisada",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
};
export const worksColors: Record<string, string> = {
  PLANEJADA: "#6a5bb5",
  EM_ANDAMENTO: "#1f7fb8",
  PARALISADA: "#b7791f",
  CONCLUIDA: "#26896b",
  CANCELADA: "#8a9295",
};
/** Estilo das geometrias no mapa (cor por situação; tracejado quando paralisada). */
export const featureStyle = (status: string, highlight = false) => ({
  color: worksColors[status] || "#555",
  fillColor: worksColors[status] || "#555",
  weight: highlight ? 6 : 4,
  opacity: status === "CANCELADA" ? 0.5 : 0.9,
  fillOpacity: 0.25,
  dashArray: status === "PARALISADA" ? "8 6" : undefined,
});
