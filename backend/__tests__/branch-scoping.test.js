/**
 * Tests for Branch-Scoped Access Control.
 *
 * Verifies the core requirement:
 *   1. Branch admin and branch manager should NOT be able to view other branches
 *   2. Branch admin and branch manager should ONLY update inventory/products for their branch
 *   3. Only ADMIN without branch_id (super-admin) has full access across all branches
 *
 * These tests mock the pg Pool so no real database is needed.
 */

// ── Set env vars BEFORE anything else ──
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-key-for-branch-scoping';
process.env.PORT = '0';
process.env.RESEND_API_KEY = '';
process.env.PAYSTACK_SECRET_KEY = '';
process.env.PAYSTACK_PUBLIC_KEY = '';
process.env.FLUTTERWAVE_SECRET_KEY = '';
process.env.FLUTTERWAVE_PUBLIC_KEY = '';
process.env.PAYMENT_WEBHOOK_SECRET = '';
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';
process.env.UPLOAD_DIR = './uploads';

// ── Mock pg before requiring server.js ──
const { mockPool, getQueryCalls, resetMock, mockQueryResults } = require('./helpers/mock-pool');

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('bcrypt', () => ({
  hash: jest.fn(async () => 'hashed-password'),
  compare: jest.fn(async () => true),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// ── Helper: create a signed JWT ──
function makeToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, branchId: user.branchId, name: user.name, email: user.email || `${user.name.toLowerCase().replace(/\s/g, '.')}@test.com` },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// ── Test users ──
const SUPER_ADMIN = { id: 1, role: 'ADMIN', branchId: null, name: 'Super Admin', email: 'superadmin@test.com' };
const BRANCH_ADMIN = { id: 2, role: 'ADMIN', branchId: 10, name: 'Branch Admin', email: 'branchadmin@test.com' };
const BRANCH_MANAGER = { id: 3, role: 'MANAGER', branchId: 10, name: 'Branch Manager', email: 'branchmanager@test.com' };
const OTHER_BRANCH_ADMIN = { id: 4, role: 'ADMIN', branchId: 20, name: 'Other Branch Admin', email: 'otherbranch@test.com' };
const CASHIER = { id: 5, role: 'CASHIER', branchId: 10, name: 'Branch Cashier', email: 'cashier@test.com' };

let app;

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.PORT = '0';
  const server = require('../src/server');
  app = server.app;
});

afterAll(() => {
  console.error.mockRestore();
});

beforeEach(() => {
  resetMock();
});

// ═══════════════════════════════════════════════════════════════════
// SALES: Branch-scoped access control
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/sales — Branch scoping', () => {
  const mockSale = {
    id: 1, receipt_number: 'RCP-001', customer_name: 'Walk-in', payment_method: 'Cash',
    subtotal: 1000, discount: 0, tax: 0, total: 1000, amount_paid: 1000, status: 'COMPLETED',
    created_at: '2026-08-28T10:00:00Z', branch_id: 10, branch_name: 'Main Branch',
    cashier_name: 'Cashier', item_count: 2
  };

  test('super-admin sees all branches (no branch filter)', async () => {
    mockQueryResults(
      { rows: [mockSale] },  // main query
      { rows: [{ count: 1 }] }  // count query for hasMore
    );

    const res = await request(app)
      .get('/api/sales')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(200);

    // Verify NO branch_id filter in SQL
    const calls = getQueryCalls();
    const mainQuery = calls[0];
    expect(mainQuery.sql).not.toContain('branch_id =');
  });

  test('branch admin is scoped to their branch (cannot see other branches)', async () => {
    mockQueryResults(
      { rows: [mockSale] },
      { rows: [{ count: 1 }] }
    );

    const res = await request(app)
      .get('/api/sales')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(200);

    // Verify branch filter uses the branch admin's branchId (10)
    const calls = getQueryCalls();
    const mainQuery = calls[0];
    expect(mainQuery.sql).toContain('branch_id');
    expect(mainQuery.params).toContain(10);
  });

  test('branch admin cannot see branch 20 data', async () => {
    mockQueryResults(
      { rows: [] },  // empty — no sales from other branch
      { rows: [{ count: 0 }] }
    );

    const res = await request(app)
      .get('/api/sales')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);

    // Verify filter is for branch 10, not 20
    const calls = getQueryCalls();
    expect(calls[0].params).toContain(10);
    expect(calls[0].params).not.toContain(20);
  });

  test('branch manager is scoped to their branch', async () => {
    mockQueryResults(
      { rows: [mockSale] },
      { rows: [{ count: 1 }] }
    );

    const res = await request(app)
      .get('/api/sales')
      .set('Authorization', `Bearer ${makeToken(BRANCH_MANAGER)}`);

    expect(res.status).toBe(200);

    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_id');
    expect(calls[0].params).toContain(10);
  });

  test('cashier sees only their own sales', async () => {
    mockQueryResults(
      { rows: [{ ...mockSale, cashier_id: 5 }] },
      { rows: [{ count: 1 }] }
    );

    const res = await request(app)
      .get('/api/sales')
      .set('Authorization', `Bearer ${makeToken(CASHIER)}`);

    expect(res.status).toBe(200);

    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('cashier_id');
    expect(calls[0].params).toContain(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BRANCHES: Super-admin only
// ═══════════════════════════════════════════════════════════════════

describe('Branch Management — Super-admin only', () => {
  test('super-admin can create branches', async () => {
    mockQueryResults(
      { rows: [{ id: 30, name: 'New Branch', address: null, phone: null, manager_id: null, is_active: true, created_at: '2026-08-28T00:00:00Z' }] },
      { rows: [] }  // audit log
    );

    const res = await request(app)
      .post('/api/branches')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`)
      .send({ name: 'New Branch' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New Branch');
  });

  test('branch admin CANNOT create branches (403)', async () => {
    const res = await request(app)
      .post('/api/branches')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`)
      .send({ name: 'Unauthorized Branch' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/super-admin/i);
  });

  test('branch manager CANNOT create branches (403)', async () => {
    const res = await request(app)
      .post('/api/branches')
      .set('Authorization', `Bearer ${makeToken(BRANCH_MANAGER)}`)
      .send({ name: 'Unauthorized Branch' });

    expect(res.status).toBe(403);
  });

  test('super-admin can update branches', async () => {
    mockQueryResults(
      { rows: [{ id: 10, name: 'Updated Branch' }] }
    );

    const res = await request(app)
      .put('/api/branches/10')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`)
      .send({ name: 'Updated Branch' });

    expect(res.status).toBe(200);
  });

  test('branch admin CANNOT update branches (403)', async () => {
    const res = await request(app)
      .put('/api/branches/10')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`)
      .send({ name: 'Hacked Branch' });

    expect(res.status).toBe(403);
  });

  test('super-admin can delete branches', async () => {
    mockQueryResults(
      { rowCount: 1 }  // delete result
    );

    const res = await request(app)
      .delete('/api/branches/30')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(200);
  });

  test('branch admin CANNOT delete branches (403)', async () => {
    const res = await request(app)
      .delete('/api/branches/30')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// USERS: Branch-scoped access control
// ═══════════════════════════════════════════════════════════════════

describe('User Management — Branch scoping', () => {
  test('super-admin can see all users', async () => {
    mockQueryResults(
      { rows: [
        { id: 1, name: 'Super Admin', role: 'ADMIN', branch_id: null },
        { id: 2, name: 'Branch Admin', role: 'ADMIN', branch_id: 10 },
        { id: 3, name: 'Other Admin', role: 'ADMIN', branch_id: 20 },
      ] }
    );

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
  });

  test('branch admin can only see users in their branch', async () => {
    mockQueryResults(
      { rows: [
        { id: 2, name: 'Branch Admin', role: 'ADMIN', branch_id: 10 },
        { id: 5, name: 'Branch Cashier', role: 'CASHIER', branch_id: 10 },
      ] }
    );

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);

    // Verify SQL filters by the branch admin's branchId
    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_id');
    expect(calls[0].params).toContain(10);
  });

  test('branch admin cannot create users in another branch', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`)
      .send({
        name: 'Other Branch User',
        email: 'other@test.com',
        password: 'password123',
        role: 'CASHIER',
        branchId: 20  // Different branch!
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/own branch/i);
  });

  test('branch admin cannot create other ADMIN users', async () => {
    mockQueryResults(
      { rows: [{ id: 10, branch_id: 10 }] }  // target user lookup
    );

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`)
      .send({
        name: 'New Admin',
        email: 'newadmin@test.com',
        password: 'password123',
        role: 'ADMIN',
        branchId: 10
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/admin/i);
  });

  test('branch admin cannot update users in another branch', async () => {
    mockQueryResults(
      { rows: [{ branch_id: 20, role: 'CASHIER' }] }  // target user is in branch 20
    );

    const res = await request(app)
      .patch('/api/users/99')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`)
      .send({ name: 'Hacked Name' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/own branch/i);
  });

  test('branch admin cannot delete users in another branch', async () => {
    mockQueryResults(
      { rows: [{ branch_id: 20 }] }  // target user is in branch 20
    );

    const res = await request(app)
      .delete('/api/users/99')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/own branch/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BRANCH INVENTORY: Branch-scoped access control
// ═══════════════════════════════════════════════════════════════════

describe('Branch Inventory — Branch scoping', () => {
  test('branch admin can view their own branch inventory', async () => {
    mockQueryResults(
      { rows: [{ id: 1, name: 'Rice', quantity: 50 }] }
    );

    const res = await request(app)
      .get('/api/branch-inventory?branchId=10')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(200);
  });

  test('branch admin is forced to their own branch (ignores query param)', async () => {
    mockQueryResults(
      { rows: [{ id: 1, name: 'Rice', quantity: 50 }] }
    );

    const res = await request(app)
      .get('/api/branch-inventory?branchId=20')  // Trying to access branch 20!
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(200);

    // The query should use the branch admin's own branch (10), not 20
    const calls = getQueryCalls();
    expect(calls[0].params).toContain(10);
    expect(calls[0].params).not.toContain(20);
  });

  test('branch admin cannot update inventory for another branch', async () => {
    const res = await request(app)
      .put('/api/branch-inventory/20/1')  // Trying to update branch 20!
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`)
      .send({ quantity: 100 });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/own branch/i);
  });

  test('branch admin can update their own branch inventory', async () => {
    mockQueryResults(
      { rows: [{ id: 1, name: 'Rice', quantity: 100 }] }  // updated row
    );

    const res = await request(app)
      .put('/api/branch-inventory/10/1')  // Their own branch!
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`)
      .send({ quantity: 100 });

    expect(res.status).toBe(200);
  });

  test('super-admin can update any branch inventory', async () => {
    mockQueryResults(
      { rows: [{ id: 1, name: 'Rice', quantity: 100 }] }
    );

    const res = await request(app)
      .put('/api/branch-inventory/20/1')  // Any branch!
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`)
      .send({ quantity: 100 });

    expect(res.status).toBe(200);
  });

  test('branch admin cannot bulk-update another branch', async () => {
    const res = await request(app)
      .post('/api/branch-inventory/20/bulk')  // Another branch!
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`)
      .send({ items: [{ productId: 1, quantity: 50 }] });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/own branch/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD: Super-admin only features
// ═══════════════════════════════════════════════════════════════════

describe('Dashboard — Super-admin only features', () => {
  function mockAllStatsResults() {
    mockQueryResults(
      { rows: [{ count: 7 }] },
      { rows: [{ count: 42 }] },
      { rows: [{ count: 150 }] },
      { rows: [{ total: 2500000 }] },
      { rows: [{ count: 12 }] },
      { rows: [{ total: 85000 }] },
      { rows: [{ count: 8 }] },
      { rows: [{ day: '2026-08-28', count: 5, revenue: 40000 }] },
    );
  }

  test('branch admin dashboard filters to their branch', async () => {
    mockAllStatsResults();

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(200);

    // Verify branch filter is applied
    const calls = getQueryCalls();
    // totalSales query (index 2) should have branch_id filter
    expect(calls[2].sql).toContain('branch_id');
    expect(calls[2].params).toContain(10);
  });

  test('super-admin branch summary returns data', async () => {
    mockQueryResults(
      { rows: [
        { id: 10, name: 'Main Branch', total_sales: 100, total_revenue: 500000, active_cashiers: 3, active_days: 30, today_revenue: 20000, today_sales: 5, low_stock: 2 },
      ] },
      { rows: [{ total_sales: 100, total_revenue: 500000, today_revenue: 20000, active_cashiers: 3, low_stock: 2 }] }
    );

    const res = await request(app)
      .get('/api/dashboard/branch-summary')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(200);
    expect(res.body.branches).toHaveLength(1);
  });

  test('branch admin CANNOT access branch summary (403)', async () => {
    const res = await request(app)
      .get('/api/dashboard/branch-summary')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(403);
  });

  test('super-admin executive overview returns data', async () => {
    mockQueryResults(
      { rows: [{ total_revenue: 500000, total_expenses: 200000, total_orders: 500 }] },
      { rows: [{ month: 8, revenue: 50000 }] },
      { rows: [{ category: 'Groceries', revenue: 300000 }] },
      { rows: [{ name: 'Rice', qty: 100, revenue: 200000 }] },
    );

    const res = await request(app)
      .get('/api/executive/overview')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(200);
  });

  test('branch admin CANNOT access executive overview (403)', async () => {
    const res = await request(app)
      .get('/api/executive/overview')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// AUDIT LOGS: Branch-scoped access
// ═══════════════════════════════════════════════════════════════════

describe('Audit Logs — Branch scoping', () => {
  test('super-admin sees all audit logs', async () => {
    mockQueryResults(
      { rows: [
        { id: 1, user_name: 'Admin', action: 'LOGIN', entity_type: 'USER' },
        { id: 2, user_name: 'Other', action: 'LOGIN', entity_type: 'USER' },
      ] }
    );

    const res = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  test('branch admin sees only their branch audit logs', async () => {
    mockQueryResults(
      { rows: [
        { id: 1, user_name: 'Branch Admin', action: 'LOGIN', entity_type: 'USER' },
      ] }
    );

    const res = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(200);

    // Verify SQL filters by branch
    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_id');
    expect(calls[0].params).toContain(10);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EXPENSES: Branch-scoped access
// ═══════════════════════════════════════════════════════════════════

describe('Expenses — Branch scoping', () => {
  test('super-admin sees all expenses', async () => {
    mockQueryResults(
      { rows: [{ id: 1, category: 'Utilities', amount: 5000, branch_id: 10 }] }
    );

    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(200);

    // No branch filter for super-admin without query param
    const calls = getQueryCalls();
    expect(calls[0].sql).not.toContain('branch_id');
  });

  test('branch admin sees only their branch expenses', async () => {
    mockQueryResults(
      { rows: [{ id: 1, category: 'Utilities', amount: 5000, branch_id: 10 }] }
    );

    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(200);

    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_id');
    expect(calls[0].params).toContain(10);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FINANCE: Branch-scoped access
// ═══════════════════════════════════════════════════════════════════

describe('Finance Summary — Branch scoping', () => {
  test('branch admin sees only their branch finance', async () => {
    mockQueryResults(
      { rows: [{ revenue: 500000 }] },
      { rows: [{ total: 100000 }] },
      { rows: [{ revenue: 20000, cost: 12000 }] },
    );

    const res = await request(app)
      .get('/api/finance/summary')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(200);

    // Verify branch filter is applied
    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_id');
    expect(calls[0].params).toContain(10);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PAYMENT SETTINGS: Super-admin only
// ═══════════════════════════════════════════════════════════════════

describe('Payment Settings — Super-admin only', () => {
  test('super-admin can view payment settings', async () => {
    mockQueryResults(
      { rows: [{ id: 1, gateway: 'PAYSTACK', test_mode: true }] }
    );

    const res = await request(app)
      .get('/api/payment-settings')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(200);
  });

  test('branch admin CANNOT view payment settings (403)', async () => {
    const res = await request(app)
      .get('/api/payment-settings')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(403);
  });

  test('branch admin CANNOT update payment settings (403)', async () => {
    const res = await request(app)
      .put('/api/payment-settings')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`)
      .send({ gateway: 'PAYSTACK' });

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BACKUP: Super-admin only
// ═══════════════════════════════════════════════════════════════════

describe('Database Backup — Super-admin only', () => {
  test('super-admin can download backup', async () => {
    // Mock all table queries
    for (let i = 0; i < 15; i++) {
      mockQueryResults({ rows: [] });
    }
    mockQueryResults({ rows: [] });  // audit log

    const res = await request(app)
      .get('/api/admin/backup')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(200);
  });

  test('branch admin CANNOT download backup (403)', async () => {
    const res = await request(app)
      .get('/api/admin/backup')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PRODUCTS: Auto-scoped to user's branch
// ═══════════════════════════════════════════════════════════════════

describe('Products — Auto-scoped to user branch', () => {
  test('branch admin products are scoped to their branch', async () => {
    mockQueryResults(
      { rows: [
        { id: 1, barcode: 'BAR001', name: 'Rice', category: 'Grains', price: 45000, cost_price: 35000, stock: 50, reorder_level: 10, unit: 'BAG', image_url: null, description: '', is_active: true, created_at: '2026-01-01T00:00:00Z' },
      ] },
    );

    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);

    // Verify SQL uses branch_inventory join with branch 10
    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_inventory');
    expect(calls[0].sql).toContain('bi.branch_id');
    expect(calls[0].params).toContain(10);
  });

  test('branch manager products are scoped to their branch', async () => {
    mockQueryResults(
      { rows: [
        { id: 1, barcode: 'BAR001', name: 'Rice', category: 'Grains', price: 45000, cost_price: 35000, stock: 50, reorder_level: 10, unit: 'BAG', image_url: null, description: '', is_active: true, created_at: '2026-01-01T00:00:00Z' },
      ] },
    );

    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${makeToken(BRANCH_MANAGER)}`);

    expect(res.status).toBe(200);

    // Verify SQL uses branch_inventory join with branch 10
    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_inventory');
    expect(calls[0].params).toContain(10);
  });

  test('super-admin products show global stock (no branch join)', async () => {
    mockQueryResults(
      { rows: [
        { id: 1, barcode: 'BAR001', name: 'Rice', category: 'Grains', price: 45000, cost_price: 35000, stock: 100, reorder_level: 10, unit: 'BAG', image_url: null, description: '', is_active: true, created_at: '2026-01-01T00:00:00Z' },
      ] },
    );

    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(200);

    // Super-admin without branchId uses global stock (no branch_inventory join)
    const calls = getQueryCalls();
    expect(calls[0].sql).not.toContain('branch_inventory');
  });
});

// ═══════════════════════════════════════════════════════════════════
// LOW STOCK: Auto-scoped to user's branch
// ═══════════════════════════════════════════════════════════════════

describe('Low Stock — Auto-scoped to user branch', () => {
  test('branch admin low stock is scoped to their branch', async () => {
    mockQueryResults(
      { rows: [
        { id: 1, barcode: 'BAR001', name: 'Rice', category: 'Grains', stock: 2, reorder_level: 10, price: 45000 },
      ] },
    );

    const res = await request(app)
      .get('/api/products/low-stock')
      .set('Authorization', `Bearer ${makeToken(BRANCH_ADMIN)}`);

    expect(res.status).toBe(200);

    // Verify SQL uses branch_inventory with branch 10
    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_inventory');
    expect(calls[0].params).toContain(10);
  });
});
