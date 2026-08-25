-- ═══════════════════════════════════════════════════════════════════
-- Migration: Product Expiry Date Tracking
-- Adds expiry_date and batch_number to products for FIFO tracking
-- ═══════════════════════════════════════════════════════════════════

-- Add expiry_date and batch_number columns to products (nullable for existing products)
ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS batch_number VARCHAR(50);

-- Index for fast expiry lookups
CREATE INDEX IF NOT EXISTS idx_products_expiry ON products(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_batch ON products(batch_number) WHERE batch_number IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- EXPIRY AUDIT LOG: Track when products are marked as expired/disposed
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS expiry_events (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id),
  event_type VARCHAR(30) NOT NULL CHECK(event_type IN ('EXPIRED','DISPOSED','NEAR_EXPIRY_ALERT','PRICE_MARKDOWN')),
  quantity INTEGER NOT NULL DEFAULT 0,
  expiry_date DATE,
  batch_number VARCHAR(50),
  notes TEXT,
  performed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expiry_events_product ON expiry_events(product_id);
CREATE INDEX IF NOT EXISTS idx_expiry_events_branch ON expiry_events(branch_id);
CREATE INDEX IF NOT EXISTS idx_expiry_events_type ON expiry_events(event_type);
