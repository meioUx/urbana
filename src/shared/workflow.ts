export const labels: Record<string, string> = {
  IDENTIFICADA: "Identificada",
  EM_TRIAGEM: "Pronta para programar",
  PROGRAMADA: "Programada",
  EM_DESLOCAMENTO: "Em deslocamento",
  EM_EXECUCAO: "Em execução",
  AGUARDANDO_VALIDACAO: "Aguardando validação",
  DEVOLVIDA: "Devolvida à gestão",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
  RECUSADA: "Recusada",
};
export const colors: Record<string, string> = {
  IDENTIFICADA: "#db5350",
  EM_TRIAGEM: "#b26cbd",
  PROGRAMADA: "#d48c28",
  EM_DESLOCAMENTO: "#c5a224",
  EM_EXECUCAO: "#3e86c8",
  AGUARDANDO_VALIDACAO: "#8470b3",
  DEVOLVIDA: "#a46a1c",
  CONCLUIDA: "#26896b",
  CANCELADA: "#8a9295",
  RECUSADA: "#b45656",
};

const channel = (hex: string, i: number) =>
  parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const inkCache = new Map<string, string>();
/**
 * Versão de texto de uma cor de status (R7): escurece a cor viva, sem mudar o tom, até 5,2:1 de
 * contraste sobre o fundo do selo (a própria cor a ~7%, sobre branco). As cores vivas seguem em
 * pontos, barras e mapa; só o texto usa esta.
 */
export function inkColor(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const cached = inkCache.get(hex);
  if (cached) return cached;
  const base = [0, 1, 2].map((i) => channel(hex, i));
  const tint = base.map((v) => Math.round(255 - (255 - v) * 0.075));
  const bg = luminance(tint);
  let out = base;
  for (let step = 0; step <= 40; step++) {
    const k = 1 - step * 0.02;
    out = base.map((v) => Math.round(v * k));
    const l = luminance(out);
    if ((Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05) >= 5.2) break;
  }
  const result = `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  inkCache.set(hex, result);
  return result;
}
