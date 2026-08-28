# Changelog

All notable changes to the RHoSAM Supermarket POS platform.

---

## [1.1.0] — 2026-08-28

### 🔐 Branch-Scoped Role-Based Access Control (RBAC)

Complete implementation of multi-branch access control. Branch admins and managers are now scoped to their own branch data across all endpoints.

#### Access Levels

| Role | Branch Assignment | Access Level | Description |
|------|------------------|--------------|-------------|
| ADMIN | `branch_id = NULL` | **Super-Admin** | Full access to all branches |
| ADMIN | `branch_id = <id>` | **Branch Admin** | Scoped to own branch only |
| MANAGER | `branch_id = <id>` | **Branch Manager** | Scoped to own branch only |
| CASHIER | `branch_id = <id>` | **Branch Cashier** | POS only, own branch |

#### Backend Changes

- **`buildBranchFilter()`** — ADMIN users with `branch_id` are now treated like MANAGERs (scoped to their branch). Only ADMIN users **without** a `branch_id` can view all branches.
- **`isSuperAdmin(req)`** — New helper: `role === "ADMIN" && !branchId`
- **`isBranchAdmin(req)`** — New helper: `role === "ADMIN" && !!branchId`
- **`requireSuperAdmin`** middleware — Returns 403 for non-super-admins
- **Branch-scoped endpoints** — Sales, expenses, procurement, cash drawer, reports, finance, audit logs all auto-scope branch admins to their branch
- **Super-admin-only endpoints** — Branch CRUD, branch summary, executive overview, payment settings, terminal management, alert rules, database backup
- **User management** — Branch admins can only manage users in their own branch; cannot promote to ADMIN
- **Branch inventory** — Branch admins can only view/update their own branch inventory
- **`/api/branches` GET** — Returns only user's branch for branch admins/managers
- **`/api/products` GET** — Branch admins auto-scoped via `branch_inventory` JOIN
- **`/api/dashboard/stats`** — Branch admins see only their branch data

#### Frontend Changes

- **Menu filtering** — Super-admin-only pages (`executive`, `branches`, `users`, `audit`, `loginhistory`, `payment-settings`) hidden from branch admins
- **Dashboard** — Branch selector and branch overview chart only for super-admins; branch admins see fixed "Branch: {name}" indicator
- **All pages with branch selectors** (Inventory, Damages, Wastage, Sales, Reports, Expenses, Finance, Procurement, etc.) — Dropdown only for super-admins; branch admins see fixed indicator
- **Branch Inventory Management** — Super-admin can pick any branch; branch admins locked to their branch
- **InventoryAuditPage** — Fixed missing `selectedBranch` in `useCallback` dependency array

#### New Files

| File | Description |
|------|-------------|
| `backend/__tests__/branch-scoping.test.js` | 39 tests for branch scoping across all endpoints |
| `backend/__tests__/integration-branch-admin-flow.test.js` | 45 tests for full branch admin workflow |
| `backend/sql/migration-branch-scoping-v2.sql` | Branch scoping migration with views and functions |
| `backend/sql/migration-rbac-documentation.sql` | RBAC documentation migration (437 lines, 10 sections) |
| `backend/sql/admin-access-control.sql` | SQL helper queries for administrators |
| `backend/apply-branch-scoping-migration.js` | Node.js migration runner |

#### Modified Files

| File | Changes |
|------|---------|
| `backend/src/server.js` | Added RBAC helpers, scoped 20+ endpoints, updated `buildBranchFilter()` |
| `frontend/src/App.jsx` | Added `isSuperAdmin` to 21 components, guarded all branch selectors |
| `README.md` | Added RBAC section, permissions matrix, testing details, migration reference |

---

### 🔄 Service Worker Cache Busting

Fixed stale PWA cache issue where branch admins could still see the "All Branches" dropdown due to cached JavaScript.

- **`frontend/public/sw.js`** — Bumped `CACHE_VERSION` from `"v2"` to `"v3"`
- **`frontend/server.js`** — Added proper cache-control headers:
  - HTML files: `no-cache, no-store, must-revalidate`
  - Hashed assets (JS/CSS): `public, max-age=31536000, immutable`
  - SPA fallback: `no-cache, no-store, must-revalidate`

---

### 📢 SW Update Notification Banner

Replaced ugly `window.confirm()` dialog with a styled notification banner when a new Service Worker version is available.

- **`frontend/index.html`** — Dispatches `sw-update-available` custom event instead of `window.confirm()`
- **`frontend/src/App.jsx`** — Added `swUpdateAvailable` state, `useEffect` listener, and banner UI in Layout
- **`frontend/src/App.css`** — Added `.sw-update-banner` styles (blue gradient, matching install banner)

**Banner behavior:**
- Appears at top of page: "🔄 A new version of RHoSAM is available!"
- Two buttons: "Refresh Now" (activates SW + reloads) and "Later" (dismisses)
- Triggered when SW update is detected but not yet activated

---

### ✅ SW Cache Version Tests

9 tests to ensure Service Worker cache version consistency.

| Test | Description |
|------|-------------|
| Source `sw.js` exists and has valid `CACHE_VERSION` | Verifies `vN` format |
| Dist `sw.js` exists and has valid `CACHE_VERSION` | Verifies build output |
| Dist `CACHE_VERSION` matches source | Catches stale builds |
| `CACHE_VERSION` ≥ minimum threshold | Version ≥ `v3` |
| All cache names use same version | STATIC, DYNAMIC, API caches |
| Activate handler cleans old caches | Verifies `caches.delete()` |
| SKIP_WAITING handler exists | Forced update support |
| Dist `index.html` references valid assets | Assets exist on disk |
| Dist version ≥ source version | No version regression |

---

### 🚀 Production Deployment Scripts

| Script | Description | Usage |
|--------|-------------|-------|
| `run-production-migration.js` | Applies both RBAC migrations to production DB | `node run-production-migration.js` |
| `test-rbac-production.js` | Creates test user, runs 15 RBAC checks, cleans up | `BACKEND_URL=http://localhost:5000 node test-rbac-production.js` |

Both scripts are idempotent (safe to run multiple times).

---

### 📊 Test Results

```
Test Suites: 4 passed, 4 total
Tests:       122 passed, 122 total
Time:        2.77s
```

| Suite | Tests | Coverage |
|-------|-------|----------|
| `dashboard.test.js` | 25 | Dashboard stats, branch summary, top products, category sales |
| `branch-scoping.test.js` | 39 | Sales, branches, users, branch-inventory, dashboard, audit, expenses, finance, payment-settings, backup, POS |
| `integration-branch-admin-flow.test.js` | 45 | Full lifecycle: create user → login → verify scoping → test all endpoints → cross-branch isolation → super-admin access |
| `sw-version.test.js` | 9 | SW cache version consistency, format, activation, forced updates |

---

### 🌐 Deployment

| Service | URL | Status |
|---------|-----|--------|
| Backend API | https://rhosam-backend.onrender.com | ✅ Healthy |
| Frontend SPA | https://rhosam-frontend.onrender.com | ✅ Live |
| Service Worker | v3 | ✅ Deployed |
| Database | Render PostgreSQL | ✅ Connected |

---

### Commits

```
64b4c36  test: add production RBAC verification script
77dac60  feat: add production RBAC migration runner script
d8f4bf3  test: add SW cache version verification tests (9 tests)
624866d  feat: add SW update notification banner for PWA users
2fb445f  feat: implement branch-scoped RBAC for admin/manager users
```

---

## [1.0.0] — 2026-08-24

Initial release of RHoSAM Supermarket POS platform.

### Features

- Multi-branch supermarket POS system
- Product management with barcode scanning
- Sales tracking with multiple payment methods (Cash, Card, Transfer, POS)
- Inventory management with stock levels and reorder alerts
- Customer and supplier management
- Procurement and purchase order workflow
- Expense tracking and finance summary
- Cash drawer management
- Stock transfers between branches
- Damages and wastage reporting
- Stock valuation with trend history
- Expiry tracking and alerts
- Daily and monthly reports with email delivery
- Low stock and cashier sales reports
- Inter-branch messaging system
- Wi-Fi QR code generator for customers
- PWA support with offline caching
- Dark mode theme
- Paystack and Flutterwave payment gateway integration
- Cloudinary image upload for products
- Email notifications via Resend
- SMS notifications via Telnyx
- Database backup and restore
- Audit logging for all actions
- Role-based access (ADMIN, MANAGER, CASHIER)
- Multi-branch support with branch filtering
- Responsive mobile-friendly design
