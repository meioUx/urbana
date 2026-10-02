import { ONBOARDING_VERSION } from "../shared/onboarding-version.mjs";
// Older browser suites exercise operations, while onboarding-browser covers first access.
export async function skipInitialOnboarding(db) {
  const now = new Date().toISOString();
  for (const user of await db.all("SELECT id FROM users"))
    await db.run(
      "INSERT INTO user_onboarding(user_id,onboarding_version,tutorial_id,status,skipped_at,updated_at) VALUES(?,?,'main','skipped',?,?) ON CONFLICT(user_id,onboarding_version,tutorial_id) DO NOTHING",
      [user.id, ONBOARDING_VERSION, now, now],
    );
}
