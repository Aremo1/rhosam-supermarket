-- ═══════════════════════════════════════════════════════════════════
-- Migration: Inventory Audit Cycle (Stock-Taking & Reconciliation)
-- Enables periodic physical stock counts vs system records
-- ═══════════════════════════════════════════════════════════════════

-- AUDIT CYCLE: A stock-taking session
CREATE TABLE IF NOT EXISTS inventory_audits (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','IN_PROGRESS','COMPLETED','CANCELLED')),
  title VARCHAR(200) NOT NULL,
  notes TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by INTEGER NOT NULL REFERENCES users(id),
  completed_by INTEGER REFERENCES users(id),
  total_items INTEGER NOT NULL DEFAULT 0,
  matched_items INTEGER NOT NULL DEFAULT 0,
  discrepancy_items INTEGER NOT NULL DEFAULT 0,
  total_discrepancy_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_audits_branch ON inventory_audits(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_audits_status ON inventory_audits(status);
CREATE INDEX IF NOT EXISTS idx_inventory_audits_created ON inventory_audits(created_at DESC);

-- AUDIT ITEMS: Individual product counts within an audit
CREATE TABLE IF NOT EXISTS inventory_audit_items (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER NOT NULL REFERENCES inventory_audits(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  system_quantity INTEGER NOT NULL DEFAULT 0,
  counted_quantity INTEGER,
  discrepancy INTEGER GENERATED ALWAYS AS (counted_quantity - system_quantity) STORED,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  discrepancy_value NUMERIC(14,2) GENERATED ALWAYS AS (ABS(COALESCE(counted_quantity, system_quantity) - system_quantity) * unit_cost) STORED,
  notes TEXT,
  counted_by INTEGER REFERENCES users(id),
  counted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_items_audit ON inventory_audit_items(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_items_product ON inventory_audit_items(product_id);
