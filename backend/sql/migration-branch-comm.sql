-- Migration: Inter-Branch Communication
-- Adds messaging system and stock transfer requests between branches

-- ═══════════════════════════════════════════════════════════════════
-- INTER-BRANCH MESSAGING
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  from_branch_id INTEGER NOT NULL REFERENCES branches(id),
  to_branch_id INTEGER NOT NULL REFERENCES branches(id),
  from_user_id INTEGER NOT NULL REFERENCES users(id),
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_to_branch ON messages(to_branch_id, is_read);
CREATE INDEX IF NOT EXISTS idx_messages_from_branch ON messages(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- INTER-BRANCH STOCK TRANSFERS
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS stock_transfers (
  id SERIAL PRIMARY KEY,
  from_branch_id INTEGER NOT NULL REFERENCES branches(id),
  to_branch_id INTEGER NOT NULL REFERENCES branches(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','COMPLETED','CANCELLED')),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  notes TEXT,
  rejection_reason TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON stock_transfers(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to ON stock_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status);
