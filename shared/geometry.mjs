// Portable GeoJSON geometry helpers for interventions (server validation, conflict checks and the
// text alternative shown in the interface). Coordinates are [lng, lat] in WGS 84 (EPSG:4326).
// Distances use a local equirectangular projection, adequate at municipal scale (a few km); they
// are not geodesic measurements and must not be used across large areas.

export const GEOMETRY_TYPES = Object.freeze([
  "Point",
  "LineString",
  "Polygon",
  "MultiLineString",
]);
export const MAX_GEOMETRY_VERTICES = 1000;
const EARTH = 6371000;
const PRECISION = 1e7;

export class GeometryError extends Error {
  constructor(message) {
    super(message);
    this.name = "GeometryError";
  }
}
const invalid = (message) => {
  throw new GeometryError(message);
};

const position = (value) => {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3)
    invalid("Cada ponto deve ter longitude e latitude.");
  const [lng, lat] = value;
  if (
    typeof lng !== "number" ||
    typeof lat !== "number" ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat)
  )
    invalid("Coordenadas devem ser números.");
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90)
    invalid("Coordenadas fora dos limites geográficos.");
  return [
    Math.round(lng * PRECISION) / PRECISION,
    Math.round(lat * PRECISION) / PRECISION,
  ];
};
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
// Consecutive repeated points carry no shape information and are dropped.
const dedupe = (points) =>
  points.filter((p, i) => i === 0 || !same(p, points[i - 1]));
const noAntimeridian = (points) => {
  for (let i = 1; i < points.length; i++)
    if (Math.abs(points[i][0] - points[i - 1][0]) > 180)
      invalid("Geometrias que cruzam o antimeridiano não são aceitas.");
};
const line = (value) => {
  if (!Array.isArray(value)) invalid("Linha inválida.");
  const points = dedupe(value.map(position));
  if (points.length < 2)
    invalid("Uma linha precisa de pelo menos dois pontos distintos.");
  noAntimeridian(points);
  return points;
};

// Planar helpers on projected [x, y] meters.
const projector = (lat0) => {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return ([lng, lat]) => [
    ((lng * Math.PI) / 180) * EARTH * k,
    ((lat * Math.PI) / 180) * EARTH,
  ];
};
const cross = (o, a, b) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSegment = (p, a, b) =>
  Math.min(a[0], b[0]) - 1e-9 <= p[0] &&
  p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
  Math.min(a[1], b[1]) - 1e-9 <= p[1] &&
  p[1] <= Math.max(a[1], b[1]) + 1e-9;
const segmentsIntersect = (a, b, c, d) => {
  const d1 = cross(c, d, a),
    d2 = cross(c, d, b),
    d3 = cross(a, b, c),
    d4 = cross(a, b, d);
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  )
    return true;
  return (
    (d1 === 0 && onSegment(a, c, d)) ||
    (d2 === 0 && onSegment(b, c, d)) ||
    (d3 === 0 && onSegment(c, a, b)) ||
    (d4 === 0 && onSegment(d, a, b))
  );
};
const pointSegment = (p, a, b) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len))
    : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};
const segmentSegment = (a, b, c, d) =>
  segmentsIntersect(a, b, c, d)
    ? 0
    : Math.min(
        pointSegment(a, c, d),
        pointSegment(b, c, d),
        pointSegment(c, a, b),
        pointSegment(d, a, b),
      );
const ringArea = (ring) => {
  let s = 0;
  for (let i = 1; i < ring.length; i++)
    s += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return s / 2;
};
const insideRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
};

const ring = (value, hole) => {
  if (!Array.isArray(value)) invalid("Polígono inválido.");
  const points = dedupe(value.map(position));
  if (points.length < 4 || !same(points[0], points.at(-1)))
    invalid(
      "O contorno do polígono precisa de ao menos três pontos e deve terminar no ponto inicial.",
    );
  if (new Set(points.slice(0, -1).map((p) => p.join(","))).size < 3)
    invalid("O polígono precisa de três pontos distintos.");
  noAntimeridian(points);
  const project = projector(points[0][1]);
  const planar = points.map(project);
  if (Math.abs(ringArea(planar)) < 1e-6)
    invalid(
      hole
        ? "Um recorte do polígono não tem área."
        : "O polígono não tem área.",
    );
  // Non-adjacent edges must not touch (self-intersection).
  const n = planar.length - 1;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(planar[i], planar[i + 1], planar[j], planar[j + 1]))
        invalid("O contorno do polígono não pode se cruzar.");
    }
  return points;
};

/** Validates and normalizes a GeoJSON geometry (Point, LineString, Polygon, MultiLineString). Throws GeometryError. */
export function normalizeGeometry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    invalid("Informe a geometria em GeoJSON.");
  const { type, coordinates } = input;
  if (!GEOMETRY_TYPES.includes(type))
    invalid(
      "Tipo de geometria não suportado. Use ponto, linha, polígono ou várias linhas.",
    );
  let normalized;
  if (type === "Point")
    normalized = { type, coordinates: position(coordinates) };
  else if (type === "LineString")
    normalized = { type, coordinates: line(coordinates) };
  else if (type === "MultiLineString") {
    if (
      !Array.isArray(coordinates) ||
      !coordinates.length ||
      coordinates.length > 50
    )
      invalid("Informe de uma a 50 linhas.");
    normalized = { type, coordinates: coordinates.map(line) };
  } else {
    if (
      !Array.isArray(coordinates) ||
      !coordinates.length ||
      coordinates.length > 20
    )
      invalid("Informe o contorno do polígono (até 19 recortes).");
    normalized = {
      type,
      coordinates: coordinates.map((r, i) => ring(r, i > 0)),
    };
    if (normalized.coordinates.length > 1) {
      const project = projector(normalized.coordinates[0][0][1]);
      const outer = normalized.coordinates[0].map(project);
      for (const hole of normalized.coordinates.slice(1))
        if (!hole.every((p) => insideRing(project(p), outer)))
          invalid("Os recortes devem ficar dentro do contorno do polígono.");
    }
  }
  if (vertexCount(normalized) > MAX_GEOMETRY_VERTICES)
    invalid(`A geometria pode ter no máximo ${MAX_GEOMETRY_VERTICES} pontos.`);
  return normalized;
}

const positions = (g) =>
  g.type === "Point"
    ? [g.coordinates]
    : g.type === "LineString"
      ? g.coordinates
      : g.coordinates.flat();
export const vertexCount = (g) => positions(g).length;

/** [west, south, east, north] */
export function geometryBBox(g) {
  const ps = positions(g);
  return [
    Math.min(...ps.map((p) => p[0])),
    Math.min(...ps.map((p) => p[1])),
    Math.max(...ps.map((p) => p[0])),
    Math.max(...ps.map((p) => p[1])),
  ];
}

// Decomposes a geometry into points, segments and polygons (outer ring + holes), projected.
const parts = (g, project) => {
  const points = [],
    segments = [],
    polygons = [];
  const addLine = (coords) => {
    const ps = coords.map(project);
    for (let i = 1; i < ps.length; i++) segments.push([ps[i - 1], ps[i]]);
    points.push(...ps);
  };
  if (g.type === "Point") points.push(project(g.coordinates));
  else if (g.type === "LineString") addLine(g.coordinates);
  else if (g.type === "MultiLineString") g.coordinates.forEach(addLine);
  else {
    g.coordinates.forEach(addLine);
    polygons.push(g.coordinates.map((r) => r.map(project)));
  }
  return { points, segments, polygons };
};
const insidePolygon = (p, rings) =>
  insideRing(p, rings[0]) && !rings.slice(1).some((h) => insideRing(p, h));

/** Smallest distance in meters between two geometries; 0 when they touch, cross or one contains the other. */
export function geometryDistance(a, b) {
  const [, as, , an] = geometryBBox(a),
    [, bs, , bn] = geometryBBox(b);
  const project = projector((Math.min(as, bs) + Math.max(an, bn)) / 2);
  const A = parts(a, project),
    B = parts(b, project);
  for (const poly of A.polygons)
    if (B.points.some((p) => insidePolygon(p, poly))) return 0;
  for (const poly of B.polygons)
    if (A.points.some((p) => insidePolygon(p, poly))) return 0;
  let best = Infinity;
  for (const s of A.segments) {
    for (const t of B.segments) {
      best = Math.min(best, segmentSegment(s[0], s[1], t[0], t[1]));
      if (best === 0) return 0;
    }
  }
  // Isolated points (Point geometries) against everything on the other side.
  const lonelyA = A.segments.length ? [] : A.points,
    lonelyB = B.segments.length ? [] : B.points;
  for (const p of lonelyA) {
    for (const t of B.segments)
      best = Math.min(best, pointSegment(p, t[0], t[1]));
    for (const q of lonelyB)
      best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  for (const p of lonelyB)
    for (const s of A.segments)
      best = Math.min(best, pointSegment(p, s[0], s[1]));
  return best;
}

/** Facts used as the text alternative to the map: vertex count, length (lines) and area (polygons), centroid. */
export function geometrySummary(g) {
  const [w, s, e, n] = geometryBBox(g);
  const project = projector((s + n) / 2);
  let length = 0,
    area = 0;
  const lines =
    g.type === "LineString"
      ? [g.coordinates]
      : g.type === "MultiLineString"
        ? g.coordinates
        : g.type === "Polygon"
          ? [g.coordinates[0]]
          : [];
  for (const l of lines) {
    const ps = l.map(project);
    for (let i = 1; i < ps.length; i++)
      length += Math.hypot(ps[i][0] - ps[i - 1][0], ps[i][1] - ps[i - 1][1]);
  }
  if (g.type === "Polygon")
    area =
      Math.abs(ringArea(g.coordinates[0].map(project))) -
      g.coordinates
        .slice(1)
        .reduce((sum, h) => sum + Math.abs(ringArea(h.map(project))), 0);
  return {
    type: g.type,
    vertices:
      g.type === "Polygon"
        ? g.coordinates.reduce((sum, r) => sum + r.length - 1, 0)
        : vertexCount(g),
    length_m: g.type === "Point" ? 0 : Math.round(length),
    area_m2: Math.round(area),
    center: [
      Math.round(((w + e) / 2) * PRECISION) / PRECISION,
      Math.round(((s + n) / 2) * PRECISION) / PRECISION,
    ],
  };
}
