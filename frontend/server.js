import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");
const PORT = process.env.PORT || 3001;
const RAW_TARGET = process.env.API_TARGET || process.env.VITE_API_URL || "http://localhost:5000";
const API_TARGET = /^https?:\/\//.test(RAW_TARGET) ? RAW_TARGET : `https://${RAW_TARGET}`;
const API_BASE = API_TARGET.replace(/\/api$/, "");

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
  const targetUrl = `${API_BASE}${req.url}`;
  const opts = {
    hostname: new URL(API_BASE).hostname,
    port: new URL(API_BASE).port || 80,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: new URL(API_BASE).host },
  };
  const proxy = http.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxy.on("error", (err) => {
    console.error("[PROXY] Error:", err.message);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Backend unavailable" }));
  });
  req.pipe(proxy, { end: true });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Proxy /api and /uploads to backend
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/uploads")) {
    return proxyRequest(req, res);
  }

  let filePath = path.join(DIST, url.pathname === "/" ? "index.html" : url.pathname);

  // Try to serve the exact file
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    } else {
      // SPA fallback: serve index.html for all non-file routes
      const indexPath = path.join(DIST, "index.html");
      res.writeHead(200, { "Content-Type": "text/html" });
      fs.createReadStream(indexPath).pipe(res);
    }
  });
});

server.listen(PORT, () => {
  console.log(`RHoSAM frontend running on port ${PORT} (proxying API to ${API_BASE})`);
});
