// ═══════════════════════════════════════════════════════════════════
// RHoSAM Supermarket — Complete UAT Test Suite (70+ Endpoints)
// ═══════════════════════════════════════════════════════════════════
const API = process.env.TEST_API_URL || "http://localhost:5000/api";

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
console.log("  RHoSAM Supermarket — UAT Test Suite");
console.log("══════════════════════════════════════════════════════════════\n");

// ── HEALTH ─────────────────────────────────────────────────────
console.log("🏥 Health Check");
await test("GET /api/health → 200", async () => {
  const { status, data } = await req("GET", "/health");
  return status === 200 && data.status === "ok" ? true : `got ${status}`;
});

// ── AUTHENTICATION ─────────────────────────────────────────────
console.log("\n🔐 Authentication");
await test("POST /api/auth/login → 200 (valid)", async () => {
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
});
await test("POST /api/auth/change-password → 200", async () => {
  const { status } = await req("POST", "/auth/change-password", { currentPassword: "YourStrongPassword", newPassword: "YourStrongPassword1" }, TOKEN);
  if (status === 200) {
    await req("POST", "/auth/change-password", { currentPassword: "YourStrongPassword1", newPassword: "YourStrongPassword" }, TOKEN);
    return true;
  }
  return `got ${status}`;
});
await test("POST /api/auth/change-password → 401 (wrong current)", async () => {
  const { status } = await req("POST", "/auth/change-password", { currentPassword: "wrong", newPassword: "NewPass@12345678" }, TOKEN);
  return status === 401 ? true : `got ${status}`;
});

// ── USER MANAGEMENT ────────────────────────────────────────────
console.log("\n👤 User Management");
await test("GET /api/users → 200", async () => {
  const { status, data } = await req("GET", "/users", null, TOKEN);
  if (status === 200 && Array.isArray(data)) { CREATED.userId = data[0]?.id; return true; }
  return `got ${status}`;
});
await test("POST /api/users → 201 (create)", async () => {
  const { status, data } = await req("POST", "/users", { name: "UAT Cashier", email: "uat@test.com", password: "UatPass@12345", role: "CASHIER" }, TOKEN);
  if (status === 201 && data.id) { CREATED.cashierId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("POST /api/users → 409 (duplicate)", async () => {
  const { status } = await req("POST", "/users", { name: "Dup", email: "uat@test.com", password: "UatPass@12345", role: "CASHIER" }, TOKEN);
  return status === 409 ? true : `got ${status}`;
});
await test("PATCH /api/users/:id → 200 (update role)", async () => {
  const { status, data } = await req("PATCH", `/users/${CREATED.cashierId}`, { role: "MANAGER" }, TOKEN);
  return status === 200 && data.role === "MANAGER" ? true : `got ${status}`;
});
await test("PATCH /api/users/:id → 200 (unlock)", async () => {
  const { status } = await req("PATCH", `/users/${CREATED.cashierId}`, { unlock: true }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("DELETE /api/users/:id → 200", async () => {
  const { status } = await req("DELETE", `/users/${CREATED.cashierId}`, null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

// ── AUDIT LOGS ─────────────────────────────────────────────────
console.log("\n📝 Audit Logs");
await test("GET /api/audit-logs → 200", async () => {
  const { status, data } = await req("GET", "/audit-logs", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});

// ── PRODUCTS ───────────────────────────────────────────────────
console.log("\n📦 Products");
await test("GET /api/products → 200", async () => {
  const { status, data } = await req("GET", "/products", null, TOKEN);
  if (status === 200 && Array.isArray(data)) { CREATED.productId = data[0]?.id; return true; }
  return `got ${status}`;
});
await test("GET /api/products?search=test → 200 (search)", async () => {
  const { status } = await req("GET", "/products?search=test", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("POST /api/products → 201 (create)", async () => {
  const { status, data } = await req("POST", "/products", { barcode: "UATBAR1", name: "UAT Product", category: "Testing", price: 500, stock: 20, reorderLevel: 5 }, TOKEN);
  if (status === 201 && data.id) { CREATED.newProductId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("PUT /api/products/:id → 200 (update)", async () => {
  const { status, data } = await req("PUT", `/products/${CREATED.newProductId}`, { price: 600 }, TOKEN);
  return status === 200 && data.price === 600 ? true : `got ${status}`;
});
await test("POST /api/products/:id/adjust → 200 (stock adj)", async () => {
  const { status } = await req("POST", `/products/${CREATED.productId}/adjust`, { quantity: 5, type: "STOCK_IN", notes: "UAT restock" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("GET /api/products/low-stock → 200", async () => {
  const { status } = await req("GET", "/products/low-stock", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("DELETE /api/products/:id → 200", async () => {
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

// ── SALES ──────────────────────────────────────────────────────
console.log("\n💰 Sales & Returns");
await test("POST /api/sales → 201 (create sale)", async () => {
  const { status, data } = await req("POST", "/sales", {
    customerName: "UAT Customer", paymentMethod: "Cash",
    items: [{ productId: CREATED.productId, quantity: 2 }], discount: 0, tax: 0
  }, TOKEN);
  if (status === 201 && data.receiptNumber) { CREATED.saleId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("GET /api/sales → 200 (list)", async () => {
  const { status, data } = await req("GET", "/sales", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});
await test("GET /api/sales/:id → 200 (detail)", async () => {
  const { status, data } = await req("GET", `/sales/${CREATED.saleId}`, null, TOKEN);
  return status === 200 && data.items?.length ? true : `got ${status}`;
});
await test("POST /api/sales/:id/return → 200 (return item)", async () => {
  const { status, data } = await req("POST", `/sales/${CREATED.saleId}/return`, {
    productId: CREATED.productId, quantity: 1, reason: "UAT test return"
  }, TOKEN);
  return status === 200 && data.refundAmount ? true : `got ${status}: ${JSON.stringify(data)}`;
});
await test("POST /api/sales/:id/email-receipt → 200 (email receipt)", async () => {
  const { status } = await req("POST", `/sales/${CREATED.saleId}/email-receipt`, { email: "test@example.com" }, TOKEN);
  // May fail if RESEND_API_KEY not set — that's OK
  return status === 200 || status === 503 ? true : `got ${status}`;
});

// ── DASHBOARD ──────────────────────────────────────────────────
console.log("\n📊 Dashboard & BI");
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

// ── SUPPLIERS ──────────────────────────────────────────────────
console.log("\n🏭 Suppliers");
await test("GET /api/suppliers → 200", async () => {
  const { status, data } = await req("GET", "/suppliers", null, TOKEN);
  if (status === 200 && Array.isArray(data)) { CREATED.supplierId = data[0]?.id; return true; }
  return `got ${status}`;
});
await test("POST /api/suppliers → 201", async () => {
  const { status, data } = await req("POST", "/suppliers", { name: "UAT Supplier", contactPerson: "Test", email: "uat@supplier.com" }, TOKEN);
  if (status === 201 && data.id) { CREATED.newSupplierId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("PUT /api/suppliers/:id → 200", async () => {
  const { status } = await req("PUT", `/suppliers/${CREATED.newSupplierId}`, { name: "Updated UAT" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("DELETE /api/suppliers/:id → 200", async () => {
  const { status } = await req("DELETE", `/suppliers/${CREATED.newSupplierId}`, null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

// ── PURCHASE ORDERS ────────────────────────────────────────────
console.log("\n📥 Purchase Orders");
await test("POST /api/purchase-orders → 201", async () => {
  const { status, data } = await req("POST", "/purchase-orders", {
    supplierId: CREATED.supplierId,
    items: [{ productId: CREATED.productId, quantity: 15, unitCost: 300 }],
    notes: "UAT test PO"
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

// ── CUSTOMERS ──────────────────────────────────────────────────
console.log("\n👥 Customers");
await test("GET /api/customers → 200", async () => {
  const { status, data } = await req("GET", "/customers", null, TOKEN);
  if (status === 200 && Array.isArray(data)) { CREATED.customerId = data[0]?.id; return true; }
  return `got ${status}`;
});
await test("POST /api/customers → 201", async () => {
  const { status, data } = await req("POST", "/customers", { name: "UAT Customer", email: "uat@cust.com", phone: "+2348000000000" }, TOKEN);
  if (status === 201 && data.id) { CREATED.newCustId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("PUT /api/customers/:id → 200", async () => {
  const { status } = await req("PUT", `/customers/${CREATED.newCustId}`, { name: "Updated UAT" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

// ── EXPENSES & FINANCE ────────────────────────────────────────
console.log("\n💸 Expenses & Finance");
await test("POST /api/expenses → 201", async () => {
  const { status, data } = await req("POST", "/expenses", { category: "UAT Testing", description: "Test expense", amount: 10000 }, TOKEN);
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

// ── REPORTS ────────────────────────────────────────────────────
console.log("\n📈 Reports");
await test("GET /api/reports/daily → 200", async () => {
  const { status, data } = await req("GET", "/reports/daily", null, TOKEN);
  return status === 200 && data.summary ? true : `got ${status}`;
});
await test("GET /api/reports/monthly → 200", async () => {
  const { status, data } = await req("GET", "/reports/monthly", null, TOKEN);
  return status === 200 && Array.isArray(data.data) ? true : `got ${status}`;
});
await test("GET /api/reports/product-sales → 200", async () => {
  const { status, data } = await req("GET", "/reports/product-sales", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});
await test("GET /api/reports/low-stock → 200", async () => {
  const { status, data } = await req("GET", "/reports/low-stock", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});
await test("GET /api/reports/cashier-sales → 200", async () => {
  const { status, data } = await req("GET", "/reports/cashier-sales", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});

// ── AI FORECASTING ─────────────────────────────────────────────
console.log("\n🤖 AI Forecasting");
await test("GET /api/forecast/demand → 200", async () => {
  const { status, data } = await req("GET", "/forecast/demand", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});

// ── AUTO REORDER ───────────────────────────────────────────────
console.log("\n🔄 Auto Reorder");
await test("GET /api/auto-reorder/suggestions → 200", async () => {
  const { status, data } = await req("GET", "/auto-reorder/suggestions", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});

// ── EXECUTIVE DASHBOARD ────────────────────────────────────────
console.log("\n🎯 Executive Dashboard");
await test("GET /api/executive/overview → 200", async () => {
  const { status, data } = await req("GET", "/executive/overview", null, TOKEN);
  return status === 200 && data.revenue ? true : `got ${status}`;
});

// ── CUSTOMER DISPLAY ───────────────────────────────────────────
console.log("\n🖥️ Customer Display");
await test("GET /api/customer-display/:id → 200", async () => {
  const { status, data } = await req("GET", `/customer-display/${CREATED.saleId}`, null, TOKEN);
  return status === 200 && data.display ? true : `got ${status}`;
});
await test("GET /api/customer-display/999999 → 404", async () => {
  const { status } = await req("GET", "/customer-display/999999", null, TOKEN);
  return status === 404 ? true : `got ${status}`;
});

// ── SUPPLIER PORTAL ────────────────────────────────────────────
console.log("\n🏭 Supplier Portal");
await test("GET /api/supplier-portal/orders/:id → 200", async () => {
  const { status, data } = await req("GET", `/supplier-portal/orders/${CREATED.supplierId}`, null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});
await test("GET /api/supplier-portal/order/:id → 200", async () => {
  const { status, data } = await req("GET", `/supplier-portal/order/${CREATED.poId}`, null, TOKEN);
  return status === 200 && data.items ? true : `got ${status}`;
});

// ── BRANCHES ───────────────────────────────────────────────────
console.log("\n🏢 Branches");
await test("GET /api/branches → 200", async () => {
  const { status, data } = await req("GET", "/branches", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});
await test("POST /api/branches → 201 (create)", async () => {
  const { status, data } = await req("POST", "/branches", { name: "UAT Branch", address: "123 Test St", phone: "+2348000000001" }, TOKEN);
  if (status === 201 && data.id) { CREATED.branchId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("PUT /api/branches/:id → 200 (update)", async () => {
  const { status } = await req("PUT", `/branches/${CREATED.branchId}`, { name: "Updated UAT Branch" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("DELETE /api/branches/:id → 200 (delete)", async () => {
  const { status } = await req("DELETE", `/branches/${CREATED.branchId}`, null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

// ── CASH DRAWER ────────────────────────────────────────────────
console.log("\n💵 Cash Drawer");
await test("GET /api/cash-drawer → 200 (history)", async () => {
  const { status, data } = await req("GET", "/cash-drawer", null, TOKEN);
  return status === 200 && Array.isArray(data) ? true : `got ${status}`;
});
await test("GET /api/cash-drawer/active → 200", async () => {
  const { status } = await req("GET", "/cash-drawer/active", null, TOKEN);
  return status === 200 ? true : `got ${status}`;
});
await test("POST /api/cash-drawer/open → 201", async () => {
  const active = await req("GET", "/cash-drawer/active", null, TOKEN);
  if (active.data?.id) await req("POST", "/cash-drawer/close", { closingBalance: active.data.opening_balance }, TOKEN);
  const { status, data } = await req("POST", "/cash-drawer/open", { openingBalance: 15000, drawerName: "UAT Drawer" }, TOKEN);
  if (status === 201 && data.id) { CREATED.drawerId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});
await test("POST /api/cash-drawer/open → 409 (already open)", async () => {
  const { status } = await req("POST", "/cash-drawer/open", { openingBalance: 0 }, TOKEN);
  return status === 409 ? true : `got ${status}`;
});
await test("POST /api/cash-drawer/close → 200", async () => {
  const { status, data } = await req("POST", "/cash-drawer/close", { closingBalance: 15000 }, TOKEN);
  return status === 200 && data.status === "CLOSED" ? true : `got ${status}: ${JSON.stringify(data)}`;
});

// ── OFFLINE SYNC ───────────────────────────────────────────────
console.log("\n📴 Offline Sync");
await test("POST /api/sync/sales → 200 (sync offline sale)", async () => {
  const { status, data } = await req("POST", "/sync/sales", {
    sales: [{ localId: "offline-1", customerName: "Offline Customer", paymentMethod: "Cash", items: [{ productId: CREATED.productId, quantity: 1, name: "Test Product" }], discount: 0, tax: 0, amountPaid: 500 }]
  }, TOKEN);
  return status === 200 && data.synced >= 1 ? true : `got ${status}: ${JSON.stringify(data)}`;
});
await test("POST /api/sync/sales → 400 (empty)", async () => {
  const { status } = await req("POST", "/sync/sales", { sales: [] }, TOKEN);
  return status === 400 ? true : `got ${status}`;
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
await test("No token → 401 on /api/sales", async () => {
  const { status } = await req("GET", "/sales");
  return status === 401 ? true : `got ${status}`;
});

// ── SUMMARY ────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log(`  UAT RESULTS: ${pass}/${total} passed, ${fail} failed`);
console.log("══════════════════════════════════════════════════════════════\n");

if (fail === 0) {
  console.log("  🎉 ALL TESTS PASSED — Ready for production!");
} else {
  console.log(`  ⚠️  ${fail} test(s) need attention.`);
}

process.exit(fail > 0 ? 1 : 0);
