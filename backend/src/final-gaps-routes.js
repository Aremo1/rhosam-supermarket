// ═══════════════════════════════════════════════════════════════════
// Final Gaps Routes (6 features)
// Layaway/Deposits, Loyalty Points, Customer Groups,
// Marketing Segmentation, Label Printing, Omnichannel (BOPIS)
// ═══════════════════════════════════════════════════════════════════

module.exports = function registerFinalGapsRoutes(app, pool, auth, allow) {

  // Helper: generate order numbers
  async function genOrderNumber(prefix) {
    const { rows } = await pool.query(`SELECT COALESCE(MAX(id),0)+1 AS seq FROM layaway_orders`);
    return `${prefix}-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(rows[0].seq).padStart(5,"0")}`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. LAYAWAY / DEPOSITS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/layaway-orders
  app.get("/api/layaway-orders", auth, async (req, res, next) => {
    try {
      const { status, customerId, search, limit = 50, offset = 0 } = req.query;
      let where = "WHERE 1=1";
      const params = [];
      let idx = 1;
      if (status) { where += ` AND lo.status = $${idx++}`; params.push(status); }
      if (customerId) { where += ` AND lo.customer_id = $${idx++}`; params.push(Number(customerId)); }
      if (search) { where += ` AND (lo.order_number ILIKE $${idx} OR c.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
      params.push(Number(limit), Number(offset));
      const { rows } = await pool.query(`
        SELECT lo.*, c.name AS customer_name, u.name AS created_by_name, b.name AS branch_name,
               (SELECT COALESCE(SUM(lpay.amount),0) FROM layaway_payments lpay WHERE lpay.layaway_order_id = lo.id) AS total_paid,
               (SELECT COUNT(*) FROM layaway_items li WHERE li.layaway_order_id = lo.id) AS item_count
        FROM layaway_orders lo
        LEFT JOIN customers c ON lo.customer_id = c.id
        LEFT JOIN users u ON lo.created_by = u.id
        LEFT JOIN branches b ON lo.branch_id = b.id
        ${where}
        ORDER BY lo.created_at DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `, params);
      res.json({ data: rows });
    } catch (e) { next(e); }
  });

  // GET /api/layaway-orders/:id
  app.get("/api/layaway-orders/:id", auth, async (req, res, next) => {
    try {
      const { rows: [order] } = await pool.query(`
        SELECT lo.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
               u.name AS created_by_name
        FROM layaway_orders lo
        LEFT JOIN customers c ON lo.customer_id = c.id
        LEFT JOIN users u ON lo.created_by = u.id
        WHERE lo.id = $1
      `, [req.params.id]);
      if (!order) return res.status(404).json({ message: "Order not found" });
      const { rows: items } = await pool.query(`SELECT li.*, p.barcode FROM layaway_items li LEFT JOIN products p ON li.product_id = p.id WHERE li.layaway_order_id = $1`, [req.params.id]);
      const { rows: payments } = await pool.query(`SELECT lp.*, u.name AS received_by_name FROM layaway_payments lp LEFT JOIN users u ON lp.received_by = u.id WHERE lp.layaway_order_id = $1 ORDER BY lp.created_at`, [req.params.id]);
      res.json({ ...order, items, payments });
    } catch (e) { next(e); }
  });

  // POST /api/layaway-orders — create layaway with items and initial deposit
  app.post("/api/layaway-orders", auth, allow("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
    try {
      const { customerId, branchId, items, depositAmount, notes, dueDate } = req.body;
      if (!items || !items.length) return res.status(400).json({ message: "At least one item required" });
      const orderNumber = await genOrderNumber("LY");
      const totalAmount = items.reduce((sum, i) => sum + (i.unitPrice * i.quantity), 0);
      const deposit = Number(depositAmount) || 0;
      const balance = totalAmount - deposit;

      const { rows: [order] } = await pool.query(`
        INSERT INTO layaway_orders (order_number, customer_id, branch_id, total_amount, deposit_amount, balance_due, notes, due_date, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
      `, [orderNumber, customerId || null, branchId || req.user.branchId || null, totalAmount, deposit, balance, notes || null, dueDate || null, req.user.id]);

      for (const item of items) {
        await pool.query(`
          INSERT INTO layaway_items (layaway_order_id, product_id, product_name, quantity, unit_price)
          VALUES ($1, $2, $3, $4, $5)
        `, [order.id, item.productId, item.productName, item.quantity, item.unitPrice]);
      }

      // Record initial deposit if any
      if (deposit > 0) {
        await pool.query(`
          INSERT INTO layaway_payments (layaway_order_id, amount, payment_method, notes, received_by)
          VALUES ($1, $2, $3, 'Initial deposit', $4)
        `, [order.id, deposit, req.body.paymentMethod || 'Cash', req.user.id]);
      }

      // Mark completed if fully paid
      if (balance <= 0) {
        await pool.query(`UPDATE layaway_orders SET status = 'COMPLETED', completed_at = NOW() WHERE id = $1`, [order.id]);
      }

      res.status(201).json(order);
    } catch (e) { next(e); }
  });

  // POST /api/layaway-orders/:id/pay — make a payment toward layaway
  app.post("/api/layaway-orders/:id/pay", auth, allow("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
    try {
      const { amount, paymentMethod, reference, notes } = req.body;
      if (!amount || amount <= 0) return res.status(400).json({ message: "Amount required" });
      const { rows: [order] } = await pool.query(`SELECT * FROM layaway_orders WHERE id = $1`, [req.params.id]);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== 'ACTIVE') return res.status(400).json({ message: `Order is ${order.status}` });

      await pool.query(`INSERT INTO layaway_payments (layaway_order_id, amount, payment_method, reference, notes, received_by) VALUES ($1, $2, $3, $4, $5, $6)`, [req.params.id, amount, paymentMethod || 'Cash', reference || null, notes || null, req.user.id]);

      const newBalance = order.balance_due - amount;
      const newStatus = newBalance <= 0 ? 'COMPLETED' : 'ACTIVE';
      await pool.query(`UPDATE layaway_orders SET balance_due = GREATEST($1, 0), status = $2, completed_at = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE completed_at END, updated_at = NOW() WHERE id = $3`, [newBalance, newStatus, req.params.id]);

      res.json({ message: "Payment recorded", balanceDue: Math.max(newBalance, 0), status: newStatus });
    } catch (e) { next(e); }
  });

  // POST /api/layaway-orders/:id/fulfill — convert layaway to sale
  app.post("/api/layaway-orders/:id/fulfill", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { rows: [order] } = await pool.query(`SELECT * FROM layaway_orders WHERE id = $1`, [req.params.id]);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== 'COMPLETED') return res.status(400).json({ message: "Order balance must be fully paid before fulfillment" });

      const { rows: items } = await pool.query(`SELECT * FROM layaway_items WHERE layaway_order_id = $1`, [order.id]);

      // Create the actual sale
      const { rows: [sale] } = await pool.query(`
        INSERT INTO sales (receipt_number, customer_id, customer_name, payment_method, subtotal, total, amount_paid, change_amount, cashier_id, branch_id)
        VALUES ($1, $2, $3, 'LAYAWAY', $4, $4, $4, 0, $5, $6) RETURNING *
      `, [`LY-SALE-${order.order_number}`, order.customer_id, 'Layaway', order.total_amount, req.user.id, order.branch_id]);

      for (const item of items) {
        await pool.query(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, line_total) VALUES ($1, $2, $3, $4, $5, $6)`, [sale.id, item.product_id, item.product_name, item.quantity, item.unit_price, item.line_total]);
        await pool.query(`UPDATE products SET stock = stock - $1 WHERE id = $2`, [item.quantity, item.product_id]);
      }

      await pool.query(`UPDATE layaway_orders SET status = 'FULFILLED', updated_at = NOW() WHERE id = $1`, [order.id]);
      res.json({ message: "Layaway fulfilled as sale", saleId: sale.id, receiptNumber: sale.receipt_number });
    } catch (e) { next(e); }
  });

  // DELETE /api/layaway-orders/:id
  app.delete("/api/layaway-orders/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      await pool.query(`UPDATE layaway_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 AND status = 'ACTIVE'`, [req.params.id]);
      res.json({ message: "Order cancelled" });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. LOYALTY POINTS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/loyalty/points — list all customer loyalty balances
  app.get("/api/loyalty/points", auth, async (req, res, next) => {
    try {
      const { customerId, tier } = req.query;
      let where = "WHERE 1=1";
      const params = [];
      let idx = 1;
      if (customerId) { where += ` AND lp.customer_id = $${idx++}`; params.push(Number(customerId)); }
      if (tier) { where += ` AND lp.tier = $${idx++}`; params.push(tier); }
      const { rows } = await pool.query(`
        SELECT lp.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
        FROM loyalty_points lp
        LEFT JOIN customers c ON lp.customer_id = c.id
        ${where} ORDER BY lp.points_balance DESC
      `, params);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // GET /api/loyalty/points/:customerId
  app.get("/api/loyalty/points/:customerId", auth, async (req, res, next) => {
    try {
      const { rows: [points] } = await pool.query(`SELECT lp.*, c.name AS customer_name FROM loyalty_points lp LEFT JOIN customers c ON lp.customer_id = c.id WHERE lp.customer_id = $1`, [req.params.customerId]);
      if (!points) return res.json({ customer_id: req.params.customerId, points_balance: 0, tier: 'BRONZE', lifetime_earned: 0, lifetime_redeemed: 0 });
      const { rows: transactions } = await pool.query(`SELECT * FROM loyalty_transactions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.params.customerId]);
      res.json({ ...points, transactions });
    } catch (e) { next(e); }
  });

  // POST /api/loyalty/earn — earn points for a sale
  app.post("/api/loyalty/earn", auth, async (req, res, next) => {
    try {
      const { customerId, saleId, amount } = req.body;
      if (!customerId || !amount) return res.status(400).json({ message: "customerId and amount required" });
      // Get default earn rate (1 point per ₦100)
      const { rows: rules } = await pool.query(`SELECT * FROM loyalty_rules WHERE rule_type = 'EARN_PER_Naira' AND is_active = TRUE LIMIT 1`);
      const earnRate = rules[0]?.value || 100; // points per naira
      const pointsEarned = Math.floor(amount / earnRate);

      // Upsert loyalty points
      const { rows: [existing] } = await pool.query(`SELECT * FROM loyalty_points WHERE customer_id = $1`, [customerId]);
      let newBalance, tier;
      if (existing) {
        newBalance = existing.points_balance + pointsEarned;
        tier = calcTier(existing.lifetime_earned + pointsEarned);
        await pool.query(`UPDATE loyalty_points SET points_balance = $1, lifetime_earned = lifetime_earned + $2, tier = $3, updated_at = NOW() WHERE customer_id = $4`, [newBalance, pointsEarned, tier, customerId]);
      } else {
        newBalance = pointsEarned;
        tier = calcTier(pointsEarned);
        await pool.query(`INSERT INTO loyalty_points (customer_id, points_balance, lifetime_earned, tier) VALUES ($1, $2, $2, $3)`, [customerId, pointsEarned, tier]);
      }

      await pool.query(`INSERT INTO loyalty_transactions (customer_id, type, points, balance_after, sale_id, description, created_by) VALUES ($1, 'EARN', $2, $3, $4, $5, $6)`, [customerId, pointsEarned, newBalance, saleId || null, `Earned ₦${Number(amount).toLocaleString()}`, req.user.id]);
      res.json({ pointsEarned, newBalance, tier });
    } catch (e) { next(e); }
  });

  // POST /api/loyalty/redeem — redeem points for discount
  app.post("/api/loyalty/redeem", auth, async (req, res, next) => {
    try {
      const { customerId, points, saleId } = req.body;
      if (!customerId || !points || points <= 0) return res.status(400).json({ message: "customerId and points required" });
      const { rows: [existing] } = await pool.query(`SELECT * FROM loyalty_points WHERE customer_id = $1`, [customerId]);
      if (!existing || existing.points_balance < points) return res.status(400).json({ message: "Insufficient points" });

      // Get redeem rate
      const { rows: rules } = await pool.query(`SELECT * FROM loyalty_rules WHERE rule_type = 'REDEEM_RATE' AND is_active = TRUE LIMIT 1`);
      const redeemRate = rules[0]?.value || 1; // naira per point
      const discountAmount = points * redeemRate;
      const newBalance = existing.points_balance - points;

      await pool.query(`UPDATE loyalty_points SET points_balance = $1, lifetime_redeemed = lifetime_redeemed + $2, updated_at = NOW() WHERE customer_id = $3`, [newBalance, points, customerId]);
      await pool.query(`INSERT INTO loyalty_transactions (customer_id, type, points, balance_after, sale_id, description, created_by) VALUES ($1, 'REDEEM', $2, $3, $4, $5, $6)`, [customerId, points, newBalance, saleId || null, `Redeemed ${points} points for ₦${discountAmount.toLocaleString()}`, req.user.id]);
      res.json({ pointsRedeemed: points, discountAmount, newBalance });
    } catch (e) { next(e); }
  });

  // POST /api/loyalty/adjust — admin adjust points
  app.post("/api/loyalty/adjust", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      const { customerId, points, reason } = req.body;
      if (!customerId || !points) return res.status(400).json({ message: "customerId and points required" });
      const { rows: [existing] } = await pool.query(`SELECT * FROM loyalty_points WHERE customer_id = $1`, [customerId]);
      const oldBalance = existing?.points_balance || 0;
      const newBalance = oldBalance + points;
      if (existing) {
        await pool.query(`UPDATE loyalty_points SET points_balance = $1, updated_at = NOW() WHERE customer_id = $2`, [newBalance, customerId]);
      } else {
        await pool.query(`INSERT INTO loyalty_points (customer_id, points_balance, tier) VALUES ($1, $2, $3)`, [customerId, newBalance, calcTier(newBalance)]);
      }
      await pool.query(`INSERT INTO loyalty_transactions (customer_id, type, points, balance_after, description, created_by) VALUES ($1, 'ADJUST', $2, $3, $4, $5)`, [customerId, points, newBalance, reason || 'Admin adjustment', req.user.id]);
      res.json({ newBalance });
    } catch (e) { next(e); }
  });

  // Loyalty rules CRUD
  app.get("/api/loyalty/rules", auth, async (req, res, next) => {
    try { const { rows } = await pool.query(`SELECT * FROM loyalty_rules ORDER BY id`); res.json(rows); } catch (e) { next(e); }
  });
  app.post("/api/loyalty/rules", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      const { name, ruleType, value, minSpend } = req.body;
      const { rows } = await pool.query(`INSERT INTO loyalty_rules (name, rule_type, value, min_spend) VALUES ($1, $2, $3, $4) RETURNING *`, [name, ruleType, value || 1, minSpend || 0]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });
  app.delete("/api/loyalty/rules/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try { await pool.query(`DELETE FROM loyalty_rules WHERE id = $1`, [req.params.id]); res.json({ message: "Deleted" }); } catch (e) { next(e); }
  });

  function calcTier(lifetimeEarned) {
    const t = Number(lifetimeEarned || 0);
    if (t >= 10000) return "PLATINUM";
    if (t >= 5000) return "GOLD";
    if (t >= 2000) return "SILVER";
    return "BRONZE";
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. CUSTOMER GROUPS
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/customer-groups", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT cg.*, (SELECT COUNT(*) FROM customer_group_members cgm WHERE cgm.group_id = cg.id) AS member_count
        FROM customer_groups cg ORDER BY cg.name
      `);
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.post("/api/customer-groups", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, description, discountPercent, color } = req.body;
      if (!name) return res.status(400).json({ message: "Name required" });
      const { rows } = await pool.query(`INSERT INTO customer_groups (name, description, discount_percent, color) VALUES ($1, $2, $3, $4) RETURNING *`, [name, description || null, discountPercent || 0, color || '#16a34a']);
      res.status(201).json(rows[0]);
    } catch (e) { e.code === '23505' ? res.status(409).json({ message: "Group name already exists" }) : next(e); }
  });

  app.patch("/api/customer-groups/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, description, discountPercent, color, isActive } = req.body;
      const updates = []; const params = []; let idx = 1;
      if (name !== undefined) { updates.push(`name=$${idx++}`); params.push(name); }
      if (description !== undefined) { updates.push(`description=$${idx++}`); params.push(description); }
      if (discountPercent !== undefined) { updates.push(`discount_percent=$${idx++}`); params.push(discountPercent); }
      if (color !== undefined) { updates.push(`color=$${idx++}`); params.push(color); }
      if (isActive !== undefined) { updates.push(`is_active=$${idx++}`); params.push(isActive); }
      if (!updates.length) return res.status(400).json({ message: "No fields to update" });
      updates.push(`updated_at=NOW()`); params.push(req.params.id);
      const { rows } = await pool.query(`UPDATE customer_groups SET ${updates.join(",")} WHERE id=$${idx} RETURNING *`, params);
      res.json(rows[0]);
    } catch (e) { next(e); }
  });

  app.delete("/api/customer-groups/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try { await pool.query(`DELETE FROM customer_groups WHERE id = $1`, [req.params.id]); res.json({ message: "Deleted" }); } catch (e) { next(e); }
  });

  // Add/remove members
  app.post("/api/customer-groups/:id/members", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { customerId } = req.body;
      await pool.query(`INSERT INTO customer_group_members (customer_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [customerId, req.params.id]);
      res.json({ message: "Member added" });
    } catch (e) { next(e); }
  });

  app.delete("/api/customer-groups/:id/members/:customerId", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM customer_group_members WHERE customer_id = $1 AND group_id = $2`, [req.params.customerId, req.params.id]);
      res.json({ message: "Member removed" });
    } catch (e) { next(e); }
  });

  app.get("/api/customer-groups/:id/members", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT c.*, cgm.joined_at FROM customer_group_members cgm
        LEFT JOIN customers c ON cgm.customer_id = c.id
        WHERE cgm.group_id = $1 ORDER BY c.name
      `, [req.params.id]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. MARKETING SEGMENTATION
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/marketing/segments", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try { const { rows } = await pool.query(`SELECT * FROM marketing_segments ORDER BY created_at DESC`); res.json(rows); } catch (e) { next(e); }
  });

  app.post("/api/marketing/segments", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, description, segmentType, criteria } = req.body;
      const { rows } = await pool.query(`INSERT INTO marketing_segments (name, description, segment_type, criteria, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [name, description || null, segmentType || 'CUSTOM', JSON.stringify(criteria || {}), req.user.id]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  app.post("/api/marketing/segments/:id/preview", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { rows: [seg] } = await pool.query(`SELECT * FROM marketing_segments WHERE id = $1`, [req.params.id]);
      if (!seg) return res.status(404).json({ message: "Segment not found" });
      const criteria = seg.criteria || {};
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      if (criteria.min_spent) { where += ` AND c.total_spent >= $${idx++}`; params.push(criteria.min_spent); }
      if (criteria.max_spent) { where += ` AND c.total_spent <= $${idx++}`; params.push(criteria.max_spent); }
      if (criteria.last_purchase_days) { where += ` AND c.last_purchase_date >= NOW() - INTERVAL '${Number(criteria.last_purchase_days)} days'`; }
      if (criteria.group_id) { where += ` AND c.group_id = $${idx++}`; params.push(criteria.group_id); }
      if (criteria.tier) { where += ` AND c.membership_tier = $${idx++}`; params.push(criteria.tier); }
      const { rows: customers } = await pool.query(`SELECT c.id, c.name, c.email, c.phone, c.total_spent, c.membership_tier FROM customers c ${where} ORDER BY c.name`, params);
      await pool.query(`UPDATE marketing_segments SET customer_count = $1, updated_at = NOW() WHERE id = $2`, [customers.length, seg.id]);
      res.json({ segment: { ...seg, customer_count: customers.length }, customers });
    } catch (e) { next(e); }
  });

  app.delete("/api/marketing/segments/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try { await pool.query(`DELETE FROM marketing_segments WHERE id = $1`, [req.params.id]); res.json({ message: "Deleted" }); } catch (e) { next(e); }
  });

  // Campaigns
  app.get("/api/marketing/campaigns", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT mc.*, ms.name AS segment_name, ms.customer_count AS segment_size
        FROM marketing_campaigns mc
        LEFT JOIN marketing_segments ms ON mc.segment_id = ms.id
        ORDER BY mc.created_at DESC
      `);
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.post("/api/marketing/campaigns", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, description, segmentId, campaignType, subject, message, couponId } = req.body;
      const { rows } = await pool.query(`INSERT INTO marketing_campaigns (name, description, segment_id, campaign_type, subject, message, coupon_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [name, description || null, segmentId || null, campaignType || 'EMAIL', subject || null, message || null, couponId || null, req.user.id]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  app.post("/api/marketing/campaigns/:id/send", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { rows: [campaign] } = await pool.query(`SELECT * FROM marketing_campaigns WHERE id = $1`, [req.params.id]);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      if (campaign.status === 'SENT' || campaign.status === 'COMPLETED') return res.status(400).json({ message: "Campaign already sent" });

      // Get segment customers
      let customers = [];
      if (campaign.segment_id) {
        const { rows: segCustomers } = await pool.query(`
          SELECT c.id, c.name, c.email, c.phone FROM customers c
          WHERE EXISTS (SELECT 1 FROM marketing_segments ms
            WHERE ms.id = $1 AND (
              (ms.criteria->>'min_spent')::numeric IS NULL OR c.total_spent >= (ms.criteria->>'min_spent')::numeric
            ))
        `, [campaign.segment_id]);
        customers = segCustomers;
      }

      // Record recipients
      for (const c of customers) {
        await pool.query(`INSERT INTO campaign_recipients (campaign_id, customer_id, status) VALUES ($1, $2, 'SENT')`, [campaign.id, c.id]);
      }

      await pool.query(`UPDATE marketing_campaigns SET status = 'SENT', sent_at = NOW(), sent_count = $1, updated_at = NOW() WHERE id = $2`, [customers.length, campaign.id]);
      res.json({ message: `Campaign sent to ${customers.length} customers`, sentCount: customers.length });
    } catch (e) { next(e); }
  });

  app.delete("/api/marketing/campaigns/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try { await pool.query(`DELETE FROM marketing_campaigns WHERE id = $1`, [req.params.id]); res.json({ message: "Deleted" }); } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. LABEL PRINTING
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/label-templates", auth, async (req, res, next) => {
    try { const { rows } = await pool.query(`SELECT * FROM label_templates ORDER BY is_default DESC, name`); res.json(rows); } catch (e) { next(e); }
  });

  app.post("/api/label-templates", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, widthMm, heightMm, layout, isDefault } = req.body;
      if (isDefault) await pool.query(`UPDATE label_templates SET is_default = FALSE`);
      const { rows } = await pool.query(`INSERT INTO label_templates (name, width_mm, height_mm, layout, is_default) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [name, widthMm || 50, heightMm || 30, JSON.stringify(layout || {}), isDefault || false]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  app.put("/api/label-templates/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, widthMm, heightMm, layout, isDefault } = req.body;
      if (isDefault) await pool.query(`UPDATE label_templates SET is_default = FALSE`);
      const { rows } = await pool.query(`UPDATE label_templates SET name=$1, width_mm=$2, height_mm=$3, layout=$4, is_default=$5, updated_at=NOW() WHERE id=$6 RETURNING *`, [name, widthMm, heightMm, JSON.stringify(layout || {}), isDefault || false, req.params.id]);
      res.json(rows[0]);
    } catch (e) { next(e); }
  });

  app.delete("/api/label-templates/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try { await pool.query(`DELETE FROM label_templates WHERE id = $1`, [req.params.id]); res.json({ message: "Deleted" }); } catch (e) { next(e); }
  });

  // POST /api/label-templates/preview — generate label data for products
  app.post("/api/label-templates/preview", auth, async (req, res, next) => {
    try {
      const { productIds, templateId } = req.body;
      if (!productIds || !productIds.length) return res.status(400).json({ message: "productIds required" });
      const { rows: products } = await pool.query(`SELECT * FROM products WHERE id = ANY($1)`, [productIds]);
      let template = null;
      if (templateId) { const { rows } = await pool.query(`SELECT * FROM label_templates WHERE id = $1`, [templateId]); template = rows[0]; }
      if (!template) { const { rows } = await pool.query(`SELECT * FROM label_templates WHERE is_default = TRUE LIMIT 1`); template = rows[0]; }
      res.json({ products, template });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. OMNICHANNEL FULFILLMENT (BOPIS / Endless Aisle)
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/omnichannel", auth, async (req, res, next) => {
    try {
      const { status, orderType, limit = 50, offset = 0 } = req.query;
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      if (status) { where += ` AND oo.status = $${idx++}`; params.push(status); }
      if (orderType) { where += ` AND oo.order_type = $${idx++}`; params.push(orderType); }
      params.push(Number(limit), Number(offset));
      const { rows } = await pool.query(`
        SELECT oo.*, c.name AS customer_name, b.name AS pickup_branch_name,
               u.name AS assigned_to_name, cr.name AS created_by_name,
               (SELECT COUNT(*) FROM omnichannel_items oi WHERE oi.omnichannel_order_id = oo.id) AS item_count
        FROM omnichannel_orders oo
        LEFT JOIN customers c ON oo.customer_id = c.id
        LEFT JOIN branches b ON oo.pickup_branch_id = b.id
        LEFT JOIN users u ON oo.assigned_to = u.id
        LEFT JOIN users cr ON oo.created_by = cr.id
        ${where}
        ORDER BY oo.created_at DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `, params);
      res.json({ data: rows });
    } catch (e) { next(e); }
  });

  app.get("/api/omnichannel/:id", auth, async (req, res, next) => {
    try {
      const { rows: [order] } = await pool.query(`
        SELECT oo.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
               b.name AS pickup_branch_name, u.name AS assigned_to_name
        FROM omnichannel_orders oo
        LEFT JOIN customers c ON oo.customer_id = c.id
        LEFT JOIN branches b ON oo.pickup_branch_id = b.id
        LEFT JOIN users u ON oo.assigned_to = u.id
        WHERE oo.id = $1
      `, [req.params.id]);
      if (!order) return res.status(404).json({ message: "Order not found" });
      const { rows: items } = await pool.query(`SELECT oi.*, p.barcode FROM omnichannel_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.omnichannel_order_id = $1`, [req.params.id]);
      res.json({ ...order, items });
    } catch (e) { next(e); }
  });

  app.post("/api/omnichannel", auth, allow("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
    try {
      const { customerId, orderType, source, pickupBranchId, shippingAddress, items, notes, estimatedReadyAt } = req.body;
      if (!orderType || !items || !items.length) return res.status(400).json({ message: "orderType and items required" });
      const { rows: [seq] } = await pool.query(`SELECT COALESCE(MAX(id),0)+1 AS seq FROM omnichannel_orders`);
      const orderNumber = `OC-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(seq.seq).padStart(5,"0")}`;
      const subtotal = items.reduce((s, i) => s + (i.unitPrice * i.quantity), 0);
      const shippingFee = orderType === 'SHIP_TO_HOME' ? (req.body.shippingFee || 0) : 0;

      const { rows: [order] } = await pool.query(`
        INSERT INTO omnichannel_orders (order_number, customer_id, order_type, source, pickup_branch_id, shipping_address, subtotal, shipping_fee, total, notes, estimated_ready_at, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
      `, [orderNumber, customerId || null, orderType, source || 'WEB', pickupBranchId || null, shippingAddress || null, subtotal, shippingFee, subtotal + shippingFee, notes || null, estimatedReadyAt || null, req.user.id]);

      for (const item of items) {
        await pool.query(`INSERT INTO omnichannel_items (omnichannel_order_id, product_id, product_name, quantity, unit_price, source_branch_id) VALUES ($1,$2,$3,$4,$5,$6)`, [order.id, item.productId, item.productName, item.quantity, item.unitPrice, item.sourceBranchId || null]);
      }

      // Auto-assign to user's branch for BOPIS
      if (orderType === 'BOPIS' && pickupBranchId) {
        await pool.query(`UPDATE omnichannel_orders SET assigned_to = $1 WHERE id = $2`, [req.user.id, order.id]);
      }

      res.status(201).json(order);
    } catch (e) { next(e); }
  });

  app.patch("/api/omnichannel/:id/status", auth, allow("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
    try {
      const { status, notes } = req.body;
      const validTransitions = {
        PENDING: ['CONFIRMED', 'CANCELLED'],
        CONFIRMED: ['PICKING', 'CANCELLED'],
        PICKING: ['READY', 'CANCELLED'],
        READY: ['SHIPPED', 'DELIVERED', 'CANCELLED'],
        SHIPPED: ['DELIVERED', 'CANCELLED'],
      };
      const { rows: [order] } = await pool.query(`SELECT status FROM omnichannel_orders WHERE id = $1`, [req.params.id]);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!validTransitions[order.status]?.includes(status)) return res.status(400).json({ message: `Cannot transition from ${order.status} to ${status}` });

      const updates = [`status=$1`, `updated_at=NOW()`];
      const params = [status]; let idx = 2;
      if (status === 'READY') { updates.push(`actual_ready_at=NOW()`); }
      if (status === 'DELIVERED') { updates.push(`actual_delivered_at=NOW()`); }
      if (notes) { updates.push(`notes = COALESCE(notes, '') || E'\n' || $${idx++}`); params.push(notes); }
      params.push(req.params.id);

      await pool.query(`UPDATE omnichannel_orders SET ${updates.join(",")} WHERE id=$${idx}`, params);

      // Reserve stock when confirmed
      if (status === 'CONFIRMED') {
        const { rows: items } = await pool.query(`SELECT * FROM omnichannel_items WHERE omnichannel_order_id = $1`, [req.params.id]);
        for (const item of items) {
          await pool.query(`UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1`, [item.quantity, item.product_id]);
        }
      }

      res.json({ message: `Status updated to ${status}` });
    } catch (e) { next(e); }
  });

  app.patch("/api/omnichannel/:id/assign", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { userId } = req.body;
      await pool.query(`UPDATE omnichannel_orders SET assigned_to = $1, updated_at = NOW() WHERE id = $2`, [userId || null, req.params.id]);
      res.json({ message: "Assigned" });
    } catch (e) { next(e); }
  });

  app.delete("/api/omnichannel/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try { await pool.query(`UPDATE omnichannel_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 AND status NOT IN ('DELIVERED','CANCELLED')`, [req.params.id]); res.json({ message: "Cancelled" }); } catch (e) { next(e); }
  });

  // Endless Aisle log
  app.get("/api/endless-aisle", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT ea.*, p.name AS product_name, p.barcode, cb.name AS requested_branch_name, cf.name AS fulfilled_branch_name, c.name AS customer_name
        FROM endless_aisle_log ea
        LEFT JOIN products p ON ea.product_id = p.id
        LEFT JOIN branches cb ON ea.requested_branch_id = cb.id
        LEFT JOIN branches cf ON ea.fulfilled_branch_id = cf.id
        LEFT JOIN customers c ON ea.customer_id = c.id
        ORDER BY ea.created_at DESC LIMIT 100
      `);
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.post("/api/endless-aisle", auth, allow("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
    try {
      const { productId, customerId, requestedBranchId, fulfilledBranchId, notes } = req.body;
      const { rows } = await pool.query(`INSERT INTO endless_aisle_log (product_id, customer_id, requested_branch_id, fulfilled_branch_id, status, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [productId, customerId || null, requestedBranchId || req.user.branchId, fulfilledBranchId || null, fulfilledBranchId ? 'FULFILLED' : 'REQUESTED', notes || null]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });
};
