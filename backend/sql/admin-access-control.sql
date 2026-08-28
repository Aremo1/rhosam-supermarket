-- ═══════════════════════════════════════════════════════════════════
-- Admin Helper Script: Branch-Scoped Access Control
-- ═══════════════════════════════════════════════════════════════════
-- Use these queries to manage user access levels after the
-- branch-scoping migration has been applied.
-- ═══════════════════════════════════════════════════════════════════

-- ── View All Users with Their Access Level ───────────────────────
-- Shows each user's role, branch assignment, and effective access level
SELECT
  u.id,
  u.name,
  u.email,
  u.role,
  b.name AS assigned_branch,
  CASE
    WHEN u.role = 'ADMIN' AND u.branch_id IS NULL THEN '🔑 SUPER_ADMIN (All Branches)'
    WHEN u.role = 'ADMIN' AND u.branch_id IS NOT NULL THEN '🏢 BRANCH_ADMIN (' || b.name || ')'
    WHEN u.role = 'MANAGER' THEN '👔 BRANCH_MANAGER (' || b.name || ')'
    WHEN u.role = 'CASHIER' THEN '🛒 BRANCH_CASHIER (' || b.name || ')'
    ELSE '❓ UNKNOWN'
  END AS access_level,
  u.is_active,
  u.last_login_at
FROM users u
LEFT JOIN branches b ON b.id = u.branch_id
ORDER BY u.role, b.name, u.name;


-- ── Count Users by Access Level ──────────────────────────────────
SELECT
  CASE
    WHEN role = 'ADMIN' AND branch_id IS NULL THEN 'SUPER_ADMIN'
    WHEN role = 'ADMIN' AND branch_id IS NOT NULL THEN 'BRANCH_ADMIN'
    WHEN role = 'MANAGER' THEN 'BRANCH_MANAGER'
    WHEN role = 'CASHIER' THEN 'BRANCH_CASHIER'
  END AS access_level,
  COUNT(*) AS user_count
FROM users
WHERE is_active = TRUE
GROUP BY access_level
ORDER BY access_level;


-- ── Promote a Branch Admin to Super-Admin ────────────────────────
-- WARNING: This gives the user full access to ALL branches
-- Run this BEFORE changing the user's role if needed

-- Example: Promote user ID 5 to super-admin
-- UPDATE users SET branch_id = NULL WHERE id = 5;

-- Verify the change:
-- SELECT id, name, role, branch_id FROM users WHERE id = 5;


-- ── Demote a Super-Admin to Branch Admin ─────────────────────────
-- WARNING: This restricts the user to a single branch

-- Example: Restrict user ID 5 to branch 10
-- UPDATE users SET branch_id = 10 WHERE id = 5;

-- Verify the change:
-- SELECT id, name, role, branch_id FROM users WHERE id = 5;


-- ── Transfer a User to a Different Branch ────────────────────────
-- Example: Move user ID 5 from branch 10 to branch 20
-- UPDATE users SET branch_id = 20 WHERE id = 5;


-- ── View Branch Admin Summary ────────────────────────────────────
-- Shows how many admins/managers are assigned to each branch
SELECT
  b.id AS branch_id,
  b.name AS branch_name,
  COUNT(DISTINCT CASE WHEN u.role = 'ADMIN' THEN u.id END) AS admin_count,
  COUNT(DISTINCT CASE WHEN u.role = 'MANAGER' THEN u.id END) AS manager_count,
  COUNT(DISTINCT CASE WHEN u.role = 'CASHIER' THEN u.id END) AS cashier_count,
  COUNT(DISTINCT u.id) AS total_users
FROM branches b
LEFT JOIN users u ON u.branch_id = b.id AND u.is_active = TRUE
WHERE b.is_active = TRUE
GROUP BY b.id, b.name
ORDER BY b.name;


-- ── Find Branches Without Any Admin ──────────────────────────────
-- Useful for identifying branches that need an admin assigned
SELECT
  b.id,
  b.name,
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


-- ── Find Super-Admins ────────────────────────────────────────────
-- List all users with full access to all branches
SELECT
  id,
  name,
  email,
  created_at,
  last_login_at
FROM users
WHERE role = 'ADMIN'
  AND branch_id IS NULL
  AND is_active = TRUE
ORDER BY name;


-- ── Audit Trail for Access Changes ───────────────────────────────
-- View recent user modifications (role/branch changes)
SELECT
  a.created_at,
  u.name AS modified_by,
  a.action,
  a.entity_type,
  a.entity_id,
  a.details,
  a.ip_address
FROM audit_logs a
LEFT JOIN users u ON u.id = a.user_id
WHERE a.entity_type = 'USER'
  AND a.action IN ('CREATE', 'UPDATE', 'DELETE')
ORDER BY a.created_at DESC
LIMIT 50;


-- ═══════════════════════════════════════════════════════════════════
-- BEST PRACTICES
-- ═══════════════════════════════════════════════════════════════════
--
-- 1. Always have at least ONE super-admin (ADMIN with no branch_id)
--    to manage the system and other branches.
--
-- 2. Assign branch admins (ADMIN with branch_id) to manage
--    individual branches. They can only see their branch's data.
--
-- 3. Branch managers (MANAGER) can manage inventory and sales
--    but cannot manage users or system settings.
--
-- 4. Cashiers (CASHIER) can only process POS transactions.
--
-- 5. When creating a new user:
--    - Super-admin: Set role='ADMIN', branch_id=NULL
--    - Branch admin: Set role='ADMIN', branch_id=<branch_id>
--    - Branch manager: Set role='MANAGER', branch_id=<branch_id>
--    - Cashier: Set role='CASHIER', branch_id=<branch_id>
--
-- ═══════════════════════════════════════════════════════════════════
