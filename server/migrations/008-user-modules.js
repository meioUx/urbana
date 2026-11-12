import { initializeModules } from "../user-permissions.js";

// Grants each existing user the default modules of their role.
export async function up(db) {
  await initializeModules(db);
}
