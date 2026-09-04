-- ═══════════════════════════════════════════════════════════════════
-- Priority Gaps Migration (8 features to close Store Commerce gap)
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- 1. OFFLINE MODE - sync queue & cached data
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS offline_sync_queue (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(100) NOT NULL,
    user_id INTEGER REFERENCES users(id),
    action_type VARCHAR(30) NOT NULL CHECK (action_type IN ('sale','return','adjustment','customer','expense')),
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','synced','failed','conflict')),
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    synced_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS offline_data_cache (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- 'products','customers','categories','settings'
    entity_id INTEGER,
    data JSONB NOT NULL,
    checksum VARCHAR(64),
    cached_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,
    UNIQUE(device_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_offline_sync_status ON offline_sync_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_offline_sync_device ON offline_sync_queue(device_id);
CREATE INDEX IF NOT EXISTS idx_offline_cache_device ON offline_data_cache(device_id, entity_type);

-- ═══════════════════════════════════════════════════════════════════
-- 2. PRODUCT VARIANTS (size, color, etc.)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS product_variants (
    id SERIAL PRIMARY KEY,
    parent_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_name VARCHAR(200) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    barcode VARCHAR(100),
    attributes JSONB DEFAULT '{}', -- {"color":"Red","size":"XL","material":"Cotton"}
    price DECIMAL(12,2), -- NULL = use parent price
    cost_price DECIMAL(12,2),
    stock INTEGER DEFAULT 0,
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_variant_options (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    option_name VARCHAR(50) NOT NULL, -- 'Color', 'Size', 'Material'
    option_values TEXT[] NOT NULL, -- ARRAY['Red','Blue','Green']
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variants_parent ON product_variants(parent_product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku);
CREATE INDEX IF NOT EXISTS idx_variants_barcode ON product_variants(barcode);

-- ═══════════════════════════════════════════════════════════════════
-- 3. QUANTITY / THRESHOLD / MIX&MATCH DISCOUNTS
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS discount_rules (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    discount_type VARCHAR(30) NOT NULL CHECK (discount_type IN (
        'simple','quantity','threshold','mix_and_match','tender_based','buy_x_get_y'
    )),
    -- Simple: flat or % off
    -- Quantity: buy N get M% off
    -- Threshold: spend X get Y% off
    -- Mix & Match: buy items from group A + group B, get discount
    -- Tender-based: discount when paying with specific method
    -- Buy X Get Y: buy X items, get Y free or discounted
    discount_value DECIMAL(12,2) NOT NULL, -- % or fixed amount
    discount_applies_to VARCHAR(20) DEFAULT 'transaction' CHECK (discount_applies_to IN ('transaction','line','cheapest','most_expensive')),
    -- Quantity discount fields
    min_quantity INTEGER,
    -- Threshold discount fields
    min_spend DECIMAL(12,2),
    -- Mix & Match fields
    group_a_products TEXT, -- comma-separated product IDs
    group_a_min_qty INTEGER,
    group_b_products TEXT,
    group_b_min_qty INTEGER,
    -- Buy X Get Y fields
    buy_quantity INTEGER,
    get_quantity INTEGER,
    get_discount_percent DECIMAL(5,2) DEFAULT 100, -- 100 = free
    -- Tender-based fields
    applicable_payment_methods TEXT, -- comma-separated: 'Cash,Card,Transfer'
    -- General
    applicable_products TEXT, -- NULL = all
    applicable_categories TEXT, -- NULL = all
    max_uses INTEGER,
    used_count INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 0, -- higher = applied first
    is_active BOOLEAN DEFAULT TRUE,
    start_date TIMESTAMP NOT NULL DEFAULT NOW(),
    end_date TIMESTAMP,
    branch_id INTEGER REFERENCES branches(id),
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discount_usage (
    id SERIAL PRIMARY KEY,
    discount_rule_id INTEGER NOT NULL REFERENCES discount_rules(id) ON DELETE CASCADE,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    discount_amount DECIMAL(12,2) NOT NULL,
    used_at TIMESTAMP DEFAULT NOW()
);

-- Add discount_rule_id to sale_items
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sale_items' AND column_name='discount_rule_id') THEN
        ALTER TABLE sale_items ADD COLUMN discount_rule_id INTEGER REFERENCES discount_rules(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='discount_rule_id') THEN
        ALTER TABLE sales ADD COLUMN discount_rule_id INTEGER REFERENCES discount_rules(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='auto_discount_amount') THEN
        ALTER TABLE sales ADD COLUMN auto_discount_amount DECIMAL(12,2) DEFAULT 0;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_discount_rules_active ON discount_rules(is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_discount_usage_sale ON discount_usage(sale_id);

-- ═══════════════════════════════════════════════════════════════════
-- 4. MULTI-CURRENCY
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS currencies (
    id SERIAL PRIMARY KEY,
    code VARCHAR(3) UNIQUE NOT NULL, -- 'NGN', 'USD', 'GBP', 'EUR'
    name VARCHAR(50) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    decimal_places INTEGER DEFAULT 2,
    is_base_currency BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS currency_rates (
    id SERIAL PRIMARY KEY,
    from_currency_id INTEGER NOT NULL REFERENCES currencies(id),
    to_currency_id INTEGER NOT NULL REFERENCES currencies(id),
    rate DECIMAL(18,8) NOT NULL,
    source VARCHAR(50) DEFAULT 'manual', -- 'manual','api','fixed'
    effective_from TIMESTAMP DEFAULT NOW(),
    effective_to TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(from_currency_id, to_currency_id)
);

-- Add currency columns to sales
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='currency_code') THEN
        ALTER TABLE sales ADD COLUMN currency_code VARCHAR(3) DEFAULT 'NGN';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='exchange_rate') THEN
        ALTER TABLE sales ADD COLUMN exchange_rate DECIMAL(18,8) DEFAULT 1;
    END IF;
END $$;

-- Seed default currencies
INSERT INTO currencies (code, name, symbol, is_base_currency) VALUES
('NGN', 'Nigerian Naira', '₦', true),
('USD', 'US Dollar', '$', false),
('GBP', 'British Pound', '£', false),
('EUR', 'Euro', '€', false),
('GHS', 'Ghanaian Cedi', 'GH₵', false),
('KES', 'Kenyan Shilling', 'KSh', false),
('ZAR', 'South African Rand', 'R', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO currency_rates (from_currency_id, to_currency_id, rate, source)
SELECT c1.id, c2.id,
    CASE
        WHEN c1.code = 'NGN' AND c2.code = 'USD' THEN 0.00065
        WHEN c1.code = 'USD' AND c2.code = 'NGN' THEN 1538.46
        WHEN c1.code = 'NGN' AND c2.code = 'GBP' THEN 0.00051
        WHEN c1.code = 'GBP' AND c2.code = 'NGN' THEN 1960.78
        WHEN c1.code = 'NGN' AND c2.code = 'EUR' THEN 0.00060
        WHEN c1.code = 'EUR' AND c2.code = 'NGN' THEN 1666.67
        WHEN c1.code = 'NGN' AND c2.code = 'GHS' THEN 0.0080
        WHEN c1.code = 'NGN' AND c2.code = 'KES' THEN 0.083
        WHEN c1.code = 'NGN' AND c2.code = 'ZAR' THEN 0.012
        ELSE 1
    END,
    'fixed'
FROM currencies c1 CROSS JOIN currencies c2
WHERE c1.code != c2.code
AND (c1.code = 'NGN' OR c2.code = 'NGN')
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_currency_rates_lookup ON currency_rates(from_currency_id, to_currency_id);

-- ═══════════════════════════════════════════════════════════════════
-- 5. DIGITAL WALLETS (Apple Pay / Google Pay config)
-- ═══════════════════════════════════════════════════════════════════
-- Already have payment_settings table — add digital wallet columns
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_settings' AND column_name='apple_pay_enabled') THEN
        ALTER TABLE payment_settings ADD COLUMN apple_pay_enabled BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_settings' AND column_name='google_pay_enabled') THEN
        ALTER TABLE payment_settings ADD COLUMN google_pay_enabled BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_settings' AND column_name='apple_pay_merchant_id') THEN
        ALTER TABLE payment_settings ADD COLUMN apple_pay_merchant_id VARCHAR(200);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_settings' AND column_name='google_pay_merchant_id') THEN
        ALTER TABLE payment_settings ADD COLUMN google_pay_merchant_id VARCHAR(200);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_settings' AND column_name='digital_wallet_public_key') THEN
        ALTER TABLE payment_settings ADD COLUMN digital_wallet_public_key TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_settings' AND column_name='digital_wallet_env') THEN
        ALTER TABLE payment_settings ADD COLUMN digital_wallet_env VARCHAR(20) DEFAULT 'sandbox';
    END IF;
END $$;

-- Add Apple Pay / Google Pay to payment methods
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='payment_method') THEN
        ALTER TABLE sales ADD COLUMN payment_method VARCHAR(30);
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 6. WISH LISTS
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS wishlists (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id), -- staff who added it
    notes TEXT,
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(customer_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlists_customer ON wishlists(customer_id);

-- ═══════════════════════════════════════════════════════════════════
-- 7. RECEIPT TEMPLATES
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS receipt_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    header_text TEXT DEFAULT 'Thank you for shopping with us!',
    footer_text TEXT DEFAULT 'Powered by RHoSAM',
    show_logo BOOLEAN DEFAULT TRUE,
    show_barcode BOOLEAN DEFAULT TRUE,
    show_customer_info BOOLEAN DEFAULT TRUE,
    show_cashier_name BOOLEAN DEFAULT TRUE,
    show_branch_info BOOLEAN DEFAULT TRUE,
    show_loyalty_points BOOLEAN DEFAULT TRUE,
    show_tax_breakdown BOOLEAN DEFAULT TRUE,
    show_savings BOOLEAN DEFAULT FALSE,
    custom_fields JSONB DEFAULT '[]', -- array of {label, key, position}
    paper_width INTEGER DEFAULT 80, -- mm: 58 or 80
    font_size INTEGER DEFAULT 12,
    logo_url TEXT,
    theme_color VARCHAR(20) DEFAULT '#16a34a',
    branch_id INTEGER REFERENCES branches(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed default template
INSERT INTO receipt_templates (name, is_default, header_text, footer_text) VALUES
('Default', true, '🛍️ Thank you for shopping with us!', 'Powered by RHoSAM • www.rhosam.com')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 8. FULFILLMENT WORKFLOW (pick/pack/ship)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fulfillments (
    id SERIAL PRIMARY KEY,
    fulfillment_number VARCHAR(30) UNIQUE NOT NULL,
    sale_id INTEGER REFERENCES sales(id),
    quotation_id INTEGER REFERENCES quotations(id),
    customer_id INTEGER REFERENCES customers(id),
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN (
        'pending','picking','packed','ready','shipped','delivered','cancelled'
    )),
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    shipping_method VARCHAR(50), -- 'pickup','delivery','courier','self_collect'
    shipping_address TEXT,
    shipping_notes TEXT,
    estimated_delivery TIMESTAMP,
    picked_by INTEGER REFERENCES users(id),
    packed_by INTEGER REFERENCES users(id),
    shipped_by INTEGER REFERENCES users(id),
    picked_at TIMESTAMP,
    packed_at TIMESTAMP,
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,
    tracking_number VARCHAR(100),
    carrier_name VARCHAR(100),
    total_items INTEGER DEFAULT 0,
    total_picked INTEGER DEFAULT 0,
    total_packed INTEGER DEFAULT 0,
    branch_id INTEGER REFERENCES branches(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fulfillment_items (
    id SERIAL PRIMARY KEY,
    fulfillment_id INTEGER NOT NULL REFERENCES fulfillments(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name VARCHAR(200) NOT NULL,
    quantity_needed INTEGER NOT NULL,
    quantity_picked INTEGER DEFAULT 0,
    quantity_packed INTEGER DEFAULT 0,
    location VARCHAR(50), -- shelf/bin location
    notes TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','picked','packed','short')),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fulfillments_status ON fulfillments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_fulfillments_sale ON fulfillments(sale_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_items_fulfillment ON fulfillment_items(fulfillment_id);

-- Add fulfillment columns to sales
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='needs_fulfillment') THEN
        ALTER TABLE sales ADD COLUMN needs_fulfillment BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='fulfillment_status') THEN
        ALTER TABLE sales ADD COLUMN fulfillment_status VARCHAR(30);
    END IF;
END $$;

SELECT '✅ Priority Gaps migration complete! All 8 features added.' AS status;
