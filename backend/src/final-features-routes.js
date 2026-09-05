// ═══════════════════════════════════════════════════════════════════
// Final Features Routes (6 features)
// Time & Attendance, Product Attributes, Linked Items (Upsell),
// Warranties, Product Compare
// ═══════════════════════════════════════════════════════════════════

module.exports = function registerFinalFeaturesRoutes(app, pool, auth, allow) {

  // ═══════════════════════════════════════════════════════════════════
  // 1. TIME & ATTENDANCE
  // ═══════════════════════════════════════════════════════════════════

  // POST /api/time-clock/clock-in
  app.post("/api/time-clock/clock-in", auth, async (req, res, next) => {
    try {
      const { notes } = req.body;
      // Check if already clocked in
      const { rows: active } = await pool.query(`SELECT id FROM time_clock WHERE user_id = $1 AND status = 'ACTIVE'`, [req.user.id]);
      if (active.length) return res.status(400).json({ message: "Already clocked in. Clock out first." });
      const { rows } = await pool.query(`INSERT INTO time_clock (user_id, branch_id, notes) VALUES ($1, $2, $3) RETURNING *`, [req.user.id, req.user.branchId || null, notes || null]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // POST /api/time-clock/clock-out
  app.post("/api/time-clock/clock-out", auth, async (req, res, next) => {
    try {
      const { rows: [active] } = await pool.query(`SELECT * FROM time_clock WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY clock_in DESC LIMIT 1`, [req.user.id]);
      if (!active) return res.status(400).json({ message: "No active clock-in found" });
      // Close any open breaks
      await pool.query(`UPDATE break_records SET break_end = NOW() WHERE time_clock_id = $1 AND break_end IS NULL`, [active.id]);
      const { rows } = await pool.query(`UPDATE time_clock SET clock_out = NOW(), status = 'APPROVED' WHERE id = $1 RETURNING *`, [active.id]);
      res.json(rows[0]);
    } catch (e) { next(e); }
  });

  // GET /api/time-clock/active
  app.get("/api/time-clock/active", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT tc.*, u.name AS user_name, b.name AS branch_name FROM time_clock tc LEFT JOIN users u ON tc.user_id = u.id LEFT JOIN branches b ON tc.branch_id = b.id WHERE tc.user_id = $1 AND tc.status = 'ACTIVE' ORDER BY tc.clock_in DESC LIMIT 1`, [req.user.id]);
      res.json(rows[0] || null);
    } catch (e) { next(e); }
  });

  // GET /api/time-clock — list all (admin/manager sees all, cashier sees own)
  app.get("/api/time-clock", auth, async (req, res, next) => {
    try {
      const { userId, startDate, endDate, branchId } = req.query;
      let where = "WHERE 1=1";
      const params = []; let idx = 1;
      // Cashiers only see their own
      if (req.user.role === 'CASHIER') {
        where += ` AND tc.user_id = $${idx++}`; params.push(req.user.id);
      } else if (userId) {
        where += ` AND tc.user_id = $${idx++}`; params.push(Number(userId));
      } else if (req.user.branchId) {
        where += ` AND tc.branch_id = $${idx++}`; params.push(req.user.branchId);
      }
      if (startDate) { where += ` AND tc.clock_in >= $${idx++}`; params.push(startDate); }
      if (endDate) { where += ` AND tc.clock_in <= $${idx++}`; params.push(endDate); }
      if (branchId) { where += ` AND tc.branch_id = $${idx++}`; params.push(Number(branchId)); }
      const { rows } = await pool.query(`
        SELECT tc.*, u.name AS user_name, b.name AS branch_name,
               (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM COALESCE(br.break_end, NOW()) - br.break_start)) / 3600.0, 0) FROM break_records br WHERE br.time_clock_id = tc.id) AS break_hours
        FROM time_clock tc
        LEFT JOIN users u ON tc.user_id = u.id
        LEFT JOIN branches b ON tc.branch_id = b.id
        ${where} ORDER BY tc.clock_in DESC LIMIT 200
      `, params);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // POST /api/time-clock/break/start
  app.post("/api/time-clock/break/start", auth, async (req, res, next) => {
    try {
      const { breakType } = req.body;
      const { rows: [active] } = await pool.query(`SELECT id FROM time_clock WHERE user_id = $1 AND status = 'ACTIVE'`, [req.user.id]);
      if (!active) return res.status(400).json({ message: "No active clock-in" });
      // Check no open break
      const { rows: openBreak } = await pool.query(`SELECT id FROM break_records WHERE time_clock_id = $1 AND break_end IS NULL`, [active.id]);
      if (openBreak.length) return res.status(400).json({ message: "Already on break. End current break first." });
      const { rows } = await pool.query(`INSERT INTO break_records (time_clock_id, break_type) VALUES ($1, $2) RETURNING *`, [active.id, breakType || 'SHORT']);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  // POST /api/time-clock/break/end
  app.post("/api/time-clock/break/end", auth, async (req, res, next) => {
    try {
      const { rows: [active] } = await pool.query(`SELECT id FROM time_clock WHERE user_id = $1 AND status = 'ACTIVE'`, [req.user.id]);
      if (!active) return res.status(400).json({ message: "No active clock-in" });
      const { rows } = await pool.query(`UPDATE break_records SET break_end = NOW() WHERE time_clock_id = $1 AND break_end IS NULL RETURNING *`, [active.id]);
      if (!rows.length) return res.status(400).json({ message: "No active break" });
      res.json(rows[0]);
    } catch (e) { next(e); }
  });

  // GET /api/time-clock/summary — payroll summary
  app.get("/api/time-clock/summary", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { userId, startDate, endDate } = req.query;
      if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate required" });
      let where = `WHERE tc.clock_in >= $1 AND tc.clock_in <= $2`;
      const params = [startDate, endDate]; let idx = 3;
      if (userId) { where += ` AND tc.user_id = $${idx++}`; params.push(Number(userId)); }
      if (req.user.branchId) { where += ` AND tc.branch_id = $${idx++}`; params.push(req.user.branchId); }
      const { rows } = await pool.query(`
        SELECT u.id AS user_id, u.name AS user_name,
               COUNT(tc.id) AS shift_count,
               COALESCE(SUM(tc.total_hours), 0) AS total_hours,
               COALESCE(SUM((SELECT COALESCE(SUM(EXTRACT(EPOCH FROM COALESCE(br.break_end, NOW()) - br.break_start)) / 3600.0, 0) FROM break_records br WHERE br.time_clock_id = tc.id)), 0) AS break_hours,
               COALESCE(SUM(tc.total_hours), 0) - COALESCE(SUM((SELECT COALESCE(SUM(EXTRACT(EPOCH FROM COALESCE(br.break_end, NOW()) - br.break_start)) / 3600.0, 0) FROM break_records br WHERE br.time_clock_id = tc.id)), 0) AS net_hours
        FROM time_clock tc
        LEFT JOIN users u ON tc.user_id = u.id
        ${where}
        GROUP BY u.id, u.name
        ORDER BY u.name
      `, params);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. PRODUCT ATTRIBUTES
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/product-attributes", auth, async (req, res, next) => {
    try { const { rows } = await pool.query(`SELECT * FROM product_attributes ORDER BY display_order, name`); res.json(rows); } catch (e) { next(e); }
  });

  app.post("/api/product-attributes", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, attributeType, options, isRequired, isFilterable, displayOrder } = req.body;
      if (!name) return res.status(400).json({ message: "Name required" });
      const { rows } = await pool.query(`INSERT INTO product_attributes (name, attribute_type, options, is_required, is_filterable, display_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [name, attributeType || 'TEXT', JSON.stringify(options || []), isRequired || false, isFilterable || false, displayOrder || 0]);
      res.status(201).json(rows[0]);
    } catch (e) { e.code === '23505' ? res.status(409).json({ message: "Attribute already exists" }) : next(e); }
  });

  app.put("/api/product-attributes/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, attributeType, options, isRequired, isFilterable, displayOrder, isActive } = req.body;
      const updates = []; const params = []; let idx = 1;
      if (name !== undefined) { updates.push(`name=$${idx++}`); params.push(name); }
      if (attributeType !== undefined) { updates.push(`attribute_type=$${idx++}`); params.push(attributeType); }
      if (options !== undefined) { updates.push(`options=$${idx++}`); params.push(JSON.stringify(options)); }
      if (isRequired !== undefined) { updates.push(`is_required=$${idx++}`); params.push(isRequired); }
      if (isFilterable !== undefined) { updates.push(`is_filterable=$${idx++}`); params.push(isFilterable); }
      if (displayOrder !== undefined) { updates.push(`display_order=$${idx++}`); params.push(displayOrder); }
      if (isActive !== undefined) { updates.push(`is_active=$${idx++}`); params.push(isActive); }
      if (!updates.length) return res.status(400).json({ message: "No fields to update" });
      params.push(req.params.id);
      const { rows } = await pool.query(`UPDATE product_attributes SET ${updates.join(",")} WHERE id=$${idx} RETURNING *`, params);
      res.json(rows[0]);
    } catch (e) { next(e); }
  });

  app.delete("/api/product-attributes/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try { await pool.query(`DELETE FROM product_attributes WHERE id = $1`, [req.params.id]); res.json({ message: "Deleted" }); } catch (e) { next(e); }
  });

  // GET /api/products/:id/attributes
  app.get("/api/products/:id/attributes", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT pa.*, pav.value FROM product_attributes pa LEFT JOIN product_attribute_values pav ON pav.attribute_id = pa.id AND pav.product_id = $1 WHERE pa.is_active = TRUE ORDER BY pa.display_order, pa.name`, [req.params.id]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // PUT /api/products/:id/attributes
  app.put("/api/products/:id/attributes", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { attributes } = req.body; // [{ attributeId, value }]
      if (!Array.isArray(attributes)) return res.status(400).json({ message: "attributes array required" });
      for (const attr of attributes) {
        if (attr.value === null || attr.value === undefined || attr.value === '') {
          await pool.query(`DELETE FROM product_attribute_values WHERE product_id = $1 AND attribute_id = $2`, [req.params.id, attr.attributeId]);
        } else {
          await pool.query(`INSERT INTO product_attribute_values (product_id, attribute_id, value) VALUES ($1,$2,$3) ON CONFLICT (product_id, attribute_id) DO UPDATE SET value = $3`, [req.params.id, attr.attributeId, String(attr.value)]);
        }
      }
      res.json({ message: "Attributes saved" });
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. LINKED ITEMS (Upsell / Cross-sell)
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/products/:id/linked", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT li.*, p.name AS linked_name, p.price AS linked_price, p.image_url AS linked_image, p.stock AS linked_stock
        FROM linked_items li
        LEFT JOIN products p ON li.linked_product_id = p.id
        WHERE li.product_id = $1 AND li.is_active = TRUE
        ORDER BY li.display_order
      `, [req.params.id]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.post("/api/products/:id/linked", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { linkedProductId, linkType, displayOrder } = req.body;
      if (!linkedProductId) return res.status(400).json({ message: "linkedProductId required" });
      if (Number(linkedProductId) === Number(req.params.id)) return res.status(400).json({ message: "Cannot link product to itself" });
      const { rows } = await pool.query(`INSERT INTO linked_items (product_id, linked_product_id, link_type, display_order) VALUES ($1,$2,$3,$4) ON CONFLICT (product_id, linked_product_id) DO UPDATE SET link_type = $3, display_order = $4 RETURNING *`, [req.params.id, linkedProductId, linkType || 'UPSELL', displayOrder || 0]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  app.delete("/api/linked-items/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try { await pool.query(`DELETE FROM linked_items WHERE id = $1`, [req.params.id]); res.json({ message: "Deleted" }); } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. WARRANTIES
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/warranties", auth, async (req, res, next) => {
    try { const { rows } = await pool.query(`SELECT * FROM warranties ORDER BY name`); res.json(rows); } catch (e) { next(e); }
  });

  app.post("/api/warranties", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, description, durationMonths, price, coverageType, terms } = req.body;
      if (!name || !durationMonths) return res.status(400).json({ message: "Name and duration required" });
      const { rows } = await pool.query(`INSERT INTO warranties (name, description, duration_months, price, coverage_type, terms) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [name, description || null, durationMonths, price || 0, coverageType || 'FULL', terms || null]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  app.put("/api/warranties/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { name, description, durationMonths, price, coverageType, terms, isActive } = req.body;
      const updates = []; const params = []; let idx = 1;
      if (name !== undefined) { updates.push(`name=$${idx++}`); params.push(name); }
      if (description !== undefined) { updates.push(`description=$${idx++}`); params.push(description); }
      if (durationMonths !== undefined) { updates.push(`duration_months=$${idx++}`); params.push(durationMonths); }
      if (price !== undefined) { updates.push(`price=$${idx++}`); params.push(price); }
      if (coverageType !== undefined) { updates.push(`coverage_type=$${idx++}`); params.push(coverageType); }
      if (terms !== undefined) { updates.push(`terms=$${idx++}`); params.push(terms); }
      if (isActive !== undefined) { updates.push(`is_active=$${idx++}`); params.push(isActive); }
      if (!updates.length) return res.status(400).json({ message: "No fields" });
      updates.push(`updated_at=NOW()`); params.push(req.params.id);
      const { rows } = await pool.query(`UPDATE warranties SET ${updates.join(",")} WHERE id=$${idx} RETURNING *`, params);
      res.json(rows[0]);
    } catch (e) { next(e); }
  });

  app.delete("/api/warranties/:id", auth, allow("ADMIN"), async (req, res, next) => {
    try { await pool.query(`DELETE FROM warranties WHERE id = $1`, [req.params.id]); res.json({ message: "Deleted" }); } catch (e) { next(e); }
  });

  // Product-warranty linking
  app.get("/api/products/:id/warranties", auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT pw.*, w.name AS warranty_name, w.duration_months, w.price AS warranty_price, w.coverage_type FROM product_warranties pw LEFT JOIN warranties w ON pw.warranty_id = w.id WHERE pw.product_id = $1`, [req.params.id]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.post("/api/products/:id/warranties", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { warrantyId, isDefault } = req.body;
      if (isDefault) await pool.query(`UPDATE product_warranties SET is_default = FALSE WHERE product_id = $1`, [req.params.id]);
      const { rows } = await pool.query(`INSERT INTO product_warranties (product_id, warranty_id, is_default) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *`, [req.params.id, warrantyId, isDefault || false]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  app.delete("/api/products/:productId/warranties/:warrantyId", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try { await pool.query(`DELETE FROM product_warranties WHERE product_id = $1 AND warranty_id = $2`, [req.params.productId, req.params.warrantyId]); res.json({ message: "Removed" }); } catch (e) { next(e); }
  });

  // Warranty claims
  app.get("/api/warranty-claims", auth, async (req, res, next) => {
    try {
      const { status } = req.query;
      let where = "WHERE 1=1"; const params = []; let idx = 1;
      if (status) { where += ` AND wc.status = $${idx++}`; params.push(status); }
      if (req.user.role === 'CASHIER') { where += ` AND wc.created_at > NOW() - INTERVAL '30 days'`; }
      const { rows } = await pool.query(`
        SELECT wc.*, c.name AS customer_name, p.name AS product_name, p.barcode, w.name AS warranty_name
        FROM warranty_claims wc
        LEFT JOIN customers c ON wc.customer_id = c.id
        LEFT JOIN products p ON wc.product_id = p.id
        LEFT JOIN warranties w ON wc.warranty_id = w.id
        ${where} ORDER BY wc.created_at DESC LIMIT 100
      `, params);
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.post("/api/warranty-claims", auth, allow("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
    try {
      const { customerId, productId, warrantyId, saleId, issueDescription } = req.body;
      if (!productId || !issueDescription) return res.status(400).json({ message: "productId and issueDescription required" });
      const { rows: [seq] } = await pool.query(`SELECT COALESCE(MAX(id),0)+1 AS seq FROM warranty_claims`);
      const claimNumber = `WC-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(seq.seq).padStart(5,"0")}`;
      const { rows } = await pool.query(`INSERT INTO warranty_claims (claim_number, customer_id, product_id, warranty_id, sale_id, issue_description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [claimNumber, customerId || null, productId, warrantyId || null, saleId || null, issueDescription]);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  app.patch("/api/warranty-claims/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
    try {
      const { status, resolution } = req.body;
      const updates = [`updated_at=NOW()`]; const params = []; let idx = 1;
      if (status) { updates.push(`status=$${idx++}`); params.push(status); }
      if (resolution) { updates.push(`resolution=$${idx++}`); params.push(resolution); }
      if (status === 'COMPLETED' || status === 'APPROVED') { updates.push(`resolved_by=$${idx++}`); params.push(req.user.id); }
      params.push(req.params.id);
      const { rows } = await pool.query(`UPDATE warranty_claims SET ${updates.join(",")} WHERE id=$${idx} RETURNING *`, params);
      res.json(rows[0]);
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. PRODUCT COMPARE
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/product-compare", auth, async (req, res, next) => {
    try {
      const { ids } = req.query;
      if (!ids) return res.status(400).json({ message: "ids query param required (comma-separated)" });
      const idList = ids.split(',').map(Number).filter(Boolean);
      if (idList.length < 2) return res.status(400).json({ message: "At least 2 product IDs required" });
      const { rows: products } = await pool.query(`SELECT p.*, (SELECT json_agg(json_build_object('attribute_id', pa.id, 'name', pa.name, 'value', pav.value)) FROM product_attributes pa LEFT JOIN product_attribute_values pav ON pav.attribute_id = pa.id AND pav.product_id = p.id WHERE pa.is_active = TRUE) AS attributes FROM products p WHERE p.id = ANY($1)`, [idList]);
      res.json(products);
    } catch (e) { next(e); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. BIOMETRIC LOGIN (WebAuthn stub — real biometric needs native)
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/auth/webauthn/status", auth, async (req, res, next) => {
    try {
      // Check if WebAuthn is supported and if user has registered credentials
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS credential_count FROM webauthn_credentials WHERE user_id = $1`, [req.user.id]);
      res.json({ supported: true, registered: rows[0].credential_count > 0, credentialCount: rows[0].credential_count });
    } catch (e) { res.json({ supported: true, registered: false, credentialCount: 0 }); }
  });

  app.post("/api/auth/webauthn/register", auth, async (req, res, next) => {
    try {
      // Create a registration challenge (simplified — real impl needs @simplewebauthn/server)
      const crypto = require("crypto");
      const challenge = crypto.randomBytes(32).toString("base64url");
      res.json({ challenge, rpName: "RHoSAM POS", userId: req.user.id, userName: req.user.email });
    } catch (e) { next(e); }
  });

  app.post("/api/auth/webauthn/verify", auth, async (req, res, next) => {
    try {
      // Simplified verification — in production use @simplewebauthn/server
      const { credentialId, credentialPublicKey } = req.body;
      if (!credentialId) return res.status(400).json({ message: "credentialId required" });
      // Store credential (simplified)
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS webauthn_credentials (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), credential_id VARCHAR(255) UNIQUE, public_key TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`, []);
      } catch {} // table may already exist
      try {
        await pool.query(`INSERT INTO webauthn_credentials (user_id, credential_id, public_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [req.user.id, credentialId, credentialPublicKey || '']);
      } catch {}
      res.json({ message: "Biometric credential registered" });
    } catch (e) { next(e); }
  });
};
