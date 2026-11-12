// Removes stored files (uploads/, invoices/) that no database row references.
//   node scripts/cleanup-orphan-uploads.mjs --dry-run          # only lists
//   node scripts/cleanup-orphan-uploads.mjs --grace-hours=48   # default 24, minimum 1
// Uses DATA_DIR / DATABASE_URL like the server. Only files older than the grace period are touched.
// Supports only the local file storage (the object-storage adapter has no listing).
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../server/db.js";
import { LocalFileStorage } from "../server/modules/files/storage.js";
import { createLogger } from "../server/logger.js";
import { sweepOrphans } from "../server/modules/files/orphans.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) =>
  args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
if (flag("--help") || flag("-h")) {
  console.log(
    "Uso: node scripts/cleanup-orphan-uploads.mjs [--dry-run] [--grace-hours=24] [--allow-empty-db]",
  );
  process.exit(0);
}
const dryRun = flag("--dry-run");
const graceHours = Number(option("--grace-hours") ?? 24);
if (!Number.isFinite(graceHours) || graceHours < 1) {
  console.error("--grace-hours deve ser um número maior ou igual a 1.");
  process.exit(2);
}
const dataDir = resolve(process.env.DATA_DIR || "data");
// openDatabase() would create an empty SQLite file; refuse to run against a path that does not exist.
if (
  !process.env.DATABASE_URL &&
  !existsSync(resolve(dataDir, "urban.sqlite"))
) {
  console.error(`Banco SQLite não encontrado em ${dataDir}. Confira DATA_DIR.`);
  process.exit(2);
}
const db = await openDatabase();
let code = 0;
try {
  const result = await sweepOrphans({
    db,
    storage: new LocalFileStorage(dataDir),
    graceMs: graceHours * 3600 * 1000,
    dryRun,
    allowEmptyReferences: flag("--allow-empty-db"),
    logger: createLogger({ level: "warn" }),
  });
  if (!result.supported) {
    console.error("O storage não oferece listagem; nada foi feito.");
    code = 2;
  } else if (result.refused) {
    console.error(result.refused);
    code = 3;
  } else {
    console.log(
      `${dryRun ? "[simulação] " : ""}Arquivos: ${result.scanned}; referenciados: ${result.referenced}; órfãos acima da carência: ${result.orphans.length}.`,
    );
    for (const file of result.orphans)
      console.log(
        `${dryRun ? "órfão" : result.deleted.includes(file.key) ? "removido" : "falhou"}  ${file.key}  ${file.size} bytes  ${new Date(file.modifiedAt).toISOString()}`,
      );
    if (result.failed.length) code = 1;
  }
} finally {
  await db.close();
}
process.exit(code);
