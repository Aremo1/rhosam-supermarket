-- ═══════════════════════════════════════════════════════════════════
-- RHoSAM Supermarket Platform — Complete Database Schema
-- Covers Phases 1-14: Auth, POS, Inventory, Sales, Admin, BI, Procurement, Finance, CRM
-- ═══════════════════════════════════════════════════════════════════

-- ── Phase 7/8: Users & Security ──────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'CASHIER' CHECK(role IN ('ADMIN','MANAGER','CASHIER')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  password_expires_at TIMESTAMPTZ,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Password Reset Tokens ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);

-- ── MFA Backup Codes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mfa_backup_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash VARCHAR(255) NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user ON mfa_backup_codes(user_id);

-- ── Phase 14: Multi-Branch (must be before sales, cash_drawer, etc.) ──
CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  address TEXT,
  phone VARCHAR(30),
  manager_id INTEGER REFERENCES users(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Phase 3: Products & Inventory ────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  barcode VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'General',
  price NUMERIC(12,2) NOT NULL CHECK(price >= 0),
  cost_price NUMERIC(12,2) DEFAULT 0 CHECK(cost_price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 5 CHECK(reorder_level >= 0),
  unit VARCHAR(20) DEFAULT 'PCS',
  description TEXT,
  image_url VARCHAR(500),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  movement_type VARCHAR(30) NOT NULL,
  quantity INTEGER NOT NULL,
  reference VARCHAR(100),
  user_id INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Phase 5: Sales & Returns ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales (
  id BIGSERIAL PRIMARY KEY,
  receipt_number VARCHAR(80) UNIQUE NOT NULL,
  customer_name VARCHAR(120) NOT NULL DEFAULT 'Walk-in Customer',
  customer_id INTEGER,
  payment_method VARCHAR(20) NOT NULL CHECK(payment_method IN ('Cash','Card','Transfer','POS')),
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL CHECK(total >= 0),
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  change_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id),
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name VARCHAR(200) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  discount NUMERIC(12,2) DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS returns (
  id SERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  reason TEXT,
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  processed_by INTEGER NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Phase 12: Customers / CRM ────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(160),
  phone VARCHAR(30),
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  membership_tier VARCHAR(20) DEFAULT 'BRONZE',
  total_spent NUMERIC(14,2) NOT NULL DEFAULT 0,
  visit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Phase 10: Suppliers & Procurement ────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  contact_person VARCHAR(120),
  email VARCHAR(160),
  phone VARCHAR(30),
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number VARCHAR(50) UNIQUE NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id),
  expected_date DATE,
  received_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL,
  received_qty INTEGER DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL
);

-- ── Phase 13: Finance ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  category VARCHAR(80) NOT NULL,
  description TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK(amount > 0),
  payment_method VARCHAR(20) DEFAULT 'Cash',
  reference VARCHAR(100),
  approved_by INTEGER REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_drawer (
  id SERIAL PRIMARY KEY,
  drawer_name VARCHAR(80) NOT NULL DEFAULT 'Main Drawer',
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(12,2),
  expected_balance NUMERIC(12,2),
  variance NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  opened_by INTEGER REFERENCES users(id),
  closed_by INTEGER REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

-- ── Phase 8: Audit Logs ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id VARCHAR(40),
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- ── Indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_receipt ON sales(receipt_number);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created ON expenses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_status ON cash_drawer(status);
CREATE INDEX IF NOT EXISTS idx_branches_name ON branches(name);
CREATE INDEX IF NOT EXISTS idx_payment_verifications_sale ON payment_verifications(sale_id);
CREATE INDEX IF NOT EXISTS idx_payment_verifications_ref ON payment_verifications(reference);
