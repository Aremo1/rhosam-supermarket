-- ═══════════════════════════════════════════════════════════════════
-- Migration: Valuation Snapshots for Trend Tracking
-- Captures periodic snapshots of stock valuation over time
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS valuation_snapshots (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id),
  total_products INTEGER NOT NULL DEFAULT 0,
  total_units INTEGER NOT NULL DEFAULT 0,
  total_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  category_breakdown JSONB NOT NULL DEFAULT '{}',
  captured_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_valuation_snapshots_branch ON valuation_snapshots(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_valuation_snapshots_created ON valuation_snapshots(created_at DESC);
