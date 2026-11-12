import { logger as defaultLogger } from "../../logger.js";

// Tables that store a stored-file name, and the storage folder that name lives in.
// evidence.filename -> uploads/<filename>; invoices.filename -> invoices/<filename>.
// Any new table that keeps a `filename` for a stored file must be added here, or its files
// would be reported as orphans.
export const FILE_REFERENCES = [
  { table: "evidence", column: "filename", folder: "uploads" },
  { table: "invoices", column: "filename", folder: "invoices" },
];

export const DEFAULT_GRACE_MS = 24 * 3600 * 1000;

export async function referencedKeys(db) {
  const keys = new Set();
  for (const { table, column, folder } of FILE_REFERENCES)
    for (const row of await db.all(`SELECT ${column} AS name FROM ${table}`))
      if (row.name) keys.add(`${folder}/${row.name}`);
  return keys;
}

// Lists (and, unless dryRun, removes) stored files that no database row references and that are
// older than graceMs. The grace period protects uploads in progress: a file is written to storage
// before the transaction that records it commits. The sweep errs on the side of NOT deleting:
//  - storage without list() (object storage adapter) is not supported and nothing is touched;
//  - files newer than graceMs, or with a modification time in the future, are kept;
//  - if the database has no file references at all while storage has candidates, it refuses
//    (likely a wrong DATABASE_URL/DATA_DIR) unless allowEmptyReferences is set.
export async function sweepOrphans({
  db,
  storage,
  graceMs = DEFAULT_GRACE_MS,
  dryRun = false,
  allowEmptyReferences = false,
  nowMs = Date.now(),
  logger = defaultLogger,
} = {}) {
  if (!db || !storage) throw new TypeError("Informe db e storage.");
  if (!Number.isFinite(graceMs) || graceMs < 0)
    throw new RangeError("Período de carência inválido.");
  if (typeof storage.list !== "function")
    return {
      supported: false,
      dryRun,
      scanned: 0,
      referenced: 0,
      kept: 0,
      orphans: [],
      deleted: [],
      failed: [],
    };
  // Files are listed BEFORE reading references: a file that appears afterwards is not in the
  // snapshot, and one whose row commits later is younger than the grace period anyway.
  const files = await storage.list();
  const references = await referencedKeys(db);
  const orphans = [];
  let referenced = 0;
  for (const file of files) {
    if (references.has(file.key)) referenced++;
    else if (nowMs - file.modifiedAt >= graceMs) orphans.push(file);
  }
  const result = {
    supported: true,
    dryRun,
    scanned: files.length,
    referenced,
    kept: files.length - orphans.length,
    orphans,
    deleted: [],
    failed: [],
  };
  if (orphans.length && references.size === 0 && !allowEmptyReferences) {
    result.refused =
      "Nenhuma referência de arquivo encontrada no banco; varredura recusada.";
    logger.warn(
      "Varredura de uploads órfãos recusada: banco sem referências.",
      { candidates: orphans.length },
    );
    return result;
  }
  if (!dryRun)
    for (const file of orphans) {
      try {
        await storage.delete(file.key);
        result.deleted.push(file.key);
      } catch (error) {
        result.failed.push(file.key);
        logger.warn("Falha ao remover upload órfão.", {
          key: file.key,
          err: error,
        });
      }
    }
  logger.info(
    dryRun
      ? "Varredura de uploads órfãos (simulação)."
      : "Varredura de uploads órfãos concluída.",
    {
      scanned: result.scanned,
      orphans: orphans.length,
      deleted: result.deleted.length,
      failed: result.failed.length,
    },
  );
  return result;
}
