// Regras puras da operação offline do Campo: fila de ações (outbox), projeção otimista da OS,
// validações antecipadas e sincronização em ordem. Sem DOM nem IndexedDB: roda no navegador e
// nos testes do Node (tests/field-outbox.test.js). O transporte e o armazenamento são injetados.

/** Transições que a equipe de campo executa, espelhando server/app.js (from → to). */
export const TRANSITIONS = {
  assumir: { from: ["PROGRAMADA"], to: "EM_DESLOCAMENTO" },
  iniciar: { from: ["PROGRAMADA", "EM_DESLOCAMENTO"], to: "EM_EXECUCAO" },
  concluir: { from: ["EM_EXECUCAO"], to: "AGUARDANDO_VALIDACAO" },
  devolver: {
    from: ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"],
    to: "DEVOLVIDA",
  },
};
export const ACTION_KINDS = [
  ...Object.keys(TRANSITIONS),
  "material",
  "equipamento",
  "anexo",
];
export const ACTIVE_STATUSES = ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"];
const CLOSED_FOR_ATTACHMENTS = [
  "AGUARDANDO_VALIDACAO",
  "DEVOLVIDA",
  "CONCLUIDA",
  "CANCELADA",
  "RECUSADA",
];

/** Mensagens iguais às do servidor, para o operador ver o mesmo texto online e offline. */
export const MESSAGES = {
  INVALID_STATUS: "Ação incompatível com o status atual.",
  BEFORE_PHOTO_REQUIRED: "Anexe uma foto antes de iniciar a execução.",
  AFTER_PHOTO_REQUIRED: "Anexe uma foto depois do serviço.",
  MATERIAL_REQUIRED: "Registre o material utilizado antes de concluir.",
  RECORD_CLOSED: "Registro encerrado para anexos.",
  GPS_REQUIRED: "Capture o GPS do local antes de enviar a foto.",
  START_GPS_REQUIRED: "Capture o GPS do local antes de iniciar o serviço.",
  EXECUTION_REQUIRED_PHOTO: "Esta evidência exige execução iniciada.",
  EXECUTION_REQUIRED_MATERIAL:
    "Inicie a execução antes de registrar materiais.",
  EXECUTION_REQUIRED_EQUIPMENT:
    "Inicie a execução antes de registrar equipamentos.",
  NOTES_REQUIRED: "Descreva o que foi feito antes de enviar para análise.",
  REASON_REQUIRED: "Informe o motivo da devolução.",
  QUANTITY_INVALID: "Informe uma quantidade maior que zero.",
};

/** Texto legível para uma ação da fila (painel de pendências e anúncios). */
export function actionLabel(item) {
  if (!item) return "Ação";
  if (item.kind === "anexo") return `Foto ${item.body?.stage || ""} do serviço`;
  return (
    {
      assumir: "Estou a caminho",
      iniciar: "Chegada e início do serviço",
      concluir: "Relato e envio para análise",
      devolver: "Devolução à gestão",
      material: "Material utilizado",
      equipamento: "Equipamento utilizado",
    }[item.kind] || "Ação"
  );
}

/** Ordem de envio: sequência local (seq), desempate pelo identificador. */
export function sortQueue(items) {
  return [...(items || [])].sort(
    (a, b) => a.seq - b.seq || String(a.id).localeCompare(String(b.id)),
  );
}

/**
 * Próxima ação a enviar. A fila é processada em ordem; uma ação rejeitada bloqueia apenas as
 * ações seguintes da MESMA OS (que dependem dela), nunca as de outras OS.
 */
export function nextSendable(items) {
  const blocked = new Set();
  for (const item of sortQueue(items)) {
    if (item.status === "rejected") {
      blocked.add(item.order_id);
      continue;
    }
    if (blocked.has(item.order_id)) continue;
    return item;
  }
  return null;
}

/** Situação de cada ação para exibição: pendente, aguardando (bloqueada) ou rejeitada. */
export function queueStates(items) {
  const blocked = new Set();
  return sortQueue(items).map((item) => {
    if (item.status === "rejected") {
      blocked.add(item.order_id);
      return { item, state: "rejected" };
    }
    return { item, state: blocked.has(item.order_id) ? "waiting" : "pending" };
  });
}

export function queueSummary(items) {
  const states = queueStates(items);
  return {
    total: states.length,
    pending: states.filter((s) => s.state !== "rejected").length,
    rejected: states.filter((s) => s.state === "rejected").length,
    orders: [...new Set(states.map((s) => s.item.order_id))],
  };
}

/**
 * Classifica uma falha de envio:
 * - network: sem resposta (sem sinal, tempo esgotado) → tentar de novo com espera crescente;
 * - auth: 401 → pausar a fila e pedir login, sem perder nada;
 * - retry: 408/425/429/5xx → problema temporário do servidor, tentar de novo com espera;
 * - rejected: demais 4xx (com code, conflito de versão/estado, OS reatribuída) → decisão do operador.
 */
export function classifyFailure(error) {
  const status = Number(error?.status);
  if (!Number.isFinite(status) || status <= 0) return "network";
  if (status === 401) return "auth";
  if ([408, 425, 429].includes(status) || status >= 500) return "retry";
  if (status >= 400) return "rejected";
  return "retry";
}

/** Espera exponencial com variação aleatória: 2 s, 4 s, 8 s ... até 5 min. */
export function backoffDelay(attempts, random = Math.random) {
  const base = Math.min(
    5 * 60 * 1000,
    2000 * 2 ** Math.max(0, (attempts || 1) - 1),
  );
  return Math.round(base * (0.75 + random() * 0.5));
}

/** Motivo legível de uma rejeição, decidido pelo code (nunca pela mensagem). */
export function rejectionText(error) {
  const code = error?.code;
  const known = {
    VERSION_CONFLICT:
      "A ordem foi alterada pela gestão depois que você registrou esta ação. Confira os dados atualizados e decida se reenvia ou descarta.",
    INVALID_STATUS:
      "A situação da ordem mudou e esta ação não se aplica mais. Confira os dados atualizados e decida se reenvia ou descarta.",
    ORDER_NOT_ACCESSIBLE:
      "Esta ordem foi transferida para outra equipe ou operador e não está mais com você.",
    BEFORE_PHOTO_REQUIRED:
      "O servidor não encontrou a foto antes do serviço. Envie uma nova foto antes de iniciar.",
    AFTER_PHOTO_REQUIRED:
      "O servidor não encontrou a foto depois do serviço. Envie uma nova foto antes de concluir.",
    MATERIAL_REQUIRED:
      "O servidor exige o material utilizado antes de concluir.",
    RECORD_CLOSED: "A ordem já foi encerrada para novas fotos.",
    INVALID_CAPTURED_AT:
      "O horário registrado pelo aparelho foi recusado (relógio incorreto ou ação com mais de 30 dias). Ao reenviar, será usado o horário do servidor.",
    REQUEST_ID_REUSED:
      "O servidor recusou o identificador desta ação. Descarte-a e registre novamente.",
    VERSION_REQUIRED: "A ordem precisa ser atualizada antes do envio.",
  };
  if (code && known[code]) return known[code];
  if (Number(error?.status) === 404)
    return "A ordem não foi encontrada no servidor.";
  return error?.message || "O servidor recusou esta ação.";
}

const timeOf = (value) => {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : NaN;
};
const evidenceTime = (e) => timeOf(e.captured_at || e.created_at);
const latest = (values) =>
  values
    .filter(Boolean)
    .map(timeOf)
    .filter(Number.isFinite)
    .reduce((max, t) => Math.max(max, t), -Infinity);

/** Momento mínimo para a foto "antes" valer (regra do servidor). */
export function beforePhotoThreshold(order) {
  return latest([order.reprogrammed_at || order.created_at]);
}
/** Momento mínimo para a foto "depois" valer (regra do servidor). */
export function afterPhotoThreshold(order) {
  return latest([
    order.started_at,
    order.reopened_at,
    order.reprogrammed_at,
    order.created_at,
  ]);
}
export function hasValidPhoto(order, stage) {
  const threshold =
    stage === "antes"
      ? beforePhotoThreshold(order)
      : afterPhotoThreshold(order);
  return (order.evidence || []).some(
    (e) =>
      e.stage === stage &&
      String(e.mime || "").startsWith("image/") &&
      (!Number.isFinite(threshold) || evidenceTime(e) >= threshold),
  );
}

/** Exigências das categorias das ocorrências da OS (catálogo "categorias" do bootstrap). */
export function requirementsFor(order, catalogs) {
  const categories = (order.occurrences || [])
    .map((o) => (catalogs || []).find((c) => c.id === o.category_id))
    .filter(Boolean);
  return {
    before: categories.some((c) => c.require_before),
    after: categories.some((c) => c.require_after),
    material: categories.some((c) => c.require_material),
  };
}

const validPoint = (body) =>
  body &&
  body.lat !== "" &&
  body.lng !== "" &&
  body.lat !== undefined &&
  body.lng !== undefined &&
  Number.isFinite(Number(body.lat)) &&
  Number.isFinite(Number(body.lng)) &&
  Math.abs(Number(body.lat)) <= 90 &&
  Math.abs(Number(body.lng)) <= 180;

/**
 * Antecipa localmente as validações que o servidor fará, sobre a OS projetada (já com as ações
 * pendentes aplicadas). Retorna { code, message } ou null quando a ação pode entrar na fila.
 */
export function validateAction(order, kind, body = {}, catalogs = []) {
  if (!order)
    return {
      code: "ORDER_UNAVAILABLE",
      message: "Ordem indisponível neste aparelho.",
    };
  const fail = (code, message = MESSAGES[code]) => ({ code, message });
  const transition = TRANSITIONS[kind];
  if (transition && !transition.from.includes(order.status))
    return fail("INVALID_STATUS");
  const needs = requirementsFor(order, catalogs);
  if (kind === "iniciar") {
    if (!validPoint(body)) return fail("START_GPS_REQUIRED");
    if (needs.before && !hasValidPhoto(order, "antes"))
      return fail("BEFORE_PHOTO_REQUIRED");
  }
  if (kind === "concluir") {
    if (!String(body.notes || "").trim()) return fail("NOTES_REQUIRED");
    if (needs.after && !hasValidPhoto(order, "depois"))
      return fail("AFTER_PHOTO_REQUIRED");
    if (needs.material && !(order.materials || []).length)
      return fail("MATERIAL_REQUIRED");
  }
  if (kind === "devolver" && !String(body.reason || "").trim())
    return fail("REASON_REQUIRED");
  if (kind === "material") {
    if (order.status !== "EM_EXECUCAO")
      return fail("EXECUTION_REQUIRED_MATERIAL");
    const q = Number(body.quantity);
    if (!Number.isFinite(q) || q <= 0 || q > 1000000)
      return fail("QUANTITY_INVALID");
  }
  if (kind === "equipamento" && order.status !== "EM_EXECUCAO")
    return fail("EXECUTION_REQUIRED_EQUIPMENT");
  if (kind === "anexo") {
    if (CLOSED_FOR_ATTACHMENTS.includes(order.status))
      return fail("RECORD_CLOSED");
    if (
      ["durante", "depois"].includes(body.stage) &&
      order.status !== "EM_EXECUCAO"
    )
      return fail("EXECUTION_REQUIRED_PHOTO");
    if (!validPoint(body)) return fail("GPS_REQUIRED");
  }
  return null;
}

/** Aplica uma transição bem-sucedida (ou otimista) aos campos da OS. */
function applyTransition(order, item) {
  const to = TRANSITIONS[item.kind].to;
  const at = item.captured_at || item.created_at;
  const next = { ...order, status: to };
  if (item.kind === "assumir") {
    next.assumed_by = item.user_id;
    next.assumed_by_name = item.user_name;
  }
  if (item.kind === "iniciar") {
    next.started_at = at;
    next.arrival_location = {
      lat: Number(item.body.lat),
      lng: Number(item.body.lng),
    };
  }
  if (item.kind === "concluir") {
    next.completion_notes = item.body.notes;
    next.finished_at = at;
    next.executed_by = item.user_name;
  }
  if (item.kind === "devolver") {
    next.return_reason = item.body.reason;
    next.returned_at = at;
    next.returned_by = item.user_name;
  }
  return next;
}

/**
 * Projeção otimista: a OS como o operador a deixou, aplicando as ações ainda não enviadas.
 * Ações rejeitadas não são aplicadas; transições que não se encaixam no estado ficam "aguardando".
 * Cada entrada local recebe pending: true (e local_item: id da ação) para a interface marcar.
 */
export function projectOrder(order, items) {
  if (!order) return order;
  let next = {
    ...order,
    evidence: [...(order.evidence || [])],
    materials: [...(order.materials || [])],
    equipment: [...(order.equipment || [])],
  };
  const pending = [];
  for (const { item, state } of queueStates(
    (items || []).filter((i) => i.order_id === order.id),
  )) {
    // Rejeitadas e as que esperam a decisão sobre uma rejeitada não aparecem como feitas.
    if (state !== "pending") {
      pending.push({ item, state });
      continue;
    }
    if (TRANSITIONS[item.kind]) {
      if (!TRANSITIONS[item.kind].from.includes(next.status)) {
        pending.push({ item, state: "waiting" });
        continue;
      }
      next = applyTransition(next, item);
    } else if (item.kind === "anexo") {
      next.evidence.push({
        id: `local:${item.id}`,
        local_item: item.id,
        pending: true,
        stage: item.body.stage,
        mime: item.body.mime || "image/jpeg",
        captured_at: item.captured_at || null,
        created_at: item.captured_at || item.created_at,
        lat: Number(item.body.lat),
        lng: Number(item.body.lng),
      });
    } else if (item.kind === "material") {
      next.materials.push({
        id: `local:${item.id}`,
        local_item: item.id,
        pending: true,
        material_id: item.body.material_id,
        quantity: Number(item.body.quantity),
        created_at: item.captured_at || item.created_at,
      });
    } else if (item.kind === "equipamento") {
      if (
        !next.equipment.some((e) => e.equipment_id === item.body.equipment_id)
      )
        next.equipment.push({
          equipment_id: item.body.equipment_id,
          pending: true,
          local_item: item.id,
        });
    }
    pending.push({ item, state });
  }
  next.pending_actions = pending;
  return next;
}

/** Projeção da lista "Minhas tarefas": status otimista e quantidade de ações pendentes por OS. */
export function projectList(orders, items) {
  return (orders || []).map((order) => {
    const own = (items || []).filter((i) => i.order_id === order.id);
    if (!own.length) return order;
    const projected = projectOrder(
      { ...order, evidence: [], materials: [], equipment: [] },
      own,
    );
    return {
      ...order,
      status: projected.status,
      pending_count: own.filter((i) => i.status !== "rejected").length,
      rejected_count: own.filter((i) => i.status === "rejected").length,
    };
  });
}

/**
 * Atualiza a OS em cache depois que o servidor aceitou uma ação, antes da releitura completa:
 * transições trazem a OS (sem listas); fotos, materiais e equipamentos são acrescentados.
 */
export function applyAccepted(order, item, response, receivedAt) {
  if (!order) return order;
  if (TRANSITIONS[item.kind]) {
    if (!response || response.version === undefined) return order;
    const { replayed: _replayed, ...fields } = response;
    return {
      ...order,
      ...fields,
      evidence: order.evidence,
      materials: order.materials,
      equipment: order.equipment,
      occurrences: order.occurrences,
      history: order.history,
    };
  }
  if (item.kind === "anexo") {
    const id = response?.id || `sent:${item.id}`;
    if ((order.evidence || []).some((e) => e.id === id)) return order;
    return {
      ...order,
      evidence: [
        ...(order.evidence || []),
        {
          id,
          stage: item.body.stage,
          mime: item.body.mime || "image/jpeg",
          captured_at: item.drop_captured_at ? null : item.captured_at || null,
          created_at: receivedAt,
          lat: Number(item.body.lat),
          lng: Number(item.body.lng),
          user_id: item.user_id,
        },
      ],
    };
  }
  if (item.kind === "material") {
    if ((order.materials || []).some((m) => m.id === `sent:${item.id}`))
      return order;
    return {
      ...order,
      materials: [
        ...(order.materials || []),
        {
          id: `sent:${item.id}`,
          material_id: item.body.material_id,
          quantity: Number(item.body.quantity),
          created_at: receivedAt,
        },
      ],
    };
  }
  if (item.kind === "equipamento") {
    if (
      (order.equipment || []).some(
        (e) => e.equipment_id === item.body.equipment_id,
      )
    )
      return order;
    return {
      ...order,
      equipment: [
        ...(order.equipment || []),
        { equipment_id: item.body.equipment_id },
      ],
    };
  }
  return order;
}

/**
 * Descreve a requisição HTTP de uma ação. Transições levam a version esperada (a que o operador
 * viu, rebaseada apenas sobre as próprias transições já aceitas); todas levam request_id estável
 * e captured_at do momento real.
 */
export function buildRequest(item) {
  const base = `/ordens-servico/${item.order_id}`;
  const captured =
    item.drop_captured_at || !item.captured_at
      ? {}
      : { captured_at: item.captured_at };
  if (TRANSITIONS[item.kind]) {
    const fields =
      item.kind === "iniciar"
        ? { lat: Number(item.body.lat), lng: Number(item.body.lng) }
        : item.kind === "concluir"
          ? { notes: item.body.notes }
          : item.kind === "devolver"
            ? { reason: item.body.reason }
            : {};
    return {
      path: `${base}/${item.kind}`,
      method: "POST",
      json: {
        ...fields,
        version: item.base_version,
        request_id: item.id,
        ...captured,
      },
    };
  }
  if (item.kind === "material")
    return {
      path: `${base}/material`,
      method: "POST",
      json: {
        material_id: item.body.material_id,
        quantity: Number(item.body.quantity),
        request_id: item.id,
        ...captured,
      },
    };
  if (item.kind === "equipamento")
    return {
      path: `${base}/equipamento`,
      method: "POST",
      json: {
        equipment_id: item.body.equipment_id,
        request_id: item.id,
        ...captured,
      },
    };
  if (item.kind === "anexo")
    return {
      path: `${base}/anexos`,
      method: "POST",
      multipart: {
        stage: item.body.stage,
        lat: String(item.body.lat),
        lng: String(item.body.lng),
        request_id: item.id,
        ...captured,
      },
    };
  throw new Error(`Ação desconhecida: ${item.kind}`);
}

/** Diferença entre o relógio do servidor e o do aparelho, medida numa leitura de /campo. */
export function clockOffset(serverTime, requestStart, requestEnd) {
  const server = Date.parse(serverTime || "");
  if (
    !Number.isFinite(server) ||
    !Number.isFinite(requestStart) ||
    !Number.isFinite(requestEnd)
  )
    return 0;
  return Math.round(server - (requestStart + requestEnd) / 2);
}
/** Momento real da ação, corrigido pelo relógio do servidor quando conhecido. */
export function capturedNow(offsetMs = 0, now = Date.now()) {
  return new Date(
    now + (Number.isFinite(offsetMs) ? offsetMs : 0),
  ).toISOString();
}

/** Prepara uma ação rejeitada para reenvio por decisão do operador. */
export function prepareRetry(item, currentVersion) {
  const { error: _error, rejected_at: _rejectedAt, ...rest } = item;
  return {
    ...rest,
    status: "pending",
    attempts: 0,
    base_version:
      TRANSITIONS[item.kind] && currentVersion !== undefined
        ? currentVersion
        : item.base_version,
    drop_captured_at:
      item.drop_captured_at || item.error?.code === "INVALID_CAPTURED_AT",
  };
}

/**
 * Reenvio de uma ação rejeitada: ela volta para o fim da fila da OS. O que o operador fez depois
 * da rejeição (ex.: uma nova foto antes) vai primeiro; as ações que já estavam encadeadas depois
 * dela continuam depois. Retorna os itens alterados (com novo seq).
 */
export function resequenceForRetry(items, id, nextSeq) {
  const target = (items || []).find((i) => i.id === id);
  if (!target) return [];
  const rejectedAt = Date.parse(target.rejected_at || "") || Infinity;
  const later = sortQueue(items).filter(
    (i) => i.order_id === target.order_id && i.id !== id && i.seq > target.seq,
  );
  const madeAfter = later.filter((i) => Date.parse(i.created_at) > rejectedAt);
  const chained = later.filter((i) => !(Date.parse(i.created_at) > rejectedAt));
  return [...madeAfter, target, ...chained].map((i) => ({
    ...i,
    seq: nextSeq(),
  }));
}

/**
 * Envia a fila em ordem. Dependências injetadas:
 *   list(): Promise<item[]>        itens atuais (relidos a cada passo; outra aba pode ter mudado)
 *   save(item), remove(id)         persistência
 *   send(item): Promise<response>  transporte; lança { status, code, message } em falha
 *   accepted(item, response)       atualiza caches (opcional)
 *   rejected(item, error)          relê a OS real do servidor (opcional)
 *   now(): number
 * Retorna { sent, rejected, stop: null | "network" | "auth" | "retry", retryIn, touched }.
 */
export async function flushQueue(deps) {
  const now = deps.now || Date.now;
  const touched = new Set();
  let sent = 0,
    rejected = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const items = sortQueue(await deps.list());
    const item = nextSendable(items);
    if (!item)
      return { sent, rejected, stop: null, retryIn: 0, touched: [...touched] };
    touched.add(item.order_id);
    let response;
    try {
      response = await deps.send(item);
    } catch (error) {
      const kind = classifyFailure(error);
      const attempts = (item.attempts || 0) + 1;
      if (kind === "rejected") {
        await deps.save({
          ...item,
          status: "rejected",
          attempts,
          rejected_at: new Date(now()).toISOString(),
          error: {
            status: Number(error?.status) || null,
            code: error?.code || null,
            message: error?.message || "",
            reason: rejectionText(error),
          },
        });
        rejected++;
        if (deps.rejected) await deps.rejected(item, error);
        continue;
      }
      await deps.save({
        ...item,
        attempts,
        last_error: error?.message || "",
        last_attempt_at: new Date(now()).toISOString(),
      });
      return {
        sent,
        rejected,
        stop: kind,
        retryIn: kind === "auth" ? 0 : backoffDelay(attempts),
        touched: [...touched],
      };
    }
    await deps.remove(item.id);
    // Rebase: as próximas transições desta OS foram registradas sobre o estado que esta produziu.
    if (TRANSITIONS[item.kind] && response && response.version !== undefined)
      for (const later of items)
        if (
          later.id !== item.id &&
          later.order_id === item.order_id &&
          later.seq > item.seq &&
          TRANSITIONS[later.kind] &&
          later.status !== "rejected"
        )
          await deps.save({ ...later, base_version: response.version });
    if (deps.accepted) await deps.accepted(item, response);
    sent++;
  }
  return {
    sent,
    rejected,
    stop: "retry",
    retryIn: backoffDelay(1),
    touched: [...touched],
  };
}
