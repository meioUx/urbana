export type Position = [number, number];
export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiLineString"; coordinates: Position[][] };
export declare const GEOMETRY_TYPES: readonly string[];
export declare const MAX_GEOMETRY_VERTICES: number;
export declare class GeometryError extends Error {}
export declare function normalizeGeometry(input: unknown): Geometry;
export declare function vertexCount(g: Geometry): number;
export declare function geometryBBox(
  g: Geometry,
): [number, number, number, number];
export declare function geometryDistance(a: Geometry, b: Geometry): number;
export declare function geometrySummary(g: Geometry): {
  type: Geometry["type"];
  vertices: number;
  length_m: number;
  area_m2: number;
  center: Position;
};
