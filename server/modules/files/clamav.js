import net from "node:net";

// Optional antimalware scanning of uploads through a ClamAV daemon (clamd), speaking its TCP
// protocol directly with node:net (no npm dependency). Disabled unless CLAMAV_HOST is set.
//
// INSTREAM protocol: send "zINSTREAM\0", then the data as chunks of <4-byte big-endian length><bytes>,
// then a zero-length chunk. clamd answers "stream: OK", "stream: <signature> FOUND" or an ERROR line,
// terminated by NUL, and closes the connection.

export const DEFAULT_PORT = 3310;
export const DEFAULT_TIMEOUT_MS = 10000;
// clamd's StreamMaxLength default (25M). Larger streams are refused by the daemon with an error.
export const DEFAULT_MAX_STREAM_BYTES = 25 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 4096;

// Scanner failure (daemon unreachable, timeout, unusable answer). Never means "infected".
export class ScanError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "ScanError";
    this.code = code; // SCANNER_UNAVAILABLE | SCANNER_TIMEOUT | SCANNER_BAD_RESPONSE | SCANNER_TOO_LARGE
  }
}

export function parseClamdReply(raw) {
  const reply = String(raw).replace(/\0+$/, "").trim();
  if (reply === "stream: OK") return { status: "clean" };
  const found = /^stream: (.+) FOUND$/.exec(reply);
  if (found) return { status: "infected", signature: found[1] };
  throw new ScanError(
    "SCANNER_BAD_RESPONSE",
    `Resposta inesperada do clamd: ${reply.slice(0, 120) || "(vazia)"}`,
  );
}

// Scans one buffer. Resolves { status: "clean" } or { status: "infected", signature }; rejects with
// ScanError otherwise. timeoutMs covers connection, upload and reply together.
export function scanWithClamd(
  bytes,
  {
    host,
    port = DEFAULT_PORT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxStreamBytes = DEFAULT_MAX_STREAM_BYTES,
    connect = net.connect,
  } = {},
) {
  if (bytes.length > maxStreamBytes)
    return Promise.reject(
      new ScanError(
        "SCANNER_TOO_LARGE",
        `Arquivo de ${bytes.length} bytes excede o limite de stream do clamd (${maxStreamBytes}).`,
      ),
    );
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const received = [];
    let receivedBytes = 0;
    let settled = false;
    let wake = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      wake?.();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          new ScanError(
            "SCANNER_TIMEOUT",
            `clamd não respondeu em ${timeoutMs} ms.`,
          ),
        ),
      timeoutMs,
    );
    const answer = () => {
      try {
        finish(null, parseClamdReply(Buffer.concat(received).toString("utf8")));
      } catch (error) {
        finish(error);
      }
    };
    socket.setNoDelay(true);
    socket.on("error", (error) =>
      finish(
        new ScanError(
          "SCANNER_UNAVAILABLE",
          `clamd inacessível: ${error.code || error.message}`,
          error,
        ),
      ),
    );
    socket.on("drain", () => wake?.());
    socket.on("data", (data) => {
      received.push(data);
      receivedBytes += data.length;
      if (receivedBytes > MAX_RESPONSE_BYTES)
        return finish(
          new ScanError(
            "SCANNER_BAD_RESPONSE",
            "Resposta do clamd grande demais.",
          ),
        );
      if (data.includes(0)) answer();
    });
    socket.on("end", answer);
    socket.on("close", () => {
      if (!settled) answer();
      wake?.();
    });
    socket.on("connect", async () => {
      try {
        socket.write("zINSTREAM\0");
        for (
          let offset = 0;
          offset < bytes.length && !settled;
          offset += CHUNK_BYTES
        ) {
          const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
          const size = Buffer.allocUnsafe(4);
          size.writeUInt32BE(chunk.length);
          socket.cork();
          socket.write(size);
          const ready = socket.write(chunk);
          socket.uncork();
          // Respect backpressure so a 15 MB upload is not copied again into the socket buffer.
          if (!ready && !settled) await new Promise((next) => (wake = next));
        }
        if (!settled) socket.write(Buffer.alloc(4));
      } catch (error) {
        finish(
          new ScanError(
            "SCANNER_UNAVAILABLE",
            "Falha ao enviar o arquivo ao clamd.",
            error,
          ),
        );
      }
    });
  });
}

// Builds the scanner from the environment. Returns null when CLAMAV_HOST is unset (feature off).
// Invalid values throw at startup instead of silently disabling or weakening the protection.
export function createScannerFromEnv(env = process.env) {
  const host = String(env.CLAMAV_HOST || "").trim();
  if (!host) return null;
  const integer = (name, fallback, minimum, maximum) => {
    const raw = env[name];
    if (raw === undefined || String(raw).trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      throw new Error(
        `${name} inválido: informe um inteiro entre ${minimum} e ${maximum}.`,
      );
    return value;
  };
  const failMode = String(env.CLAMAV_FAIL_MODE || "closed")
    .trim()
    .toLowerCase();
  if (!["closed", "open"].includes(failMode))
    throw new Error('CLAMAV_FAIL_MODE inválido: use "closed" ou "open".');
  return createClamavScanner({
    host,
    port: integer("CLAMAV_PORT", DEFAULT_PORT, 1, 65535),
    timeoutMs: integer("CLAMAV_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 100, 600000),
    maxStreamBytes: integer(
      "CLAMAV_STREAM_MAX_BYTES",
      DEFAULT_MAX_STREAM_BYTES,
      1024,
      2 ** 31 - 1,
    ),
    failMode,
  });
}

export function createClamavScanner({
  host,
  port = DEFAULT_PORT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxStreamBytes = DEFAULT_MAX_STREAM_BYTES,
  failMode = "closed",
} = {}) {
  if (!host) throw new TypeError("Host do clamd não informado.");
  return {
    enabled: true,
    failMode,
    host,
    port,
    scan: (bytes) =>
      scanWithClamd(bytes, { host, port, timeoutMs, maxStreamBytes }),
  };
}
