import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedWorksTransitions,
  assertWorksTransition,
  canWorksTransition,
  findConflicts,
  interventionTransitions,
  periodOverlap,
  projectTransitions,
  transitionNeedsReason,
  worksStatuses,
} from "../server/domain/works.js";
import { orderStatuses } from "../server/domain/workflow.js";
import {
  GeometryError,
  geometryBBox,
  geometryDistance,
  geometrySummary,
  normalizeGeometry,
} from "../shared/geometry.mjs";

test("intervention and work lifecycles are explicit, frozen and independent of the OS workflow", () => {
  const expected = {
    PLANEJADA: ["EM_ANDAMENTO", "CANCELADA"],
    EM_ANDAMENTO: ["PARALISADA", "CONCLUIDA", "CANCELADA"],
    PARALISADA: ["EM_ANDAMENTO", "CANCELADA"],
    CONCLUIDA: ["EM_ANDAMENTO"],
    CANCELADA: [],
  };
  for (const [kind, table] of [
    ["intervention", interventionTransitions],
    ["project", projectTransitions],
  ]) {
    assert.deepEqual(JSON.parse(JSON.stringify(table)), expected);
    assert.ok(
      Object.isFrozen(table) && Object.values(table).every(Object.isFrozen),
    );
    assert.deepEqual(worksStatuses(kind), Object.keys(expected));
    for (const [from, targets] of Object.entries(expected))
      for (const to of worksStatuses(kind)) {
        assert.equal(
          canWorksTransition(kind, from, to),
          targets.includes(to),
          `${kind} ${from}→${to}`,
        );
        if (!targets.includes(to))
          assert.throws(
            () => assertWorksTransition(kind, from, to),
            (e) => e.status === 409 && e.code === "INVALID_STATUS",
          );
      }
    // Returned arrays are copies: callers cannot change the machine.
    allowedWorksTransitions(kind, "PLANEJADA").push("CONCLUIDA");
    assert.equal(canWorksTransition(kind, "PLANEJADA", "CONCLUIDA"), false);
  }
  // No OS state belongs to these machines (and vice versa no OS-only state leaks in).
  for (const state of [
    "PROGRAMADA",
    "EM_DESLOCAMENTO",
    "EM_EXECUCAO",
    "AGUARDANDO_VALIDACAO",
    "DEVOLVIDA",
  ]) {
    assert.ok(orderStatuses.includes(state));
    assert.ok(!worksStatuses("intervention").includes(state));
  }
  assert.throws(
    () => canWorksTransition("order", "PLANEJADA", "CANCELADA"),
    TypeError,
  );
  assert.equal(
    transitionNeedsReason("intervention", "EM_ANDAMENTO", "PARALISADA"),
    true,
  );
  assert.equal(
    transitionNeedsReason("intervention", "PLANEJADA", "CANCELADA"),
    true,
  );
  assert.equal(
    transitionNeedsReason("project", "CONCLUIDA", "EM_ANDAMENTO"),
    true,
  );
  assert.equal(
    transitionNeedsReason("project", "PARALISADA", "EM_ANDAMENTO"),
    false,
  );
  assert.equal(
    transitionNeedsReason("intervention", "EM_ANDAMENTO", "CONCLUIDA"),
    false,
  );
});

test("geometry validation accepts point, line, polygon and multiline and rejects invalid shapes", () => {
  assert.deepEqual(
    normalizeGeometry({
      type: "Point",
      coordinates: [-48.63512345678, -26.99],
    }),
    { type: "Point", coordinates: [-48.6351235, -26.99] },
  );
  // Repeated consecutive points are dropped; elevation is ignored.
  assert.deepEqual(
    normalizeGeometry({
      type: "LineString",
      coordinates: [
        [-48.6, -27, 5],
        [-48.6, -27],
        [-48.61, -27.01],
      ],
    }).coordinates,
    [
      [-48.6, -27],
      [-48.61, -27.01],
    ],
  );
  const square = [
    [-48.6, -27],
    [-48.59, -27],
    [-48.59, -26.99],
    [-48.6, -26.99],
    [-48.6, -27],
  ];
  assert.equal(
    normalizeGeometry({ type: "Polygon", coordinates: [square] }).type,
    "Polygon",
  );
  assert.equal(
    normalizeGeometry({
      type: "MultiLineString",
      coordinates: [
        [
          [-48.6, -27],
          [-48.61, -27],
        ],
        [
          [-48.6, -27.1],
          [-48.61, -27.1],
        ],
      ],
    }).coordinates.length,
    2,
  );
  const invalid = [
    undefined,
    "LINESTRING(0 0, 1 1)",
    { type: "MultiPolygon", coordinates: [] },
    { type: "Point", coordinates: [200, 0] },
    { type: "Point", coordinates: [0, -91] },
    { type: "Point", coordinates: ["-48", "-27"] },
    { type: "Point", coordinates: [Number.NaN, 0] },
    { type: "LineString", coordinates: [[-48.6, -27]] },
    {
      type: "LineString",
      coordinates: [
        [-48.6, -27],
        [-48.6, -27],
      ],
    },
    {
      type: "LineString",
      coordinates: [
        [179.9, 0],
        [-179.9, 0],
      ],
    },
    { type: "Polygon", coordinates: [square.slice(0, -1)] }, // not closed
    {
      type: "Polygon",
      coordinates: [
        [
          [-48.6, -27],
          [-48.59, -27],
          [-48.6, -27],
        ],
      ],
    }, // too few points
    {
      type: "Polygon",
      coordinates: [
        [
          [-48.6, -27],
          [-48.59, -27],
          [-48.58, -27],
          [-48.6, -27],
        ],
      ],
    }, // no area
    {
      type: "Polygon",
      coordinates: [
        [
          [-48.6, -27],
          [-48.59, -26.99],
          [-48.59, -27],
          [-48.6, -26.99],
          [-48.6, -27],
        ],
      ],
    }, // bow tie
    {
      type: "Polygon",
      coordinates: [
        square,
        [
          [-48.7, -27.1],
          [-48.69, -27.1],
          [-48.69, -27.09],
          [-48.7, -27.1],
        ],
      ],
    }, // hole outside
    {
      type: "LineString",
      coordinates: Array.from({ length: 1001 }, (_, i) => [-48 - i / 1e4, -27]),
    },
  ];
  for (const g of invalid)
    assert.throws(
      () => normalizeGeometry(g),
      GeometryError,
      JSON.stringify(g)?.slice(0, 80),
    );
  assert.deepEqual(
    geometryBBox(normalizeGeometry({ type: "Polygon", coordinates: [square] })),
    [-48.6, -27, -48.59, -26.99],
  );
});

test("geometry distance and summary support conflict detection and the text alternative", () => {
  const street = {
    type: "LineString",
    coordinates: [
      [-48.6, -27],
      [-48.59, -27],
    ],
  };
  const crossing = {
    type: "LineString",
    coordinates: [
      [-48.595, -27.001],
      [-48.595, -26.999],
    ],
  };
  const parallel = {
    type: "LineString",
    coordinates: [
      [-48.6, -27.0001],
      [-48.59, -27.0001],
    ],
  }; // ~11 m
  const far = { type: "Point", coordinates: [-48.5, -27] };
  const area = {
    type: "Polygon",
    coordinates: [
      [
        [-48.597, -27.002],
        [-48.593, -27.002],
        [-48.593, -26.998],
        [-48.597, -26.998],
        [-48.597, -27.002],
      ],
    ],
  };
  const inside = { type: "Point", coordinates: [-48.595, -26.999] };
  assert.equal(geometryDistance(street, crossing), 0);
  assert.ok(Math.abs(geometryDistance(street, parallel) - 11.1) < 0.5);
  assert.ok(geometryDistance(street, far) > 8000);
  assert.equal(geometryDistance(area, inside), 0);
  assert.equal(geometryDistance(inside, area), 0);
  assert.equal(geometryDistance(street, area), 0);
  const summary = geometrySummary(street);
  assert.equal(summary.vertices, 2);
  assert.ok(Math.abs(summary.length_m - 991) < 5, String(summary.length_m));
  assert.ok(Math.abs(geometrySummary(area).area_m2 - 397 * 445) < 3000);
  assert.deepEqual(geometrySummary(inside), {
    type: "Point",
    vertices: 1,
    length_m: 0,
    area_m2: 0,
    center: [-48.595, -26.999],
  });
});

test("conflicts require spatial and temporal overlap among active interventions", () => {
  const base = {
    id: "a",
    status: "PLANEJADA",
    planned_start: "2026-12-01",
    planned_end: "2026-12-10",
    geometry: {
      type: "LineString",
      coordinates: [
        [-48.6, -27],
        [-48.59, -27],
      ],
    },
  };
  const same = {
    ...base,
    id: "b",
    planned_start: "2026-12-10",
    planned_end: "2026-12-20",
  };
  const later = {
    ...base,
    id: "c",
    planned_start: "2026-12-11",
    planned_end: "2026-12-20",
  };
  const distant = {
    ...base,
    id: "d",
    geometry: { type: "Point", coordinates: [-48.5, -27] },
  };
  const cancelled = { ...base, id: "e", status: "CANCELADA" };
  const near = {
    ...base,
    id: "f",
    status: "EM_ANDAMENTO",
    geometry: { type: "Point", coordinates: [-48.595, -27.0001] },
  };
  const found = findConflicts(base, [
    base,
    same,
    later,
    distant,
    cancelled,
    near,
  ]);
  assert.deepEqual(
    found.map((c) => c.other.id),
    ["b", "f"],
  );
  assert.deepEqual(found[0].overlap, {
    start: "2026-12-10",
    end: "2026-12-10",
  });
  assert.deepEqual(findConflicts(base, [near], 5), []);
  assert.deepEqual(findConflicts({ ...base, status: "CONCLUIDA" }, [same]), []);
  assert.equal(
    periodOverlap("2026-01-01", "2026-01-05", "2026-01-06", "2026-01-09"),
    null,
  );
});
