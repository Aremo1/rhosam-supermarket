// ═══════════════════════════════════════════════════════════════════
// Priority Gaps Routes (8 features)
// Offline sync, Variants, Discounts, Multi-currency, Digital wallets,
// Wish lists, Receipt templates, Fulfillment
// ═══════════════════════════════════════════════════════════════════

module.exports = function registerPriorityGapsRoutes(app, pool, auth, allow) {

  // ═══════════════════════════════════════════════════════════════════
  // 1. OFFLINE MODE — sync queue & data cache
  // ═══════════════════════════════════════════════════════════════════

  // POST /api/offline/sync — device pushes offline transactions
  app.post("/api/offline/sync", auth, async (req, res, next) => {
    try {
      const { deviceId, items } = req.body;
      if (!deviceId || !Array.isArray(items)) return res.status(400).json({ message: "deviceId and items array required" });
      let synced = 0, failed = 0, conflicts = 0;
      for (const item of items) {
        try {
          // Check for duplicate (by client_id in payload)
          const clientId = item.payload?.client_id;
          if (clientId) {
            const { rows } = await pool.query(`SELECT id FROM offline_sync_queue WHERE payload->>'client_id' = $1`, [clientId]);
            if (rows.length) { conflicts++; continue; }
          }
          await pool.query(`INSERT INTO offline_sync_queue (device_id, user_id, action_type, payload, status) VALUES ($1,$2,$3,$4,'pending')`,
            [deviceId, req.user.id, item.actionType, JSON.stringify(item.payload)]);
          synced++;
        } catch (e) { failed++; }
      }
      res.json({ synced, failed, conflicts });
    } catch (e) { next(e); }
  });

  // GET /api/offline/sync/status — check sync status
  app.get("/api/offline/sync/status", auth, async (req, res, next) => {
    try {
      const { deviceId } = req.query;
      const where = deviceId ? `WHERE device_id = $1` : `WHERE user_id = $1`;
      const params = [deviceId || req.user.id];
      const { rows: [counts] } = await pool.query(`
        SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='pending') AS pending,
               COUNT(*) FILTER (WHERE status='synced') AS synced,
               COUNT(*) FILTER (WHERE status='failed') AS failed
        FROM offline_sync_queue ${where}
      `, params);
      res.json(counts || { total: 0, pending: 0, synced: 0, failed: 0 });
    } catch (e) { next(e); }
  });

  // POST /api/offline/sync/process — admin processes pending sync items
  app.post("/api/offline/sync/process", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      const { rows: pending } = await pool.query(`SELECT * FROM offline_sync_queue WHERE status = 'pending' ORDER BY created_at LIMIT 100`);
      let processed = 0;
      for (const item of pending) {
        try {
          const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
          if (item.action_type === 'sale') {
            // Process offline sale
            await pool.query(`INSERT INTO sales (receipt_number,customer_name,payment_method,subtotal,discount,tax,total,amount_paid,change_amount,cashier_id,branch_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [`OFS-${item.id}-${Date.now()}`, payload.customerName || 'Offline Customer', payload.paymentMethod || 'Cash', payload.subtotal || 0, payload.discount || 0, payload.tax || 0, payload.total || 0, payload.amountPaid || 0, 0, item.user_id, payload.branchId || null]);
          }
          await pool.query(`UPDATE offline_sync_queue SET status = 'synced', synced_at = NOW() WHERE id = $1`, [item.id]);
          processed++;
        } catch (e) {
          await pool.query(`UPDATE offline_sync_queue SET status = 'failed', attempts = attempts + 1, last_error = $1 WHERE id = $2`, [e.message, item.id]);
        }
      }
      res.json({ processed, total: pending.length });
    } catch (e) { next(e); }
  });

  // POST /api/offline/cache — store data for offline use
  app.post("/api/offline/cache", auth, async (req, res, next) => {
    try {
      const { deviceId, entityType, entities } = req.body;
      if (!deviceId || !entityType || !Array.isArray(entities)) return res.status(400).json({ message: "Invalid params" });
      for (const entity of entities) {
        await pool.query(`INSERT INTO offline_data_cache (device_id, entity_type, entity_id, data, checksum) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (device_id, entity_type, entity_id) DO UPDATE SET data = $4, checksum = $5, cached_at = NOW()`,
          [deviceId, entityType, entity.id || 0, JSON.stringify(entity), entity._checksum || null]);
      }
      res.json({ cached: entities.length });
    } catch (e) { next(e); }
  });

  // GET /api/offline/cache — retrieve cached data
  app.get("/api/offline/cache", auth, async (req, res, next) => {
    try {
      const { deviceId, entityType } = req.query;
      if (!deviceId) return res.status(400).json({ message: "deviceId required" });
      let where = `WHERE device_id = $1`;
      const params = [deviceId];
      if (entityType) { where += ` AND entity_type = $2`; params.push(entityType); }
      const { rows } = await pool.query(`SELECT * FROM offline_data_cache ${where} ORDER BY cached_at DESC`, params);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. PRODUCT VARIANTS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/products/:id/variants
  app.get("/api/products/:id/variants", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM product_variants WHERE parent_product_id = $1 ORDER BY created_at`, [req.params.id]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // GET /api/products/:id/variant-options
  app.get("/api/products/:id/variant-options", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM product_variant_options WHERE product_id = $1`, [req.params.id]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // POST /api/products/:id/variants — create variant options + generate variants
  app.post("/api/products/:id/variants", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { options, variants } = req.body; // options = [{name:'Color', values:['Red','Blue']}]  variants = [{name:'Red XL', attributes:{Color:'Red',Size:'XL'}, price:..., barcode:...}]
      if (!variants?.length) return res.status(400).json({ message: "At least one variant required" });

      // Save variant options
      if (options?.length) {
        for (const opt of options) {
          await pool.query(`INSERT INTO product_variant_options (product_id, option_name, option_values) VALUES ($1,$2,$3)
            ON CONFLICT (product_id, option_name) DO UPDATE SET option_values = $3`,
            [req.params.id, opt.name, opt.values]);
        }
      }

      // Create variants
      const created = [];
      for (const v of variants) {
        const { rows } = await pool.query(`INSERT INTO product_variants (parent_product_id, variant_name, sku, barcode, attributes, price, cost_price, stock, image_url)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [req.params.id, v.name, v.sku || null, v.barcode || null, JSON.stringify(v.attributes || {}), v.price || null, v.costPrice || null, v.stock || 0, v.imageUrl || null]);
        created.push(rows[0]);
      }
      res.status(201).json(created);
    } catch (e) { next(e); }
  });

  // PUT /api/variants/:id
  app.put("/api/variants/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, sku, barcode, attributes, price, costPrice, stock, imageUrl, isActive } = req.body;
      const sets = []; const params = []; let idx = 1;
      if (name !== undefined) { sets.push(`variant_name = $${idx++}`); params.push(name); }
      if (sku !== undefined) { sets.push(`sku = $${idx++}`); params.push(sku); }
      if (barcode !== undefined) { sets.push(`barcode = $${idx++}`); params.push(barcode); }
      if (attributes !== undefined) { sets.push(`attributes = $${idx++}`); params.push(JSON.stringify(attributes)); }
      if (price !== undefined) { sets.push(`price = $${idx++}`); params.push(price); }
      if (costPrice !== undefined) { sets.push(`cost_price = $${idx++}`); params.push(costPrice); }
      if (stock !== undefined) { sets.push(`stock = $${idx++}`); params.push(stock); }
      if (imageUrl !== undefined) { sets.push(`image_url = $${idx++}`); params.push(imageUrl); }
      if (isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(isActive); }
      if (!sets.length) return res.status(400).json({ message: "Nothing to update" });
      sets.push("updated_at = NOW()");
      params.push(req.params.id);
      const { rows } = await pool.query(`UPDATE product_variants SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params);
      res.json(rows[0] || {});
    } catch (e) { next(e); }
  });

  // DELETE /api/variants/:id
  app.delete("/api/variants/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM product_variants WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. QUANTITY / THRESHOLD / MIX&MATCH DISCOUNTS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/discount-rules
  app.get("/api/discount-rules", auth, async (req, res, next) => {
    try {
      const { active, search } = req.query;
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      if (active === "true") { where += ` AND dr.is_active = true AND dr.end_date IS NULL OR dr.end_date >= NOW()`; }
      if (search) { where += ` AND dr.name ILIKE $${idx}`; params.push(`%${search}%`); idx++; }
      const { rows } = await pool.query(`SELECT dr.*, u.name AS created_by_name FROM discount_rules dr LEFT JOIN users u ON dr.created_by_user_id = u.id ${where} ORDER BY dr.priority DESC, dr.created_at DESC`, params);
      res.json({ data: rows });
    } catch (e) { next(e); }
  });

  // POST /api/discount-rules
  app.post("/api/discount-rules", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const d = req.body;
      if (!d.name || !d.discountType || !d.discountValue) return res.status(400).json({ message: "Name, type, and value required" });
      const { rows } = await pool.query(`INSERT INTO discount_rules (name, description, discount_type, discount_value, discount_applies_to, min_quantity, min_spend, group_a_products, group_a_min_qty, group_b_products, group_b_min_qty, buy_quantity, get_quantity, get_discount_percent, applicable_payment_methods, applicable_products, applicable_categories, max_uses, priority, is_active, start_date, end_date, branch_id, created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
        [d.name, d.description || null, d.discountType, d.discountValue, d.discountAppliesTo || 'transaction', d.minQuantity || null, d.minSpend || null, d.groupAProducts || null, d.groupAMinQty || null, d.groupBProducts || null, d.groupBMinQty || null, d.buyQuantity || null, d.getQuantity || null, d.getDiscountPercent || 100, d.applicablePaymentMethods || null, d.applicableProducts || null, d.applicableCategories || null, d.maxUses || null, d.priority || 0, d.isActive !== false, d.startDate || new Date(), d.endDate || null, d.branchId || null, req.user.id]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // POST /api/discount-rules/calculate — calculate applicable discounts for a cart
  app.post("/api/discount-rules/calculate", auth, async (req, res, next) => {
    try {
      const { items, subtotal, paymentMethod } = req.body; // items = [{productId, quantity, price}]
      const now = new Date();
      const { rows: rules } = await pool.query(`SELECT * FROM discount_rules WHERE is_active = true AND start_date <= $1 AND (end_date IS NULL OR end_date >= $1) ORDER BY priority DESC`, [now]);
      let totalDiscount = 0;
      const appliedDiscounts = [];
      const productIds = (items || []).map(i => i.productId);
      const totalQty = (items || []).reduce((s, i) => s + (i.quantity || 0), 0);

      for (const rule of rules) {
        if (rule.max_uses && rule.used_count >= rule.max_uses) continue;
        let applicable = false;
        let discountAmount = 0;

        switch (rule.discount_type) {
          case 'quantity':
            if (totalQty >= (rule.min_quantity || 1)) {
              applicable = true;
              discountAmount = rule.discount_applies_to === 'line'
                ? Math.min(...(items || []).map(i => (i.price || 0) * (i.quantity || 0))) * (rule.discount_value / 100)
                : subtotal * (rule.discount_value / 100);
            }
            break;
          case 'threshold':
            if (subtotal >= (rule.min_spend || 0)) {
              applicable = true;
              discountAmount = subtotal * (rule.discount_value / 100);
            }
            break;
          case 'tender_based':
            if (rule.applicable_payment_methods && paymentMethod && rule.applicable_payment_methods.includes(paymentMethod)) {
              applicable = true;
              discountAmount = subtotal * (rule.discount_value / 100);
            }
            break;
          case 'buy_x_get_y':
            if (rule.buy_quantity && rule.get_quantity && totalQty >= rule.buy_quantity) {
              const sets = Math.floor(totalQty / rule.buy_quantity);
              const freeItems = sets * rule.get_quantity;
              const sortedItems = [...(items || [])].sort((a, b) => (a.price || 0) - (b.price || 0));
              let remaining = freeItems;
              for (const item of sortedItems) {
                if (remaining <= 0) break;
                const qty = Math.min(item.quantity, remaining);
                discountAmount += (item.price || 0) * qty * (rule.get_discount_percent / 100);
                remaining -= qty;
              }
              applicable = discountAmount > 0;
            }
            break;
          case 'simple':
          default:
            if (subtotal > 0) {
              applicable = true;
              discountAmount = rule.discount_value;
            }
            break;
        }

        if (applicable && discountAmount > 0) {
          totalDiscount += discountAmount;
          appliedDiscounts.push({ ruleId: rule.id, name: rule.name, type: rule.discount_type, amount: Math.round(discountAmount * 100) / 100 });
        }
      }
      res.json({ totalDiscount: Math.round(totalDiscount * 100) / 100, appliedDiscounts });
    } catch (e) { next(e); }
  });

  // PUT /api/discount-rules/:id
  app.put("/api/discount-rules/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const d = req.body;
      const sets = []; const params = []; let idx = 1;
      const allowed = ['name','description','discount_type','discount_value','discount_applies_to','min_quantity','min_spend','max_uses','priority','is_active','end_date'];
      for (const [k, v] of Object.entries(d)) {
        const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowed.includes(col)) { sets.push(`${col} = $${idx++}`); params.push(v); }
      }
      if (!sets.length) return res.status(400).json({ message: "Nothing to update" });
      sets.push("updated_at = NOW()");
      params.push(req.params.id);
      const { rows } = await pool.query(`UPDATE discount_rules SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params);
      res.json(rows[0] || {});
    } catch (e) { next(e); }
  });

  // DELETE /api/discount-rules/:id
  app.delete("/api/discount-rules/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM discount_rules WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. MULTI-CURRENCY
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/currencies
  app.get("/api/currencies", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM currencies WHERE is_active = true ORDER BY is_base_currency DESC, code`);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // GET /api/currencies/rates
  app.get("/api/currencies/rates", auth, async (req, res, next) => {
    try {
      const { from } = req.query;
      let where = "";
      const params = [];
      if (from) { where = `WHERE cr.from_currency_id = (SELECT id FROM currencies WHERE code = $1)`; params.push(from); }
      const { rows } = await pool.query(`
        SELECT cr.*, c1.code AS from_code, c1.symbol AS from_symbol, c2.code AS to_code, c2.symbol AS to_symbol
        FROM currency_rates cr
        JOIN currencies c1 ON cr.from_currency_id = c1.id
        JOIN currencies c2 ON cr.to_currency_id = c2.id
        ${where} ORDER BY c1.code, c2.code
      `, params);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // POST /api/currencies/convert
  app.post("/api/currencies/convert", auth, async (req, res, next) => {
    try {
      const { amount, from, to } = req.body;
      if (!amount || !from || !to) return res.status(400).json({ message: "amount, from, to required" });
      if (from === to) return res.json({ amount, converted: amount, rate: 1 });
      const { rows } = await pool.query(`
        SELECT cr.rate FROM currency_rates cr
        JOIN currencies c1 ON cr.from_currency_id = c1.id
        JOIN currencies c2 ON cr.to_currency_id = c2.id
        WHERE c1.code = $1 AND c2.code = $2
      `, [from, to]);
      if (!rows.length) return res.status(404).json({ message: "No exchange rate found" });
      const converted = Math.round(amount * rows[0].rate * 100) / 100;
      res.json({ amount, from, to, rate: rows[0].rate, converted });
    } catch (e) { next(e); }
  });

  // PUT /api/currencies/rates — admin updates rates
  app.put("/api/currencies/rates", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      const { rates } = req.body; // [{from:'NGN', to:'USD', rate: 0.00065}]
      for (const r of (rates || [])) {
        const { rows: [from] } = await pool.query(`SELECT id FROM currencies WHERE code = $1`, [r.from]);
        const { rows: [to] } = await pool.query(`SELECT id FROM currencies WHERE code = $1`, [r.to]);
        if (from && to) {
          await pool.query(`INSERT INTO currency_rates (from_currency_id, to_currency_id, rate, source, effective_from) VALUES ($1,$2,$3,'manual',NOW())
            ON CONFLICT (from_currency_id, to_currency_id) DO UPDATE SET rate = $3, effective_from = NOW()`,
            [from.id, to.id, r.rate]);
        }
      }
      res.json({ success: true, updated: rates?.length || 0 });
    } catch (e) { next(e); }
  });

  // POST /api/currencies — add new currency
  app.post("/api/currencies", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      const { code, name, symbol, decimalPlaces } = req.body;
      if (!code || !name || !symbol) return res.status(400).json({ message: "code, name, symbol required" });
      const { rows } = await pool.query(`INSERT INTO currencies (code, name, symbol, decimal_places) VALUES ($1,$2,$3,$4) RETURNING *`,
        [code.toUpperCase(), name, symbol, decimalPlaces || 2]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. DIGITAL WALLETS (Apple Pay / Google Pay config)
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/digital-wallets/status
  app.get("/api/digital-wallets/status", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT apple_pay_enabled, google_pay_enabled, apple_pay_merchant_id, google_pay_merchant_id, digital_wallet_env FROM payment_settings LIMIT 1`);
      res.json(rows[0] || { apple_pay_enabled: false, google_pay_enabled: false });
    } catch (e) { next(e); }
  });

  // PUT /api/digital-wallets — update digital wallet settings
  app.put("/api/digital-wallets", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      const { applePayEnabled, googlePayEnabled, applePayMerchantId, googlePayMerchantId, digitalWalletEnv } = req.body;
      const { rows } = await pool.query(`UPDATE payment_settings SET
        apple_pay_enabled = COALESCE($1, apple_pay_enabled),
        google_pay_enabled = COALESCE($2, google_pay_enabled),
        apple_pay_merchant_id = COALESCE($3, apple_pay_merchant_id),
        google_pay_merchant_id = COALESCE($4, google_pay_merchant_id),
        digital_wallet_env = COALESCE($5, digital_wallet_env),
        updated_at = NOW() WHERE id = (SELECT MIN(id) FROM payment_settings) RETURNING *`,
        [applePayEnabled, googlePayEnabled, applePayMerchantId, googlePayMerchantId, digitalWalletEnv]);
      res.json(rows[0] || {});
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. WISH LISTS
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/wishlists/:customerId
  app.get("/api/wishlists/:customerId", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT w.*, p.name AS product_name, p.price, p.stock, p.image_url, p.barcode, p.category,
               u.name AS added_by_name
        FROM wishlists w
        LEFT JOIN products p ON w.product_id = p.id
        LEFT JOIN users u ON w.user_id = u.id
        WHERE w.customer_id = $1 ORDER BY w.created_at DESC
      `, [req.params.customerId]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // POST /api/wishlists
  app.post("/api/wishlists", auth, async (req, res, next) => {
    try {
      const { customerId, productId, notes, priority } = req.body;
      if (!customerId || !productId) return res.status(400).json({ message: "customerId and productId required" });
      const { rows } = await pool.query(`INSERT INTO wishlists (customer_id, product_id, user_id, notes, priority)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (customer_id, product_id) DO UPDATE SET notes = $4, priority = $5
        RETURNING *`, [customerId, productId, req.user.id, notes || null, priority || 'normal']);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // DELETE /api/wishlists/:id
  app.delete("/api/wishlists/:id", auth, async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM wishlists WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. RECEIPT TEMPLATES
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/receipt-templates
  app.get("/api/receipt-templates", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM receipt_templates ORDER BY is_default DESC, name`);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // GET /api/receipt-templates/:id
  app.get("/api/receipt-templates/:id", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM receipt_templates WHERE id = $1`, [req.params.id]);
      res.json(rows[0] || null);
    } catch (e) { next(e); }
  });

  // POST /api/receipt-templates
  app.post("/api/receipt-templates", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      const d = req.body;
      const { rows } = await pool.query(`INSERT INTO receipt_templates (name, is_default, header_text, footer_text, show_logo, show_barcode, show_customer_info, show_cashier_name, show_branch_info, show_loyalty_points, show_tax_breakdown, show_savings, custom_fields, paper_width, font_size, logo_url, theme_color, branch_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [d.name || 'Custom', d.isDefault || false, d.headerText || '', d.footerText || '', d.showLogo !== false, d.showBarcode !== false, d.showCustomerInfo !== false, d.showCashierName !== false, d.showBranchInfo !== false, d.showLoyaltyPoints !== false, d.showTaxBreakdown !== false, d.showSavings || false, JSON.stringify(d.customFields || []), d.paperWidth || 80, d.fontSize || 12, d.logoUrl || null, d.themeColor || '#16a34a', d.branchId || null]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // PUT /api/receipt-templates/:id
  app.put("/api/receipt-templates/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      const d = req.body;
      const sets = []; const params = []; let idx = 1;
      const fieldMap = { name: 'name', isDefault: 'is_default', headerText: 'header_text', footerText: 'footer_text', showLogo: 'show_logo', showBarcode: 'show_barcode', showCustomerInfo: 'show_customer_info', showCashierName: 'show_cashier_name', showBranchInfo: 'show_branch_info', showLoyaltyPoints: 'show_loyalty_points', showTaxBreakdown: 'show_tax_breakdown', showSavings: 'show_savings', customFields: 'custom_fields', paperWidth: 'paper_width', fontSize: 'font_size', logoUrl: 'logo_url', themeColor: 'theme_color', branchId: 'branch_id' };
      for (const [k, v] of Object.entries(d)) {
        const col = fieldMap[k];
        if (col) { sets.push(`${col} = $${idx++}`); params.push(k === 'customFields' ? JSON.stringify(v) : v); }
      }
      if (!sets.length) return res.status(400).json({ message: "Nothing to update" });
      sets.push("updated_at = NOW()");
      params.push(req.params.id);
      const { rows } = await pool.query(`UPDATE receipt_templates SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params);
      res.json(rows[0] || {});
    } catch (e) { next(e); }
  });

  // DELETE /api/receipt-templates/:id
  app.delete("/api/receipt-templates/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM receipt_templates WHERE id = $1 AND is_default = false`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // POST /api/receipt-templates/:id/preview — generate preview receipt data
  app.post("/api/receipt-templates/:id/preview", auth, async (req, res, next) => {
    try {
      const { rows: [template] } = await pool.query(`SELECT * FROM receipt_templates WHERE id = $1`, [req.params.id]);
      if (!template) return res.status(404).json({ message: "Template not found" });
      // Return template with sample data for preview
      res.json({ template, preview: { storeName: 'RHoSAM Supermarket', receiptNumber: 'RHS-PREVIEW-001', date: new Date().toLocaleString(), cashier: 'Demo Cashier', branch: 'Main Branch', items: [{ name: 'Sample Product', qty: 2, price: 1500, total: 3000 }], subtotal: 3000, discount: 0, tax: 0, total: 3000, amountPaid: 3000, change: 0, loyaltyPoints: 30 } });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. FULFILLMENT WORKFLOW (pick/pack/ship)
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/fulfillments
  app.get("/api/fulfillments", auth, async (req, res, next) => {
    try {
      const { status, search, limit = 50, offset = 0 } = req.query;
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      if (status) { where += ` AND f.status = $${idx++}`; params.push(status); }
      if (search) { where += ` AND (f.fulfillment_number ILIKE $${idx} OR c.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
      if (req.user.branchId && req.user.role !== "ADMIN") { where += ` AND f.branch_id = $${idx++}`; params.push(req.user.branchId); }
      params.push(Number(limit), Number(offset));
      const { rows } = await pool.query(`
        SELECT f.*, c.name AS customer_name, s.receipt_number, u.name AS created_by_name,
               (SELECT COUNT(*)::int FROM fulfillment_items fi WHERE fi.fulfillment_id = f.id) AS item_count,
               (SELECT COUNT(*)::int FROM fulfillment_items fi WHERE fi.fulfillment_id = f.id AND fi.status = 'picked') AS picked_count
        FROM fulfillments f
        LEFT JOIN customers c ON f.customer_id = c.id
        LEFT JOIN sales s ON f.sale_id = s.id
        LEFT JOIN users u ON f.picked_by = u.id OR f.packed_by = u.id OR f.shipped_by = u.id
        ${where} ORDER BY f.created_at DESC LIMIT $${idx++} OFFSET $${idx++}
      `, params);
      const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*)::int AS total FROM fulfillments f LEFT JOIN customers c ON f.customer_id = c.id ${where}`, params.slice(0, -2));
      res.json({ data: rows, total });
    } catch (e) { next(e); }
  });

  // GET /api/fulfillments/:id
  app.get("/api/fulfillments/:id", auth, async (req, res, next) => {
    try {
      const { rows: [fulfillment] } = await pool.query(`
        SELECT f.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
               s.receipt_number, s.total AS sale_total
        FROM fulfillments f
        LEFT JOIN customers c ON f.customer_id = c.id
        LEFT JOIN sales s ON f.sale_id = s.id
        WHERE f.id = $1
      `, [req.params.id]);
      if (!fulfillment) return res.status(404).json({ message: "Fulfillment not found" });
      const { rows: items } = await pool.query(`SELECT fi.*, p.stock, p.image_url FROM fulfillment_items fi LEFT JOIN products p ON fi.product_id = p.id WHERE fi.fulfillment_id = $1`, [req.params.id]);
      res.json({ ...fulfillment, items });
    } catch (e) { next(e); }
  });

  // POST /api/fulfillments — create fulfillment from sale or quotation
  app.post("/api/fulfillments", auth, async (req, res, next) => {
    try {
      const { saleId, quotationId, customerId, shippingMethod, shippingAddress, shippingNotes, priority, estimatedDelivery, items } = req.body;
      if (!items?.length) return res.status(400).json({ message: "At least one item required" });
      const seq = (await pool.query(`SELECT COALESCE(MAX(id),0)+1 AS n FROM fulfillments`)).rows[0].n;
      const fulfillmentNumber = `FUL-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(seq).padStart(5,"0")}`;
      const totalItems = items.reduce((s, i) => s + (i.quantity || 1), 0);
      const { rows: [fulfillment] } = await pool.query(`INSERT INTO fulfillments (fulfillment_number, sale_id, quotation_id, customer_id, shipping_method, shipping_address, shipping_notes, priority, estimated_delivery, total_items, branch_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [fulfillmentNumber, saleId || null, quotationId || null, customerId || null, shippingMethod || 'pickup', shippingAddress || null, shippingNotes || null, priority || 'normal', estimatedDelivery || null, totalItems, req.user.branchId || null]);
      for (const item of items) {
        const prod = (await pool.query(`SELECT name FROM products WHERE id = $1`, [item.productId])).rows[0];
        await pool.query(`INSERT INTO fulfillment_items (fulfillment_id, product_id, product_name, quantity_needed, location, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
          [fulfillment.id, item.productId, prod?.name || 'Unknown', item.quantity || 1, item.location || null, item.notes || null]);
      }
      // Update sale if linked
      if (saleId) {
        await pool.query(`UPDATE sales SET needs_fulfillment = true, fulfillment_status = 'pending' WHERE id = $1`, [saleId]);
      }
      res.status(201).json(fulfillment);
    } catch (e) { next(e); }
  });

  // PATCH /api/fulfillments/:id/status — update fulfillment status
  app.patch("/api/fulfillments/:id/status", auth, async (req, res, next) => {
    try {
      const { status, trackingNumber, carrierName } = req.body;
      const statusFields = { picking: 'picked_by,picked_at', packed: 'packed_by,packed_at', shipped: 'shipped_by,shipped_at', delivered: 'delivered_at' };
      const updates = [`status = $1`, `updated_at = NOW()`];
      const params = [status]; let idx = 2;
      if (statusFields[status]) {
        const fields = statusFields[status].split(',');
        for (const f of fields) {
          if (f.endsWith('_at')) { updates.push(`${f} = NOW()`); }
          else { updates.push(`${f} = $${idx++}`); params.push(req.user.id); }
        }
      }
      if (trackingNumber) { updates.push(`tracking_number = $${idx++}`); params.push(trackingNumber); }
      if (carrierName) { updates.push(`carrier_name = $${idx++}`); params.push(carrierName); }
      params.push(req.params.id);
      const { rows } = await pool.query(`UPDATE fulfillments SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`, params);
      res.json(rows[0] || {});
    } catch (e) { next(e); }
  });

  // PATCH /api/fulfillments/:id/items/:itemId — update item pick/pack status
  app.patch("/api/fulfillments/:id/items/:itemId", auth, async (req, res, next) => {
    try {
      const { quantityPicked, quantityPacked, status, notes } = req.body;
      const sets = []; const params = []; let idx = 1;
      if (quantityPicked !== undefined) { sets.push(`quantity_picked = $${idx++}`); params.push(quantityPicked); }
      if (quantityPacked !== undefined) { sets.push(`quantity_packed = $${idx++}`); params.push(quantityPacked); }
      if (status) { sets.push(`status = $${idx++}`); params.push(status); }
      if (notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(notes); }
      if (!sets.length) return res.status(400).json({ message: "Nothing to update" });
      params.push(req.params.itemId);
      const { rows } = await pool.query(`UPDATE fulfillment_items SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params);
      // Update totals on parent fulfillment
      if (rows.length) {
        const fId = req.params.id;
        await pool.query(`UPDATE fulfillments SET total_picked = (SELECT COALESCE(SUM(quantity_picked),0) FROM fulfillment_items WHERE fulfillment_id = $1), total_packed = (SELECT COALESCE(SUM(quantity_packed),0) FROM fulfillment_items WHERE fulfillment_id = $1), updated_at = NOW() WHERE id = $1`, [fId]);
      }
      res.json(rows[0] || {});
    } catch (e) { next(e); }
  });

  // DELETE /api/fulfillments/:id
  app.delete("/api/fulfillments/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM fulfillments WHERE id = $1 AND status = 'pending'`, [req.params.id]);
      res.json({ success: true });
    } catch (e) { next(e); }
  });

};
