-- ═══════════════════════════════════════════════════════════════════
-- Migration: Password Expiry + Forgot Password + MFA
-- Run: psql -d rhosam_db -f sql/migration-auth-features.sql
-- ═══════════════════════════════════════════════════════════════════

-- ── Password Expiry ─────────────────────────────────────────────
-- Add password_expiry to track when password must change
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_expires_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ── Forgot Password Tokens ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- ── MFA (Multi-Factor Authentication) ───────────────────────────
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ── MFA Backup Codes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mfa_backup_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash VARCHAR(255) NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user ON mfa_backup_codes(user_id);

-- ── Set default password expiry (90 days from now for existing users) ──
UPDATE users SET password_expires_at = NOW() + INTERVAL '90 days'
WHERE password_expires_at IS NULL;
