const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const r = await pool.query("SELECT id, email FROM users WHERE email IN ('cashier2@test.com','manager2@test.com','testdebug@test.com')");
  console.log('Test users found:', r.rows.length);
  for (const u of r.rows) {
    await pool.query('UPDATE audit_logs SET user_id = NULL WHERE user_id = $1', [u.id]);
    await pool.query('UPDATE expenses SET approved_by = NULL WHERE approved_by = $1', [u.id]);
    await pool.query('UPDATE cash_drawer SET opened_by = NULL WHERE opened_by = $1', [u.id]);
    await pool.query('UPDATE cash_drawer SET closed_by = NULL WHERE closed_by = $1', [u.id]);
    await pool.query('UPDATE sales SET cashier_id = 1 WHERE cashier_id = $1', [u.id]);
    await pool.query('UPDATE purchase_orders SET created_by = 1 WHERE created_by = $1', [u.id]);
  }
  await pool.query("DELETE FROM users WHERE email IN ('cashier2@test.com','manager2@test.com','testdebug@test.com')");
  console.log('Deleted test users');
  const prods = await pool.query("SELECT id FROM products WHERE barcode LIKE 'TEST-AUDIT-%' OR barcode LIKE 'RBAC-%'");
  for (const p of prods.rows) {
    await pool.query('DELETE FROM sale_items WHERE product_id = $1', [p.id]).catch(() => {});
    await pool.query('DELETE FROM purchase_order_items WHERE product_id = $1', [p.id]).catch(() => {});
    await pool.query('DELETE FROM inventory_movements WHERE product_id = $1', [p.id]).catch(() => {});
    await pool.query('DELETE FROM returns WHERE product_id = $1', [p.id]).catch(() => {});
    await pool.query('DELETE FROM products WHERE id = $1', [p.id]);
  }
  console.log('Deleted test products:', prods.rows.length);
  await pool.query("DELETE FROM purchase_order_items WHERE po_id IN (SELECT id FROM purchase_orders WHERE po_number LIKE 'PO-%' OR po_number LIKE 'AUTO-%')").catch(() => {});
  await pool.query("DELETE FROM purchase_orders WHERE po_number LIKE 'PO-%' OR po_number LIKE 'AUTO-%'").catch(() => {});
  await pool.query("DELETE FROM suppliers WHERE name LIKE 'Test Supplier%' OR name = 'Updated Supplier'").catch(() => {});
  await pool.query("UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE email='admin@rhosam.com'");
  console.log('All cleanup done');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
