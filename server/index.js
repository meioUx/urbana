import { deliverNotifications } from "./field.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "./db.js";
import { seed } from "./seed.js";
import { createApp } from "./app.js";
import express from "express";

if (existsSync(".env")) process.loadEnvFile(".env");
const db = await openDatabase();
await seed(db);
const app = createApp(db);
if (process.argv.includes("--production")) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react");
  const vite = await createServer({
    configFile: false,
    plugins: [react()],
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(`Urbana disponível em http://${host}:${port}`),
);
let sendingPush = false;
const pushTimer = setInterval(async () => {
  if (sendingPush) return;
  sendingPush = true;
  try {
    await deliverNotifications(db, app.locals.enqueue);
  } catch (e) {
    console.error("Push:", e.message);
  } finally {
    sendingPush = false;
  }
}, 15000);
pushTimer.unref();
process.on("SIGTERM", () => {
  clearInterval(pushTimer);
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
});
