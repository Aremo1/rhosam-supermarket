-- Migration: Shared Links & SSL Auto-Provisioning

-- ── Shared Links — shareable short URLs for pages ─────────────
CREATE TABLE IF NOT EXISTS shared_links (
  id SERIAL PRIMARY KEY,
  token VARCHAR(32) UNIQUE NOT NULL,
  branch_id INTEGER REFERENCES branches(id),
  entity_type VARCHAR(30) NOT NULL, -- 'product', 'sale', 'page', 'report'
  entity_id VARCHAR(40),
  page_path VARCHAR(200) NOT NULL,  -- e.g. '/products', '/sales', '/s/shasha/products/123'
  title VARCHAR(200),
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  max_visits INTEGER,               -- NULL = unlimited
  visit_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_links_token ON shared_links(token);
CREATE INDEX IF NOT EXISTS idx_shared_links_branch ON shared_links(branch_id);
CREATE INDEX IF NOT EXISTS idx_shared_links_entity ON shared_links(entity_type, entity_id);

-- ── SSL Certificates — auto-provisioned for custom domains ───
CREATE TABLE IF NOT EXISTS ssl_certificates (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id),
  domain VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, ACTIVE, EXPIRED, FAILED, REVOKED
  cert_pem TEXT,
  key_pem TEXT,
  chain_pem TEXT,
  issuer VARCHAR(100) DEFAULT 'Let''s Encrypt',
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  last_renewal_attempt TIMESTAMPTZ,
  acme_account_id VARCHAR(100),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ssl_certs_domain ON ssl_certificates(domain);
CREATE INDEX IF NOT EXISTS idx_ssl_certs_branch ON ssl_certificates(branch_id);
CREATE INDEX IF NOT EXISTS idx_ssl_certs_status ON ssl_certificates(status);

-- ── ACME Accounts (Let's Encrypt) ────────────────────────────
CREATE TABLE IF NOT EXISTS acme_accounts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(200) NOT NULL,
  account_url VARCHAR(500),
  account_key_pem TEXT NOT NULL,
  directory_url VARCHAR(500) NOT NULL DEFAULT 'https://acme-v02.api.letsencrypt.org/directory',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
