// Consistent backup of database + stored files, portable (Node only; PostgreSQL also needs pg_dump).
//   npm run backup                              # -> backups/urbana-YYYYMMDD-HHMMSSZ/
//   node scripts/backup.mjs --out=/mnt/backups --keep=14
// Reads DATA_DIR and DATABASE_URL like the server (and .env). Options (or environment):
//   --out=DIR    BACKUP_DIR   destination folder (default ./backups)
//   --keep=N     BACKUP_KEEP  how many backups to keep, oldest removed (default 14; 0 = keep all)
// SQLite: `VACUUM INTO` produces a consistent copy while the app is running (WAL included); the raw
// file is never copied. PostgreSQL: `pg_dump --format=custom` (PG_DUMP_BIN overrides the binary; it
// must be compatible with the server version). The database is captured first and the files after,
// so every row in the dump has its file in the copy (extra newer files are harmless orphans).
// A backup is built in a ".tmp-" folder and renamed only when complete; retention only ever removes
// folders that match the backup name pattern AND contain a manifest.json.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { cp, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const NAME = /^urbana-\d{8}-\d{6}Z$/;

export const backupName = (date = new Date()) =>
  `urbana-${date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-")}Z`;

// Connection settings go through PG* variables, not the command line, so the password never shows
// in the process list.
export function postgresEnv(url, base = process.env) {
  const u = new URL(url);
  const env = { ...base };
  env.PGHOST = u.hostname;
  if (u.port) env.PGPORT = u.port;
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  env.PGDATABASE = decodeURIComponent(u.pathname.replace(/^\//, ""));
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

function run(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "inherit", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) =>
      reject(
        error.code === "ENOENT"
          ? new Error(
              `${command} não encontrado. Instale o cliente PostgreSQL ou defina PG_DUMP_BIN.`,
            )
          : error,
      ),
    );
    child.on("close", (code) =>
      code === 0
        ? resolvePromise()
        : reject(
            new Error(`${command} falhou (código ${code}): ${stderr.trim()}`),
          ),
    );
  });
}

const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

export function backupSqlite(source, target) {
  if (!existsSync(source))
    throw new Error(`Banco SQLite não encontrado em ${source}.`);
  const db = new DatabaseSync(source);
  try {
    db.exec("PRAGMA busy_timeout = 10000");
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  // Verify the copy opens and is structurally sound before it is declared a backup.
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    const check = copy.prepare("PRAGMA quick_check").get();
    if (Object.values(check)[0] !== "ok")
      throw new Error("A cópia do banco falhou na verificação de integridade.");
    const version =
      copy.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()
        ?.v ?? null;
    return { schemaVersion: version };
  } finally {
    copy.close();
  }
}

async function countFiles(folder) {
  let total = 0;
  for (const entry of await readdir(folder, {
    withFileTypes: true,
    recursive: true,
  }))
    if (entry.isFile()) total++;
  return total;
}

export async function createBackup({
  dataDir,
  outDir,
  keep = 14,
  databaseUrl = process.env.DATABASE_URL,
  pgDump = process.env.PG_DUMP_BIN || "pg_dump",
  date = new Date(),
} = {}) {
  dataDir = resolve(dataDir);
  outDir = resolve(outDir);
  const name = backupName(date);
  const finalDir = join(outDir, name);
  const tempDir = join(outDir, `.tmp-${name}`);
  if (existsSync(finalDir) || existsSync(tempDir))
    throw new Error(`Backup ${name} já existe; aguarde um segundo.`);
  mkdirSync(tempDir, { recursive: true });
  try {
    const manifest = {
      name,
      createdAt: date.toISOString(),
      dialect: databaseUrl ? "postgres" : "sqlite",
      files: {},
    };
    if (databaseUrl) {
      const dump = join(tempDir, "urban.dump");
      await run(
        pgDump,
        ["--format=custom", "--no-owner", `--file=${dump}`],
        postgresEnv(databaseUrl),
      );
      manifest.database = { file: "urban.dump", sha256: sha256(dump) };
    } else {
      const file = join(tempDir, "urban.sqlite");
      const info = backupSqlite(join(dataDir, "urban.sqlite"), file);
      manifest.database = {
        file: "urban.sqlite",
        sha256: sha256(file),
        schemaVersion: info.schemaVersion,
      };
    }
    for (const folder of ["uploads", "invoices"]) {
      const source = join(dataDir, folder);
      if (!existsSync(source)) {
        manifest.files[folder] = 0;
        continue;
      }
      await cp(source, join(tempDir, folder), { recursive: true });
      manifest.files[folder] = await countFiles(join(tempDir, folder));
    }
    writeFileSync(
      join(tempDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    renameSync(tempDir, finalDir);
    return {
      dir: finalDir,
      manifest,
      removed: applyRetention(outDir, keep, name),
    };
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

// Removes the oldest complete backups beyond `keep`. Never touches the new one or anything that is
// not a backup folder created by this script.
export function applyRetention(outDir, keep, current) {
  if (!Number.isInteger(keep) || keep <= 0) return [];
  const backups = readdirSync(outDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        NAME.test(e.name) &&
        existsSync(join(outDir, e.name, "manifest.json")),
    )
    .map((e) => e.name)
    .sort();
  const removed = backups
    .slice(0, Math.max(0, backups.length - keep))
    .filter((n) => n !== current);
  for (const name of removed)
    rmSync(join(outDir, name), { recursive: true, force: true });
  return removed;
}

// Command line
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const args = process.argv.slice(2);
  const option = (flagName, env, fallback) =>
    args
      .find((a) => a.startsWith(`${flagName}=`))
      ?.slice(flagName.length + 1) ??
    process.env[env] ??
    fallback;
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Uso: node scripts/backup.mjs [--out=backups] [--keep=14]");
    process.exit(0);
  }
  const keep = Number(option("--keep", "BACKUP_KEEP", 14));
  if (!Number.isInteger(keep) || keep < 0) {
    console.error("--keep deve ser um inteiro maior ou igual a 0.");
    process.exit(2);
  }
  try {
    const { dir, manifest, removed } = await createBackup({
      dataDir: process.env.DATA_DIR || "data",
      outDir: option("--out", "BACKUP_DIR", "backups"),
      keep,
    });
    console.log(`Backup criado: ${dir}`);
    console.log(
      `Banco: ${manifest.dialect} (${manifest.database.file}); uploads: ${manifest.files.uploads}; invoices: ${manifest.files.invoices}`,
    );
    if (removed.length)
      console.log(`Retenção: removidos ${removed.join(", ")}`);
  } catch (error) {
    console.error(`Falha no backup: ${error.message}`);
    process.exit(1);
  }
}
