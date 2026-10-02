CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, team_id TEXT);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalogs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS occurrences (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, category_id TEXT NOT NULL REFERENCES catalogs(id), sector_id TEXT NOT NULL REFERENCES catalogs(id), status TEXT NOT NULL, priority TEXT NOT NULL, lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, sector_id TEXT NOT NULL REFERENCES catalogs(id), team_id TEXT NOT NULL REFERENCES catalogs(id), status TEXT NOT NULL, priority TEXT NOT NULL, due_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_occurrences (order_id TEXT NOT NULL REFERENCES orders(id), occurrence_id TEXT NOT NULL REFERENCES occurrences(id), PRIMARY KEY(order_id, occurrence_id));
CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, stage TEXT NOT NULL, filename TEXT NOT NULL, original_name TEXT NOT NULL, mime TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, lat DOUBLE PRECISION, lng DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS consumption (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), material_id TEXT NOT NULL REFERENCES catalogs(id), quantity DOUBLE PRECISION NOT NULL CHECK(quantity > 0), unit_cost DOUBLE PRECISION NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_equipment (order_id TEXT NOT NULL REFERENCES orders(id), equipment_id TEXT NOT NULL REFERENCES catalogs(id), PRIMARY KEY(order_id, equipment_id));
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), event TEXT NOT NULL, before_value TEXT, after_value TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, type_id TEXT REFERENCES catalogs(id), code TEXT UNIQUE NOT NULL, lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS maintenance_plans (id TEXT PRIMARY KEY, asset_id TEXT REFERENCES assets(id), category_id TEXT NOT NULL REFERENCES catalogs(id), interval_days INTEGER NOT NULL, next_run_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_occurrences_status ON occurrences(status);
CREATE INDEX IF NOT EXISTS idx_occurrences_location ON occurrences(lat, lng);
CREATE INDEX IF NOT EXISTS idx_orders_team ON orders(team_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_evidence_entity ON evidence(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS user_module_permissions (user_id TEXT NOT NULL REFERENCES users(id), module TEXT NOT NULL, allowed INTEGER NOT NULL CHECK(allowed IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,module));

CREATE TABLE IF NOT EXISTS user_onboarding (user_id TEXT NOT NULL REFERENCES users(id), onboarding_version INTEGER NOT NULL, tutorial_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('started','skipped','completed')), started_at TEXT, skipped_at TEXT, completed_at TEXT, step_id TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,onboarding_version,tutorial_id));
CREATE TABLE IF NOT EXISTS onboarding_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), onboarding_version INTEGER NOT NULL, tutorial_id TEXT NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_user ON onboarding_events(user_id,created_at);
