-- ═══════════════════════════════════════════════════════════════════
-- Migration: Payment Gateway Verification + Audit Device Identity
-- Run: psql -d rhosam_db -f sql/migration-payment-and-audit.sql
-- ═══════════════════════════════════════════════════════════════════

-- ── Payment Gateway Verification ────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_verifications (
  id SERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id),
  gateway VARCHAR(30) NOT NULL DEFAULT 'INTERNAL',
  reference VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  amount NUMERIC(14,2) NOT NULL,
  card_last4 VARCHAR(4),
  auth_code VARCHAR(50),
  gateway_response JSONB DEFAULT '{}',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_verifications_sale ON payment_verifications(sale_id);
CREATE INDEX IF NOT EXISTS idx_payment_verifications_ref ON payment_verifications(reference);

-- ── Device Identity in Audit Logs ───────────────────────────────
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
