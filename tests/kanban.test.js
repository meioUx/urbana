import test from "node:test";
import assert from "node:assert/strict";
import {
  availableMoves,
  buildKanbanCards,
  cardKey,
  flowMetrics,
  sortKanbanCards,
  teamColor,
} from "../src/kanban-model.mjs";

test("kanban keeps triage demands and groups linked calls into one operational order", () => {
  const occurrences = [
    { id: "new", status: "IDENTIFICADA" },
    { id: "triage", status: "EM_TRIAGEM" },
    { id: "linked1", status: "EM_EXECUCAO" },
    { id: "linked2", status: "EM_EXECUCAO" },
  ];
  const cards = buildKanbanCards(occurrences, [
    {
      id: "os",
      status: "EM_EXECUCAO",
      team_id: "team",
      occurrence_ids: ["linked1", "linked2"],
    },
  ]);
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.filter((c) => c.type === "occurrence").map((c) => c.id),
    ["new", "triage"],
  );
  assert.deepEqual(
    cards.find((c) => c.id === "os").occurrences.map((o) => o.id),
    ["linked1", "linked2"],
  );
  assert.equal(cards.find((c) => c.id === "os").team_id, "team");
  assert.ok(
    cards.filter((c) => c.type === "occurrence").every((c) => c.team_id === ""),
  );
});

test("kanban offers only authorized operational transitions, without skipping required steps", () => {
  const all = () => true,
    none = () => false;
  assert.deepEqual(
    availableMoves({ type: "occurrence", status: "IDENTIFICADA" }, all).map(
      (m) => m.status,
    ),
    ["EM_TRIAGEM", "RECUSADA"],
  );
  assert.deepEqual(
    availableMoves({ type: "order", status: "PROGRAMADA" }, none),
    [],
  );
  assert.deepEqual(
    availableMoves(
      { type: "order", status: "EM_EXECUCAO" },
      (p) => p === "validate",
    ),
    [],
  );
  assert.equal(
    availableMoves({ type: "order", status: "EM_EXECUCAO" }, all).find(
      (m) => m.status === "AGUARDANDO_VALIDACAO",
    ).form,
    "notes",
  );
  assert.equal(
    availableMoves({ type: "order", status: "PROGRAMADA" }, all).find(
      (m) => m.status === "EM_EXECUCAO",
    ).form,
    "location",
  );
  assert.ok(
    !availableMoves({ type: "order", status: "PROGRAMADA" }, all).some(
      (m) => m.status === "CONCLUIDA",
    ),
  );
  assert.deepEqual(
    availableMoves({ type: "order", status: "DEVOLVIDA" }, all).map(
      (m) => m.action,
    ),
    ["programacao"],
  );
});

test("kanban preserves shared manual order and orders new cards by priority and age", () => {
  const cards = [
    { type: "order", id: "low", priority: "Baixa", created_at: "2026-09-01" },
    {
      type: "occurrence",
      id: "urgent",
      priority: "Emergencial",
      created_at: "2026-09-10",
    },
    {
      type: "occurrence",
      id: "older",
      priority: "Alta",
      created_at: "2026-09-01",
    },
    {
      type: "occurrence",
      id: "newer",
      priority: "Alta",
      created_at: "2026-09-05",
    },
  ];
  assert.deepEqual(
    sortKanbanCards(cards).map((c) => c.id),
    ["urgent", "older", "newer", "low"],
  );
  assert.deepEqual(
    sortKanbanCards(cards, {
      EM_EXECUCAO: ["order:low", "occurrence:newer"],
    }).map(cardKey),
    ["order:low", "occurrence:newer", "occurrence:urgent", "occurrence:older"],
  );
});

test("flow metrics count work items, retain returned work and exclude cancellation from delivery", () => {
  const time = Date.parse("2026-10-01T12:00:00Z");
  const cards = [
    { type: "order", status: "DEVOLVIDA", created_at: "2026-09-21T12:00:00Z" },
    { type: "occurrence", status: "EM_TRIAGEM", created_at: "2026-08-01" },
    {
      type: "order",
      status: "CONCLUIDA",
      created_at: "2026-09-21T12:00:00Z",
      completed_at: "2026-09-25T12:00:00Z",
    },
    {
      type: "order",
      status: "CANCELADA",
      created_at: "2026-09-20",
      completed_at: "2026-09-25",
    },
    {
      type: "order",
      status: "CONCLUIDA",
      created_at: "2026-07-01",
      completed_at: "2026-08-01",
    },
  ];
  assert.deepEqual(flowMetrics(cards, time), {
    wip: 1,
    throughput: 1,
    oldest: 10,
    cycle: 4,
  });
  assert.deepEqual(flowMetrics([], time), {
    wip: 0,
    throughput: 0,
    oldest: null,
    cycle: null,
  });
});

test("kanban reflects reprogramming and preserves orders with incomplete location data", () => {
  const occurrences = [{ id: "call", status: "DEVOLVIDA" }];
  const before = buildKanbanCards(occurrences, [
    {
      id: "os",
      team_id: "a",
      status: "DEVOLVIDA",
      occurrence_ids: ["call", "missing"],
    },
  ]);
  const after = buildKanbanCards(occurrences, [
    {
      id: "os",
      team_id: "b",
      status: "PROGRAMADA",
      occurrence_ids: ["call", "missing"],
    },
  ]);
  assert.equal(before.length, 1);
  assert.equal(before[0].occurrences.length, 1);
  assert.equal(after[0].status, "PROGRAMADA");
  assert.equal(after[0].team_id, "b");
  assert.equal(teamColor("a"), teamColor("a"));
  assert.notEqual(teamColor("a"), teamColor("b"));
});
