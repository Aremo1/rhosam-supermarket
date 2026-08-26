/**
 * Unit tests for Dashboard and Branch Summary endpoints.
 *
 * These tests mock the pg Pool so no real database is needed.
 * They verify:
 *   - Correct SQL parameterization for branch filtering
 *   - Role-based access control (ADMIN vs MANAGER vs CASHIER)
 *   - Branch query parameter handling
 *   - Response shape and data aggregation
 */

// ── Set env vars BEFORE anything else so server.js doesn't exit ──
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-key-for-testing';
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

// ── Mock pg before requiring server.js ──────────────────────────
const { mockPool, getQueryCalls, resetMock, mockQueryResults } = require('./helpers/mock-pool');

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

// Mock dotenv to prevent reading real .env
jest.mock('dotenv', () => ({ config: jest.fn() }));

// Mock bcrypt to avoid slow hashing
jest.mock('bcrypt', () => ({
  hash: jest.fn(async () => 'hashed-password'),
  compare: jest.fn(async () => true),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing';

// ── Helper: create a signed JWT for a test user ────────────────
function makeToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, branchId: user.branchId, name: user.name },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// ── Test users ─────────────────────────────────────────────────
const ADMIN_USER = { id: 1, role: 'ADMIN', branchId: null, name: 'Admin User' };
const ADMIN_BRANCH_USER = { id: 2, role: 'ADMIN', branchId: 10, name: 'Branch Admin' };
const MANAGER_USER = { id: 3, role: 'MANAGER', branchId: 10, name: 'Branch Manager' };
const CASHIER_USER = { id: 4, role: 'CASHIER', branchId: 10, name: 'Branch Cashier' };

let app;

beforeAll(() => {
  // Suppress console.error from server.js
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // Set JWT secret for auth middleware
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.PORT = '0'; // prevent actually listening

  // Require server to get the Express app (pool is mocked)
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
// DASHBOARD /api/dashboard/stats
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/dashboard/stats', () => {
  // Default mock results for the dashboard/stats queries in correct call order:
  // lowStockQuery is called BEFORE Promise.all, then 7 more inside Promise.all
  function mockAllStatsResults() {
    mockQueryResults(
      // lowStock (called first, before Promise.all)
      { rows: [{ count: 7 }] },
      // totalProducts
      { rows: [{ count: 42 }] },
      // totalSales
      { rows: [{ count: 150 }] },
      // totalRevenue
      { rows: [{ total: 2500000 }] },
      // todaySales
      { rows: [{ count: 12 }] },
      // todayRevenue
      { rows: [{ total: 85000 }] },
      // totalUsers
      { rows: [{ count: 8 }] },
      // recentSales (chart data)
      { rows: [
        { day: '2026-08-20', count: 5, revenue: 40000 },
        { day: '2026-08-21', count: 7, revenue: 55000 },
      ] },
    );
  }

  test('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(401);
  });

  test('admin without branchId sees all branches (no filter)', async () => {
    mockAllStatsResults();

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalProducts).toBe(42);
    expect(res.body.totalSales).toBe(150);
    expect(res.body.totalRevenue).toBe(2500000);
    expect(res.body.lowStockCount).toBe(7);
    expect(res.body.todaySales).toBe(12);
    expect(res.body.todayRevenue).toBe(85000);
    expect(res.body.totalUsers).toBe(8);
    expect(res.body.salesChart).toHaveLength(2);

    // Verify no branch filter SQL was injected in sales queries
    const calls = getQueryCalls();
    // The totalSales query (index 2) should have no branch_id filter
    expect(calls[2].sql).not.toContain('branch_id');
  });

  test('admin with branchId filters to that specific branch', async () => {
    mockAllStatsResults();

    const res = await request(app)
      .get('/api/dashboard/stats?branchId=10')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    expect(res.status).toBe(200);

    // Verify branch filter is in the SQL
    const calls = getQueryCalls();
    // totalSales query should contain branch_id filter
    expect(calls[2].sql).toContain('branch_id');
    expect(calls[2].params).toContain(10);
  });

  test('manager sees only their branch data', async () => {
    mockAllStatsResults();

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(MANAGER_USER)}`);

    expect(res.status).toBe(200);

    // Verify branch filter uses the manager's branchId
    const calls = getQueryCalls();
    expect(calls[2].sql).toContain('branch_id');
    expect(calls[2].params).toContain(10);
  });

  test('cashier without branch falls back to cashier_id filter', async () => {
    const cashierNoBranch = { id: 5, role: 'CASHIER', branchId: null, name: 'Orphan Cashier' };
    mockAllStatsResults();

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(cashierNoBranch)}`);

    expect(res.status).toBe(200);

    // Cashier with no branch should filter by cashier_id
    const calls = getQueryCalls();
    // totalSales query (index 2) should filter by cashier_id
    expect(calls[2].sql).toContain('cashier_id');
    expect(calls[2].params).toContain(5);
  });

  test('branch-specific view uses branch-aware low_stock query', async () => {
    mockAllStatsResults();

    await request(app)
      .get('/api/dashboard/stats?branchId=10')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    const calls = getQueryCalls();
    // The lowStock query (index 0, called before Promise.all) should reference branch_inventory
    expect(calls[0].sql).toContain('branch_inventory');
    expect(calls[0].params).toContain(10);
  });

  test('no-branch view uses simple low_stock query', async () => {
    mockAllStatsResults();

    await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    const calls = getQueryCalls();
    // The lowStock query (index 0, called before Promise.all) should NOT reference branch_inventory
    expect(calls[0].sql).not.toContain('branch_inventory');
  });
});

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD /api/dashboard/top-products
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/dashboard/top-products', () => {
  const sampleProducts = [
    { product_name: 'Rice 50kg', total_qty: 120, total_revenue: 360000 },
    { product_name: 'Vegetable Oil', total_qty: 85, total_revenue: 255000 },
  ];

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/dashboard/top-products');
    expect(res.status).toBe(401);
  });

  test('admin sees top products across all branches', async () => {
    mockQueryResults({ rows: sampleProducts });

    const res = await request(app)
      .get('/api/dashboard/top-products')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].product_name).toBe('Rice 50kg');

    const calls = getQueryCalls();
    // Should NOT have branch filter
    expect(calls[0].sql).not.toContain('branch_id');
  });

  test('admin with branchId filters top products to that branch', async () => {
    mockQueryResults({ rows: [sampleProducts[0]] });

    const res = await request(app)
      .get('/api/dashboard/top-products?branchId=10')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_id');
    expect(calls[0].params).toContain(10);
  });

  test('manager only sees top products from their branch', async () => {
    mockQueryResults({ rows: sampleProducts });

    const res = await request(app)
      .get('/api/dashboard/top-products')
      .set('Authorization', `Bearer ${makeToken(MANAGER_USER)}`);

    expect(res.status).toBe(200);

    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_id');
    expect(calls[0].params).toContain(10);
  });

  test('limits results to 10 products', async () => {
    mockQueryResults({ rows: sampleProducts });

    await request(app)
      .get('/api/dashboard/top-products')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('LIMIT 10');
  });
});

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD /api/dashboard/category-sales
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/dashboard/category-sales', () => {
  const sampleCategories = [
    { category: 'Groceries', revenue: 1500000, qty: 500 },
    { category: 'Beverages', revenue: 800000, qty: 200 },
    { category: 'Household', revenue: 300000, qty: 100 },
  ];

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/dashboard/category-sales');
    expect(res.status).toBe(401);
  });

  test('admin sees category sales across all branches', async () => {
    mockQueryResults({ rows: sampleCategories });

    const res = await request(app)
      .get('/api/dashboard/category-sales')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].category).toBe('Groceries');

    const calls = getQueryCalls();
    expect(calls[0].sql).not.toContain('branch_id');
  });

  test('admin with branchId filters to that branch', async () => {
    mockQueryResults({ rows: [sampleCategories[0]] });

    const res = await request(app)
      .get('/api/dashboard/category-sales?branchId=10')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_id');
    expect(calls[0].params).toContain(10);
  });

  test('manager only sees their branch categories', async () => {
    mockQueryResults({ rows: sampleCategories });

    await request(app)
      .get('/api/dashboard/category-sales')
      .set('Authorization', `Bearer ${makeToken(MANAGER_USER)}`);

    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('branch_id');
    expect(calls[0].params).toContain(10);
  });

  test('query joins sale_items, products, and sales tables', async () => {
    mockQueryResults({ rows: [] });

    await request(app)
      .get('/api/dashboard/category-sales')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('sale_items si');
    expect(calls[0].sql).toContain('products p');
    expect(calls[0].sql).toContain('sales s');
    expect(calls[0].sql).toContain('GROUP BY p.category');
    expect(calls[0].sql).toContain('ORDER BY revenue DESC');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BRANCH SUMMARY /api/dashboard/branch-summary
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/dashboard/branch-summary', () => {
  const sampleBranches = [
    { id: 1, name: 'Main Branch', total_sales: 100, total_revenue: 1500000, active_cashiers: 3, active_days: 20, today_revenue: 75000, today_sales: 5 },
    { id: 2, name: 'Ikeja Branch', total_sales: 80, total_revenue: 1200000, active_cashiers: 2, active_days: 18, today_revenue: 60000, today_sales: 4 },
  ];

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/dashboard/branch-summary');
    expect(res.status).toBe(401);
  });

  test('returns 403 for non-admin users', async () => {
    const res = await request(app)
      .get('/api/dashboard/branch-summary')
      .set('Authorization', `Bearer ${makeToken(MANAGER_USER)}`);

    expect(res.status).toBe(403);
  });

  test('admin gets branch summary with sales data', async () => {
    // First query: branch summary
    mockQueryResults({ rows: sampleBranches });
    // Second query: low stock per branch
    mockQueryResults({ rows: [] });
    // Third query: products with no branch_inventory entry
    mockQueryResults({ rows: [] });

    const res = await request(app)
      .get('/api/dashboard/branch-summary')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    expect(res.status).toBe(200);
    expect(res.body.branches).toHaveLength(2);
    expect(res.body.branches[0].name).toBe('Main Branch');
    expect(res.body.branches[0].total_revenue).toBe(1500000);

    // Verify totals are computed
    expect(res.body.totals).toBeDefined();
    expect(res.body.totals.total_sales).toBe(180); // 100 + 80
    expect(res.body.totals.total_revenue).toBe(2700000); // 1.5M + 1.2M
    expect(res.body.totals.today_revenue).toBe(135000); // 75k + 60k
    expect(res.body.totals.today_sales).toBe(9); // 5 + 4
  });

  test('only queries active branches (WHERE is_active = TRUE)', async () => {
    mockQueryResults({ rows: [] });
    mockQueryResults({ rows: [] });
    mockQueryResults({ rows: [] });

    await request(app)
      .get('/api/dashboard/branch-summary')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    const calls = getQueryCalls();
    // The first query should filter active branches
    expect(calls[0].sql).toContain('is_active = TRUE');
  });

  test('includes low_stock count per branch', async () => {
    const branchesWithLowStock = [
      { ...sampleBranches[0], low_stock: 0 },
      { ...sampleBranches[1], low_stock: 0 },
    ];
    mockQueryResults({ rows: sampleBranches });
    // low stock from branch_inventory only
    mockQueryResults({ rows: [{ branch_id: 1, low_stock_count: 3 }, { branch_id: 2, low_stock_count: 1 }] });

    const res = await request(app)
      .get('/api/dashboard/branch-summary')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    expect(res.status).toBe(200);
    expect(res.body.branches[0].low_stock).toBe(3);
    expect(res.body.branches[1].low_stock).toBe(1);

    // Verify totals include low_stock
    expect(res.body.totals.low_stock).toBe(4); // 3 + 1
  });

  test('handles zero branches gracefully', async () => {
    mockQueryResults({ rows: [] });
    mockQueryResults({ rows: [] });
    mockQueryResults({ rows: [] });

    const res = await request(app)
      .get('/api/dashboard/branch-summary')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    expect(res.status).toBe(200);
    expect(res.body.branches).toHaveLength(0);
    expect(res.body.totals.total_sales).toBe(0);
    expect(res.body.totals.total_revenue).toBe(0);
    expect(res.body.totals.low_stock).toBe(0);
  });

  test('branch summary SQL joins branches and sales correctly', async () => {
    mockQueryResults({ rows: [] });
    mockQueryResults({ rows: [] });
    mockQueryResults({ rows: [] });

    await request(app)
      .get('/api/dashboard/branch-summary')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    const calls = getQueryCalls();
    const sql = calls[0].sql;
    expect(sql).toContain('FROM branches b');
    expect(sql).toContain('LEFT JOIN sales s');
    expect(sql).toContain('GROUP BY b.id, b.name');
    expect(sql).toContain('ORDER BY total_revenue DESC');
  });

  test('branch summary includes today_revenue and today_sales', async () => {
    mockQueryResults({ rows: sampleBranches });
    mockQueryResults({ rows: [] });
    mockQueryResults({ rows: [] });

    const res = await request(app)
      .get('/api/dashboard/branch-summary')
      .set('Authorization', `Bearer ${makeToken(ADMIN_USER)}`);

    expect(res.body.branches[0].today_revenue).toBe(75000);
    expect(res.body.branches[0].today_sales).toBe(5);

    // Verify the SQL uses CURRENT_DATE for today filtering
    const calls = getQueryCalls();
    expect(calls[0].sql).toContain('CURRENT_DATE');
  });
});
