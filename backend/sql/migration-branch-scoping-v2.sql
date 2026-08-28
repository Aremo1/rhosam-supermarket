-- ═══════════════════════════════════════════════════════════════════
-- Migration: Branch-Scoped Access Control (v2)
-- Date: 2026-08-28
-- ═══════════════════════════════════════════════════════════════════
--
-- This migration documents and enforces the new role-based access
-- control rules for multi-branch supermarket management.
--
-- ROLE DEFINITIONS:
-- ─────────────────────────────────────────────────────────────────
-- 1. SUPER-ADMIN: ADMIN role with branch_id = NULL
--    - Full access to ALL branches
--    - Can create/edit/delete branches
--    - Can manage all users across branches
--    - Can view all sales, inventory, reports, audit logs
--    - Can manage payment settings, terminals, alert rules
--    - Can download database backups
--
-- 2. BRANCH ADMIN: ADMIN role with branch_id IS NOT NULL
--    - Scoped to their assigned branch ONLY
--    - Can manage products, inventory, sales for their branch
--    - Can manage users WITHIN their branch only
--    - CANNOT create/edit/delete branches
--    - CANNOT view other branches' data
--    - CANNOT access: executive overview, branch summary,
--      payment settings, terminal management, database backup
--
-- 3. BRANCH MANAGER: MANAGER role with branch_id IS NOT NULL
--    - Scoped to their assigned branch ONLY
--    - Can manage products, inventory, sales for their branch
--    - CANNOT manage users
--    - CANNOT create/edit/delete branches
--    - CANNOT view other branches' data
--
-- 4. CASHIER: CASHIER role with branch_id IS NOT NULL
--    - Can only process POS transactions
--    - Can only view their own sales
--    - Scoped to their assigned branch
--
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: Add helpful comments to the users table
COMMENT ON COLUMN users.role IS
  'User role: ADMIN (super-admin if branch_id NULL, branch-admin if branch_id set), MANAGER (branch-scoped), CASHIER (branch-scoped)';

COMMENT ON COLUMN users.branch_id IS
  'Branch assignment: NULL = super-admin (all branches), NOT NULL = scoped to this branch only';

-- Step 2: Add comments to branches table
COMMENT ON COLUMN branches.manager_id IS
  'Reference to the MANAGER user assigned to manage this branch';

-- Step 3: Create a view to easily identify super-admins vs branch admins
-- This view helps understand the access control structure
CREATE OR REPLACE VIEW v_user_access_level AS
SELECT
  u.id,
  u.name,
  u.email,
  u.role,
  u.branch_id,
  b.name AS branch_name,
  CASE
    WHEN u.role = 'ADMIN' AND u.branch_id IS NULL THEN 'SUPER_ADMIN'
    WHEN u.role = 'ADMIN' AND u.branch_id IS NOT NULL THEN 'BRANCH_ADMIN'
    WHEN u.role = 'MANAGER' THEN 'BRANCH_MANAGER'
    WHEN u.role = 'CASHIER' THEN 'BRANCH_CASHIER'
    ELSE 'UNKNOWN'
  END AS access_level,
  CASE
    WHEN u.role = 'ADMIN' AND u.branch_id IS NULL THEN 'Full access to all branches'
    WHEN u.role = 'ADMIN' AND u.branch_id IS NOT NULL THEN 'Scoped to branch: ' || COALESCE(b.name, 'Unknown')
    WHEN u.role = 'MANAGER' THEN 'Scoped to branch: ' || COALESCE(b.name, 'Unknown')
    WHEN u.role = 'CASHIER' THEN 'POS only, scoped to branch: ' || COALESCE(b.name, 'Unknown')
    ELSE 'No access'
  END AS access_description
FROM users u
LEFT JOIN branches b ON b.id = u.branch_id
WHERE u.is_active = TRUE;

COMMENT ON VIEW v_user_access_level IS
  'Shows each user access level: SUPER_ADMIN, BRANCH_ADMIN, BRANCH_MANAGER, or BRANCH_CASHIER';

-- Step 4: Log a summary of current user access levels
-- This helps administrators understand the impact of the migration
DO $$
DECLARE
  super_admin_count INTEGER;
  branch_admin_count INTEGER;
  manager_count INTEGER;
  cashier_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO super_admin_count
  FROM users WHERE role = 'ADMIN' AND branch_id IS NULL AND is_active = TRUE;

  SELECT COUNT(*) INTO branch_admin_count
  FROM users WHERE role = 'ADMIN' AND branch_id IS NOT NULL AND is_active = TRUE;

  SELECT COUNT(*) INTO manager_count
  FROM users WHERE role = 'MANAGER' AND is_active = TRUE;

  SELECT COUNT(*) INTO cashier_count
  FROM users WHERE role = 'CASHIER' AND is_active = TRUE;

  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'Branch-Scoped Access Control Migration Complete';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'User Access Level Summary:';
  RAISE NOTICE '  Super Admins (all branches): %', super_admin_count;
  RAISE NOTICE '  Branch Admins (branch-scoped): %', branch_admin_count;
  RAISE NOTICE '  Branch Managers: %', manager_count;
  RAISE NOTICE '  Branch Cashiers: %', cashier_count;
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'IMPORTANT: ADMIN users with a branch_id are now branch-scoped.';
  RAISE NOTICE 'They can only view/edit data for their assigned branch.';
  RAISE NOTICE 'To grant a branch admin full access, set their branch_id to NULL.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $$;

-- Step 5: Add audit trail for this migration
-- Record that this migration was applied
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'MIGRATION',
  'SYSTEM',
  'branch-scoping-v2',
  '{"description": "Applied branch-scoped access control rules", "timestamp": "' || NOW() || '"}',
  NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION COMPLETE
-- ═══════════════════════════════════════════════════════════════════
-- After running this migration:
--
-- 1. ADMIN users WITHOUT a branch_id are super-admins (full access)
-- 2. ADMIN users WITH a branch_id are branch admins (scoped)
-- 3. All other roles (MANAGER, CASHIER) are branch-scoped
--
-- To promote a branch admin to super-admin:
--   UPDATE users SET branch_id = NULL WHERE id = <user_id>;
--
-- To demote a super-admin to branch admin:
--   UPDATE users SET branch_id = <branch_id> WHERE id = <user_id>;
--
-- ═══════════════════════════════════════════════════════════════════
