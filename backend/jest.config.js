module.exports = {
  testEnvironment: 'node',
  // Our code is plain CommonJS — no babel transformation needed
  transform: {},
  // Only run test files in __tests__
  testMatch: ['**/__tests__/**/*.test.js'],
  // Clear mocks between tests
  clearMocks: true,
  // Force exit after tests complete (pg pool connections)
  forceExit: true,
  detectOpenHandles: true,
};
