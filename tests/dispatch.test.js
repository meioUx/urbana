import test from "node:test";
import assert from "node:assert/strict";
import { summarizeTeam } from "../src/dispatch-model.mjs";

test("dispatch load separates field activity, review, returns and date commitments", () => {
  const base = { team_id: "a", scheduled_at: "2026-10-02", due_at: "2026-10-03T00:00:00Z" };
  const orders = [
    { ...base, status: "PROGRAMADA", occurrence_ids: ["1", "2"] },
    { ...base, status: "EM_EXECUCAO", occurrence_ids: ["3"] },
    { ...base, status: "EM_DESLOCAMENTO", scheduled_at: "2026-10-01", occurrence_ids: ["4"], due_at: "2026-09-30T00:00:00Z" },
    { ...base, status: "AGUARDANDO_VALIDACAO", occurrence_ids: ["5"] },
    { ...base, status: "DEVOLVIDA", occurrence_ids: ["6"] },
    { ...base, status: "CONCLUIDA", occurrence_ids: ["7"] },
    { ...base, status: "CANCELADA", occurrence_ids: ["8"] },
    { ...base, team_id: "b", status: "PROGRAMADA", occurrence_ids: ["9"] },
  ];
  assert.deepEqual(summarizeTeam(orders, "a", "2026-10-02", Date.parse("2026-10-01T12:00:00Z")), { open: 5, calls: 6, running: 2, scheduled: 1, review: 1, returned: 1, onDate: 2, overdue: 1 });
  assert.equal(summarizeTeam(orders, "a", "2026-10-04").onDate, 0);
  assert.equal(summarizeTeam(orders, "unknown", "2026-10-02").open, 0);
});

test("linked calls are distinct across open orders and missing dates are not commitments", () => {
  assert.deepEqual(summarizeTeam([
    { team_id: "a", status: "PROGRAMADA", occurrence_ids: ["1", "2"] },
    { team_id: "a", status: "EM_EXECUCAO", occurrence_ids: ["2", "3"] },
  ], "a", "", 0), { open: 2, calls: 3, running: 1, scheduled: 1, review: 0, returned: 0, onDate: 0, overdue: 0 });
});
