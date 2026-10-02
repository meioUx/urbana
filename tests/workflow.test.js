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
