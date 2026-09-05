-- ═══════════════════════════════════════════════════════════════════
-- Migration: Final Store Commerce Gaps
-- Layaway/Deposits, Loyalty Points, Customer Groups,
-- Marketing Segmentation, Label Printing, Omnichannel (BOPIS/Endless Aisle)
-- ═══════════════════════════════════════════════════════════════════

-- 1. LAYAWAY / DEPOSITS
CREATE TABLE IF NOT EXISTS layaway_orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(30) UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  branch_id INTEGER REFERENCES branches(id),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, CANCELLED, EXPIRED
  notes TEXT,
  deposit_date TIMESTAMPTZ DEFAULT NOW(),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS layaway_items (
  id SERIAL PRIMARY KEY,
  layaway_order_id INTEGER NOT NULL REFERENCES layaway_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS layaway_payments (
  id SERIAL PRIMARY KEY,
  layaway_order_id INTEGER NOT NULL REFERENCES layaway_orders(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  payment_method VARCHAR(30) DEFAULT 'Cash',
  reference VARCHAR(100),
  notes TEXT,
  received_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. LOYALTY POINTS
CREATE TABLE IF NOT EXISTS loyalty_points (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) UNIQUE,
  points_balance INTEGER NOT NULL DEFAULT 0,
  lifetime_earned INTEGER NOT NULL DEFAULT 0,
  lifetime_redeemed INTEGER NOT NULL DEFAULT 0,
  tier VARCHAR(20) DEFAULT 'BRONZE', -- BRONZE, SILVER, GOLD, PLATINUM
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  type VARCHAR(20) NOT NULL, -- EARN, REDEEM, ADJUST, EXPIRE
  points INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  sale_id INTEGER,
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_rules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  rule_type VARCHAR(30) NOT NULL, -- EARN_PER_Naira, REDEEM_RATE, BONUS_MULTIPLIER, TIER_THRESHOLD
  value NUMERIC(10,2) NOT NULL DEFAULT 1,
  min_spend NUMERIC(12,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CUSTOMER GROUPS
CREATE TABLE IF NOT EXISTS customer_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  color VARCHAR(20) DEFAULT '#16a34a',
  member_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_group_members (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES customer_groups(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, group_id)
);

-- 4. MARKETING SEGMENTATION
CREATE TABLE IF NOT EXISTS marketing_segments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  segment_type VARCHAR(30) NOT NULL DEFAULT 'CUSTOM', -- CUSTOM, AUTOMATIC, BEHAVIORAL
  criteria JSONB DEFAULT '{}', -- { min_spent, max_spent, last_purchase_days, groups, tags }
  customer_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  segment_id INTEGER REFERENCES marketing_segments(id),
  campaign_type VARCHAR(30) NOT NULL DEFAULT 'EMAIL', -- EMAIL, SMS, PUSH, DISCOUNT
  subject VARCHAR(255),
  message TEXT,
  coupon_id INTEGER REFERENCES coupons(id),
  status VARCHAR(20) DEFAULT 'DRAFT', -- DRAFT, SCHEDULED, SENT, COMPLETED, CANCELLED
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  sent_count INTEGER DEFAULT 0,
  open_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, SENT, OPENED, CLICKED, BOUNCED
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. LABEL PRINTING
CREATE TABLE IF NOT EXISTS label_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  width_mm NUMERIC(6,1) NOT NULL DEFAULT 50,
  height_mm NUMERIC(6,1) NOT NULL DEFAULT 30,
  layout JSONB DEFAULT '{}', -- { showBarcode, showPrice, showName, fontSize, showLogo, showCategory }
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. OMNICHANNEL FULFILLMENT (BOPIS / Endless Aisle / Ship-to-Home)
CREATE TABLE IF NOT EXISTS omnichannel_orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(30) UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  order_type VARCHAR(30) NOT NULL, -- BOPIS (Buy Online Pick Up In Store), SHIP_TO_HOME, ENDLESS_AISLE, CURBSIDE
  status VARCHAR(30) DEFAULT 'PENDING', -- PENDING, CONFIRMED, PICKING, READY, SHIPPED, DELIVERED, CANCELLED
  source VARCHAR(30) DEFAULT 'WEB', -- WEB, POS, MOBILE, PHONE
  pickup_branch_id INTEGER REFERENCES branches(id),
  shipping_address TEXT,
  estimated_ready_at TIMESTAMPTZ,
  estimated_delivery_at TIMESTAMPTZ,
  actual_ready_at TIMESTAMPTZ,
  actual_delivered_at TIMESTAMPTZ,
  subtotal NUMERIC(12,2) DEFAULT 0,
  shipping_fee NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS omnichannel_items (
  id SERIAL PRIMARY KEY,
  omnichannel_order_id INTEGER NOT NULL REFERENCES omnichannel_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  source_branch_id INTEGER REFERENCES branches(id),
  status VARCHAR(20) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS endless_aisle_log (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  customer_id INTEGER REFERENCES customers(id),
  requested_branch_id INTEGER REFERENCES branches(id),
  fulfilled_branch_id INTEGER REFERENCES branches(id),
  status VARCHAR(20) DEFAULT 'REQUESTED', -- REQUESTED, FOUND, FULFILLED, CANCELLED
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_layaway_status ON layaway_orders(status);
CREATE INDEX IF NOT EXISTS idx_layaway_customer ON layaway_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_customer ON loyalty_points(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_customer ON loyalty_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_groups_active ON customer_groups(is_active);
CREATE INDEX IF NOT EXISTS idx_customer_group_members_customer ON customer_group_members(customer_id);
CREATE INDEX IF NOT EXISTS idx_marketing_segments_active ON marketing_segments(is_active);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_omnichannel_status ON omnichannel_orders(status);
CREATE INDEX IF NOT EXISTS idx_omnichannel_type ON omnichannel_orders(order_type);
CREATE INDEX IF NOT EXISTS idx_omnichannel_customer ON omnichannel_orders(customer_id);

-- Add group_id and loyalty_points to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES customer_groups(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_points_balance INTEGER DEFAULT 0;
