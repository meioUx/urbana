// HTTP hardening shared by server/app.js and server/index.js: security headers (CSP, framing,
// permissions, HSTS), same-origin enforcement for state-changing requests and the refusal to
// expose demonstration credentials on a public production server.
import { scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

export const DEMO_PASSWORD = "Urbana@2026";
export const OSM_TILE_ORIGIN = "https://tile.openstreetmap.org";

// Origin allowed in img-src for map tiles. VITE_MAP_TILE_URL is applied by Vite at build time, so the
// server must see the same value at runtime (compose.yaml passes it to both). Empty = OpenStreetMap.
// "{s}" subdomain templates become a wildcard; relative URLs (e.g. the offline test grid) are 'self'.
export function tileImageSource(tileUrl = "") {
  const url = tileUrl.trim();
  if (!url) return OSM_TILE_ORIGIN;
  if (url.startsWith("/") && !url.startsWith("//")) return null;
  const match = url.match(/^(https?:)?\/\/([^/?#]+)/i);
  if (!match) return null;
  const scheme = (match[1] || "https:").toLowerCase();
  const host = match[2]
    .toLowerCase()
    .replace(/\{[^}]+\}/g, "*")
    .replace(/^(\*\.)?(?:[^.]*\*[^.]*\.)+/, "*.");
  return `${scheme}//${host}`;
}

// Strict policy for the built app (dist/). `dev` relaxes only what Vite's dev middleware needs:
// the inline React Refresh preamble, CSS injected as <style> elements and the HMR WebSocket.
export function contentSecurityPolicy({ dev = false, env = process.env } = {}) {
  const tiles = tileImageSource(env.VITE_MAP_TILE_URL);
  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'", ...(dev ? ["'unsafe-inline'"] : [])],
    "style-src": [
      "'self'",
      "https://fonts.googleapis.com",
      ...(dev ? ["'unsafe-inline'"] : []),
    ],
    "font-src": ["'self'", "https://fonts.gstatic.com"],
    "img-src": ["'self'", "data:", "blob:", ...(tiles ? [tiles] : [])],
    "media-src": ["'self'", "blob:"],
    "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  );
  if (env.SECURE_COOKIE === "true") policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

// Geolocation and camera are used by the field app (same origin only); everything else is off.
export const PERMISSIONS_POLICY =
  "geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=()";

export function securityHeaders({
  csp = contentSecurityPolicy(),
  env = process.env,
} = {}) {
  const hsts = env.SECURE_COOKIE === "true";
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    if (csp) res.setHeader("Content-Security-Policy", csp);
    // One year, without includeSubDomains: other hosts of the municipal domain may still lack HTTPS.
    if (hsts) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    next();
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const originHost = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.host : null;
  } catch {
    return null;
  }
};

// Non-browser clients (the urbana-campo mobile app) identify themselves with this header.
export const NATIVE_CLIENT_HEADER = "x-urbana-client";
const NATIVE_CLIENT_VALUE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

// State-changing requests must prove they come from this origin. Browsers always send Origin on
// fetch/form POST, PUT, PATCH and DELETE; Sec-Fetch-Site is accepted as the only proof when Origin is
// absent and rejects cross-site requests even when Origin looks right. Behind Caddy the Host header
// is preserved, so comparing Origin's host[:port] with Host keeps working without trusting X-Forwarded-*.
// Native clients send neither header: they are accepted only with X-Urbana-Client, and only when
// Origin and Sec-Fetch-Site are both absent (with either present, the rules above still apply).
// This keeps CSRF protection: a browser cannot add a custom header to a cross-site request without
// a CORS preflight, and this server never enables CORS.
export function sameOriginMutations() {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    const deny = (error, code) => res.status(403).json({ error, code });
    if (site && site !== "same-origin")
      return deny("Origem não autorizada.", "ORIGIN_FORBIDDEN");
    if (origin !== undefined) {
      const host = originHost(origin);
      if (!host || !req.headers.host || host !== req.headers.host.toLowerCase())
        return deny("Origem não autorizada.", "ORIGIN_FORBIDDEN");
      return next();
    }
    if (site === "same-origin") return next();
    if (
      site === undefined &&
      NATIVE_CLIENT_VALUE.test(req.headers[NATIVE_CLIENT_HEADER] ?? "")
    )
      return next();
    return deny("Origem da requisição ausente.", "ORIGIN_REQUIRED");
  };
}

const LOOPBACK =
  /^(localhost|127(?:\.\d{1,3}){3}|::1|\[::1\]|::ffff:127(?:\.\d{1,3}){3})$/i;
export const isLoopbackHost = (host) =>
  LOOPBACK.test(String(host ?? "").trim());

// A production server reachable beyond this computer (non-loopback HOST) or served over HTTPS
// (SECURE_COOKIE=true) must not run with demonstration data or the public demonstration password.
export function isPublicProduction({
  argv = process.argv,
  env = process.env,
} = {}) {
  if (!argv.includes("--production")) return false;
  return (
    !isLoopbackHost(env.HOST || "127.0.0.1") || env.SECURE_COOKIE === "true"
  );
}

const scryptAsync = promisify(scrypt);
async function acceptsPassword(hash, password) {
  const [salt, key] = String(hash).split(":");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "hex");
  const actual = await scryptAsync(password, salt, expected.length || 64);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

const HOW_TO_FIX =
  "Para publicar, defina DEMO_DATA=false e ADMIN_PASSWORD com uma senha exclusiva (mínimo 10 caracteres) " +
  "num banco novo, e troque a senha das contas existentes. Para a demonstração local, use HOST=127.0.0.1 sem SECURE_COOKIE=true.";

// Environment checks that do not need the database (run before seeding, so a refused start does not
// create demonstration accounts). Returns the list of problems; empty means safe.
export function demoEnvironmentProblems(env = process.env) {
  const problems = [];
  if (env.DEMO_DATA !== "false")
    problems.push(
      "DEMO_DATA não está definido como false (contas e ocorrências demonstrativas).",
    );
  if (env.ADMIN_PASSWORD === DEMO_PASSWORD)
    problems.push("ADMIN_PASSWORD usa a senha pública de demonstração.");
  return problems;
}

export async function demoAccountProblems(db) {
  const users = await db.all(
    "SELECT email, password FROM users ORDER BY email",
  );
  const flags = await Promise.all(
    users.map((u) => acceptsPassword(u.password, DEMO_PASSWORD)),
  );
  const exposed = users.filter((_, i) => flags[i]).map((u) => u.email);
  return exposed.length
    ? [
        `Contas que ainda aceitam a senha pública de demonstração: ${exposed.join(", ")}.`,
      ]
    : [];
}

// compose.local.yaml (local PostgreSQL homologation, HOST=0.0.0.0, demo data) opts out explicitly.
// The opt-out never applies to an HTTPS deployment (SECURE_COOKIE=true).
export function allowsInsecureDemo(env = process.env) {
  return (
    env.URBANA_ALLOW_INSECURE_DEMO === "true" && env.SECURE_COOKIE !== "true"
  );
}

export function productionSafetyError(problems) {
  return new Error(
    `Recusando iniciar em produção pública com credenciais de demonstração:\n- ${problems.join("\n- ")}\n${HOW_TO_FIX}`,
  );
}
