import { unpack, now } from "./domain.js";

export async function synchronize(db) {
  const base = process.env.ARCGIS_LAYER_URL,
    token = process.env.ARCGIS_TOKEN;
  if (!base) return;
  const endpoint = new URL(base);
  if (endpoint.protocol !== "https:") throw new Error("ArcGIS exige HTTPS.");
  const pending = await db.all(
    "SELECT * FROM gis_sync WHERE status<>'synced' ORDER BY updated_at LIMIT 20",
  );
  const post = async (path, params) => {
    const response = await fetch(`${base.replace(/\/$/, "")}/${path}`, {
      method: "POST",
      body: new URLSearchParams({
        f: "json",
        ...(token ? { token } : {}),
        ...params,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`ArcGIS HTTP ${response.status}`);
    const result = await response.json();
    if (result.error)
      throw new Error(`ArcGIS: ${result.error.code || "erro no serviço"}`);
    return result;
  };
  for (const job of pending) {
    try {
      const o = unpack(
        await db.get("SELECT * FROM occurrences WHERE id=?", [
          job.occurrence_id,
        ]),
      );
      // Query the stable municipal ID before adding, so retries do not duplicate features.
      const query = await post("query", {
        where: `occurrence_id = '${o.id.replace(/'/g, "''")}'`,
        outFields: "OBJECTID",
        returnGeometry: "false",
      });
      const objectId = query.features?.[0]?.attributes?.OBJECTID;
      const feature = {
        geometry: { x: o.lng, y: o.lat, spatialReference: { wkid: 4326 } },
        attributes: {
          ...(objectId !== undefined ? { OBJECTID: objectId } : {}),
          occurrence_id: o.id,
          code: o.code,
          category_id: o.category_id,
          status: o.status,
          priority: o.priority,
          neighborhood: o.neighborhood,
          sector_id: o.sector_id,
          updated_at: Date.parse(o.updated_at),
        },
      };
      const mode = objectId === undefined ? "adds" : "updates",
        result = await post("applyEdits", {
          [mode]: JSON.stringify([feature]),
          rollbackOnFailure: "true",
        });
      if (
        !(result[objectId === undefined ? "addResults" : "updateResults"] ||
          [])[0]?.success
      )
        throw new Error(
          "ArcGIS rejeitou a edição; confira campos e permissões.",
        );
      await db.run(
        "UPDATE gis_sync SET status='synced',attempts=attempts+1,error=NULL,updated_at=? WHERE occurrence_id=?",
        [now(), o.id],
      );
    } catch (e) {
      await db.run(
        "UPDATE gis_sync SET status='error',attempts=attempts+1,error=?,updated_at=? WHERE occurrence_id=?",
        [e.message, now(), job.occurrence_id],
      );
    }
  }
}
