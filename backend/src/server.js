const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 5000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const secret = process.env.JWT_SECRET;
const maxAttempts = Number(process.env.MAX_LOGIN_ATTEMPTS || 5);
const lockMinutes = Number(process.env.LOCK_MINUTES || 15);
const saltRounds = 12;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing in backend/.env");
  process.exit(1);
}
if (!secret) {
  console.error("JWT_SECRET is missing in backend/.env");
  process.exit(1);
}

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" }));

// ── Middleware ────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ message: "Authentication required." });
  try { req.user = jwt.verify(t, secret); next(); }
  catch { return res.status(401).json({ message: "Session expired or invalid." }); }
};
const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: "Permission denied." });

async function audit(c, u, a, e, id, d = {}) {
  await c.query(
    "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)",
    [u, a, e, String(id || ""), JSON.stringify(d)]
  );
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 7: AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════

app.get("/api/health", async (_q, r, n) => {
  try { await pool.query("SELECT 1"); r.json({ status: "ok" }); }
  catch (e) { n(e); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const { rows } = await pool.query("SELECT * FROM users WHERE LOWER(email)=$1", [email]);
    const u = rows[0];
    if (!u || !u.is_active) return res.status(401).json({ message: "Invalid email or password." });
    if (u.locked_until && new Date(u.locked_until) > new Date())
      return res.status(423).json({ message: "Account temporarily locked. Try again later." });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) {
      const attempts = u.failed_login_attempts + 1;
      const locked = attempts >= maxAttempts ? new Date(Date.now() + lockMinutes * 60000) : null;
      await pool.query("UPDATE users SET failed_login_attempts=$1,locked_until=$2 WHERE id=$3", [attempts, locked, u.id]);
      return res.status(401).json({ message: "Invalid email or password." });
    }
    await pool.query("UPDATE users SET failed_login_attempts=0,locked_until=NULL,last_login_at=NOW() WHERE id=$1", [u.id]);
    await audit(pool, u.id, "LOGIN", "USER", u.id);
    const token = jwt.sign({ id: u.id, name: u.name, email: u.email, role: u.role }, secret, { expiresIn: "8h" });
    res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  } catch (e) { next(e); }
});

app.get("/api/auth/me", auth, (q, r) => r.json({ user: q.user }));

app.post("/api/auth/change-password", auth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (String(newPassword || "").length < 12)
      return res.status(400).json({ message: "New password must contain at least 12 characters." });
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(String(currentPassword || ""), rows[0].password_hash)))
      return res.status(401).json({ message: "Current password is incorrect." });
    const hash = await bcrypt.hash(newPassword, saltRounds);
    await pool.query("UPDATE users SET password_hash=$1,password_changed_at=NOW(),updated_at=NOW() WHERE id=$2", [hash, req.user.id]);
    await audit(pool, req.user.id, "CHANGE_PASSWORD", "USER", req.user.id);
    res.json({ message: "Password changed successfully." });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 8: USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

app.get("/api/users", auth, allow("ADMIN"), async (_q, r, n) => {
  try {
    r.json((await pool.query(
      `SELECT id,name,email,role,is_active,failed_login_attempts,locked_until,last_login_at,created_at
       FROM users ORDER BY name`
    )).rows);
  } catch (e) { n(e); }
});

app.post("/api/users", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || String(password).length < 8 || !["ADMIN", "MANAGER", "CASHIER"].includes(role))
      return res.status(400).json({ message: "Name, valid email, role and password (min 8 chars) required." });
    const hash = await bcrypt.hash(password, saltRounds);
    const { rows } = await pool.query(
      "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,is_active",
      [name, String(email).trim().toLowerCase(), hash, role]
    );
    await audit(pool, req.user.id, "CREATE", "USER", rows[0].id, { email: rows[0].email, role });
    res.status(201).json(rows[0]);
  } catch (e) { e.code === "23505" ? res.status(409).json({ message: "Email already exists." }) : next(e); }
});

app.patch("/api/users/:id", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { role, isActive, unlock } = req.body;
    if (id === req.user.id && isActive === false)
      return res.status(400).json({ message: "You cannot deactivate your own account." });
    const { rows } = await pool.query(
      `UPDATE users SET role=COALESCE($1,role),is_active=COALESCE($2,is_active),
       failed_login_attempts=CASE WHEN $3 THEN 0 ELSE failed_login_attempts END,
       locked_until=CASE WHEN $3 THEN NULL ELSE locked_until END,
       updated_at=NOW() WHERE id=$4
       RETURNING id,name,email,role,is_active,locked_until`,
      [role ?? null, isActive, Boolean(unlock), id]
    );
    await audit(pool, req.user.id, "UPDATE", "USER", id, req.body);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.delete("/api/users/:id", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ message: "Cannot delete your own account." });
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
    await audit(pool, req.user.id, "DELETE", "USER", id);
    res.json({ message: "User deleted." });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 3: PRODUCTS & INVENTORY
// ═══════════════════════════════════════════════════════════════════

app.get("/api/products", auth, async (q, r, n) => {
  try {
    const search = q.query.search;
    let sql = "SELECT id,barcode,name,category,price::float,cost_price::float,stock,reorder_level,unit,is_active,created_at FROM products";
    const params = [];
    if (search) {
      sql += " WHERE LOWER(name) LIKE $1 OR barcode LIKE $1 OR LOWER(category) LIKE $1";
      params.push(`%${String(search).toLowerCase()}%`);
    }
    sql += " ORDER BY name";
    r.json((await pool.query(sql, params)).rows);
  } catch (e) { n(e); }
});

app.post("/api/products", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { barcode, name, category, price, costPrice = 0, stock = 0, reorderLevel = 5, unit = "PCS", description = "" } = req.body;
    if (!barcode || !name || !category || Number(price) < 0 || Number(stock) < 0)
      return res.status(400).json({ message: "Invalid product details." });
    const { rows } = await pool.query(
      `INSERT INTO products(barcode,name,category,price,cost_price,stock,reorder_level,unit,description)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,barcode,name,category,price::float,cost_price::float,stock,reorder_level,unit,is_active`,
      [barcode, name, category, price, costPrice, stock, reorderLevel, unit, description]
    );
    await audit(pool, req.user.id, "CREATE", "PRODUCT", rows[0].id, { barcode, name });
    res.status(201).json(rows[0]);
  } catch (e) { e.code === "23505" ? res.status(409).json({ message: "Barcode already exists." }) : next(e); }
});

app.put("/api/products/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { barcode, name, category, price, costPrice, stock, reorderLevel, unit, description, isActive } = req.body;
    const { rows } = await pool.query(
      `UPDATE products SET
        barcode=COALESCE($1,barcode), name=COALESCE($2,name), category=COALESCE($3,category),
        price=COALESCE($4,price), cost_price=COALESCE($5,cost_price), stock=COALESCE($6,stock),
        reorder_level=COALESCE($7,reorder_level), unit=COALESCE($8,unit),
        description=COALESCE($9,description), is_active=COALESCE($10,is_active), updated_at=NOW()
       WHERE id=$11
       RETURNING id,barcode,name,category,price::float,cost_price::float,stock,reorder_level,unit,is_active`,
      [barcode, name, category, price, costPrice, stock, reorderLevel, unit, description, isActive, id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Product not found." });
    await audit(pool, req.user.id, "UPDATE", "PRODUCT", id, req.body);
    res.json(rows[0]);
  } catch (e) { e.code === "23505" ? res.status(409).json({ message: "Barcode already exists." }) : next(e); }
});

app.delete("/api/products/:id", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await pool.query("DELETE FROM products WHERE id=$1", [id]);
    await audit(pool, req.user.id, "DELETE", "PRODUCT", id);
    res.json({ message: "Product deleted." });
  } catch (e) { next(e); }
});

app.post("/api/products/:id/adjust", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { quantity, type, notes } = req.body;
    if (!["STOCK_IN", "STOCK_OUT", "ADJUSTMENT"].includes(type))
      return res.status(400).json({ message: "Invalid movement type." });
    const qty = Number(quantity);
    const adj = type === "STOCK_OUT" ? -Math.abs(qty) : Math.abs(qty);
    await pool.query("UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2", [adj, id]);
    await pool.query(
      "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,$2,$3,$4,$5,$6)",
      [id, type, adj, `ADJ-${Date.now()}`, req.user.id, notes || ""]
    );
    await audit(pool, req.user.id, "ADJUST_STOCK", "PRODUCT", id, { type, qty: adj });
    res.json({ message: "Stock adjusted." });
  } catch (e) { next(e); }
});

app.get("/api/inventory/movements", auth, async (q, r, n) => {
  try {
    const productId = q.query.product_id;
    let sql = `SELECT im.*, p.name AS product_name, u.name AS user_name
               FROM inventory_movements im
               JOIN products p ON p.id = im.product_id
               LEFT JOIN users u ON u.id = im.user_id`;
    const params = [];
    if (productId) { sql += " WHERE im.product_id = $1"; params.push(Number(productId)); }
    sql += " ORDER BY im.created_at DESC LIMIT 200";
    r.json((await pool.query(sql, params)).rows);
  } catch (e) { n(e); }
});

app.get("/api/products/low-stock", auth, async (_q, r, n) => {
  try {
    r.json((await pool.query(
      "SELECT id,barcode,name,category,stock,reorder_level,price::float FROM products WHERE stock <= reorder_level ORDER BY stock ASC"
    )).rows);
  } catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 2: POS / SALES
// ═══════════════════════════════════════════════════════════════════

app.get("/api/sales", auth, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    let where = [];
    let params = [];
    let paramIdx = 1;
    if (req.user.role === "CASHIER") { where.push(`s.cashier_id = $${paramIdx++}`); params.push(req.user.id); }
    if (from) { where.push(`s.created_at >= $${paramIdx++}`); params.push(from); }
    if (to) { where.push(`s.created_at <= $${paramIdx++}`); params.push(to); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    r.json((await pool.query(
      `SELECT s.id,s.receipt_number,s.customer_name,s.payment_method,s.subtotal::float,s.discount::float,s.tax::float,
              s.total::float,s.amount_paid::float,s.status,s.created_at,u.name AS cashier_name,
              COALESCE(SUM(si.quantity),0)::int AS item_count
       FROM sales s JOIN users u ON u.id = s.cashier_id
       LEFT JOIN sale_items si ON si.sale_id = s.id ${w}
       GROUP BY s.id,u.name ORDER BY s.created_at DESC LIMIT 200`, params
    )).rows);
  } catch (e) { next(e); }
});

app.get("/api/sales/:id", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: saleRows } = await pool.query(
      `SELECT s.*, u.name AS cashier_name FROM sales s JOIN users u ON u.id = s.cashier_id WHERE s.id = $1`, [id]
    );
    if (!saleRows[0]) return res.status(404).json({ message: "Sale not found." });
    const { rows: items } = await pool.query("SELECT * FROM sale_items WHERE sale_id = $1", [id]);
    res.json({ ...saleRows[0], items });
  } catch (e) { next(e); }
});

app.post("/api/sales", auth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { customerName = "Walk-in Customer", customerId, paymentMethod, items, discount = 0, tax = 0, amountPaid } = req.body;
    if (!["Cash", "Card", "Transfer", "POS"].includes(paymentMethod))
      return res.status(400).json({ message: "Invalid payment method." });
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ message: "Cart is empty." });

    await client.query("BEGIN");
    let subtotal = 0;
    const details = [];

    for (const x of items) {
      const productId = Number(x.productId);
      const quantity = Number(x.quantity);
      const itemDiscount = Number(x.discount || 0);
      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1)
        throw Object.assign(new Error("Invalid sale item."), { status: 400 });

      const { rows } = await client.query("SELECT id,name,price::float,stock FROM products WHERE id=$1 FOR UPDATE", [productId]);
      const product = rows[0];
      if (!product) throw Object.assign(new Error("Product not found."), { status: 404 });
      if (product.stock < quantity)
        throw Object.assign(new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}`), { status: 409 });

      const lineTotal = Number(product.price) * quantity - itemDiscount;
      subtotal += lineTotal;
      details.push({ productId: product.id, name: product.name, price: Number(product.price), quantity, discount: itemDiscount, lineTotal });
    }

    const total = subtotal - Number(discount) + Number(tax);
    const paid = amountPaid != null ? Number(amountPaid) : total;
    const change = Math.max(0, paid - total);
    const receiptNumber = `RHS-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

    const { rows } = await client.query(
      `INSERT INTO sales(receipt_number,customer_name,customer_id,payment_method,subtotal,discount,tax,total,amount_paid,change_amount,cashier_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,created_at`,
      [receiptNumber, customerName, customerId || null, paymentMethod, subtotal, discount, tax, total, paid, change, req.user.id]
    );
    const sale = rows[0];

    for (const item of details) {
      await client.query(
        "INSERT INTO sale_items(sale_id,product_id,product_name,unit_price,quantity,discount,line_total) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [sale.id, item.productId, item.name, item.price, item.quantity, item.discount, item.lineTotal]
      );
      await client.query("UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2", [item.quantity, item.productId]);
      await client.query(
        "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id) VALUES($1,'SALE',$2,$3,$4)",
        [item.productId, -item.quantity, receiptNumber, req.user.id]
      );
    }

    // Update customer loyalty points
    if (customerId) {
      const points = Math.floor(total / 100); // 1 point per 100 spent
      await client.query(
        "UPDATE customers SET loyalty_points = loyalty_points + $1, total_spent = total_spent + $2, visit_count = visit_count + 1 WHERE id = $3",
        [points, total, customerId]
      );
    }

    await audit(client, req.user.id, "CREATE", "SALE", sale.id, { receiptNumber, total });
    await client.query("COMMIT");

    res.status(201).json({
      id: sale.id, receiptNumber, createdAt: sale.created_at, customerName, paymentMethod,
      cashierName: req.user.name, items: details, subtotal, discount, tax, total, amountPaid: paid, change, change_amount: change
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally { client.release(); }
});

// Returns
app.post("/api/sales/:id/return", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const saleId = Number(req.params.id);
    const { productId, quantity, reason } = req.body;
    const { rows: saleRows } = await client.query("SELECT * FROM sales WHERE id=$1", [saleId]);
    if (!saleRows[0]) return res.status(404).json({ message: "Sale not found." });
    const { rows: itemRows } = await client.query(
      "SELECT * FROM sale_items WHERE sale_id=$1 AND product_id=$2", [saleId, productId]
    );
    if (!itemRows[0]) return res.status(404).json({ message: "Item not found in sale." });
    const qty = Number(quantity);
    if (qty > itemRows[0].quantity) return res.status(400).json({ message: "Return quantity exceeds original." });

    await client.query("BEGIN");
    const refundAmount = Number(itemRows[0].unit_price) * qty;
    await client.query(
      "INSERT INTO returns(sale_id,product_id,quantity,reason,refund_amount,processed_by) VALUES($1,$2,$3,$4,$5,$6)",
      [saleId, productId, qty, reason || "", refundAmount, req.user.id]
    );
    await client.query("UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2", [qty, productId]);
    await client.query(
      "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,'RETURN',$2,$3,$4,$5)",
      [productId, qty, `RET-${saleId}`, req.user.id, reason || ""]
    );
    await audit(client, req.user.id, "RETURN", "SALE", saleId, { productId, qty, refundAmount });
    await client.query("COMMIT");
    res.json({ message: "Return processed.", refundAmount });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 9: DASHBOARD / BI
// ═══════════════════════════════════════════════════════════════════

app.get("/api/dashboard/stats", auth, async (_q, r, n) => {
  try {
    const [totalProducts, totalSales, totalRevenue, lowStock, todaySales, todayRevenue, totalUsers, recentSales] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM products WHERE is_active = TRUE"),
      pool.query("SELECT COUNT(*)::int AS count FROM sales"),
      pool.query("SELECT COALESCE(SUM(total),0)::float AS total FROM sales"),
      pool.query("SELECT COUNT(*)::int AS count FROM products WHERE stock <= reorder_level AND is_active = TRUE"),
      pool.query("SELECT COUNT(*)::int AS count FROM sales WHERE created_at::date = CURRENT_DATE"),
      pool.query("SELECT COALESCE(SUM(total),0)::float AS total FROM sales WHERE created_at::date = CURRENT_DATE"),
      pool.query("SELECT COUNT(*)::int AS count FROM users WHERE is_active = TRUE"),
      pool.query(`SELECT date_trunc('day',created_at)::date AS day, COUNT(*)::int AS count, COALESCE(SUM(total),0)::float AS revenue
                  FROM sales WHERE created_at >= NOW() - INTERVAL '30 days'
                  GROUP BY 1 ORDER BY 1`)
    ]);
    r.json({
      totalProducts: totalProducts.rows[0].count,
      totalSales: totalSales.rows[0].count,
      totalRevenue: totalRevenue.rows[0].total,
      lowStockCount: lowStock.rows[0].count,
      todaySales: todaySales.rows[0].count,
      todayRevenue: todayRevenue.rows[0].total,
      totalUsers: totalUsers.rows[0].count,
      salesChart: recentSales.rows
    });
  } catch (e) { n(e); }
});

app.get("/api/dashboard/top-products", auth, async (_q, r, n) => {
  try {
    r.json((await pool.query(
      `SELECT si.product_name, SUM(si.quantity)::int AS total_qty, SUM(si.line_total)::float AS total_revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= NOW() - INTERVAL '30 days'
       GROUP BY si.product_name ORDER BY total_revenue DESC LIMIT 10`
    )).rows);
  } catch (e) { n(e); }
});

app.get("/api/dashboard/category-sales", auth, async (_q, r, n) => {
  try {
    r.json((await pool.query(
      `SELECT p.category, SUM(si.line_total)::float AS revenue, SUM(si.quantity)::int AS qty
       FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= NOW() - INTERVAL '30 days'
       GROUP BY p.category ORDER BY revenue DESC`
    )).rows);
  } catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 10: PROCUREMENT — Suppliers & Purchase Orders
// ═══════════════════════════════════════════════════════════════════

app.get("/api/suppliers", auth, async (_q, r, n) => {
  try { r.json((await pool.query("SELECT * FROM suppliers ORDER BY name")).rows); }
  catch (e) { n(e); }
});

app.post("/api/suppliers", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { name, contactPerson, email, phone, address } = req.body;
    if (!name) return res.status(400).json({ message: "Supplier name required." });
    const { rows } = await pool.query(
      "INSERT INTO suppliers(name,contact_person,email,phone,address) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [name, contactPerson || null, email || null, phone || null, address || null]
    );
    await audit(pool, req.user.id, "CREATE", "SUPPLIER", rows[0].id, { name });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.put("/api/suppliers/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, contactPerson, email, phone, address, isActive } = req.body;
    const { rows } = await pool.query(
      `UPDATE suppliers SET name=COALESCE($1,name),contact_person=COALESCE($2,contact_person),
       email=COALESCE($3,email),phone=COALESCE($4,phone),address=COALESCE($5,address),
       is_active=COALESCE($6,is_active) WHERE id=$7 RETURNING *`,
      [name, contactPerson, email, phone, address, isActive, id]
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.delete("/api/suppliers/:id", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    await pool.query("DELETE FROM suppliers WHERE id=$1", [Number(req.params.id)]);
    await audit(pool, req.user.id, "DELETE", "SUPPLIER", req.params.id);
    res.json({ message: "Supplier deleted." });
  } catch (e) { next(e); }
});

// Purchase Orders
app.get("/api/purchase-orders", auth, async (_q, r, n) => {
  try {
    r.json((await pool.query(
      `SELECT po.*, s.name AS supplier_name, u.name AS created_by_name
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN users u ON u.id = po.created_by
       ORDER BY po.created_at DESC LIMIT 100`
    )).rows);
  } catch (e) { n(e); }
});

app.get("/api/purchase-orders/:id", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: poRows } = await pool.query(
      `SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id=$1`, [id]
    );
    if (!poRows[0]) return res.status(404).json({ message: "Purchase order not found." });
    const { rows: items } = await pool.query(
      `SELECT poi.*, p.name AS product_name FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id WHERE poi.po_id=$1`, [id]
    );
    res.json({ ...poRows[0], items });
  } catch (e) { next(e); }
});

app.post("/api/purchase-orders", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { supplierId, items, notes, expectedDate } = req.body;
    if (!supplierId || !Array.isArray(items) || !items.length)
      return res.status(400).json({ message: "Supplier and items required." });

    await client.query("BEGIN");
    let total = 0;
    const poNumber = `PO-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

    const { rows: poRows } = await client.query(
      `INSERT INTO purchase_orders(po_number,supplier_id,notes,created_by,expected_date)
       VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [poNumber, supplierId, notes || "", req.user.id, expectedDate || null]
    );
    const poId = poRows[0].id;

    for (const item of items) {
      const qty = Number(item.quantity);
      const cost = Number(item.unitCost);
      const lineTotal = qty * cost;
      total += lineTotal;
      await client.query(
        "INSERT INTO purchase_order_items(po_id,product_id,quantity,unit_cost,line_total) VALUES($1,$2,$3,$4,$5)",
        [poId, item.productId, qty, cost, lineTotal]
      );
    }

    await client.query("UPDATE purchase_orders SET total=$1 WHERE id=$2", [total, poId]);
    await audit(client, req.user.id, "CREATE", "PURCHASE_ORDER", poId, { poNumber, total });
    await client.query("COMMIT");
    res.status(201).json({ id: poId, poNumber, total });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

app.patch("/api/purchase-orders/:id/status", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!["PENDING", "APPROVED", "RECEIVED", "CANCELLED"].includes(status))
      return res.status(400).json({ message: "Invalid status." });

    await client.query("BEGIN");
    const updateFields = status === "RECEIVED"
      ? "status=$1, received_date=NOW(), updated_at=NOW()"
      : "status=$1, updated_at=NOW()";
    const { rows } = await client.query(
      `UPDATE purchase_orders SET ${updateFields} WHERE id=$2 RETURNING *`, [status, id]
    );

    if (status === "RECEIVED") {
      // Auto-receive stock
      const { rows: items } = await client.query("SELECT * FROM purchase_order_items WHERE po_id=$1", [id]);
      for (const item of items) {
        const qty = Number(item.quantity);
        await client.query("UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2", [qty, item.product_id]);
        await client.query(
          "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id) VALUES($1,'PURCHASE',$2,$3,$4)",
          [item.product_id, qty, rows[0].po_number, req.user.id]
        );
      }
    }

    await audit(client, req.user.id, "UPDATE_STATUS", "PURCHASE_ORDER", id, { status });
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 12: CUSTOMERS / CRM
// ═══════════════════════════════════════════════════════════════════

app.get("/api/customers", auth, async (_q, r, n) => {
  try { r.json((await pool.query("SELECT * FROM customers ORDER BY name")).rows); }
  catch (e) { n(e); }
});

app.post("/api/customers", auth, async (req, res, next) => {
  try {
    const { name, email, phone } = req.body;
    if (!name) return res.status(400).json({ message: "Customer name required." });
    const { rows } = await pool.query(
      "INSERT INTO customers(name,email,phone) VALUES($1,$2,$3) RETURNING *",
      [name, email || null, phone || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.put("/api/customers/:id", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, email, phone } = req.body;
    const { rows } = await pool.query(
      "UPDATE customers SET name=COALESCE($1,name),email=COALESCE($2,email),phone=COALESCE($3,phone) WHERE id=$4 RETURNING *",
      [name, email, phone, id]
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 13: FINANCE — Expenses
// ═══════════════════════════════════════════════════════════════════

app.get("/api/expenses", auth, async (_q, r, n) => {
  try {
    r.json((await pool.query(
      `SELECT e.*, u.name AS approved_by_name FROM expenses e LEFT JOIN users u ON u.id = e.approved_by ORDER BY e.created_at DESC LIMIT 200`
    )).rows);
  } catch (e) { n(e); }
});

app.post("/api/expenses", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { category, description, amount, paymentMethod, reference } = req.body;
    if (!category || !amount || Number(amount) <= 0)
      return res.status(400).json({ message: "Category and positive amount required." });
    const { rows } = await pool.query(
      `INSERT INTO expenses(category,description,amount,payment_method,reference,approved_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [category, description || "", amount, paymentMethod || "Cash", reference || "", req.user.id]
    );
    await audit(pool, req.user.id, "CREATE", "EXPENSE", rows[0].id, { category, amount });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.get("/api/finance/summary", auth, allow("ADMIN", "MANAGER"), async (_q, r, n) => {
  try {
    const [salesRev, totalExpenses, todaySales] = await Promise.all([
      pool.query("SELECT COALESCE(SUM(total),0)::float AS revenue FROM sales"),
      pool.query("SELECT COALESCE(SUM(amount),0)::float AS total FROM expenses"),
      pool.query("SELECT COALESCE(SUM(total),0)::float AS revenue,COALESCE(SUM(total),0)::float AS cost FROM sales WHERE created_at::date = CURRENT_DATE")
    ]);
    const revenue = salesRev.rows[0].revenue;
    const expenses = totalExpenses.rows[0].total;
    const profit = revenue - expenses;
    r.json({ revenue, expenses, profit, todayRevenue: todaySales.rows[0].revenue, todayCost: todaySales.rows[0].cost });
  } catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 8: AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════

app.get("/api/audit-logs", auth, allow("ADMIN"), async (q, r, n) => {
  try {
    const limit = Math.min(Number(q.query.limit) || 200, 500);
    r.json((await pool.query(
      `SELECT a.id,u.name AS user_name,a.action,a.entity_type,a.entity_id,a.details,a.created_at
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT $1`, [limit]
    )).rows);
  } catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 14: BRANCHES
// ═══════════════════════════════════════════════════════════════════

app.get("/api/branches", auth, async (_q, r, n) => {
  try { r.json((await pool.query("SELECT * FROM branches ORDER BY name")).rows); }
  catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// CATEGORY LIST (for dropdowns)
// ═══════════════════════════════════════════════════════════════════

app.get("/api/categories", auth, async (_q, r, n) => {
  try {
    r.json((await pool.query("SELECT DISTINCT category FROM products ORDER BY category")).rows.map(r => r.category));
  } catch (e) { n(e); }
});

// ── Error handler ────────────────────────────────────────────────
app.use((e, _q, r, _n) => {
  console.error(e);
  r.status(e.status || 500).json({ message: e.status ? e.message : "Unexpected server error." });
});

app.listen(port, () => console.log(`RHoSAM API running on http://localhost:${port}`));
