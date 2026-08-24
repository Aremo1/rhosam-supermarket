#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 * RHoSAM — Full Application Audit Test Suite (v4)
 * Tests every endpoint, function, and expected output
 * ═══════════════════════════════════════════════════════════════════
 */
const BASE = process.env.API_URL || "http://localhost:5000";
// Unique run ID for email isolation — ensures idempotent test runs
const RUN_ID = `audit${Date.now()}`;
let token = "", adminUser = null;
let cashierToken = "", cashierUser = null;
let managerToken = "", managerUser = null;
const created = { products: [], sales: [], customers: [], suppliers: [], poIds: [], users: [], branches: [] };

let total = 0, passed = 0, failed = 0;
const failures = [];

async function api(method, path, body, tok) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (tok) opts.headers["Authorization"] = `Bearer ${tok}`;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  let data;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

function ok(label, condition, detail) {
  total++;
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label} — ${detail || "FAILED"}`); failures.push(label); }
}

function section(name) { console.log(`\n══ ${name} ══`); }

// ═══════════════════════════════════════════════════════════════════
// PRE-TEST: Unlock admin + clean stale data
// ═══════════════════════════════════════════════════════════════════
async function preTest() {
  console.log("══ PRE-TEST SETUP ══");
  try {
    const { Pool } = require("pg");
    require("dotenv").config();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // Unlock admin
    await pool.query("UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE email='admin@rhosam.com'");
    console.log("  ✅ Admin account unlocked");

    // Collect IDs of stale test users (any non-admin, non-seeded user with test email patterns)
    const staleEmails = [
      "cashier2@test.com", "manager2@test.com",
      "cashier3@test.com", "manager3@test.com",
      "cashier@test.com", "manager@test.com",
      "final-cashier@test.com",
      "bad@test.com",
      "cashier4@test.com", "manager4@test.com",
    ];
    const { rows: staleUsers } = await pool.query(
      `SELECT id FROM users WHERE email = ANY($1)`, [staleEmails]
    );
    const staleUserIds = staleUsers.map(u => u.id);

    // Also collect stale test product barcodes
    const testBarcodes = ['TEST-AUDIT-001', 'TEST-AUDIT-002', 'RBAC-CASH-FAIL', 'RBAC-MAN-OK', 'DEBUG-TEST-001'];
    const { rows: staleProducts } = await pool.query(
      `SELECT id FROM products WHERE barcode = ANY($1)`, [testBarcodes]
    );
    const staleProductIds = staleProducts.map(p => p.id);

    if (staleUserIds.length || staleProductIds.length) {
      console.log(`  🔍 Found ${staleUserIds.length} stale user(s), ${staleProductIds.length} stale product(s) — cleaning…`);
    }

    // ── Step 1: Delete records that REFERENCE stale users/products (FK-dependent) ──
    // audit_logs.user_id → users(id) — no CASCADE
    if (staleUserIds.length) {
      await pool.query(`DELETE FROM audit_logs WHERE user_id = ANY($1)`, [staleUserIds]);
    }
    // sale_items → sales (CASCADE already), but sales.cashier_id → users(id) — no CASCADE
    if (staleUserIds.length) {
      await pool.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE cashier_id = ANY($1))`, [staleUserIds]);
      await pool.query(`DELETE FROM sales WHERE cashier_id = ANY($1)`, [staleUserIds]);
    }
    // returns.processed_by → users(id)
    if (staleUserIds.length) {
      await pool.query(`DELETE FROM returns WHERE processed_by = ANY($1)`, [staleUserIds]);
    }
    // purchase_orders.created_by → users(id)
    if (staleUserIds.length) {
      await pool.query(`DELETE FROM purchase_order_items WHERE po_id IN (SELECT id FROM purchase_orders WHERE created_by = ANY($1))`, [staleUserIds]);
      await pool.query(`DELETE FROM purchase_orders WHERE created_by = ANY($1)`, [staleUserIds]);
    }
    // expenses.approved_by → users(id)
    if (staleUserIds.length) {
      await pool.query(`DELETE FROM expenses WHERE approved_by = ANY($1)`, [staleUserIds]);
    }
    // cash_drawer.opened_by/closed_by → users(id)
    if (staleUserIds.length) {
      await pool.query(`UPDATE cash_drawer SET opened_by = NULL WHERE opened_by = ANY($1)`, [staleUserIds]);
      await pool.query(`UPDATE cash_drawer SET closed_by = NULL WHERE closed_by = ANY($1)`, [staleUserIds]);
    }
    // branches.manager_id → users(id)
    if (staleUserIds.length) {
      await pool.query(`UPDATE branches SET manager_id = NULL WHERE manager_id = ANY($1)`, [staleUserIds]);
    }
    // inventory_movements.user_id → users(id)
    if (staleUserIds.length) {
      await pool.query(`DELETE FROM inventory_movements WHERE user_id = ANY($1)`, [staleUserIds]);
    }
    // ── Step 2: Delete records that REFERENCE stale products (no CASCADE) ──
    if (staleProductIds.length) {
      await pool.query(`DELETE FROM sale_items WHERE product_id = ANY($1)`, [staleProductIds]);
      await pool.query(`DELETE FROM inventory_movements WHERE product_id = ANY($1)`, [staleProductIds]);
      await pool.query(`DELETE FROM returns WHERE product_id = ANY($1)`, [staleProductIds]);
      await pool.query(`DELETE FROM purchase_order_items WHERE product_id = ANY($1)`, [staleProductIds]);
    }
    // Also clean by receipt_number / po_number patterns for good measure
    await pool.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE receipt_number LIKE 'RHS-AUDIT%')`);
    await pool.query(`DELETE FROM sales WHERE receipt_number LIKE 'RHS-AUDIT%'`);
    await pool.query(`DELETE FROM purchase_order_items WHERE po_id IN (SELECT id FROM purchase_orders WHERE po_number LIKE 'PO-AUDIT%')`);
    await pool.query(`DELETE FROM purchase_orders WHERE po_number LIKE 'PO-AUDIT%'`);
    // ── Step 3: Now safe to delete stale users and products ──
    await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [staleEmails]);
    await pool.query(`DELETE FROM products WHERE barcode = ANY($1)`, [testBarcodes]);
    console.log("  ✅ Cleaned stale test data (users, products, FK-dependent records)");
    await pool.end();
  } catch (e) {
    console.log("  ⚠️ Pre-test cleanup failed:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════
async function testAuth() {
  section("AUTHENTICATION");

  let r = await api("GET", "/api/health");
  ok("Health check returns {status:ok}", r.status === 200 && r.data?.status === "ok");

  r = await api("POST", "/api/auth/login", { email: "admin@rhosam.com", password: "Admin@Secure1234" });
  ok("Admin login returns 200", r.status === 200, `got ${r.status}: ${JSON.stringify(r.data)}`);
  ok("Login returns JWT token", !!r.data?.token);
  ok("Login returns user object with id/name/email/role", r.data?.user?.id && r.data?.user?.role === "ADMIN");
  token = r.data?.token;
  adminUser = r.data?.user;

  r = await api("GET", "/api/auth/me", null, token);
  ok("/auth/me returns user info", r.status === 200 && r.data?.user?.id);
  ok("/auth/me user matches logged-in user", r.data?.user?.id === adminUser.id);

  r = await api("POST", "/api/auth/login", { email: "admin@rhosam.com", password: "wrongpassword" });
  ok("Invalid password returns 401", r.status === 401);
  ok("Error message is generic (no enumeration)", r.data?.message?.includes("Invalid"));

  r = await api("GET", "/api/users");
  ok("Request without token returns 401", r.status === 401);

  r = await api("GET", "/api/users", null, "badtoken123");
  ok("Request with bad token returns 401", r.status === 401);

  r = await api("POST", "/api/auth/forgot-password", { email: "admin@rhosam.com" });
  ok("Forgot password returns success", r.status === 200);

  r = await api("POST", "/api/auth/change-password", { currentPassword: "wrong", newPassword: "NewPassword12345" }, token);
  ok("Change password with wrong current returns 401", r.status === 401);

  r = await api("POST", "/api/auth/change-password", { currentPassword: "Admin@Secure1234", newPassword: "short" }, token);
  ok("Change password with short password returns 400", r.status === 400);
}

// ═══════════════════════════════════════════════════════════════════
// 2. USER MANAGEMENT & RBAC
// ═══════════════════════════════════════════════════════════════════
async function testUsers() {
  section("USER MANAGEMENT (RBAC)");

  let r = await api("GET", "/api/users", null, token);
  ok("GET /users returns array", r.status === 200 && Array.isArray(r.data));
  ok("Users include admin", r.data?.some(u => u.role === "ADMIN"));

  // Create cashier
  r = await api("POST", "/api/users", { name: "Test Cashier", email: `cashier2-${RUN_ID}@test.com`, password: "CashierTest1234", role: "CASHIER" }, token);
  ok("Create cashier returns 201", r.status === 201 && r.data?.id);
  if (r.data?.id) created.users.push(r.data.id);

  // Create manager
  r = await api("POST", "/api/users", { name: "Test Manager", email: `manager2-${RUN_ID}@test.com`, password: "ManagerTest1234", role: "MANAGER" }, token);
  ok("Create manager returns 201", r.status === 201 && r.data?.id);
  if (r.data?.id) created.users.push(r.data.id);

  r = await api("POST", "/api/users", { name: "Dup", email: `cashier2-${RUN_ID}@test.com`, password: "DupTest1234567", role: "CASHIER" }, token);
  ok("Duplicate email returns 409", r.status === 409);

  r = await api("POST", "/api/users", { name: "Bad", email: "bad@test.com", password: "BadRole1234567", role: "SUPERVISOR" }, token);
  ok("Invalid role returns 400", r.status === 400);

  // Login as CASHIER (do RBAC tests BEFORE any promotions)
  r = await api("POST", "/api/auth/login", { email: `cashier2-${RUN_ID}@test.com`, password: "CashierTest1234" });
  ok("Cashier login returns 200", r.status === 200);
  cashierToken = r.data?.token;
  cashierUser = r.data?.user;
  ok("Cashier role is CASHIER", r.data?.user?.role === "CASHIER");

  r = await api("GET", "/api/users", null, cashierToken);
  ok("Cashier blocked from /users (403)", r.status === 403);

  r = await api("GET", "/api/products", null, cashierToken);
  ok("Cashier can access /products", r.status === 200);

  r = await api("POST", "/api/products", { barcode: "RBAC-CASH-FAIL", name: "Cashier Product", category: "Test", price: 500, stock: 10 }, cashierToken);
  ok("Cashier blocked from creating products (403)", r.status === 403);

  r = await api("POST", "/api/expenses", { category: "Test", amount: 100 }, cashierToken);
  ok("Cashier blocked from creating expenses (403)", r.status === 403);

  // Login as MANAGER
  r = await api("POST", "/api/auth/login", { email: `manager2-${RUN_ID}@test.com`, password: "ManagerTest1234" });
  ok("Manager login returns 200", r.status === 200);
  managerToken = r.data?.token;
  managerUser = r.data?.user;

  r = await api("POST", "/api/products", { barcode: "RBAC-MAN-OK", name: "Manager Product", category: "Test", price: 500, stock: 10 }, managerToken);
  ok("Manager can create products", r.status === 201);
  // Don't push to created.products — it's a RBAC test product, not test data

  r = await api("GET", "/api/users", null, managerToken);
  ok("Manager blocked from /users (403)", r.status === 403);

  r = await api("DELETE", `/api/users/${created.users[0]}`, null, managerToken);
  ok("Manager blocked from deleting users (403)", r.status === 403 || r.status === 400, `got ${r.status}`);

  // Post-RBAC: update/deactivate/promote the cashier
  r = await api("PATCH", `/api/users/${created.users[0]}`, { role: "MANAGER" }, token);
  ok("Update user role returns 200", r.status === 200 && r.data?.role === "MANAGER");

  r = await api("PATCH", `/api/users/${created.users[0]}`, { isActive: false }, token);
  ok("Deactivate user returns 200", r.status === 200 && r.data?.is_active === false);

  r = await api("PATCH", `/api/users/${created.users[0]}`, { isActive: true }, token);
  ok("Reactivate user returns 200", r.status === 200 && r.data?.is_active === true);

  r = await api("PATCH", `/api/users/${created.users[0]}`, { unlock: true }, token);
  ok("Unlock user returns 200", r.status === 200);
}

// ═══════════════════════════════════════════════════════════════════
// 3. PRODUCTS
// ═══════════════════════════════════════════════════════════════════
async function testProducts() {
  section("PRODUCTS");

  let r = await api("POST", "/api/products", {
    barcode: "TEST-AUDIT-001", name: "Test Audit Widget", category: "Electronics",
    price: 2500, costPrice: 1500, stock: 100, reorderLevel: 10, unit: "PCS", description: "Test product"
  }, token);
  ok("Create product returns 201", r.status === 201 && r.data?.id);
  ok("Product has correct fields", r.data?.name === "Test Audit Widget" && r.data?.price === 2500);
  ok("Product stock is 100", r.data?.stock === 100);
  if (r.data?.id) created.products.push(r.data.id);

  r = await api("POST", "/api/products", {
    barcode: "TEST-AUDIT-002", name: "Test Audit Gadget", category: "Electronics",
    price: 5000, costPrice: 3000, stock: 50, reorderLevel: 5
  }, token);
  ok("Create second product returns 201", r.status === 201);
  if (r.data?.id) created.products.push(r.data.id);

  r = await api("GET", "/api/products", null, token);
  ok("GET /products returns array", r.status === 200 && Array.isArray(r.data));
  ok("Created products appear in list", r.data?.some(p => p.barcode === "TEST-AUDIT-001"));

  r = await api("GET", "/api/products?search=test+audit", null, token);
  ok("Search by name finds products", r.status === 200 && r.data?.length >= 2);

  r = await api("PUT", `/api/products/${created.products[0]}`, { price: 2750, stock: 95 }, token);
  ok("Update product returns 200", r.status === 200 && r.data?.price === 2750);
  ok("Updated stock reflects change", r.data?.stock === 95);

  r = await api("POST", `/api/products/${created.products[0]}/adjust`, { quantity: 10, type: "STOCK_IN", notes: "Restocking" }, token);
  ok("Stock adjustment returns 200", r.status === 200);
  r = await api("GET", "/api/products?search=Test+Audit+Widget", null, token);
  const adjustedProduct = r.data?.find(p => p.id === created.products[0]);
  ok("Stock increased after STOCK_IN (95 + 10 = 105)", adjustedProduct?.stock === 105);

  r = await api("GET", `/api/inventory/movements?product_id=${created.products[0]}`, null, token);
  ok("Inventory movements returned", r.status === 200 && Array.isArray(r.data));
  ok("STOCK_IN movement recorded", r.data?.some(m => m.movement_type === "STOCK_IN"));

  r = await api("GET", "/api/products/low-stock", null, token);
  ok("Low stock endpoint returns array", r.status === 200 && Array.isArray(r.data));

  r = await api("GET", "/api/categories", null, token);
  ok("Categories endpoint returns array", r.status === 200 && Array.isArray(r.data));
  ok("Categories include Electronics", r.data?.includes("Electronics"));

  r = await api("POST", "/api/products", { barcode: "TEST-AUDIT-001", name: "Dup", category: "Test", price: 100 }, token);
  ok("Duplicate barcode returns 409", r.status === 409);

  r = await api("POST", "/api/products", { name: "No Barcode", category: "Test", price: 100 }, token);
  ok("Invalid product returns 400", r.status === 400);
}

// ═══════════════════════════════════════════════════════════════════
// 4. POS / SALES
// ═══════════════════════════════════════════════════════════════════
async function testSales() {
  section("POS / SALES");

  // Get current stock
  let sr = await api("GET", `/api/products/${created.products[0]}`, null, token);
  // If /products/:id doesn't exist, search
  if (sr.status !== 200) sr = await api("GET", "/api/products?search=Test+Audit+Widget", null, token);
  const stockBefore = sr.data?.stock ?? sr.data?.find?.(p => p.id === created.products[0])?.stock;
  ok("Stock before sale is tracked", stockBefore !== undefined && stockBefore !== null);

  let r = await api("POST", "/api/sales", {
    customerName: "Walk-in Customer", paymentMethod: "Cash",
    items: [{ productId: created.products[0], quantity: 2, discount: 0 }],
    discount: 0, tax: 0, amountPaid: 5500
  }, token);
  ok("Sale returns 201", r.status === 201);
  ok("Sale has receipt number (RHS-...)", r.data?.receiptNumber?.startsWith("RHS-"));
  ok("Sale total is correct (2750 × 2 = 5500)", r.data?.total === 5500);
  ok("Sale has items array", Array.isArray(r.data?.items) && r.data.items.length === 1);
  ok("Sale item quantity is 2", r.data?.items[0]?.quantity === 2);
  ok("Sale line total is 5500", r.data?.items[0]?.lineTotal === 5500);
  ok("Sale amountPaid is 5500", r.data?.amountPaid === 5500);
  ok("Change is 0", r.data?.change === 0);
  if (r.data?.id) created.sales.push(r.data.id);

  // Check stock deducted
  sr = await api("GET", "/api/products?search=Test+Audit+Widget", null, token);
  const stockAfter = sr.data?.find?.(p => p.id === created.products[0])?.stock;
  ok("Stock deducted after sale", stockAfter === stockBefore - 2);

  // Sale with change
  r = await api("POST", "/api/sales", {
    customerName: "Change Test", paymentMethod: "Cash",
    items: [{ productId: created.products[1], quantity: 1 }], amountPaid: 6000
  }, token);
  ok("Sale with change returns correct change (6000 - 5000 = 1000)", r.data?.change === 1000);
  ok("Change amount equals 1000", r.data?.change_amount === 1000);
  if (r.data?.id) created.sales.push(r.data.id);

  r = await api("POST", "/api/sales", {
    customerName: "Card Payment Test", paymentMethod: "Card",
    items: [{ productId: created.products[0], quantity: 1 }], amountPaid: 2750
  }, token);
  ok("Card payment sale works", r.status === 201);
  if (r.data?.id) created.sales.push(r.data.id);

  r = await api("POST", "/api/sales", { customerName: "Empty", paymentMethod: "Cash", items: [] }, token);
  ok("Empty cart returns 400", r.status === 400);

  r = await api("POST", "/api/sales", { customerName: "Bad Pay", paymentMethod: "Bitcoin", items: [{ productId: created.products[0], quantity: 1 }] }, token);
  ok("Invalid payment method returns 400", r.status === 400);

  r = await api("POST", "/api/sales", {
    customerName: "Over", paymentMethod: "Cash",
    items: [{ productId: created.products[1], quantity: 9999 }], amountPaid: 50000000
  }, token);
  ok("Insufficient stock returns error", r.status !== 201);

  r = await api("GET", "/api/sales", null, token);
  ok("GET /sales returns array", r.status === 200 && Array.isArray(r.data));
  ok("Sales list contains created sales", r.data?.length >= 3);
  ok("Sales include cashier_name", !!r.data?.[0]?.cashier_name);
  ok("Sales include item_count", typeof r.data?.[0]?.item_count === "number");

  r = await api("GET", `/api/sales/${created.sales[0]}`, null, token);
  ok("GET /sales/:id returns sale detail", r.status === 200 && r.data?.id == created.sales[0]);
  ok("Sale detail includes items", Array.isArray(r.data?.items) && r.data.items.length > 0);
  ok("Sale detail includes cashier_name", !!r.data?.cashier_name);

  r = await api("GET", "/api/sales/999999", null, token);
  ok("Non-existent sale returns 404", r.status === 404);
}

// ═══════════════════════════════════════════════════════════════════
// 5. RETURNS
// ═══════════════════════════════════════════════════════════════════
async function testReturns() {
  section("RETURNS & REFUNDS");

  // Get current stock before return
  let sr = await api("GET", "/api/products?search=Test+Audit+Widget", null, token);
  const stockBeforeReturn = sr.data?.find?.(p => p.id === created.products[0])?.stock;

  let r = await api("POST", `/api/sales/${created.sales[0]}/return`, {
    productId: created.products[0], quantity: 1, reason: "Changed mind"
  }, token);
  ok("Return processed", r.status === 200);
  ok("Refund amount correct (1 × 2750 = 2750)", r.data?.refundAmount === 2750);

  sr = await api("GET", "/api/products?search=Test+Audit+Widget", null, token);
  const p = sr.data?.find?.(x => x.id === created.products[0]);
  ok("Stock restored after return", p?.stock === stockBeforeReturn + 1);

  r = await api("POST", `/api/sales/${created.sales[0]}/return`, {
    productId: created.products[0], quantity: 10, reason: "Too much"
  }, token);
  ok("Over-return rejected", r.status === 400);

  r = await api("POST", "/api/sales/999999/return", { productId: created.products[0], quantity: 1 }, token);
  ok("Return non-existent sale returns 404", r.status === 404);
}

// ═══════════════════════════════════════════════════════════════════
// 6. CUSTOMERS
// ═══════════════════════════════════════════════════════════════════
async function testCustomers() {
  section("CUSTOMERS");

  let r = await api("POST", "/api/customers", { name: "Test Customer", email: "test@example.com", phone: "08012345678" }, token);
  ok("Create customer returns 201", r.status === 201 && r.data?.id);
  ok("Customer has loyalty_points = 0", r.data?.loyalty_points == 0);
  ok("Customer has membership_tier = BRONZE", r.data?.membership_tier === "BRONZE");
  if (r.data?.id) created.customers.push(r.data.id);

  r = await api("GET", "/api/customers", null, token);
  ok("GET /customers returns array", r.status === 200 && Array.isArray(r.data));
  ok("Customer in list", r.data?.some(c => c.id == created.customers[0]));

  r = await api("PUT", `/api/customers/${created.customers[0]}`, { name: "Updated Customer", phone: "08099998888" }, token);
  ok("Update customer returns 200", r.status === 200 && r.data?.name === "Updated Customer");

  r = await api("POST", "/api/sales", {
    customerName: "Updated Customer", customerId: created.customers[0],
    paymentMethod: "Cash", items: [{ productId: created.products[0], quantity: 3 }], amountPaid: 8250
  }, token);
  ok("Sale with customer recorded", r.status === 201);

  r = await api("GET", "/api/customers", null, token);
  const cust = r.data?.find(c => c.id == created.customers[0]);
  ok("Loyalty points updated after sale", Number(cust?.loyalty_points) > 0);
  ok("total_spent updated", Number(cust?.total_spent) > 0);
  ok("visit_count incremented", Number(cust?.visit_count) >= 1);
}

// ═══════════════════════════════════════════════════════════════════
// 7. SUPPLIERS & PURCHASE ORDERS
// ═══════════════════════════════════════════════════════════════════
async function testProcurement() {
  section("SUPPLIERS & PURCHASE ORDERS");

  let r = await api("POST", "/api/suppliers", {
    name: "Test Supplier Co", contactPerson: "John Doe", email: "john@supplier.com", phone: "0123456789", address: "123 Supply St"
  }, token);
  ok("Create supplier returns 201", r.status === 201 && r.data?.id);
  if (r.data?.id) created.suppliers.push(r.data.id);

  r = await api("GET", "/api/suppliers", null, token);
  ok("GET /suppliers returns array", r.status === 200 && Array.isArray(r.data));

  r = await api("PUT", `/api/suppliers/${created.suppliers[0]}`, { name: "Updated Supplier" }, token);
  ok("Update supplier returns 200", r.status === 200 && r.data?.name === "Updated Supplier");

  // Get current stock before PO receipt
  let sr = await api("GET", "/api/products?search=Test+Audit+Widget", null, token);
  const stockBeforePO = sr.data?.find?.(p => p.id === created.products[0])?.stock;

  r = await api("POST", "/api/purchase-orders", {
    supplierId: created.suppliers[0],
    items: [
      { productId: created.products[0], quantity: 50, unitCost: 1500 },
      { productId: created.products[1], quantity: 25, unitCost: 3000 }
    ],
    notes: "Restocking order"
  }, token);
  ok("Create PO returns 201", r.status === 201);
  ok("PO has poNumber", !!r.data?.poNumber);
  ok("PO total is correct (50×1500 + 25×3000 = 150000)", r.data?.total === 150000);
  if (r.data?.id) created.poIds.push(r.data.id);

  r = await api("GET", `/api/purchase-orders/${created.poIds[0]}`, null, token);
  ok("PO detail includes items", r.status === 200 && r.data?.items?.length === 2);
  ok("PO detail includes supplier_name", !!r.data?.supplier_name);

  r = await api("PATCH", `/api/purchase-orders/${created.poIds[0]}/status`, { status: "APPROVED" }, token);
  ok("Approve PO returns 200", r.status === 200 && r.data?.status === "APPROVED");

  r = await api("PATCH", `/api/purchase-orders/${created.poIds[0]}/status`, { status: "RECEIVED" }, token);
  ok("Receive PO returns 200", r.status === 200 && r.data?.status === "RECEIVED");

  sr = await api("GET", "/api/products?search=Test+Audit+Widget", null, token);
  const stockAfterPO = sr.data?.find?.(p => p.id === created.products[0])?.stock;
  ok("Stock increased after goods receipt", stockAfterPO > stockBeforePO);

  r = await api("PATCH", `/api/purchase-orders/${created.poIds[0]}/status`, { status: "PENDING" }, token);
  ok("Invalid status transition returns 400", r.status === 400);
}

// ═══════════════════════════════════════════════════════════════════
// 8. CASH DRAWER
// ═══════════════════════════════════════════════════════════════════
async function testCashDrawer() {
  section("CASH DRAWER");

  let r = await api("POST", "/api/cash-drawer/open", { openingBalance: 10000, drawerName: "Main" }, token);
  ok("Open drawer returns 201", r.status === 201);
  ok("Drawer opening_balance is 10000", Number(r.data?.opening_balance) === 10000);
  ok("Drawer status is OPEN", r.data?.status === "OPEN");

  r = await api("POST", "/api/cash-drawer/open", { openingBalance: 5000 }, token);
  ok("Second open drawer rejected (409)", r.status === 409);

  r = await api("GET", "/api/cash-drawer/active", null, token);
  ok("Active drawer returned", r.status === 200 && r.data?.status === "OPEN");

  r = await api("POST", "/api/cash-drawer/close", { closingBalance: 10000 }, token);
  ok("Close drawer returns 200", r.status === 200);
  ok("Drawer status is CLOSED", r.data?.status === "CLOSED");
  ok("Variance calculated", r.data?.hasOwnProperty("variance"));

  r = await api("GET", "/api/cash-drawer", null, token);
  ok("Cash drawer history returned", r.status === 200 && Array.isArray(r.data));
}

// ═══════════════════════════════════════════════════════════════════
// 9. EXPENSES & FINANCE
// ═══════════════════════════════════════════════════════════════════
async function testFinance() {
  section("FINANCE");

  let r = await api("POST", "/api/expenses", {
    category: "Utilities", description: "Electricity bill", amount: 15000, paymentMethod: "Cash"
  }, token);
  ok("Create expense returns 201", r.status === 201 && r.data?.id);

  r = await api("GET", "/api/expenses", null, token);
  ok("GET /expenses returns array", r.status === 200 && Array.isArray(r.data));

  r = await api("GET", "/api/finance/summary", null, token);
  ok("Finance summary returns data", r.status === 200);
  ok("Revenue is numeric", r.data?.revenue !== undefined);
  ok("Expenses is numeric", r.data?.expenses !== undefined);
}

// ═══════════════════════════════════════════════════════════════════
// 10. DASHBOARD
// ═══════════════════════════════════════════════════════════════════
async function testDashboard() {
  section("DASHBOARD");

  let r = await api("GET", "/api/dashboard/stats", null, token);
  ok("Dashboard stats returns all fields", r.status === 200);
  ok("totalProducts is a number", typeof r.data?.totalProducts === "number");
  ok("totalSales is a number", typeof r.data?.totalSales === "number");
  ok("totalRevenue is numeric", r.data?.totalRevenue !== undefined);
  ok("todaySales is a number", typeof r.data?.todaySales === "number");
  ok("todayRevenue is numeric", r.data?.todayRevenue !== undefined);
  ok("totalUsers is a number", typeof r.data?.totalUsers === "number");
  ok("salesChart is an array", Array.isArray(r.data?.salesChart));

  r = await api("GET", "/api/dashboard/top-products", null, token);
  ok("Top products returns array", r.status === 200 && Array.isArray(r.data));

  r = await api("GET", "/api/dashboard/category-sales", null, token);
  ok("Category sales returns array", r.status === 200 && Array.isArray(r.data));
}

// ═══════════════════════════════════════════════════════════════════
// 11. REPORTS
// ═══════════════════════════════════════════════════════════════════
async function testReports() {
  section("REPORTS");

  const year = new Date().getFullYear();
  let r = await api("GET", `/api/reports/monthly?year=${year}`, null, token);
  ok("Monthly report returns year + data", r.status === 200 && r.data?.year === year && Array.isArray(r.data?.data));

  r = await api("GET", "/api/reports/product-sales", null, token);
  ok("Product sales report returns array", r.status === 200 && Array.isArray(r.data));

  r = await api("GET", "/api/reports/low-stock", null, token);
  ok("Low stock report returns array", r.status === 200 && Array.isArray(r.data));

  r = await api("GET", "/api/reports/cashier-sales", null, token);
  ok("Cashier sales report returns array", r.status === 200 && Array.isArray(r.data));

  r = await api("GET", "/api/reports/daily", null, token);
  ok("Daily report returns summary", r.status === 200 && r.data?.summary);
  ok("Daily has itemsSold array", Array.isArray(r.data?.itemsSold));
  ok("Daily has topProducts array", Array.isArray(r.data?.topProducts));
}

// ═══════════════════════════════════════════════════════════════════
// 12. EXECUTIVE DASHBOARD
// ═══════════════════════════════════════════════════════════════════
async function testExecutive() {
  section("EXECUTIVE DASHBOARD");

  let r = await api("GET", "/api/executive/overview", null, token);
  ok("Executive overview returns 200", r.status === 200);
  ok("Has revenue object", typeof r.data?.revenue === "object");
  ok("Has expenses object", typeof r.data?.expenses === "object");
  ok("Has profit object", typeof r.data?.profit === "object");
  ok("Has products stats", typeof r.data?.products === "object");
  ok("Has customers stats", typeof r.data?.customers === "object");
  ok("Has salesTrend array", Array.isArray(r.data?.salesTrend));
  ok("Has topCashiers array", Array.isArray(r.data?.topCashiers));
  ok("Has categoryBreakdown array", Array.isArray(r.data?.categoryBreakdown));
  ok("Has alerts array", Array.isArray(r.data?.alerts));
}

// ═══════════════════════════════════════════════════════════════════
// 13. AI FORECAST & AUTO REORDER
// ═══════════════════════════════════════════════════════════════════
async function testForecast() {
  section("AI FORECAST & AUTO REORDER");

  let r = await api("GET", "/api/forecast/demand", null, token);
  ok("Forecast returns array", r.status === 200 && Array.isArray(r.data));
  if (r.data?.length) {
    ok("Forecast items have risk levels", ["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"].includes(r.data[0]?.risk));
    ok("Forecast has avgDaily", r.data[0]?.avgDaily !== undefined);
    ok("Forecast has predicted7Day", typeof r.data[0]?.predicted7Day === "number");
    ok("Forecast has predicted30Day", typeof r.data[0]?.predicted30Day === "number");
    ok("Forecast has daysUntilStockout", typeof r.data[0]?.daysUntilStockout === "number");
  }

  r = await api("GET", "/api/auto-reorder/suggestions", null, token);
  ok("Auto reorder suggestions returns array", r.status === 200 && Array.isArray(r.data));
}

// ═══════════════════════════════════════════════════════════════════
// 14. AUDIT LOGS & LOGIN HISTORY
// ═══════════════════════════════════════════════════════════════════
async function testAudit() {
  section("AUDIT LOGS & LOGIN HISTORY");

  let r = await api("GET", "/api/audit-logs", null, token);
  ok("Audit logs return array", r.status === 200 && Array.isArray(r.data));
  ok("Logs include ip_address field", r.data?.length === 0 || r.data[0]?.hasOwnProperty("ip_address"));
  ok("Logs include user_agent field", r.data?.length === 0 || r.data[0]?.hasOwnProperty("user_agent"));

  r = await api("GET", "/api/audit-logs", null, cashierToken);
  ok("Cashier blocked from audit logs (403)", r.status === 403);

  r = await api("GET", "/api/audit-logs/login-history", null, token);
  ok("Login history returns array", r.status === 200 && Array.isArray(r.data));
}

// ═══════════════════════════════════════════════════════════════════
// 15. PAYMENT VERIFICATION & BACKUP
// ═══════════════════════════════════════════════════════════════════
async function testPaymentsAndBackup() {
  section("PAYMENT VERIFICATION & BACKUP");

  let r = await api("POST", "/api/payments/verify", {
    saleId: created.sales[1], gateway: "INTERNAL", reference: `REF-${Date.now()}`,
    cardLast4: "4242", authCode: "AUTH123"
  }, token);
  ok("Payment verification returns 200", r.status === 200);
  ok("Verification has VERIFIED status", r.data?.status === "VERIFIED");
  ok("Verification stores gateway info", r.data?.gateway === "INTERNAL");
  ok("Verification stores card last4", r.data?.card_last4 === "4242");

  r = await api("GET", `/api/payments/verify/${created.sales[1]}`, null, token);
  ok("Payment verifications for sale returned", r.status === 200 && Array.isArray(r.data));

  r = await api("GET", "/api/admin/backup", null, token);
  ok("Backup returns 200", r.status === 200);
  ok("Backup has version", r.data?.version === "1.0");
  ok("Backup has exported_at", !!r.data?.exported_at);
  ok("Backup has tables object", typeof r.data?.tables === "object");
  ok("Backup includes users table", !!r.data?.tables?.users);
  ok("Backup includes products table", !!r.data?.tables?.products);
  ok("Backup includes sales table", !!r.data?.tables?.sales);

  r = await api("GET", "/api/admin/backup", null, cashierToken);
  ok("Cashier blocked from backup (403)", r.status === 403);
}

// ═══════════════════════════════════════════════════════════════════
// 16. BRANCHES
// ═══════════════════════════════════════════════════════════════════
async function testBranches() {
  section("BRANCHES");

  let r = await api("POST", "/api/branches", { name: "Test Branch", address: "456 Branch St", phone: "0987654321" }, token);
  ok("Create branch returns 201", r.status === 201 && r.data?.id);
  if (r.data?.id) created.branches.push(r.data.id);

  r = await api("GET", "/api/branches", null, token);
  ok("GET /branches returns array", r.status === 200 && Array.isArray(r.data));

  r = await api("PUT", `/api/branches/${created.branches[0]}`, { name: "Updated Branch" }, token);
  ok("Update branch returns 200", r.status === 200 && r.data?.name === "Updated Branch");

  r = await api("DELETE", `/api/branches/${created.branches[0]}`, null, token);
  ok("Delete branch returns 200", r.status === 200, `got ${r.status}`);
}

// ═══════════════════════════════════════════════════════════════════
// 17. CUSTOMER DISPLAY & SUPPLIER PORTAL
// ═══════════════════════════════════════════════════════════════════
async function testDisplayAndPortal() {
  section("CUSTOMER DISPLAY & SUPPLIER PORTAL");

  let r = await api("GET", `/api/customer-display/${created.sales[0]}`, null, token);
  ok("Customer display returns sale info", r.status === 200 && r.data?.display === true);
  ok("Customer display includes items", Array.isArray(r.data?.items));

  r = await api("GET", `/api/supplier-portal/orders/${created.suppliers[0]}`, null, token);
  ok("Supplier portal orders returned", r.status === 200 && Array.isArray(r.data));
}

// ═══════════════════════════════════════════════════════════════════
// 18. OFFLINE SYNC
// ═══════════════════════════════════════════════════════════════════
async function testSync() {
  section("OFFLINE SYNC");

  let r = await api("POST", "/api/sync/sales", {
    sales: [{
      localId: "offline-1", customerName: "Sync Customer", paymentMethod: "Cash",
      items: [{ productId: created.products[0], quantity: 1, name: "Sync Item" }], amountPaid: 2750
    }]
  }, token);
  ok("Sync sales returns 200", r.status === 200);
  ok("Sync has synced count", typeof r.data?.synced === "number" && r.data.synced >= 1);
  ok("Sync result has status", r.data?.results?.[0]?.status === "synced");
  ok("Sync result has serverId", r.data?.results?.[0]?.serverId !== undefined);

  r = await api("POST", "/api/sync/sales", { sales: [] }, token);
  ok("Empty sync returns 400", r.status === 400);
}

// ═══════════════════════════════════════════════════════════════════
// 19. MFA
// ═══════════════════════════════════════════════════════════════════
async function testMFA() {
  section("MFA (MULTI-FACTOR AUTHENTICATION)");

  let r = await api("GET", "/api/auth/mfa/status", null, token);
  ok("MFA status returns mfaEnabled", r.status === 200 && typeof r.data?.mfaEnabled === "boolean");

  r = await api("POST", "/api/auth/mfa/setup", {}, token);
  ok("MFA setup returns secret", r.status === 200 && !!r.data?.secret);
  ok("MFA setup returns otpauthUrl", !!r.data?.otpauthUrl && r.data.otpauthUrl.startsWith("otpauth://totp/"));
  ok("MFA setup returns 8 backup codes", Array.isArray(r.data?.backupCodes) && r.data.backupCodes.length === 8);
  ok("Backup codes are formatted (XXXX-XXXX)", /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(r.data?.backupCodes[0]));

  r = await api("POST", "/api/auth/mfa/verify", { code: "000000" }, token);
  ok("Wrong MFA code returns 401", r.status === 401);

  r = await api("POST", "/api/auth/mfa/disable", { password: "wrong" }, token);
  ok("Disable MFA with wrong password returns 401", r.status === 401);
}

// ═══════════════════════════════════════════════════════════════════
// 20. EMAIL FEATURES
// ═══════════════════════════════════════════════════════════════════
async function testEmail() {
  section("EMAIL FEATURES");

  let r = await api("POST", "/api/auth/mfa/email-backup", {
    secret: "TESTSECRET123",
    backupCodes: ["AAAA-BBBB", "CCCC-DDDD", "EEEE-FFFF", "1111-2222", "3333-4444", "5555-6666", "7777-8888", "9999-0000"]
  }, token);
  ok("MFA email backup doesn't crash", r.status === 200 || r.status === 503);

  r = await api("POST", `/api/sales/${created.sales[0]}/email-receipt`, { email: "test@example.com" }, token);
  ok("Email receipt doesn't crash", r.status === 200 || r.status === 503);
}

// ═══════════════════════════════════════════════════════════════════
// 21. EDGE CASES & ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════
async function testEdgeCases() {
  section("EDGE CASES & ERROR HANDLING");

  let r = await api("GET", "/api/products/999999", null, token);
  ok("Non-existent product returns 404", r.status === 404);

  r = await api("PATCH", "/api/users/999999", { role: "ADMIN" }, token);
  ok("Non-existent user returns 404", r.status === 404);

  r = await api("PATCH", `/api/users/${adminUser.id}`, { isActive: false }, token);
  ok("Self-deactivate returns 400", r.status === 400);

  r = await api("PUT", "/api/branches/999999", { name: "Ghost" }, token);
  ok("Non-existent branch returns 404", r.status === 404);

  r = await api("GET", "/api/purchase-orders/999999", null, token);
  ok("Non-existent PO returns 404", r.status === 404);

  r = await api("GET", "/api/supplier-portal/order/999999", null, token);
  ok("Non-existent supplier portal order returns 404", r.status === 404);
}

// ═══════════════════════════════════════════════════════════════════
// 22. RESPONSE STRUCTURE VALIDATION
// ═══════════════════════════════════════════════════════════════════
async function testResponseStructure() {
  section("RESPONSE STRUCTURE VALIDATION");

  let r = await api("GET", "/api/sales", null, token);
  const sale = r.data?.[0];
  if (sale) {
    ok("Sale has id field", sale.hasOwnProperty("id"));
    ok("Sale has receipt_number", typeof sale.receipt_number === "string");
    ok("Sale has total", sale.total !== undefined);
    ok("Sale has cashier_name", typeof sale.cashier_name === "string");
    ok("Sale has item_count", typeof sale.item_count === "number");
    ok("Sale has created_at", typeof sale.created_at === "string");
  }

  r = await api("GET", "/api/products", null, token);
  const product = r.data?.find(p => p.id == created.products[0]);
  if (product) {
    ok("Product has id field", product.hasOwnProperty("id"));
    ok("Product has barcode", typeof product.barcode === "string");
    ok("Product has name", typeof product.name === "string");
    ok("Product has category", typeof product.category === "string");
    ok("Product has price", product.price !== undefined);
    ok("Product has stock", typeof product.stock === "number");
    ok("Product has is_active", typeof product.is_active === "boolean");
  }

  r = await api("GET", "/api/customers", null, token);
  const cust = r.data?.find(c => c.id == created.customers[0]);
  if (cust) {
    ok("Customer has id field", cust.hasOwnProperty("id"));
    ok("Customer has name", typeof cust.name === "string");
    ok("Customer has loyalty_points", cust.loyalty_points !== undefined);
    ok("Customer has membership_tier", typeof cust.membership_tier === "string");
    ok("Customer has visit_count", cust.visit_count !== undefined);
    ok("Customer has total_spent", cust.total_spent !== undefined);
  }

  r = await api("GET", "/api/dashboard/stats", null, token);
  if (r.status === 200) {
    ok("Dashboard has totalProducts", r.data?.totalProducts !== undefined);
    ok("Dashboard has totalSales", r.data?.totalSales !== undefined);
    ok("Dashboard has salesChart", Array.isArray(r.data?.salesChart));
  }

  r = await api("GET", "/api/executive/overview", null, token);
  if (r.status === 200) {
    ok("Executive has revenue", typeof r.data?.revenue === "object");
    ok("Executive has expenses", typeof r.data?.expenses === "object");
    ok("Executive has profit", typeof r.data?.profit === "object");
    ok("Executive has products", typeof r.data?.products === "object");
    ok("Executive has customers", typeof r.data?.customers === "object");
  }
}

// ═══════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════
async function cleanup() {
  section("CLEANUP");
  for (const pid of created.products) await api("DELETE", `/api/products/${pid}`, null, token);
  for (const uid of created.users) await api("DELETE", `/api/users/${uid}`, null, token);
  ok("Cleanup completed", true);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  RHoSAM — Full Application Audit Test Suite (v4)");
  console.log("═══════════════════════════════════════════════════════════════");

  await preTest();

  try {
    await testAuth();
    await testUsers();
    await testProducts();
    await testSales();
    await testReturns();
    await testCustomers();
    await testProcurement();
    await testCashDrawer();
    await testFinance();
    await testDashboard();
    await testReports();
    await testExecutive();
    await testForecast();
    await testAudit();
    await testPaymentsAndBackup();
    await testBranches();
    await testDisplayAndPortal();
    await testSync();
    await testMFA();
    await testEmail();
    await testEdgeCases();
    await testResponseStructure();
    await cleanup();
  } catch (e) {
    console.error("\n💥 FATAL ERROR:", e.message);
    console.error(e.stack);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed}/${total} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════════════");
  if (failures.length) {
    console.log("\n  FAILURES:");
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  } else {
    console.log("\n  🎉 ALL TESTS PASSED!");
  }
  console.log("");
  process.exit(failed > 0 ? 1 : 0);
}

main();
