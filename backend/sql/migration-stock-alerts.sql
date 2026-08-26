-- ═══════════════════════════════════════════════════════════════════
-- Migration: Stock Alerts & Notification Rules
-- Configurable alerts for low stock, expiry, and threshold breaches
-- ═══════════════════════════════════════════════════════════════════

-- ALERT RULES: Configurable thresholds per category or global
CREATE TABLE IF NOT EXISTS alert_rules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  alert_type VARCHAR(30) NOT NULL CHECK(alert_type IN ('LOW_STOCK','EXPIRING_SOON','OUT_OF_STOCK','NEGATIVE_STOCK','OVERSTOCK')),
  category VARCHAR(100),
  threshold_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  threshold_unit VARCHAR(20) NOT NULL DEFAULT 'DAYS',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email BOOLEAN NOT NULL DEFAULT FALSE,
  notify_dashboard BOOLEAN NOT NULL DEFAULT TRUE,
  email_recipients TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_type ON alert_rules(alert_type);
CREATE INDEX IF NOT EXISTS idx_alert_rules_active ON alert_rules(is_active) WHERE is_active = TRUE;

-- ALERTS: Generated alert instances
CREATE TABLE IF NOT EXISTS stock_alerts (
  id SERIAL PRIMARY KEY,
  rule_id INTEGER REFERENCES alert_rules(id) ON DELETE SET NULL,
  alert_type VARCHAR(30) NOT NULL,
  severity VARCHAR(10) NOT NULL DEFAULT 'WARNING' CHECK(severity IN ('INFO','WARNING','CRITICAL')),
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  current_value NUMERIC(10,2),
  threshold_value NUMERIC(10,2),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_by INTEGER REFERENCES users(id),
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_alerts_type ON stock_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_read ON stock_alerts(is_read, is_dismissed);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_branch ON stock_alerts(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_created ON stock_alerts(created_at DESC);

-- Remove duplicate names before inserting defaults
DELETE FROM alert_rules a1 USING alert_rules a2 WHERE a1.name = a2.name AND a1.id > a2.id;

-- Insert default alert rules (safe upsert without dollar-quoted blocks)
INSERT INTO alert_rules (name, alert_type, threshold_value, threshold_unit, notify_dashboard)
SELECT 'Default Low Stock', 'LOW_STOCK', 5, 'UNITS', TRUE
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'Default Low Stock');

INSERT INTO alert_rules (name, alert_type, threshold_value, threshold_unit, notify_dashboard)
SELECT 'Default Expiring Soon', 'EXPIRING_SOON', 30, 'DAYS', TRUE
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'Default Expiring Soon');

INSERT INTO alert_rules (name, alert_type, threshold_value, threshold_unit, notify_dashboard)
SELECT 'Out of Stock Alert', 'OUT_OF_STOCK', 0, 'UNITS', TRUE
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'Out of Stock Alert');
