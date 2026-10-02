import { mkdir, readFile, writeFile, unlink, access } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
const validateKey = (key) => {
  if (
    typeof key !== "string" ||
    !/^(uploads|invoices)\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?$/.test(key)
  )
    throw new TypeError("Chave de arquivo inválida.");
  return key;
};
// Every provider implements save/get/delete/exists. Keys preserve existing relative paths.
export class LocalFileStorage {
  constructor(root = process.env.DATA_DIR || "data") {
    this.root = resolve(root);
  }
  path(key) {
    const path = resolve(this.root, validateKey(key));
    if (!path.startsWith(this.root + sep))
      throw new TypeError("Arquivo fora do storage.");
    return path;
  }
  async save(key, bytes) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" });
    return { key, size: bytes.length };
  }
  async get(key) {
    return readFile(this.path(key));
  }
  async delete(key) {
    try {
      await unlink(this.path(key));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  async exists(key) {
    try {
      await access(this.path(key));
      return true;
    } catch (e) {
      if (e.code === "ENOENT") return false;
      throw e;
    }
  }
}
// Adapter for an injected server-side S3/MinIO client; no invented endpoint or credentials.
// Client translates these calls to its SDK. No external service is activated by default.
export class ObjectFileStorage {
  constructor({ client, bucket, prefix = "" }) {
    if (!client || !bucket)
      throw new TypeError("Configure cliente e bucket do storage.");
    this.client = client;
    this.bucket = bucket;
    this.prefix = prefix;
  }
  object(key) {
    return { bucket: this.bucket, key: this.prefix + validateKey(key) };
  }
  async save(key, bytes) {
    await this.client.putObject({ ...this.object(key), body: bytes });
    return { key, size: bytes.length };
  }
  async get(key) {
    return Buffer.from(await this.client.getObject(this.object(key)));
  }
  async delete(key) {
    await this.client.deleteObject(this.object(key));
  }
  async exists(key) {
    return Boolean(await this.client.headObject(this.object(key)));
  }
}
export function createFileStorage() {
  return new LocalFileStorage();
}
