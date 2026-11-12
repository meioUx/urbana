// Liveness plus database reachability: a trivial query with a short timeout, outside the write
// queue so a long write cannot make the probe fail. The response never carries internal details.
export function registerHealth(app, db, { logger, healthTimeoutMs }) {
  app.get("/healthz", async (req, res) => {
    res.set("Cache-Control", "no-store");
    let timer;
    try {
      await Promise.race([
        db.get("SELECT 1 AS ok"),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Tempo esgotado na consulta de saúde.")),
            healthTimeoutMs,
          );
        }),
      ]);
      res.json({ ok: true });
    } catch (error) {
      logger.error("healthz: banco indisponível", {
        requestId: req.id,
        err: error,
      });
      res.status(503).json({ ok: false });
    } finally {
      clearTimeout(timer);
    }
  });
}
