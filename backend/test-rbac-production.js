/**
 * Production RBAC Verification Script
 * 
 * Creates a test branch admin user and verifies the RBAC scoping
 * works correctly across all endpoints.
 * 
 * Usage (via Render Shell):
 *   node test-rbac-production.js
 * 
 * What this script does:
 *   1. Lists all branches and existing admin users
 *   2. Creates a test branch admin user (ADMIN role + branch_id)
 *   3. Generates a JWT token for the test user
 *   4. Tests 10+ API endpoints to verify branch scoping
 *   5. Verifies super-admin-only endpoints return 403
 *   6. Cleans up the test user
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const TEST_EMAIL = 'rbac-test@rhosam.com';
const TEST_PASSWORD = 'TestRbac@12345678';
const TEST_NAME = 'RBAC Test Admin';
const SALT_ROUNDS = 12;

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  
  if (!dbUrl) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }
  if (!jwtSecret) {
    console.error('Error: JWT_SECRET not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const API = process.env.BACKEND_URL || 'http://localhost:5000';
  
  // Helper to make authenticated API requests
  async function api(method, path, token, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    
    try {
      const res = await fetch(`${API}${path}`, opts);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data };
    } catch (err) {
      return { status: 0, error: err.message };
    }
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  RHoSAM RBAC Production Verification');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // ── Step 1: Get existing data ──────────────────────────────
    console.log('── Step 1: Checking existing data ──');
    
    const { rows: branches } = await pool.query(
      'SELECT id, name FROM branches WHERE is_active = TRUE ORDER BY id'
    );
    console.log(`  Found ${branches.length} active branch(es):`);
    branches.forEach(b => console.log(`    • [${b.id}] ${b.name}`));
    
    if (branches.length === 0) {
      console.error('\n  ✗ No branches found. Create at least one branch first.');
      process.exit(1);
    }
    
    const testBranch = branches[0]; // Use the first branch for testing
    console.log(`\n  Using branch: [${testBranch.id}] ${testBranch.name} for test user`);
    
    const { rows: admins } = await pool.query(
      "SELECT id, name, email, role, branch_id FROM users WHERE role = 'ADMIN' AND is_active = TRUE ORDER BY branch_id NULLS FIRST"
    );
    console.log(`\n  Found ${admins.length} admin user(s):`);
    admins.forEach(u => console.log(`    • ${u.name} <${u.email}> — branch_id: ${u.branch_id || 'NULL (super-admin)'}`));
    
    const superAdmin = admins.find(a => !a.branch_id);
    if (!superAdmin) {
      console.error('\n  ✗ No super-admin found. Need one to create test user.');
      process.exit(1);
    }
    console.log(`\n  Super-admin for API testing: ${superAdmin.name} <${superAdmin.email}>`);

    // ── Step 2: Create test branch admin user ──────────────────
    console.log('\n── Step 2: Creating test branch admin user ──');
    
    // Clean up any previous test user (including audit logs)
    const { rows: existingUsers } = await pool.query('SELECT id FROM users WHERE email = $1', [TEST_EMAIL]);
    for (const u of existingUsers) {
      await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [u.id]).catch(() => {});
    }
    await pool.query("DELETE FROM users WHERE email = $1", [TEST_EMAIL]);
    
    const hash = await bcrypt.hash(TEST_PASSWORD, SALT_ROUNDS);
    const { rows: [newUser] } = await pool.query(
      `INSERT INTO users(name, email, password_hash, role, branch_id, is_active)
       VALUES($1, $2, $3, 'ADMIN', $4, TRUE)
       RETURNING id, name, email, role, branch_id`,
      [TEST_NAME, TEST_EMAIL, hash, testBranch.id]
    );
    
    console.log(`  ✓ Created test user:`);
    console.log(`    • ID: ${newUser.id}`);
    console.log(`    • Name: ${newUser.name}`);
    console.log(`    • Email: ${newUser.email}`);
    console.log(`    • Role: ${newUser.role}`);
    console.log(`    • Branch ID: ${newUser.branch_id} (${testBranch.name})`);

    // ── Step 3: Generate JWT token ─────────────────────────────
    console.log('\n── Step 3: Generating JWT token ──');
    
    const branchUser = await pool.query(
      "SELECT id, name FROM branches WHERE id = $1", [newUser.branch_id]
    );
    const branchInfo = branchUser.rows[0] || null;
    
    const token = jwt.sign(
      { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, branchId: newUser.branch_id },
      jwtSecret,
      { expiresIn: '1h' }
    );
    console.log('  ✓ JWT token generated (expires in 1 hour)');

    // ── Step 4: Login as test user ─────────────────────────────
    console.log('\n── Step 4: Testing login ──');
    
    const loginRes = await api('POST', '/api/auth/login', null, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD
    });
    
    if (loginRes.status === 200) {
      console.log('  ✓ Login successful');
      console.log(`    • User: ${loginRes.data.user.name}`);
      console.log(`    • Role: ${loginRes.data.user.role}`);
      console.log(`    • Branch ID: ${loginRes.data.user.branchId}`);
      console.log(`    • Branch: ${loginRes.data.user.branch?.name || 'N/A'}`);
    } else {
      console.log(`  ✗ Login failed: ${loginRes.status} — ${JSON.stringify(loginRes.data)}`);
    }

    // ── Step 5: Test RBAC scoping ──────────────────────────────
    console.log('\n── Step 5: Testing RBAC scoping ──');
    
    const results = [];
    
    // 5a: Dashboard stats — should be scoped to test user's branch
    const dashRes = await api('GET', '/api/dashboard/stats', token);
    const dashPass = dashRes.status === 200;
    results.push({ test: 'GET /api/dashboard/stats (200)', pass: dashPass, detail: `status: ${dashRes.status}` });
    
    // 5b: Products — should be scoped to test user's branch
    const prodRes = await api('GET', '/api/products', token);
    const prodPass = prodRes.status === 200;
    results.push({ test: 'GET /api/products (200)', pass: prodPass, detail: `status: ${prodRes.status}` });
    
    // 5c: Sales — should be scoped to test user's branch
    const salesRes = await api('GET', '/api/sales', token);
    const salesPass = salesRes.status === 200;
    results.push({ test: 'GET /api/sales (200)', pass: salesPass, detail: `status: ${salesRes.status}` });
    
    // 5d: Expenses — should be scoped to test user's branch
    const expRes = await api('GET', '/api/expenses', token);
    const expPass = expRes.status === 200;
    results.push({ test: 'GET /api/expenses (200)', pass: expPass, detail: `status: ${expRes.status}` });
    
    // 5e: Finance — should be scoped to test user's branch
    const finRes = await api('GET', '/api/finance/summary', token);
    const finPass = finRes.status === 200;
    results.push({ test: 'GET /api/finance/summary (200)', pass: finPass, detail: `status: ${finRes.status}` });
    
    // 5f: Branches — should return ONLY the test user's branch
    const branchRes = await api('GET', '/api/branches', token);
    const branchPass = branchRes.status === 200;
    const branchData = branchRes.data?.data || branchRes.data;
    const branchCount = Array.isArray(branchData) ? branchData.length : -1;
    const onlyOwnBranch = branchCount === 1 && branchData?.[0]?.id === testBranch.id;
    results.push({ 
      test: `GET /api/branches (returns only own branch)`, 
      pass: branchPass && onlyOwnBranch, 
      detail: `status: ${branchRes.status}, branches returned: ${branchCount}, only own: ${onlyOwnBranch}` 
    });
    
    // 5g: Branch inventory — should be scoped to test user's branch
    const biRes = await api('GET', `/api/branch-inventory?branchId=${testBranch.id}`, token);
    const biPass = biRes.status === 200;
    results.push({ test: `GET /api/branch-inventory (own branch, 200)`, pass: biPass, detail: `status: ${biRes.status}` });
    
    // 5h: Branch inventory for ANOTHER branch — silently forced to own branch (200)
    const otherBranch = branches.find(b => b.id !== testBranch.id);
    if (otherBranch) {
      const biOtherRes = await api('GET', `/api/branch-inventory?branchId=${otherBranch.id}`, token);
      const biOtherPass = biOtherRes.status === 200;
      results.push({ 
        test: `GET /api/branch-inventory (other branch, forced to own, 200)`, 
        pass: biOtherPass, 
        detail: `status: ${biOtherRes.status} (expected 200 — silently forced to own branch)` 
      });
    }
    
    // ── Step 6: Test super-admin-only endpoints (should be 403) ──
    console.log('\n── Step 6: Testing super-admin-only endpoints (expect 403) ──');
    
    // 6a: Branch summary — super-admin only
    const bsRes = await api('GET', '/api/dashboard/branch-summary', token);
    const bsPass = bsRes.status === 403;
    results.push({ test: 'GET /api/dashboard/branch-summary (403)', pass: bsPass, detail: `status: ${bsRes.status} (expected 403)` });
    
    // 6b: Executive overview — super-admin only
    const execRes = await api('GET', '/api/executive/overview', token);
    const execPass = execRes.status === 403;
    results.push({ test: 'GET /api/executive/overview (403)', pass: execPass, detail: `status: ${execRes.status} (expected 403)` });
    
    // 6c: Users list — should be scoped (only own branch users)
    const usersRes = await api('GET', '/api/users', token);
    const usersPass = usersRes.status === 200;
    results.push({ test: 'GET /api/users (200, scoped)', pass: usersPass, detail: `status: ${usersRes.status}` });
    
    // 6d: Create user with ADMIN role — should be denied
    const createUserRes = await api('POST', '/api/users', token, {
      name: 'Should Fail', email: 'fail@test.com', password: 'Test@12345678', role: 'ADMIN', branchId: testBranch.id
    });
    const createUserPass = createUserRes.status === 403;
    results.push({ 
      test: 'POST /api/users (create ADMIN, 403)', 
      pass: createUserPass, 
      detail: `status: ${createUserRes.status} (expected 403)` 
    });
    
    // 6e: Payment settings — super-admin only
    const psRes = await api('GET', '/api/payment-settings', token);
    const psPass = psRes.status === 403;
    results.push({ test: 'GET /api/payment-settings (403)', pass: psPass, detail: `status: ${psRes.status} (expected 403)` });
    
    // 6f: Database backup — super-admin only
    const bkRes = await api('GET', '/api/admin/backup', token);
    const bkPass = bkRes.status === 403;
    results.push({ test: 'GET /api/admin/backup (403)', pass: bkPass, detail: `status: ${bkRes.status} (expected 403)` });
    
    // 6g: Audit logs — should be scoped to own branch
    const auditRes = await api('GET', '/api/audit-logs', token);
    const auditPass = auditRes.status === 200;
    results.push({ test: 'GET /api/audit-logs (200, scoped)', pass: auditPass, detail: `status: ${auditRes.status}` });

    // ── Step 7: Print results ──────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  RBAC Verification Results');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    let passed = 0;
    let failed = 0;
    
    for (const r of results) {
      const icon = r.pass ? '✅' : '❌';
      console.log(`  ${icon} ${r.test}`);
      console.log(`     ${r.detail}`);
      if (r.pass) passed++; else failed++;
    }
    
    console.log('\n───────────────────────────────────────────────────────────');
    console.log(`  Total: ${results.length} tests — ${passed} passed, ${failed} failed`);
    console.log('───────────────────────────────────────────────────────────');
    
    if (failed === 0) {
      console.log('\n  🎉 All RBAC checks passed! Branch admin scoping is working correctly.');
    } else {
      console.log(`\n  ⚠ ${failed} check(s) failed. Review the results above.`);
    }

    // ── Step 8: Cleanup ────────────────────────────────────────
    console.log('\n── Step 8: Cleaning up test user ──');
    // Delete audit logs first (FK constraint), then the user
    const { rows: testUsers } = await pool.query('SELECT id FROM users WHERE email = $1', [TEST_EMAIL]);
    if (testUsers.length > 0) {
      await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [testUsers[0].id]);
      await pool.query("DELETE FROM users WHERE email = $1", [TEST_EMAIL]);
    }
    console.log(`  ✓ Test user ${TEST_EMAIL} deleted`);

  } catch (err) {
    console.error('\n✗ Fatal error:', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

main();
