const tables = new Set(["occurrences", "orders", "action_plans"]);
export function versionConflict(currentVersion) {
  return Object.assign(new Error("Registro alterado por outro usuário."), {
    status: 409,
    code: "VERSION_CONFLICT",
    details: { current_version: currentVersion },
  });
}
export function assertExpectedVersion(current, expected) {
  if (expected === undefined)
    throw Object.assign(
      new Error("Informe a versão lida antes de alterar o registro."),
      { status: 428, code: "VERSION_REQUIRED" },
    );
  if (!Number.isSafeInteger(expected) || expected < 1)
    throw Object.assign(new Error("Versão inválida."), {
      status: 400,
      code: "INVALID_VERSION",
    });
  if (current.version !== expected) throw versionConflict(current.version);
}
export async function updateVersioned(db, table, current, assignments, args) {
  if (!tables.has(table)) throw new TypeError("Entidade sem versionamento.");
  const result = await db.run(
    `UPDATE ${table} SET ${assignments},version=version+1 WHERE id=? AND version=?`,
    [...args, current.id, current.version],
  );
  if (Number(result.rowCount ?? result.changes) !== 1) {
    const latest = await db.get(`SELECT version FROM ${table} WHERE id=?`, [
      current.id,
    ]);
    throw versionConflict(latest?.version ?? null);
  }
}
