import { readFileSync } from "node:fs";

// Baseline: schema.sql (all CREATE ... IF NOT EXISTS) plus the PostGIS geometry column.
// Re-applied on every boot, outside a transaction, so tables added to schema.sql reach existing databases.
export const repeatable = true;

export async function up(db) {
  await db.exec(
    readFileSync(new URL("../schema.sql", import.meta.url), "utf8"),
  );
  if (db.dialect === "postgres") {
    await db.exec(
      "CREATE EXTENSION IF NOT EXISTS postgis; ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS geom geometry(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng,lat),4326)) STORED; CREATE INDEX IF NOT EXISTS idx_occurrences_geom ON occurrences USING GIST(geom);",
    );
  }
}
