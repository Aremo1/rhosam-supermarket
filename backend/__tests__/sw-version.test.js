// ═══════════════════════════════════════════════════════════════════
// Service Worker Cache Version Tests
// Verifies the SW cache version is properly bumped and consistent
// between source (frontend/public/sw.js) and build output (frontend/dist/sw.js)
// ═══════════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

// Paths relative to backend/ directory
const ROOT = path.resolve(__dirname, "..", "..");
const SOURCE_SW = path.join(ROOT, "frontend", "public", "sw.js");
const DIST_SW = path.join(ROOT, "frontend", "dist", "sw.js");
const INDEX_HTML = path.join(ROOT, "frontend", "dist", "index.html");

// Minimum allowed cache version — bump this when making breaking SW changes
const MIN_CACHE_VERSION = 3;

/**
 * Extract the CACHE_VERSION value from a Service Worker file.
 * Looks for: const CACHE_VERSION = "vN";
 */
function extractCacheVersion(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/const\s+CACHE_VERSION\s*=\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

/**
 * Extract all cache names that use CACHE_VERSION from the SW file.
 * E.g. rhosam-static-${CACHE_VERSION}
 */
function extractCacheNames(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const regex = /`([^`]*\$\{CACHE_VERSION\}[^`]*)`/g;
  const names = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Check that the activate handler deletes old caches.
 */
function hasCacheCleanup(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return (
    content.includes("caches.keys()") &&
    content.includes("caches.delete") &&
    content.includes("validCaches")
  );
}

/**
 * Check that SKIP_WAITING message handler exists.
 */
function hasSkipWaitingHandler(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return content.includes('case "SKIP_WAITING"') || content.includes('type: "SKIP_WAITING"');
}

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Service Worker Cache Version", () => {
  let sourceVersion;
  let distVersion;

  beforeAll(() => {
    // Read source SW
    if (fs.existsSync(SOURCE_SW)) {
      sourceVersion = extractCacheVersion(SOURCE_SW);
    }
    // Read dist SW
    if (fs.existsSync(DIST_SW)) {
      distVersion = extractCacheVersion(DIST_SW);
    }
  });

  test("source sw.js exists and has a valid CACHE_VERSION", () => {
    expect(fs.existsSync(SOURCE_SW)).toBe(true);
    expect(sourceVersion).not.toBeNull();
    expect(sourceVersion).toMatch(/^v\d+$/); // Must match "vN" format
  });

  test("dist sw.js exists and has a valid CACHE_VERSION", () => {
    expect(fs.existsSync(DIST_SW)).toBe(true);
    expect(distVersion).not.toBeNull();
    expect(distVersion).toMatch(/^v\d+$/);
  });

  test("dist CACHE_VERSION matches source CACHE_VERSION", () => {
    if (!sourceVersion || !distVersion) {
      // If either file is missing, skip with a clear message
      if (!sourceVersion) return console.warn("Source sw.js not found, skipping");
      if (!distVersion) return console.warn("Dist sw.js not found, skipping — run `npm run build` first");
      return;
    }
    expect(distVersion).toBe(sourceVersion);
  });

  test("CACHE_VERSION is at least the minimum required version", () => {
    const version = sourceVersion || distVersion;
    if (!version) return console.warn("No sw.js found, skipping");

    const versionNumber = parseInt(version.replace("v", ""), 10);
    expect(versionNumber).toBeGreaterThanOrEqual(MIN_CACHE_VERSION);
  });

  test("all cache names in source use the same CACHE_VERSION", () => {
    if (!fs.existsSync(SOURCE_SW)) return console.warn("Source sw.js not found, skipping");

    const cacheNames = extractCacheNames(SOURCE_SW);
    expect(cacheNames.length).toBeGreaterThanOrEqual(3); // Should have at least STATIC, DYNAMIC, API caches

    // All cache name templates should reference CACHE_VERSION
    cacheNames.forEach((name) => {
      expect(name).toContain("${CACHE_VERSION}");
    });
  });

  test("activate handler cleans old caches", () => {
    if (!fs.existsSync(SOURCE_SW)) return console.warn("Source sw.js not found, skipping");
    expect(hasCacheCleanup(SOURCE_SW)).toBe(true);
  });

  test("SKIP_WAITING message handler exists for forced updates", () => {
    if (!fs.existsSync(SOURCE_SW)) return console.warn("Source sw.js not found, skipping");
    expect(hasSkipWaitingHandler(SOURCE_SW)).toBe(true);
  });

  test("dist index.html references the built JS/CSS assets (not stale)", () => {
    if (!fs.existsSync(INDEX_HTML)) return console.warn("dist/index.html not found, skipping");

    const html = fs.readFileSync(INDEX_HTML, "utf8");

    // Should contain a hashed JS asset reference
    const jsMatch = html.match(/\/assets\/index-[A-Za-z0-9_]+\.js/);
    expect(jsMatch).not.toBeNull();

    // Should contain a hashed CSS asset reference
    const cssMatch = html.match(/\/assets\/index-[A-Za-z0-9_]+\.css/);
    expect(cssMatch).not.toBeNull();

    // The referenced JS file should actually exist on disk
    if (jsMatch) {
      const jsPath = path.join(ROOT, "frontend", "dist", jsMatch[0]);
      expect(fs.existsSync(jsPath)).toBe(true);
    }
  });

  test("dist sw.js version is not older than source sw.js", () => {
    if (!sourceVersion || !distVersion) return console.warn("Both sw.js files needed, skipping");

    const sourceNum = parseInt(sourceVersion.replace("v", ""), 10);
    const distNum = parseInt(distVersion.replace("v", ""), 10);
    expect(distNum).toBeGreaterThanOrEqual(sourceNum);
  });
});
