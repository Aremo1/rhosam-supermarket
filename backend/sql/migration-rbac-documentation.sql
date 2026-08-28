-- ═══════════════════════════════════════════════════════════════════
-- Migration: Role-Based Access Control (RBAC) Documentation
-- File:   migration-rbac-documentation.sql
-- Date:   2026-08-28
-- Author: RHoSAM Supermarket Platform
-- ═══════════════════════════════════════════════════════════════════
--
-- PURPOSE
-- ───────
-- This migration documents the complete role-based access control
-- system for the RHoSAM Supermarket multi-branch platform.
--
-- It adds:
--   1. Table & column comments describing the RBAC model
--   2. A function to check a user's effective access level
--   3. A view showing every user's access level and permissions
--   4. A permissions matrix view for quick reference
--   5. Audit trail of the migration
--
-- RUNNING THIS MIGRATION
-- ───────────────────────
--   psql -d rhosam_db -f migration-rbac-documentation.sql
--
-- This migration is idempotent (safe to run multiple times).
--
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 1: ROLE DEFINITIONS
-- ═══════════════════════════════════════════════════════════════════
--
-- The platform defines four effective access levels based on the
-- combination of the users.role and users.branch_id columns:
--
-- ┌─────────────────┬────────────┬──────────────────────────────────┐
-- │ Access Level    │ Role       │ branch_id                        │
-- ├─────────────────┼────────────┼──────────────────────────────────┤
-- │ SUPER_ADMIN     │ ADMIN      │ NULL (no branch assigned)        │
-- │ BRANCH_ADMIN    │ ADMIN      │ <branch_id> (branch assigned)    │
-- │ BRANCH_MANAGER  │ MANAGER    │ <branch_id> (branch assigned)    │
-- │ BRANCH_CASHIER  │ CASHIER    │ <branch_id> (branch assigned)    │
-- └─────────────────┴────────────┴──────────────────────────────────┘
--
-- KEY RULE
-- ────────
-- The distinction between SUPER_ADMIN and BRANCH_ADMIN is the
-- presence or absence of a branch_id. An ADMIN user WITH a
-- branch_id is a branch-scoped admin, NOT a super-admin.
--


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 2: PERMISSIONS MATRIX
-- ═══════════════════════════════════════════════════════════════════
--
-- ┌──────────────────────────────────┬─────┬─────┬─────┬─────┐
-- │ Feature / Endpoint               │ SA  │ BA  │ BM  │ BC  │
-- ├──────────────────────────────────┼─────┼─────┼─────┼─────┤
-- │ Dashboard (own branch)           │  ✓  │  ✓  │  ✓  │  ✓  │
-- │ Dashboard (all branches)         │  ✓  │  —  │  —  │  —  │
-- │ Executive Overview               │  ✓  │  —  │  —  │  —  │
-- │ Point of Sale (POS)              │  ✓  │  ✓  │  ✓  │  ✓  │
-- │ Products (view/edit/create)      │  ✓  │  ✓  │  ✓  │  —  │
-- │ Products (delete)                │  ✓  │  —  │  —  │  —  │
-- │ Categories (create/edit/delete)  │  ✓  │  ✓  │  —  │  —  │
-- │ Inventory (view/edit)            │  ✓  │  ✓  │  ✓  │  —  │
-- │ Branch Inventory (own branch)    │  ✓  │  ✓  │  ✓  │  —  │
-- │ Branch Inventory (all branches)  │  ✓  │  —  │  —  │  —  │
-- │ Damages / Wastage                │  ✓  │  ✓  │  ✓  │  —  │
-- │ Stock Valuation                  │  ✓  │  ✓  │  ✓  │  —  │
-- │ Expiry Tracking                  │  ✓  │  ✓  │  ✓  │  —  │
-- │ Import / Export                  │  ✓  │  ✓  │  ✓  │  —  │
-- │ Inventory Audit Cycle            │  ✓  │  ✓  │  ✓  │  —  │
-- │ Sales (own branch)               │  ✓  │  ✓  │  ✓  │  own│
-- │ Sales (all branches)             │  ✓  │  —  │  —  │  —  │
-- │ Customers                        │  ✓  │  ✓  │  ✓  │  ✓  │
-- │ Suppliers                        │  ✓  │  ✓  │  ✓  │  —  │
-- │ Purchase Orders (own branch)     │  ✓  │  ✓  │  ✓  │  —  │
-- │ Purchase Orders (all branches)   │  ✓  │  —  │  —  │  —  │
-- │ Expenses (own branch)            │  ✓  │  ✓  │  ✓  │  —  │
-- │ Expenses (all branches)          │  ✓  │  —  │  —  │  —  │
-- │ Finance Summary                  │  ✓  │  ✓  │  ✓  │  —  │
-- │ AI Forecast                      │  ✓  │  ✓  │  ✓  │  —  │
-- │ Auto Reorder                     │  ✓  │  ✓  │  ✓  │  —  │
-- │ Reports (own branch)             │  ✓  │  ✓  │  ✓  │  —  │
-- │ Reports (all branches)           │  ✓  │  —  │  —  │  —  │
-- │ Cash Drawer                      │  ✓  │  ✓  │  ✓  │  ✓  │
-- │ Branch Management (CRUD)         │  ✓  │  —  │  —  │  —  │
-- │ Messages (inter-branch)          │  ✓  │  ✓  │  ✓  │  —  │
-- │ Stock Transfers                  │  ✓  │  ✓  │  ✓  │  —  │
-- │ Customer Display                 │  ✓  │  ✓  │  ✓  │  ✓  │
-- │ Supplier Portal                  │  ✓  │  ✓  │  ✓  │  —  │
-- │ User Management (own branch)     │  ✓  │  ✓  │  —  │  —  │
-- │ User Management (all branches)   │  ✓  │  —  │  —  │  —  │
-- │ Audit Logs (own branch)          │  ✓  │  ✓  │  —  │  —  │
-- │ Audit Logs (all branches)        │  ✓  │  —  │  —  │  —  │
-- │ Login History                    │  ✓  │  ✓  │  —  │  —  │
-- │ Payment Settings                 │  ✓  │  —  │  --  │  —  │
-- │ Payment Terminals (CRUD)         │  ✓  │  —  │  —  │  —  │
-- │ Alert Rules (CRUD)               │  ✓  │  —  │  —  │  —  │
-- │ Stock Alerts                     │  ✓  │  ✓  │  ✓  │  ✓  │
-- │ Notification Settings            │  ✓  │  ✓  │  ✓  │  ✓  │
-- │ Change Password                  │  ✓  │  ✓  │  ✓  │  ✓  │
-- │ MFA / Security                   │  ✓  │  ✓  │  ✓  │  ✓  │
-- │ Database Backup                  │  ✓  │  —  │  —  │  —  │
-- │ Wi-Fi QR                         │  ✓  │  ✓  │  ✓  │  ✓  │
-- └──────────────────────────────────┴─────┴─────┴─────┴─────┘
--
-- Legend:
--   SA = Super Admin (ADMIN, no branch)
--   BA = Branch Admin (ADMIN, with branch)
--   BM = Branch Manager (MANAGER)
--   BC = Branch Cashier (CASHIER)
--   ✓  = Full access
--   —  = No access (403 Forbidden)
-- own = Own sales only (cashier_id filter)
--


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 3: TABLE & COLUMN COMMENTS
-- ═══════════════════════════════════════════════════════════════════

-- Users table
COMMENT ON TABLE users IS
  'Platform users with role-based access control. '
  'Role + branch_id combination determines effective access level: '
  'ADMIN+NULL=SUPER_ADMIN, ADMIN+branch=BRANCH_ADMIN, '
  'MANAGER+branch=BRANCH_MANAGER, CASHIER+branch=BRANCH_CASHIER.';

COMMENT ON COLUMN users.role IS
  'User role: ADMIN, MANAGER, or CASHIER. '
  'Combined with branch_id to determine effective access level. '
  'ADMIN with NULL branch_id = super-admin (all branches). '
  'ADMIN with branch_id = branch admin (scoped to branch).';

COMMENT ON COLUMN users.branch_id IS
  'Branch assignment for scoped access. '
  'NULL = super-admin (sees all branches). '
  'NOT NULL = scoped to this branch only (branch admin, manager, or cashier).';

-- Branches table
COMMENT ON TABLE branches IS
  'Supermarket branch locations. Each branch has its own inventory, '
  'sales, expenses, and users. Branch management (CRUD) is restricted '
  'to super-admins only.';

COMMENT ON COLUMN branches.manager_id IS
  'Optional reference to a MANAGER user assigned to this branch. '
  'This is a soft reference — access control is enforced via '
  'users.branch_id, not this column.';

-- Branch inventory table
COMMENT ON TABLE branch_inventory IS
  'Per-branch stock levels. Each row tracks the quantity of a product '
  'at a specific branch. Branch admins/managers can only update rows '
  'for their own branch. Super-admins can update any branch.';

-- Sales table
COMMENT ON TABLE sales IS
  'Point-of-sale transactions. Each sale is linked to a branch via '
  'branch_id. Cashiers see only their own sales. Branch managers/admins '
  'see all sales for their branch. Super-admins see all sales.';


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 4: HELPER FUNCTION — Get User Access Level
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_user_access_level(
  p_user_id INTEGER
) RETURNS TEXT AS $$
DECLARE
  v_role VARCHAR(30);
  v_branch_id INTEGER;
  v_access_level TEXT;
BEGIN
  SELECT role, branch_id INTO v_role, v_branch_id
  FROM users WHERE id = p_user_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN 'USER_NOT_FOUND';
  END IF;

  IF v_role = 'ADMIN' AND v_branch_id IS NULL THEN
    v_access_level := 'SUPER_ADMIN';
  ELSIF v_role = 'ADMIN' AND v_branch_id IS NOT NULL THEN
    v_access_level := 'BRANCH_ADMIN';
  ELSIF v_role = 'MANAGER' THEN
    v_access_level := 'BRANCH_MANAGER';
  ELSIF v_role = 'CASHIER' THEN
    v_access_level := 'BRANCH_CASHIER';
  ELSE
    v_access_level := 'UNKNOWN';
  END IF;

  RETURN v_access_level;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_user_access_level(INTEGER) IS
  'Returns the effective access level for a user: '
  'SUPER_ADMIN, BRANCH_ADMIN, BRANCH_MANAGER, or BRANCH_CASHIER. '
  'Takes user ID as parameter. Returns USER_NOT_FOUND if user is inactive or missing.';

-- Example usage:
--   SELECT get_user_access_level(1);  -- Returns: SUPER_ADMIN
--   SELECT get_user_access_level(2);  -- Returns: BRANCH_ADMIN


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 5: VIEW — User Access Levels
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_user_access_levels AS
SELECT
  u.id AS user_id,
  u.name AS user_name,
  u.email,
  u.role AS db_role,
  u.branch_id,
  b.name AS branch_name,
  get_user_access_level(u.id) AS access_level,
  CASE
    WHEN u.role = 'ADMIN' AND u.branch_id IS NULL
      THEN 'Full access to all branches'
    WHEN u.role = 'ADMIN' AND u.branch_id IS NOT NULL
      THEN 'Scoped to branch: ' || b.name
    WHEN u.role = 'MANAGER'
      THEN 'Scoped to branch: ' || b.name || ' (no user management)'
    WHEN u.role = 'CASHIER'
      THEN 'POS only, scoped to branch: ' || b.name
    ELSE 'Unknown'
  END AS permission_summary,
  u.is_active,
  u.last_login_at,
  u.created_at
FROM users u
LEFT JOIN branches b ON b.id = u.branch_id
WHERE u.is_active = TRUE
ORDER BY
  CASE get_user_access_level(u.id)
    WHEN 'SUPER_ADMIN' THEN 1
    WHEN 'BRANCH_ADMIN' THEN 2
    WHEN 'BRANCH_MANAGER' THEN 3
    WHEN 'BRANCH_CASHIER' THEN 4
    ELSE 5
  END,
  b.name,
  u.name;

COMMENT ON VIEW v_user_access_levels IS
  'Shows all active users with their effective access level, '
  'branch assignment, and permission summary. '
  'Use this view to audit who has what access.';


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 6: VIEW — Permissions Matrix Reference
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_permissions_matrix AS
SELECT * FROM (VALUES
  ('Dashboard (own branch)',          true,  true,  true,  true),
  ('Dashboard (all branches)',        true,  false, false, false),
  ('Executive Overview',              true,  false, false, false),
  ('Point of Sale (POS)',             true,  true,  true,  true),
  ('Products (view/edit)',            true,  true,  true,  false),
  ('Products (create)',               true,  true,  true,  false),
  ('Products (delete)',               true,  false, false, false),
  ('Categories (manage)',             true,  true,  false, false),
  ('Inventory (view/edit)',           true,  true,  true,  false),
  ('Branch Inventory (own branch)',   true,  true,  true,  false),
  ('Branch Inventory (all branches)', true,  false, false, false),
  ('Damages / Wastage',              true,  true,  true,  false),
  ('Stock Valuation',                 true,  true,  true,  false),
  ('Expiry Tracking',                 true,  true,  true,  false),
  ('Import / Export',                 true,  true,  true,  false),
  ('Inventory Audit Cycle',           true,  true,  true,  false),
  ('Sales (own branch)',              true,  true,  true,  'own'),
  ('Sales (all branches)',            true,  false, false, false),
  ('Returns',                         true,  true,  false, false),
  ('Customers',                       true,  true,  true,  true),
  ('Suppliers',                       true,  true,  true,  false),
  ('Purchase Orders (own branch)',    true,  true,  true,  false),
  ('Purchase Orders (all branches)',  true,  false, false, false),
  ('Expenses (own branch)',           true,  true,  true,  false),
  ('Expenses (all branches)',         true,  false, false, false),
  ('Finance Summary',                 true,  true,  true,  false),
  ('AI Forecast',                     true,  true,  true,  false),
  ('Auto Reorder',                    true,  true,  true,  false),
  ('Reports (own branch)',            true,  true,  true,  false),
  ('Reports (all branches)',          true,  false, false, false),
  ('Cash Drawer',                     true,  true,  true,  true),
  ('Branch Management (CRUD)',        true,  false, false, false),
  ('Messages (inter-branch)',         true,  true,  true,  false),
  ('Stock Transfers',                 true,  true,  true,  false),
  ('Customer Display',                true,  true,  true,  true),
  ('Supplier Portal',                 true,  true,  true,  false),
  ('User Management (own branch)',    true,  true,  false, false),
  ('User Management (all branches)',  true,  false, false, false),
  ('User Management (create admin)',  true,  false, false, false),
  ('Audit Logs (own branch)',         true,  true,  false, false),
  ('Audit Logs (all branches)',       true,  false, false, false),
  ('Login History',                   true,  true,  false, false),
  ('Payment Settings',                true,  false, false, false),
  ('Payment Terminals (CRUD)',        true,  false, false, false),
  ('Alert Rules (CRUD)',              true,  false, false, false),
  ('Stock Alerts',                    true,  true,  true,  true),
  ('Notification Settings',           true,  true,  true,  true),
  ('Change Password',                 true,  true,  true,  true),
  ('MFA / Security',                  true,  true,  true,  true),
  ('Database Backup',                 true,  false, false, false),
  ('Wi-Fi QR',                        true,  true,  true,  true)
) AS t(
  feature TEXT,
  super_admin BOOLEAN,
  branch_admin BOOLEAN,
  branch_manager BOOLEAN,
  branch_cashier BOOLEAN
);

COMMENT ON VIEW v_permissions_matrix IS
  'Complete permissions matrix showing which access level can access each feature. '
  'SA=Super Admin (ADMIN,NULL), BA=Branch Admin (ADMIN,branch), '
  'BM=Branch Manager, BC=Branch Cashier.';


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 7: VIEW — Branch Summary with User Counts
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_branch_user_summary AS
SELECT
  b.id AS branch_id,
  b.name AS branch_name,
  b.is_active,
  COUNT(DISTINCT CASE WHEN u.role = 'ADMIN' THEN u.id END) AS admin_count,
  COUNT(DISTINCT CASE WHEN u.role = 'MANAGER' THEN u.id END) AS manager_count,
  COUNT(DISTINCT CASE WHEN u.role = 'CASHIER' THEN u.id END) AS cashier_count,
  COUNT(DISTINCT u.id) AS total_users
FROM branches b
LEFT JOIN users u ON u.branch_id = b.id AND u.is_active = TRUE
WHERE b.is_active = TRUE
GROUP BY b.id, b.name, b.is_active
ORDER BY b.name;

COMMENT ON VIEW v_branch_user_summary IS
  'Shows user counts per branch. Useful for ensuring each branch '
  'has at least one admin and manager assigned.';


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 8: VIEW — Branches Without Admin
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_branches_without_admin AS
SELECT
  b.id,
  b.name,
  b.address,
  b.phone,
  b.is_active
FROM branches b
WHERE b.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.branch_id = b.id
      AND u.role = 'ADMIN'
      AND u.is_active = TRUE
  )
ORDER BY b.name;

COMMENT ON VIEW v_branches_without_admin IS
  'Lists active branches that have no active ADMIN user assigned. '
  'These branches may need a branch admin to be created.';


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 9: AUDIT LOG
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'MIGRATION',
  'SYSTEM',
  'rbac-documentation',
  jsonb_build_object(
    'description', 'Applied RBAC documentation migration',
    'migration_file', 'migration-rbac-documentation.sql',
    'objects_created', jsonb_build_array(
      'function get_user_access_level(integer)',
      'view v_user_access_levels',
      'view v_permissions_matrix',
      'view v_branch_user_summary',
      'view v_branches_without_admin'
    ),
    'timestamp', NOW()::text
  ),
  NOW()
);


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 10: QUICK REFERENCE QUERIES
-- ═══════════════════════════════════════════════════════════════════
--
-- After running this migration, use these queries:
--
-- ── See all users with access levels ──
-- SELECT * FROM v_user_access_levels;
--
-- ── See the full permissions matrix ──
-- SELECT * FROM v_permissions_matrix;
--
-- ── See branch user counts ──
-- SELECT * FROM v_branch_user_summary;
--
-- ── Find branches needing an admin ──
-- SELECT * FROM v_branches_without_admin;
--
-- ── Check a specific user's access level ──
-- SELECT get_user_access_level(5);
--
-- ── Promote branch admin to super-admin ──
-- UPDATE users SET branch_id = NULL WHERE id = <user_id>;
--
-- ── Demote super-admin to branch admin ──
-- UPDATE users SET branch_id = <branch_id> WHERE id = <user_id>;
--
-- ── Transfer user to different branch ──
-- UPDATE users SET branch_id = <new_branch_id> WHERE id = <user_id>;
--
-- ═══════════════════════════════════════════════════════════════════
