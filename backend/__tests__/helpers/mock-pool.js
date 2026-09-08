/**
 * Mock pg Pool for testing endpoints without a real database.
 *
 * Usage:
 *   const { mockPool, mockQuery, resetMock } = require('./helpers/mock-pool');
 *   // Before each test, configure responses:
 *   mockQuery.mockResolvedValueOnce({ rows: [{ count: 5 }] });
 */

let queryResults = [];
let queryCalls = [];

// jest is provided by vitest.setup.js; fall back to globalThis if not wired yetexports.jest = (function() {
  try {
    return require('./vitest.setup.js').jest || globalThis.jest || {};
  } catch (e) {
    return globalThis.jest || {};
  }
})();
globalThis.jest = Object.assign({}, exports.jest, globalThis.jest || {});
const jest = globalThis.jest || {};

function makeMockFn(impl) {
  if (typeof impl === 'function') {
    const fn = impl;
    fn.mockClear = () => {};
    fn.mockReset = () => {};
    return fn;
  }
  const fn = () => impl;
  fn.mockClear = () => {};
  fn.mockReset = () => {};
  return fn;
}

const MockPool = {
  query: makeMockFn(async (sql, params) => {
    queryCalls.push({ sql, params: params || [] });
    if (queryResults.length > 0) {
      return queryResults.shift();
    }
    return { rows: [], rowCount: 0 };
  }),
  connect: makeMockFn(async () => ({
    query: makeMockFn(async (sql, params) => {
      queryCalls.push({ sql, params: params || [] });
      if (queryResults.length > 0) {
        return queryResults.shift();
      }
      return { rows: [], rowCount: 0 };
    }),
    release: makeMockFn(),
  })),
  end: makeMockFn(),
};

// Provide a Pool constructor as well so requires that do `new Pool(...)` work
function Pool(...args) {
  return MockPool;
}
Pool.prototype = MockPool;
Pool.query = MockPool.query;
Pool.connect = MockPool.connect;
Pool.end = MockPool.end;

const mockPool = MockPool;

// Also attach the Pool to the module exports used by tests that install mocks manually
module.exports = { mockPool, getQueryCalls, getQueryCall, mockQueryResults, resetMock, Pool };

// When installed as a module replacement, `new Pool()` must still return a usable pool.
// If the test runner has installed this module under its own paths, ensure the
// replacement object exposes a callable `Pool` constructor.
exports.Pool = Pool;
exports.default = Pool;
exports.__esModule = true;
exports.module = { exports: exports };

/** Get all queries that were made to pool.query */
function getQueryCalls() {
  return [...queryCalls];
}

/** Get SQL + params for the Nth query (0-indexed) */
function getQueryCall(index) {
  return queryCalls[index] || null;
}

/** Preload a sequence of results for pool.query calls */
function mockQueryResults(...results) {
  queryResults.push(...results);
}

/** Reset all recorded calls and queued results */
function resetMock() {
  queryResults = [];
  queryCalls = [];
  mockPool.query.mockClear();
  mockPool.connect.mockClear();
  mockPool.end.mockClear();
}

module.exports = { mockPool, getQueryCalls, getQueryCall, mockQueryResults, resetMock, Pool };
