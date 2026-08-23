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
| **Multi-Branch** | Branch CRUD, multi-location support |

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

## 🔐 Default Roles

| Role | Access |
|------|--------|
| **ADMIN** | Full access to all modules including user management, audit logs, and branches |
| **MANAGER** | POS, products, inventory, sales, customers, suppliers, procurement, expenses, finance, cash drawer |
| **CASHIER** | POS, cash drawer, sales history, dashboard |

---

## 🧪 API Testing

The project includes a comprehensive test suite covering all 46 endpoints:

```bash
# Start the backend first, then:
cd backend
node test-all-endpoints.js
```

This tests authentication, CRUD operations, RBAC enforcement, and business logic.

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

The schema covers 12 tables:

- `users` — Authentication and role management
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

---

## 🛠️ Tech Stack

- **Frontend:** React 19, React Router 7, Vite
- **Backend:** Express 5, PostgreSQL (pg), bcrypt, jsonwebtoken
- **Deployment:** Render (free tier compatible)

---

## 📄 License

This project is private and proprietary.
