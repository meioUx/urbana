export async function up(db) {
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_occurrences_page ON occurrences(created_at,id);
        CREATE INDEX IF NOT EXISTS idx_occurrences_sector_status ON occurrences(sector_id,status,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_occurrences_priority ON occurrences(priority,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_occurrences_category ON occurrences(category_id,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_orders_page ON orders(created_at,id);
        CREATE INDEX IF NOT EXISTS idx_orders_sector_status ON orders(sector_id,status,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_orders_priority ON orders(priority,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_orders_due ON orders(due_at,status);
        CREATE INDEX IF NOT EXISTS idx_order_occurrence_reverse ON order_occurrences(occurrence_id,order_id);
        CREATE INDEX IF NOT EXISTS idx_audit_page ON audit_logs(created_at,id);
        CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event,created_at,id);
        CREATE INDEX IF NOT EXISTS idx_consumption_order ON consumption(order_id);
        CREATE INDEX IF NOT EXISTS idx_consumption_material ON consumption(material_id,created_at);`);
}
