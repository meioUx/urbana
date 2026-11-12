import { randomUUID } from "node:crypto";
import { z } from "zod";
import { priorities, unpack } from "../domain.js";
import { text } from "../http/schemas.js";

const kinds = [
  "secretarias",
  "departamentos",
  "setores",
  "equipes",
  "categorias",
  "materiais",
  "equipamentos",
];

// Organizational and operational catalogs: GET /api/<kind>, POST /api/<kind>, PATCH /api/<kind>/:id.
export function registerCatalogs(app, db, { route, allow, catalog, audit }) {
  for (const kind of kinds) {
    app.get(
      `/api/${kind}`,
      route(async () =>
        (await db.all("SELECT * FROM catalogs WHERE kind=?", [kind])).map(
          unpack,
        ),
      ),
    );
    for (const method of ["post", "patch"])
      app[method](
        `/api/${kind}${method === "patch" ? "/:id" : ""}`,
        allow("admin"),
        route(async (req) => {
          let schema = z.object({ name: z.string().trim().min(2).max(120) });
          if (kind === "categorias")
            schema = schema.extend({
              subcategories: z.array(z.string().trim().min(1).max(100)).min(1),
              sector_id: text,
              sla: z.object(
                Object.fromEntries(
                  priorities.map((p) => [
                    p,
                    z.number().int().positive().max(8760),
                  ]),
                ),
              ),
              require_before: z.boolean(),
              require_after: z.boolean(),
              require_material: z.boolean(),
            });
          if (kind === "materiais")
            schema = schema.extend({
              unit: z.string().trim().min(1).max(10),
              unit_cost: z.number().min(0),
              minimum_stock: z.number().min(0).default(0),
            });
          if (kind === "equipes")
            schema = schema.extend({
              sector_id: text,
              leader: text,
              members: z.number().int().min(1).max(500),
            });
          if (kind === "equipamentos") schema = schema.extend({ code: text });
          if (["departamentos", "setores"].includes(kind))
            schema = schema.extend({ parent_id: text });
          const data = schema.parse(req.body);
          if (data.sector_id) await catalog(data.sector_id, "setores");
          if (data.parent_id)
            await catalog(
              data.parent_id,
              kind === "setores" ? "departamentos" : "secretarias",
            );
          const id = req.params.id || randomUUID(),
            old = req.params.id ? await catalog(id, kind) : null;
          await db.run(
            "INSERT INTO catalogs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            [id, kind, JSON.stringify(data)],
          );
          await audit(
            req,
            "catalog",
            id,
            `${kind}: cadastro ${old ? "alterado" : "criado"}`,
            old,
            data,
          );
          return { id, kind, ...data };
        }, true),
      );
  }
}
