import { listRecords } from "./modules/listing/index.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const text = z.string().trim().min(1).max(1000);
const signedQuantity = (movement) => movement.type === "entrada" ? movement.quantity : -movement.quantity;

export async function inventoryBalance(db, materialId) {
  const totals = await db.get("SELECT COUNT(*) AS count,SUM(CASE WHEN type='entrada' THEN quantity ELSE -quantity END) AS quantity,SUM(CASE WHEN type='entrada' THEN quantity ELSE 0 END) AS incoming_quantity,SUM(CASE WHEN type='entrada' THEN quantity*unit_cost ELSE 0 END) AS incoming_value FROM inventory_movements WHERE material_id=?",[materialId]);
  return {quantity:Number(totals.quantity||0),averageCost:Number(totals.incoming_quantity)>0?Number(totals.incoming_value)/Number(totals.incoming_quantity):0,controlled:Number(totals.count)>0};
}

export function registerInventory(app, db, helpers) {
  const { route, allow, audit, fail, now } = helpers;
  app.get("/api/almoxarifado", allow("schedule"), route(async () => {
    const materials = (await db.all("SELECT * FROM catalogs WHERE kind='materiais' ORDER BY id")).map((row) => ({ ...JSON.parse(row.data || "{}"), id: row.id }));
    const movements = await db.all("SELECT m.*,u.name AS user_name,o.code AS order_code FROM inventory_movements m JOIN users u ON u.id=m.user_id LEFT JOIN orders o ON o.id=m.order_id ORDER BY m.created_at DESC,m.id DESC LIMIT 100");
    const balances = await db.all("SELECT material_id,SUM(CASE WHEN type='entrada' THEN quantity ELSE -quantity END) AS stock,SUM(CASE WHEN type='entrada' THEN quantity ELSE 0 END) AS incoming_quantity,SUM(CASE WHEN type='entrada' THEN quantity*unit_cost ELSE 0 END) AS incoming_value FROM inventory_movements GROUP BY material_id");
    const byMaterial = new Map(balances.map(row=>[row.material_id,row]));
    const invoices = await db.all("SELECT i.*,o.code AS order_code FROM invoices i JOIN orders o ON o.id=i.order_id ORDER BY i.created_at DESC");
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    const recentConsumption = await db.all("SELECT material_id,SUM(quantity) AS quantity FROM consumption WHERE created_at>=? GROUP BY material_id", [cutoff]);
    return {
      materials: materials.map((material) => {
        const balance = byMaterial.get(material.id);
        const stock = Number(balance?.stock||0);
        const incomingQuantity = Number(balance?.incoming_quantity||0);
        const averageCost = incomingQuantity ? Number(balance.incoming_value)/incomingQuantity : Number(material.unit_cost||0);
        const consumed90 = Number(recentConsumption.find((row) => row.material_id === material.id)?.quantity || 0);
        const monthlyAverage = consumed90 / 3;
        const minimumStock = Number(material.minimum_stock || 0);
        const target90 = monthlyAverage * 3 + minimumStock;
        const suggestedPurchase = Math.max(0, target90 - stock);
        return { ...material, stock, average_cost: averageCost, stock_value: Math.max(0, stock) * averageCost, consumed_90_days: consumed90, monthly_average: monthlyAverage, minimum_stock: minimumStock, target_90_days: target90, suggested_purchase: suggestedPurchase, status: stock <= 0 ? "sem_estoque" : stock < minimumStock ? "baixo" : suggestedPurchase > 0 ? "repor" : "adequado" };
      }),
      movements,
      invoices: invoices.map((invoice) => ({ ...invoice, ...JSON.parse(invoice.data || "{}"), data: undefined })),
    };
  }));

  app.get("/api/almoxarifado/movimentos", allow("schedule"), route(req=>listRecords(db,"inventory_movements",req.query,req.user)));

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
