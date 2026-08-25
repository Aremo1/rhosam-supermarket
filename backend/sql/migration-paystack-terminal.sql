-- ═══════════════════════════════════════════════════════════════════
-- Paystack Terminal — Device management & terminal transactions
-- ═══════════════════════════════════════════════════════════════════

-- Registered terminal devices
CREATE TABLE IF NOT EXISTS terminal_devices (
  id SERIAL PRIMARY KEY,
  paystack_id INTEGER,                           -- Paystack terminal ID (nullable for standalone terminals)
  terminal_code VARCHAR(20) UNIQUE NOT NULL,
  serial_number VARCHAR(50),
  name VARCHAR(100) NOT NULL,
  device_make VARCHAR(50),
  address TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  branch_id INTEGER REFERENCES branches(id),
  is_online BOOLEAN DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fix existing tables: make paystack_id nullable and drop unique constraint
ALTER TABLE terminal_devices ALTER COLUMN paystack_id DROP NOT NULL;
ALTER TABLE terminal_devices DROP CONSTRAINT IF EXISTS terminal_devices_paystack_id_key;

-- Terminal payment transactions
CREATE TABLE IF NOT EXISTS terminal_transactions (
  id SERIAL PRIMARY KEY,
  sale_id BIGINT REFERENCES sales(id),
  terminal_id INTEGER REFERENCES terminal_devices(id),
  paystack_transaction_id INTEGER,
  event_id VARCHAR(50),
  reference VARCHAR(100) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  event_delivered BOOLEAN DEFAULT FALSE,
  gateway_response JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_terminal_devices_branch ON terminal_devices(branch_id);
CREATE INDEX IF NOT EXISTS idx_terminal_devices_code ON terminal_devices(terminal_code);
CREATE INDEX IF NOT EXISTS idx_terminal_transactions_sale ON terminal_transactions(sale_id);
CREATE INDEX IF NOT EXISTS idx_terminal_transactions_ref ON terminal_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_terminal_transactions_status ON terminal_transactions(status);
