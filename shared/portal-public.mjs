// Portal do cidadão: fixed public texts for a refused demand, shared by the server (validation and the
// public tracking answer) and the triage screen (choice of the message shown to the citizen).
// The internal free-text refusal reason is never shown publicly.
export const PUBLIC_REASONS = Object.freeze({
  fora_competencia: "O serviço pedido não é de responsabilidade da Prefeitura.",
  ja_registrada:
    "Já existe uma demanda registrada para este mesmo problema; ela segue o atendimento normal.",
  informacao_insuficiente:
    "As informações enviadas não foram suficientes para localizar ou avaliar o problema. Você pode registrar uma nova demanda com mais detalhes.",
  nao_procede:
    "Após análise, não foi identificada necessidade de serviço no local.",
});
export const PUBLIC_REASON_CODES = Object.freeze(Object.keys(PUBLIC_REASONS));
export const DEFAULT_REFUSAL_TEXT =
  "A demanda foi analisada e não será atendida. Para mais informações, procure a central de atendimento da Prefeitura.";
export const CANCELLED_TEXT =
  "O atendimento foi cancelado pela Prefeitura. Para mais informações, procure a central de atendimento.";
export const PORTAL_ORIGIN = "Portal do cidadão";
