// ═══════════════════════════════════════════════════════════════════
// Store Commerce Feature Routes
// Gift Cards, Coupons, Shifts, Tasks, Commissions, Bundles,
// Quotations, Customer Notes, Price Checks
// ═══════════════════════════════════════════════════════════════════

module.exports = function registerStoreCommerceRoutes(app, pool, auth, allow) {

  // ── Helper: generate unique codes ──────────────────────────────
  async function genCode(table, prefix, len = 12) {
    const crypto = require("crypto");
    let code;
    for (let i = 0; i < 10; i++) {
      code = prefix + crypto.randomBytes(len / 2).toString("hex").toUpperCase().slice(0, len);
      const { rows } = await pool.query(`SELECT 1 FROM ${table} WHERE code = $1`, [code]);
      if (rows.length === 0) return code;
    }
    throw new Error("Could not generate unique code");
  }

  async function genQuoteNumber() {
    const { rows } = await pool.query(`SELECT COALESCE(MAX(id),0)+1 AS seq FROM quotations`);
    return `QT-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(rows[0].seq).padStart(5,"0")}`;
  }

  async function genShiftNumber() {
    const { rows } = await pool.query(`SELECT COALESCE(MAX(id),0)+1 AS seq FROM shifts`);
    return `SH-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(rows[0].seq).padStart(5,"0")}`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. GIFT CARDS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/gift-cards
  app.get("/api/gift-cards", auth, async (req, res, next) => {
    try {
      const { status, search, limit = 50, offset = 0 } = req.query;
      let where = "WHERE 1=1";
      const params = [];
      let idx = 1;
      if (status) { where += ` AND gc.status = $${idx++}`; params.push(status); }
      if (search) { where += ` AND (gc.code ILIKE $${idx} OR c.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
      params.push(Number(limit), Number(offset));
      const { rows } = await pool.query(`
        SELECT gc.*, c.name AS customer_name, u.name AS issued_by, b.name AS branch_name,
               (SELECT COUNT(*) FROM gift_card_transactions gct WHERE gct.gift_card_id = gc.id) AS transaction_count
        FROM gift_cards gc
        LEFT JOIN customers c ON gc.purchased_by_customer_id = c.id
        LEFT JOIN users u ON gc.issued_by_user_id = u.id
        LEFT JOIN branches b ON gc.branch_id = b.id
        ${where}
        ORDER BY gc.created_at DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `, params);
      const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*)::int AS total FROM gift_cards gc LEFT JOIN customers c ON gc.purchased_by_customer_id = c.id ${where}`, params.slice(0, -2));
      res.json({ data: rows, total });
    } catch (e) { next(e); }
  });

  // POST /api/gift-cards — issue a new gift card
  app.post("/api/gift-cards", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { initialBalance, customerId, branchId, expiresAt } = req.body;
      if (!initialBalance || initialBalance <= 0) throw Object.assign(new Error("Initial balance required"), { status: 400 });
      const code = await genCode("gift_cards", "GC", 16);
      const { rows } = await pool.query(`
        INSERT INTO gift_cards (code, initial_balance, current_balance, purchased_by_customer_id, issued_by_user_id, branch_id, expires_at)
        VALUES ($1, $2, $2, $3, $4, $5, $6) RETURNING *
      `, [code, initialBalance, customerId || null, req.user.id, branchId || req.user.branchId || null, expiresAt || null]);
      // Log the transaction
      await pool.query(`
        INSERT INTO gift_card_transactions (gift_card_id, type, amount, balance_after, user_id, notes)
        VALUES ($1, 'purchase', $2, $2, $3, 'Gift card issued')
      `, [rows[0].id, initialBalance, req.user.id]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // POST /api/gift-cards/validate
  app.post("/api/gift-cards/validate", auth, async (req, res, next) => {
    try {
      const { code } = req.body;
      const { rows } = await pool.query(`SELECT * FROM gift_cards WHERE code = $1`, [code]);
      if (!rows.length) return res.status(404).json({ valid: false, message: "Gift card not found" });
      const gc = rows[0];
      if (gc.status !== "active") return res.json({ valid: false, message: `Gift card is ${gc.status}`, giftCard: gc });
      if (gc.expires_at && new Date(gc.expires_at) < new Date()) {
        await pool.query(`UPDATE gift_cards SET status = 'expired' WHERE id = $1`, [gc.id]);
        return res.json({ valid: false, message: "Gift card expired", giftCard: { ...gc, status: "expired" } });
      }
      if (gc.current_balance <= 0) return res.json({ valid: false, message: "Gift card has no balance", giftCard: gc });
      res.json({ valid: true, giftCard: gc });
    } catch (e) { next(e); }
  });

  // POST /api/gift-cards/redeem
  app.post("/api/gift-cards/redeem", auth, async (req, res, next) => {
    try {
      const { code, amount, saleId } = req.body;
      if (!code || !amount || amount <= 0) throw Object.assign(new Error("Code and amount required"), { status: 400 });
      const { rows } = await pool.query(`SELECT * FROM gift_cards WHERE code = $1 FOR UPDATE`, [code]);
      if (!rows.length) throw Object.assign(new Error("Gift card not found"), { status: 404 });
      const gc = rows[0];
      if (gc.status !== "active") throw Object.assign(new Error(`Gift card is ${gc.status}`), { status: 400 });
      if (gc.current_balance < amount) throw Object.assign(new Error("Insufficient gift card balance"), { status: 400 });
      const newBalance = gc.current_balance - amount;
      const newStatus = newBalance <= 0 ? "redeemed" : "active";
      await pool.query(`UPDATE gift_cards SET current_balance = $1, status = $2, updated_at = NOW() WHERE id = $3`, [newBalance, newStatus, gc.id]);
      await pool.query(`
        INSERT INTO gift_card_transactions (gift_card_id, type, amount, balance_after, sale_id, user_id)
        VALUES ($1, 'redemption', $2, $3, $4, $5)
      `, [gc.id, amount, newBalance, saleId || null, req.user.id]);
      // If linked to a sale, update sale record
      if (saleId) {
        await pool.query(`UPDATE sales SET gift_card_id = $1, gift_card_amount = $2 WHERE id = $3`, [gc.id, amount, saleId]);
      }
      res.json({ success: true, newBalance, status: newStatus });
    } catch (e) { next(e); }
  });

  // GET /api/gift-cards/:id/transactions
  app.get("/api/gift-cards/:id/transactions", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT gct.*, u.name AS user_name FROM gift_card_transactions gct
        LEFT JOIN users u ON gct.user_id = u.id
        WHERE gct.gift_card_id = $1 ORDER BY gct.created_at DESC
      `, [req.params.id]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // DELETE /api/gift-cards/:id
  app.delete("/api/gift-cards/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM gift_cards WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. COUPONS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/coupons
  app.get("/api/coupons", auth, async (req, res, next) => {
    try {
      const { active, search, limit = 50, offset = 0 } = req.query;
      let where = "WHERE 1=1";
      const params = [];
      let idx = 1;
      if (active === "true") { where += ` AND cp.is_active = true AND cp.end_date >= NOW() AND (cp.max_uses IS NULL OR cp.used_count < cp.max_uses)`; }
      if (search) { where += ` AND cp.code ILIKE $${idx}`; params.push(`%${search}%`); idx++; }
      params.push(Number(limit), Number(offset));
      const { rows } = await pool.query(`
        SELECT cp.*, u.name AS created_by FROM coupons cp
        LEFT JOIN users u ON cp.created_by_user_id = u.id
        ${where}
        ORDER BY cp.created_at DESC LIMIT $${idx++} OFFSET $${idx++}
      `, params);
      const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*)::int AS total FROM coupons cp ${where}`, params.slice(0, -2));
      res.json({ data: rows, total });
    } catch (e) { next(e); }
  });

  // POST /api/coupons
  app.post("/api/coupons", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { code, description, discountType, discountValue, minPurchase, maxUses, applicableProducts, applicableCategories, startDate, endDate, branchId } = req.body;
      if (!code || !discountType || !discountValue || !startDate || !endDate) {
        throw Object.assign(new Error("Missing required fields"), { status: 400 });
      }
      const { rows } = await pool.query(`
        INSERT INTO coupons (code, description, discount_type, discount_value, min_purchase, max_uses, applicable_products, applicable_categories, start_date, end_date, branch_id, created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
      `, [code.toUpperCase(), description || null, discountType, discountValue, minPurchase || 0, maxUses || null, applicableProducts || null, applicableCategories || null, startDate, endDate, branchId || req.user.branchId || null, req.user.id]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // POST /api/coupons/validate
  app.post("/api/coupons/validate", auth, async (req, res, next) => {
    try {
      const { code, cartTotal, productIds, categories } = req.body;
      const { rows } = await pool.query(`SELECT * FROM coupons WHERE UPPER(code) = UPPER($1)`, [code]);
      if (!rows.length) return res.status(404).json({ valid: false, message: "Coupon not found" });
      const cp = rows[0];
      if (!cp.is_active) return res.json({ valid: false, message: "Coupon is inactive" });
      if (new Date(cp.end_date) < new Date()) return res.json({ valid: false, message: "Coupon has expired" });
      if (new Date(cp.start_date) > new Date()) return res.json({ valid: false, message: "Coupon is not yet active" });
      if (cp.max_uses && cp.used_count >= cp.max_uses) return res.json({ valid: false, message: "Coupon usage limit reached" });
      if (cp.min_purchase && cartTotal < cp.min_purchase) return res.json({ valid: false, message: `Minimum purchase of ₦${cp.min_purchase} required` });
      // Check product/category applicability
      if (cp.applicable_products && productIds) {
        const allowed = cp.applicable_products.split(",").map(Number);
        const hasApplicable = productIds.some(id => allowed.includes(id));
        if (!hasApplicable) return res.json({ valid: false, message: "Coupon not applicable to items in cart" });
      }
      let discount = 0;
      if (cp.discount_type === "percentage") {
        discount = (cartTotal * cp.discount_value) / 100;
      } else {
        discount = Math.min(cp.discount_value, cartTotal);
      }
      res.json({ valid: true, coupon: cp, discountAmount: Math.round(discount * 100) / 100 });
    } catch (e) { next(e); }
  });

  // PATCH /api/coupons/:id
  app.patch("/api/coupons/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const fields = req.body;
      const allowed = ["description", "is_active", "max_uses", "end_date", "discount_value", "min_purchase"];
      const sets = []; const params = []; let idx = 1;
      for (const [k, v] of Object.entries(fields)) {
        if (allowed.includes(k)) { sets.push(`${k} = $${idx++}`); params.push(v); }
      }
      if (!sets.length) return res.status(400).json({ message: "No valid fields to update" });
      sets.push(`updated_at = NOW()`);
      params.push(req.params.id);
      const { rows } = await pool.query(`UPDATE coupons SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params);
      res.json(rows[0] || {});
    } catch (e) { next(e); }
  });

  // DELETE /api/coupons/:id
  app.delete("/api/coupons/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM coupons WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. SHIFTS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/shifts
  app.get("/api/shifts", auth, async (req, res, next) => {
    try {
      const { status, userId, branchId, limit = 50, offset = 0 } = req.query;
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      if (status) { where += ` AND s.status = $${idx++}`; params.push(status); }
      if (userId) { where += ` AND s.user_id = $${idx++}`; params.push(userId); }
      if (branchId) { where += ` AND s.branch_id = $${idx++}`; params.push(branchId); }
      // Branch scoping
      if (req.user.branchId && req.user.role !== "ADMIN") {
        where += ` AND s.branch_id = $${idx++}`; params.push(req.user.branchId);
      }
      params.push(Number(limit), Number(offset));
      const { rows } = await pool.query(`
        SELECT s.*, u.name AS user_name, b.name AS branch_name
        FROM shifts s LEFT JOIN users u ON s.user_id = u.id LEFT JOIN branches b ON s.branch_id = b.id
        ${where} ORDER BY s.created_at DESC LIMIT $${idx++} OFFSET $${idx++}
      `, params);
      res.json({ data: rows });
    } catch (e) { next(e); }
  });

  // GET /api/shifts/active
  app.get("/api/shifts/active", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT s.*, u.name AS user_name, b.name AS branch_name
        FROM shifts s LEFT JOIN users u ON s.user_id = u.id LEFT JOIN branches b ON s.branch_id = b.id
        WHERE s.user_id = $1 AND s.status = 'open' ORDER BY s.opened_at DESC LIMIT 1
      `, [req.user.id]);
      res.json(rows[0] || null);
    } catch (e) { next(e); }
  });

  // POST /api/shifts/open
  app.post("/api/shifts/open", auth, async (req, res, next) => {
    try {
      const { openingAmount, notes } = req.body;
      const branchId = req.user.branchId;
      if (!branchId) throw Object.assign(new Error("Branch assignment required"), { status: 400 });
      // Check for existing open shift
      const { rows: existing } = await pool.query(`SELECT id FROM shifts WHERE user_id = $1 AND status = 'open'`, [req.user.id]);
      if (existing.length) throw Object.assign(new Error("You already have an open shift"), { status: 400 });
      const shiftNumber = await genShiftNumber();
      const { rows } = await pool.query(`
        INSERT INTO shifts (shift_number, user_id, branch_id, opening_amount, notes)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
      `, [shiftNumber, req.user.id, branchId, openingAmount || 0, notes || null]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // POST /api/shifts/:id/close
  app.post("/api/shifts/:id/close", auth, async (req, res, next) => {
    try {
      const { actualAmount, notes } = req.body;
      const { rows } = await pool.query(`SELECT * FROM shifts WHERE id = $1 AND status = 'open' FOR UPDATE`, [req.params.id]);
      if (!rows.length) throw Object.assign(new Error("No open shift found"), { status: 404 });
      const shift = rows[0];
      if (shift.user_id !== req.user.id && req.user.role !== "ADMIN") {
        throw Object.assign(new Error("Only the shift owner or admin can close"), { status: 403 });
      }
      // Calculate expected amount from sales during this shift
      const { rows: [{ expected }] } = await pool.query(`
        SELECT COALESCE(SUM(total), 0)::float AS expected FROM sales
        WHERE created_at >= $1 AND (branch_id = $2 OR $2 IS NULL) AND user_id = $3
      `, [shift.opened_at, shift.branch_id, shift.user_id]);
      const expectedAmount = expected + parseFloat(shift.opening_amount);
      const variance = (actualAmount || 0) - expectedAmount;
      await pool.query(`
        UPDATE shifts SET status = 'closed', closed_at = NOW(), closing_amount = $1,
        expected_amount = $2, actual_amount = $3, variance = $4,
        notes = COALESCE($5, notes), updated_at = NOW() WHERE id = $6
      `, [actualAmount || 0, expectedAmount, actualAmount || 0, variance, notes || null, shift.id]);
      const { rows: updated } = await pool.query(`SELECT * FROM shifts WHERE id = $1`, [shift.id]);
      res.json(updated[0]);
    } catch (e) { next(e); }
  });

  // GET /api/shifts/:id/summary
  app.get("/api/shifts/:id/summary", auth, async (req, res, next) => {
    try {
      const { rows: [shift] } = await pool.query(`SELECT * FROM shifts WHERE id = $1`, [req.params.id]);
      if (!shift) return res.status(404).json({ message: "Shift not found" });
      // Get sales during shift
      const { rows: sales } = await pool.query(`
        SELECT payment_method, COUNT(*)::int AS count, COALESCE(SUM(total),0)::float AS total
        FROM sales WHERE user_id = $1 AND created_at >= $2
        ${shift.closed_at ? 'AND created_at <= $3' : ''}
        GROUP BY payment_method
      `, shift.closed_at ? [shift.user_id, shift.opened_at, shift.closed_at] : [shift.user_id, shift.opened_at]);
      // Get returns during shift
      const { rows: [returns] } = await pool.query(`
        SELECT COUNT(*)::int AS count, COALESCE(SUM(refund_amount),0)::float AS total
        FROM returns WHERE user_id = $1 AND created_at >= $2
        ${shift.closed_at ? 'AND created_at <= $3' : ''}
      `, shift.closed_at ? [shift.user_id, shift.opened_at, shift.closed_at] : [shift.user_id, shift.opened_at]);
      res.json({ shift, paymentBreakdown: sales, returns: returns || { count: 0, total: 0 } });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. TASKS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/tasks
  app.get("/api/tasks", auth, async (req, res, next) => {
    try {
      const { status, priority, assignedTo, branchId, limit = 50, offset = 0 } = req.query;
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      if (status) { where += ` AND t.status = $${idx++}`; params.push(status); }
      if (priority) { where += ` AND t.priority = $${idx++}`; params.push(priority); }
      if (assignedTo) { where += ` AND t.assigned_to = $${idx++}`; params.push(assignedTo); }
      if (branchId) { where += ` AND t.branch_id = $${idx++}`; params.push(branchId); }
      else if (req.user.branchId && req.user.role !== "ADMIN") { where += ` AND t.branch_id = $${idx++}`; params.push(req.user.branchId); }
      params.push(Number(limit), Number(offset));
      const { rows } = await pool.query(`
        SELECT t.*, ua.name AS assigned_to_name, ub.name AS assigned_by_name, b.name AS branch_name,
               (SELECT COUNT(*)::int FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
        FROM tasks t
        LEFT JOIN users ua ON t.assigned_to = ua.id
        LEFT JOIN users ub ON t.assigned_by = ub.id
        LEFT JOIN branches b ON t.branch_id = b.id
        ${where} ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.created_at DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `, params);
      const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*)::int AS total FROM tasks t ${where}`, params.slice(0, -2));
      res.json({ data: rows, total });
    } catch (e) { next(e); }
  });

  // POST /api/tasks
  app.post("/api/tasks", auth, async (req, res, next) => {
    try {
      const { title, description, priority, assignedTo, dueDate, category, relatedEntityType, relatedEntityId } = req.body;
      if (!title) throw Object.assign(new Error("Title required"), { status: 400 });
      const { rows } = await pool.query(`
        INSERT INTO tasks (title, description, priority, assigned_to, assigned_by, branch_id, due_date, category, related_entity_type, related_entity_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
      `, [title, description || null, priority || "medium", assignedTo || null, req.user.id, req.user.branchId || null, dueDate || null, category || null, relatedEntityType || null, relatedEntityId || null]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // PATCH /api/tasks/:id
  app.patch("/api/tasks/:id", auth, async (req, res, next) => {
    try {
      const fields = req.body;
      const allowed = ["title", "description", "priority", "status", "assigned_to", "due_date", "category"];
      const sets = []; const params = []; let idx = 1;
      for (const [k, v] of Object.entries(fields)) {
        const col = k.replace(/([A-Z])/g, "_$1").toLowerCase();
        if (allowed.includes(col)) { sets.push(`${col} = $${idx++}`); params.push(v); }
      }
      if (fields.status === "completed") { sets.push(`completed_at = NOW()`); }
      if (!sets.length) return res.status(400).json({ message: "No valid fields" });
      sets.push(`updated_at = NOW()`);
      params.push(req.params.id);
      const { rows } = await pool.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params);
      res.json(rows[0] || {});
    } catch (e) { next(e); }
  });

  // DELETE /api/tasks/:id
  app.delete("/api/tasks/:id", auth, async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM tasks WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // POST /api/tasks/:id/comments
  app.post("/api/tasks/:id/comments", auth, async (req, res, next) => {
    try {
      const { comment } = req.body;
      if (!comment) throw Object.assign(new Error("Comment required"), { status: 400 });
      const { rows } = await pool.query(`
        INSERT INTO task_comments (task_id, user_id, comment) VALUES ($1, $2, $3) RETURNING *
      `, [req.params.id, req.user.id, comment]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // GET /api/tasks/:id/comments
  app.get("/api/tasks/:id/comments", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT tc.*, u.name AS user_name FROM task_comments tc
        LEFT JOIN users u ON tc.user_id = u.id WHERE tc.task_id = $1 ORDER BY tc.created_at
      `, [req.params.id]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. COMMISSIONS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/commissions
  app.get("/api/commissions", auth, async (req, res, next) => {
    try {
      const { userId, status, periodStart, periodEnd, limit = 50, offset = 0 } = req.query;
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      if (userId) { where += ` AND sc.user_id = $${idx++}`; params.push(userId); }
      if (status) { where += ` AND sc.status = $${idx++}`; params.push(status); }
      if (periodStart) { where += ` AND sc.period_start >= $${idx++}`; params.push(periodStart); }
      if (periodEnd) { where += ` AND sc.period_end <= $${idx++}`; params.push(periodEnd); }
      if (req.user.role !== "ADMIN" && req.user.role !== "MANAGER") { where += ` AND sc.user_id = $${idx++}`; params.push(req.user.id); }
      params.push(Number(limit), Number(offset));
      const { rows } = await pool.query(`
        SELECT sc.*, u.name AS user_name, s.receipt_number, ab.name AS approved_by_name
        FROM sales_commissions sc
        LEFT JOIN users u ON sc.user_id = u.id
        LEFT JOIN sales s ON sc.sale_id = s.id
        LEFT JOIN users ab ON sc.approved_by = ab.id
        ${where} ORDER BY sc.created_at DESC LIMIT $${idx++} OFFSET $${idx++}
      `, params);
      const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*)::int AS total FROM sales_commissions sc LEFT JOIN users u ON sc.user_id = u.id ${where}`, params.slice(0, -2));
      res.json({ data: rows, total });
    } catch (e) { next(e); }
  });

  // POST /api/commissions/approve — approve pending commissions
  app.post("/api/commissions/approve", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { ids } = req.body; // array of commission IDs
      if (!ids?.length) throw Object.assign(new Error("Commission IDs required"), { status: 400 });
      await pool.query(`
        UPDATE sales_commissions SET status = 'approved', approved_by = $1, approved_at = NOW()
        WHERE id = ANY($2) AND status = 'pending'
      `, [req.user.id, ids]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // POST /api/commissions/pay — mark commissions as paid
  app.post("/api/commissions/pay", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      const { ids } = req.body;
      if (!ids?.length) throw Object.assign(new Error("Commission IDs required"), { status: 400 });
      await pool.query(`UPDATE sales_commissions SET status = 'paid', paid_at = NOW() WHERE id = ANY($1) AND status = 'approved'`, [ids]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // GET /api/commissions/rules
  app.get("/api/commissions/rules", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT cr.*, u.name AS user_name FROM commission_rules cr
        LEFT JOIN users u ON cr.user_id = u.id ORDER BY cr.created_at DESC
      `);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // POST /api/commissions/rules
  app.post("/api/commissions/rules", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      const { userId, role, commissionRate, minSaleAmount, branchId } = req.body;
      if (!commissionRate) throw Object.assign(new Error("Commission rate required"), { status: 400 });
      const { rows } = await pool.query(`
        INSERT INTO commission_rules (user_id, role, commission_rate, min_sale_amount, branch_id)
        VALUES ($1,$2,$3,$4,$5) RETURNING *
      `, [userId || null, role || null, commissionRate, minSaleAmount || 0, branchId || null]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // GET /api/commissions/summary — per-user commission totals
  app.get("/api/commissions/summary", auth, async (req, res, next) => {
    try {
      const { periodStart, periodEnd } = req.query;
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      if (periodStart) { where += ` AND sc.period_start >= $${idx++}`; params.push(periodStart); }
      if (periodEnd) { where += ` AND sc.period_end <= $${idx++}`; params.push(periodEnd); }
      const { rows } = await pool.query(`
        SELECT u.id AS user_id, u.name AS user_name, u.role,
               COUNT(*)::int AS total_sales,
               COALESCE(SUM(sc.sale_amount),0)::float AS total_revenue,
               COALESCE(SUM(sc.commission_amount),0)::float AS total_commission,
               COUNT(*) FILTER (WHERE sc.status='pending')::int AS pending,
               COUNT(*) FILTER (WHERE sc.status='approved')::int AS approved,
               COUNT(*) FILTER (WHERE sc.status='paid')::int AS paid
        FROM sales_commissions sc LEFT JOIN users u ON sc.user_id = u.id
        ${where}
        GROUP BY u.id, u.name, u.role ORDER BY total_commission DESC
      `, params);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. PRODUCT BUNDLES / KITS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/bundles
  app.get("/api/bundles", auth, async (req, res, next) => {
    try {
      const { active, search, limit = 50, offset = 0 } = req.query;
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      if (active === "true") { where += ` AND pb.is_active = true`; }
      if (search) { where += ` AND pb.name ILIKE $${idx}`; params.push(`%${search}%`); idx++; }
      params.push(Number(limit), Number(offset));
      const { rows } = await pool.query(`
        SELECT pb.*,
          (SELECT COALESCE(SUM(pbi.unit_price * pbi.quantity),0)::float FROM product_bundle_items pbi WHERE pbi.bundle_id = pb.id) AS calculated_total,
          (SELECT COUNT(*)::int FROM product_bundle_items pbi WHERE pbi.bundle_id = pb.id) AS item_count
        FROM product_bundles pb ${where} ORDER BY pb.created_at DESC LIMIT $${idx++} OFFSET $${idx++}
      `, params);
      res.json({ data: rows });
    } catch (e) { next(e); }
  });

  // GET /api/bundles/:id
  app.get("/api/bundles/:id", auth, async (req, res, next) => {
    try {
      const { rows: [bundle] } = await pool.query(`SELECT * FROM product_bundles WHERE id = $1`, [req.params.id]);
      if (!bundle) return res.status(404).json({ message: "Bundle not found" });
      const { rows: items } = await pool.query(`
        SELECT pbi.*, p.name AS product_name, p.barcode, p.category, p.stock
        FROM product_bundle_items pbi LEFT JOIN products p ON pbi.product_id = p.id
        WHERE pbi.bundle_id = $1
      `, [req.params.id]);
      res.json({ ...bundle, items });
    } catch (e) { next(e); }
  });

  // POST /api/bundles
  app.post("/api/bundles", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, description, bundlePrice, discountPercent, category, imageUrl, items } = req.body;
      if (!name || !items?.length) throw Object.assign(new Error("Name and at least one item required"), { status: 400 });
      const { rows: [bundle] } = await pool.query(`
        INSERT INTO product_bundles (name, description, bundle_price, discount_percent, category, image_url)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
      `, [name, description || null, bundlePrice || null, discountPercent || 0, category || null, imageUrl || null]);
      for (const item of items) {
        const { rows: [prod] } = await pool.query(`SELECT price FROM products WHERE id = $1`, [item.productId]);
        if (!prod) continue;
        await pool.query(`
          INSERT INTO product_bundle_items (bundle_id, product_id, quantity, unit_price)
          VALUES ($1,$2,$3,$4)
        `, [bundle.id, item.productId, item.quantity || 1, prod.price]);
      }
      res.status(201).json(bundle);
    } catch (e) { next(e); }
  });

  // PUT /api/bundles/:id
  app.put("/api/bundles/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, description, bundlePrice, discountPercent, category, imageUrl, is_active, items } = req.body;
      const sets = []; const params = []; let idx = 1;
      if (name !== undefined) { sets.push(`name = $${idx++}`); params.push(name); }
      if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description); }
      if (bundlePrice !== undefined) { sets.push(`bundle_price = $${idx++}`); params.push(bundlePrice); }
      if (discountPercent !== undefined) { sets.push(`discount_percent = $${idx++}`); params.push(discountPercent); }
      if (category !== undefined) { sets.push(`category = $${idx++}`); params.push(category); }
      if (imageUrl !== undefined) { sets.push(`image_url = $${idx++}`); params.push(imageUrl); }
      if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(is_active); }
      if (sets.length) {
        sets.push("updated_at = NOW()");
        params.push(req.params.id);
        await pool.query(`UPDATE product_bundles SET ${sets.join(", ")} WHERE id = $${idx}`, params);
      }
      // Update items if provided
      if (items) {
        await pool.query(`DELETE FROM product_bundle_items WHERE bundle_id = $1`, [req.params.id]);
        for (const item of items) {
          const { rows: [prod] } = await pool.query(`SELECT price FROM products WHERE id = $1`, [item.productId]);
          if (!prod) continue;
          await pool.query(`INSERT INTO product_bundle_items (bundle_id, product_id, quantity, unit_price) VALUES ($1,$2,$3,$4)`, [req.params.id, item.productId, item.quantity || 1, prod.price]);
        }
      }
      const { rows } = await pool.query(`SELECT * FROM product_bundles WHERE id = $1`, [req.params.id]);
      res.json(rows[0] || {});
    } catch (e) { next(e); }
  });

  // DELETE /api/bundles/:id
  app.delete("/api/bundles/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM product_bundles WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. QUOTATIONS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/quotations
  app.get("/api/quotations", auth, async (req, res, next) => {
    try {
      const { status, customerId, search, limit = 50, offset = 0 } = req.query;
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      if (status) { where += ` AND q.status = $${idx++}`; params.push(status); }
      if (customerId) { where += ` AND q.customer_id = $${idx++}`; params.push(customerId); }
      if (search) { where += ` AND (q.quote_number ILIKE $${idx} OR q.customer_name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
      if (req.user.branchId && req.user.role !== "ADMIN") { where += ` AND q.branch_id = $${idx++}`; params.push(req.user.branchId); }
      params.push(Number(limit), Number(offset));
      const { rows } = await pool.query(`
        SELECT q.*, u.name AS user_name, c.name AS customer_name_full,
               (SELECT COUNT(*)::int FROM quotation_items qi WHERE qi.quotation_id = q.id) AS item_count
        FROM quotations q
        LEFT JOIN users u ON q.user_id = u.id
        LEFT JOIN customers c ON q.customer_id = c.id
        ${where} ORDER BY q.created_at DESC LIMIT $${idx++} OFFSET $${idx++}
      `, params);
      const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*)::int AS total FROM quotations q ${where}`, params.slice(0, -2));
      res.json({ data: rows, total });
    } catch (e) { next(e); }
  });

  // GET /api/quotations/:id
  app.get("/api/quotations/:id", auth, async (req, res, next) => {
    try {
      const { rows: [quote] } = await pool.query(`
        SELECT q.*, u.name AS user_name FROM quotations q LEFT JOIN users u ON q.user_id = u.id WHERE q.id = $1
      `, [req.params.id]);
      if (!quote) return res.status(404).json({ message: "Quotation not found" });
      const { rows: items } = await pool.query(`
        SELECT qi.*, p.name AS current_product_name, p.price AS current_price, p.stock
        FROM quotation_items qi LEFT JOIN products p ON qi.product_id = p.id WHERE qi.quotation_id = $1
      `, [req.params.id]);
      res.json({ ...quote, items });
    } catch (e) { next(e); }
  });

  // POST /api/quotations
  app.post("/api/quotations", auth, async (req, res, next) => {
    try {
      const { customerId, customerName, customerEmail, customerPhone, items, discount, tax, notes, validUntil } = req.body;
      if (!items?.length) throw Object.assign(new Error("At least one item required"), { status: 400 });
      const quoteNumber = await genQuoteNumber();
      let subtotal = 0;
      for (const item of items) {
        subtotal += (item.unitPrice || 0) * (item.quantity || 1);
      }
      const total = subtotal - (discount || 0) + (tax || 0);
      const { rows: [quote] } = await pool.query(`
        INSERT INTO quotations (quote_number, customer_id, customer_name, customer_email, customer_phone, user_id, branch_id, subtotal, discount, tax, total, notes, valid_until)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
      `, [quoteNumber, customerId || null, customerName || null, customerEmail || null, customerPhone || null, req.user.id, req.user.branchId || null, subtotal, discount || 0, tax || 0, total, notes || null, validUntil || null]);
      for (const item of items) {
        await pool.query(`
          INSERT INTO quotation_items (quotation_id, product_id, product_name, quantity, unit_price, discount, total)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [quote.id, item.productId, item.productName || "Unknown", item.quantity || 1, item.unitPrice || 0, item.discount || 0, (item.unitPrice || 0) * (item.quantity || 1) - (item.discount || 0)]);
      }
      // Log activity if customer linked
      if (customerId) {
        await pool.query(`INSERT INTO customer_activities (customer_id, activity_type, description, reference_id, reference_type, user_id) VALUES ($1,'note','Quotation created: ${quoteNumber}', $2,'quotation', $3)`, [customerId, quote.id, req.user.id]);
      }
      res.status(201).json(quote);
    } catch (e) { next(e); }
  });

  // PATCH /api/quotations/:id
  app.patch("/api/quotations/:id", auth, async (req, res, next) => {
    try {
      const { status, notes } = req.body;
      const sets = []; const params = []; let idx = 1;
      if (status) { sets.push(`status = $${idx++}`); params.push(status); }
      if (notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(notes); }
      if (status === "converted") { /* handled via convert endpoint */ }
      if (!sets.length) return res.status(400).json({ message: "Nothing to update" });
      sets.push("updated_at = NOW()");
      params.push(req.params.id);
      const { rows } = await pool.query(`UPDATE quotations SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params);
      res.json(rows[0] || {});
    } catch (e) { next(e); }
  });

  // POST /api/quotations/:id/convert — convert quotation to a sale
  app.post("/api/quotations/:id/convert", auth, async (req, res, next) => {
    try {
      const { rows: [quote] } = await pool.query(`SELECT * FROM quotations WHERE id = $1 AND status != 'converted' FOR UPDATE`, [req.params.id]);
      if (!quote) throw Object.assign(new Error("Quotation not found or already converted"), { status: 404 });
      if (new Date(quote.valid_until) < new Date()) throw Object.assign(new Error("Quotation has expired"), { status: 400 });
      // Create the sale
      const { rows: [sale] } = await pool.query(`
        INSERT INTO sales (customer_name, customer_id, user_id, branch_id, subtotal, discount, tax, total, payment_method, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Cash', 'completed') RETURNING *
      `, [quote.customer_name, quote.customer_id, quote.user_id, quote.branch_id, quote.subtotal, quote.discount, quote.tax, quote.total]);
      // Copy items
      const { rows: qItems } = await pool.query(`SELECT * FROM quotation_items WHERE quotation_id = $1`, [quote.id]);
      for (const qi of qItems) {
        await pool.query(`
          INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, discount, total)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [sale.id, qi.product_id, qi.product_name, qi.quantity, qi.unit_price, qi.discount, qi.total]);
        // Update stock
        await pool.query(`UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1`, [qi.quantity, qi.product_id]);
      }
      // Update quotation
      await pool.query(`UPDATE quotations SET status = 'converted', converted_sale_id = $1, updated_at = NOW() WHERE id = $2`, [sale.id, quote.id]);
      res.json({ sale, quote: { ...quote, status: "converted", converted_sale_id: sale.id } });
    } catch (e) { next(e); }
  });

  // DELETE /api/quotations/:id
  app.delete("/api/quotations/:id", auth, async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM quotation_items WHERE quotation_id = $1`, [req.params.id]);
      await pool.query(`DELETE FROM quotations WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. CUSTOMER NOTES / CLIENTELING
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/customers/:id/notes
  app.get("/api/customers/:id/notes", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT cn.*, u.name AS user_name FROM customer_notes cn
        LEFT JOIN users u ON cn.user_id = u.id
        WHERE cn.customer_id = $1 ORDER BY cn.is_pinned DESC, cn.created_at DESC
      `, [req.params.id]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // POST /api/customers/:id/notes
  app.post("/api/customers/:id/notes", auth, async (req, res, next) => {
    try {
      const { noteType, title, content, isPinned } = req.body;
      if (!content) throw Object.assign(new Error("Content required"), { status: 400 });
      const { rows } = await pool.query(`
        INSERT INTO customer_notes (customer_id, user_id, note_type, title, content, is_pinned)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
      `, [req.params.id, req.user.id, noteType || "general", title || null, content, isPinned || false]);
      // Log activity
      await pool.query(`INSERT INTO customer_activities (customer_id, activity_type, description, reference_id, reference_type, user_id) VALUES ($1,'note','Note added: ${title || "General note"}', $2,'note', $3)`, [req.params.id, rows[0].id, req.user.id]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // DELETE /api/customers/notes/:id
  app.delete("/api/customers/notes/:id", auth, async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM customer_notes WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // GET /api/customers/:id/activities
  app.get("/api/customers/:id/activities", auth, async (req, res, next) => {
    try {
      const { limit = 50 } = req.query;
      const { rows } = await pool.query(`
        SELECT ca.*, u.name AS user_name FROM customer_activities ca
        LEFT JOIN users u ON ca.user_id = u.id
        WHERE ca.customer_id = $1 ORDER BY ca.created_at DESC LIMIT $2
      `, [req.params.id, Number(limit)]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. PRICE CHECKS & OVERRIDES
  // ═══════════════════════════════════════════════════════════════════

  // POST /api/price-check
  app.post("/api/price-check", auth, async (req, res, next) => {
    try {
      const { productId, barcode, overriddenPrice, overrideReason } = req.body;
      let product;
      if (productId) {
        const { rows } = await pool.query(`SELECT * FROM products WHERE id = $1`, [productId]);
        product = rows[0];
      } else if (barcode) {
        const { rows } = await pool.query(`SELECT * FROM products WHERE barcode = $1`, [barcode]);
        product = rows[0];
      }
      if (!product) return res.status(404).json({ message: "Product not found" });
      // Log price check
      await pool.query(`
        INSERT INTO price_checks (user_id, product_id, checked_price, overridden_price, override_reason, branch_id)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [req.user.id, product.id, product.price, overriddenPrice || null, overrideReason || null, req.user.branchId || null]);
      res.json({
        product: { id: product.id, name: product.name, barcode: product.barcode, price: product.price, category: product.category, stock: product.stock },
        overriddenPrice: overriddenPrice || null,
        canOverride: ["ADMIN", "MANAGER"].includes(req.user.role),
      });
    } catch (e) { next(e); }
  });

  // GET /api/price-checks (audit log)
  app.get("/api/price-checks", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { userId, limit = 50, offset = 0 } = req.query;
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      if (userId) { where += ` AND pc.user_id = $${idx++}`; params.push(userId); }
      params.push(Number(limit), Number(offset));
      const { rows } = await pool.query(`
        SELECT pc.*, u.name AS user_name, p.name AS product_name, p.barcode AS product_barcode
        FROM price_checks pc LEFT JOIN users u ON pc.user_id = u.id LEFT JOIN products p ON pc.product_id = p.id
        ${where} ORDER BY pc.created_at DESC LIMIT $${idx++} OFFSET $${idx++}
      `, params);
      res.json({ data: rows });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 10. PRODUCT DETAIL (related products, bundles, sales history)
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/products/:id/detail — rich product detail with related, bundles, recent sales
  app.get("/api/products/:id/detail", auth, async (req, res, next) => {
    try {
      const { rows: [product] } = await pool.query(`
        SELECT p.*, c.name AS category_name,
          (SELECT COUNT(*)::int FROM sale_items si JOIN sales s ON si.sale_id = s.id WHERE si.product_id = p.id AND s.created_at >= NOW() - INTERVAL '30 days') AS recent_sales_count,
          (SELECT COALESCE(SUM(si.quantity), 0)::int FROM sale_items si JOIN sales s ON si.sale_id = s.id WHERE si.product_id = p.id AND s.created_at >= NOW() - INTERVAL '30 days') AS recent_qty_sold
        FROM products p
        LEFT JOIN categories c ON LOWER(p.category) = LOWER(c.name)
        WHERE p.id = $1
      `, [req.params.id]);
      if (!product) return res.status(404).json({ message: "Product not found" });

      // Related products: same category, excluding self
      const { rows: relatedProducts } = await pool.query(`
        SELECT id, name, barcode, category, price, stock, image_url, reorder_level
        FROM products
        WHERE LOWER(category) = LOWER($1) AND id != $2 AND is_active = true
        ORDER BY RANDOM() LIMIT 8
      `, [product.category, product.id]);

      // Bundles containing this product
      const { rows: bundles } = await pool.query(`
        SELECT pb.id, pb.name, pb.description, pb.bundle_price, pb.discount_percent, pb.category,
          (SELECT COUNT(*)::int FROM product_bundle_items pbi2 WHERE pbi2.bundle_id = pb.id) AS item_count,
          (SELECT COALESCE(SUM(pbi2.unit_price * pbi2.quantity), 0)::float FROM product_bundle_items pbi2 WHERE pbi2.bundle_id = pb.id) AS calculated_total
        FROM product_bundles pb
        JOIN product_bundle_items pbi ON pb.id = pbi.bundle_id
        WHERE pbi.product_id = $1 AND pb.is_active = true
        GROUP BY pb.id
      `, [product.id]);

      // Recent sales for this product (last 10)
      const { rows: recentSales } = await pool.query(`
        SELECT s.id, s.receipt_number, s.created_at, si.quantity, si.unit_price, si.total, u.name AS cashier_name
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        LEFT JOIN users u ON s.user_id = u.id
        WHERE si.product_id = $1
        ORDER BY s.created_at DESC LIMIT 10
      `, [product.id]);

      // Top buyers (customers who bought this product)
      const { rows: topBuyers } = await pool.query(`
        SELECT c.id, c.name, c.phone, c.email, COUNT(*)::int AS purchase_count, SUM(si.quantity)::int AS total_qty
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN customers c ON s.customer_id = c.id
        WHERE si.product_id = $1
        GROUP BY c.id, c.name, c.phone, c.email
        ORDER BY total_qty DESC LIMIT 5
      `, [product.id]);

      // Sales trend (last 7 days)
      const { rows: salesTrend } = await pool.query(`
        SELECT DATE(s.created_at) AS day, SUM(si.quantity)::int AS qty, SUM(si.total)::float AS revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE si.product_id = $1 AND s.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(s.created_at) ORDER BY day
      `, [product.id]);

      // Inventory movements (last 10)
      const { rows: movements } = await pool.query(`
        SELECT im.*, u.name AS user_name
        FROM inventory_movements im
        LEFT JOIN users u ON im.user_id = u.id
        WHERE im.product_id = $1
        ORDER BY im.created_at DESC LIMIT 10
      `, [product.id]);

      res.json({
        product,
        relatedProducts,
        bundles,
        recentSales,
        topBuyers,
        salesTrend,
        movements,
      });
    } catch (e) { next(e); }
  });

};
