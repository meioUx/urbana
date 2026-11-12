export async function up(db) {
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_inventory_page ON inventory_movements(created_at,id); CREATE INDEX IF NOT EXISTS idx_inventory_order ON inventory_movements(order_id,created_at,id); CREATE INDEX IF NOT EXISTS idx_inventory_invoice ON inventory_movements(invoice_id);",
  );
}
