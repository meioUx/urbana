import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  MASTER_EMAIL,
  isMasterUser,
  moduleCatalog,
  defaultModules,
  hasModuleAccess,
} from "../../shared/authorization.mjs";
import { userModules, saveModules } from "../user-permissions.js";
import { listRecords } from "../modules/listing/index.js";
import { hashPassword, roles } from "../domain.js";
import { text } from "../http/schemas.js";
import { SYSTEM_ROLE } from "../modules/portal/index.js";

// Administration: users and module access, general settings and the audit trail.
export function registerAdmin(
  app,
  db,
  { route, allow, fail, catalog, entity, audit },
) {
  app.get(
    "/api/users",
    allow("admin"),
    route(() =>
      // System actors (the citizen portal) are not people: hidden from the list and not editable.
      db.all(
        "SELECT id,name,email,role,team_id FROM users WHERE role<>? ORDER BY name",
        [SYSTEM_ROLE],
      ),
    ),
  );
  app.post(
    "/api/users",
    allow("admin"),
    route(async (req) => {
      const data = z
        .object({
          name: text,
          email: z.string().email(),
          password: z.string().min(10).max(200),
          role: z.enum(roles),
          team_id: z.string().nullable().optional(),
          modules: z.array(z.string()).optional(),
        })
        .parse(req.body);
      if (data.role === "Equipe de Campo" && !data.team_id)
        fail(400, "Selecione a equipe do usuário.");
      if (data.team_id) await catalog(data.team_id, "equipes");
      if (
        await db.get("SELECT id FROM users WHERE email=?", [
          data.email.toLowerCase(),
        ])
      )
        fail(409, "E-mail já cadastrado.");
      if (
        data.email.toLowerCase() === MASTER_EMAIL &&
        data.role !== "Administrador"
      )
        fail(400, "A conta master deve manter o perfil Administrador.");
      const identity = { email: data.email, role: data.role };
      const modules = isMasterUser(identity)
        ? moduleCatalog.map((m) => m.key)
        : [...new Set(data.modules ?? defaultModules(data.role))];
      if (modules.some((m) => !hasModuleAccess({ ...identity, modules }, m)))
        fail(400, "Módulo incompatível com o perfil.");
      const id = randomUUID();
      await db.run("INSERT INTO users VALUES(?,?,?,?,?,?)", [
        id,
        data.name,
        data.email.toLowerCase(),
        hashPassword(data.password),
        data.role,
        data.team_id || null,
      ]);
      await saveModules(db, { id, role: data.role }, modules);
      await audit(req, "user", id, "Usuário criado", null, {
        modules,
        name: data.name,
        role: data.role,
      });
      return { id };
    }, true),
  );
  app.get(
    "/api/users/:id/permissions",
    allow("admin"),
    route(async (req) => {
      const user = await entity("users", req.params.id);
      if (user.role === SYSTEM_ROLE) fail(404, "Registro não encontrado.");
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          team_id: user.team_id,
        },
        modules: await userModules(db, user),
        catalog: moduleCatalog,
      };
    }),
  );
  app.patch(
    "/api/users/:id",
    allow("admin"),
    route(async (req) => {
      const old = await entity("users", req.params.id);
      if (old.role === SYSTEM_ROLE) fail(404, "Registro não encontrado.");
      const data = z
        .object({
          name: text,
          email: z.string().email(),
          role: z.enum(roles),
          team_id: z.string().nullable(),
          modules: z.array(z.string()),
        })
        .strict()
        .parse(req.body);
      if (
        data.email.toLowerCase() === MASTER_EMAIL &&
        data.role !== "Administrador"
      )
        fail(400, "A conta master deve manter o perfil Administrador.");
      if (isMasterUser(old)) {
        if (
          data.email.toLowerCase() !== MASTER_EMAIL ||
          data.role !== "Administrador"
        )
          fail(
            403,
            "O e-mail e o perfil da conta master de manutenção não podem ser alterados.",
          );
        data.modules = moduleCatalog.map((m) => m.key);
      }
      if (
        old.id === req.user.id &&
        (data.role !== old.role ||
          JSON.stringify([...data.modules].sort()) !==
            JSON.stringify([...req.user.modules].sort()))
      )
        fail(403, "Não é permitido alterar o próprio perfil ou módulos.");
      if (
        data.modules.some(
          (m) => !hasModuleAccess({ ...data, modules: data.modules }, m),
        )
      )
        fail(400, "Módulo incompatível com o perfil.");
      if (data.role === "Equipe de Campo" && !data.team_id)
        fail(400, "Selecione a equipe do usuário.");
      if (data.team_id) await catalog(data.team_id, "equipes");
      const duplicate = await db.get(
        "SELECT id FROM users WHERE email=? AND id<>?",
        [data.email.toLowerCase(), old.id],
      );
      if (duplicate) fail(409, "E-mail já cadastrado.");
      const previous = await userModules(db, old);
      await db.run(
        "UPDATE users SET name=?,email=?,role=?,team_id=? WHERE id=?",
        [data.name, data.email.toLowerCase(), data.role, data.team_id, old.id],
      );
      await saveModules(db, { id: old.id, role: data.role }, [
        ...new Set(data.modules),
      ]);
      await audit(
        req,
        "user",
        old.id,
        "Acessos do usuário atualizados",
        {
          name: old.name,
          role: old.role,
          team_id: old.team_id,
          modules: previous,
        },
        data,
      );
      return { id: old.id };
    }, true),
  );
  app.patch(
    "/api/users/:id/permissions",
    allow("admin"),
    route(async (req) => {
      fail(
        400,
        "Utilize a edição de usuário com módulos compatíveis. Permissões funcionais não podem ser delegadas.",
      );
    }),
  );
  app.patch(
    "/api/settings",
    allow("admin"),
    route(async (req) => {
      const data = z
        .object({
          duplicate_radius: z.number().min(1).max(500),
          municipality: text,
        })
        .parse(req.body);
      const old = JSON.parse(
        (await db.get("SELECT value FROM settings WHERE id='general'")).value,
      );
      await db.run("UPDATE settings SET value=? WHERE id='general'", [
        JSON.stringify({ ...old, ...data }),
      ]);
      await audit(
        req,
        "settings",
        "general",
        "Configurações atualizadas",
        old,
        data,
      );
    }, true),
  );
  app.get(
    "/api/auditoria",
    allow("admin"),
    route((req) => listRecords(db, "audit_logs", req.query, req.user)),
  );
}
