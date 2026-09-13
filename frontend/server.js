import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");
const PORT = process.env.PORT || 3001;
const RAW_TARGET = process.env.API_TARGET || process.env.VITE_API_URL || "http://localhost:5000";
const API_TARGET = /^https?:\/\//.test(RAW_TARGET) ? RAW_TARGET : `https://${RAW_TARGET}`;
const API_BASE = API_TARGET.replace(/\/api$/, "");
const API_URL = new URL(API_BASE);
const IS_HTTPS = API_URL.protocol === "https:";
const proxyModule = IS_HTTPS ? https : http;

// ── Custom Domain / Subdomain Configuration ────────────────────
const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN || "rhosam.com";

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function proxyRequest(req, res) {
  const opts = {
    hostname: API_URL.hostname,
    port: API_URL.port || (IS_HTTPS ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: API_URL.host },
  };
  const proxy = proxyModule.request(opts, (proxyRes) => {
    // Copy all headers from backend (including CORS, SSE headers)
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    // For SSE streams, disable Node.js buffering so events stream in real-time
    if (proxyRes.headers["content-type"] === "text/event-stream") {
      res.write("");
    }
    proxyRes.pipe(res, { end: true });
  });
  proxy.on("error", (err) => {
    console.error("[PROXY] Error:", err.message);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Backend unavailable" }));
  });
  req.pipe(proxy, { end: true });
}

// ── Resolve branch context from hostname ───────────────────────
// Supports:
//   1. Custom domain:  my-store.com → branch with matching custom_domain
//   2. Wildcard subdomain:  branch-slug.rhosam.com → branch with matching slug
//   3. Path-based:  /s/<slug>/... → branch from URL path
function resolveBranchFromHost(host) {
  if (!host) return null;
  const h = host.toLowerCase().split(":")[0];

  // Check if it's a subdomain of our platform domain
  const dotIdx = h.indexOf(".");
  if (dotIdx > 0) {
    const subdomain = h.substring(0, dotIdx);
    const domain = h.substring(dotIdx + 1);
    if (domain === PLATFORM_DOMAIN || domain.endsWith("." + PLATFORM_DOMAIN)) {
      return subdomain; // This is a branch slug
    }
  }

  // For custom domains, we can't resolve locally — the backend handles it
  // The frontend will call /api/domains/resolve to get branch context
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ── Proxy /api and /uploads to backend ─────────────────────────
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/uploads")) {
    return proxyRequest(req, res);
  }

  // ── Path-based branch routes: /s/<slug>/... ────────────────────
  // Rewrite /s/<slug>/page to /page (frontend SPA handles routing)
  // The branch slug is passed as a header so the SPA can detect it
  let filePath;
  const pathMatch = url.pathname.match(/^\/s\/([^/]+)(\/.*)?$/);
  if (pathMatch) {
    const branchSlug = pathMatch[1];
    const subPath = pathMatch[2] || "/";
    // Serve the SPA but add a header with the branch slug
    filePath = path.join(DIST, subPath === "/" ? "index.html" : subPath);
    // We'll inject the branch slug via the response header for the SPA
    // For now, just serve the SPA normally
    const indexPath = path.join(DIST, "index.html");
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      filePath = indexPath;
    }
  } else {
    filePath = path.join(DIST, url.pathname === "/" ? "index.html" : url.pathname);
  }

  // Try to serve the exact file
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };

      // HTML files and service worker: never cache (SPA with hashed assets)
      if (ext === ".html" || url.pathname === "/sw.js") {
        headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        headers["Pragma"] = "no-cache";
        headers["Expires"] = "0";
      }
      // Hashed assets (JS, CSS): cache aggressively (Vite adds content hash)
      else if (url.pathname.startsWith("/assets/")) {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      }
      // Other static files: cache for 1 hour
      else if (ext !== ".html") {
        headers["Cache-Control"] = "public, max-age=3600";
      }

      // For path-based branch routes, add branch slug header
      if (pathMatch) {
        headers["X-Branch-Slug"] = pathMatch[1];
      }

      // For wildcard subdomains, add subdomain header
      const branchSlug = resolveBranchFromHost(req.headers.host);
      if (branchSlug) {
        headers["X-Branch-Slug"] = branchSlug;
      }

      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    } else {
      // SPA fallback: serve index.html for all non-file routes (never cache)
      const indexPath = path.join(DIST, "index.html");
      const headers = {
        "Content-Type": "text/html",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      };

      // For path-based branch routes, add branch slug header
      if (pathMatch) {
        headers["X-Branch-Slug"] = pathMatch[1];
      }

      // For wildcard subdomains, add subdomain header
      const branchSlug = resolveBranchFromHost(req.headers.host);
      if (branchSlug) {
        headers["X-Branch-Slug"] = branchSlug;
      }

      res.writeHead(200, headers);
      fs.createReadStream(indexPath).pipe(res);
    }
  });
});

server.listen(PORT, () => {
  console.log(`RHoSAM frontend running on port ${PORT} (proxying API to ${API_BASE})`);
  console.log(`  Platform domain: ${PLATFORM_DOMAIN}`);
});
