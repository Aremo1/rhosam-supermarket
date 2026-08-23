// RHoSAM Supermarket API — Comprehensive Endpoint Test Suite
const API = "http://localhost:5000/api";

let pass = 0, fail = 0, total = 0;
let TOKEN = "";
let CREATED = {};

async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = {};
  if (text) try { data = JSON.parse(text); } catch {}
  return { status: r.status, data };
}

async function test(name, fn) {
  total++;
  try {
    const result = await fn();
    if (result === true || result === undefined) {
      pass++;
      console.log(`  ✅ ${name}`);
    } else {
      fail++;
      console.log(`  ❌ ${name} — ${result}`);
    }
  } catch (e) {
    fail++;
    console.log(`  ❌ ${name} — ${e.message}`);
  }
}

console.log("\n══════════════════════════════════════════════════════════════");
console.log("  RHoSAM Supermarket — API Endpoint Test Suite (46 Endpoints)");
console.log("══════════════════════════════════════════════════════════════\n");

// ── PHASE 7: AUTHENTICATION ────────────────────────────────────
console.log("🔐 Phase 7: Authentication");
await test("GET /api/health → 200", async () => {
  const { status, data } = await req("GET", "/health");
  return status === 200 && data.status === "ok" ? true : `got ${status}`;
});
await test("POST /api/auth/login → 200 (valid credentials)", async () => {
  const { status, data } = await req("POST", "/auth/login", { email: "rhosam.rhosam@gmail.com", password: "YourStrongPassword" });
  if (status === 200 && data.token) { TOKEN = data.token; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("POST /api/auth/login → 401 (wrong password)", async () => {
  const { status } = await req("POST", "/auth/login", { email: "rhosam.rhosam@gmail.com", password: "wrong" });
  return status === 401 ? true : `got ${status}`;
});
await test("GET /api/auth/me → 200 (with token)", async () => {
  const { status, data } = await req("GET", "/auth/me", null, TOKEN);
  return status === 200 && data.user?.email ? true : `got ${status}`;
});
await test("GET /api/auth/me → 401 (no token)", async () => {
  const { status } = await req("GET", "/auth/me");
  return status === 401 ? true : `got ${status}`;
});  await test("POST /api/auth/change-password → 200", async () => {
  const { status, data } = await req("POST", "/auth/change-password", { currentPassword: "YourStrongPassword", newPassword: "YourStrongPassword1" }, TOKEN);
  if (status === 200) {
    await req("POST", "/auth/change-password", { currentPassword: "YourStrongPassword1", newPassword: "YourStrongPassword" }, TOKEN);
    return true;
  }
  return `got ${status}: ${data.message}`;
});
await test("POST /api/auth/change-password → 401 (wrong current password)", async () => {
  const { status } = await req("POST", "/auth/change-password", { currentPassword: "wrongpassword", newPassword: "NewPass@12345678" }, TOKEN);
  return status === 401 ? true : `got ${status}`;
});

// ── PHASE 8: USER MANAGEMENT ───────────────────────────────────
console.log("\n👤 Phase 8: User Management");
await test("GET /api/users → 200 (list users)", async () => {
  const { status, data } = await req("GET", "/users", null, TOKEN);
  if (status === 200 && Array.isArray(data)) { CREATED.userId = data[0]?.id; return true; }
  return `got ${status}`;
});
await test("POST /api/users → 201 (create user)", async () => {
  const { status, data } = await req("POST", "/users", { name: "Test Cashier", email: "cashier@test.com", password: "Cashier@12345", role: "CASHIER" }, TOKEN);
  if (status === 201 && data.id) { CREATED.cashierId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("POST /api/users → 409 (duplicate email)", async () => {
  const { status } = await req("POST", "/users", { name: "Dup", email: "cashier@test.com", password: "Cashier@12345", role: "CASHIER" }, TOKEN);
  return status === 409 ? true : `got ${status}`;
});
await test("PATCH /api/users/:id → 200 (update role)", async () => {
  const { status, data } = await req("PATCH", `/users/${CREATED.cashierId}`, { role: "MANAGER" }, TOKEN);
  return status === 200 && data.role === "MANAGER" ? true : `got ${status}`;
});
await test("PATCH /api/users/:id → 200 (unlock user)", async () => {
  const { status } = await req("PATCH", `/users/${CREATED.cashierId}`, { unlock: true }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("DELETE /api/users/:id → 200 (delete user)", async () => {
  const { status } = await req("DELETE", `/users/${CREATED.cashierId}`, null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

// ── PHASE 8: AUDIT LOGS ────────────────────────────────────────
console.log("\n📝 Phase 8: Audit Logs");
await test("GET /api/audit-logs → 200", async () => {
  const { status, data } = await req("GET", "/audit-logs", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});

// ── PHASE 3: PRODUCTS ──────────────────────────────────────────
console.log("\n📦 Phase 3: Products & Inventory");
await test("GET /api/products → 200 (list products)", async () => {
  const { status, data } = await req("GET", "/products", null, TOKEN);
  if (status === 200 && Array.isArray(data)) { CREATED.productId = data[0]?.id; return true; }
  return `got ${status}`;
});
await test("GET /api/products?search=test → 200 (search)", async () => {
  const { status } = await req("GET", "/products?search=test", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("POST /api/products → 201 (create product)", async () => {
  const { status, data } = await req("POST", "/products", { barcode: "NEWBAR1", name: "New Product", category: "New", price: 1000, stock: 50, reorderLevel: 5 }, TOKEN);
  if (status === 201 && data.id) { CREATED.newProductId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("PUT /api/products/:id → 200 (update product)", async () => {
  const { status, data } = await req("PUT", `/products/${CREATED.newProductId}`, { price: 1200 }, TOKEN);
  return status === 200 && data.price === 1200 ? true : `got ${status}`;
});
await test("POST /api/products/:id/adjust → 200 (stock adjustment)", async () => {
  const { status } = await req("POST", `/products/${CREATED.productId}/adjust`, { quantity: 10, type: "STOCK_IN", notes: "Test restock" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("GET /api/products/low-stock → 200", async () => {
  const { status } = await req("GET", "/products/low-stock", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("DELETE /api/products/:id → 200 (delete product)", async () => {
  const { status } = await req("DELETE", `/products/${CREATED.newProductId}`, null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("GET /api/inventory/movements → 200", async () => {
  const { status } = await req("GET", "/inventory/movements", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("GET /api/categories → 200", async () => {
  const { status } = await req("GET", "/categories", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

// ── PHASE 5: SALES ─────────────────────────────────────────────
console.log("\n💰 Phase 5: Sales & Returns");
await test("POST /api/sales → 201 (create sale)", async () => {
  const { status, data } = await req("POST", "/sales", {
    customerName: "Walk-in Customer", paymentMethod: "Cash",
    items: [{ productId: CREATED.productId, quantity: 2 }], discount: 0, tax: 0
  }, TOKEN);
  if (status === 201 && data.receiptNumber) { CREATED.saleId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("GET /api/sales → 200 (list sales)", async () => {
  const { status, data } = await req("GET", "/sales", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});
await test("GET /api/sales/:id → 200 (sale detail)", async () => {
  const { status, data } = await req("GET", `/sales/${CREATED.saleId}`, null, TOKEN);
  return status === 200 && data.items?.length ? true : `got ${status}`;
});
await test("POST /api/sales/:id/return → 200 (return item)", async () => {
  const { status, data } = await req("POST", `/sales/${CREATED.saleId}/return`, {
    productId: CREATED.productId, quantity: 1, reason: "Test return"
  }, TOKEN);
  return status === 200 && data.refundAmount ? true : `got ${status}: ${JSON.stringify(data)}`;
});

// ── PHASE 9: DASHBOARD ─────────────────────────────────────────
console.log("\n📊 Phase 9: Dashboard / BI");
await test("GET /api/dashboard/stats → 200", async () => {
  const { status, data } = await req("GET", "/dashboard/stats", null, TOKEN);
  return status === 200 && data.totalProducts !== undefined ? true : `got ${status}`;
});
await test("GET /api/dashboard/top-products → 200", async () => {
  const { status } = await req("GET", "/dashboard/top-products", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("GET /api/dashboard/category-sales → 200", async () => {
  const { status } = await req("GET", "/dashboard/category-sales", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

// ── PHASE 10: SUPPLIERS ────────────────────────────────────────
console.log("\n🏭 Phase 10: Suppliers");
await test("GET /api/suppliers → 200", async () => {
  const { status, data } = await req("GET", "/suppliers", null, TOKEN);
  if (status === 200 && Array.isArray(data)) { CREATED.supplierId = data[0]?.id; return true; }
  return `got ${status}`;
});
await test("POST /api/suppliers → 201", async () => {
  const { status, data } = await req("POST", "/suppliers", { name: "New Supplier", contactPerson: "Jane", email: "jane@supplier.com" }, TOKEN);
  if (status === 201 && data.id) { CREATED.newSupplierId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("PUT /api/suppliers/:id → 200", async () => {
  const { status } = await req("PUT", `/suppliers/${CREATED.newSupplierId}`, { name: "Updated Supplier" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("DELETE /api/suppliers/:id → 200", async () => {
  const { status } = await req("DELETE", `/suppliers/${CREATED.newSupplierId}`, null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

// ── PHASE 10: PURCHASE ORDERS ──────────────────────────────────
console.log("\n📥 Phase 10: Purchase Orders");
await test("POST /api/purchase-orders → 201", async () => {
  const { status, data } = await req("POST", "/purchase-orders", {
    supplierId: CREATED.supplierId,
    items: [{ productId: CREATED.productId, quantity: 20, unitCost: 400 }],
    notes: "Test PO"
  }, TOKEN);
  if (status === 201 && data.poNumber) { CREATED.poId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("GET /api/purchase-orders → 200", async () => {
  const { status } = await req("GET", "/purchase-orders", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("GET /api/purchase-orders/:id → 200 (detail)", async () => {
  const { status, data } = await req("GET", `/purchase-orders/${CREATED.poId}`, null, TOKEN);
  return status === 200 && data.items?.length ? true : `got ${status}`;
});
await test("PATCH /api/purchase-orders/:id/status → 200 (approve)", async () => {
  const { status } = await req("PATCH", `/purchase-orders/${CREATED.poId}/status`, { status: "APPROVED" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("PATCH /api/purchase-orders/:id/status → 200 (receive)", async () => {
  const { status } = await req("PATCH", `/purchase-orders/${CREATED.poId}/status`, { status: "RECEIVED" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

// ── PHASE 12: CUSTOMERS ────────────────────────────────────────
console.log("\n👥 Phase 12: Customers / CRM");
await test("GET /api/customers → 200", async () => {
  const { status, data } = await req("GET", "/customers", null, TOKEN);
  if (status === 200 && Array.isArray(data)) { CREATED.customerId = data[0]?.id; return true; }
  return `got ${status}`;
});
await test("POST /api/customers → 201", async () => {
  const { status, data } = await req("POST", "/customers", { name: "New Customer", email: "new@cust.com", phone: "+2348000000000" }, TOKEN);
  if (status === 201 && data.id) { CREATED.newCustId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("PUT /api/customers/:id → 200", async () => {
  const { status } = await req("PUT", `/customers/${CREATED.newCustId}`, { name: "Updated Customer" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

// ── PHASE 13: EXPENSES ─────────────────────────────────────────
console.log("\n💸 Phase 13: Expenses & Finance");
await test("POST /api/expenses → 201", async () => {
  const { status, data } = await req("POST", "/expenses", { category: "Utilities", description: "Electricity bill", amount: 50000 }, TOKEN);
  if (status === 201 && data.id) { CREATED.expenseId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("GET /api/expenses → 200", async () => {
  const { status } = await req("GET", "/expenses", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("GET /api/finance/summary → 200", async () => {
  const { status, data } = await req("GET", "/finance/summary", null, TOKEN);
  return status === 200 && data.revenue !== undefined ? true : `got ${status}`;
});

// ── PHASE 14: BRANCHES ─────────────────────────────────────────
console.log("\n🏢 Phase 14: Branches");
await test("GET /api/branches → 200 (list)", async () => {
  const { status, data } = await req("GET", "/branches", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});
await test("POST /api/branches → 201 (create)", async () => {
  const { status, data } = await req("POST", "/branches", { name: "Test Branch", address: "123 Test St", phone: "+2348000000001" }, TOKEN);
  if (status === 201 && data.id) { CREATED.branchId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("PUT /api/branches/:id → 200 (update)", async () => {
  const { status } = await req("PUT", `/branches/${CREATED.branchId}`, { name: "Updated Branch" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("DELETE /api/branches/:id → 200 (delete)", async () => {
  const { status } = await req("DELETE", `/branches/${CREATED.branchId}`, null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

// ── PHASE 14: CASH DRAWER ──────────────────────────────────────
console.log("\n💵 Phase 14: Cash Drawer");
await test("GET /api/cash-drawer → 200 (history)", async () => {
  const { status, data } = await req("GET", "/cash-drawer", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});
await test("GET /api/cash-drawer/active → 200 (or null)", async () => {
  const { status } = await req("GET", "/cash-drawer/active", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("POST /api/cash-drawer/open → 201", async () => {
  // Close any previously open drawer first (from prior test runs)
  const active = await req("GET", "/cash-drawer/active", null, TOKEN);
  if (active.data?.id) {
    await req("POST", "/cash-drawer/close", { closingBalance: active.data.opening_balance }, TOKEN);
  }
  const { status, data } = await req("POST", "/cash-drawer/open", { openingBalance: 10000, drawerName: "Test Drawer" }, TOKEN);
  if (status === 201 && data.id) { CREATED.drawerId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("POST /api/cash-drawer/open → 409 (already open)", async () => {
  const { status } = await req("POST", "/cash-drawer/open", { openingBalance: 0 }, TOKEN);
  return status === 409 ? true : `got ${status}`;
});
await test("POST /api/cash-drawer/close → 200", async () => {
  const { status, data } = await req("POST", "/cash-drawer/close", { closingBalance: 10000 }, TOKEN);
  return status === 200 && data.status === "CLOSED" ? true : `got ${status}: ${JSON.stringify(data)}`;
});

// ── RBAC ───────────────────────────────────────────────────────
console.log("\n🔒 RBAC Enforcement");
await test("No token → 401 on /api/users", async () => {
  const { status } = await req("GET", "/users");
  return status === 401 ? true : `got ${status}`;
});
await test("No token → 401 on /api/products", async () => {
  const { status } = await req("GET", "/products");
  return status === 401 ? true : `got ${status}`;
});

// ── SUMMARY ────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log(`  RESULTS: ${pass}/${total} passed, ${fail} failed`);
console.log("══════════════════════════════════════════════════════════════\n");

process.exit(fail > 0 ? 1 : 0);
