import { createHash } from "node:crypto";
import {
  canPerformAction,
  hasModuleAccess,
  apiModules,
} from "../../shared/authorization.mjs";
import { userModules } from "../user-permissions.js";
import { now } from "../domain.js";
import { API_NOT_FOUND } from "./errors.js";

export const tokenHash = (s) => createHash("sha256").update(s).digest("hex");

// Mounted on /api after the login route: resolves the session cookie into req.user.
export const sessionAuth = (db) => async (req, res, next) => {
  try {
    const token = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("urban_session="))
      ?.split("=")[1];
    if (!token) return res.status(401).json({ error: "Entre para continuar." });
    const u = await db.get(
      "SELECT u.id,u.name,u.email,u.role,u.team_id FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires_at>?",
      [tokenHash(token), now()],
    );
    if (!u) return res.status(401).json({ error: "Sessão expirada." });
    req.user = { ...u, modules: await userModules(db, u) };
    req.sessionToken = tokenHash(token);
    next();
  } catch (e) {
    next(e);
  }
};

// Mounted on /api after /api/auth/me: module access and the read-only profile.
// route() repeats these checks inside the queue (paths there include the /api prefix).
// A path that apiModules does not attribute to any module (required = []) is denied by default,
// unless it matches no route registered on the app before the JSON 404 (apiNotFound): then it falls
// through to that 404. The check is derived from the router itself (any method, same matcher Express
// uses), so every real route keeps the deny-by-default rule and module-prefixed paths keep 403.
// Routes after the 404 (the production SPA catch-all) are unreachable for /api and are not counted.
// Anonymous requests never get here (sessionAuth answers 401 first).
const matchesRegisteredRoute = (router, path) => {
  for (const layer of router.stack) {
    if (layer.handle?.[API_NOT_FOUND]) return false;
    if (!layer.route) continue;
    try {
      if (layer.match(path)) return true;
    } catch {
      return true; // undecodable parameter: treat as a real route (deny), never as unknown
    }
  }
  return false;
};
export const moduleAccess = () => (req, res, next) => {
  const required = apiModules(req.path, req.method);
  if (
    required?.length === 0 &&
    !matchesRegisteredRoute(req.app.router, req.baseUrl + req.path)
  )
    return next();
  if (required && !required.some((m) => hasModuleAccess(req.user, m)))
    return res.status(403).json({ error: "Módulo não autorizado." });
  if (
    req.user.role === "Consulta" &&
    !["GET", "HEAD"].includes(req.method) &&
    !req.path.startsWith("/auth/") &&
    req.path !== "/onboarding"
  )
    return res.status(403).json({ error: "Perfil somente leitura." });
  next();
};

// Per-route action permission; route() rechecks req.requiredAction against the fresh user.
export const allow = (action) => (req, res, next) => {
  req.requiredAction = action;
  return canPerformAction(req.user, action)
    ? next()
    : res.status(403).json({ error: "Seu perfil não permite esta ação." });
};
