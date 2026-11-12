import { randomUUID } from "node:crypto";
import { canAccessOrder, unpack, now } from "../domain.js";
import { isProjectedOrderStatus } from "../domain/workflow.js";
import { updateVersioned } from "../modules/concurrency/index.js";
import { fail, failCode } from "./errors.js";

// Evidence time used by photo requirements: when it was captured, falling back to receipt time.
export const evidenceTime = (e) => e.captured_at || e.created_at;

// Record lookups and writes shared by the route modules (all bound to one db).
export function createRecordHelpers(db) {
  const catalog = async (id, kind) => {
    const row = unpack(
      await db.get("SELECT * FROM catalogs WHERE id = ?", [id]),
    );
    if (!row || (kind && row.kind !== kind)) fail(400, "Cadastro inválido.");
    return row;
  };
  const entity = async (table, id) => {
    const row = unpack(
      await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]),
    );
    if (!row) fail(404, "Registro não encontrado.");
    return row;
  };
  const audit = (req, type, id, event, before, after) =>
    db.run("INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?)", [
      randomUUID(),
      type,
      id,
      req.user.id,
      event,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      now(),
    ]);
  const accessOrder = async (req, id) => {
    const o = await entity("orders", id);
    if (!canAccessOrder(req.user, o))
      failCode(
        403,
        "Esta ordem pertence a outra equipe.",
        "ORDER_NOT_ACCESSIBLE",
      );
    return o;
  };
  const clientRequest = (userId, requestId) =>
    db.get("SELECT * FROM client_requests WHERE user_id=? AND request_id=?", [
      userId,
      requestId,
    ]);
  const saveClientRequest = (userId, requestId, type, entityId) =>
    db.run(
      "INSERT INTO client_requests(user_id,request_id,entity_type,entity_id) VALUES(?,?,?,?)",
      [userId, requestId, type, entityId],
    );
  const code = async (table, prefix) => {
    const base = `${prefix}-${new Date().getFullYear()}-`;
    const rows = await db.all(`SELECT code FROM ${table} WHERE code LIKE ?`, [
      `${base}%`,
    ]);
    const maximum = rows.reduce((max, row) => {
      const suffix = row.code.slice(base.length);
      return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
    }, 0);
    return `${base}${String(maximum + 1).padStart(5, "0")}`;
  };
  const history = (type, id) =>
    db.all(
      "SELECT a.*, u.name AS user_name FROM audit_logs a JOIN users u ON a.user_id=u.id WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC",
      [type, id],
    );
  const evidence = (type, id) =>
    db.all(
      "SELECT e.*, u.name AS user_name FROM evidence e JOIN users u ON e.user_id=u.id WHERE entity_type=? AND entity_id=? ORDER BY created_at",
      [type, id],
    );
  const related = (id) =>
    db.all("SELECT occurrence_id FROM order_occurrences WHERE order_id=?", [
      id,
    ]);
  const propagate = async (req, order, status) => {
    if (!isProjectedOrderStatus(status))
      fail(500, "Status de atendimento inválido para propagação.");
    for (const { occurrence_id: id } of await related(order.id)) {
      const old = await entity("occurrences", id);
      const siblings = await db.all(
        "SELECT o.status FROM orders o JOIN order_occurrences r ON r.order_id=o.id WHERE r.occurrence_id=? AND o.id<>?",
        [id, order.id],
      );
      const active = siblings.filter(
        (x) => !["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(x.status),
      );
      const resulting =
        ["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(status) && active.length
          ? active[0].status
          : status;
      await updateVersioned(db, "occurrences", old, "status=?,updated_at=?", [
        resulting,
        now(),
      ]);
      await audit(
        req,
        "occurrence",
        id,
        `Status atualizado pela ${order.code}`,
        { status: old.status },
        { status: resulting },
      );
    }
  };
  return {
    catalog,
    entity,
    audit,
    accessOrder,
    clientRequest,
    saveClientRequest,
    code,
    history,
    evidence,
    related,
    propagate,
  };
}
