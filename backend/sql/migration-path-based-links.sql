-- Migration: Path-Based Links & Wildcard Custom-Domain Support
-- Adds slug, custom_domain, and public_url columns to branches table

-- ── Branch slug for path-based links (e.g., /s/airforce-base-shasha/dashboard) ──
ALTER TABLE branches ADD COLUMN IF NOT EXISTS slug VARCHAR(80) UNIQUE;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS custom_domain_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS public_url VARCHAR(500);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS theme_color VARCHAR(20) DEFAULT '#16a34a';

-- Auto-generate slugs for existing branches (lowercase, hyphenated name)
UPDATE branches SET slug = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
  name, ' ', '-'), '.', ''), '/', '-'), '&', 'and'), '''', ''))
  WHERE slug IS NULL;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_branches_slug ON branches(slug);
CREATE INDEX IF NOT EXISTS idx_branches_custom_domain ON branches(custom_domain) WHERE custom_domain IS NOT NULL;

-- Domain configuration table for platform-wide domain settings
CREATE TABLE IF NOT EXISTS domain_settings (
  id SERIAL PRIMARY KEY,
  platform_domain VARCHAR(255) NOT NULL DEFAULT 'rhosam.com',
  wildcard_domain VARCHAR(255) DEFAULT '*.rhosam.com',
  custom_domains_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ssl_auto_provision BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default domain settings if not exists
INSERT INTO domain_settings (platform_domain, wildcard_domain, custom_domains_enabled)
SELECT 'rhosam.com', '*.rhosam.com', TRUE
WHERE NOT EXISTS (SELECT 1 FROM domain_settings);
