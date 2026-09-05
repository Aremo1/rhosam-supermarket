# 🛍️ RHoSAM Supermarket POS

A full-stack supermarket Point of Sale (POS) platform built with **React** (Vite) and **Express.js** (PostgreSQL). Designed for Nigerian supermarkets with Naira (₦) currency support, role-based access control, and comprehensive business intelligence.

**Covers ~97% of Microsoft Store Commerce's feature set — at zero cost.**

---

## ✨ Features

### 🛒 Point of Sale (Store Commerce-style)
- **Touch-optimized full-screen POS** with dark theme, numpad, quick-tender buttons
- Barcode scanning (USB scanner + phone-as-scanner via SSE)
- Product grid with images, category filters, quick-add buttons
- Gift card redemption & coupon validation in checkout
- Price overrides (ADMIN/MANAGER only with reason logging)
- Sale returns & refunds
- Hold/recall carts (F2/F3 keyboard shortcuts)
- Receipt: print, email, SMS, PDF download

### 📦 Merchandising
- Product CRUD with barcode, categories, cost/selling price
- **Product variants** (size, color, custom options)
- **Product bundles / kits** with bundle pricing
- Product images with drag-and-drop upload
- Expiry date tracking with alerts & dashboard widget
- Batch number tracking
- Bulk import/export (CSV)

### 💳 Payments
- Cash, Card, Transfer, POS terminal
- **Paystack & Flutterwave** gateway integration
- **Paystack Terminal** API (commission, charge, status)
- **Digital wallets** (Apple Pay / Google Pay config)
- **Multi-currency** with live conversion rates
- Webhook verification (HMAC signatures)

### 📊 Inventory Management
- Stock levels with per-branch inventory
- Low stock alerts with configurable rules
- Stock adjustments with reason logging
- Stock transfers between branches (approval workflow)
- Inventory audit cycle (stock-taking with counting)
- Damages & wastage tracking
- Stock valuation with trend charts & snapshots
- AI-powered demand forecasting
- Auto-reorder suggestions

### 👥 Customer CRM
- Customer profiles with purchase history
- **Membership tiers** (Bronze → Silver → Gold → Platinum)
- **Loyalty points** (earn/redeem/adjust with tier system)
- **Customer groups** with group discounts
- Customer notes & activity timeline (clienteling)
- **Wish lists** per customer

### 📋 Operations
- **Gift cards** (issue, validate, redeem, transaction history)
- **Coupons** (% or ₦ discount with min purchase, validity, limits)
- **Quantity/threshold discounts** (6 types with auto-calculation)
- **Shift management** (open/close with variance tracking)
- **Task management** (assign, track, comments, due dates)
- **Sales commissions** (auto-commission on sales, rules per role)
- **Quotations** (create, convert to sale, validity tracking)
- **Layaway / deposits** (partial payments, due dates, fulfill to sale)
- **Label printing** (templates with barcode, price, product name)
- **Receipt templates** (configurable design with live preview)

### 🌐 Omnichannel
- **BOPIS** (Buy Online, Pick Up In Store)
- **Ship-to-Home** orders
- **Curbside pickup**
- **Endless Aisle** (order from another branch)
- Fulfillment workflow (pick/pack/ship)

### 🏗️ Platform
- **Multi-branch** with branch-scoped access control
- **4-tier RBAC** (Super Admin, Branch Admin, Manager, Cashier)
- MFA / 2FA with TOTP + backup codes + PDF
- Password expiry & forgot/reset flow
- Audit logs with IP & user-agent tracking
- In-app notifications with email/SMS
- Dark mode theme toggle
- **PWA** (Progressive Web App) with service worker
- **Capacitor** for native iOS & Android builds
- Offline mode with sync queue
- Customer display mode
- Wi-Fi QR code generator

### 📈 Analytics
- Real-time sales dashboard with charts
- Executive cross-branch overview
- Product performance & category breakdown
- Daily reports with PDF export
- Marketing segmentation & campaigns

---

## 🏗️ Architecture

```
rhosam-supermarket/
├── backend/                      # Express.js API server
│   ├── src/
│   │   ├── server.js             # Main API (100+ endpoints)
│   │   ├── store-commerce-routes.js  # Gift cards, coupons, shifts, tasks, etc.
│   │   ├── priority-gaps-routes.js   # Offline, variants, discounts, currency, etc.
│   │   ├── final-gaps-routes.js      # Layaway, loyalty, groups, marketing, labels, omnichannel
│   │   └── run-migrations.js     # Auto-run SQL on startup
│   ├── sql/
│   │   ├── schema.sql            # Base schema
│   │   ├── migration-store-commerce.sql
│   │   ├── migration-priority-gaps.sql
││   │   └── migration-final-gaps.sql
│   └── render.yaml
│
├── frontend/                     # React + Vite SPA
│   ├── src/
│   │   ├── App.jsx               # All page components + routing (9000+ lines)
│   │   ├── CashierPOS.jsx        # Store Commerce-style cashier POS
│   │   ├── AuthContext.jsx        # Auth state + API client
│   │   ├── ScannerPage.jsx        # Phone-as-barcode-scanner
│   │   └── App.css               # Complete styling
│   ├── android/                  # Capacitor Android project
│   ├── ios/                      # Capacitor iOS project
│   ├── capacitor.config.ts       # Capacitor configuration
│   └── vite.config.js
│
├── .github/workflows/
│   ├── build-android.yml         # CI: Build Android APK
│   └── build-ios.yml             # CI: Build iOS app
│
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **PostgreSQL** ≥ 14
- **npm**

### 1. Clone & Install

```bash
git clone https://github.com/Aremo1/rhosam-supermarket.git
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

# The migrations auto-run on server startup!
# But you can also run them manually:
psql -d rhosam_db -f backend/sql/schema.sql
psql -d rhosam_db -f backend/sql/migration-store-commerce.sql
psql -d rhosam_db -f backend/sql/migration-priority-gaps.sql
psql -d rhosam_db -f backend/sql/migration-final-gaps.sql
```

### 3. Create Admin User

```bash
cd backend
npm run create-admin
```

### 4. Start the Servers

```bash
# Terminal 1 — Backend (port 5000)
cd backend && npm run dev

# Terminal 2 — Frontend (port 5173)
cd frontend && npm run dev
```

### 5. Open the App

Navigate to **http://localhost:5173** and log in.

---

## 📱 Native Mobile App Build

RHoSAM uses **Capacitor** to build native iOS and Android apps from the same React codebase.

### Prerequisites

| Platform | Requirements |
|----------|-------------|
| **Android** | Java JDK 17+, Android SDK, Gradle |
| **iOS** | macOS, Xcode 15+, Apple Developer account |

### Build Android APK

```bash
cd frontend

# Build the web app
npm run build

# Sync to native project
npx cap sync android

# Open in Android Studio
npx cap open android

# Or build APK from command line:
cd android && ./gradlew assembleDebug
# APK output: android/app/build/outputs/apk/debug/app-debug.apk
```

### Build iOS App

```bash
cd frontend

# Build the web app
npm run build

# Sync to native project
npx cap sync ios

# Open in Xcode
npx cap open ios

# Or build from command line:
cd ios/App && xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -archivePath build/App.xcarchive archive
```

### GitHub Actions (Automatic Builds)

Push to `main` and the APK/IPA are built automatically:

1. Go to **Actions** tab in GitHub
2. Click **Build Android APK** or **Build iOS App**
3. Download the artifact from the workflow run

### Capacitor Plugins Installed

| Plugin | Purpose |
|--------|---------|
| `@capacitor/app` | App lifecycle events |
| `@capacitor/haptics` | Vibration feedback on scans |
| `@capacitor/keyboard` | Keyboard management |
| `@capacitor/status-bar` | Status bar styling |
| `@capacitor/splash-screen` | Launch screen |
| `@capacitor/push-notifications` | Push notifications |
| `@capacitor/camera` | Camera for barcode scanning |

### PWA (No Build Required)

RHoSAM also works as a Progressive Web App — installable from the browser:

1. Open in Chrome/Safari
2. Click "Install" or "Add to Home Screen"
3. Works offline with service worker caching

---

## 🔐 Role-Based Access Control (RBAC)

| Access Level | Role | branch_id | Description |
|--------------|------|-----------|-------------|
| **🔑 Super Admin** | ADMIN | NULL | Full access to ALL branches |
| **🏢 Branch Admin** | ADMIN | `<branch>` | Scoped to assigned branch |
| **👔 Branch Manager** | MANAGER | `<branch>` | Products, inventory, sales |
| **🛒 Branch Cashier** | CASHIER | `<branch>` | POS only |

---

## 🚢 Deployment (Render)

1. Push this repo to GitHub
2. Connect to [Render](https://render.com)
3. Create a **Blueprint** and select this repo
4. Set `DATABASE_URL` environment variable
5. Deploy!

Migrations auto-run on server startup. The backend runs on port 5000, frontend on port 3001 in production.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | JWT token signing secret |
| `PORT` | ❌ | Server port (default: 5000) |
| `FRONTEND_URL` | ❌ | CORS origin |
| `RESEND_API_KEY` | ❌ | Email receipts |
| `TELNYX_API_KEY` | ❌ | SMS receipts |
| `CLOUDINARY_*` | ❌ | Product image hosting |
| `PAYSTACK_SECRET_KEY` | ❌ | Paystack payments |
| `FLUTTERWAVE_SECRET_KEY` | ❌ | Flutterwave payments |

---

## 🧪 Testing

```bash
cd backend && npm test     # 109 unit/integration tests
node test-all-endpoints.js # 46-endpoint integration test
```

---

## 🛠️ Tech Stack

- **Frontend:** React 19, React Router 7, Vite, Capacitor
- **Backend:** Express 5, PostgreSQL, bcrypt, jsonwebtoken
- **Mobile:** Capacitor (iOS + Android)
- **Deployment:** Render (free tier compatible)
- **CI/CD:** GitHub Actions (Android APK + iOS build)

---

## 📊 Database

**30+ tables** across 4 migration files:
- Base schema: users, products, sales, customers, suppliers, expenses, etc.
- Store Commerce: gift_cards, coupons, shifts, tasks, commissions, bundles, quotations
- Priority Gaps: offline_sync, variants, discount_rules, currencies, wishlists, receipts, fulfillment
- Final Gaps: layaway, loyalty_points, customer_groups, marketing, labels, omnichannel

---

## 📄 License

This project is private and proprietary.
