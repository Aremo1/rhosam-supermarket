# 🛍️ RHoSAM Supermarket POS — Deployment Guide

How to set up and run the system on any PC or deploy to the cloud.

---

## Option 1: Local Development (Recommended for Testing)

### Prerequisites

| Software | Version | Download |
|----------|---------|----------|
| **Node.js** | 18+ | https://nodejs.org |
| **PostgreSQL** | 14+ | https://postgresql.org |
| **Git** | Any | https://git-scm.com |

### Step 1: Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/RHOSAM-SUPERMARKET.git
cd RHOSAM-SUPERMARKET
```

### Step 2: Setup Database

```bash
# Create the database
createdb rhosam_supermarket

# Apply the schema
psql -d rhosam_supermarket -f backend/sql/schema.sql

# (Optional) Seed sample products
psql -d rhosam_supermarket -f backend/sql/seed.sql

# Apply migrations for latest features
psql -d rhosam_supermarket -f backend/sql/migration-product-expiry.sql
psql -d rhosam_supermarket -f backend/sql/migration-branch-scoping.sql
psql -d rhosam_supermarket -f backend/sql/migration-branch-inventory.sql
psql -d rhosam_supermarket -f backend/sql/migration-branch-comm.sql
psql -d rhosam_supermarket -f backend/sql/migration-valuation-snapshots.sql
psql -d rhosam_supermarket -f backend/sql/migration-inventory-audit.sql
psql -d rhosam_supermarket -f backend/sql/migration-notifications.sql
psql -d rhosam_supermarket -f backend/sql/migration-stock-alerts.sql
psql -d rhosam_supermarket -f backend/sql/migration-payment-and-audit.sql
psql -d rhosam_supermarket -f backend/sql/migration-map-sales-to-head-office.sql
```

### Step 3: Configure Environment Variables

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` with your values:

```env
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/rhosam_supermarket
JWT_SECRET=your-random-secret-key-here-make-it-long
PORT=5000
FRONTEND_URL=http://localhost:5173
```

### Step 4: Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### Step 5: Create Admin User

```bash
cd backend
ADMIN_EMAIL=admin@rhosam.com \
ADMIN_PASSWORD=YourSecure@Pass123 \
ADMIN_NAME="Your Name" \
node src/create-admin.js
```

### Step 6: Start the Servers

```bash
# Terminal 1 — Backend (port 5000)
cd backend
npm run dev

# Terminal 2 — Frontend (port 5173)
cd frontend
npm run dev
```

### Step 7: Open the App

Open **http://localhost:5173** in your browser.

Log in with the admin credentials you created.

---

## Option 2: Docker (One Command — Recommended for Production)

### Prerequisites

- [Docker](https://docker.com) installed (includes Docker Compose)

### Quick Start

```bash
cd RHOSAM-SUPERMARKET

# Build and start everything (PostgreSQL + Backend + Frontend)
docker-compose up -d

# Check all services are running
docker-compose ps

# View logs
docker-compose logs -f
```

The app will be available at:
- **Frontend:** http://localhost:3001
- **Backend API:** http://localhost:5000/api

### Create Admin User (First Time Only)

```bash
docker-compose exec backend node src/create-admin.js
```

Follow the prompts to set name, email, and password.

### Common Docker Commands

```bash
# Stop all services
docker-compose down

# Stop and remove all data (fresh start)
docker-compose down -v

# Rebuild after code changes
docker-compose up -d --build

# View backend logs
docker-compose logs -f backend

# Open a shell in the backend container
docker-compose exec backend sh

# Connect to the database
docker-compose exec db psql -U rhosam -d rhosam_supermarket
```

---

## Option 3: Render (Free Tier Cloud Deployment)

### Step 1: Push to GitHub

```bash
git add .
git commit -m "Deploy RHoSAM"
git push origin main
```

### Step 2: Create Blueprint on Render

1. Go to [render.com](https://render.com) and sign up
2. Click **"New"** → **"Blueprint"**
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` and creates:
   - `rhosam-backend` (Node.js web service)
   - `rhosam-frontend` (Node.js web service)
   - `rhosam-db` (PostgreSQL database)

### Step 3: Set Environment Variables

On the Render dashboard:
- `DATABASE_URL` — auto-set from the database (verify it's linked)
- `JWT_SECRET` — click **"Generate"** for a random value
- `FRONTEND_URL` — set to `*` (allows all origins)

Optional (for email/images):
- `RESEND_API_KEY` — from [resend.com](https://resend.com/api-keys)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — from [cloudinary.com](https://cloudinary.com/console)

### Step 4: Deploy

Click **"Create Blueprint"** and wait 2–3 minutes for the build to complete.

### Step 5: Create Admin User

Open the **Render Shell** on the backend service:

```bash
ADMIN_EMAIL=admin@yourdomain.com \
ADMIN_PASSWORD=YourSecure@Pass123 \
ADMIN_NAME="Admin" \
node src/create-admin.js
```

### Step 6: Open Your App

Navigate to your Render URL (e.g., `https://rhosam-frontend.onrender.com`).

---

## Option 4: Vercel + Supabase (Alternative Cloud)

### Backend → Supabase:
1. Create a project at https://supabase.com
2. Run all SQL files in the SQL Editor (schema + migrations)
3. Copy the PostgreSQL connection string

### Frontend → Vercel:
1. Connect GitHub repo at https://vercel.com
2. Set environment variable `VITE_API_URL` to your backend URL
3. Deploy

---

## Network Access (Multiple PCs on Same Network)

To share the app across devices on the same LAN:

1. Find your PC's IP address:
   ```bash
   # Linux/Mac
   ifconfig | grep "inet "

   # Windows
   ipconfig
   ```

2. Update `FRONTEND_URL` in `backend/.env`:
   ```env
   FRONTEND_URL=http://YOUR_IP:5173
   ```

3. Start both servers and access from any device at `http://YOUR_IP:5173`.

---

## Quick Reference: Useful Commands

### Backend
```bash
cd backend
npm run dev            # Start development server
npm run create-admin   # Create admin user
node -c src/server.js  # Check syntax
```

### Frontend
```bash
cd frontend
npm run dev            # Start development server
npm run build          # Build for production
npm run preview        # Preview production build
```

### Database
```bash
psql -d rhosam_supermarket              # Connect
psql -d rhosam_supermarket -f backend/sql/schema.sql  # Re-apply schema
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | — | Secret for JWT signing (min 32 chars) |
| `PORT` | ❌ | 5000 | Backend server port |
| `FRONTEND_URL` | ❌ | http://localhost:5173 | CORS origin |
| `MAX_LOGIN_ATTEMPTS` | ❌ | 5 | Lockout after N failures |
| `LOCK_MINUTES` | ❌ | 15 | Lockout duration |
| `RESEND_API_KEY` | ❌ | — | Email notifications (resend.com) |
| `TELNYX_API_KEY` | ❌ | — | SMS notifications (telnyx.com) |
| `CLOUDINARY_*` | ❌ | — | Product image storage (cloudinary.com) |
| `PAYMENT_GATEWAY` | ❌ | INTERNAL | Payment gateway: PAYSTACK, FLUTTERWAVE, or INTERNAL (cash-only) |
| `PAYSTACK_SECRET_KEY` | ❌ | — | Paystack secret key for payment verification |
| `PAYSTACK_PUBLIC_KEY` | ❌ | — | Paystack public key (for frontend initialization) |
| `FLUTTERWAVE_SECRET_KEY` | ❌ | — | Flutterwave secret key for payment verification |
| `FLUTTERWAVE_PUBLIC_KEY` | ❌ | — | Flutterwave public key (for frontend initialization) |
| `PAYMENT_WEBHOOK_SECRET` | ❌ | — | Webhook secret for verifying gateway callbacks |
| `VITE_API_URL` | ❌ | http://localhost:5000/api | Backend API URL (frontend only) |

---

## Payment Gateway Setup (Paystack / Flutterwave)

RHoSAM supports **Paystack** and **Flutterwave** for electronic payments (Card, Transfer, POS).

### Paystack Setup

1. Create an account at [paystack.com](https://paystack.com)
2. Go to **Settings → API Keys** and copy your keys
3. Add to `backend/.env`:
   ```env
   PAYMENT_GATEWAY=PAYSTACK
   PAYSTACK_SECRET_KEY=sk_test_xxxxxxxx
   PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxx
   PAYMENT_WEBHOOK_SECRET=your_webhook_secret
   ```
4. In Paystack Dashboard, add webhook URL: `https://your-domain.com/api/webhooks/paystack`
5. Events to subscribe to: `charge.success`

### Flutterwave Setup

1. Create an account at [flutterwave.com](https://flutterwave.com)
2. Go to **Settings → API Keys** and copy your keys
3. Add to `backend/.env`:
   ```env
   PAYMENT_GATEWAY=FLUTTERWAVE
   FLUTTERWAVE_SECRET_KEY=FLWSECK-xxxxxxxx
   FLUTTERWAVE_PUBLIC_KEY=FLWPUBK-xxxxxxxx
   PAYMENT_WEBHOOK_SECRET=your_webhook_secret
   ```
4. In Flutterwave Dashboard, add webhook URL: `https://your-domain.com/api/webhooks/flutterwave`
5. Events to subscribe to: `charge.completed`

### How It Works

1. **Cashier selects payment method** (Card/Transfer/POS) at the POS terminal
2. **Sale is created** in the system first (stock deducted immediately)
3. **Payment is initialized** with the configured gateway — a payment link is generated
4. **Customer pays** via the gateway (card terminal, bank transfer, etc.)
5. **Cashier enters the payment reference** and clicks Verify
6. **Backend verifies** the transaction with the gateway API (amount must match)
7. **Webhook confirms** the payment asynchronously as a backup

For **Cash** payments, no gateway is needed — the sale is verified immediately.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "DATABASE_URL is missing" | Ensure `backend/.env` has the correct `DATABASE_URL` |
| "relation does not exist" | Run `psql -d rhosam_supermarket -f backend/sql/schema.sql` |
| "column does not exist" | Run the migration SQL files from `backend/sql/` |
| "ECONNREFUSED" | Make sure PostgreSQL is running |
| Frontend "Failed to fetch" | Check `VITE_API_URL` matches your backend URL |
| Docker port conflict | Change ports in `docker-compose.yml` |
| Render deploy fails | Check build logs; ensure `DATABASE_URL` is linked |

---

## Mobile Access (PWA)

The app is a **Progressive Web App**. To install on mobile:
1. Open the app URL in Chrome/Safari
2. Tap **"Add to Home Screen"** or **"Install App"**
3. Works offline with cached data

---

*Last updated: August 2026 — RHoSAM Supermarket POS v1.0*
