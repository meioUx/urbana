import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ONBOARDING_VERSION, getTutorial } from "../shared/onboarding.mjs";
export async function onboardingState(db, user) {
  return {
    version: ONBOARDING_VERSION,
    ...((await db.get(
      "SELECT status,started_at,skipped_at,completed_at,step_id FROM user_onboarding WHERE user_id=? AND onboarding_version=? AND tutorial_id=?",
      [user.id, ONBOARDING_VERSION, "main"],
    )) || { status: "not_started" }),
  };
}
export function registerOnboarding(app, db, { route, fail }) {
  app.get(
    "/api/onboarding",
    route(async (req) => ({
      ...(await onboardingState(db, req.user)),
      tutorials: await db.all(
        "SELECT tutorial_id,status,step_id,completed_at FROM user_onboarding WHERE user_id=? AND onboarding_version=?",
        [req.user.id, ONBOARDING_VERSION],
      ),
    })),
  );
  app.patch(
    "/api/onboarding",
    route(async (req) => {
      const data = z
        .object({
          version: z.literal(ONBOARDING_VERSION),
          tutorial_id: z.string().max(100).default("main"),
          event: z.enum([
            "started",
            "progress",
            "skipped",
            "completed",
            "replayed",
          ]),
          step_id: z.string().max(100).nullable().optional(),
        })
        .strict()
        .parse(req.body);
      const tutorial = getTutorial(req.user, data.tutorial_id);
      if (!tutorial?.steps.length)
        fail(
          403,
          "Este tutorial não está disponível para seu perfil e módulos.",
        );
      if (
        data.step_id &&
        !tutorial.steps.some((step) => step.id === data.step_id)
      )
        fail(400, "Etapa inválida para o tutorial atual.");
      const timestamp = new Date().toISOString();
      const old = await db.get(
        "SELECT * FROM user_onboarding WHERE user_id=? AND onboarding_version=? AND tutorial_id=?",
        [req.user.id, ONBOARDING_VERSION, data.tutorial_id],
      );
      const completed =
        old?.completed_at || (data.event === "completed" ? timestamp : null);
      const status = completed
        ? "completed"
        : data.event === "skipped"
          ? "skipped"
          : "started";
      await db.run(
        "INSERT INTO user_onboarding(user_id,onboarding_version,tutorial_id,status,started_at,skipped_at,completed_at,step_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,onboarding_version,tutorial_id) DO UPDATE SET status=excluded.status,started_at=excluded.started_at,skipped_at=excluded.skipped_at,completed_at=excluded.completed_at,step_id=excluded.step_id,updated_at=excluded.updated_at",
        [
          req.user.id,
          ONBOARDING_VERSION,
          data.tutorial_id,
          status,
          old?.started_at || timestamp,
          data.event === "skipped" ? timestamp : old?.skipped_at || null,
          completed,
          data.step_id === undefined ? old?.step_id || null : data.step_id,
          timestamp,
        ],
      );
      if (data.event !== "progress") {
        await db.exec("SAVEPOINT onboarding_telemetry");
        try {
          await db.run("INSERT INTO onboarding_events VALUES(?,?,?,?,?,?)", [
            randomUUID(),
            req.user.id,
            ONBOARDING_VERSION,
            data.tutorial_id,
            "onboarding_" + data.event,
            timestamp,
          ]);
          await db.exec("RELEASE SAVEPOINT onboarding_telemetry");
        } catch {
          await db.exec("ROLLBACK TO SAVEPOINT onboarding_telemetry");
          await db.exec("RELEASE SAVEPOINT onboarding_telemetry");
        }
      }
      return onboardingState(db, req.user);
    }, true),
  );
}
