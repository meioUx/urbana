// Portal do cidadão: settings, the system actor, tracking codes, the anti-robot form token and the
// mapping from internal workflow states to the few public steps shown to the citizen.
// Nothing here is reachable without the portal being enabled (see server/routes/portal.js).
import {
  createHash,
  createHmac,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { workflowStatus as S } from "../../domain/workflow.js";
import {
  PUBLIC_REASONS,
  DEFAULT_REFUSAL_TEXT,
  CANCELLED_TEXT,
} from "../../../shared/portal-public.mjs";

// Origin written on occurrences registered by citizens (occurrence data.origin is free text).
export { PORTAL_ORIGIN } from "../../../shared/portal-public.mjs";

// System actor used as user_id in audit_logs/evidence (both have a FK to users). It is a users row
// because of that FK only: its password column is not a valid scrypt hash (no password can match it),
// the login route refuses the role explicitly, it holds no modules and it is hidden from the admin list.
export const PORTAL_ACTOR = Object.freeze({
  id: "system-portal-cidadao",
  name: "Portal do cidadão (sistema)",
  email: "portal-cidadao@sistema.invalid",
  role: "Sistema",
});
export const SYSTEM_ROLE = "Sistema";
export const ensurePortalActor = (db) =>
  db.run(
    "INSERT INTO users(id,name,email,password,role,team_id) VALUES(?,?,?,?,?,NULL) ON CONFLICT(id) DO NOTHING",
    [
      PORTAL_ACTOR.id,
      PORTAL_ACTOR.name,
      PORTAL_ACTOR.email,
      "!sistema-sem-login",
      PORTAL_ACTOR.role,
    ],
  );

export const DEFAULT_CONSENT_TEXT =
  "Os dados deste formulário serão usados pela Prefeitura somente para analisar e atender a sua solicitação de manutenção urbana, " +
  "conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018). Nome e telefone são opcionais e servem apenas para a equipe falar " +
  "com você sobre esta demanda, se for preciso; eles não aparecem na consulta pública. A localização e a foto ajudam a encontrar o problema. " +
  "Os registros são mantidos pelo tempo necessário ao atendimento e às obrigações legais do município. Para saber mais sobre os seus dados, " +
  "procure o encarregado de proteção de dados da Prefeitura.";

export const PORTAL_DEFAULTS = Object.freeze({
  enabled: false,
  consent_text: DEFAULT_CONSENT_TEXT,
  // Per client address: every POST to the create route counts (valid or not), fixed 1-hour window.
  create_per_ip_hour: 10,
  // Per client address: every tracking lookup counts (right or wrong code), fixed 15-minute window.
  track_per_ip_15min: 30,
  // Whole portal: demands accepted per hour, so a flood cannot fill the triage queue.
  global_per_hour: 30,
  // Minimum time between loading the form and sending it (seconds).
  min_fill_seconds: 5,
});

export const portalSettingsSchema = z
  .object({
    enabled: z.boolean(),
    consent_text: z.string().trim().min(50).max(3000),
    create_per_ip_hour: z.number().int().min(1).max(100),
    track_per_ip_15min: z.number().int().min(5).max(500),
    global_per_hour: z.number().int().min(1).max(10000),
    min_fill_seconds: z.number().int().min(0).max(120),
  })
  .strict();

// URBANA_PUBLIC_PORTAL=off is a deployment kill switch: it wins over the administrative setting.
// Any other value (or none) leaves the decision to Administração > Configurações.
export const portalForcedOff = (env = process.env) =>
  ["off", "false", "0"].includes(
    String(env.URBANA_PUBLIC_PORTAL ?? "")
      .trim()
      .toLowerCase(),
  );

export async function readPortalSettings(db) {
  const row = await db.get("SELECT value FROM settings WHERE id='portal'");
  let stored;
  try {
    stored = row ? JSON.parse(row.value) : {};
  } catch {
    stored = {};
  }
  const merged = { ...PORTAL_DEFAULTS, ...stored };
  const parsed = portalSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : { ...PORTAL_DEFAULTS };
}

export async function portalEnabled(db, env = process.env) {
  if (portalForcedOff(env)) return false;
  return (await readPortalSettings(db)).enabled === true;
}

export const consentVersion = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);

// Tracking code: 16 symbols from a 31-letter alphabet without 0/O, 1/I/L (≈79 bits), shown in four
// groups of four. Only its SHA-256 is stored (same treatment as session tokens).
export const TRACKING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const TRACKING_LENGTH = 16;
export function newTrackingCode() {
  let raw = "";
  for (let i = 0; i < TRACKING_LENGTH; i++)
    raw += TRACKING_ALPHABET[randomInt(TRACKING_ALPHABET.length)];
  return raw.match(/.{4}/g).join("-");
}
export const normalizeTrackingCode = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
export const trackingHash = (value) =>
  createHash("sha256").update(normalizeTrackingCode(value)).digest("hex");
export const requestKeyHash = (value) =>
  createHash("sha256").update(`portal-request:${value}`).digest("hex");
// Compares two hex digests in constant time (always the same length here).
export const sameDigest = (a, b) => {
  const x = Buffer.from(String(a), "hex"),
    y = Buffer.from(String(b), "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

// Anti-robot form token: "<issued ms>.<hmac>" signed with a per-installation secret (settings row
// portal_secret, created by migration 13). The server checks the minimum filling time from it.
export async function portalSecret(db) {
  return (
    (await db.get("SELECT value FROM settings WHERE id='portal_secret'"))
      ?.value || ""
  );
}
const sign = (secret, issued) =>
  createHmac("sha256", secret)
    .update(`portal-form:${issued}`)
    .digest("hex")
    .slice(0, 32);
export const FORM_TOKEN_MAX_AGE_MS = 24 * 3600 * 1000;
export const issueFormToken = (secret, nowMs) =>
  `${nowMs}.${sign(secret, nowMs)}`;
// Returns "ok", "invalid" (forged, expired, from the future) or "too_fast".
export function checkFormToken(secret, token, nowMs, minFillMs) {
  const match = /^(\d{10,16})\.([0-9a-f]{32})$/.exec(String(token ?? ""));
  if (!match || !secret) return "invalid";
  const issued = Number(match[1]);
  if (!sameDigest(match[2], sign(secret, issued))) return "invalid";
  if (issued > nowMs + 60_000 || nowMs - issued > FORM_TOKEN_MAX_AGE_MS)
    return "invalid";
  if (nowMs - issued < minFillMs) return "too_fast";
  return "ok";
}

// Public steps. Internal → public:
//   IDENTIFICADA                                        → recebida
//   EM_TRIAGEM                                          → em_analise
//   PROGRAMADA, DEVOLVIDA (to be rescheduled)           → programada
//   EM_DESLOCAMENTO, EM_EXECUCAO, AGUARDANDO_VALIDACAO  → em_execucao
//   CONCLUIDA                                           → concluida
//   RECUSADA, CANCELADA                                 → nao_atendida (fixed public reason)
export const PUBLIC_STEPS = Object.freeze([
  {
    code: "recebida",
    label: "Recebida",
    description: "A demanda chegou à Prefeitura e aguarda análise.",
  },
  {
    code: "em_analise",
    label: "Em análise",
    description:
      "A equipe técnica analisou a demanda e vai definir quando atender.",
  },
  {
    code: "programada",
    label: "Programada",
    description: "O serviço foi programado para uma equipe.",
  },
  {
    code: "em_execucao",
    label: "Em execução",
    description: "A equipe está realizando ou conferindo o serviço.",
  },
  {
    code: "concluida",
    label: "Concluída",
    description: "O serviço foi realizado e conferido.",
  },
]);
export const NOT_SERVED = Object.freeze({
  code: "nao_atendida",
  label: "Não atendida",
  description: "A demanda foi analisada e não será atendida.",
});

const STAGE_OF = {
  [S.IDENTIFICADA]: "recebida",
  [S.EM_TRIAGEM]: "em_analise",
  [S.PROGRAMADA]: "programada",
  [S.DEVOLVIDA]: "programada",
  [S.EM_DESLOCAMENTO]: "em_execucao",
  [S.EM_EXECUCAO]: "em_execucao",
  [S.AGUARDANDO_VALIDACAO]: "em_execucao",
  [S.CONCLUIDA]: "concluida",
  [S.RECUSADA]: "nao_atendida",
  [S.CANCELADA]: "nao_atendida",
};
export const publicStage = (status) => STAGE_OF[status] || "em_analise";

// Fixed public texts for a refusal (shared with the triage screen). The internal free-text reason is
// never shown; triage may pick one of these codes when refusing (optional public_reason on
// POST /api/ocorrencias/:id/recusar).
export {
  PUBLIC_REASONS,
  PUBLIC_REASON_CODES,
  DEFAULT_REFUSAL_TEXT,
  CANCELLED_TEXT,
} from "../../../shared/portal-public.mjs";

const TRIAGE_EVENT = "Triagem e encaminhamento registrados";
// Builds the public view of one occurrence from its row and its audit trail (only event names,
// timestamps and the status field of after_value are read; nothing else leaves this function).
export function publicTracking(occurrence, auditRows, categoryName) {
  const current = publicStage(occurrence.status);
  const at = { recebida: occurrence.created_at };
  for (const row of [...auditRows].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)),
  )) {
    let stage = null;
    if (row.event === TRIAGE_EVENT) stage = "em_analise";
    else {
      try {
        const status = row.after_value
          ? JSON.parse(row.after_value)?.status
          : null;
        if (typeof status === "string") stage = publicStage(status);
      } catch {
        stage = null;
      }
    }
    // Most recent entry into each step (a reopened service re-enters "em execução").
    if (stage && stage !== "recebida") at[stage] = row.created_at;
  }
  let reason = null;
  if (current === "nao_atendida")
    reason =
      occurrence.status === S.CANCELADA
        ? CANCELLED_TEXT
        : PUBLIC_REASONS[occurrence.public_reason] || DEFAULT_REFUSAL_TEXT;
  const order = PUBLIC_STEPS.map((s) => s.code);
  const reached = current === "nao_atendida" ? -1 : order.indexOf(current);
  const steps = PUBLIC_STEPS.map((step, index) => ({
    code: step.code,
    label: step.label,
    done:
      current === "nao_atendida" ? Boolean(at[step.code]) : index <= reached,
    current: step.code === current,
    at:
      (current === "nao_atendida"
        ? at[step.code]
        : index <= reached
          ? at[step.code]
          : null) || null,
  }));
  if (current === "nao_atendida")
    steps.push({
      code: NOT_SERVED.code,
      label: NOT_SERVED.label,
      done: true,
      current: true,
      at: at.nao_atendida || occurrence.rejected_at || null,
    });
  const status =
    current === "nao_atendida"
      ? NOT_SERVED
      : PUBLIC_STEPS.find((s) => s.code === current);
  return {
    protocol: occurrence.code,
    category: categoryName || null,
    neighborhood: occurrence.neighborhood || null,
    status: {
      code: status.code,
      label: status.label,
      text: status.description,
    },
    reason,
    steps,
  };
}
