import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  getAllowedTransitions,
  assertTransition,
  occurrenceStatuses,
  orderStatuses,
  workflowStatus as status,
} from "../server/domain/workflow.js";

test("canonical workflow separates occurrence decisions from order execution", () => {
  assert.deepEqual(occurrenceStatuses, ["IDENTIFICADA", "EM_TRIAGEM", "RECUSADA"]);
  assert.ok(orderStatuses.includes(status.PROGRAMADA));
  assert.ok(!orderStatuses.includes(status.EM_TRIAGEM));
  assert.deepEqual(getAllowedTransitions(status.IDENTIFICADA, "occurrence"), [
    status.EM_TRIAGEM,
    status.RECUSADA,
  ]);
  assert.deepEqual(getAllowedTransitions(status.EM_TRIAGEM, "order"), []);
});

test("canonical workflow permits only implemented order transitions", () => {
  assert.equal(canTransition(status.PROGRAMADA, status.EM_EXECUCAO, "order"), true);
  assert.equal(canTransition(status.EM_EXECUCAO, status.CONCLUIDA, "order"), false);
  assert.equal(canTransition(status.AGUARDANDO_VALIDACAO, status.CONCLUIDA, "order"), true);
  assert.equal(canTransition(status.DEVOLVIDA, status.PROGRAMADA, "order"), true);
  assert.equal(canTransition(status.CANCELADA, status.PROGRAMADA, "order"), false);
});

test("invalid canonical transition fails with structured error", () => {
  assert.throws(
    () => assertTransition(status.IDENTIFICADA, status.CONCLUIDA, "occurrence"),
    (error) => error.code === "INVALID_TRANSITION" && error.entityType === "occurrence",
  );
});


test("transition tables cannot be changed by consumers", async () => {
  const { occurrenceTransitions, orderTransitions } = await import("../server/domain/workflow.js");
  assert.throws(() => orderTransitions.PROGRAMADA.push(status.CONCLUIDA), TypeError);
  assert.throws(() => occurrenceTransitions.RECUSADA.push(status.EM_TRIAGEM), TypeError);
  const copy = getAllowedTransitions(status.PROGRAMADA);
  copy.push(status.CONCLUIDA);
  assert.equal(canTransition(status.PROGRAMADA, status.CONCLUIDA), false);
});

test("all canonical transitions are covered and terminal states stay closed", () => {
  const expected = {
    PROGRAMADA: ["EM_DESLOCAMENTO", "EM_EXECUCAO", "DEVOLVIDA", "CANCELADA"],
    EM_DESLOCAMENTO: ["EM_EXECUCAO", "DEVOLVIDA", "CANCELADA"],
    EM_EXECUCAO: ["AGUARDANDO_VALIDACAO", "DEVOLVIDA", "CANCELADA"],
    AGUARDANDO_VALIDACAO: ["CONCLUIDA", "EM_EXECUCAO"],
    DEVOLVIDA: ["PROGRAMADA"], CONCLUIDA: ["EM_EXECUCAO"], CANCELADA: [],
  };
  for (const from of orderStatuses) for (const to of Object.values(status)) {
    assert.equal(canTransition(from, to), expected[from].includes(to), from + " ? " + to);
  }
  assert.deepEqual(getAllowedTransitions("UNKNOWN"), []);
  assert.throws(() => getAllowedTransitions(status.PROGRAMADA, "project"), TypeError);
});
