-- Migration: Per-Branch Inventory
-- Adds branch_inventory table so each branch tracks its own stock levels.
-- products.stock is kept as a denormalized total for backward compatibility.

-- ═══════════════════════════════════════════════════════════════════
-- BRANCH INVENTORY TABLE
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS branch_inventory (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 5 CHECK(reorder_level >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(branch_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_inventory_branch ON branch_inventory(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_inventory_product ON branch_inventory(product_id);

-- ═══════════════════════════════════════════════════════════════════
-- SEED: Populate branch_inventory from existing sales data
-- For each branch, count the net quantity of each product sold/received
-- Then set initial stock as: global_stock - sold_at_branch + received_at_branch
-- For branches with no history, give them the full global stock evenly.
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: For each active branch, create branch_inventory rows for products they've sold
INSERT INTO branch_inventory (branch_id, product_id, quantity, reorder_level)
SELECT b.id AS branch_id,
       p.id AS product_id,
       GREATEST(p.stock - COALESCE(sold.total_sold, 0) + COALESCE(received.total_received, 0), 0) AS quantity,
       p.reorder_level
FROM branches b
CROSS JOIN products p
LEFT JOIN (
  -- Products sold per branch
  SELECT s2.branch_id, si2.product_id, SUM(si2.quantity) AS total_sold
  FROM sale_items si2
  JOIN sales s2 ON s2.id = si2.sale_id
  WHERE s2.branch_id IS NOT NULL
  GROUP BY s2.branch_id, si2.product_id
) sold ON sold.branch_id = b.id AND sold.product_id = p.id
LEFT JOIN (
  -- Products received via transfer per branch
  SELECT st.to_branch_id AS branch_id, st.product_id, SUM(st.quantity) AS total_received
  FROM stock_transfers st
  WHERE st.status = 'COMPLETED' AND st.to_branch_id IS NOT NULL
  GROUP BY st.to_branch_id, st.product_id
) received ON received.branch_id = b.id AND received.product_id = p.id
WHERE b.is_active = TRUE
  AND p.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM branch_inventory bi
    WHERE bi.branch_id = b.id AND bi.product_id = p.id
  )
ON CONFLICT (branch_id, product_id) DO NOTHING;

-- Step 2: For any product not yet in branch_inventory for a branch, default to global stock
INSERT INTO branch_inventory (branch_id, product_id, quantity, reorder_level)
SELECT b.id, p.id, p.stock, p.reorder_level
FROM branches b
CROSS JOIN products p
WHERE b.is_active = TRUE
  AND p.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM branch_inventory bi
    WHERE bi.branch_id = b.id AND bi.product_id = p.id
  )
ON CONFLICT (branch_id, product_id) DO NOTHING;
