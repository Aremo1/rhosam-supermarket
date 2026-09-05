-- ═══════════════════════════════════════════════════════════════════
-- Migration: Final Store Commerce Features
-- Time & Attendance, Product Attributes, Linked Items (Upsell),
-- Warranties, Product Compare
-- ═══════════════════════════════════════════════════════════════════

-- 1. TIME & ATTENDANCE
CREATE TABLE IF NOT EXISTS time_clock (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id),
  clock_in TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clock_out TIMESTAMPTZ,
  total_hours NUMERIC(6,2) GENERATED ALWAYS AS (
    CASE WHEN clock_out IS NOT NULL THEN EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 ELSE NULL END
  ) STORED,
  notes TEXT,
  approved_by INTEGER REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, APPROVED, REJECTED
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS break_records (
  id SERIAL PRIMARY KEY,
  time_clock_id INTEGER NOT NULL REFERENCES time_clock(id) ON DELETE CASCADE,
  break_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  break_end TIMESTAMPTZ,
  break_type VARCHAR(20) DEFAULT 'LUNCH', -- LUNCH, SHORT, PERSONAL
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_summary (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_hours NUMERIC(8,2) DEFAULT 0,
  regular_hours NUMERIC(8,2) DEFAULT 0,
  overtime_hours NUMERIC(8,2) DEFAULT 0,
  break_hours NUMERIC(8,2) DEFAULT 0,
  shift_count INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'DRAFT', -- DRAFT, FINALIZED, PAID
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, period_start, period_end)
);

-- 2. PRODUCT ATTRIBUTES (custom fields)
CREATE TABLE IF NOT EXISTS product_attributes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  attribute_type VARCHAR(20) NOT NULL DEFAULT 'TEXT', -- TEXT, NUMBER, BOOLEAN, SELECT, COLOR, DATE
  options JSONB DEFAULT '[]', -- For SELECT type: ["Red", "Blue", "Green"]
  is_required BOOLEAN DEFAULT FALSE,
  is_filterable BOOLEAN DEFAULT FALSE,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_attribute_values (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_id INTEGER NOT NULL REFERENCES product_attributes(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, attribute_id)
);

-- 3. LINKED ITEMS (upsell / cross-sell)
CREATE TABLE IF NOT EXISTS linked_items (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  linked_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  link_type VARCHAR(20) NOT NULL DEFAULT 'UPSELL', -- UPSELL, CROSS_SELL, ACCESSORY, REPLACEMENT
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, linked_product_id)
);

-- 4. WARRANTIES
CREATE TABLE IF NOT EXISTS warranties (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  duration_months INTEGER NOT NULL DEFAULT 12,
  price NUMERIC(12,2) DEFAULT 0,
  coverage_type VARCHAR(30) DEFAULT 'FULL', -- FULL, LIMITED, PARTS_ONLY, LABOR_ONLY
  terms TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_warranties (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warranty_id INTEGER NOT NULL REFERENCES warranties(id) ON DELETE CASCADE,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, warranty_id)
);

CREATE TABLE IF NOT EXISTS warranty_claims (
  id SERIAL PRIMARY KEY,
  claim_number VARCHAR(30) UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  warranty_id INTEGER REFERENCES warranties(id),
  sale_id INTEGER,
  issue_description TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'OPEN', -- OPEN, IN_PROGRESS, APPROVED, REJECTED, COMPLETED
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. PRODUCT COMPARE (saved comparisons)
CREATE TABLE IF NOT EXISTS product_comparisons (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  product_ids INTEGER[] NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_time_clock_user ON time_clock(user_id);
CREATE INDEX IF NOT EXISTS idx_time_clock_branch ON time_clock(branch_id);
CREATE INDEX IF NOT EXISTS idx_time_clock_status ON time_clock(status);
CREATE INDEX IF NOT EXISTS idx_break_records_clock ON break_records(time_clock_id);
CREATE INDEX IF NOT EXISTS idx_product_attr_values_product ON product_attribute_values(product_id);
CREATE INDEX IF NOT EXISTS idx_linked_items_product ON linked_items(product_id);
CREATE INDEX IF NOT EXISTS idx_linked_items_linked ON linked_items(linked_product_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_status ON warranty_claims(status);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_customer ON warranty_claims(customer_id);

-- Add warranty fields to sale_items
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS warranty_id INTEGER REFERENCES warranties(id);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS warranty_price NUMERIC(12,2) DEFAULT 0;
