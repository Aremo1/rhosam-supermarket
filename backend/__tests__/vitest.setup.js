// Bridge vitest globals so jest-style tests can run
globalThis.describe = describe;
globalThis.test = test;
globalThis.expect = expect;
globalThis.beforeAll = beforeAll;
globalThis.afterAll = afterAll;
globalThis.beforeEach = beforeEach;
globalThis.afterEach = afterEach;

// Forward vitest's fn/spyOn so jest.mocked helpers resolve
globalThis.jest = globalThis.jest || {};
globalThis.jest.fn = globalThis.vitest?.fn || globalThis.jest.fn || (() => {});
globalThis.jest.spyOn = globalThis.vitest?.spyOn || globalThis.jest.spyOn || (() => {});
globalThis.jest.mock = globalThis.jest.mock || (() => {});
globalThis.jest.clearAllMocks = globalThis.jest.clearAllMocks || (() => {});
globalThis.jest.resetAllMocks = globalThis.jest.resetAllMocks || (() => {});
globalThis.jest.restoreAllMocks = globalThis.jest.restoreAllMocks || (() => {});

// Stub jest.mock for ESM environments where hoisting is not possible
// These stubs allow the source to load; tests that depend on module
// substitution at require-time will need a real jest runner.
globalThis.jest.mock = globalThis.jest.mock || ((_path, factory) => {
  if (typeof factory === 'function') {
    try {
      return factory();
    } catch (e) {
      /* swallow */
    }
  }
  return {};
});
globalThis.jest.fn = globalThis.jest.fn || ((impl) => impl || (() => {}));
globalThis.jest.spyOn = globalThis.jest.spyOn || ((obj, method) => ({
  mockImplementation: () => globalThis.jest.spyOn,
  mockRestore: () => {},
}));

// Provide the 'jest' global for CJS test files that reference it at the top level
globalThis.jest = globalThis.jest || {};
exports.jest = globalThis.jest;
globalThis.jest.fn = globalThis.vitest?.fn || globalThis.jest.fn || (() => {});
globalThis.jest.spyOn = globalThis.vitest?.spyOn || globalThis.jest.spyOn || (() => {});
globalThis.jest.mock = globalThis.jest.mock || (() => {});
globalThis.jest.clearAllMocks = globalThis.jest.clearAllMocks || (() => {});
globalThis.jest.resetAllMocks = globalThis.jest.resetAllMocks || (() => {});
globalThis.jest.restoreAllMocks = globalThis.jest.restoreAllMocks || (() => {});
