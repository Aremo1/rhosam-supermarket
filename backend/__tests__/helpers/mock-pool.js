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

const mockPool = {
  query: jest.fn(async (sql, params) => {
    queryCalls.push({ sql, params: params || [] });
    if (queryResults.length > 0) {
      return queryResults.shift();
    }
    return { rows: [], rowCount: 0 };
  }),
  connect: jest.fn(async () => ({
    query: jest.fn(async (sql, params) => {
      queryCalls.push({ sql, params: params || [] });
      if (queryResults.length > 0) {
        return queryResults.shift();
      }
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  })),
  end: jest.fn(),
};

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

module.exports = { mockPool, getQueryCalls, getQueryCall, mockQueryResults, resetMock };
