# 🛍️ RHoSAM Supermarket POS

A full-stack supermarket Point of Sale (POS) platform built with **React** (Vite) and **Express.js** (PostgreSQL). Designed for Nigerian supermarkets with Naira (₦) currency support, role-based access control, and comprehensive business intelligence.

---

## ✨ Features

| Module | Capabilities |
|--------|-------------|
| **Authentication** | JWT login, account lockout, password change |
| **Point of Sale** | Product search, cart management, multiple payment methods, receipt generation, print support |
| **Products** | CRUD, barcode support, categories, cost/selling price tracking |
| **Inventory** | Stock levels, low-stock alerts, stock adjustments, movement history |
| **Sales** | Transaction history, date filtering, item-level returns with refund tracking |
| **Dashboard** | Today's sales, 30-day revenue trend chart, top products, category breakdown |
| **Customers / CRM** | Customer profiles, loyalty points, membership tiers (Bronze/Silver/Gold/Platinum) |
| **Suppliers** | Supplier directory with contact management |
| **Procurement** | Purchase orders with workflow (Pending → Approved → Received/Cancelled), auto stock update |
| **Expenses** | Expense tracking by category with approval |
| **Finance** | Revenue, expenses, net profit summary |
| **User Management** | Admin CRUD, role assignment (ADMIN/MANAGER/CASHIER), account activation/deactivation |
| **Audit Logs** | Complete audit trail for all system actions |
| **Cash Drawer** | Open/close drawer, variance tracking, drawer history |
| **Multi-Branch** | Branch CRUD, multi-location support, branch-scoped access control |
| **RBAC** | 4-tier access control: Super Admin, Branch Admin, Branch Manager, Branch Cashier |

---

## 🏗️ Architecture

```
rhosam-supermarket/
├── backend/                  # Express.js API server
│   ├── src/
│   │   ├── server.js         # Main API (46 endpoints)
│   │   ├── create-admin.js   # Admin user creation script
│   │   └── verify-password.js
│   ├── sql/
│   │   ├── schema.sql        # Complete database schema (12 tables)
│   │   └── seed.sql          # Sample product data
│   ├── test-all-endpoints.js # 46-endpoint test suite
│   ├── render.yaml           # Render deployment config
│   └── .env.example          # Environment variable template
│
├── frontend/                 # React + Vite SPA
│   ├── src/
│   │   ├── App.jsx           # All page components + routing
│   │   ├── AuthContext.jsx   # Auth state + API client
│   │   ├── App.css           # Complete styling
│   │   └── main.jsx          # Entry point
│   ├── server.js             # Production static file server
│   ├── render.yaml           # Render deployment config
│   └── vite.config.js
│
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **PostgreSQL** ≥ 14
- **npm** or **yarn**

### 1. Clone & Install

```bash
cd rhosam-supermarket

# Backend
cd backend
cp .env.example .env          # Edit with your database credentials
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Setup Database

```bash
# Create the database
createdb rhosam_db

# Run the schema
psql -d rhosam_db -f sql/schema.sql

# Apply RBAC documentation (recommended)
psql -d rhosam_db -f sql/migration-rbac-documentation.sql

# (Optional) Seed sample products
psql -d rhosam_db -f sql/seed.sql
```

### 3. Create Admin User

```bash
cd backend
npm run create-admin
# Follow the prompts to set name, email, and password
```

### 4. Start the Servers

```bash
# Terminal 1 — Backend (port 5000)
cd backend
npm run dev

# Terminal 2 — Frontend (port 5173)
cd frontend
npm run dev
```

### 5. Open the App

Navigate to **http://localhost:5173** and log in with your admin credentials.

---

## 🔐 Role-Based Access Control (RBAC)

The platform implements a **4-tier access control system** based on the combination of `role` and `branch_id` in the users table.

### Access Levels

| Access Level | Role | branch_id | Description |
|--------------|------|-----------|-------------|
| **🔑 Super Admin** | ADMIN | NULL | Full access to ALL branches. Can manage branches, users, payment settings, and system configuration. |
| **🏢 Branch Admin** | ADMIN | \<branch\> | Scoped to their assigned branch only. Can manage products, inventory, sales, and users within their branch. |
| **👔 Branch Manager** | MANAGER | \<branch\> | Scoped to their branch. Can manage products, inventory, and sales. Cannot manage users. |
| **🛒 Branch Cashier** | CASHIER | \<branch\> | POS only. Can process transactions and view their own sales. |

### Key Rules

1. **Branch Scoping**: ADMIN users with a `branch_id` are **branch-scoped** (not super-admins). They can only see and manage data for their assigned branch.

2. **Super Admin**: Only ADMIN users **without** a `branch_id` have full access across all branches.

3. **Product Management**: Branch Admins and Managers can create/edit products, but only Super Admins can delete them.

4. **User Management**: Branch Admins can manage users within their branch only. They cannot create other ADMIN users.

5. **System Settings**: Only Super Admins can manage branches, payment settings, terminals, alert rules, and database backups.

### Permissions Matrix

| Feature | Super Admin | Branch Admin | Branch Manager | Cashier |
|---------|:-----------:|:------------:|:--------------:|:-------:|
| Dashboard (all branches) | ✅ | ❌ | ❌ | ❌ |
| Dashboard (own branch) | ✅ | ✅ | ✅ | ✅ |
| Executive Overview | ✅ | ❌ | ❌ | ❌ |
| Point of Sale | ✅ | ✅ | ✅ | ✅ |
| Products (view/edit) | ✅ | ✅ | ✅ | ❌ |
| Products (delete) | ✅ | ❌ | ❌ | ❌ |
| Branch Inventory (own) | ✅ | ✅ | ✅ | ❌ |
| Branch Inventory (all) | ✅ | ❌ | ❌ | ❌ |
| Sales (own branch) | ✅ | ✅ | ✅ | own |
| Sales (all branches) | ✅ | ❌ | ❌ | ❌ |
| Users (own branch) | ✅ | ✅ | ❌ | ❌ |
| Users (all branches) | ✅ | ❌ | ❌ | ❌ |
| Branch Management | ✅ | ❌ | ❌ | ❌ |
| Payment Settings | ✅ | ❌ | ❌ | ❌ |
| Database Backup | ✅ | ❌ | ❌ | ❌ |
| Audit Logs (own branch) | ✅ | ✅ | ❌ | ❌ |
| Audit Logs (all branches) | ✅ | ❌ | ❌ | ❌ |
| Cash Drawer | ✅ | ✅ | ✅ | ✅ |
| Change Password | ✅ | ✅ | ✅ | ✅ |

### Managing User Access

```sql
-- View all users with their access level
SELECT * FROM v_user_access_levels;

-- Check a user's access level
SELECT get_user_access_level(5);

-- Promote a branch admin to super-admin
UPDATE users SET branch_id = NULL WHERE id = <user_id>;

-- Demote a super-admin to branch admin
UPDATE users SET branch_id = <branch_id> WHERE id = <user_id>;

-- See branches without an admin
SELECT * FROM v_branches_without_admin;
```

See `sql/migration-rbac-documentation.sql` for the complete RBAC documentation migration with views, functions, and helper queries.

---

## 🧪 Testing

The project includes comprehensive unit and integration tests:

```bash
cd backend
npm test
```

### Test Suites

| Suite | Tests | Coverage |
|-------|-------|----------|
| `dashboard.test.js` | 25 | Dashboard stats, top products, category sales, branch summary |
| `branch-scoping.test.js` | 39 | Branch-scoped access control for all endpoints |
| `integration-branch-admin-flow.test.js` | 45 | Full lifecycle: create user → login → verify scoping |

**Total: 109 tests** covering:
- Authentication and JWT token generation
- Role-based access control (RBAC) enforcement
- Branch-scoped data isolation
- Super-admin vs branch-admin permissions
- Cross-branch isolation verification
- CRUD operations with permission checks

### Manual Testing

```bash
# Run the 46-endpoint test suite (requires running server)
cd backend
node test-all-endpoints.js
```

---

## 🚢 Deployment (Render)

Both frontend and backend include `render.yaml` for one-click Render deployment:

1. Push this repo to GitHub
2. Connect to [Render](https://render.com)
3. Create a **Blueprint** and select this repo
4. Set the `DATABASE_URL` environment variable
5. Deploy!

The backend runs on port 5000, and the frontend on port 3001 in production.

---

## 📝 Environment Variables

See `backend/.env.example` for all required variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret for JWT token signing |
| `PORT` | ❌ | Server port (default: 5000) |
| `FRONTEND_URL` | ❌ | CORS origin (default: http://localhost:5173) |
| `MAX_LOGIN_ATTEMPTS` | ❌ | Lockout threshold (default: 5) |
| `LOCK_MINUTES` | ❌ | Lockout duration (default: 15) |

---

## 📊 Database Schema

### Tables (12)

- `users` — Authentication and role management with branch assignment
- `products` — Product catalog with pricing and stock
- `inventory_movements` — Stock change audit trail
- `sales` / `sale_items` — Transaction records
- `returns` — Item return tracking
- `customers` — CRM with loyalty program
- `suppliers` — Supplier directory
- `purchase_orders` / `purchase_order_items` — Procurement
- `expenses` — Business expense tracking
- `cash_drawer` — Cash register management with variance tracking
- `audit_logs` — System-wide activity logging
- `branches` — Multi-location support
- `branch_inventory` — Per-branch stock levels

### RBAC Views & Functions

- `get_user_access_level(user_id)` — Returns the effective access level
- `v_user_access_levels` — All users with access levels and permissions
- `v_permissions_matrix` — Complete permissions reference (51 features × 4 roles)
- `v_branch_user_summary` — User counts per branch
- `v_branches_without_admin` — Branches needing an admin assigned

---

## 🛠️ Tech Stack

- **Frontend:** React 19, React Router 7, Vite
- **Backend:** Express 5, PostgreSQL (pg), bcrypt, jsonwebtoken
- **Deployment:** Render (free tier compatible)

---

## 📄 License

This project is private and proprietary.
