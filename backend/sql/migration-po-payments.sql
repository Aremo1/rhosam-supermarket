-- Purchase Order Payments — vendor/supplier payment reconciliation
-- Supports part payments and full payments against purchase orders

CREATE TABLE IF NOT EXISTS purchase_order_payments (
  id SERIAL PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK(amount > 0),
  payment_method VARCHAR(20) NOT NULL DEFAULT 'Cash' CHECK(payment_method IN ('Cash','Card','Transfer','POS','Bank')),
  reference VARCHAR(100),
  notes TEXT,
  paid_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_payments_po ON purchase_order_payments(po_id);
