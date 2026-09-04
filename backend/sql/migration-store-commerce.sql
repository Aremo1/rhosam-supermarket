-- ═══════════════════════════════════════════════════════════════════
-- Store Commerce Feature Migration
-- Adds: Gift Cards, Coupons, Shifts, Tasks, Commissions, 
--        Product Bundles, Quotations, Customer Notes, Price Checks
-- ═══════════════════════════════════════════════════════════════════

-- 1. GIFT CARDS
CREATE TABLE IF NOT EXISTS gift_cards (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    initial_balance DECIMAL(12,2) NOT NULL,
    current_balance DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','redeemed','expired','cancelled')),
    purchased_by_customer_id INTEGER REFERENCES customers(id),
    issued_by_user_id INTEGER REFERENCES users(id),
    branch_id INTEGER REFERENCES branches(id),
    purchase_sale_id INTEGER REFERENCES sales(id),
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
    id SERIAL PRIMARY KEY,
    gift_card_id INTEGER NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('purchase','redemption','refund','adjustment')),
    amount DECIMAL(12,2) NOT NULL,
    balance_after DECIMAL(12,2) NOT NULL,
    sale_id INTEGER REFERENCES sales(id),
    user_id INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. COUPONS
CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage','fixed')),
    discount_value DECIMAL(12,2) NOT NULL,
    min_purchase DECIMAL(12,2) DEFAULT 0,
    max_uses INTEGER,
    used_count INTEGER DEFAULT 0,
    applicable_products TEXT, -- comma-separated product IDs, NULL = all
    applicable_categories TEXT, -- comma-separated categories, NULL = all
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    branch_id INTEGER REFERENCES branches(id),
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupon_usage (
    id SERIAL PRIMARY KEY,
    coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    customer_id INTEGER REFERENCES customers(id),
    discount_amount DECIMAL(12,2) NOT NULL,
    used_at TIMESTAMP DEFAULT NOW()
);

-- 3. SHIFTS (Advanced Cash/Shift Management)
CREATE TABLE IF NOT EXISTS shifts (
    id SERIAL PRIMARY KEY,
    shift_number VARCHAR(30) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    cash_drawer_id INTEGER REFERENCES cash_drawer(id),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','closed')),
    opened_at TIMESTAMP DEFAULT NOW(),
    closed_at TIMESTAMP,
    opening_amount DECIMAL(12,2) DEFAULT 0,
    closing_amount DECIMAL(12,2),
    expected_amount DECIMAL(12,2),
    actual_amount DECIMAL(12,2),
    variance DECIMAL(12,2),
    total_sales DECIMAL(12,2) DEFAULT 0,
    total_returns DECIMAL(12,2) DEFAULT 0,
    total_gift_card_redemptions DECIMAL(12,2) DEFAULT 0,
    total_coupons_discount DECIMAL(12,2) DEFAULT 0,
    cash_sales DECIMAL(12,2) DEFAULT 0,
    card_sales DECIMAL(12,2) DEFAULT 0,
    transfer_sales DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. TASKS (Employee Task Management)
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled')),
    assigned_to INTEGER REFERENCES users(id),
    assigned_by INTEGER REFERENCES users(id),
    branch_id INTEGER REFERENCES branches(id),
    due_date TIMESTAMP,
    completed_at TIMESTAMP,
    category VARCHAR(50),
    related_entity_type VARCHAR(50), -- 'product', 'order', 'inventory', etc.
    related_entity_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_comments (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    comment TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. SALES COMMISSIONS
CREATE TABLE IF NOT EXISTS sales_commissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    sale_amount DECIMAL(12,2) NOT NULL,
    commission_rate DECIMAL(5,2) NOT NULL, -- percentage
    commission_amount DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','cancelled')),
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    paid_at TIMESTAMP,
    period_start DATE,
    period_end DATE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Commission rate rules per user/role
CREATE TABLE IF NOT EXISTS commission_rules (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id), -- NULL = applies to role
    role VARCHAR(20), -- 'CASHIER', 'MANAGER', etc.
    commission_rate DECIMAL(5,2) NOT NULL,
    min_sale_amount DECIMAL(12,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    branch_id INTEGER REFERENCES branches(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 6. PRODUCT BUNDLES / KITS
CREATE TABLE IF NOT EXISTS product_bundles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    bundle_price DECIMAL(12,2), -- NULL = sum of items
    discount_percent DECIMAL(5,2) DEFAULT 0,
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    category VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_bundle_items (
    id SERIAL PRIMARY KEY,
    bundle_id INTEGER NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(12,2) NOT NULL, -- price at time of adding
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(bundle_id, product_id)
);

-- 7. QUOTATIONS
CREATE TABLE IF NOT EXISTS quotations (
    id SERIAL PRIMARY KEY,
    quote_number VARCHAR(30) UNIQUE NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    customer_name VARCHAR(200),
    customer_email VARCHAR(200),
    customer_phone VARCHAR(50),
    user_id INTEGER NOT NULL REFERENCES users(id),
    branch_id INTEGER REFERENCES branches(id),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired','converted')),
    subtotal DECIMAL(12,2) NOT NULL,
    discount DECIMAL(12,2) DEFAULT 0,
    tax DECIMAL(12,2) DEFAULT 0,
    total DECIMAL(12,2) NOT NULL,
    notes TEXT,
    valid_until DATE,
    converted_sale_id INTEGER REFERENCES sales(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotation_items (
    id SERIAL PRIMARY KEY,
    quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name VARCHAR(200) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(12,2) NOT NULL,
    discount DECIMAL(12,2) DEFAULT 0,
    total DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 8. CUSTOMER NOTES / CLIENTELING
CREATE TABLE IF NOT EXISTS customer_notes (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    note_type VARCHAR(30) DEFAULT 'general' CHECK (note_type IN ('general','preference','complaint','follow_up','purchase_interest','vip')),
    title VARCHAR(200),
    content TEXT NOT NULL,
    is_pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_activities (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    activity_type VARCHAR(30) NOT NULL CHECK (activity_type IN ('purchase','return','note','call','email','visit','complaint','loyalty','coupon_redeemed')),
    description TEXT,
    reference_id INTEGER, -- sale_id, note_id, etc.
    reference_type VARCHAR(30),
    user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 9. PRICE CHECK LOG (audit trail)
CREATE TABLE IF NOT EXISTS price_checks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    product_id INTEGER REFERENCES products(id),
    checked_price DECIMAL(12,2),
    overridden_price DECIMAL(12,2),
    override_reason TEXT,
    branch_id INTEGER REFERENCES branches(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status);
CREATE INDEX IF NOT EXISTS idx_gift_card_transactions_gc ON gift_card_transactions(gift_card_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_coupon ON coupon_usage(coupon_id);
CREATE INDEX IF NOT EXISTS idx_shifts_user ON shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_shifts_branch ON shifts(branch_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_branch ON tasks(branch_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_commissions_user ON sales_commissions(user_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON sales_commissions(status);
CREATE INDEX IF NOT EXISTS idx_commission_rules_user ON commission_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_bundles_active ON product_bundles(is_active);
CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quote ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_activities_customer ON customer_activities(customer_id);
CREATE INDEX IF NOT EXISTS idx_price_checks_user ON price_checks(user_id);

-- ═══════════════════════════════════════════════════════════════════
-- DEFAULT COMMISSION RULES
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO commission_rules (role, commission_rate, is_active) VALUES
('CASHIER', 1.0, true),
('MANAGER', 1.5, true),
('ADMIN', 2.0, true)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- ALTER SALES TABLE to support gift card & coupon payments
-- ═══════════════════════════════════════════════════════════════════
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='gift_card_id') THEN
        ALTER TABLE sales ADD COLUMN gift_card_id INTEGER REFERENCES gift_cards(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='coupon_id') THEN
        ALTER TABLE sales ADD COLUMN coupon_id INTEGER REFERENCES coupons(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='coupon_discount') THEN
        ALTER TABLE sales ADD COLUMN coupon_discount DECIMAL(12,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='gift_card_amount') THEN
        ALTER TABLE sales ADD COLUMN gift_card_amount DECIMAL(12,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='commission_user_id') THEN
        ALTER TABLE sales ADD COLUMN commission_user_id INTEGER REFERENCES users(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sale_items' AND column_name='bundle_id') THEN
        ALTER TABLE sale_items ADD COLUMN bundle_id INTEGER REFERENCES product_bundles(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sale_items' AND column_name='price_overridden') THEN
        ALTER TABLE sale_items ADD COLUMN price_overridden BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- HELPER: Generate unique codes
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION generate_gift_card_code() RETURNS VARCHAR(50) AS $$
DECLARE
    code VARCHAR(50);
BEGIN
    LOOP
        code := 'GC' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 12));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM gift_cards WHERE code = code);
    END LOOP;
    RETURN code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_quote_number() RETURNS VARCHAR(30) AS $$
DECLARE
    num VARCHAR(30);
    seq INTEGER;
BEGIN
    SELECT COALESCE(MAX(id), 0) + 1 INTO seq FROM quotations;
    num := 'QT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(seq::TEXT, 5, '0');
    RETURN num;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_shift_number() RETURNS VARCHAR(30) AS $$
DECLARE
    num VARCHAR(30);
    seq INTEGER;
BEGIN
    SELECT COALESCE(MAX(id), 0) + 1 INTO seq FROM shifts;
    num := 'SH-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(seq::TEXT, 5, '0');
    RETURN num;
END;
$$ LANGUAGE plpgsql;

SELECT '✅ Store Commerce migration complete!' AS status;
