# 🛍️ RHoSAM Supermarket POS — Full Menu & Operation Guide

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard](#dashboard)
3. [Executive Dashboard](#executive-dashboard)
4. [Point of Sale (POS)](#point-of-sale-pos)
5. [Products](#products)
6. [Inventory](#inventory)
7. [Sales History](#sales-history)
8. [Customers](#customers)
9. [Suppliers](#suppliers)
10. [Purchase Orders (Procurement)](#purchase-orders-procurement)
11. [Expenses](#expenses)
12. [Finance](#finance)
13. [AI Forecast](#ai-forecast)
14. [Auto Reorder](#auto-reorder)
15. [Reports](#reports)
16. [Cash Drawer](#cash-drawer)
17. [Branches](#branches)
18. [Customer Display](#customer-display)
19. [Supplier Portal](#supplier-portal)
20. [User Management](#user-management)
21. [Audit Logs](#audit-logs)
22. [Login History](#login-history)
23. [Change Password](#change-password)
24. [MFA / Security](#mfa--security)
25. [Wi-Fi QR Generator](#wi-fi-qr-generator)
26. [Roles & Permissions](#roles--permissions)
27. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Getting Started

### First-Time Setup

1. **Deploy** the app using Render Blueprint (`render.yaml`) or run locally
2. **Create an admin user:**
   ```bash
   cd backend
   ADMIN_EMAIL=admin@rhosam.com ADMIN_PASSWORD=YourSecure@Pass123 node src/create-admin.js
   ```
3. **Open the app** at your URL (e.g., `https://rhosam-frontend.onrender.com`)
4. **Log in** with your admin credentials

### Login Screen

- Enter your **email** and **password**
- Click **Sign In**
- If you forget your password, click **Forgot password?** to receive a reset link via email

---

## Dashboard

**📍 Sidebar: 📊 Dashboard | Roles: ALL**

The main overview screen showing real-time business metrics.

### What You See

| Card | Description |
|------|-------------|
| **Today's Sales** | Number of transactions today + revenue in ₦ |
| **Total Revenue** | All-time revenue across all sales |
| **Products** | Total active products in the system |
| **Low Stock** | Products at or below reorder level (orange warning) |
| **Total Transactions** | All-time number of sales |
| **Active Users** | Staff accounts currently active |

### Charts

- **Sales Trend (Last 30 Days)** — Bar chart showing daily revenue. Hover over bars for details
- **Top Products (30 Days)** — Table of best-selling products by revenue
- **Sales by Category** — Horizontal bar chart showing revenue per category

---

## Executive Dashboard

**📍 Sidebar: 🎯 Executive | Roles: ADMIN only**

High-level business intelligence for decision makers.

### Sections

| Section | What It Shows |
|---------|---------------|
| **Revenue** | Total, weekly, monthly revenue + transaction count + average sale |
| **Expenses** | Total and monthly expenses |
| **Profit** | Total and monthly net profit (green = positive, red = negative) |
| **Products** | Total count, low stock count, out of stock count |
| **Sales Trend** | 30-day revenue chart |
| **Top Cashiers** | Cashier performance ranking |
| **Revenue by Category** | Category breakdown with bar chart |
| **Stock Alerts** | Products needing immediate restock |

---

## Point of Sale (POS)

**📍 Sidebar: 🛒 Point of Sale | Roles: ALL**

The main screen for processing customer purchases.

### Layout

The POS has two panels:
- **Left panel** — Product grid with search
- **Right panel** — Cart and checkout

### Adding Products to Cart

**Method 1: Click**
- Click any product card to add 1 unit to the cart

**Method 2: Barcode Scanner**
- Point your barcode scanner at the search box
- Scan a barcode — product is auto-added with a ✓ toast and beep sound
- Or type a barcode/name and press **Enter**

**Method 3: Search**
- Type in the search box to filter products by name, barcode, or category
- If only one result matches, pressing **Enter** adds it

### Managing the Cart

| Action | How |
|--------|-----|
| **Increase quantity** | Click the **+** button (caps at available stock) |
| **Decrease quantity** | Click the **−** button (removes at 0) |
| **Remove item** | Click **−** when quantity is 1 |
| **Select customer** | Choose from the dropdown or type a name |

### Checkout Process

1. **Verify items** in the cart
2. **Select payment method:** Cash, Card, Transfer, or POS
3. **Enter discount** (optional) — amount in ₦
4. **Enter tax** (optional) — amount in ₦
5. **Enter amount paid** — for cash payments, enter the amount received
6. **Check change** — automatically calculated
7. Click **💳 Checkout**

### After Sale

The receipt screen shows:
- **Receipt number** (e.g., RHS-1234567890-123)
- **All items** with quantities and line totals
- **Subtotal, discount, tax, total**
- **Amount paid and change**

**Actions available:**
- 📄 **Download PDF** — saves receipt as PDF
- 🖨️ **Print** — prints the receipt
- 📧 **Email** — enter customer email to send receipt
- 🛒 **New Sale** — return to POS for next customer

### Stock Limit Warning

If you try to increase quantity beyond available stock, you'll see:
> "Maximum stock for [Product Name] is [X]"

---

## Products

**📍 Sidebar: 📦 Products | Roles: ADMIN, MANAGER**

Manage your product catalog.

### Viewing Products

The product table shows:
| Column | Description |
|--------|-------------|
| Image | Product photo (if uploaded) |
| Barcode | Unique barcode identifier |
| Name | Product name |
| Category | Product category |
| Price | Selling price in ₦ |
| Cost | Cost price in ₦ |
| Stock | Current stock quantity |
| Reorder Level | Minimum stock before alert |
| Unit | PCS, KG, LTR, BOX, CARTON, BAG |
| Status | Active/Inactive badge |

### Searching

Type in the search box to filter by name, barcode, or category.

### Creating a Product

1. Click **+ Add Product**
2. Fill in the form:
   - **Barcode** (required, must be unique)
   - **Name** (required)
   - **Category** (required)
   - **Price** (selling price, required)
   - **Cost Price** (your purchase price)
   - **Stock** (initial stock quantity)
   - **Reorder Level** (alert threshold, default 5)
   - **Unit** (PCS, KG, LTR, BOX, CARTON, BAG)
   - **Description** (optional)
   - **Image** (click to upload, max 5MB, jpg/png/gif/webp)
3. Click **Create**

### Editing a Product

1. Click **Edit** on the product row
2. Modify fields as needed
3. Click **Update**

### Deleting a Product

1. Click **Delete** on the product row
2. Confirm the deletion
3. Product is permanently removed

### Uploading Product Images

- Click the image area in the edit form
- Select an image file (jpg, png, gif, webp)
- Image is uploaded to Cloudinary (if configured) or local storage
- Preview appears immediately

---

## Inventory

**📍 Sidebar: 📋 Inventory | Roles: ALL**

Monitor stock levels and manage inventory movements.

### Tabs

| Tab | Description |
|-----|-------------|
| **Stock Levels** | All products with current stock and status |
| **Low Stock** | Products at or below reorder level |
| **Movements** | Complete history of all stock changes |

### Stock Levels Tab

Shows every product with:
- Current stock
- Reorder level
- Status badge (✓ OK or ⚠ Low)
- **Adjust** button for manual stock changes

### Adjusting Stock

1. Click **Adjust** on a product row
2. Select movement type:
   - **Stock In (Add)** — receiving goods, restocking
   - **Stock Out (Remove)** — damage, waste, manual reduction
   - **Adjustment (Add)** — correcting count
3. Enter quantity
4. Add notes (optional)
5. Click **Adjust**

### Low Stock Tab

Lists all products where `stock ≤ reorder_level`, sorted by lowest stock first. Use this to know what needs ordering.

### Movements Tab

Complete audit trail of all stock changes:
- **Date** — when the change happened
- **Product** — which product was affected
- **Type** — SALE, PURCHASE, RETURN, STOCK_IN, STOCK_OUT, ADJUSTMENT
- **Qty** — positive (added) or negative (removed)
- **Reference** — receipt number or adjustment ID
- **User** — who made the change

---

## Sales History

**📍 Sidebar: 💰 Sales History | Roles: ALL (cashiers see only their own sales)**

View and manage past sales transactions.

### Filtering

Use the **From** and **To** date pickers to filter sales by date range.

### Sales Table

| Column | Description |
|--------|-------------|
| Receipt | Unique receipt number (e.g., RHS-...) |
| Date | When the sale was made |
| Customer | Customer name or "Walk-in Customer" |
| Cashier | Staff member who processed the sale |
| Items | Number of items sold |
| Payment | Cash, Card, Transfer, or POS |
| Total | Sale total in ₦ |

### Viewing Sale Details

1. Click **View** on any sale row
2. The detail modal shows:
   - Full receipt info (date, customer, cashier, payment)
   - Itemized list with prices, quantities, discounts
   - Subtotal, discount, tax, total
   - **📄 Download PDF** — save receipt
   - **🖨️ Print** — print receipt

### Processing Returns

1. Open sale detail
2. Click **Return** on an item row
3. Enter the quantity to return
4. Enter a reason
5. Stock is restored and refund is recorded

---

## Customers

**📍 Sidebar: 👥 Customers | Roles: ALL**

Manage your customer database and loyalty program.

### Customer Table

| Column | Description |
|--------|-------------|
| Name | Customer name |
| Email | Contact email |
| Phone | Contact phone |
| Points | Loyalty points earned (1 point per ₦100 spent) |
| Tier | BRONZE, SILVER, GOLD, or PLATINUM |
| Total Spent | Lifetime spend in ₦ |
| Visits | Number of transactions |

### Membership Tiers

| Tier | Total Spend Required |
|------|---------------------|
| 🥉 BRONZE | ₦0+ |
| 🥈 SILVER | ₦50,000+ |
| 🥇 GOLD | ₦200,000+ |
| 💎 PLATINUM | ₦500,000+ |

Tiers are automatically calculated based on total spending.

### Adding a Customer

1. Click **+ Add Customer**
2. Enter name (required), email, phone
3. Click **Create**

### Linking Customers to Sales

In the POS, select a customer from the dropdown. Their loyalty points and tier update automatically after the sale.

---

## Suppliers

**📍 Sidebar: 🏭 Suppliers | Roles: ALL (create/edit: ADMIN, MANAGER)**

Manage your supplier directory.

### Supplier Table

| Column | Description |
|--------|-------------|
| Name | Company name |
| Contact | Contact person |
| Email | Supplier email |
| Phone | Supplier phone |
| Address | Physical address |
| Status | Active/Inactive |

### Actions

- **+ Add Supplier** — create new supplier
- **Edit** — modify supplier details
- **Delete** — remove supplier (admin only)

---

## Purchase Orders (Procurement)

**📍 Sidebar: 📥 Purchase Orders | Roles: ALL (create: ADMIN, MANAGER)**

Create and manage purchase orders to suppliers.

### Creating a Purchase Order

1. Click **+ New Purchase Order**
2. Select a **Supplier**
3. Add **Expected Date** (optional)
4. Add **Notes** (optional)
5. Add items:
   - Select product from dropdown
   - Enter quantity
   - Enter unit cost
   - Click **+ Add Item** for more products
6. Click **Create PO**

### PO Workflow

```
PENDING → APPROVED → RECEIVED
PENDING → CANCELLED
APPROVED → CANCELLED
```

| Status | Action | What Happens |
|--------|--------|--------------|
| PENDING | **Approve** | PO moves to approved state |
| APPROVED | **Receive** | Stock is automatically added to products |
| Any active | **Cancel** | PO is cancelled |

### Receiving Goods

When you click **Receive**:
1. Stock for each item is automatically increased
2. Inventory movements are recorded
3. PO status changes to RECEIVED
4. This action cannot be undone

---

## Expenses

**📍 Sidebar: 💸 Expenses | Roles: ALL (create: ADMIN, MANAGER)**

Track business expenses.

### Creating an Expense

1. Click **+ Add Expense**
2. Fill in:
   - **Category** (e.g., Rent, Utilities, Supplies, Transport)
   - **Description** (details of the expense)
   - **Amount** (in ₦)
   - **Payment Method** (Cash, Card, Transfer)
   - **Reference** (invoice number, etc.)
3. Click **Add Expense**

### Expense History

All expenses are listed with date, category, description, amount, payment method, and who approved it.

---

## Finance

**📍 Sidebar: 🏦 Finance | Roles: ALL (full view: ADMIN, MANAGER)**

Financial overview and profit/loss summary.

### Summary Cards

| Card | Description |
|------|-------------|
| **Total Revenue** | All-time sales revenue |
| **Total Expenses** | All-time expenses |
| **Net Profit** | Revenue minus expenses |
| **Today's Revenue** | Today's sales revenue |

### Profit & Loss Table

| Line | Description |
|------|-------------|
| Revenue | Total sales income |
| Expenses | Total business expenses |
| **Net Profit** | Revenue - Expenses |

Green = profitable, Red = loss.

---

## AI Forecast

**📍 Sidebar: 🤖 AI Forecast | Roles: ADMIN, MANAGER**

Predictive analytics for demand planning.

### How It Works

The system analyzes 90 days of sales data to predict:
- **Average daily sales** per product
- **7-day prediction** — expected sales next week
- **30-day prediction** — expected sales next month
- **Days until stockout** — how long current stock will last
- **Risk level** — CRITICAL, HIGH, MEDIUM, LOW

### Risk Levels

| Risk | Days Until Stockout | Action |
|------|-------------------|--------|
| 🔴 CRITICAL | 0-3 days | Order immediately |
| 🟠 HIGH | 4-7 days | Order this week |
| 🟡 MEDIUM | 8-14 days | Plan order soon |
| 🟢 LOW | 15+ days | No urgent action |

### Filtering

Use the tabs to filter by risk level: All, Critical, High, Medium.

---

## Auto Reorder

**📍 Sidebar: 🔄 Auto Reorder | Roles: ADMIN, MANAGER**

Automated purchase order generation for low-stock items.

### How It Works

1. System identifies products where `stock ≤ reorder_level`
2. Suggests reorder quantity: `max(reorder_level × 3, 20)`
3. Calculates total cost based on cost price
4. You select which items to reorder
5. Click **Create Purchase Orders** to generate POs grouped by supplier

### Steps

1. Review the suggested items
2. **Check the boxes** for items you want to order
3. Review the **total cost** in the summary cards
4. Click **Create Purchase Orders**
5. POs are created automatically (one per supplier)
6. Go to **Purchase Orders** to approve and track them

---

## Reports

**📍 Sidebar: 📈 Reports | Roles: ADMIN, MANAGER**

Comprehensive reporting with 5 report types.

### Report Tabs

#### 1. Daily Sales Report
- Select a **date**
- Shows: transactions, revenue, expenses, net profit, discounts, tax
- **Items Sold** — detailed list of products sold that day
- **Email Report** — send formatted report to any email address

#### 2. Monthly Sales Report
- Select a **year**
- Shows: 12-month breakdown with transactions, revenue, discounts, tax
- Summary cards with totals and averages

#### 3. Product Sales Report
- Set **date range** (From/To)
- Shows: products sold, categories, quantities, revenue, remaining stock
- Sorted by revenue (highest first)

#### 4. Low Stock Report
- Shows all products below reorder level
- Status: OUT OF STOCK or LOW
- Stock, reorder level, price, cost price

#### 5. Cashier Sales Report
- Set **date range** (From/To)
- Shows: cashier performance with transactions, revenue, average sale
- Ranked by revenue

### Emailing Reports

On the Daily Sales tab:
1. Enter recipient email address
2. Click **Send Report**
3. Formatted HTML email is sent with summary + items table

---

## Cash Drawer

**📍 Sidebar: 💵 Cash Drawer | Roles: ALL (close: ADMIN, MANAGER)**

Manage cash register sessions.

### Opening the Drawer

1. Click **💵 Open Drawer**
2. Enter **Drawer Name** (e.g., "Main Drawer")
3. Enter **Opening Balance** (cash count at start of shift)
4. Click **Open Drawer**

### While the Drawer is Open

The summary shows:
- Status: 🟢 OPEN
- Opening balance
- Who opened it
- When it was opened

### Closing the Drawer

1. Click **🔒 Close Drawer**
2. Enter **Closing Balance** (actual cash count)
3. System calculates:
   - **Expected Balance** = Opening balance + sales revenue
   - **Variance** = Closing balance - Expected balance
4. Click **Close Drawer**

### Variance

| Variance | Meaning |
|----------|---------|
| ₦0 | Perfect — no discrepancy |
| Positive | Extra cash found (overage) |
| Negative | Cash missing (shortage) |

### Drawer History

Complete log of all drawer sessions showing:
- Open/close times
- Opening and closing balances
- Expected balance and variance
- Who opened and closed

---

## Branches

**📍 Sidebar: 🏢 Branches | Roles: ADMIN only**

Manage multiple store locations.

### Branch Table

| Column | Description |
|--------|-------------|
| Name | Branch name |
| Address | Physical address |
| Phone | Branch phone number |
| Status | Active/Inactive |
| Created | When the branch was added |

### Actions

- **+ Add Branch** — create new branch
- **Edit** — modify branch details
- **Delete** — remove branch

---

## Customer Display

**📍 Sidebar: 🖥️ Customer Display | Roles: ALL**

Show sale details on a customer-facing screen.

### How to Use

1. Enter the **Sale Receipt ID**
2. Click **Display Sale**
3. The receipt is shown in a clean, large format suitable for a second monitor or TV

---

## Supplier Portal

**📍 Sidebar: 🏭 Supplier Portal | Roles: ADMIN only**

View purchase orders from each supplier's perspective.

### How to Use

1. Click a **supplier tab** to see their orders
2. Click **View** on any order to see details
3. Click **Confirm** to acknowledge a pending order (supplier side)

---

## User Management

**📍 Sidebar: 👤 User Management | Roles: ADMIN only**

Manage staff accounts and permissions.

### User Table

| Column | Description |
|--------|-------------|
| Name | User's full name |
| Email | Login email |
| Role | ADMIN, MANAGER, or CASHIER |
| Status | Active/Inactive |
| Failed Attempts | Login failure count |
| Locked Until | Lockout expiry time |
| Last Login | When they last signed in |

### Creating a User

1. Click **+ Add User**
2. Enter **Name**, **Email**, **Password** (min 8 chars)
3. Select **Role** (CASHIER, MANAGER, ADMIN)
4. Click **Create User**

### Managing Users

| Action | How |
|--------|-----|
| **Change Role** | Select from the role dropdown in the table |
| **Deactivate** | Click **Deactivate** (user can't log in) |
| **Activate** | Click **Activate** (restore access) |
| **Unlock** | Click **Unlock** (remove lockout after failed attempts) |
| **Delete** | Click **Delete** (permanent, can't delete yourself) |

### Database Backup

Click **💾 Database Backup** to download a full JSON export of all tables.

---

## Audit Logs

**📍 Sidebar: 📝 Audit Logs | Roles: ADMIN only**

Complete audit trail of all system actions.

### Log Table

| Column | Description |
|--------|-------------|
| Time | When the action occurred |
| User | Who performed the action |
| Action | LOGIN, CREATE, UPDATE, DELETE, etc. |
| Entity | What was affected (USER, PRODUCT, SALE, etc.) |
| ID | Entity ID |
| Details | JSON with additional context |

### What Gets Logged

- All logins and logouts
- Product create/update/delete
- Sales and returns
- Stock adjustments
- User management actions
- Purchase order changes
- Cash drawer open/close
- Email sends
- MFA changes

---

## Login History

**📍 Sidebar: 🕐 Login History | Roles: ADMIN only**

Security-focused view of all authentication events.

### What's Shown

| Column | Description |
|--------|-------------|
| Time | When the event occurred |
| User | Name and email |
| Action | 🟢 Login, 🔑 Forgot Password, 🔓 Reset, 🔐 Changed, 🛡️ MFA Enabled, ⚠️ MFA Disabled |
| IP Address | User's IP address |
| Device | 📱 Mobile or 💻 Desktop |
| Browser | Chrome, Firefox, Safari, Edge |
| OS | Windows, macOS, Linux, Android, iOS |
| Details | Additional context (JSON) |

### Filtering

- **User** — filter by specific user
- **Limit** — 50, 100, 200, or 500 entries

---

## Change Password

**📍 Sidebar: 🔐 Change Password | Roles: ALL**

Update your account password.

### Steps

1. Enter your **current password**
2. Enter your **new password** (min 12 characters)
3. **Confirm** the new password
4. Click **Change Password**

### Password Policy

- Minimum **12 characters**
- Must be different from recent passwords
- Passwords expire every **90 days**
- You'll be forced to change on login if expired

---

## MFA / Security

**📍 Sidebar: 🛡️ MFA / Security | Roles: ALL**

Enable Multi-Factor Authentication for extra security.

### What is MFA?

MFA requires a 6-digit code from an authenticator app (Google Authenticator, Authy) in addition to your password when logging in.

### Setting Up MFA

1. Click **Enable MFA**
2. **Scan the QR code** with your authenticator app
   - Or enter the **secret key** manually
3. **Save the backup codes** (8 one-time-use codes)
4. **Download or print** the backup sheet
5. Enter the **6-digit code** from your app
6. Click **Verify & Activate**

### Backup Options

| Option | How |
|--------|-----|
| **📥 Download QR** | Save QR code image to your device |
| **🖨️ Print** | Print a paper backup sheet |
| **📧 Email Backup** | Send backup codes + PDF to your email |

### Disabling MFA

1. Go to the **Disable** tab
2. Enter your password to confirm
3. Click **Disable MFA**

---

## Wi-Fi QR Generator

**📍 Sidebar: 📶 Wi-Fi QR | Roles: ALL**

Generate QR codes for Wi-Fi networks that customers can scan to connect.

### How to Use

1. Enter the **Network Name (SSID)**
2. Select **Encryption** (WPA, WEP, or None)
3. Enter the **Password** (if not open network)
4. Check **Hidden network** if applicable
5. The QR code generates automatically
6. **Download** or **Print** the QR code

### What Happens When Scanned

A phone camera scanning the QR code will:
1. Show a prompt to join the Wi-Fi network
2. Auto-fill the password
3. Connect to the network

---

## Roles & Permissions

### Role Matrix

| Feature | ADMIN | MANAGER | CASHIER |
|---------|:-----:|:-------:|:-------:|
| **Dashboard** | ✅ | ✅ | ✅ |
| **Executive Dashboard** | ✅ | ❌ | ❌ |
| **Point of Sale** | ✅ | ✅ | ✅ |
| **Products** | ✅ Full | ✅ Create/Edit | ❌ View only |
| **Inventory** | ✅ | ✅ | ✅ View only |
| **Sales History** | ✅ All | ✅ All | ✅ Own only |
| **Customers** | ✅ | ✅ | ✅ |
| **Suppliers** | ✅ Full | ✅ Create/Edit | ❌ View only |
| **Purchase Orders** | ✅ Full | ✅ Create/Edit | ❌ |
| **Expenses** | ✅ Full | ✅ Create | ❌ |
| **Finance** | ✅ | ✅ | ❌ |
| **AI Forecast** | ✅ | ✅ | ❌ |
| **Auto Reorder** | ✅ | ✅ | ❌ |
| **Reports** | ✅ | ✅ | ❌ |
| **Cash Drawer** | ✅ Close | ✅ Close | ✅ Open only |
| **Branches** | ✅ | ❌ | ❌ |
| **Customer Display** | ✅ | ✅ | ✅ |
| **Supplier Portal** | ✅ | ❌ | ❌ |
| **User Management** | ✅ | ❌ | ❌ |
| **Audit Logs** | ✅ | ❌ | ❌ |
| **Login History** | ✅ | ❌ | ❌ |
| **Change Password** | ✅ | ✅ | ✅ |
| **MFA / Security** | ✅ | ✅ | ✅ |
| **Wi-Fi QR** | ✅ | ✅ | ✅ |

---

## Keyboard Shortcuts

### POS Page

| Key | Action |
|-----|--------|
| **Enter** (in search box) | Add matching product to cart |
| **Tab** | Move between search and cart |
| **+** / **−** | Adjust cart quantity |

### Global

| Key | Action |
|-----|--------|
| **Ctrl + P** | Print current page |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | JWT signing secret |
| `PORT` | ❌ | Server port (default: 5000) |
| `FRONTEND_URL` | ❌ | CORS origin |
| `MAX_LOGIN_ATTEMPTS` | ❌ | Lockout threshold (default: 5) |
| `LOCK_MINUTES` | ❌ | Lockout duration (default: 15) |
| `RESEND_API_KEY` | ❌ | Email sending (Resend) |
| `CLOUDINARY_CLOUD_NAME` | ❌ | Image storage |
| `CLOUDINARY_API_KEY` | ❌ | Image storage |
| `CLOUDINARY_API_SECRET` | ❌ | Image storage |

---

## API Endpoints Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Get current user |
| POST | `/api/auth/change-password` | Change password |
| POST | `/api/auth/forgot-password` | Request reset link |
| POST | `/api/auth/reset-password` | Reset with token |
| POST | `/api/auth/mfa/setup` | Setup MFA |
| POST | `/api/auth/mfa/verify` | Verify MFA code |
| POST | `/api/auth/mfa/disable` | Disable MFA |
| GET | `/api/auth/mfa/status` | MFA status |
| POST | `/api/auth/mfa/email-backup` | Email backup codes |

### Products
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List products |
| POST | `/api/products` | Create product |
| PUT | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Delete product |
| POST | `/api/products/:id/image` | Upload image |
| POST | `/api/products/:id/adjust` | Adjust stock |
| GET | `/api/products/low-stock` | Low stock list |

### Sales
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sales` | List sales |
| GET | `/api/sales/:id` | Sale detail |
| POST | `/api/sales` | Create sale |
| POST | `/api/sales/:id/return` | Process return |
| POST | `/api/sales/:id/email-receipt` | Email receipt |

### Customers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/customers` | List customers |
| POST | `/api/customers` | Create customer |
| PUT | `/api/customers/:id` | Update customer |

### Suppliers & Procurement
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/suppliers` | List/Create suppliers |
| PUT/DELETE | `/api/suppliers/:id` | Update/Delete supplier |
| GET/POST | `/api/purchase-orders` | List/Create POs |
| GET | `/api/purchase-orders/:id` | PO detail |
| PATCH | `/api/purchase-orders/:id/status` | Update PO status |

### Finance
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/expenses` | List/Create expenses |
| GET | `/api/finance/summary` | Financial summary |

### Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reports/daily` | Daily report |
| POST | `/api/reports/daily/email` | Email daily report |
| GET | `/api/reports/monthly` | Monthly report |
| GET | `/api/reports/product-sales` | Product sales |
| GET | `/api/reports/low-stock` | Low stock report |
| GET | `/api/reports/cashier-sales` | Cashier performance |

### Dashboard & BI
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard/stats` | Dashboard stats |
| GET | `/api/dashboard/top-products` | Top products |
| GET | `/api/dashboard/category-sales` | Category sales |
| GET | `/api/executive/overview` | Executive overview |
| GET | `/api/forecast/demand` | AI demand forecast |

### Cash Drawer
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cash-drawer` | Drawer history |
| GET | `/api/cash-drawer/active` | Active drawer |
| POST | `/api/cash-drawer/open` | Open drawer |
| POST | `/api/cash-drawer/close` | Close drawer |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/PATCH/DELETE | `/api/users` | User CRUD |
| GET | `/api/audit-logs` | Audit logs |
| GET | `/api/audit-logs/login-history` | Login history |
| GET | `/api/branches` | List branches |
| GET | `/api/admin/backup` | Database backup |

### Other
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/inventory/movements` | Inventory movements |
| GET | `/api/categories` | Product categories |
| POST | `/api/payments/verify` | Payment verification |
| GET | `/api/payments/verify/:saleId` | Payment status |
| POST | `/api/sync/sales` | Offline sync |
| POST | `/api/auto-reorder/create` | Auto reorder |

---

*Last updated: August 2026 — RHoSAM Supermarket POS v1.0*
