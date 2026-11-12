import { randomUUID } from "node:crypto";

// Small structured logger. Production (NODE_ENV=production, or LOG_FORMAT=json) emits one JSON object
// per line; otherwise a readable text line. LOG_LEVEL = debug | info | warn | error | silent (default
// info). createApp() is silent unless a logger is injected (server/index.js injects the real one), so
// tests that call createApp directly do not pollute `npm test`; tests can capture lines with
// createLogger({ write }).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
// Field names that must never reach a log line, whatever the caller passes.
const SENSITIVE =
  /pass(word)?|senha|token|secret|cookie|authorization|api[-_]?key|private/i;
const MAX_DEPTH = 4;

function defaultLevel() {
  const configured = String(process.env.LOG_LEVEL || "").toLowerCase();
  if (configured in LEVELS) return configured;
  return "info";
}
const defaultFormat = () => {
  const configured = String(process.env.LOG_FORMAT || "").toLowerCase();
  if (configured === "json" || configured === "text") return configured;
  return process.env.NODE_ENV === "production" ? "json" : "text";
};

export function serializeError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  const out = { name: error.name, message: error.message };
  if (error.code !== undefined) out.code = error.code;
  if (error.stack) out.stack = error.stack;
  return out;
}

function sanitize(value, depth = 0) {
  if (value instanceof Error) return serializeError(value);
  if (value === null || typeof value !== "object")
    return typeof value === "bigint" ? String(value) : value;
  if (depth >= MAX_DEPTH) return "[truncado]";
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value))
    out[key] = SENSITIVE.test(key) ? "[omitido]" : sanitize(item, depth + 1);
  return out;
}

const textValue = (value) => {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return /^[^\s"=]+$/.test(raw) ? raw : JSON.stringify(raw);
};

export function createLogger({ level, format, write, bindings = {} } = {}) {
  const threshold = LEVELS[level] ?? LEVELS[defaultLevel()];
  const json = (format ?? defaultFormat()) === "json";
  const out =
    write ??
    ((line, name) =>
      (LEVELS[name] >= LEVELS.warn ? process.stderr : process.stdout).write(
        `${line}\n`,
      ));
  const emit = (name, message, fields) => {
    if (LEVELS[name] < threshold) return;
    const data = sanitize({ ...bindings, ...(fields ?? {}) });
    const time = new Date().toISOString();
    if (json)
      return out(
        JSON.stringify({ time, level: name, msg: message, ...data }),
        name,
      );
    const { err, ...rest } = data;
    const pairs = Object.entries(rest)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${textValue(v)}`);
    if (err?.message) pairs.push(`error=${textValue(err.message)}`);
    const stack = err?.stack;
    out(
      `${time} ${name.toUpperCase().padEnd(5)} ${message}${pairs.length ? ` ${pairs.join(" ")}` : ""}${stack ? `\n${stack}` : ""}`,
      name,
    );
  };
  const logger = {
    level: Object.keys(LEVELS).find((k) => LEVELS[k] === threshold),
  };
  for (const name of ["debug", "info", "warn", "error"])
    logger[name] = (message, fields) => emit(name, message, fields);
  logger.child = (extra) =>
    createLogger({
      level: logger.level,
      format: json ? "json" : "text",
      write: out,
      bindings: { ...bindings, ...extra },
    });
  return logger;
}

export const logger = createLogger();
export const silentLogger = createLogger({ level: "silent" });

// Accepts only a conservative inbound id (no spaces/control characters, bounded length) so a client
// cannot inject log lines or oversized headers; anything else gets a fresh UUID.
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
export const validRequestId = (value) =>
  typeof value === "string" && VALID_REQUEST_ID.test(value);

// Assigns req.id (echoed in the X-Request-Id response header) and logs one line per request when it
// finishes: method, route pattern (or path, never the query string), status, duration and user id.
// Never logs bodies, cookies, headers or tokens. /healthz is logged at debug to keep probes quiet.
export function requestLogger(log = logger) {
  return (req, res, next) => {
    const inbound = req.get("x-request-id");
    req.id = validRequestId(inbound) ? inbound : randomUUID();
    res.setHeader("X-Request-Id", req.id);
    const started = process.hrtime.bigint();
    let done = false;
    const finish = (aborted) => {
      if (done) return;
      done = true;
      const status = res.statusCode;
      const level =
        req.path === "/healthz"
          ? "debug"
          : status >= 500
            ? "error"
            : status >= 400
              ? "warn"
              : "info";
      log[level]("request", {
        requestId: req.id,
        method: req.method,
        route: requestRoute(req),
        status,
        durationMs:
          Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100,
        userId: req.user?.id,
        aborted: aborted || undefined,
      });
    };
    res.on("finish", () => finish(false));
    res.on("close", () => finish(!res.writableFinished));
    next();
  };
}

export function requestRoute(req) {
  const pattern = req.route?.path;
  if (typeof pattern === "string") return `${req.baseUrl || ""}${pattern}`;
  // originalUrl keeps the mount prefix (req.path is relative inside app.use("/api", ...)); drop the query.
  return String(req.originalUrl || req.url || "")
    .split("?")[0]
    .slice(0, 200);
}
