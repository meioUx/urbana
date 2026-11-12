// Version 12: works (obras) and interventions (P1). Additive only: new tables and indexes; no
// existing table loses or changes a column, and occurrences/orders keep working without them.
// It does not grant the new "works" module to anyone: existing users keep exactly their persisted
// modules (user_module_permissions); only the master account sees it, as it resolves to the whole
// catalog at runtime. Administrators grant it per user.
//
// Geometry is stored portably as GeoJSON text plus its bounding box (min/max lng/lat), which is
// what SQLite filters on. On PostgreSQL a PostGIS column is generated from that text, with a GiST
// index used by bbox and conflict pre-filters.
const statuses =
  "'PLANEJADA','EM_ANDAMENTO','PARALISADA','CONCLUIDA','CANCELADA'";

export async function up(db) {
  await db.exec(`
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, status TEXT NOT NULL CHECK(status IN (${statuses})), planned_start TEXT NOT NULL, planned_end TEXT NOT NULL, actual_start TEXT, actual_end TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), data TEXT NOT NULL, CHECK(planned_end >= planned_start));
CREATE TABLE IF NOT EXISTS interventions (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, status TEXT NOT NULL CHECK(status IN (${statuses})), priority TEXT NOT NULL, sector_id TEXT REFERENCES catalogs(id), planned_start TEXT NOT NULL, planned_end TEXT NOT NULL, actual_start TEXT, actual_end TEXT, geometry TEXT NOT NULL, geometry_type TEXT NOT NULL CHECK(geometry_type IN ('Point','LineString','Polygon','MultiLineString')), min_lng DOUBLE PRECISION NOT NULL, min_lat DOUBLE PRECISION NOT NULL, max_lng DOUBLE PRECISION NOT NULL, max_lat DOUBLE PRECISION NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), data TEXT NOT NULL, CHECK(planned_end >= planned_start));
CREATE TABLE IF NOT EXISTS project_interventions (intervention_id TEXT PRIMARY KEY REFERENCES interventions(id), project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_orders (order_id TEXT PRIMARY KEY REFERENCES orders(id), project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS intervention_occurrences (intervention_id TEXT NOT NULL REFERENCES interventions(id), occurrence_id TEXT NOT NULL REFERENCES occurrences(id), user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, PRIMARY KEY(intervention_id, occurrence_id));
CREATE TABLE IF NOT EXISTS intervention_orders (intervention_id TEXT NOT NULL REFERENCES interventions(id), order_id TEXT NOT NULL REFERENCES orders(id), user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, PRIMARY KEY(intervention_id, order_id));
CREATE TABLE IF NOT EXISTS intervention_conflict_reviews (intervention_a TEXT NOT NULL REFERENCES interventions(id), intervention_b TEXT NOT NULL REFERENCES interventions(id), note TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, PRIMARY KEY(intervention_a, intervention_b), CHECK(intervention_a < intervention_b));
CREATE INDEX IF NOT EXISTS idx_projects_page ON projects(created_at,id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status,created_at,id);
CREATE INDEX IF NOT EXISTS idx_interventions_page ON interventions(created_at,id);
CREATE INDEX IF NOT EXISTS idx_interventions_status ON interventions(status,created_at,id);
CREATE INDEX IF NOT EXISTS idx_interventions_sector ON interventions(sector_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_interventions_period ON interventions(planned_start,planned_end);
CREATE INDEX IF NOT EXISTS idx_interventions_bbox ON interventions(min_lng,max_lng,min_lat,max_lat);
CREATE INDEX IF NOT EXISTS idx_project_interventions_project ON project_interventions(project_id);
CREATE INDEX IF NOT EXISTS idx_project_orders_project ON project_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_intervention_occurrences_reverse ON intervention_occurrences(occurrence_id,intervention_id);
CREATE INDEX IF NOT EXISTS idx_intervention_orders_reverse ON intervention_orders(order_id,intervention_id);
CREATE INDEX IF NOT EXISTS idx_conflict_reviews_b ON intervention_conflict_reviews(intervention_b);
`);
  if (db.dialect === "postgres")
    await db.exec(
      "ALTER TABLE interventions ADD COLUMN IF NOT EXISTS geom geometry(Geometry,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_GeomFromGeoJSON(geometry),4326)) STORED; CREATE INDEX IF NOT EXISTS idx_interventions_geom ON interventions USING GIST(geom);",
    );
}
