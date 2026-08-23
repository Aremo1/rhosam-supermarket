// ═══════════════════════════════════════════════════════════════════
// RHoSAM Supermarket — System Integration Testing (SIT)
// Tests cross-module integration: POS ↔ Inventory ↔ Sales ↔ Audit
// Idempotent — safe to run multiple times
// ═══════════════════════════════════════════════════════════════════
const API = process.env.TEST_API_URL || "http://localhost:5000/api";

let pass = 0, fail = 0, total = 0;
let TOKEN = "";
let CREATED = {};
const TS = Date.now();

async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = {};
  if (text) try { data = JSON.parse(text); } catch {}
  return { status: r.status, data };
}

async function test(name, fn) {
  total++;
  try {
    const result = await fn();
    if (result === true || result === undefined) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} — ${result}`); }
  } catch (e) { fail++; console.log(`  ❌ ${name} — ${e.message}`); }
}

async function getProductStock(barcode) {
  const { status, data } = await req("GET", "/products", null, TOKEN);
  if (status !== 200 || !Array.isArray(data)) return null;
  const p = data.find(x => x.barcode === barcode);
  return p ? p.stock : null;
}

console.log("\n══════════════════════════════════════════════════════════════");
console.log("  RHoSAM Supermarket — System Integration Testing (SIT)");
console.log("══════════════════════════════════════════════════════════════\n");

// ── SETUP ─────────────────────────────────────────────────────
console.log("🔧 Setup & Authentication");
await test("Login as ADMIN", async () => {
  const { status, data } = await req("POST", "/auth/login", { email: "rhosam.rhosam@gmail.com", password: "YourStrongPassword" });
  if (status === 200 && data.token) { TOKEN = data.token; return true; }
  return `got ${status}`;
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 1: Product → POS → Stock → Audit
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 1: Product → POS → Stock → Audit");

const SIT_BARCODE = `SIT-${TS}`;

await test("Create product with known stock (10 units)", async () => {
  const { status, data } = await req("POST", "/products", {
    barcode: SIT_BARCODE, name: `SIT Product ${TS}`, category: "SIT Testing",
    price: 1000, costPrice: 500, stock: 10, reorderLevel: 2
  }, TOKEN);
  if (status === 201 && data.id) { CREATED.sitProductId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});

await test("Verify product stock is 10 before sale", async () => {
  const stock = await getProductStock(SIT_BARCODE);
  return stock === 10 ? true : `stock is ${stock}, expected 10`;
});

await test("Record stock before sale via inventory movements", async () => {
  const { status, data } = await req("GET", `/inventory/movements?product_id=${CREATED.sitProductId}`, null, TOKEN);
  CREATED.movementsBeforeSale = Array.isArray(data) ? data.length : 0;
  return status === 200 ? true : `got ${status}`;
});

await test("Create sale of 3 units — stock should drop to 7", async () => {
  const { status, data } = await req("POST", "/sales", {
    customerName: "SIT Test Customer", paymentMethod: "Cash",
    items: [{ productId: CREATED.sitProductId, quantity: 3 }], discount: 0, tax: 0
  }, TOKEN);
  if (status === 201 && data.receiptNumber) { CREATED.sitSaleId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});

await test("Verify product stock is now 7 after sale", async () => {
  const stock = await getProductStock(SIT_BARCODE);
  return stock === 7 ? true : `stock is ${stock}, expected 7`;
});

await test("Verify inventory_movement recorded with SALE type and negative qty", async () => {
  const { status, data } = await req("GET", `/inventory/movements?product_id=${CREATED.sitProductId}`, null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const saleMovement = data.find(m => m.movement_type === "SALE" && Number(m.quantity) === -3);
  return saleMovement ? true : `no SALE movement with qty -3 found`;
});

await test("Verify sale appears in sales list with correct totals", async () => {
  const { status, data } = await req("GET", `/sales/${CREATED.sitSaleId}`, null, TOKEN);
  if (status !== 200) return `got ${status}`;
  if (Number(data.total) === 3000 && data.items?.length === 1 && Number(data.items[0].quantity) === 3) return true;
  return `total=${data.total}, items=${data.items?.length}`;
});

await test("Verify audit log contains CREATE SALE entry", async () => {
  const { status, data } = await req("GET", "/audit-logs?limit=20", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const saleLog = data.find(l => l.action === "CREATE" && l.entity_type === "SALE" && l.entity_id === String(CREATED.sitSaleId));
  return saleLog ? true : "no CREATE SALE audit entry found";
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 2: Sale → Return → Stock Restoration
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 2: Sale → Return → Stock Restoration");

await test("Return 1 unit from the sale — stock should go to 8", async () => {
  const { status, data } = await req("POST", `/sales/${CREATED.sitSaleId}/return`, {
    productId: CREATED.sitProductId, quantity: 1, reason: "SIT integration test return"
  }, TOKEN);
  if (status === 200 && Number(data.refundAmount) === 1000) return true;
  return `got ${status}: ${JSON.stringify(data)}`;
});

await test("Verify product stock is 8 after return", async () => {
  const stock = await getProductStock(SIT_BARCODE);
  return stock === 8 ? true : `stock is ${stock}, expected 8`;
});

await test("Verify inventory_movement recorded with RETURN type and positive qty", async () => {
  const { status, data } = await req("GET", `/inventory/movements?product_id=${CREATED.sitProductId}`, null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const returnMovement = data.find(m => m.movement_type === "RETURN" && Number(m.quantity) === 1);
  return returnMovement ? true : "no RETURN movement with qty 1 found";
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 3: Stock Adjustment → Inventory Movement
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 3: Stock Adjustment → Inventory Movement");

await test("Adjust stock IN +5 units — stock should go to 13", async () => {
  const { status } = await req("POST", `/products/${CREATED.sitProductId}/adjust`, {
    quantity: 5, type: "STOCK_IN", notes: "SIT restock test"
  }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

await test("Verify stock is 13 after adjustment", async () => {
  const stock = await getProductStock(SIT_BARCODE);
  return stock === 13 ? true : `stock is ${stock}, expected 13`;
});

await test("Verify STOCK_IN movement recorded", async () => {
  const { status, data } = await req("GET", `/inventory/movements?product_id=${CREATED.sitProductId}`, null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const adj = data.find(m => m.movement_type === "STOCK_IN" && Number(m.quantity) === 5);
  return adj ? true : "no STOCK_IN movement with qty 5 found";
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 4: Purchase Order → Goods Receipt → Stock
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 4: Purchase Order → Goods Receipt → Stock");

await test("Create supplier for PO integration test", async () => {
  const { status, data } = await req("POST", "/suppliers", {
    name: `SIT Supplier ${TS}`, contactPerson: "Test", email: `sit-${TS}@test.com`, phone: "+2348000000000"
  }, TOKEN);
  if (status === 201 && data.id) { CREATED.sitSupplierId = data.id; return true; }
  return `got ${status}`;
});

await test("Create purchase order for 20 units", async () => {
  const { status, data } = await req("POST", "/purchase-orders", {
    supplierId: CREATED.sitSupplierId,
    items: [{ productId: CREATED.sitProductId, quantity: 20, unitCost: 500 }],
    notes: "SIT integration PO test"
  }, TOKEN);
  if (status === 201 && data.poNumber) { CREATED.sitPoId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});

await test("Approve the purchase order", async () => {
  const { status } = await req("PATCH", `/purchase-orders/${CREATED.sitPoId}/status`, { status: "APPROVED" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

await test("Receive the purchase order — stock should increase by 20", async () => {
  const { status } = await req("PATCH", `/purchase-orders/${CREATED.sitPoId}/status`, { status: "RECEIVED" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

await test("Verify product stock increased to 33 after goods receipt", async () => {
  const stock = await getProductStock(SIT_BARCODE);
  return stock === 33 ? true : `stock is ${stock}, expected 33`;
});

await test("Verify PURCHASE inventory movement recorded", async () => {
  const { status, data } = await req("GET", `/inventory/movements?product_id=${CREATED.sitProductId}`, null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const purchaseMovement = data.find(m => m.movement_type === "PURCHASE" && Number(m.quantity) === 20);
  return purchaseMovement ? true : "no PURCHASE movement with qty 20 found";
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 5: POS → Customer Loyalty → Tier
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 5: POS → Customer Loyalty → Tier");

await test("Create customer for loyalty integration test", async () => {
  const { status, data } = await req("POST", "/customers", {
    name: `SIT Loyalty ${TS}`, email: `sit-loyalty-${TS}@test.com`, phone: "+2348000000001"
  }, TOKEN);
  if (status === 201 && data.id) { CREATED.sitCustomerId = data.id; return true; }
  return `got ${status}`;
});

await test("Create sale for customer — verify loyalty points update", async () => {
  const stock = await getProductStock(SIT_BARCODE);
  const qty = Math.min(5, stock || 0);
  if (qty < 1) return "insufficient stock for loyalty test";
  const { status, data } = await req("POST", "/sales", {
    customerName: `SIT Loyalty ${TS}`, customerId: CREATED.sitCustomerId,
    paymentMethod: "Card", items: [{ productId: CREATED.sitProductId, quantity: qty }],
    discount: 0, tax: 0
  }, TOKEN);
  if (status === 201 && data.id) return true;
  return `got ${status}: ${JSON.stringify(data)}`;
});

await test("Verify customer loyalty points are positive", async () => {
  const { status, data } = await req("GET", "/customers", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const cust = data.find(c => c.id === CREATED.sitCustomerId);
  if (!cust) return "customer not found";
  return cust.loyalty_points > 0 ? true : `points=${cust.loyalty_points}`;
});

await test("Verify customer membership tier is valid", async () => {
  const { status, data } = await req("GET", "/customers", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const cust = data.find(c => c.id === CREATED.sitCustomerId);
  const validTiers = ["BRONZE", "SILVER", "GOLD", "PLATINUM"];
  return validTiers.includes(cust?.membership_tier) ? true : `tier is ${cust?.membership_tier}`;
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 6: Cash Drawer → Sales → Variance
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 6: Cash Drawer → Sales → Variance");

await test("Close any open drawer first", async () => {
  const { status, data } = await req("GET", "/cash-drawer/active", null, TOKEN);
  if (status === 200 && data?.id) {
    await req("POST", "/cash-drawer/close", { closingBalance: data.opening_balance }, TOKEN);
  }
  return true;
});

await test("Open cash drawer with ₦20,000", async () => {
  const { status, data } = await req("POST", "/cash-drawer/open", { openingBalance: 20000, drawerName: `SIT Drawer ${TS}` }, TOKEN);
  if (status === 201 && data.id) { CREATED.sitDrawerId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});

await test("Close drawer with ₦20,000 — should have zero variance", async () => {
  const { status, data } = await req("POST", "/cash-drawer/close", { closingBalance: 20000 }, TOKEN);
  if (status === 200 && Number(data.variance) === 0 && data.status === "CLOSED") return true;
  return `variance=${data.variance}, status=${data.status}`;
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 7: Auth → RBAC → Audit Trail
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 7: Auth → RBAC → Audit Trail");

await test("Create cashier user for RBAC test", async () => {
  const { status, data } = await req("POST", "/users", {
    name: `SIT Cashier ${TS}`, email: `sit-cashier-${TS}@test.com`, password: "SitCashier@12345", role: "CASHIER"
  }, TOKEN);
  if (status === 201 && data.id) { CREATED.sitCashierId = data.id; return true; }
  return `got ${status}`;
});

await test("Login as cashier — should get token", async () => {
  const { status, data } = await req("POST", "/auth/login", { email: `sit-cashier-${TS}@test.com`, password: "SitCashier@12345" });
  if (status === 200 && data.token) { CREATED.cashierToken = data.token; return true; }
  return `got ${status}`;
});

await test("Cashier can access products (allowed)", async () => {
  const { status } = await req("GET", "/products", null, CREATED.cashierToken);
  return status === 200 ? true : `got ${status}`;
});

await test("Cashier CANNOT access user management (RBAC enforced)", async () => {
  const { status } = await req("GET", "/users", null, CREATED.cashierToken);
  return status === 403 ? true : `got ${status}, expected 403`;
});

await test("Cashier CANNOT access audit logs (RBAC enforced)", async () => {
  const { status } = await req("GET", "/audit-logs", null, CREATED.cashierToken);
  return status === 403 ? true : `got ${status}, expected 403`;
});

await test("Verify login is logged in audit trail", async () => {
  const { status, data } = await req("GET", "/audit-logs/login-history?limit=50", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const loginLog = data.find(l => l.action === "LOGIN" && l.email === `sit-cashier-${TS}@test.com`);
  return loginLog ? true : "LOGIN audit entry not found for cashier";
});

// ── SUMMARY ────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log(`  SIT RESULTS: ${pass}/${total} passed, ${fail} failed`);
console.log("══════════════════════════════════════════════════════════════\n");

if (fail === 0) {
  console.log("  🎉 ALL INTEGRATION TESTS PASSED — Cross-module integration verified!");
} else {
  console.log(`  ⚠️  ${fail} test(s) need attention.`);
}

process.exit(fail > 0 ? 1 : 0);
