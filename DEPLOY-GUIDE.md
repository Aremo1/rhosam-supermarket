# 🛍️ RHoSAM Supermarket POS — Deployment Guide

How to set up and run the system on any PC.

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

# (Optional) Apply migrations for latest features
psql -d rhosam_supermarket -f backend/sql/migration-payment-and-audit.sql
psql -d rhosam_supermarket -f backend/sql/migration-auth-features.sql
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

## Option 2: Cloud Deployment (Production)

### Render (Free Tier)

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Initial deploy"
   git push origin main
   ```

2. **Go to [render.com](https://render.com)** and sign up

3. **Create Blueprint:**
   - Click "New" → "Blueprint"
   - Connect your GitHub repo
   - Select the `RHOSAM-SUPERMARKET` folder
   - Render auto-detects `render.yaml` and creates:
     - `rhosam-backend` (Node.js web service)
     - `rhosam-frontend` (Node.js web service)
     - `rhosam-db` (PostgreSQL database)

4. **Set Environment Variables:**
   - `DATABASE_URL` — auto-set from the database
   - `JWT_SECRET` — click "Generate"
   - `FRONTEND_URL` — set to `*` (allows all origins)

5. **Deploy:**
   - Click "Create Blueprint"
   - Wait 2-3 minutes for build to complete

6. **Create Admin User:**
   ```bash
   # SSH into the backend service or use Render Shell
   ADMIN_EMAIL=admin@yourdomain.com \
   ADMIN_PASSWORD=YourSecure@Pass123 \
   ADMIN_NAME="Admin" \
   node src/create-admin.js
   ```

7. **Open your app** at the Render URL (e.g., `https://rhosam-frontend.onrender.com`)

### Vercel + Supabase (Alternative)

**Backend → Supabase:**
1. Create a Supabase project at https://supabase.com
2. Run the schema in the SQL Editor
3. Copy the connection string

**Frontend → Vercel:**
1. Connect GitHub repo at https://vercel.com
2. Set `VITE_API_URL` to your backend URL
3. Deploy

---

## Option 3: Docker (One Command)

### Prerequisites

- [Docker](https://docker.com) installed

### Quick Start

```bash
cd RHOSAM-SUPERMARKET

# Build and start everything
docker-compose up -d

# Create admin user
docker-compose exec backend node src/create-admin.js
```

### Docker Compose File

Create `docker-compose.yml` in the project root:

```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: rhosam
      POSTGRES_PASSWORD: rhosam_secret
      POSTGRES_DB: rhosam_supermarket
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./backend/sql/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql

  backend:
    build: ./backend
    ports:
      - "5000:5000"
    environment:
      DATABASE_URL: postgresql://rhosam:rhosam_secret@db:5432/rhosam_supermarket
      JWT_SECRET: change-this-to-a-random-string
      FRONTEND_URL: http://localhost:5173
      PORT: 5000
    depends_on:
      - db

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    environment:
      VITE_API_URL: http://localhost:5000/api

volumes:
  pgdata:
```

Create `backend/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 5000
CMD ["node", "src/server.js"]
```

Create `frontend/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm install -g serve
EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
```

---

## Quick Reference: Useful Commands

### Backend

```bash
cd backend

# Start development server
npm run dev

# Create admin user
npm run create-admin

# Run all tests
node test-sit.js     # System Integration Tests (34 tests)
node test-uat.js     # User Acceptance Tests (55 tests)
node test-all-endpoints.js  # Endpoint tests (70+ tests)

# Check syntax
node -c src/server.js
```

### Frontend

```bash
cd frontend

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Database

```bash
# Connect to database
psql -d rhosam_supermarket

# Re-apply schema (safe — uses IF NOT EXISTS)
psql -d rhosam_supermarket -f backend/sql/schema.sql

# Apply migrations
psql -d rhosam_supermarket -f backend/sql/migration-payment-and-audit.sql
psql -d rhosam_supermarket -f backend/sql/migration-auth-features.sql
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
| `RESEND_API_KEY` | ❌ | — | Email sending (get from resend.com) |
| `CLOUDINARY_CLOUD_NAME` | ❌ | — | Image storage (get from cloudinary.com) |
| `CLOUDINARY_API_KEY` | ❌ | — | Image storage |
| `CLOUDINARY_API_SECRET` | ❌ | — | Image storage |
| `VITE_API_URL` | ❌ | http://localhost:5000/api | Backend API URL (frontend only) |

---

## Troubleshooting

### "DATABASE_URL is missing"
→ Make sure `backend/.env` exists and has the correct `DATABASE_URL`

### "relation does not exist"
→ Run the schema: `psql -d rhosam_supermarket -f backend/sql/schema.sql`

### "column does not exist"
→ Run the migrations:
```bash
psql -d rhosam_supermarket -f backend/sql/migration-payment-and-audit.sql
psql -d rhosam_supermarket -f backend/sql/migration-auth-features.sql
```

### "ECONNREFUSED" or "Connection refused"
→ Make sure PostgreSQL is running:
```bash
# Linux/Mac
sudo service postgresql start

# Windows
net start postgresql-x64-16

# Docker
docker start rhosam-db
```

### Frontend shows "Failed to fetch"
→ Make sure the backend is running on port 5000
→ Check that `VITE_API_URL` matches your backend URL

### Port already in use
```bash
# Find what's using port 5000
lsof -i :5000        # Linux/Mac
netstat -ano | findstr :5000  # Windows

# Kill the process
kill -9 <PID>
```

---

## Mobile Access

The app is a **Progressive Web App (PWA)**. To install on mobile:

1. Open the app URL in Chrome/Safari on your phone
2. Tap **"Add to Home Screen"** or **"Install App"**
3. The app appears as a native-like icon on your home screen
4. Works offline with cached data

---

## Network Access (Multiple PCs)

To share the app across devices on the same network:

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

3. Start both servers:
   ```bash
   cd backend && npm run dev
   cd frontend && npm run dev
   ```

4. Other devices can access at: `http://YOUR_IP:5173`

---

*Last updated: August 2026 — RHoSAM Supermarket POS v1.0*
