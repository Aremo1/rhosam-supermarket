// ═══════════════════════════════════════════════════════════════════
// RHoSAM Supermarket — System Integration Testing (SIT)
// Tests cross-module integration: POS ↔ Inventory ↔ Sales ↔ Audit
// Covers: Products, POS, Returns, Stock Adjustments, Purchase Orders,
//         Customer Loyalty, Cash Drawer, RBAC, Expiry Tracking,
//         Inventory Audits, Stock Alerts, Notifications, Valuation
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

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 8: Expiry Tracking
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 8: Expiry Tracking");

const SIT_EXPIRY_BARCODE = `SIT-EXP-${TS}`;

await test("Create product with expiry date in the past", async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const { status, data } = await req("POST", "/products", {
    barcode: SIT_EXPIRY_BARCODE, name: `SIT Expiry Product ${TS}`, category: "SIT Testing",
    price: 500, costPrice: 300, stock: 5, reorderLevel: 1,
    expiryDate: yesterday, batchNumber: `BATCH-EXP-${TS}`
  }, TOKEN);
  if (status === 201 && data.id) { CREATED.sitExpiryProductId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});

await test("Verify product has expiry_date and batch_number saved", async () => {
  const { status, data } = await req("GET", "/products", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const p = data.find(x => x.id === CREATED.sitExpiryProductId);
  if (!p) return "product not found";
  if (!p.expiry_date) return "expiry_date not saved";
  if (p.batch_number !== `BATCH-EXP-${TS}`) return `batch_number is ${p.batch_number}`;
  return true;
});

await test("Query expiring products — should find our expired product", async () => {
  const { status, data } = await req("GET", "/inventory/expiring?days=90", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const found = data.products?.find(p => p.id === CREATED.sitExpiryProductId);
  return found ? true : "expired product not found in expiring list";
});

await test("Record expiry event for the product", async () => {
  const { status } = await req("POST", "/inventory/expiry-event", {
    productId: CREATED.sitExpiryProductId, eventType: "DISPOSED", quantity: 2, notes: "SIT test disposal"
  }, TOKEN);
  return status === 201 ? true : `got ${status}`;
});

await test("Verify expiry event was logged", async () => {
  const { status, data } = await req("GET", "/inventory/expiry-events", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const event = data.find(e => e.product_id === CREATED.sitExpiryProductId && e.event_type === "DISPOSED");
  return event ? true : "DISPOSED event not found in expiry events";
});

await test("Verify stock decreased after expiry disposal (from 5 to 3)", async () => {
  const { status, data } = await req("GET", "/products", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const p = data.find(x => x.id === CREATED.sitExpiryProductId);
  return p?.stock === 3 ? true : `stock is ${p?.stock}, expected 3`;
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 9: Valuation Snapshots & Trend
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 9: Valuation Snapshots & Trend");

await test("Capture valuation snapshot", async () => {
  const { status, data } = await req("POST", "/inventory/snapshot", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  if (!data.snapshot?.id) return "missing snapshot id";
  if (data.summary?.totalValue === undefined) return "missing totalValue";
  CREATED.snapshotId = data.snapshot.id;
  return true;
});

await test("Verify snapshot appears in trend history", async () => {
  const { status, data } = await req("GET", "/inventory/trend?days=7", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  if (!Array.isArray(data.trend)) return "missing trend array";
  const found = data.trend.find(t => t.id === CREATED.snapshotId);
  return found ? true : "snapshot not found in trend";
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 10: Inventory Audit Cycle
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 10: Inventory Audit Cycle");

await test("Create inventory audit", async () => {
  const { status, data } = await req("POST", "/inventory-audits", {
    title: `SIT Audit ${TS}`, notes: "SIT integration test audit"
  }, TOKEN);
  if (status === 201 && data.id) { CREATED.sitAuditId = data.id; return true; }
  return `got ${status}: ${JSON.stringify(data)}`;
});

await test("Verify audit has items populated from products", async () => {
  const { status, data } = await req("GET", `/inventory-audits/${CREATED.sitAuditId}`, null, TOKEN);
  if (status !== 200) return `got ${status}`;
  if (!data.items || data.items.length === 0) return "audit has no items";
  CREATED.sitAuditItemId = data.items[0].id;
  return true;
});

await test("Start the audit", async () => {
  const { status } = await req("PATCH", `/inventory-audits/${CREATED.sitAuditId}/status`, { status: "IN_PROGRESS" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

await test("Record a count for an audit item", async () => {
  const { status } = await req("PATCH", `/inventory-audits/${CREATED.sitAuditId}/items/${CREATED.sitAuditItemId}`, {
    countedQuantity: 10, notes: "SIT test count"
  }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

await test("Complete the audit", async () => {
  const { status } = await req("PATCH", `/inventory-audits/${CREATED.sitAuditId}/status`, { status: "COMPLETED" }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

await test("Verify audit shows completion summary", async () => {
  const { status, data } = await req("GET", `/inventory-audits/${CREATED.sitAuditId}`, null, TOKEN);
  if (status !== 200) return `got ${status}`;
  if (data.status !== "COMPLETED") return `status is ${data.status}`;
  if (data.total_items === undefined) return "missing total_items";
  return true;
});

await test("List audits shows our completed audit", async () => {
  const { status, data } = await req("GET", "/inventory-audits", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  const found = data.find(a => a.id === CREATED.sitAuditId);
  return found ? true : "audit not found in list";
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 11: Stock Alerts
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 11: Stock Alerts");

await test("List alert rules", async () => {
  const { status, data } = await req("GET", "/alert-rules", null, TOKEN);
  if (status === 200 && Array.isArray(data)) { CREATED.sitRuleId = data[0]?.id; return true; }
  return `got ${status}`;
});

await test("Scan for stock alerts", async () => {
  const { status, data } = await req("POST", "/stock-alerts/scan", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  return typeof data.generated === "number" ? true : `missing generated count`;
});

await test("Get active stock alerts", async () => {
  const { status, data } = await req("GET", "/stock-alerts", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  if (!Array.isArray(data.alerts)) return "missing alerts array";
  if (typeof data.total !== "number") return "missing total count";
  return true;
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 12: Notification Preferences & Log
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 12: Notification Preferences & Log");

await test("Get notification preferences", async () => {
  const { status, data } = await req("GET", "/notifications/preferences", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  if (!Array.isArray(data)) return "not an array";
  // Should have at least LOW_STOCK default
  const hasLowStock = data.some(p => p.event_type === "LOW_STOCK");
  return hasLowStock ? true : "missing LOW_STOCK preference";
});

await test("Update notification preferences", async () => {
  const { status } = await req("PUT", "/notifications/preferences", {
    preferences: [
      { event_type: "LOW_STOCK", email_enabled: true, sms_enabled: false },
      { event_type: "OUT_OF_STOCK", email_enabled: false, sms_enabled: false }
    ]
  }, TOKEN);
  return status === 200 ? true : `got ${status}`;
});

await test("Get notification log", async () => {
  const { status, data } = await req("GET", "/notifications/log?limit=10", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  if (!Array.isArray(data)) return "not an array";
  return true;
});

await test("Get notification service status", async () => {
  const { status, data } = await req("GET", "/notifications/status", null, TOKEN);
  if (status !== 200) return `got ${status}`;
  if (typeof data.emailConfigured !== "boolean") return "missing emailConfigured";
  if (typeof data.smsConfigured !== "boolean") return "missing smsConfigured";
  return true;
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TEST 13: CSV Export
// ═══════════════════════════════════════════════════════════════
console.log("\n🔗 Integration 13: CSV Export");

await test("Export inventory as CSV", async () => {
  const token = TOKEN;
  const r = await fetch(`${API}/inventory/export`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status !== 200) return `got ${r.status}`;
  const text = await r.text();
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return "CSV has no data rows";
  const headers = lines[0].split(",");
  if (!headers.includes("barcode") || !headers.includes("name")) return "missing expected CSV headers";
  return true;
});

// ── CLEANUP ────────────────────────────────────────────────────
console.log("\n🧹 Cleanup");

// Helper: deactivate user by email
async function cleanupUser(email, label) {
  const { data: users } = await req("GET", "/users", null, TOKEN);
  const user = Array.isArray(users) ? users.find(u => u.email === email) : null;
  if (!user) { console.log(`  ⏭️  ${label} — not found`); return; }
  const { status } = await req("DELETE", `/users/${user.id}`, null, TOKEN);
  console.log(status === 200 ? `  ✅ ${label}` : `  ⚠️  ${label} got ${status}`);
}

await cleanupUser(`sit-cashier-${TS}@test.com`, "Deactivate SIT cashier");

// Delete test products (soft-delete by deactivating)
if (CREATED.sitProductId) {
  const { status } = await req("PUT", `/products/${CREATED.sitProductId}`, { isActive: false }, TOKEN);
  console.log(status === 200 ? "  ✅ Deactivated SIT product" : `  ⚠️  Product deactivation got ${status}`);
}
if (CREATED.sitExpiryProductId) {
  const { status } = await req("PUT", `/products/${CREATED.sitExpiryProductId}`, { isActive: false }, TOKEN);
  console.log(status === 200 ? "  ✅ Deactivated SIT expiry product" : `  ⚠️  Expiry product deactivation got ${status}`);
}

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
