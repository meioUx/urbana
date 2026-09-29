import { randomUUID } from "node:crypto";
import { z } from "zod";

const text = z.string().trim().min(1).max(1000);
const signedQuantity = (movement) => movement.type === "entrada" ? movement.quantity : -movement.quantity;

export async function inventoryBalance(db, materialId) {
  const rows = await db.all("SELECT type,quantity,unit_cost FROM inventory_movements WHERE material_id=?", [materialId]);
  const quantity = rows.reduce((sum, row) => sum + signedQuantity(row), 0);
  const incoming = rows.filter((row) => row.type === "entrada");
  const incomingQuantity = incoming.reduce((sum, row) => sum + row.quantity, 0);
  const averageCost = incomingQuantity ? incoming.reduce((sum, row) => sum + row.quantity * row.unit_cost, 0) / incomingQuantity : 0;
  return { quantity, averageCost, controlled: rows.length > 0 };
}

export function registerInventory(app, db, helpers) {
  const { route, allow, audit, fail, now } = helpers;
  app.get("/api/almoxarifado", allow("schedule"), route(async () => {
    const materials = (await db.all("SELECT * FROM catalogs WHERE kind='materiais' ORDER BY id")).map((row) => ({ ...JSON.parse(row.data || "{}"), id: row.id }));
    const movements = await db.all("SELECT m.*,u.name AS user_name,o.code AS order_code FROM inventory_movements m JOIN users u ON u.id=m.user_id LEFT JOIN orders o ON o.id=m.order_id ORDER BY m.created_at DESC");
    const invoices = await db.all("SELECT i.*,o.code AS order_code FROM invoices i JOIN orders o ON o.id=i.order_id ORDER BY i.created_at DESC");
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    const recentConsumption = await db.all("SELECT material_id,SUM(quantity) AS quantity FROM consumption WHERE created_at>=? GROUP BY material_id", [cutoff]);
    return {
      materials: materials.map((material) => {
        const own = movements.filter((movement) => movement.material_id === material.id);
        const stock = own.reduce((sum, movement) => sum + signedQuantity(movement), 0);
        const incoming = own.filter((movement) => movement.type === "entrada");
        const incomingQuantity = incoming.reduce((sum, movement) => sum + movement.quantity, 0);
        const averageCost = incomingQuantity ? incoming.reduce((sum, movement) => sum + movement.quantity * movement.unit_cost, 0) / incomingQuantity : Number(material.unit_cost || 0);
        const consumed90 = Number(recentConsumption.find((row) => row.material_id === material.id)?.quantity || 0);
        const monthlyAverage = consumed90 / 3;
        const minimumStock = Number(material.minimum_stock || 0);
        const target90 = monthlyAverage * 3 + minimumStock;
        const suggestedPurchase = Math.max(0, target90 - stock);
        return { ...material, stock, average_cost: averageCost, stock_value: Math.max(0, stock) * averageCost, consumed_90_days: consumed90, monthly_average: monthlyAverage, minimum_stock: minimumStock, target_90_days: target90, suggested_purchase: suggestedPurchase, status: stock <= 0 ? "sem_estoque" : stock < minimumStock ? "baixo" : suggestedPurchase > 0 ? "repor" : "adequado" };
      }),
      movements: movements.slice(0, 100),
      invoices: invoices.map((invoice) => ({ ...invoice, ...JSON.parse(invoice.data || "{}"), data: undefined })),
    };
  }));

  app.post("/api/almoxarifado/movimentos", allow("schedule"), route(async (req) => {
    const data = z.object({ material_id: text, type: z.enum(["entrada", "saida"]), quantity: z.number().positive().max(1e9), unit_cost: z.number().min(0).max(1e9), notes: text }).parse(req.body);
    const material = await db.get("SELECT id FROM catalogs WHERE id=? AND kind='materiais'", [data.material_id]);
    if (!material) fail(400, "Material não encontrado.");
    const balance = await inventoryBalance(db, data.material_id);
    if (data.type === "saida" && balance.controlled && data.quantity > balance.quantity) fail(409, "Saldo insuficiente para esta saída.");
    const id = randomUUID();
    await db.run("INSERT INTO inventory_movements(id,material_id,order_id,invoice_id,type,quantity,unit_cost,stage,notes,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [id, data.material_id, null, null, data.type, data.quantity, data.unit_cost, "ajuste", data.notes, req.user.id, now()]);
    await audit(req, "inventory", id, data.type === "entrada" ? "Entrada manual no estoque" : "Saída manual do estoque", null, data);
    return { id };
  }, true));
}
