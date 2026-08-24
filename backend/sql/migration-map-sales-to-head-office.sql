-- Migration: Map legacy sales, cash_drawer, and expenses to Head Office
-- All records with branch_id=1 (deleted branch) or NULL are reassigned
-- to the Head Office branch (id=24). Other branches remain untouched.

BEGIN;

-- 1. Sales: remap branch_id=1 and NULL → Head Office (24)
UPDATE sales SET branch_id = 24 WHERE branch_id = 1;
UPDATE sales SET branch_id = 24 WHERE branch_id IS NULL;

-- 2. Cash drawer: remap branch_id=1 → Head Office (24)
UPDATE cash_drawer SET branch_id = 24 WHERE branch_id = 1;

-- 3. Expenses: remap branch_id=1 and NULL → Head Office (24)
UPDATE expenses SET branch_id = 24 WHERE branch_id = 1;
UPDATE expenses SET branch_id = 24 WHERE branch_id IS NULL;

-- 4. Verify no orphaned references remain
-- (sales, cash_drawer, expenses should all have valid branch_id now)

COMMIT;

-- Verification queries (run after COMMIT)
-- SELECT 'sales' AS tbl, branch_id, COUNT(*)::int AS cnt FROM sales GROUP BY branch_id ORDER BY branch_id;
-- SELECT 'cash_drawer' AS tbl, branch_id, COUNT(*)::int AS cnt FROM cash_drawer GROUP BY branch_id ORDER BY branch_id;
-- SELECT 'expenses' AS tbl, branch_id, COUNT(*)::int AS cnt FROM expenses GROUP BY branch_id ORDER BY branch_id;
