import { onboardingState } from "../onboarding.js";
import { permissions, roles, priorities, unpack } from "../domain.js";

export function registerBootstrap(app, db, { route, kanban }) {
  app.get(
    "/api/bootstrap",
    route(async (req) => {
      const settings = JSON.parse(
        (await db.get("SELECT value FROM settings WHERE id='general'")).value,
      );
      return {
        user: req.user,
        onboarding: await onboardingState(db, req.user),
        catalogs: (await db.all("SELECT * FROM catalogs")).map(unpack),
        settings,
        kanban: await kanban.read(),
        operators: permissions.schedule.includes(req.user.role)
          ? await db.all(
              "SELECT id,name,team_id FROM users WHERE role='Equipe de Campo' ORDER BY name",
            )
          : [],
        roles,
        priorities,
      };
    }),
  );
}
