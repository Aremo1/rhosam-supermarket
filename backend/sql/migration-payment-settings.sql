-- ═══════════════════════════════════════════════════════════════════
-- Payment Settings — Admin-configurable gateway configuration
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payment_settings (
  id SERIAL PRIMARY KEY,
  gateway VARCHAR(30) NOT NULL DEFAULT 'INTERNAL',    -- INTERNAL, PAYSTACK, FLUTTERWAVE
  paystack_secret_key VARCHAR(255),
  paystack_public_key VARCHAR(255),
  flutterwave_secret_key VARCHAR(255),
  flutterwave_public_key VARCHAR(255),
  webhook_secret VARCHAR(255),
  test_mode BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert a default row if none exists
INSERT INTO payment_settings (gateway, test_mode)
SELECT 'INTERNAL', TRUE
WHERE NOT EXISTS (SELECT 1 FROM payment_settings);
