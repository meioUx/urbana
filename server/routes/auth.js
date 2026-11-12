import { randomBytes } from "node:crypto";
import { z } from "zod";
import { checkPassword, now } from "../domain.js";
import { loginLimiter } from "../login-limit.js";
import { tokenHash, sessionAuth } from "../http/auth.js";
import { SYSTEM_ROLE } from "../modules/portal/index.js";

// Public login route (registered before the session middleware).
export function registerLogin(app, db, { route, fail }) {
  const loginAttempts = loginLimiter(db);
  app.post(
    "/api/auth/login",
    route(async (req, res) => {
      const { email, password } = z
        .object({
          email: z.string().email(),
          password: z.string().min(1).max(200),
        })
        .parse(req.body);
      const key = req.ip || "unknown";
      if (await loginAttempts.blocked(key))
        fail(429, "Muitas tentativas. Tente novamente em 15 minutos.");
      const u = await db.get("SELECT * FROM users WHERE email=?", [
        email.toLowerCase(),
      ]);
      if (
        !u ||
        u.role === SYSTEM_ROLE ||
        !checkPassword(password, u.password)
      ) {
        await loginAttempts.failure(key);
        fail(401, "E-mail ou senha incorretos.");
      }
      await loginAttempts.clear(key);
      const token = randomBytes(32).toString("hex");
      await db.run("DELETE FROM sessions WHERE expires_at<?", [now()]);
      await db.run("INSERT INTO sessions VALUES(?,?,?)", [
        tokenHash(token),
        u.id,
        new Date(Date.now() + 8 * 3600000).toISOString(),
      ]);
      res.cookie("urban_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.SECURE_COOKIE === "true",
        maxAge: 8 * 3600000,
        path: "/",
      });
      return {
        user: {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          team_id: u.team_id,
        },
      };
    }),
  );
}

// Session middleware for every other /api route, then /api/auth/me (before the module gate).
export function registerSession(app, db, { route }) {
  app.use("/api", sessionAuth(db));
  app.get(
    "/api/auth/me",
    route((req) => ({ user: req.user })),
  );
}

export function registerLogout(app, db, { route }) {
  app.post(
    "/api/auth/logout",
    route(async (req, res) => {
      await db.run("DELETE FROM sessions WHERE token=?", [req.sessionToken]);
      res.clearCookie("urban_session", { path: "/" });
    }),
  );
}
