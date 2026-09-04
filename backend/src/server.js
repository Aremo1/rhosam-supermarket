const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { Resend } = require("resend");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v2: cloudinary } = require("cloudinary");
require("dotenv").config();
const helmet = require("helmet");

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ── Payment Gateway Setup (Paystack / Flutterwave) ─────────────
const PAYMENT_GATEWAY = (process.env.PAYMENT_GATEWAY || "INTERNAL").toUpperCase();
const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY || "";
const paystackPublicKey = process.env.PAYSTACK_PUBLIC_KEY || "";
const flutterwaveSecretKey = process.env.FLUTTERWAVE_SECRET_KEY || "";
const flutterwavePublicKey = process.env.FLUTTERWAVE_PUBLIC_KEY || "";
const paymentWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || "";

// Paystack API helpers
const paystack = {
  async initializeTransaction({ email, amount, reference, metadata = {} }) {
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackSecretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, amount: Math.round(amount * 100), reference, currency: "NGN", metadata }),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "Paystack initialization failed");
    return data.data; // { authorization_url, access_code, reference }
  },
  async verifyTransaction(reference) {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${paystackSecretKey}` },
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "Paystack verification failed");
    return data.data; // { status, amount, currency, reference, gateway_response, ... }
  },
  verifyWebhook(signature, body) {
    if (!paymentWebhookSecret) return true; // skip if no secret configured
    const crypto = require("crypto");
    const hash = crypto.createHmac("sha512", paymentWebhookSecret).update(body).digest("hex");
    return hash === signature;
  },
};

// Flutterwave API helpers
const flutterwave = {
  async initializeTransaction({ email, amount, reference, redirectUrl }) {
    const res = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${flutterwaveSecretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_ref: reference,
        amount,
        currency: "NGN",
        redirect_url: redirectUrl || `${process.env.FRONTEND_URL || "http://localhost:5173"}/pos`,
        customer: { email },
        meta: { source: "rhosam_pos" },
      }),
    });
    const data = await res.json();
    if (data.status !== "success") throw new Error(data.message || "Flutterwave initialization failed");
    return data.data; // { link, ... }
  },
  async verifyTransaction(transactionId) {
    const res = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
      headers: { Authorization: `Bearer ${flutterwaveSecretKey}` },
    });
    const data = await res.json();
    if (data.status !== "success") throw new Error(data.message || "Flutterwave verification failed");
    return data.data; // { status, amount, tx_ref, id, ... }
  },
  verifyWebhook(signature, body) {
    if (!paymentWebhookSecret) return true;
    const crypto = require("crypto");
    const hash = crypto.createHmac("sha256", paymentWebhookSecret).update(body).digest("hex");
    return hash === signature;
  },
};

// Paystack Terminal API helpers
const paystackTerminal = {
  _getKey() {
    return paymentSettingsCache.paystackSecretKey || paystackSecretKey;
  },
  async listTerminals() {
    const res = await fetch("https://api.paystack.co/terminal", {
      headers: { Authorization: `Bearer ${this._getKey()}` },
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "Failed to list terminals");
    return data.data || [];
  },
  async getTerminal(terminalId) {
    const res = await fetch(`https://api.paystack.co/terminal/${terminalId}`, {
      headers: { Authorization: `Bearer ${this._getKey()}` },
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "Failed to fetch terminal");
    return data.data;
  },
  async checkPresence(terminalId) {
    const res = await fetch(`https://api.paystack.co/terminal/${terminalId}/presence`, {
      headers: { Authorization: `Bearer ${this._getKey()}` },
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "Failed to check terminal presence");
    return data.data; // { online, available }
  },
  async commissionDevice(serialNumber) {
    const res = await fetch("https://api.paystack.co/terminal/commission_device", {
      method: "POST",
      headers: { Authorization: `Bearer ${this._getKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ serial_number: serialNumber }),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "Failed to commission device");
    return data;
  },
  async decommissionDevice(serialNumber) {
    const res = await fetch("https://api.paystack.co/terminal/decommission_device", {
      method: "POST",
      headers: { Authorization: `Bearer ${this._getKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ serial_number: serialNumber }),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "Failed to decommission device");
    return data;
  },
  async updateTerminal(terminalId, updates) {
    const res = await fetch(`https://api.paystack.co/terminal/${terminalId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this._getKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "Failed to update terminal");
    return data;
  },
  async sendEvent(terminalId, eventType, action, eventData) {
    const res = await fetch(`https://api.paystack.co/terminal/${terminalId}/event`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this._getKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: eventType, action, data: eventData }),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "Failed to send event to terminal");
    return data.data; // { id: event_id }
  },
  async getEventStatus(terminalId, eventId) {
    const res = await fetch(`https://api.paystack.co/terminal/${terminalId}/event/${eventId}`, {
      headers: { Authorization: `Bearer ${this._getKey()}` },
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "Failed to get event status");
    return data.data; // { delivered: true/false }
  },
};

function getActiveGateway() {
  // DB settings override env vars
  if (paymentSettingsCache.gateway === "PAYSTACK" && (paymentSettingsCache.paystackSecretKey || paystackSecretKey)) return "PAYSTACK";
  if (paymentSettingsCache.gateway === "FLUTTERWAVE" && (paymentSettingsCache.flutterwaveSecretKey || flutterwaveSecretKey)) return "FLUTTERWAVE";
  // Fallback to env vars
  if (PAYMENT_GATEWAY === "PAYSTACK" && paystackSecretKey) return "PAYSTACK";
  if (PAYMENT_GATEWAY === "FLUTTERWAVE" && flutterwaveSecretKey) return "FLUTTERWAVE";
  return "INTERNAL";
}

// ── Mutable Payment Settings (DB-backed, env-var fallback) ──────
const paymentSettingsCache = {
  gateway: process.env.PAYMENT_GATEWAY || "INTERNAL",
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || "",
  paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || "",
  flutterwaveSecretKey: process.env.FLUTTERWAVE_SECRET_KEY || "",
  flutterwavePublicKey: process.env.FLUTTERWAVE_PUBLIC_KEY || "",
  webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || "",
  testMode: true,
};

async function loadPaymentSettings() {
  try {
    const { rows } = await pool.query("SELECT * FROM payment_settings WHERE is_active=TRUE ORDER BY id DESC LIMIT 1");
    if (rows[0]) {
      const s = rows[0];
      paymentSettingsCache.gateway = s.gateway || "INTERNAL";
      paymentSettingsCache.paystackSecretKey = s.paystack_secret_key || paymentSettingsCache.paystackSecretKey;
      paymentSettingsCache.paystackPublicKey = s.paystack_public_key || paymentSettingsCache.paystackPublicKey;
      paymentSettingsCache.flutterwaveSecretKey = s.flutterwave_secret_key || paymentSettingsCache.flutterwaveSecretKey;
      paymentSettingsCache.flutterwavePublicKey = s.flutterwave_public_key || paymentSettingsCache.flutterwavePublicKey;
      paymentSettingsCache.webhookSecret = s.webhook_secret || paymentSettingsCache.webhookSecret;
      paymentSettingsCache.testMode = s.test_mode !== false;
      console.log(`[PAYMENT] Loaded gateway: ${paymentSettingsCache.gateway}`);
    }
  } catch (e) {
    // Table may not exist yet — fall back to env vars silently
    if (!e.message.includes("does not exist"))
      console.error("[PAYMENT] Failed to load settings from DB:", e.message);
  }
}

// ── SMS Setup (Telnyx, optional) ───────────────────────────────
let telnyx = null;
if (process.env.TELNYX_API_KEY) {
  try {
    const Telnyx = require("telnyx");
    telnyx = new Telnyx(process.env.TELNYX_API_KEY);
  } catch { console.log("[SMS] telnyx package not installed — SMS disabled"); }
}

// ── Cloudinary Setup ────────────────────────────────────────────
const useCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
if (useCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// ── File Upload Setup (fallback to local) ───────────────────────
const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
    cb(ok ? null : new Error("Only image files (jpg, png, gif, webp) are allowed."), ok);
  },
});

const app = express();
if (!useCloudinary) app.use("/uploads", express.static(uploadsDir));
const port = Number(process.env.PORT || 5000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const secret = process.env.JWT_SECRET;
const maxAttempts = Number(process.env.MAX_LOGIN_ATTEMPTS || 5);
const lockMinutes = Number(process.env.LOCK_MINUTES || 15);
const saltRounds = 12;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing in backend/.env");
  process.exit(1);
}
if (!secret) {
  console.error("JWT_SECRET is missing in backend/.env");
  process.exit(1);
}

const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173").split(',').map(s => s.trim());
app.use(cors({ origin: (origin, cb) => {
  if (!origin || allowedOrigins.includes(origin) || origin.includes('onrender.com')) cb(null, true);
  else cb(null, true); // allow all in production for now
}}));
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "2mb" }));

// Simple in-memory rate limiter (Express 5 compatible)
const rateLimits = {};
let lastCleanup = Date.now();
function makeRateLimiter(windowMs, max) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    // Periodic cleanup of expired entries (every 5 minutes)
    if (now - lastCleanup > 5 * 60 * 1000) {
      lastCleanup = now;
      for (const k of Object.keys(rateLimits)) {
        if (now - rateLimits[k].start > windowMs) delete rateLimits[k];
      }
    }
    if (!rateLimits[key] || now - rateLimits[key].start > windowMs) {
      rateLimits[key] = { start: now, count: 0 };
    }
    rateLimits[key].count++;
    if (rateLimits[key].count > max) {
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }
    next();
  };
}
app.use("/api/auth/login", makeRateLimiter(15 * 60 * 1000, 50));
app.use("/api/auth/forgot-password", makeRateLimiter(15 * 60 * 1000, 50));

// ── Cache headers for static resources ─────────────────────────
app.use((req, res, next) => {
  // Static assets get aggressive caching
  if (req.path.startsWith("/uploads")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else if (req.method === "GET" && !req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "public, max-age=3600");
  }
  // API responses: no-cache by default (fresh data each time)
  if (req.path.startsWith("/api/") && req.method === "GET") {
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("X-Response-Time", Date.now().toString());
  }
  next();
});

// ── Middleware ────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ message: "Authentication required." });
  try { req.user = jwt.verify(t, secret); next(); }
  catch { return res.status(401).json({ message: "Session expired or invalid." }); }
};
const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: "Permission denied." });

// Helper: Check if user is a super-admin (ADMIN role with no branch assignment)
// Super-admins have full access across all branches.
// ADMIN users with a branch_id are "branch admins" — scoped to their own branch.
function isSuperAdmin(req) {
  return req.user && req.user.role === "ADMIN" && !req.user.branchId;
}

// Middleware: Only super-admins (ADMIN without branch_id) can proceed
const requireSuperAdmin = (req, res, next) =>
  isSuperAdmin(req) ? next() : res.status(403).json({ message: "Super-admin access required. Only users with ADMIN role and no branch assignment can access this." });

// Helper: Check if user is a branch-scoped admin (ADMIN with a branch_id)
function isBranchAdmin(req) {
  return req.user && req.user.role === "ADMIN" && !!req.user.branchId;
}

async function audit(c, u, a, e, id, d = {}, req = null) {
  const ip = req ? (req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim() : null;
  const ua = req ? req.headers["user-agent"] || null : null;
  await c.query(
    "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details,ip_address,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [u, a, e, String(id || ""), JSON.stringify(d), ip, ua]
  );
}

// Auto-calculate membership tier based on total_spent
function calcMembershipTier(totalSpent) {
  const t = Number(totalSpent || 0);
  if (t >= 500000) return "PLATINUM";  // ₦500k+
  if (t >= 200000) return "GOLD";       // ₦200k+
  if (t >= 50000)  return "SILVER";     // ₦50k+
  return "BRONZE";
}

async function updateCustomerTier(c, customerId) {
  const { rows } = await c.query("SELECT total_spent FROM customers WHERE id=$1", [customerId]);
  if (rows[0]) {
    const tier = calcMembershipTier(rows[0].total_spent);
    await c.query("UPDATE customers SET membership_tier=$1 WHERE id=$2", [tier, customerId]);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 7: AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════

const serverStartTime = Date.now();
app.get("/api/health", async (_q, r, n) => {
  try {
    const checks = {};
    // Database check
    const dbStart = Date.now();
    await pool.query("SELECT 1");
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
    // Connection pool stats
    checks.pool = {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
    // System info
    checks.system = {
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      nodeVersion: process.version,
      platform: process.platform,
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
    // Resend email configured
    checks.services = {
      email: !!resend,
      sms: !!telnyx,
      cloudinary: !!useCloudinary,
    };
    r.json({ status: "ok", timestamp: new Date().toISOString(), ...checks });
  } catch (e) {
    r.status(503).json({ status: "error", message: e.message, timestamp: new Date().toISOString() });
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const { rows } = await pool.query("SELECT * FROM users WHERE LOWER(email)=$1", [email]);
    const u = rows[0];
    if (!u || !u.is_active) return res.status(401).json({ message: "Invalid email or password." });
    if (u.locked_until && new Date(u.locked_until) > new Date())
      return res.status(423).json({ message: "Account temporarily locked. Try again later." });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) {
      const attempts = u.failed_login_attempts + 1;
      const locked = attempts >= maxAttempts ? new Date(Date.now() + lockMinutes * 60000) : null;
      await pool.query("UPDATE users SET failed_login_attempts=$1,locked_until=$2 WHERE id=$3", [attempts, locked, u.id]);
      return res.status(401).json({ message: "Invalid email or password." });
    }
    await pool.query("UPDATE users SET failed_login_attempts=0,locked_until=NULL,last_login_at=NOW() WHERE id=$1", [u.id]);
    await audit(pool, u.id, "LOGIN", "USER", u.id, {}, req);
    // Load user's branch info
    let branchInfo = null;
    if (u.branch_id) {
      const { rows: branchRows } = await pool.query("SELECT id, name FROM branches WHERE id=$1 AND is_active=TRUE", [u.branch_id]);
      branchInfo = branchRows[0] || null;
    }
    const token = jwt.sign({ id: u.id, name: u.name, email: u.email, role: u.role, branchId: u.branch_id || null }, secret, { expiresIn: "8h" });
    // Check password expiry
    const passwordExpired = u.password_expires_at && new Date(u.password_expires_at) <= new Date();
    res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role, branchId: u.branch_id || null, branch: branchInfo }, passwordExpired });
  } catch (e) { next(e); }
});

app.get("/api/auth/me", auth, async (req, res) => {
  try {
    // Load branch info if user has a branch_id
    let branch = null;
    if (req.user.branchId) {
      const { rows } = await pool.query("SELECT id, name FROM branches WHERE id=$1 AND is_active=TRUE", [req.user.branchId]);
      branch = rows[0] || null;
    }
    res.json({ user: { ...req.user, branch } });
  } catch (e) {
    res.json({ user: req.user });
  }
});

app.post("/api/auth/change-password", auth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (String(newPassword || "").length < 12)
      return res.status(400).json({ message: "New password must contain at least 12 characters." });
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(String(currentPassword || ""), rows[0].password_hash)))
      return res.status(401).json({ message: "Current password is incorrect." });
    const hash = await bcrypt.hash(newPassword, saltRounds);
    await pool.query("UPDATE users SET password_hash=$1,password_changed_at=NOW(),password_expires_at=NOW()+INTERVAL '90 days',updated_at=NOW() WHERE id=$2", [hash, req.user.id]);
    await audit(pool, req.user.id, "CHANGE_PASSWORD", "USER", req.user.id, {}, req);
    res.json({ message: "Password changed successfully." });
  } catch (e) { next(e); }
});

// ── Forgot Password ───────────────────────────────────────────
app.post("/api/auth/forgot-password", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email required." });
    const { rows } = await pool.query("SELECT id, name FROM users WHERE LOWER(email)=$1 AND is_active=TRUE", [email]);
    // Always return success to prevent email enumeration
    if (!rows[0]) return res.json({ message: "If an account with that email exists, a reset link has been sent." });
    const crypto = require("crypto");
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await pool.query("INSERT INTO password_reset_tokens(user_id,token,expires_at) VALUES($1,$2,$3)", [rows[0].id, token, expiresAt]);
    // Send email if Resend is configured
    if (resend) {
      const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${token}`;
      await resend.emails.send({
        from: "RHoSAM Security <onboarding@resend.dev>",
        to: email,
        subject: "RHoSAM — Password Reset Request",
        html: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
          <div style="background:#16a34a;color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center">
            <h1 style="margin:0;font-size:20px">🔐 Password Reset</h1>
          </div>
          <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb">
            <p>Hi ${rows[0].name},</p>
            <p>We received a request to reset your password. Click the button below to set a new password:</p>
            <div style="text-align:center;margin:20px 0">
              <a href="${resetUrl}" style="background:#16a34a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Reset Password</a>
            </div>
            <p style="color:#666;font-size:13px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
          </div>
          <div style="text-align:center;padding:16px;color:#9ca3af;font-size:12px">RHoSAM Supermarket POS</div>
        </div>`,
      }).catch(e => console.error("[EMAIL] forgot-password:", e.message));
    }
    await audit(pool, rows[0].id, "FORGOT_PASSWORD", "USER", rows[0].id, { email }, req);
    res.json({ message: "If an account with that email exists, a reset link has been sent." });
  } catch (e) { next(e); }
});

app.post("/api/auth/reset-password", async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ message: "Token and new password required." });
    if (String(newPassword).length < 12)
      return res.status(400).json({ message: "Password must contain at least 12 characters." });
    const { rows } = await pool.query(
      "SELECT * FROM password_reset_tokens WHERE token=$1 AND used=FALSE AND expires_at > NOW()", [token]
    );
    if (!rows[0]) return res.status(400).json({ message: "Invalid or expired reset token." });
    const hash = await bcrypt.hash(newPassword, saltRounds);
    await pool.query("UPDATE users SET password_hash=$1,password_changed_at=NOW(),password_expires_at=NOW()+INTERVAL '90 days',updated_at=NOW() WHERE id=$2", [hash, rows[0].user_id]);
    await pool.query("UPDATE password_reset_tokens SET used=TRUE WHERE id=$1", [rows[0].id]);
    await audit(pool, rows[0].user_id, "RESET_PASSWORD", "USER", rows[0].user_id, {}, req);
    res.json({ message: "Password reset successfully. You can now log in." });
  } catch (e) { next(e); }
});

// ── MFA (Multi-Factor Authentication) ─────────────────────────
app.post("/api/auth/mfa/setup", auth, async (req, res, next) => {
  try {
    const crypto = require("crypto");
    const secret = crypto.randomBytes(20).toString("hex");
    await pool.query("UPDATE users SET mfa_secret=$1, mfa_enabled=FALSE WHERE id=$2", [secret, req.user.id]);
    // Clear any old backup codes from previous setup attempts
    await pool.query("DELETE FROM mfa_backup_codes WHERE user_id=$1", [req.user.id]);

    // Convert hex secret to Base32 for the otpauth URL (authenticator apps require Base32)
    const hexToBase32 = (hex) => {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      let bits = "";
      for (let i = 0; i < hex.length; i++) {
        bits += parseInt(hex[i], 16).toString(2).padStart(4, "0");
      }
      let base32 = "";
      for (let i = 0; i + 5 <= bits.length; i += 5) {
        base32 += alphabet[parseInt(bits.slice(i, i + 5), 2)];
      }
      return base32;
    };
    const base32Secret = hexToBase32(secret);

    // Generate TOTP URI for authenticator apps
    const issuer = "RHoSAM";
    const otpauthUrl = `otpauth://totp/${issuer}:${req.user.email}?secret=${base32Secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
    // Generate 8 backup codes
    const backupCodes = [];
    for (let i = 0; i < 8; i++) {
      const code = crypto.randomBytes(4).toString("hex").toUpperCase().replace(/(.{4})/g, "$1-").slice(0, 9);
      const codeHash = await bcrypt.hash(code, 8);
      await pool.query("INSERT INTO mfa_backup_codes(user_id,code_hash) VALUES($1,$2)", [req.user.id, codeHash]);
      backupCodes.push(code);
    }
    await audit(pool, req.user.id, "MFA_SETUP", "USER", req.user.id, {}, req);
    res.json({ secret: base32Secret, otpauthUrl, backupCodes, message: "Scan the QR code with your authenticator app, then verify with a code to activate." });
  } catch (e) { next(e); }
});

app.post("/api/auth/mfa/verify", auth, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: "Verification code required." });
    const { rows } = await pool.query("SELECT mfa_secret FROM users WHERE id=$1", [req.user.id]);
    const secret = rows[0]?.mfa_secret;
    if (!secret) return res.status(400).json({ message: "MFA not set up. Run /api/auth/mfa/setup first." });
    // Simple TOTP verification (6-digit code, 30s window)
    const crypto = require("crypto");
    const now = Math.floor(Date.now() / 30000);
    let valid = false;
    for (const offset of [-1, 0, 1]) {
      const hmac = crypto.createHmac("sha1", Buffer.from(secret, "hex"));
      const time = Buffer.alloc(8);
      time.writeUInt32BE(0, 0); time.writeUInt32BE(now + offset, 4);
      hmac.update(time);
      const hash = hmac.digest();
      const offset2 = hash[hash.length - 1] & 0x0f;
      const otp = ((hash[offset2] & 0x7f) << 24 | (hash[offset2 + 1] & 0xff) << 16 | (hash[offset2 + 2] & 0xff) << 8 | (hash[offset2 + 3] & 0xff)) % 1000000;
      if (String(otp).padStart(6, "0") === String(code).padStart(6, "0")) { valid = true; break; }
    }
    // Check backup codes if TOTP failed
    if (!valid) {
      const { rows: codes } = await pool.query("SELECT id,code_hash FROM mfa_backup_codes WHERE user_id=$1 AND used=FALSE", [req.user.id]);
      for (const bc of codes) {
        if (await bcrypt.compare(code, bc.code_hash)) {
          valid = true;
          await pool.query("UPDATE mfa_backup_codes SET used=TRUE WHERE id=$1", [bc.id]);
          break;
        }
      }
    }
    if (!valid) return res.status(401).json({ message: "Invalid verification code." });
    await pool.query("UPDATE users SET mfa_enabled=TRUE WHERE id=$1", [req.user.id]);
    await audit(pool, req.user.id, "MFA_ENABLED", "USER", req.user.id, {}, req);
    res.json({ message: "MFA activated successfully." });
  } catch (e) { next(e); }
});

app.post("/api/auth/mfa/disable", auth, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: "Password required to disable MFA." });
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash)))
      return res.status(401).json({ message: "Incorrect password." });
    await pool.query("UPDATE users SET mfa_enabled=FALSE,mfa_secret=NULL WHERE id=$1", [req.user.id]);
    await pool.query("DELETE FROM mfa_backup_codes WHERE user_id=$1", [req.user.id]);
    await audit(pool, req.user.id, "MFA_DISABLED", "USER", req.user.id, {}, req);
    res.json({ message: "MFA disabled." });
  } catch (e) { next(e); }
});

app.get("/api/auth/mfa/status", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT mfa_enabled FROM users WHERE id=$1", [req.user.id]);
    res.json({ mfaEnabled: rows[0]?.mfa_enabled || false });
  } catch (e) { next(e); }
});

// ── MFA Backup PDF Builder (zero-dependency) ────────────────────
function buildMfaBackupPDF(userName, userEmail, secret, backupCodes) {
  const lines = [];
  const add = (text, opts = {}) => lines.push({ text, ...opts });
  const center = (text, opts = {}) => lines.push({ text, align: "center", ...opts });
  const hr = () => center("────────────────────────────────────────", { leading: 8 });

  center("RHoSAM SUPERMARKET", { size: 18, bold: true, leading: 22 });
  center("Multi-Factor Authentication Backup Sheet", { size: 11, leading: 14 });
  hr();
  add("", { leading: 6 });

  add(`User: ${userName}`, { leading: 13 });
  add(`Email: ${userEmail}`, { leading: 13 });
  add(`Generated: ${new Date().toLocaleString("en-NG")}`, { leading: 13 });
  add("", { leading: 8 });

  add("SECRET KEY", { bold: true, size: 12, leading: 16 });
  hr();
  add("Scan the QR code in your authenticator app, or enter", { leading: 13 });
  add("this secret key manually:", { leading: 13 });
  add("", { leading: 4 });
  add(secret, { size: 9, leading: 12 });
  add("", { leading: 10 });

  add("BACKUP CODES", { bold: true, size: 12, leading: 16 });
  hr();
  add("Each code can only be used ONCE. Use these if you lose", { leading: 13 });
  add("access to your authenticator app.", { leading: 13 });
  add("", { leading: 4 });

  for (let i = 0; i < backupCodes.length; i += 2) {
    const left = `${String(i + 1).padStart(2, " ")}. ${backupCodes[i]}`;
    const right = i + 1 < backupCodes.length ? `${String(i + 2).padStart(2, " ")}. ${backupCodes[i + 1]}` : "";
    add(`${left.padEnd(28)}${right}`, { size: 10, leading: 14 });
  }

  add("", { leading: 10 });
  add("INSTRUCTIONS", { bold: true, size: 12, leading: 16 });
  hr();
  add("1. Install Google Authenticator or Authy on your phone", { leading: 13 });
  add("2. Add a new account and enter the secret key above", { leading: 13 });
  add("3. The app generates a 6-digit code every 30 seconds", { leading: 13 });
  add("4. Enter that code on the RHoSAM setup screen to verify", { leading: 13 });
  add("5. Store this sheet in a secure location (locked safe)", { leading: 13 });
  add("", { leading: 10 });

  hr();
  add("WARNING: This document contains sensitive security data.", { size: 9, leading: 12 });
  add("Do not share. Destroy after MFA is disabled.", { size: 9, leading: 12 });

  // Build minimal PDF
  const pageW = 595, pageH = 842, margin = 40;
  const objects = [];
  let objNum = 1;
  function addObj(content) { objects.push(content); return objNum++; }
  addObj("<< /Type /Catalog /Pages 2 0 R >>");
  addObj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`);

  let stream = "BT\n";
  let y = pageH - margin;
  for (const line of lines) {
    if (y < margin + 30) break;
    const text = line.text || "";
    const size = line.size || 10;
    const bold = line.bold || false;
    const align = line.align || "left";
    stream += `/F1 ${size} Tf\n`;
    let x;
    if (align === "center") { const tw = text.length * size * 0.5; x = pageW / 2 - tw / 2; }
    else if (align === "right") { const tw = text.length * size * 0.5; x = pageW - margin - tw; }
    else x = margin;
    const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    if (bold) {
      stream += `1 0 0 1 ${x} ${y} Tm\n(${escaped}) Tj\n`;
      stream += `1 0 0 1 ${x + 0.3} ${y} Tm\n(${escaped}) Tj\n`;
    } else {
      stream += `1 0 0 1 ${x} ${y} Tm\n(${escaped}) Tj\n`;
    }
    y -= line.leading || 14;
  }
  stream += "ET\n";
  const streamLength = stream.length;
  addObj(`<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`);
  addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  const offsets = [];
  let pdf = "%PDF-1.4\n";
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += String(off).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

app.post("/api/auth/mfa/email-backup", auth, async (req, res, next) => {
  try {
    if (!resend) return res.status(503).json({ message: "Email not configured. Add RESEND_API_KEY to .env" });
    const { secret, backupCodes } = req.body;
    if (!secret || !Array.isArray(backupCodes) || !backupCodes.length)
      return res.status(400).json({ message: "secret and backupCodes required." });
    const { rows } = await pool.query("SELECT name, email FROM users WHERE id=$1", [req.user.id]);
    const user = rows[0];
    if (!user?.email) return res.status(400).json({ message: "No email on file." });
    const codesHTML = backupCodes.map((c, i) =>
      `<tr><td style="padding:6px 12px;border:1px solid #e5e7eb;font-family:monospace;font-size:14px">${i + 1}.</td><td style="padding:6px 12px;border:1px solid #e5e7eb;font-family:monospace;font-size:14px;letter-spacing:0.1em">${c}</td></tr>`
    ).join("");
    const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px">
      <div style="background:#16a34a;color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="margin:0;font-size:22px">🛡️ MFA Backup Codes</h1>
        <p style="margin:6px 0 0;opacity:0.9;font-size:14px">Keep these codes safe — you'll need them if you lose your authenticator</p>
      </div>
      <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
        <p style="margin:0 0 16px;color:#374151">Hi ${user.name},</p>
        <p style="margin:0 0 16px;color:#374151">Your Multi-Factor Authentication has been enabled on RHoSAM Supermarket POS. Below are your backup codes and secret key. Store them in a secure location.</p>
        <h2 style="margin:0 0 8px;font-size:16px;color:#374151;border-bottom:2px solid #e5e7eb;padding-bottom:8px">🔑 Secret Key</h2>
        <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-family:monospace;font-size:14px;word-break:break-all;margin-bottom:20px">${secret}</div>
        <h2 style="margin:0 0 8px;font-size:16px;color:#374151;border-bottom:2px solid #e5e7eb;padding-bottom:8px">🔐 Backup Codes</h2>
        <p style="margin:0 0 8px;color:#666;font-size:13px">Each code can only be used once. Use these if you lose access to your authenticator app.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <thead><tr style="background:#e5e7eb"><th style="padding:8px 12px;text-align:left;border:1px solid #d1d5db;font-size:13px">#</th><th style="padding:8px 12px;text-align:left;border:1px solid #d1d5db;font-size:13px">Code</th></tr></thead>
          <tbody>${codesHTML}</tbody>
        </table>
        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin-bottom:20px;font-size:13px;color:#92400e">
          <strong>⚠️ Important:</strong> Store these codes in a password manager or a locked safe. Do not share them with anyone. Each code works only once.
        </div>
        <h2 style="margin:0 0 8px;font-size:16px;color:#374151;border-bottom:2px solid #e5e7eb;padding-bottom:8px">📋 How to use</h2>
        <ol style="color:#374151;font-size:13px;line-height:1.8;padding-left:20px;margin:0">
          <li>Install <strong>Google Authenticator</strong> or <strong>Authy</strong> on your phone</li>
          <li>Add a new account and scan the QR code (or enter the secret key above)</li>
          <li>Enter the 6-digit code shown in the app to verify</li>
          <li>Save this email — you'll need the backup codes if you lose your phone</li>
        </ol>
      </div>
      <div style="text-align:center;padding:16px;color:#9ca3af;font-size:12px">
        RHoSAM Supermarket POS • MFA Backup — ${new Date().toLocaleString("en-NG")}
        <br />This is a confidential security document. Do not forward this email.
      </div>
    </div>`;
    // Generate PDF attachment
    const pdfBuffer = buildMfaBackupPDF(user.name, user.email, secret, backupCodes);
    const pdfBase64 = pdfBuffer.toString("base64");

    const { error } = await resend.emails.send({
      from: "RHoSAM Security <onboarding@resend.dev>",
      to: user.email,
      subject: "🛡️ RHoSAM — Your MFA Backup Codes",
      html,
      attachments: [{
        filename: `rhosam-mfa-backup-${new Date().toISOString().slice(0,10)}.pdf`,
        content: pdfBase64,
        contentType: "application/pdf",
      }],
    });
    if (error) { console.error("[EMAIL MFA]", error); return res.status(500).json({ message: error.message || "Failed to send email." }); }
    await audit(pool, req.user.id, "EMAIL_MFA_BACKUP", "USER", req.user.id, {}, req);
    res.json({ message: "MFA backup codes sent to your email with PDF attachment." });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 8: USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

app.get("/api/users", auth, allow("ADMIN"), async (q, r, n) => {
  try {
    let sql = `SELECT u.id,u.name,u.email,u.role,u.is_active,u.failed_login_attempts,u.locked_until,u.last_login_at,u.created_at,
              u.branch_id, b.name AS branch_name
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id`;
    const params = [];
    const conditions = [];
    // Branch admins can only see users in their branch; super-admin sees all (with optional filter)
    if (q.user.branchId) {
      params.push(q.user.branchId);
      conditions.push(`u.branch_id = $${params.length}`);
    } else if (q.query.branchId) {
      params.push(Number(q.query.branchId));
      conditions.push(`u.branch_id = $${params.length}`);
    }
    if (conditions.length) sql += ` WHERE ` + conditions.join(` AND `);
    sql += ` ORDER BY u.name`;
    r.json((await pool.query(sql, params)).rows);
  } catch (e) { n(e); }
});

app.post("/api/users", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const { name, email, password, role, branchId } = req.body;
    if (!name || !email || String(password).length < 8 || !["ADMIN", "MANAGER", "CASHIER"].includes(role))
      return res.status(400).json({ message: "Name, valid email, role and password (min 8 chars) required." });
    // Branch admins can only create users in their own branch
    const effectiveBranchId = req.user.branchId || branchId || null;
    if (req.user.branchId && branchId && Number(branchId) !== req.user.branchId)
      return res.status(403).json({ message: "Branch admins can only create users for their own branch." });
    // Branch admins cannot create other ADMIN users
    if (req.user.branchId && role === "ADMIN")
      return res.status(403).json({ message: "Branch admins cannot create other admin users. Contact super-admin." });
    const hash = await bcrypt.hash(password, saltRounds);
    const { rows } = await pool.query(
      "INSERT INTO users(name,email,password_hash,role,branch_id) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,is_active,branch_id",
      [name, String(email).trim().toLowerCase(), hash, role, effectiveBranchId]
    );
    await audit(pool, req.user.id, "CREATE", "USER", rows[0].id, { name: rows[0].name, email: rows[0].email, role, branchId: effectiveBranchId }, req);
    res.status(201).json(rows[0]);
  } catch (e) { e.code === "23505" ? res.status(409).json({ message: "Email already exists." }) : next(e); }
});

app.patch("/api/users/:id", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    // Branch admins can only modify users in their own branch
    if (req.user.branchId) {
      const { rows: targetUser } = await pool.query("SELECT branch_id, role FROM users WHERE id=$1", [id]);
      if (!targetUser[0]) return res.status(404).json({ message: "User not found." });
      if (targetUser[0].branch_id !== req.user.branchId)
        return res.status(403).json({ message: "Branch admins can only modify users in their own branch." });
      // Branch admins cannot promote users to ADMIN
      if (req.body.role === "ADMIN" && targetUser[0].role !== "ADMIN")
        return res.status(403).json({ message: "Branch admins cannot promote users to admin. Contact super-admin." });
      // Branch admins cannot move users to a different branch
      if (req.body.branchId !== undefined && req.body.branchId !== targetUser[0].branch_id)
        return res.status(403).json({ message: "Branch admins cannot move users to another branch. Contact super-admin." });
    }
    const { name, email, password, role, isActive, unlock, branchId } = req.body;
    if (id === req.user.id && isActive === false)
      return res.status(400).json({ message: "You cannot deactivate your own account." });

    // Build dynamic update query
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (name !== undefined) { updates.push(`name=$${paramIdx++}`); params.push(name); }
    if (email !== undefined) {
      const trimmed = String(email).trim().toLowerCase();
      if (!trimmed) return res.status(400).json({ message: "Email cannot be empty." });
      updates.push(`email=$${paramIdx++}`); params.push(trimmed);
    }
    if (password !== undefined) {
      if (String(password).length < 8)
        return res.status(400).json({ message: "Password must be at least 8 characters." });
      const hash = await bcrypt.hash(password, saltRounds);
      updates.push(`password_hash=$${paramIdx++}`);
      updates.push(`password_changed_at=NOW()`);
      updates.push(`password_expires_at=NOW()+INTERVAL '90 days'`);
      params.push(hash);
    }
    if (role !== undefined) { updates.push(`role=$${paramIdx++}`); params.push(role); }
    if (isActive !== undefined) {
      updates.push(`is_active=$${paramIdx++}`); params.push(isActive);
    }
    if (unlock) {
      updates.push(`failed_login_attempts=0`);
      updates.push(`locked_until=NULL`);
    }
    if (branchId !== undefined) {
      updates.push(`branch_id=$${paramIdx++}`);
      params.push(branchId || null);
    }

    if (!updates.length) return res.status(400).json({ message: "No fields to update." });

    updates.push(`updated_at=NOW()`);
    params.push(id);

    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(",")} WHERE id=$${paramIdx}
       RETURNING id,name,email,role,is_active,locked_until,branch_id`,
      params
    );
    if (!rows[0]) return res.status(404).json({ message: "User not found." });
    await audit(pool, req.user.id, "UPDATE", "USER", id, { ...req.body, password: password ? "[REDACTED]" : undefined }, req);
    res.json(rows[0]);
  } catch (e) { e.code === "23505" ? res.status(409).json({ message: "Email already exists." }) : next(e); }
});

app.delete("/api/users/:id", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ message: "Cannot delete your own account." });
    // Branch admins can only delete users in their own branch
    if (req.user.branchId) {
      const { rows: targetUser } = await pool.query("SELECT branch_id FROM users WHERE id=$1", [id]);
      if (!targetUser[0]) return res.status(404).json({ message: "User not found." });
      if (targetUser[0].branch_id !== req.user.branchId)
        return res.status(403).json({ message: "Branch admins can only delete users in their own branch." });
    }
    // Fetch user details before deletion for audit log
    const { rows: userRows } = await pool.query("SELECT name, email, role FROM users WHERE id=$1", [id]);
    if (!userRows[0]) return res.status(404).json({ message: "User not found." });
    const deletedUser = userRows[0];
    await pool.query("UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id=$1", [id]);
    await audit(pool, req.user.id, "DELETE", "USER", id, { name: deletedUser.name, email: deletedUser.email, role: deletedUser.role }, req);
    res.json({ message: "User deleted." });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 3: PRODUCTS & INVENTORY
// ═══════════════════════════════════════════════════════════════════

// Check for duplicate product fields (real-time validation)
app.get("/api/products/check-duplicate", auth, async (req, res, next) => {
  try {
    const { field, value, excludeId } = req.query;
    if (!field || !value) return res.json({ exists: false });

    let sql, params;
    const excludeClause = excludeId ? " AND id != $3" : "";

    if (field === "barcode") {
      sql = `SELECT id, name FROM products WHERE barcode = $1${excludeClause}`;
      params = [value];
      if (excludeId) params.push(Number(excludeId));
    } else if (field === "name") {
      sql = `SELECT id, barcode FROM products WHERE LOWER(name) = LOWER($1)${excludeClause}`;
      params = [value];
      if (excludeId) params.push(Number(excludeId));
    } else {
      return res.json({ exists: false });
    }

    const { rows } = await pool.query(sql, params);
    res.json({ exists: rows.length > 0, match: rows[0] || null });
  } catch (e) { next(e); }
});

app.get("/api/products", auth, async (q, r, n) => {
  try {
    const search = q.query.search;
    // Branch admins/managers are auto-scoped to their branch; super-admin can filter via query param
    const branchId = q.user.branchId || (q.query.branchId ? Number(q.query.branchId) : null);
    // When a branch is selected, LEFT JOIN branch_inventory for per-branch stock
    let sql, params;
    if (branchId) {
      sql = `SELECT p.id, p.barcode, p.name, p.category, p.price::float, p.cost_price::float,
               COALESCE(bi.quantity, 0)::int AS stock, COALESCE(bi.reorder_level, p.reorder_level)::int AS reorder_level,
               p.unit, p.image_url, p.description, p.is_active, p.created_at
             FROM products p
             LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1`;
      params = [branchId];
      if (search) {
        sql += " WHERE LOWER(p.name) LIKE $2 OR p.barcode LIKE $2 OR LOWER(p.category) LIKE $2";
        params.push(`%${String(search).toLowerCase()}%`);
      }
    } else {
      sql = `SELECT p.id, p.barcode, p.name, p.category, p.price::float, p.cost_price::float,
               p.stock::int AS stock, p.reorder_level::int AS reorder_level,
               p.unit, p.image_url, p.description, p.is_active, p.created_at
             FROM products p`;
      params = [];
      if (search) {
        sql += " WHERE LOWER(p.name) LIKE $1 OR p.barcode LIKE $1 OR LOWER(p.category) LIKE $1";
        params.push(`%${String(search).toLowerCase()}%`);
      }
    }
    sql += " ORDER BY p.name";
    r.json((await pool.query(sql, params)).rows);
  } catch (e) { n(e); }
});

app.post("/api/products", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { barcode, name, category, price, costPrice = 0, stock = 0, reorderLevel = 5, unit = "PCS", description = "", expiryDate, batchNumber } = req.body;
    if (!barcode || !name || !category || Number(price) < 0 || Number(stock) < 0)
      return res.status(400).json({ message: "Invalid product details." });

    // Check for duplicate barcode
    const { rows: dupBarcode } = await pool.query(
      "SELECT id, name FROM products WHERE barcode = $1", [barcode]
    );
    if (dupBarcode[0]) {
      return res.status(409).json({
        message: `Barcode "${barcode}" already exists for product "${dupBarcode[0].name}".`,
        field: "barcode",
        existingProduct: dupBarcode[0]
      });
    }

    // Check for duplicate name (case-insensitive)
    const { rows: dupName } = await pool.query(
      "SELECT id, barcode FROM products WHERE LOWER(name) = LOWER($1)", [name]
    );
    if (dupName[0]) {
      return res.status(409).json({
        message: `Product name "${name}" already exists (barcode: ${dupName[0].barcode}).`,
        field: "name",
        existingProduct: dupName[0]
      });
    }

    // Check for duplicate category (warn, don't block)
    const { rows: existingCategory } = await pool.query(
      "SELECT id FROM products WHERE LOWER(category) = LOWER($1) LIMIT 1", [category]
    );
    const categoryExists = existingCategory.length > 0;

    const { rows } = await pool.query(
      `INSERT INTO products(barcode,name,category,price,cost_price,stock,reorder_level,unit,description,image_url,expiry_date,batch_number)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id,barcode,name,category,price::float,cost_price::float,stock,reorder_level,unit,image_url,description,is_active,expiry_date,batch_number`,
      [barcode, name, category, price, costPrice, stock, reorderLevel, unit, description, req.body.imageUrl || null, expiryDate || null, batchNumber || null]
    );
    // Create branch_inventory entry if user is branch-scoped
    if (req.user.branchId) {
      await pool.query(
        `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
         VALUES($1, $2, $3, $4)
         ON CONFLICT (branch_id, product_id)
         DO UPDATE SET quantity = $3, reorder_level = $4, updated_at = NOW()`,
        [req.user.branchId, rows[0].id, Number(stock) || 0, Number(reorderLevel) || 5]
      );
    }
    await audit(pool, req.user.id, "CREATE", "PRODUCT", rows[0].id, { barcode, name, category }, req);
    const warnings = [];
    if (categoryExists) warnings.push(`Category "${category}" already has other products.`);
    res.status(201).json({ ...rows[0], warnings });
  } catch (e) { next(e); }
});

app.put("/api/products/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    // BRANCH SCOPING: Branch admins/managers can only update stock & reorder level
    // for products in their branch (via branch_inventory). Only super-admin can
    // edit global product fields (name, price, category, etc.) that affect all branches.
    if (isBranchAdmin(req) || (req.user.role === 'MANAGER' && req.user.branchId)) {
      const { barcode, name, category, price, costPrice, description, isActive, expiryDate, batchNumber } = req.body;
      const hasGlobalField = barcode || name || category || price != null || costPrice != null || description !== undefined || isActive !== undefined || expiryDate || batchNumber;
      if (hasGlobalField) {
        return res.status(403).json({
          message: "Branch admins/managers can only update stock & reorder level for their branch. Contact super-admin to edit product details (name, price, category, etc.)."
        });
      }
      // Branch-scoped: only update branch_inventory
      const { stock, reorderLevel } = req.body;
      const branchId = req.user.branchId;
      if (stock == null && reorderLevel == null)
        return res.status(400).json({ message: "Provide stock or reorderLevel to update." });
      if (stock != null) {
        await pool.query(
          `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
           VALUES($1, $2, $3, (SELECT reorder_level FROM products WHERE id = $2))
           ON CONFLICT (branch_id, product_id)
           DO UPDATE SET quantity = $3, updated_at = NOW()`,
          [branchId, id, Number(stock)]
        );
      }
      if (reorderLevel != null) {
        await pool.query(
          `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
           VALUES($1, $2, (SELECT COALESCE(quantity, 0) FROM branch_inventory WHERE branch_id = $1 AND product_id = $2), $3)
           ON CONFLICT (branch_id, product_id)
           DO UPDATE SET reorder_level = $3, updated_at = NOW()`,
          [branchId, id, Number(reorderLevel)]
        );
      }
      const { rows } = await pool.query(
        `SELECT p.id, p.name, p.category, p.unit,
               COALESCE(bi.quantity, 0)::int AS quantity,
               COALESCE(bi.reorder_level, p.reorder_level)::int AS reorder_level,
               bi.updated_at AS last_updated
         FROM products p
         LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
         WHERE p.id = $2`, [branchId, id]
      );
      await audit(pool, req.user.id, "UPDATE", "BRANCH_INVENTORY", id, { branchId, stock, reorderLevel }, req);
      return res.json(rows[0] || { message: "Stock updated." });
    }

    // SUPER-ADMIN: full product update (affects all branches)
    const { barcode, name, category, price, costPrice, stock, reorderLevel, unit, description, isActive, expiryDate, batchNumber } = req.body;

    // Check for duplicate barcode (excluding current product)
    if (barcode) {
      const { rows: dupBarcode } = await pool.query(
        "SELECT id, name FROM products WHERE barcode = $1 AND id != $2", [barcode, id]
      );
      if (dupBarcode[0]) {
        return res.status(409).json({
          message: `Barcode "${barcode}" already exists for product "${dupBarcode[0].name}".`,
          field: "barcode"
        });
      }
    }

    // Check for duplicate name (excluding current product)
    if (name) {
      const { rows: dupName } = await pool.query(
        "SELECT id, barcode FROM products WHERE LOWER(name) = LOWER($1) AND id != $2", [name, id]
      );
      if (dupName[0]) {
        return res.status(409).json({
          message: `Product name "${name}" already exists (barcode: ${dupName[0].barcode}).`,
          field: "name"
        });
      }
    }

    const { rows } = await pool.query(
      `UPDATE products SET
        barcode=COALESCE($1,barcode), name=COALESCE($2,name), category=COALESCE($3,category),
        price=COALESCE($4,price), cost_price=COALESCE($5,cost_price), stock=COALESCE($6,stock),
        reorder_level=COALESCE($7,reorder_level), unit=COALESCE($8,unit),
        description=COALESCE($9,description), is_active=COALESCE($10,is_active),
        image_url=COALESCE($12,image_url), expiry_date=COALESCE($13,expiry_date), batch_number=COALESCE($14,batch_number),
        updated_at=NOW()
       WHERE id=$11
       RETURNING id,barcode,name,category,price::float,cost_price::float,stock,reorder_level,unit,image_url,description,is_active,expiry_date,batch_number`,
      [barcode, name, category, price, costPrice, stock, reorderLevel, unit, description, isActive, id, req.body.imageUrl ?? null, expiryDate || null, batchNumber || null]
    );
    if (!rows[0]) return res.status(404).json({ message: "Product not found." });
    await audit(pool, req.user.id, "UPDATE", "PRODUCT", id, req.body, req);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.delete("/api/products/:id", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rowCount } = await pool.query("DELETE FROM products WHERE id=$1", [id]);
    if (rowCount === 0) return res.status(404).json({ message: "Product not found." });
    await audit(pool, req.user.id, "DELETE", "PRODUCT", id, {}, req);
    res.json({ message: "Product deleted." });
  } catch (e) { next(e); }
});

// ── Product Image Upload ───────────────────────────────────────
app.post("/api/products/:id/image", auth, allow("ADMIN", "MANAGER"), (req, res, next) => {
  upload.single("image")(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    if (!req.file) return res.status(400).json({ message: "No image file provided." });
    try {
      const id = Number(req.params.id);
      let imageUrl;

      if (useCloudinary) {
        // Upload to Cloudinary
        const b64 = fs.readFileSync(req.file.path).toString("base64");
        const dataUri = `data:${req.file.mimetype};base64,${b64}`;
        const result = await cloudinary.uploader.upload(dataUri, {
          folder: "rhosam/products",
          public_id: `product-${id}-${Date.now()}`,
          transformation: [{ width: 800, height: 800, crop: "limit", quality: "auto" }],
        });
        imageUrl = result.secure_url;
        // Delete local temp file
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } else {
        // Local storage fallback
        imageUrl = `/uploads/${req.file.filename}`;
      }

      // Delete old image if exists (skip for Cloudinary URLs)
      const { rows } = await pool.query("SELECT image_url FROM products WHERE id=$1", [id]);
      if (rows[0]?.image_url && !rows[0].image_url.startsWith("http")) {
        const oldPath = path.join(__dirname, "..", rows[0].image_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      await pool.query("UPDATE products SET image_url=$1, updated_at=NOW() WHERE id=$2", [imageUrl, id]);
      await audit(pool, req.user.id, "UPLOAD_IMAGE", "PRODUCT", id, { imageUrl }, req);
      res.json({ imageUrl });
    } catch (e) { next(e); }
  });
});

app.post("/api/products/:id/adjust", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { quantity, type, notes } = req.body;
    if (!["STOCK_IN", "STOCK_OUT", "ADJUSTMENT"].includes(type))
      return res.status(400).json({ message: "Invalid movement type." });
    const qty = Number(quantity);
    const adj = type === "STOCK_OUT" ? -Math.abs(qty) : Math.abs(qty);
    await pool.query("UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2", [adj, id]);
    // Also upsert branch_inventory if user is assigned to a branch
    if (req.user.branchId) {
      await pool.query(
        `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
         VALUES($2, $3, GREATEST(0, $1), (SELECT reorder_level FROM products WHERE id = $3))
         ON CONFLICT (branch_id, product_id)
         DO UPDATE SET quantity = GREATEST(0, branch_inventory.quantity + $1), updated_at = NOW()`,
        [adj, req.user.branchId, id]
      );
    }
    await pool.query(
      "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,$2,$3,$4,$5,$6)",
      [id, type, adj, `ADJ-${Date.now()}`, req.user.id, notes || ""]
    );
    // Return updated stock from branch_inventory or products
    let updatedStock = null;
    if (req.user.branchId) {
      const { rows: bi } = await pool.query(
        "SELECT quantity FROM branch_inventory WHERE branch_id=$1 AND product_id=$2",
        [req.user.branchId, id]
      );
      updatedStock = bi[0]?.quantity ?? null;
    }
    if (updatedStock === null) {
      const { rows: p } = await pool.query("SELECT stock FROM products WHERE id=$1", [id]);
      updatedStock = p[0]?.stock ?? 0;
    }
    await audit(pool, req.user.id, "ADJUST_STOCK", "PRODUCT", id, { type, qty: adj }, req);
    res.json({ message: "Stock adjusted.", stock: updatedStock });
  } catch (e) { next(e); }
});

app.get("/api/inventory/movements", auth, async (q, r, n) => {
  try {
    const productId = q.query.product_id;
    const branchId = q.query.branchId ? Number(q.query.branchId) : q.user.branchId;
    const pageSize = Math.min(Number(q.query.limit) || 50, 200);
    let sql = `SELECT im.*, p.name AS product_name, u.name AS user_name
               FROM inventory_movements im
               JOIN products p ON p.id = im.product_id
               LEFT JOIN users u ON u.id = im.user_id`;
    const conditions = [];
    const params = [];
    if (productId) { params.push(Number(productId)); conditions.push(`im.product_id = $${params.length}`); }
    // Filter by branch (admin can select via query param, others scoped to their branch)
    if (branchId) {
      params.push(branchId);
      conditions.push(`(im.product_id IN (SELECT product_id FROM branch_inventory WHERE branch_id = $${params.length}) OR im.user_id IN (SELECT id FROM users WHERE branch_id = $${params.length}))`);
    }
    // Cursor-based pagination
    if (q.query.cursor) {
      const cursor = JSON.parse(q.query.cursor);
      conditions.push(`(im.created_at, im.id) < ($${params.length + 1}, $${params.length + 2})`);
      params.push(cursor.ts, cursor.id);
    }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    const fetchLimit = pageSize + 1;
    sql += ` ORDER BY im.created_at DESC, im.id DESC LIMIT $${params.length + 1}`;
    params.push(fetchLimit);
    const { rows } = await pool.query(sql, params);
    const hasMore = rows.length > pageSize;
    const data = hasMore ? rows.slice(0, pageSize) : rows;
    const nextCursor = hasMore ? { ts: data[data.length - 1].created_at, id: data[data.length - 1].id } : null;
    r.json({ data, nextCursor, hasMore });
  } catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// DAMAGES & WASTAGE (record stock losses)
// ═══════════════════════════════════════════════════════════════════
app.post("/api/inventory/damage", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { productId, quantity, reason } = req.body;
    const qty = Math.abs(Number(quantity));
    if (!productId || !qty || qty < 1)
      return res.status(400).json({ message: "Product and valid quantity required." });

    await client.query("BEGIN");
    const { rows } = await client.query("SELECT id, name, stock FROM products WHERE id=$1 FOR UPDATE", [productId]);
    const product = rows[0];
    if (!product) throw Object.assign(new Error("Product not found."), { status: 404 });

    // Check branch stock if assigned
    if (req.user.branchId) {
      const { rows: bi } = await client.query(
        "SELECT quantity FROM branch_inventory WHERE branch_id=$1 AND product_id=$2 FOR UPDATE",
        [req.user.branchId, productId]
      );
      const branchQty = bi[0]?.quantity ?? product.stock;
      if (branchQty < qty)
        throw Object.assign(new Error(`Insufficient stock for ${product.name}. Available: ${branchQty}`), { status: 409 });
      await client.query(
        `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
         VALUES($2, $3, 0, (SELECT reorder_level FROM products WHERE id = $3))
         ON CONFLICT (branch_id, product_id)
         DO UPDATE SET quantity = GREATEST(0, branch_inventory.quantity - $1), updated_at = NOW()`,
        [qty, req.user.branchId, productId]
      );
    } else {
      if (product.stock < qty)
        throw Object.assign(new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}`), { status: 409 });
    }

    await client.query("UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id=$2", [qty, productId]);
    const ref = `DMG-${Date.now()}`;
    await client.query(
      "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,'DAMAGED',$2,$3,$4,$5)",
      [productId, -qty, ref, req.user.id, reason || "Damage reported"]
    );
    await audit(client, req.user.id, "DAMAGE", "PRODUCT", productId, { qty, reason, ref }, req);
    await client.query("COMMIT");
    res.json({ message: `${qty} unit(s) of ${product.name} marked as damaged.`, ref });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally { client.release(); }
});

app.post("/api/inventory/wastage", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { productId, quantity, reason } = req.body;
    const qty = Math.abs(Number(quantity));
    if (!productId || !qty || qty < 1)
      return res.status(400).json({ message: "Product and valid quantity required." });

    await client.query("BEGIN");
    const { rows } = await client.query("SELECT id, name, stock FROM products WHERE id=$1 FOR UPDATE", [productId]);
    const product = rows[0];
    if (!product) throw Object.assign(new Error("Product not found."), { status: 404 });

    if (req.user.branchId) {
      const { rows: bi } = await client.query(
        "SELECT quantity FROM branch_inventory WHERE branch_id=$1 AND product_id=$2 FOR UPDATE",
        [req.user.branchId, productId]
      );
      const branchQty = bi[0]?.quantity ?? product.stock;
      if (branchQty < qty)
        throw Object.assign(new Error(`Insufficient stock for ${product.name}. Available: ${branchQty}`), { status: 409 });
      await client.query(
        `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
         VALUES($2, $3, 0, (SELECT reorder_level FROM products WHERE id = $3))
         ON CONFLICT (branch_id, product_id)
         DO UPDATE SET quantity = GREATEST(0, branch_inventory.quantity - $1), updated_at = NOW()`,
        [qty, req.user.branchId, productId]
      );
    } else {
      if (product.stock < qty)
        throw Object.assign(new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}`), { status: 409 });
    }

    await client.query("UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id=$2", [qty, productId]);
    const ref = `WST-${Date.now()}`;
    await client.query(
      "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,'WASTAGE',$2,$3,$4,$5)",
      [productId, -qty, ref, req.user.id, reason || "Waste recorded"]
    );
    await audit(client, req.user.id, "WASTAGE", "PRODUCT", productId, { qty, reason, ref }, req);
    await client.query("COMMIT");
    res.json({ message: `${qty} unit(s) of ${product.name} marked as waste.`, ref });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// STOCK VALUATION
// ═══════════════════════════════════════════════════════════════════
app.get("/api/inventory/valuation", auth, async (req, res, next) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : req.user.branchId;
    let sql, params;
    if (branchId) {
      sql = `SELECT p.id, p.barcode, p.name, p.category, p.unit,
                   COALESCE(bi.quantity, 0)::int AS stock, p.cost_price::float,
                   COALESCE(bi.quantity, 0) * p.cost_price AS total_value,
                   COALESCE(bi.reorder_level, p.reorder_level)::int AS reorder_level
             FROM products p
             LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
             WHERE p.is_active = TRUE
             ORDER BY p.category, p.name`;
      params = [branchId];
    } else {
      sql = `SELECT p.id, p.barcode, p.name, p.category, p.unit,
                   p.stock::int, p.cost_price::float,
                   p.stock * p.cost_price AS total_value, p.reorder_level
             FROM products p
             WHERE p.is_active = TRUE
             ORDER BY p.category, p.name`;
      params = [];
    }
    const { rows } = await pool.query(sql, params);
    // Compute summary
    const totalProducts = rows.length;
    const totalUnits = rows.reduce((s, r) => s + r.stock, 0);
    const totalValue = rows.reduce((s, r) => s + Number(r.total_value || 0), 0);
    const byCategory = {};
    rows.forEach(r => {
      if (!byCategory[r.category]) byCategory[r.category] = { units: 0, value: 0 };
      byCategory[r.category].units += r.stock;
      byCategory[r.category].value += Number(r.total_value || 0);
    });
    res.json({ products: rows, summary: { totalProducts, totalUnits, totalValue, byCategory } });
  } catch (e) { next(e); }
});

// Capture a valuation snapshot for trend tracking
app.post("/api/inventory/snapshot", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : req.user.branchId;
    let sql, params;
    if (branchId) {
      sql = `SELECT p.id, p.name, p.category, p.unit,
                   COALESCE(bi.quantity, 0)::int AS stock, p.cost_price::float,
                   COALESCE(bi.quantity, 0) * p.cost_price AS total_value
             FROM products p
             LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
             WHERE p.is_active = TRUE`;
      params = [branchId];
    } else {
      sql = `SELECT p.id, p.name, p.category, p.unit,
                   p.stock::int, p.cost_price::float,
                   p.stock * p.cost_price AS total_value
             FROM products p WHERE p.is_active = TRUE`;
      params = [];
    }
    const { rows } = await pool.query(sql, params);
    const totalProducts = rows.length;
    const totalUnits = rows.reduce((s, r) => s + r.stock, 0);
    const totalValue = rows.reduce((s, r) => s + Number(r.total_value || 0), 0);
    const byCategory = {};
    rows.forEach(r => {
      if (!byCategory[r.category]) byCategory[r.category] = { units: 0, value: 0 };
      byCategory[r.category].units += r.stock;
      byCategory[r.category].value += Number(Number(r.total_value || 0).toFixed(2));
    });
    const { rows: snap } = await pool.query(
      `INSERT INTO valuation_snapshots(branch_id, total_products, total_units, total_value, category_breakdown, captured_by)
       VALUES($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [branchId || null, totalProducts, totalUnits, totalValue, JSON.stringify(byCategory), req.user.id]
    );
    await audit(pool, req.user.id, "SNAPSHOT", "VALUATION", snap[0].id, { totalValue, totalProducts }, req);
    res.json({ message: "Snapshot captured.", snapshot: snap[0], summary: { totalProducts, totalUnits, totalValue, byCategory } });
  } catch (e) { next(e); }
});

// Get valuation trend history
app.get("/api/inventory/trend", auth, async (req, res, next) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : req.user.branchId;
    const days = Math.min(Number(req.query.days) || 30, 365);
    let sql, params;
    if (branchId) {
      sql = `SELECT id, branch_id, total_products, total_units, total_value, category_breakdown, created_at
             FROM valuation_snapshots
             WHERE branch_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
             ORDER BY created_at ASC`;
      params = [branchId, days];
    } else {
      sql = `SELECT id, branch_id, total_products, total_units, total_value, category_breakdown, created_at
             FROM valuation_snapshots
             WHERE created_at >= NOW() - INTERVAL '1 day' * $1
             ORDER BY created_at ASC`;
      params = [days];
    }
    const { rows } = await pool.query(sql, params);
    // Compute deltas and collect all categories
    const allCategories = new Set();
    rows.forEach(r => {
      const bd = typeof r.category_breakdown === 'string' ? JSON.parse(r.category_breakdown) : (r.category_breakdown || {});
      Object.keys(bd).forEach(c => allCategories.add(c));
    });
    const trend = rows.map((r, i) => {
      const prev = i > 0 ? rows[i - 1] : null;
      const bd = typeof r.category_breakdown === 'string' ? JSON.parse(r.category_breakdown) : (r.category_breakdown || {});
      // Build category values for this snapshot (0 for missing categories)
      const categoryValues = {};
      for (const cat of allCategories) {
        categoryValues[cat] = Number(bd[cat]?.value || 0);
      }
      return {
        id: r.id,
        date: r.created_at,
        totalProducts: r.total_products,
        totalUnits: r.total_units,
        totalValue: Number(r.total_value),
        categoryBreakdown: bd,
        categoryValues,
        delta: prev ? {
          units: r.total_units - prev.total_units,
          value: Number((r.total_value - prev.total_value).toFixed(2)),
          products: r.total_products - prev.total_products,
        } : null,
      };
    });
    // Compute category-level deltas
    const categoryDeltas = {};
    for (const cat of allCategories) {
      categoryDeltas[cat] = trend.map((t, i) => {
        const prev = i > 0 ? trend[i - 1] : null;
        return prev ? Number((t.categoryValues[cat] - prev.categoryValues[cat]).toFixed(2)) : 0;
      });
    }
    res.json({ trend, categories: [...allCategories].sort(), categoryDeltas, count: trend.length, days });
  } catch (e) { next(e); }
});

// Auto-snapshot endpoint (can be called by cron, scheduler, or admin)
app.post("/api/inventory/auto-snapshot", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    // Get all active branches (or just the global inventory if no branches)
    const { rows: branches } = await pool.query('SELECT id FROM branches WHERE is_active = TRUE');
    let snapshotsCreated = 0;

    // Capture global snapshot
    const { rows: globalProducts } = await pool.query(
      `SELECT p.id, p.name, p.category, p.unit, p.stock::int AS stock, p.cost_price::float,
              p.stock * p.cost_price AS total_value
       FROM products p WHERE p.is_active = TRUE`
    );
    if (globalProducts.length > 0) {
      const totalProducts = globalProducts.length;
      const totalUnits = globalProducts.reduce((s, r) => s + r.stock, 0);
      const totalValue = globalProducts.reduce((s, r) => s + Number(r.total_value || 0), 0);
      const byCategory = {};
      globalProducts.forEach(r => {
        if (!byCategory[r.category]) byCategory[r.category] = { units: 0, value: 0 };
        byCategory[r.category].units += r.stock;
        byCategory[r.category].value += Number(Number(r.total_value || 0).toFixed(2));
      });
      await pool.query(
        `INSERT INTO valuation_snapshots(branch_id, total_products, total_units, total_value, category_breakdown, captured_by)
         VALUES(NULL, $1, $2, $3, $4, $5)`,
        [totalProducts, totalUnits, totalValue, JSON.stringify(byCategory), req.user.id]
      );
      snapshotsCreated++;
    }

    // Capture per-branch snapshots
    for (const branch of branches) {
      const { rows: branchProducts } = await pool.query(
        `SELECT p.id, p.name, p.category, p.unit,
                COALESCE(bi.quantity, 0)::int AS stock, p.cost_price::float,
                COALESCE(bi.quantity, 0) * p.cost_price AS total_value
         FROM products p
         LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
         WHERE p.is_active = TRUE`, [branch.id]
      );
      if (branchProducts.length > 0) {
        const totalProducts = branchProducts.length;
        const totalUnits = branchProducts.reduce((s, r) => s + r.stock, 0);
        const totalValue = branchProducts.reduce((s, r) => s + Number(r.total_value || 0), 0);
        const byCategory = {};
        branchProducts.forEach(r => {
          if (!byCategory[r.category]) byCategory[r.category] = { units: 0, value: 0 };
          byCategory[r.category].units += r.stock;
          byCategory[r.category].value += Number(Number(r.total_value || 0).toFixed(2));
        });
        await pool.query(
          `INSERT INTO valuation_snapshots(branch_id, total_products, total_units, total_value, category_breakdown, captured_by)
           VALUES($1, $2, $3, $4, $5, $6)`,
          [branch.id, totalProducts, totalUnits, totalValue, JSON.stringify(byCategory), req.user.id]
        );
        snapshotsCreated++;
      }
    }

    await audit(pool, req.user.id, 'AUTO_SNAPSHOT', 'VALUATION', null, { snapshotsCreated }, req);
    res.json({ message: `Auto-snapshot complete. ${snapshotsCreated} snapshot(s) captured.`, snapshotsCreated });
  } catch (e) { next(e); }
});

app.get("/api/products/low-stock", auth, async (req, r, n) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : req.user.branchId;
    if (branchId) {
      // Branch-aware: show low stock products for this specific branch
      r.json((await pool.query(
        `SELECT p.id, p.barcode, p.name, p.category, bi.quantity::int AS stock,
                COALESCE(bi.reorder_level, p.reorder_level)::int AS reorder_level, p.price::float
         FROM products p
         JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
         WHERE p.is_active = TRUE AND bi.quantity <= COALESCE(bi.reorder_level, p.reorder_level)
         ORDER BY bi.quantity ASC`, [branchId]
      )).rows);
    } else {
      r.json((await pool.query(
        "SELECT id,barcode,name,category,stock,reorder_level,price::float FROM products WHERE stock <= reorder_level AND is_active = TRUE ORDER BY stock ASC"
      )).rows);
    }
  } catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 2: POS / SALES
// ═══════════════════════════════════════════════════════════════════

app.get("/api/sales", auth, async (req, res, next) => {
  try {
    const { from, to, cursor, search, payment, minAmount, maxAmount } = req.query;
    const pageSize = Math.min(Number(req.query.limit) || 50, 200);
    let where = [];
    let params = [];
    let paramIdx = 1;
    // Cashiers only see their own sales; branch-scoped users see branch-wide sales; super-admin sees all
    if (req.user.role === "CASHIER") { where.push(`s.cashier_id = $${paramIdx++}`); params.push(req.user.id); }
    else if (req.user.branchId) { where.push(`s.branch_id = $${paramIdx++}`); params.push(req.user.branchId); }
    else if (req.user.role === "ADMIN" && req.query.branchId) { where.push(`s.branch_id = $${paramIdx++}`); params.push(Number(req.query.branchId)); }
    // Super-admin (ADMIN without branch_id, no query param) sees all branches
    if (from) { where.push(`s.created_at >= $${paramIdx++}`); params.push(from); }
    if (to) { where.push(`s.created_at <= $${paramIdx++}`); params.push(to); }
    if (search) { where.push(`(s.customer_name ILIKE $${paramIdx} OR s.receipt_number ILIKE $${paramIdx})`); params.push(`%${search}%`); paramIdx++; }
    if (payment) { where.push(`s.payment_method = $${paramIdx++}`); params.push(payment); }
    if (minAmount) { where.push(`s.total >= $${paramIdx++}`); params.push(Number(minAmount)); }
    if (maxAmount) { where.push(`s.total <= $${paramIdx++}`); params.push(Number(maxAmount)); }
    // Cursor-based pagination: fetch one extra to determine hasMore
    if (cursor) { where.push(`(s.created_at, s.id) < ($${paramIdx++}, $${paramIdx++})`); params.push(cursor.ts, cursor.id); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const fetchLimit = pageSize + 1;
    const sql = `SELECT s.id,s.receipt_number,s.customer_name,s.payment_method,s.subtotal::float,s.discount::float,s.tax::float,
              s.total::float,s.amount_paid::float,s.status,s.created_at,s.branch_id,b.name AS branch_name,u.name AS cashier_name,
              COALESCE(SUM(si.quantity),0)::int AS item_count
       FROM sales s JOIN users u ON u.id = s.cashier_id
       LEFT JOIN branches b ON b.id = s.branch_id
       LEFT JOIN sale_items si ON si.sale_id = s.id
       ${w}
       GROUP BY s.id,u.name,b.name ORDER BY s.created_at DESC, s.id DESC LIMIT $${params.length + 1}`;
    params.push(fetchLimit);
    const result = await pool.query(sql, params);
    const rows = result.rows;
    const hasMore = rows.length > pageSize;
    const data = hasMore ? rows.slice(0, pageSize) : rows;
    const nextCursor = hasMore ? { ts: data[data.length - 1].created_at, id: data[data.length - 1].id } : null;
    res.json({ data, nextCursor, hasMore });
  } catch (e) { console.error("[SALES ERROR]", e.message, e.code); next(e); }
});

app.get("/api/sales/:id", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: saleRows } = await pool.query(
      `SELECT s.*, u.name AS cashier_name FROM sales s JOIN users u ON u.id = s.cashier_id WHERE s.id = $1`, [id]
    );
    if (!saleRows[0]) return res.status(404).json({ message: "Sale not found." });
    const { rows: items } = await pool.query("SELECT * FROM sale_items WHERE sale_id = $1", [id]);
    res.json({ ...saleRows[0], items });
  } catch (e) { next(e); }
});

app.post("/api/sales", auth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { customerName = "Walk-in Customer", customerId, paymentMethod, items, discount = 0, tax = 0, amountPaid, couponId, couponDiscount = 0, giftCardId, giftCardAmount = 0 } = req.body;
    if (!["Cash", "Card", "Transfer", "POS"].includes(paymentMethod))
      return res.status(400).json({ message: "Invalid payment method." });
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ message: "Cart is empty." });

    await client.query("BEGIN");
    let subtotal = 0;
    const details = [];

    const saleBranchId = req.user.branchId || null;
    for (const x of items) {
      const productId = Number(x.productId);
      const quantity = Number(x.quantity);
      const itemDiscount = Number(x.discount || 0);
      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1)
        throw Object.assign(new Error("Invalid sale item."), { status: 400 });

      // Check branch_inventory first, fall back to global products.stock
      let availableStock = null;
      if (saleBranchId) {
        const { rows: biRows } = await client.query(
          "SELECT quantity FROM branch_inventory WHERE branch_id=$1 AND product_id=$2 FOR UPDATE",
          [saleBranchId, productId]
        );
        availableStock = biRows[0] ? biRows[0].quantity : null;
      }
      // Fall back to global stock if no branch_inventory row exists
      const { rows } = await client.query("SELECT id,name,price::float,stock FROM products WHERE id=$1 FOR UPDATE", [productId]);
      const product = rows[0];
      if (!product) throw Object.assign(new Error("Product not found."), { status: 404 });
      if (availableStock !== null) {
        if (availableStock < quantity)
          throw Object.assign(new Error(`Insufficient stock for ${product.name}. Available: ${availableStock}`), { status: 409 });
      } else {
        if (product.stock < quantity)
          throw Object.assign(new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}`), { status: 409 });
      }

      const lineTotal = Number(product.price) * quantity - itemDiscount;
      subtotal += lineTotal;
      details.push({ productId: product.id, name: product.name, price: Number(product.price), quantity, discount: itemDiscount, lineTotal });
    }

    const total = subtotal - Number(discount) - Number(couponDiscount) - Number(giftCardAmount) + Number(tax);
    const paidRaw = amountPaid != null ? Number(amountPaid) : (total > 0 ? total : 0);
    const paid = Number.isFinite(paidRaw) && paidRaw >= 0 ? paidRaw : total;
    const change = Math.max(0, paid - total);
    const receiptNumber = `RHS-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

    const { rows } = await client.query(
      `INSERT INTO sales(receipt_number,customer_name,customer_id,payment_method,subtotal,discount,tax,total,amount_paid,change_amount,cashier_id,branch_id,coupon_id,coupon_discount,gift_card_id,gift_card_amount)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id,created_at`,
      [receiptNumber, customerName, customerId || null, paymentMethod, subtotal, discount, tax, total, paid, change, req.user.id, saleBranchId, couponId || null, couponDiscount || 0, giftCardId || null, giftCardAmount || 0]
    );
    const sale = rows[0];

    for (const item of details) {
      await client.query(
        "INSERT INTO sale_items(sale_id,product_id,product_name,unit_price,quantity,discount,line_total) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [sale.id, item.productId, item.name, item.price, item.quantity, item.discount, item.lineTotal]
      );
      // Deduct from global stock
      await client.query("UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2", [item.quantity, item.productId]);
      // Deduct from branch_inventory if branch is assigned
      if (saleBranchId) {
        await client.query(
          `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
           VALUES($2, $3, 0, (SELECT reorder_level FROM products WHERE id = $3))
           ON CONFLICT (branch_id, product_id)
           DO UPDATE SET quantity = GREATEST(0, branch_inventory.quantity - $1), updated_at = NOW()`,
          [item.quantity, saleBranchId, item.productId]
        );
      }
      await client.query(
        "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id) VALUES($1,'SALE',$2,$3,$4)",
        [item.productId, -item.quantity, receiptNumber, req.user.id]
      );
    }

    // Update customer loyalty points and auto tier
    if (customerId) {
      const points = Math.floor(total / 100); // 1 point per 100 spent
      await client.query(
        "UPDATE customers SET loyalty_points = loyalty_points + $1, total_spent = total_spent + $2, visit_count = visit_count + 1 WHERE id = $3",
        [points, total, customerId]
      );
      await updateCustomerTier(client, customerId);
    }

    // Auto-create commission record based on commission rules
    try {
      const { rows: rules } = await client.query(
        `SELECT commission_rate, min_sale_amount FROM commission_rules
         WHERE is_active = true AND (user_id = $1 OR (user_id IS NULL AND role = $2 AND (branch_id IS NULL OR branch_id = $3)))
         ORDER BY user_id NULLS LAST LIMIT 1`,
        [req.user.id, req.user.role, saleBranchId]
      );
      if (rules.length > 0 && total >= rules[0].min_sale_amount) {
        const commissionAmount = Math.round((total * rules[0].commission_rate / 100) * 100) / 100;
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        await client.query(
          `INSERT INTO sales_commissions (user_id, sale_id, sale_amount, commission_rate, commission_amount, period_start, period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.user.id, sale.id, total, rules[0].commission_rate, commissionAmount, periodStart, periodEnd]
        );
      }
    } catch (commErr) { console.error('[COMMISSION] Auto-creation failed:', commErr.message); }

    await audit(client, req.user.id, "CREATE", "SALE", sale.id, { receiptNumber, total }, req);
    await client.query("COMMIT");

    res.status(201).json({
      id: sale.id, receiptNumber, createdAt: sale.created_at, customerName, paymentMethod,
      cashierName: req.user.name, items: details, subtotal, discount, tax, total, amountPaid: paid, change, change_amount: change
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally { client.release(); }
});

// Returns
app.post("/api/sales/:id/return", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const saleId = Number(req.params.id);
    const { productId, quantity, reason } = req.body;
    const { rows: saleRows } = await client.query("SELECT * FROM sales WHERE id=$1", [saleId]);
    if (!saleRows[0]) return res.status(404).json({ message: "Sale not found." });
    // Branch scoping: MANAGERs can only return sales from their own branch
    if (req.user.role === "MANAGER" && req.user.branchId && saleRows[0].branch_id !== req.user.branchId)
      return res.status(403).json({ message: "Cannot process returns for sales from another branch." });
    const { rows: itemRows } = await client.query(
      "SELECT * FROM sale_items WHERE sale_id=$1 AND product_id=$2", [saleId, productId]
    );
    if (!itemRows[0]) return res.status(404).json({ message: "Item not found in sale." });
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ message: "Return quantity must be a positive integer." });
    // Check already-returned quantity for this item
    const { rows: retRows } = await client.query(
      "SELECT COALESCE(SUM(quantity),0)::int AS returned FROM returns WHERE sale_id=$1 AND product_id=$2",
      [saleId, productId]
    );
    const alreadyReturned = retRows[0].returned || 0;
    const remaining = itemRows[0].quantity - alreadyReturned;
    if (qty > remaining) return res.status(400).json({ message: `Return quantity exceeds remaining (${remaining} left to return).` });

    await client.query("BEGIN");
    const refundAmount = Number(itemRows[0].unit_price) * qty;
    await client.query(
      "INSERT INTO returns(sale_id,product_id,quantity,reason,refund_amount,processed_by) VALUES($1,$2,$3,$4,$5,$6)",
      [saleId, productId, qty, reason || "", refundAmount, req.user.id]
    );
    await client.query("UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2", [qty, productId]);
    // Restore stock to the sale's original branch (not the user's branch)
    const saleBranchId = saleRows[0].branch_id;
    if (saleBranchId) {
      await client.query(
        `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
         VALUES($2, $3, $1, (SELECT reorder_level FROM products WHERE id = $3))
         ON CONFLICT (branch_id, product_id)
         DO UPDATE SET quantity = branch_inventory.quantity + $1, updated_at = NOW()`,
        [qty, saleBranchId, productId]
      );
    }
    await client.query(
      "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,'RETURN',$2,$3,$4,$5)",
      [productId, qty, `RET-${saleId}`, req.user.id, reason || ""]
    );
    await audit(client, req.user.id, "RETURN", "SALE", saleId, { productId, qty, refundAmount }, req);
    await client.query("COMMIT");
    res.json({ message: "Return processed.", refundAmount });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 9: DASHBOARD / BI
// ═══════════════════════════════════════════════════════════════════

// Helper: Build parameterized branch filter for queries
// Returns { sql, params, nextIdx } where sql is the WHERE clause fragment and params is the param array
function buildBranchFilter(req, opts = {}) {
  const { tableAlias = "s", userAlias, useCashierFallback = false } = opts;
  const params = [];
  let sql = "";

  // Super-admin (ADMIN without branch_id): can view all or filter by query param
  if (req.user.role === "ADMIN" && !req.user.branchId) {
    if (req.query.branchId) {
      params.push(Number(req.query.branchId));
      sql = ` AND ${tableAlias}.branch_id = $${params.length}`;
    }
    // else: no filter — super-admin sees all branches
  }
  // Branch-scoped users (ADMIN or MANAGER with branch_id): always scoped to their branch
  else if (req.user.branchId) {
    params.push(req.user.branchId);
    sql = ` AND ${tableAlias}.branch_id = $${params.length}`;
  }
  // Cashier without branch: fallback to cashier_id
  else if (useCashierFallback && req.user.id) {
    params.push(req.user.id);
    sql = ` AND ${tableAlias}.cashier_id = $${params.length}`;
  }
  const targetBranchId = (req.user.role === "ADMIN" && !req.user.branchId)
    ? (req.query.branchId ? Number(req.query.branchId) : null)
    : (req.user.branchId || null);
  return { sql, params, targetBranchId };
}

app.get("/api/dashboard/stats", auth, async (req, r, n) => {
  try {
    const branchFilter = buildBranchFilter(req, { tableAlias: "s", useCashierFallback: true });
    const userBranchFilter = buildBranchFilter(req, { tableAlias: "u", useCashierFallback: true });
    const targetBranchId = branchFilter.targetBranchId;

    // When viewing a specific branch, count products actually stocked at that branch
    let productFilterSql = "";
    let productFilterParams = [];
    if (targetBranchId) {
      // Count products that have branch_inventory with stock > 0 at this branch
      productFilterParams = [targetBranchId];
      productFilterSql = ` AND EXISTS (SELECT 1 FROM branch_inventory bi WHERE bi.product_id = p.id AND bi.branch_id = $${productFilterParams.length} AND bi.quantity > 0)`;
    }

    // Build a branch-aware low-stock query
    let lowStockQuery;
    if (targetBranchId) {
      // Only count products that have a branch_inventory entry at this branch
      lowStockQuery = pool.query(
        `SELECT COUNT(*)::int AS count FROM products p
         JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
         WHERE p.is_active = TRUE AND bi.quantity <= COALESCE(bi.reorder_level, p.reorder_level)`,
        [targetBranchId]
      );
    } else {
      lowStockQuery = pool.query(`SELECT COUNT(*)::int AS count FROM products p WHERE p.stock <= p.reorder_level AND p.is_active = TRUE`);
    }

    const allParams = [...branchFilter.params];
    const ufParams = [...userBranchFilter.params];
    const pfParams = [...productFilterParams];

    const [totalProducts, totalSales, totalRevenue, lowStock, todaySales, todayRevenue, totalUsers, recentSales] = await Promise.all([
      pfParams.length
        ? pool.query(`SELECT COUNT(*)::int AS count FROM products p WHERE p.is_active = TRUE${productFilterSql}`, pfParams)
        : pool.query(`SELECT COUNT(*)::int AS count FROM products p WHERE p.is_active = TRUE`),
      pool.query(`SELECT COUNT(*)::int AS count FROM sales s WHERE 1=1${branchFilter.sql}`, branchFilter.params),
      pool.query(`SELECT COALESCE(SUM(s.total),0)::float AS total FROM sales s WHERE 1=1${branchFilter.sql}`, branchFilter.params),
      lowStockQuery,
      pool.query(`SELECT COUNT(*)::int AS count FROM sales s WHERE s.created_at::date = CURRENT_DATE${branchFilter.sql}`, branchFilter.params),
      pool.query(`SELECT COALESCE(SUM(s.total),0)::float AS total FROM sales s WHERE s.created_at::date = CURRENT_DATE${branchFilter.sql}`, branchFilter.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM users u WHERE u.is_active = TRUE${userBranchFilter.sql}`, userBranchFilter.params),
      pool.query(`SELECT date_trunc('day',s.created_at)::date AS day, COUNT(*)::int AS count, COALESCE(SUM(s.total),0)::float AS revenue
                  FROM sales s WHERE s.created_at >= NOW() - INTERVAL '30 days'${branchFilter.sql}
                  GROUP BY 1 ORDER BY 1`, branchFilter.params)
    ]);
    r.json({
      totalProducts: totalProducts.rows[0].count,
      totalSales: totalSales.rows[0].count,
      totalRevenue: totalRevenue.rows[0].total,
      lowStockCount: lowStock.rows[0].count,
      todaySales: todaySales.rows[0].count,
      todayRevenue: todayRevenue.rows[0].total,
      totalUsers: totalUsers.rows[0].count,      salesChart: recentSales.rows
    });
  } catch (e) { n(e); }
});


app.get("/api/dashboard/top-products", auth, async (req, r, n) => {
  try {
    const bf = buildBranchFilter(req, { tableAlias: "s", useCashierFallback: true });
    r.json((await pool.query(
      `SELECT si.product_name, SUM(si.quantity)::int AS total_qty, SUM(si.line_total)::float AS total_revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= NOW() - INTERVAL '30 days'${bf.sql}       GROUP BY si.product_name ORDER BY total_revenue DESC LIMIT 10`, bf.params
    )).rows);
  } catch (e) { n(e); }
});


app.get("/api/dashboard/category-sales", auth, async (req, r, n) => {
  try {
    const bf = buildBranchFilter(req, { tableAlias: "s", useCashierFallback: true });
    r.json((await pool.query(
      `SELECT p.category, SUM(si.line_total)::float AS revenue, SUM(si.quantity)::int AS qty
       FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= NOW() - INTERVAL '30 days'${bf.sql}
       GROUP BY p.category ORDER BY revenue DESC`, bf.params
    )).rows);
  } catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// BRANCH SUMMARY — Admin overview of all branches
// ═══════════════════════════════════════════════════════════════════

app.get("/api/dashboard/branch-summary", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.name,
              COUNT(DISTINCT s.id)::int AS total_sales,
              COALESCE(SUM(s.total),0)::float AS total_revenue,
              COUNT(DISTINCT s.cashier_id)::int AS active_cashiers,
              COUNT(DISTINCT s.created_at::date)::int AS active_days,
              COALESCE(SUM(CASE WHEN s.created_at::date = CURRENT_DATE THEN s.total ELSE 0 END),0)::float AS today_revenue,
              COUNT(DISTINCT CASE WHEN s.created_at::date = CURRENT_DATE THEN s.id END)::int AS today_sales
       FROM branches b
       LEFT JOIN sales s ON s.branch_id = b.id
       WHERE b.is_active = TRUE
       GROUP BY b.id, b.name
       ORDER BY total_revenue DESC`
    );
    // Low stock per branch — count products where branch stock <= reorder level
    // Use COALESCE so products without branch_inventory entries are also checked
    const branchIds = result.rows.map(r => r.id);
    let lowStockMap = {};
    if (branchIds.length) {
      // Only count products that have a branch_inventory entry at each branch
      const { rows: stockRows } = await pool.query(
        `SELECT bi.branch_id, COUNT(DISTINCT p.id)::int AS low_stock_count
         FROM branch_inventory bi
         JOIN products p ON p.id = bi.product_id
         WHERE bi.quantity <= COALESCE(bi.reorder_level, p.reorder_level)
           AND p.is_active = TRUE
         GROUP BY bi.branch_id`
      );
      stockRows.forEach(r => { lowStockMap[r.branch_id] = r.low_stock_count; });
    }
    const enriched = result.rows.map(r => ({
      ...r,
      low_stock: lowStockMap[r.id] || 0,
    }));

    // Compute TOTAL row across all branches
    const totals = enriched.reduce((acc, r) => ({
      total_sales: acc.total_sales + (r.total_sales || 0),
      total_revenue: acc.total_revenue + (r.total_revenue || 0),
      today_revenue: acc.today_revenue + (r.today_revenue || 0),
      today_sales: acc.today_sales + (r.today_sales || 0),
      active_cashiers: acc.active_cashiers + (r.active_cashiers || 0),
      low_stock: acc.low_stock + (r.low_stock || 0),
    }), { total_sales: 0, total_revenue: 0, today_revenue: 0, today_sales: 0, active_cashiers: 0, low_stock: 0 });

    res.json({ branches: enriched, totals });
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 10: PROCUREMENT — Suppliers & Purchase Orders
// ═══════════════════════════════════════════════════════════════════

app.get("/api/suppliers", auth, async (q, r, n) => {
  try {
    const pageSize = Math.min(Number(q.query.limit) || 50, 200);
    let cursor = null;
    if (q.query.cursor) { try { cursor = JSON.parse(q.query.cursor); } catch {} }
    const params = [];
    let where = "";
    if (cursor && cursor.name != null && cursor.id != null) {
      params.push(cursor.name, cursor.id);
      where = `WHERE (s.name, s.id) > ($1, $2)`;
    }
    params.push(pageSize + 1);
    const result = await pool.query(
      `SELECT s.* FROM suppliers s ${where} ORDER BY s.name, s.id LIMIT $${params.length}`,
      params
    );
    const rows = result.rows;
    const hasMore = rows.length > pageSize;
    const data = hasMore ? rows.slice(0, pageSize) : rows;
    const nextCursor = hasMore ? { name: data[data.length - 1].name, id: data[data.length - 1].id } : null;
    r.json({ data, nextCursor, hasMore });
  } catch (e) { n(e); }
});

app.post("/api/suppliers", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { name, contactPerson, email, phone, address } = req.body;
    if (!name) return res.status(400).json({ message: "Supplier name required." });
    const { rows } = await pool.query(
      "INSERT INTO suppliers(name,contact_person,email,phone,address) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [name, contactPerson || null, email || null, phone || null, address || null]
    );
    await audit(pool, req.user.id, "CREATE", "SUPPLIER", rows[0].id, { name }, req);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.put("/api/suppliers/:id", auth, requireSuperAdmin, async (req, res, next) => {
  // Suppliers are global (no branch_id). Only super-admin can edit them
  // so that a branch admin's changes don't affect other branches.
  try {
    const id = Number(req.params.id);
    const { name, contactPerson, email, phone, address, isActive } = req.body;
    const { rows } = await pool.query(
      `UPDATE suppliers SET name=COALESCE($1,name),contact_person=COALESCE($2,contact_person),
       email=COALESCE($3,email),phone=COALESCE($4,phone),address=COALESCE($5,address),
       is_active=COALESCE($6,is_active) WHERE id=$7 RETURNING *`,
      [name, contactPerson, email, phone, address, isActive, id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Supplier not found." });
    await audit(pool, req.user.id, "UPDATE", "SUPPLIER", id, req.body, req);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.delete("/api/suppliers/:id", auth, requireSuperAdmin, async (req, res, next) => {
  // Suppliers are global (no branch_id). Only super-admin can delete them.
  try {
    const { rowCount } = await pool.query("DELETE FROM suppliers WHERE id=$1", [Number(req.params.id)]);
    if (rowCount === 0) return res.status(404).json({ message: "Supplier not found." });
    await audit(pool, req.user.id, "DELETE", "SUPPLIER", req.params.id, {}, req);
    res.json({ message: "Supplier deleted." });
  } catch (e) { next(e); }
});

// Purchase Orders
app.get("/api/purchase-orders", auth, async (req, r, n) => {
  try {
    let whereClause = "";
    const params = [];
    // Branch-scoped users see only their branch's POs; super-admin can filter or see all
    if (req.user.branchId) {
      whereClause = " WHERE po.branch_id = $1";
      params.push(req.user.branchId);
    } else if (req.user.role === "ADMIN" && req.query.branchId) {
      whereClause = " WHERE po.branch_id = $1";
      params.push(Number(req.query.branchId));
    }
    r.json((await pool.query(
      `SELECT po.*, s.name AS supplier_name, u.name AS created_by_name
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN users u ON u.id = po.created_by${whereClause}
       ORDER BY po.created_at DESC LIMIT 100`,
      params
    )).rows);
  } catch (e) { n(e); }
});

app.get("/api/purchase-orders/:id", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: poRows } = await pool.query(
      `SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id=$1`, [id]
    );
    if (!poRows[0]) return res.status(404).json({ message: "Purchase order not found." });
    // Branch-scoped users can only view POs from their branch
    if (req.user.branchId && poRows[0].branch_id !== req.user.branchId)
      return res.status(403).json({ message: "Access denied. Purchase order belongs to another branch." });
    const { rows: items } = await pool.query(
      `SELECT poi.*, p.name AS product_name FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id WHERE poi.po_id=$1`, [id]
    );
    res.json({ ...poRows[0], items });
  } catch (e) { next(e); }
});

app.post("/api/purchase-orders", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { supplierId, items, notes, expectedDate } = req.body;
    if (!supplierId || !Array.isArray(items) || !items.length)
      return res.status(400).json({ message: "Supplier and items required." });

    // Validate each item has a valid product, quantity, and unit cost
    for (const item of items) {
      if (!item.productId || !Number.isInteger(Number(item.productId)) || Number(item.productId) < 1)
        return res.status(400).json({ message: "Each item must have a valid product." });
      if (!item.quantity || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)
        return res.status(400).json({ message: "Each item must have a valid quantity (min 1)." });
      const cost = Number(item.unitCost);
      if (!Number.isFinite(cost) || cost < 0)
        return res.status(400).json({ message: "Each item must have a valid unit cost (≥ 0)." });
    }

    await client.query("BEGIN");
    let total = 0;
    const poNumber = `PO-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

    const { rows: poRows } = await client.query(
      `INSERT INTO purchase_orders(po_number,supplier_id,notes,created_by,expected_date,branch_id)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [poNumber, supplierId, notes || "", req.user.id, expectedDate || null, req.user.branchId || null]
    );
    const poId = poRows[0].id;

    for (const item of items) {
      const qty = Number(item.quantity);
      const cost = Number(item.unitCost);
      const lineTotal = qty * cost;
      total += lineTotal;
      await client.query(
        "INSERT INTO purchase_order_items(po_id,product_id,quantity,unit_cost,line_total) VALUES($1,$2,$3,$4,$5)",
        [poId, item.productId, qty, cost, lineTotal]
      );
    }

    await client.query("UPDATE purchase_orders SET total=$1 WHERE id=$2", [total, poId]);
    await audit(client, req.user.id, "CREATE", "PURCHASE_ORDER", poId, { poNumber, total }, req);
    await client.query("COMMIT");
    res.status(201).json({ id: poId, poNumber, total });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

app.patch("/api/purchase-orders/:id/status", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!["PENDING", "APPROVED", "RECEIVED", "CANCELLED"].includes(status))
      return res.status(400).json({ message: "Invalid status." });

    await client.query("BEGIN");
    const { rows: existing } = await client.query("SELECT status, branch_id FROM purchase_orders WHERE id=$1", [id]);
    if (!existing[0]) { await client.query("ROLLBACK").catch(() => {}); client.release(); return res.status(404).json({ message: "Purchase order not found." }); }
    // BRANCH SCOPING: Branch admins/managers can only update POs belonging to their branch
    if (req.user.branchId && existing[0].branch_id !== req.user.branchId) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      return res.status(403).json({ message: "Access denied. Purchase order belongs to another branch." });
    }
    const currentStatus = existing[0].status;
    const validTransitions = { PENDING: ["APPROVED", "CANCELLED"], APPROVED: ["RECEIVED", "CANCELLED"] };
    if (currentStatus === "RECEIVED" || currentStatus === "CANCELLED")
      return res.status(400).json({ message: `Cannot change status from ${currentStatus}.` });
    if (validTransitions[currentStatus] && !validTransitions[currentStatus].includes(status))
      return res.status(400).json({ message: `Cannot transition from ${currentStatus} to ${status}.` });

    const updateFields = status === "RECEIVED"
      ? "status=$1, received_date=NOW(), updated_at=NOW()"
      : "status=$1, updated_at=NOW()";
    const { rows } = await client.query(
      `UPDATE purchase_orders SET ${updateFields} WHERE id=$2 RETURNING *`, [status, id]
    );

    if (status === "RECEIVED") {
      // Auto-receive stock
      const { rows: items } = await client.query("SELECT * FROM purchase_order_items WHERE po_id=$1", [id]);
      // Determine which branch to add stock to (from PO or user's branch)
      const po = rows[0];
      const targetBranchId = po.branch_id || req.user.branchId || null;
      for (const item of items) {
        const qty = Number(item.quantity);
        // Add to global stock
        await client.query("UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2", [qty, item.product_id]);
        // Add to branch_inventory if branch is known
        if (targetBranchId) {
          await client.query(
            `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
             VALUES($1, $2, $3, (SELECT reorder_level FROM products WHERE id = $2))
             ON CONFLICT (branch_id, product_id)
             DO UPDATE SET quantity = branch_inventory.quantity + $3, updated_at = NOW()`,
            [targetBranchId, item.product_id, qty]
          );
        }
        await client.query(
          "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id) VALUES($1,'PURCHASE',$2,$3,$4)",
          [item.product_id, qty, rows[0].po_number, req.user.id]
        );
      }
    }

    await audit(client, req.user.id, "UPDATE_STATUS", "PURCHASE_ORDER", id, { status }, req);
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// PURCHASE ORDER PAYMENTS — vendor/supplier reconciliation
app.get("/api/purchase-orders/:id/payments", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: po } = await pool.query(
      `SELECT po.*, s.name AS supplier_name,
              COALESCE(pay.total_paid, 0) AS total_paid
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN (
         SELECT po_id, SUM(amount) AS total_paid
         FROM purchase_order_payments GROUP BY po_id
       ) pay ON pay.po_id = po.id
       WHERE po.id = $1`, [id]
    );
    if (!po[0]) return res.status(404).json({ message: "Purchase order not found." });
    // Branch-scoped users can only view payments for POs from their branch
    if (req.user.branchId && po[0].branch_id !== req.user.branchId)
      return res.status(403).json({ message: "Access denied. Purchase order belongs to another branch." });
    const { rows: payments } = await pool.query(
      `SELECT pp.*, u.name AS paid_by_name
       FROM purchase_order_payments pp
       LEFT JOIN users u ON u.id = pp.paid_by
       WHERE pp.po_id = $1 ORDER BY pp.created_at DESC`, [id]
    );
    const order = po[0];
    res.json({
      ...order,
      total_paid: Number(order.total_paid),
      balance: Number(order.total) - Number(order.total_paid),
      payments,
    });
  } catch (e) { next(e); }
});

app.post("/api/purchase-orders/:id/payments", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const { amount, paymentMethod, reference, notes } = req.body;
    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ message: "Valid payment amount required." });

    await client.query("BEGIN");
    const { rows: po } = await client.query(
      `SELECT po.*, COALESCE(pay.total_paid, 0) AS total_paid
       FROM purchase_orders po
       LEFT JOIN (SELECT po_id, SUM(amount) AS total_paid FROM purchase_order_payments GROUP BY po_id) pay ON pay.po_id = po.id
       WHERE po.id = $1`, [id]
    );
    if (!po[0]) { await client.query("ROLLBACK").catch(() => {}); client.release(); return res.status(404).json({ message: "Purchase order not found." }); }
    // Branch-scoped users can only make payments for POs from their branch
    if (req.user.branchId && po[0].branch_id !== req.user.branchId) {
      await client.query("ROLLBACK").catch(() => {}); client.release();
      return res.status(403).json({ message: "Access denied. Purchase order belongs to another branch." });
    }

    const totalPaid = Number(po[0].total_paid);
    const poTotal = Number(po[0].total);
    const payAmount = Number(amount);

    if (totalPaid + payAmount > poTotal + 0.01)
      return res.status(400).json({ message: `Payment of \u20A6${payAmount.toLocaleString()} exceeds outstanding balance of \u20A6${(poTotal - totalPaid).toLocaleString()}.` });

    const { rows } = await client.query(
      `INSERT INTO purchase_order_payments(po_id, amount, payment_method, reference, notes, paid_by)
       VALUES($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, payAmount, paymentMethod || "Cash", reference || null, notes || null, req.user.id]
    );

    await audit(client, req.user.id, "CREATE", "PO_PAYMENT", id, { amount: payAmount, paymentMethod, reference }, req);
    await client.query("COMMIT");
    res.status(201).json({ payment: rows[0], message: "Payment recorded." });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 12: CUSTOMERS / CRM
// ═══════════════════════════════════════════════════════════════════

app.get("/api/customers", auth, async (q, r, n) => {
  try {
    const pageSize = Math.min(Number(q.query.limit) || 50, 200);
    let cursor = null;
    if (q.query.cursor) { try { cursor = JSON.parse(q.query.cursor); } catch {} }
    const params = [];
    let where = "";
    if (cursor && cursor.name != null && cursor.id != null) {
      params.push(cursor.name, cursor.id);
      where = `WHERE (c.name, c.id) > ($1, $2)`;
    }
    params.push(pageSize + 1);
    const result = await pool.query(
      `SELECT c.* FROM customers c ${where} ORDER BY c.name, c.id LIMIT $${params.length}`,
      params
    );
    const rows = result.rows;
    const hasMore = rows.length > pageSize;
    const data = hasMore ? rows.slice(0, pageSize) : rows;
    const nextCursor = hasMore ? { name: data[data.length - 1].name, id: data[data.length - 1].id } : null;
    r.json({ data, nextCursor, hasMore });
  } catch (e) { n(e); }
});

app.post("/api/customers", auth, async (req, res, next) => {
  try {
    const { name, email, phone } = req.body;
    if (!name) return res.status(400).json({ message: "Customer name required." });
    const { rows } = await pool.query(
      "INSERT INTO customers(name,email,phone) VALUES($1,$2,$3) RETURNING *",
      [name, email || null, phone || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.put("/api/customers/:id", auth, requireSuperAdmin, async (req, res, next) => {
  // Customers are global (no branch_id). Only super-admin can edit them
  // so that a branch admin's changes don't affect other branches.
  try {
    const id = Number(req.params.id);
    const { name, email, phone } = req.body;
    const { rows } = await pool.query(
      "UPDATE customers SET name=COALESCE($1,name),email=COALESCE($2,email),phone=COALESCE($3,phone) WHERE id=$4 RETURNING *",
      [name, email, phone, id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Customer not found." });
    await audit(pool, req.user.id, "UPDATE", "CUSTOMER", id, req.body, req);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 13: FINANCE — Expenses
// ═══════════════════════════════════════════════════════════════════

app.get("/api/expenses", auth, async (req, r, n) => {
  try {
    let whereClause = "";
    const params = [];
    // Super-admin can filter by branch via query param; branch-scoped users see only their branch
    if (req.user.branchId) {
      whereClause = " WHERE e.branch_id = $1";
      params.push(req.user.branchId);
    } else if (req.user.role === "ADMIN" && req.query.branchId) {
      whereClause = " WHERE e.branch_id = $1";
      params.push(Number(req.query.branchId));
    }
    r.json((await pool.query(
      `SELECT e.*, u.name AS approved_by_name FROM expenses e LEFT JOIN users u ON u.id = e.approved_by${whereClause} ORDER BY e.created_at DESC LIMIT 200`,
      params
    )).rows);
  } catch (e) { n(e); }
});

app.post("/api/expenses", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { category, description, amount, paymentMethod, reference } = req.body;
    if (!category || !amount || Number(amount) <= 0)
      return res.status(400).json({ message: "Category and positive amount required." });
    const { rows } = await pool.query(
      `INSERT INTO expenses(category,description,amount,payment_method,reference,approved_by,branch_id)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [category, description || "", amount, paymentMethod || "Cash", reference || "", req.user.id, req.user.branchId || null]
    );
    await audit(pool, req.user.id, "CREATE", "EXPENSE", rows[0].id, { category, amount }, req);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.get("/api/finance/summary", auth, allow("ADMIN", "MANAGER"), async (req, r, n) => {
  try {
    // Branch-scoped: branch admins see only their branch; super-admin can filter or see all
    const params = [];
    let branchFilter = "";
    if (req.user.branchId) {
      params.push(req.user.branchId);
      branchFilter = ` AND branch_id = $${params.length}`;
    } else if (req.user.role === "ADMIN" && req.query.branchId) {
      params.push(Number(req.query.branchId));
      branchFilter = ` AND branch_id = $${params.length}`;
    }
    const [salesRev, totalExpenses, todaySales] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total),0)::float AS revenue FROM sales WHERE 1=1${branchFilter}`, params),
      pool.query(`SELECT COALESCE(SUM(amount),0)::float AS total FROM expenses WHERE 1=1${branchFilter}`, params),
      params.length > 0
        ? pool.query(`SELECT COALESCE(SUM(s.total),0)::float AS revenue,
          COALESCE((SELECT SUM(p.cost_price * si.quantity) FROM sale_items si
            JOIN products p ON p.id = si.product_id
            JOIN sales s2 ON s2.id = si.sale_id
            WHERE s2.created_at::date = CURRENT_DATE AND s2.branch_id = $1),0)::float AS cost
          FROM sales s WHERE s.created_at::date = CURRENT_DATE AND s.branch_id = $1`, params)
        : pool.query(`SELECT COALESCE(SUM(s.total),0)::float AS revenue,
          COALESCE((SELECT SUM(p.cost_price * si.quantity) FROM sale_items si
            JOIN products p ON p.id = si.product_id
            JOIN sales s2 ON s2.id = si.sale_id
            WHERE s2.created_at::date = CURRENT_DATE),0)::float AS cost
          FROM sales s WHERE s.created_at::date = CURRENT_DATE`)
    ]);
    const revenue = salesRev.rows[0].revenue;
    const expenses = totalExpenses.rows[0].total;
    const profit = revenue - expenses;
    r.json({ revenue, expenses, profit, todayRevenue: todaySales.rows[0].revenue, todayCost: todaySales.rows[0].cost });
  } catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 8: AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════

app.get("/api/audit-logs", auth, allow("ADMIN"), async (q, r, n) => {
  try {
    const pageSize = Math.min(Number(q.query.limit) || 50, 200);
    let sql = `SELECT a.id,u.name AS user_name,a.action,a.entity_type,a.entity_id,a.details,a.ip_address,a.user_agent,a.created_at
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id`;
    const conditions = [];
    const params = [];
    let idx = 1;
    // Branch admins can only see audit logs for their branch; super-admin sees all
    if (q.user.branchId) {
      conditions.push(`u.branch_id = $${idx++}`);
      params.push(q.user.branchId);
    } else if (q.query.branchId) {
      conditions.push(`u.branch_id = $${idx++}`);
      params.push(Number(q.query.branchId));
    }
    // Cursor-based pagination
    if (q.query.cursor) {
      const cursor = JSON.parse(q.query.cursor);
      conditions.push(`(a.created_at, a.id) < ($${idx++}, $${idx++})`);
      params.push(cursor.ts, cursor.id);
    }
    if (conditions.length) sql += ` WHERE ` + conditions.join(' AND ');
    const fetchLimit = pageSize + 1;
    sql += ` ORDER BY a.created_at DESC, a.id DESC LIMIT $${idx}`;
    params.push(fetchLimit);
    const { rows } = await pool.query(sql, params);
    const hasMore = rows.length > pageSize;
    const data = hasMore ? rows.slice(0, pageSize) : rows;
    const nextCursor = hasMore ? { ts: data[data.length - 1].created_at, id: data[data.length - 1].id } : null;
    r.json({ data, nextCursor, hasMore });
  } catch (e) { n(e); }
});

app.get("/api/audit-logs/login-history", auth, allow("ADMIN"), async (q, r, n) => {
  try {
    const limit = Math.min(Number(q.query.limit) || 100, 500);
    const userId = q.query.user_id;
    let branchId = q.query.branchId;
    // Branch admins can only see login history for their branch
    if (q.user.branchId) branchId = q.user.branchId;
    let sql = `
      SELECT a.id, u.name AS user_name, u.email, a.action, a.details, a.ip_address, a.user_agent, a.created_at
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.action IN ('LOGIN','FORGOT_PASSWORD','RESET_PASSWORD','CHANGE_PASSWORD','MFA_ENABLED','MFA_DISABLED')`;
    const params = [];
    if (userId) { params.push(Number(userId)); sql += ` AND a.user_id = $${params.length}`; }
    if (branchId) { params.push(Number(branchId)); sql += ` AND u.branch_id = $${params.length}`; }
    sql += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    r.json((await pool.query(sql, params)).rows);
  } catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 14: BRANCHES
// ═══════════════════════════════════════════════════════════════════

app.get("/api/branches", auth, async (q, r, n) => {
  try {
    // Branch admins/managers can only see their own branch — NOT all branches
    if (q.user.branchId) {
      const { rows } = await pool.query(
        `SELECT b.* FROM branches b WHERE b.id = $1 AND b.is_active = TRUE`, [q.user.branchId]
      );
      return r.json({ data: rows, nextCursor: null, hasMore: false });
    }
    // Super-admin (ADMIN without branch_id) sees all branches
    const pageSize = Math.min(Number(q.query.limit) || 100, 200);
    let cursor = null;
    if (q.query.cursor) { try { cursor = JSON.parse(q.query.cursor); } catch {} }
    const params = [];
    let where = "WHERE is_active = TRUE";
    if (cursor && cursor.name != null && cursor.id != null) {
      params.push(cursor.name, cursor.id);
      where += ` AND (b.name, b.id) > ($1, $2)`;
    }
    params.push(pageSize + 1);
    const result = await pool.query(
      `SELECT b.* FROM branches b ${where} ORDER BY b.name, b.id LIMIT $${params.length}`,
      params
    );
    const rows = result.rows;
    const hasMore = rows.length > pageSize;
    const data = hasMore ? rows.slice(0, pageSize) : rows;
    const nextCursor = hasMore ? { name: data[data.length - 1].name, id: data[data.length - 1].id } : null;
    r.json({ data, nextCursor, hasMore });
  } catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 14: CASH DRAWER
// ═══════════════════════════════════════════════════════════════════

app.get("/api/cash-drawer", auth, async (req, r, n) => {
  try {
    let whereClause = "";
    const params = [];
    // Branch-scoped users see only their branch; super-admin can filter or see all
    if (req.user.branchId) {
      whereClause = " WHERE cd.branch_id = $1";
      params.push(req.user.branchId);
    } else if (req.user.role === "ADMIN" && req.query.branchId) {
      whereClause = " WHERE cd.branch_id = $1";
      params.push(Number(req.query.branchId));
    }
    r.json((await pool.query(
      `SELECT cd.*, uo.name AS opened_by_name, uc.name AS closed_by_name
       FROM cash_drawer cd
       LEFT JOIN users uo ON uo.id = cd.opened_by
       LEFT JOIN users uc ON uc.id = cd.closed_by
       ${whereClause}
       ORDER BY cd.opened_at DESC LIMIT 50`, params
    )).rows);
  } catch (e) { n(e); }
});

app.get("/api/cash-drawer/active", auth, async (req, r, n) => {
  try {
    const bf = buildBranchFilter(req, { tableAlias: "cd" });
    const { rows } = await pool.query(
      `SELECT cd.*, uo.name AS opened_by_name
       FROM cash_drawer cd LEFT JOIN users uo ON uo.id = cd.opened_by
       WHERE cd.status = 'OPEN'${bf.sql} ORDER BY cd.opened_at DESC LIMIT 1`, bf.params
    );
    r.json(rows[0] || null);
  } catch (e) { n(e); }
});

app.post("/api/cash-drawer/open", auth, allow("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const { openingBalance = 0, drawerName = "Main Drawer" } = req.body;
    const bf = buildBranchFilter(req, { tableAlias: "cash_drawer" });
    const existing = await pool.query(`SELECT id FROM cash_drawer WHERE status = 'OPEN'${bf.sql}`, bf.params);
    if (existing.rows[0]) return res.status(409).json({ message: "A drawer is already open. Close it first." });
    const { rows } = await pool.query(
      `INSERT INTO cash_drawer(drawer_name, opening_balance, current_balance, opened_by, branch_id)
       VALUES($1, $2, $2, $3, $4) RETURNING *`,
      [drawerName, Number(openingBalance), req.user.id, req.user.branchId || null]
    );
    await audit(pool, req.user.id, "OPEN_DRAWER", "CASH_DRAWER", rows[0].id, { openingBalance, drawerName }, req);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.post("/api/cash-drawer/close", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { closingBalance } = req.body;
    if (closingBalance == null) return res.status(400).json({ message: "Closing balance required." });
    const bf = buildBranchFilter(req, { tableAlias: "cash_drawer" });
    const { rows: openDrawer } = await pool.query(`SELECT * FROM cash_drawer WHERE status = 'OPEN'${bf.sql} LIMIT 1`, bf.params);
    if (!openDrawer[0]) return res.status(404).json({ message: "No open drawer found." });
    const drawer = openDrawer[0];
    // Always filter by the drawer's own branch to get accurate expected balance
    let salesQuery = "SELECT COALESCE(SUM(total),0)::float AS total FROM sales WHERE created_at >= $1";
    const salesParams = [drawer.opened_at];
    if (drawer.branch_id) {
      salesQuery += " AND branch_id = $2";
      salesParams.push(drawer.branch_id);
    }
    const salesInPeriod = await pool.query(salesQuery, salesParams);
    const expected = Number(drawer.opening_balance) + Number(salesInPeriod.rows[0].total);
    const variance = Number(closingBalance) - expected;
    const { rows } = await pool.query(
      `UPDATE cash_drawer SET closing_balance=$1, expected_balance=$2, variance=$3,
       status='CLOSED', closed_by=$4, closed_at=NOW()
       WHERE id=$5 RETURNING *`,
      [Number(closingBalance), expected, variance, req.user.id, drawer.id]
    );
    await audit(pool, req.user.id, "CLOSE_DRAWER", "CASH_DRAWER", drawer.id, { closingBalance: Number(closingBalance), expected, variance }, req);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// BRANCH MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

app.post("/api/branches", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, address, phone, managerId } = req.body;
    if (!name) return res.status(400).json({ message: "Branch name required." });
    const { rows } = await pool.query(
      "INSERT INTO branches(name,address,phone,manager_id) VALUES($1,$2,$3,$4) RETURNING *",
      [name, address || null, phone || null, managerId || null]
    );
    await audit(pool, req.user.id, "CREATE", "BRANCH", rows[0].id, { name }, req);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.put("/api/branches/:id", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, address, phone, managerId, isActive } = req.body;
    const { rows } = await pool.query(
      `UPDATE branches SET name=COALESCE($1,name),address=COALESCE($2,address),
       phone=COALESCE($3,phone),manager_id=COALESCE($4,manager_id),
       is_active=COALESCE($5,is_active) WHERE id=$6 RETURNING *`,
      [name, address, phone, managerId, isActive, id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Branch not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.delete("/api/branches/:id", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM branches WHERE id=$1", [Number(req.params.id)]);
    if (rowCount === 0) return res.status(404).json({ message: "Branch not found." });
    await audit(pool, req.user.id, "DELETE", "BRANCH", req.params.id, {}, req);
    res.json({ message: "Branch deleted." });
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// INTER-BRANCH MESSAGING
// ═══════════════════════════════════════════════════════════════════

// Get messages for current user's branch (inbox)
app.get("/api/messages", auth, async (req, res, next) => {
  try {
    const branchId = req.user.branchId;
    if (!branchId) return res.json([]);
    const box = req.query.box || "inbox"; // inbox or sent
    let sql, params;
    if (box === "sent") {
      sql = `SELECT m.*, fb.name AS from_branch_name, tb.name AS to_branch_name,
                    fu.name AS from_user_name
             FROM messages m
             JOIN branches fb ON fb.id = m.from_branch_id
             JOIN branches tb ON tb.id = m.to_branch_id
             JOIN users fu ON fu.id = m.from_user_id
             WHERE m.from_branch_id = $1
             ORDER BY m.created_at DESC LIMIT 100`;
      params = [branchId];
    } else {
      sql = `SELECT m.*, fb.name AS from_branch_name, tb.name AS to_branch_name,
                    fu.name AS from_user_name
             FROM messages m
             JOIN branches fb ON fb.id = m.from_branch_id
             JOIN branches tb ON tb.id = m.to_branch_id
             JOIN users fu ON fu.id = m.from_user_id
             WHERE m.to_branch_id = $1
             ORDER BY m.created_at DESC LIMIT 100`;
      params = [branchId];
    }
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { console.error("[MESSAGES]", e.message); res.status(500).json({ message: e.message }); }
});

// Get unread message count
app.get("/api/messages/unread", auth, async (req, res, next) => {
  try {
    const branchId = req.user.branchId;
    if (!branchId) return res.json({ count: 0 });
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM messages WHERE to_branch_id = $1 AND is_read = FALSE", [branchId]
    );
    res.json({ count: rows[0].count });
  } catch (e) { next(e); }
});

// Send a message
app.post("/api/messages", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { toBranchId, subject, body } = req.body;
    const fromBranchId = req.user.branchId;
    if (!fromBranchId) return res.status(400).json({ message: "You must be assigned to a branch to send messages." });
    if (!toBranchId || !subject || !body)
      return res.status(400).json({ message: "To branch, subject and body are required." });
    if (Number(toBranchId) === fromBranchId)
      return res.status(400).json({ message: "Cannot send a message to your own branch." });
    const { rows } = await pool.query(
      `INSERT INTO messages(from_branch_id, to_branch_id, from_user_id, subject, body)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [fromBranchId, Number(toBranchId), req.user.id, subject, body]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// Mark message as read
app.patch("/api/messages/:id/read", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const branchId = req.user.branchId;
    const { rows } = await pool.query(
      `UPDATE messages SET is_read = TRUE, read_at = NOW()
       WHERE id = $1 AND to_branch_id = $2 RETURNING *`,
      [id, branchId]
    );
    if (!rows[0]) return res.status(404).json({ message: "Message not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Delete a message
app.delete("/api/messages/:id", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const branchId = req.user.branchId;
    // Can delete if you sent it or received it
    const { rowCount } = await pool.query(
      "DELETE FROM messages WHERE id = $1 AND (from_branch_id = $2 OR to_branch_id = $2)",
      [id, branchId]
    );
    if (rowCount === 0) return res.status(404).json({ message: "Message not found." });
    res.json({ message: "Message deleted." });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// INTER-BRANCH STOCK TRANSFERS
// ═══════════════════════════════════════════════════════════════════

// List transfers (sent or received by this branch)
app.get("/api/stock-transfers", auth, async (req, res, next) => {
  try {
    const branchId = req.user.branchId;
    if (!branchId) return res.json([]);
    const box = req.query.box || "incoming"; // incoming or outgoing
    let sql, params;
    if (box === "outgoing") {
      sql = `SELECT st.*, p.name AS product_name, p.barcode,
                    fb.name AS from_branch_name, tb.name AS to_branch_name,
                    ru.name AS requested_by_name, au.name AS approved_by_name
             FROM stock_transfers st
             JOIN products p ON p.id = st.product_id
             JOIN branches fb ON fb.id = st.from_branch_id
             JOIN branches tb ON tb.id = st.to_branch_id
             JOIN users ru ON ru.id = st.requested_by
             LEFT JOIN users au ON au.id = st.approved_by
             WHERE st.from_branch_id = $1
             ORDER BY st.created_at DESC LIMIT 100`;
      params = [branchId];
    } else {
      sql = `SELECT st.*, p.name AS product_name, p.barcode,
                    fb.name AS from_branch_name, tb.name AS to_branch_name,
                    ru.name AS requested_by_name, au.name AS approved_by_name
             FROM stock_transfers st
             JOIN products p ON p.id = st.product_id
             JOIN branches fb ON fb.id = st.from_branch_id
             JOIN branches tb ON tb.id = st.to_branch_id
             JOIN users ru ON ru.id = st.requested_by
             LEFT JOIN users au ON au.id = st.approved_by
             WHERE st.to_branch_id = $1
             ORDER BY st.created_at DESC LIMIT 100`;
      params = [branchId];
    }
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { console.error("[TRANSFERS]", e.message); res.status(500).json({ message: e.message }); }
});

// Request a stock transfer (ask another branch to send stock)
app.post("/api/stock-transfers", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { toBranchId, productId, quantity, notes } = req.body;
    const fromBranchId = req.user.branchId;
    if (!fromBranchId) return res.status(400).json({ message: "You must be assigned to a branch to request transfers." });
    if (!toBranchId || !productId || !quantity)
      return res.status(400).json({ message: "To branch, product and quantity are required." });
    if (Number(toBranchId) === fromBranchId)
      return res.status(400).json({ message: "Cannot transfer to your own branch." });
    // Check source branch has enough stock (branch_inventory first, fallback to global)
    const { rows: biRows } = await pool.query(
      "SELECT quantity FROM branch_inventory WHERE branch_id=$1 AND product_id=$2", [fromBranchId, productId]
    );
    if (biRows[0]) {
      if (Number(biRows[0].quantity) < Number(quantity))
        return res.status(400).json({ message: `Insufficient stock at your branch. Available: ${biRows[0].quantity}` });
    } else {
      const { rows: stockRows } = await pool.query("SELECT stock FROM products WHERE id=$1", [productId]);
      if (!stockRows[0]) return res.status(404).json({ message: "Product not found." });
      if (Number(stockRows[0].stock) < Number(quantity))
        return res.status(400).json({ message: `Insufficient stock. Available: ${stockRows[0].stock}` });
    }
    const { rows } = await pool.query(
      `INSERT INTO stock_transfers(from_branch_id, to_branch_id, product_id, quantity, requested_by, notes)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [fromBranchId, Number(toBranchId), productId, Number(quantity), req.user.id, notes || ""]
    );
    // Get product and branch names for the notification
    const { rows: pRows } = await pool.query(`SELECT name FROM products WHERE id=$1`, [productId]);
    const { rows: fromRows } = await pool.query(`SELECT name FROM branches WHERE id=$1`, [fromBranchId]);
    const { rows: toRows } = await pool.query(`SELECT name FROM branches WHERE id=$1`, [Number(toBranchId)]);
    const productName = pRows[0]?.name || 'Unknown';
    const fromBranchName = fromRows[0]?.name || 'Unknown';
    const toBranchName = toRows[0]?.name || 'Unknown';
    // Notify managers at the destination branch (they need to approve)
    await notifyBranchManagers(pool, Number(toBranchId), {
      eventType: 'TRANSFER_REQUEST',
      title: `📦 Stock Transfer Request`,
      body: `${fromBranchName} requests ${quantity} unit(s) of ${productName} to be sent to ${toBranchName}.${notes ? ' Notes: ' + notes : ''}`,
      refType: 'stock_transfer',
      refId: rows[0].id,
    });
    // Also notify managers at the source branch
    await notifyBranchManagers(pool, fromBranchId, {
      eventType: 'TRANSFER_REQUEST',
      title: `📦 Outgoing Transfer Request`,
      body: `${fromBranchName} requested ${quantity} unit(s) of ${productName} to be sent to ${toBranchName}.${notes ? ' Notes: ' + notes : ''}`,
      refType: 'stock_transfer',
      refId: rows[0].id,
    });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// Update transfer status (approve/reject/complete)
app.patch("/api/stock-transfers/:id/status", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const { status, rejectionReason } = req.body;
    if (!["APPROVED", "REJECTED", "COMPLETED", "CANCELLED"].includes(status))
      return res.status(400).json({ message: "Invalid status." });

    const branchId = req.user.branchId;
    await client.query("BEGIN");

    // Get the transfer — lock the row to prevent concurrent completions
    const { rows: existing } = await client.query(
      "SELECT * FROM stock_transfers WHERE id=$1 FOR UPDATE", [id]
    );
    if (!existing[0]) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      return res.status(404).json({ message: "Transfer not found." });
    }
    const transfer = existing[0];

    // Only the source branch (from_branch) can approve/complete
    // Only the requesting branch (to_branch) can cancel
    if ((status === "APPROVED" || status === "COMPLETED") && transfer.from_branch_id !== branchId) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      return res.status(403).json({ message: "Only the source branch can approve/complete transfers." });
    }
    if (status === "CANCELLED" && transfer.to_branch_id !== branchId && transfer.from_branch_id !== branchId) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      return res.status(403).json({ message: "Only involved branches can cancel transfers." });
    }

    // Validate status transition
    const validTransitions = {
      PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
      APPROVED: ["COMPLETED", "CANCELLED"],
    };
    if (validTransitions[transfer.status] && !validTransitions[transfer.status].includes(status)) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      return res.status(400).json({ message: `Cannot transition from ${transfer.status} to ${status}.` });
    }
    if (transfer.status === "REJECTED" || transfer.status === "COMPLETED" || transfer.status === "CANCELLED") {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      return res.status(400).json({ message: `Cannot change status from ${transfer.status}.` });
    }

    // Update status
    let updateSQL, updateParams;
    if (status === "REJECTED") {
      updateSQL = `UPDATE stock_transfers SET status=$1, rejection_reason=$2, approved_by=$3, updated_at=NOW() WHERE id=$4 RETURNING *`;
      updateParams = [status, rejectionReason || "", req.user.id, id];
    } else if (status === "COMPLETED") {
      updateSQL = `UPDATE stock_transfers SET status=$1, approved_by=$2, completed_at=NOW(), updated_at=NOW() WHERE id=$3 RETURNING *`;
      updateParams = [status, req.user.id, id];
    } else {
      updateSQL = `UPDATE stock_transfers SET status=$1, approved_by=$2, updated_at=NOW() WHERE id=$3 RETURNING *`;
      updateParams = [status, req.user.id, id];
    }
    const { rows } = await client.query(updateSQL, updateParams);

    // On COMPLETED: deduct stock from source, add stock to destination
    if (status === "COMPLETED") {
      const qty = Number(transfer.quantity);
      // Pre-check: source branch must still have enough stock
      const { rows: biCheck } = await client.query(
        "SELECT quantity FROM branch_inventory WHERE branch_id=$1 AND product_id=$2",
        [transfer.from_branch_id, transfer.product_id]
      );
      if (biCheck[0] && Number(biCheck[0].quantity) < qty) {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
        return res.status(400).json({ message: `Source branch no longer has enough stock. Available: ${biCheck[0].quantity}, requested: ${qty}` });
      }
      // Deduct from global stock
      await client.query(
        "UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2 AND stock >= $1",
        [qty, transfer.product_id]
      );
      // Deduct from source branch_inventory (upsert in case row is missing)
      await client.query(
        `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
         VALUES($2, $3, 0, (SELECT reorder_level FROM products WHERE id = $3))
         ON CONFLICT (branch_id, product_id)
         DO UPDATE SET quantity = GREATEST(0, branch_inventory.quantity - $1), updated_at = NOW()`,
        [qty, transfer.from_branch_id, transfer.product_id]
      );
      // Record inventory movement for source
      await client.query(
        "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,'TRANSFER_OUT',$2,$3,$4,$5)",
        [transfer.product_id, -qty, `TRANSFER-${id}`, req.user.id, `Transfer to branch ${transfer.to_branch_id}`]
      );
      // Add stock to global products
      await client.query(
        "UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2",
        [qty, transfer.product_id]
      );
      // Add to destination branch_inventory (upsert)
      await client.query(
        `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
         VALUES($1, $2, $3, (SELECT reorder_level FROM products WHERE id = $2))
         ON CONFLICT (branch_id, product_id)
         DO UPDATE SET quantity = branch_inventory.quantity + $3, updated_at = NOW()`,
        [transfer.to_branch_id, transfer.product_id, qty]
      );
      // Record inventory movement for destination
      await client.query(
        "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,'TRANSFER_IN',$2,$3,$4,$5)",
        [transfer.product_id, qty, `TRANSFER-${id}`, req.user.id, `Transfer from branch ${transfer.from_branch_id}`]
      );
    }

    // Send notifications based on status change
    try {
      const { rows: pRows } = await pool.query(`SELECT name FROM products WHERE id=$1`, [transfer.product_id]);
      const { rows: fromRows } = await pool.query(`SELECT name FROM branches WHERE id=$1`, [transfer.from_branch_id]);
      const { rows: toRows } = await pool.query(`SELECT name FROM branches WHERE id=$1`, [transfer.to_branch_id]);
      const productName = pRows[0]?.name || 'Unknown';
      const fromBranchName = fromRows[0]?.name || 'Unknown';
      const toBranchName = toRows[0]?.name || 'Unknown';
      const notifMeta = { refType: 'stock_transfer', refId: id };
      if (status === 'APPROVED') {
        await notifyBranchManagers(pool, transfer.to_branch_id, {
          eventType: 'TRANSFER_APPROVED',
          title: `✅ Transfer Approved`,
          body: `${fromBranchName} approved ${transfer.quantity} unit(s) of ${productName} for delivery to ${toBranchName}.`,
          ...notifMeta,
        });
        await notifyBranchManagers(pool, transfer.from_branch_id, {
          eventType: 'TRANSFER_APPROVED',
          title: `✅ Transfer Approved`,
          body: `Transfer of ${transfer.quantity} unit(s) of ${productName} to ${toBranchName} has been approved.`,
          ...notifMeta,
        });
      } else if (status === 'REJECTED') {
        await notifyBranchManagers(pool, transfer.to_branch_id, {
          eventType: 'TRANSFER_REJECTED',
          title: `❌ Transfer Rejected`,
          body: `${fromBranchName} rejected transfer of ${transfer.quantity} unit(s) of ${productName}.${rejectionReason ? ' Reason: ' + rejectionReason : ''}`,
          ...notifMeta,
        });
        await notifyBranchManagers(pool, transfer.from_branch_id, {
          eventType: 'TRANSFER_REJECTED',
          title: `❌ Transfer Rejected`,
          body: `Transfer of ${transfer.quantity} unit(s) of ${productName} to ${toBranchName} has been rejected.${rejectionReason ? ' Reason: ' + rejectionReason : ''}`,
          ...notifMeta,
        });
      } else if (status === 'COMPLETED') {
        await notifyBranchManagers(pool, transfer.to_branch_id, {
          eventType: 'TRANSFER_COMPLETED',
          title: `📦 Transfer Completed`,
          body: `${transfer.quantity} unit(s) of ${productName} have been received from ${fromBranchName}.`,
          ...notifMeta,
        });
        await notifyBranchManagers(pool, transfer.from_branch_id, {
          eventType: 'TRANSFER_COMPLETED',
          title: `📦 Transfer Completed`,
          body: `${transfer.quantity} unit(s) of ${productName} have been delivered to ${toBranchName}.`,
          ...notifMeta,
        });
      } else if (status === 'CANCELLED') {
        const otherBranch = branchId === transfer.from_branch_id ? transfer.to_branch_id : transfer.from_branch_id;
        await notifyBranchManagers(pool, otherBranch, {
          eventType: 'TRANSFER_CANCELLED',
          title: `🚫 Transfer Cancelled`,
          body: `Transfer of ${transfer.quantity} unit(s) of ${productName} between ${fromBranchName} and ${toBranchName} has been cancelled.`,
          ...notifMeta,
        });
      }
    } catch (notifErr) { console.error('[NOTIFICATIONS] Transfer status notify error:', notifErr.message); }

    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// IN-APP NOTIFICATIONS (for stock transfers, alerts, etc.)
// ═══════════════════════════════════════════════════════════════════

async function ensureInAppNotificationsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS in_app_notifications (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        branch_id INT REFERENCES branches(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        reference_type TEXT,
        reference_id INT,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inapp_notif_user_unread ON in_app_notifications(user_id, is_read)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inapp_notif_branch ON in_app_notifications(branch_id)`);
  } catch (e) { console.error("[NOTIFICATIONS] Table setup error:", e.message); }
}
ensureInAppNotificationsTable();

// Helper: create an in-app notification for a user
async function createInAppNotification(pool, { userId, branchId, eventType, title, body, refType, refId }) {
  try {
    await pool.query(
      `INSERT INTO in_app_notifications(user_id, branch_id, event_type, title, body, reference_type, reference_id)
       VALUES($1, $2, $3, $4, $5, $6, $7)`,
      [userId, branchId || null, eventType, title, body || null, refType || null, refId || null]
    );
  } catch (e) { console.error("[NOTIFICATIONS] Create error:", e.message); }
}

// Helper: notify all managers/admins at a branch
async function notifyBranchManagers(pool, branchId, notification) {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE branch_id = $1 AND role IN ('ADMIN','MANAGER') AND is_active = TRUE`,
      [branchId]
    );
    for (const u of rows) {
      await createInAppNotification(pool, { userId: u.id, branchId, ...notification });
    }
  } catch (e) { console.error("[NOTIFICATIONS] Branch notify error:", e.message); }
}

// GET in-app notifications for current user
app.get("/api/in-app-notifications", auth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const unreadOnly = req.query.unread === 'true';
    let sql = `SELECT n.*, b.name AS branch_name FROM in_app_notifications n
               LEFT JOIN branches b ON b.id = n.branch_id
               WHERE n.user_id = $1`;
    const params = [req.user.id];
    if (unreadOnly) { sql += ` AND n.is_read = FALSE`; }
    sql += ` ORDER BY n.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    const { rows } = await pool.query(sql, params);
    const { rows: counts } = await pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE is_read = FALSE)::int AS unread
       FROM in_app_notifications WHERE user_id = $1`, [req.user.id]
    );
    res.json({ notifications: rows, total: counts[0].total, unread: counts[0].unread });
  } catch (e) {
    if (e.message && e.message.includes('does not exist')) return res.json({ notifications: [], total: 0, unread: 0 });
    next(e);
  }
});

// Mark notifications as read
app.patch("/api/in-app-notifications/read", auth, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (Array.isArray(ids) && ids.length) {
      await pool.query(
        `UPDATE in_app_notifications SET is_read = TRUE WHERE id = ANY($1) AND user_id = $2`,
        [ids, req.user.id]
      );
    } else {
      // Mark all as read
      await pool.query(
        `UPDATE in_app_notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`,
        [req.user.id]
      );
    }
    res.json({ message: "Notifications marked as read." });
  } catch (e) {
    if (e.message && e.message.includes('does not exist')) return res.json({ message: "Notifications marked as read." });
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// BRANCH INVENTORY MANAGEMENT (admin per-branch stock control)
// ═══════════════════════════════════════════════════════════════════

// GET /api/branch-inventory — list all products for a branch with stock levels
// Branch admins can only view their own branch; super-admin can view any branch
app.get("/api/branch-inventory", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    // Branch-scoped users are forced to their own branch
    const requestedBranchId = Number(req.query.branchId);
    const branchId = req.user.branchId || requestedBranchId;
    if (!branchId) return res.status(400).json({ message: "branchId required." });
    const { rows } = await pool.query(
      `SELECT p.id, p.barcode, p.name, p.category, p.unit,
             p.price::float, p.cost_price::float,
             COALESCE(bi.quantity, 0)::int AS quantity,
             COALESCE(bi.reorder_level, p.reorder_level)::int AS reorder_level,
             p.reorder_level AS global_reorder_level,
             bi.updated_at AS last_updated
       FROM products p
       LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
       WHERE p.is_active = TRUE
       ORDER BY p.category, p.name`, [branchId]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// PUT /api/branch-inventory/:branchId/:productId — update quantity or reorder level
// Branch admins can only update their own branch; super-admin can update any branch
app.put("/api/branch-inventory/:branchId/:productId", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    let branchId = Number(req.params.branchId);
    const productId = Number(req.params.productId);
    // Branch-scoped users are forced to their own branch
    if (req.user.branchId && branchId !== req.user.branchId)
      return res.status(403).json({ message: "Branch admins can only update inventory for their own branch." });
    if (req.user.branchId) branchId = req.user.branchId;
    const { quantity, reorderLevel } = req.body;
    if (quantity == null && reorderLevel == null)
      return res.status(400).json({ message: "Provide quantity or reorderLevel." });
    // Upsert branch_inventory row
    if (quantity != null) {
      await pool.query(
        `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
         VALUES($1, $2, $3, (SELECT reorder_level FROM products WHERE id = $2))
         ON CONFLICT (branch_id, product_id)
         DO UPDATE SET quantity = $3, updated_at = NOW()`,
        [branchId, productId, Number(quantity)]
      );
    }
    if (reorderLevel != null) {
      await pool.query(
        `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
         VALUES($1, $2, (SELECT COALESCE(quantity, 0) FROM branch_inventory WHERE branch_id = $1 AND product_id = $2), $3)
         ON CONFLICT (branch_id, product_id)
         DO UPDATE SET reorder_level = $3, updated_at = NOW()`,
        [branchId, productId, Number(reorderLevel)]
      );
    }
    // Return updated row
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.category, p.unit,
             COALESCE(bi.quantity, 0)::int AS quantity,
             COALESCE(bi.reorder_level, p.reorder_level)::int AS reorder_level,
             bi.updated_at AS last_updated
       FROM products p
       LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
       WHERE p.id = $2`, [branchId, productId]
    );
    await audit(pool, req.user.id, "UPDATE", "BRANCH_INVENTORY", productId, { branchId, quantity, reorderLevel }, req);
    res.json(rows[0] || {});
  } catch (e) { next(e); }
});

// POST /api/branch-inventory/:branchId/bulk — bulk update multiple products
// Branch admins can only bulk-update their own branch; super-admin can update any branch
app.post("/api/branch-inventory/:branchId/bulk", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    let branchId = Number(req.params.branchId);
    // Branch-scoped users are forced to their own branch
    if (req.user.branchId && branchId !== req.user.branchId)
      return res.status(403).json({ message: "Branch admins can only bulk-update inventory for their own branch." });
    if (req.user.branchId) branchId = req.user.branchId;
    const { items } = req.body; // [{ productId, quantity, reorderLevel }]
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ message: "items array required." });
    const results = [];
    for (const item of items) {
      const productId = Number(item.productId);
      if (!productId) continue;
      if (item.quantity != null) {
        await pool.query(
          `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
           VALUES($1, $2, $3, (SELECT reorder_level FROM products WHERE id = $2))
           ON CONFLICT (branch_id, product_id)
           DO UPDATE SET quantity = $3, updated_at = NOW()`,
          [branchId, productId, Number(item.quantity)]
        );
        results.push({ productId, quantity: Number(item.quantity) });
      }
      if (item.reorderLevel != null) {
        await pool.query(
          `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
           VALUES($1, $2, 0, $3)
           ON CONFLICT (branch_id, product_id)
           DO UPDATE SET reorder_level = $3, updated_at = NOW()`,
          [branchId, productId, Number(item.reorderLevel)]
        );
      }
    }
    await audit(pool, req.user.id, "BULK_UPDATE", "BRANCH_INVENTORY", branchId, { count: results.length }, req);
    res.json({ updated: results.length, message: `${results.length} product(s) updated.` });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// CATEGORY LIST (for dropdowns)
// ═══════════════════════════════════════════════════════════════════

// ── Categories ──────────────────────────────────────────────
app.get("/api/categories", auth, async (_q, r, n) => {
  try {
    r.json((await pool.query("SELECT DISTINCT category FROM products ORDER BY category")).rows.map(r => r.category));
  } catch (e) { n(e); }
});

app.post("/api/categories", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ message: "Category name required." });
    const trimmed = String(name).trim();
    // Check if category already exists (case-insensitive)
    const { rows: existing } = await pool.query(
      "SELECT DISTINCT category FROM products WHERE LOWER(category) = LOWER($1)", [trimmed]
    );
    if (existing.length > 0)
      return res.status(409).json({ message: `Category "${existing[0].category}" already exists.` });
    // Create a placeholder product in this category so it appears in listings
    // Categories are derived from products, so we insert a minimal placeholder
    await pool.query(
      "INSERT INTO products(barcode, name, category, price, cost_price, stock, reorder_level, unit) VALUES($1, $2, $3, 0, 0, 0, 0, 'PCS')",
      [`CAT-${Date.now()}`, `${trimmed} (Category)`, trimmed]
    );
    await audit(pool, req.user.id, "CREATE", "CATEGORY", null, { name: trimmed }, req);
    res.status(201).json({ name: trimmed, message: `Category "${trimmed}" created.` });
  } catch (e) { next(e); }
});

app.delete("/api/categories/:name", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const name = decodeURIComponent(req.params.name);
    // Check if any real products use this category
    const { rows: products } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM products WHERE LOWER(category) = LOWER($1) AND stock > 0",
      [name]
    );
    if (products[0].count > 0)
      return res.status(400).json({ message: `Cannot delete category "${name}" — ${products[0].count} product(s) still have stock in this category.` });
    // Remove placeholder products and products with zero stock in this category
    const { rowCount } = await pool.query(
      "DELETE FROM products WHERE LOWER(category) = LOWER($1) AND stock = 0", [name]
    );
    await audit(pool, req.user.id, "DELETE", "CATEGORY", null, { name, removed: rowCount }, req);
    res.json({ message: `Category "${name}" deleted (${rowCount} placeholder product(s) removed).` });
  } catch (e) { next(e); }
});

app.put("/api/categories/:name", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const oldName = decodeURIComponent(req.params.name);
    const { name: newName } = req.body;
    if (!newName || !String(newName).trim()) return res.status(400).json({ message: "New category name required." });
    const trimmed = String(newName).trim();
    if (trimmed.toLowerCase() === oldName.toLowerCase())
      return res.json({ message: `Category name unchanged.` });
    // Check if new name already exists
    const { rows: existing } = await pool.query(
      "SELECT DISTINCT category FROM products WHERE LOWER(category) = LOWER($1)", [trimmed]
    );
    if (existing.length > 0)
      return res.status(409).json({ message: `Category "${existing[0].category}" already exists.` });
    // Rename all products in this category
    const { rowCount } = await pool.query(
      "UPDATE products SET category = $1, updated_at = NOW() WHERE LOWER(category) = LOWER($2)",
      [trimmed, oldName]
    );
    await audit(pool, req.user.id, "UPDATE", "CATEGORY", null, { from: oldName, to: trimmed, affected: rowCount }, req);
    res.json({ message: `Category renamed from "${oldName}" to "${trimmed}" (${rowCount} product(s) updated).`, affected: rowCount });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 15: COMPREHENSIVE REPORTS
// ═══════════════════════════════════════════════════════════════════

// Monthly Sales Report
app.get("/api/reports/monthly", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const bf = buildBranchFilter(req);
    const params = [year, ...bf.params];
    const branchSql = bf.params.length ? ` AND branch_id = $${1 + bf.params.length}` : "";
    const result = await pool.query(
      `SELECT EXTRACT(MONTH FROM created_at)::int AS month,
              COUNT(*)::int AS transactions,
              COALESCE(SUM(total),0)::float AS revenue,
              COALESCE(SUM(discount),0)::float AS discounts,
              COALESCE(SUM(tax),0)::float AS taxes
       FROM sales WHERE EXTRACT(YEAR FROM created_at) = $1${branchSql}
       GROUP BY 1 ORDER BY 1`, params
    );
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const data = result.rows.map(r => ({ month: months[r.month - 1], ...r }));
    // Look up branch name
    let branchName = null;
    if (bf.targetBranchId) {
      const { rows: bRows } = await pool.query("SELECT name FROM branches WHERE id=$1", [bf.targetBranchId]);
      branchName = bRows[0]?.name || null;
    }
    res.json({ year, data, branchName });
  } catch (e) { next(e); }
});

// Product Sales Report
app.get("/api/reports/product-sales", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    let where = [];
    let params = [];
    let idx = 1;
    // Branch-scoped: branch admins see only their branch; super-admin can filter or see all
    if (req.user.branchId) {
      where.push(`s.branch_id = $${idx++}`);
      params.push(req.user.branchId);
    } else if (req.user.role === "ADMIN" && req.query.branchId) {
      where.push(`s.branch_id = $${idx++}`);
      params.push(Number(req.query.branchId));
    }
    if (from) { where.push(`s.created_at >= $${idx++}`); params.push(from); }
    if (to) { where.push(`s.created_at <= $${idx++}`); params.push(to + "T23:59:59"); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const result = await pool.query(
      `SELECT si.product_name AS name, p.category, SUM(si.quantity)::int AS qty,
              SUM(si.line_total)::float AS revenue, p.stock AS current_stock
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
       JOIN sales s ON s.id = si.sale_id ${w}
       GROUP BY si.product_name, p.category, p.stock
       ORDER BY revenue DESC`, params
    );
    res.json(result.rows);
  } catch (e) { next(e); }
});

// Low Stock Report
app.get("/api/reports/low-stock", auth, allow("ADMIN", "MANAGER"), async (req, r, n) => {
  try {
    // Support admin branch selection via query param, fallback to user's branch
    const branchId = req.query.branchId ? Number(req.query.branchId) : req.user.branchId;
    if (branchId) {
      // Branch-aware: use branch_inventory for per-branch stock levels
      r.json((await pool.query(
        `SELECT p.id, p.barcode, p.name, p.category, COALESCE(bi.quantity, 0)::int AS stock,
                COALESCE(bi.reorder_level, p.reorder_level)::int AS reorder_level,
                p.price::float, p.cost_price::float,
                CASE WHEN COALESCE(bi.quantity, 0) = 0 THEN 'OUT OF STOCK'
                     WHEN COALESCE(bi.quantity, 0) <= COALESCE(bi.reorder_level, p.reorder_level) THEN 'LOW'
                     ELSE 'OK' END AS status
         FROM products p
         LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
         WHERE p.is_active = TRUE AND COALESCE(bi.quantity, 0) <= COALESCE(bi.reorder_level, p.reorder_level)
         ORDER BY COALESCE(bi.quantity, 0) ASC`, [branchId]
      )).rows);
    } else {
      r.json((await pool.query(
        `SELECT id, barcode, name, category, stock, reorder_level, price::float, cost_price::float,
                CASE WHEN stock = 0 THEN 'OUT OF STOCK'
                     WHEN stock <= reorder_level THEN 'LOW'
                     ELSE 'OK' END AS status
         FROM products WHERE stock <= reorder_level AND is_active = TRUE
         ORDER BY stock ASC`
      )).rows);
    }
  } catch (e) { n(e); }
});

// Cashier Sales Report
app.get("/api/reports/cashier-sales", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    let where = [];
    let params = [];
    let idx = 1;
    // Branch-scoped: branch admins see only their branch; super-admin can filter or see all
    if (req.user.branchId) {
      where.push(`s.branch_id = $${idx++}`);
      params.push(req.user.branchId);
    } else if (req.user.role === "ADMIN" && req.query.branchId) {
      where.push(`s.branch_id = $${idx++}`);
      params.push(Number(req.query.branchId));
    }
    if (from) { where.push(`s.created_at >= $${idx++}`); params.push(from); }
    if (to) { where.push(`s.created_at <= $${idx++}`); params.push(to + "T23:59:59"); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const result = await pool.query(
      `SELECT u.name AS cashier_name, u.email,
              COUNT(s.id)::int AS transactions,
              COALESCE(SUM(s.total),0)::float AS revenue,
              COALESCE(AVG(s.total),0)::float AS avg_sale
       FROM sales s JOIN users u ON u.id = s.cashier_id ${w}
       GROUP BY u.id, u.name, u.email
       ORDER BY revenue DESC`, params
    );
    res.json(result.rows);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 15: DAILY REPORTS & EMAIL
// ═══════════════════════════════════════════════════════════════════

app.get("/api/reports/daily", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const startDate = `${date}T00:00:00`;
    const endDate = `${date}T23:59:59`;

    // Branch-scoped: ADMIN can pick a branch via ?branchId=X
    const bf = buildBranchFilter(req);
    const saleBranchSql = bf.params.length ? ` AND s.branch_id = $${2 + bf.params.length}` : "";
    const expBranchSql = bf.params.length ? ` AND e.branch_id = $${2 + bf.params.length}` : "";
    const saleBaseParams = [startDate, endDate];
    const saleParams = [...saleBaseParams, ...bf.params];
    const expParams = [...saleBaseParams, ...bf.params];

    const [salesResult, itemsResult, expensesResult, topProducts] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total_transactions,
                COALESCE(SUM(s.total),0)::float AS total_revenue,
                COALESCE(SUM(s.subtotal),0)::float AS subtotal,
                COALESCE(SUM(s.discount),0)::float AS total_discount,
                COALESCE(SUM(s.tax),0)::float AS total_tax,
                COALESCE(SUM(s.amount_paid),0)::float AS total_paid,
                COALESCE(SUM(s.change_amount),0)::float AS total_change
         FROM sales s WHERE s.created_at BETWEEN $1 AND $2${saleBranchSql}`, saleParams
      ),
      pool.query(
        `SELECT si.product_name, SUM(si.quantity)::int AS qty, SUM(si.line_total)::float AS revenue
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.created_at BETWEEN $1 AND $2${saleBranchSql}
         GROUP BY si.product_name ORDER BY revenue DESC`, saleParams
      ),
      pool.query(
        `SELECT COALESCE(SUM(e.amount),0)::float AS total_expenses
         FROM expenses e WHERE e.created_at BETWEEN $1 AND $2${expBranchSql}`, expParams
      ),
      pool.query(
        `SELECT si.product_name, SUM(si.quantity)::int AS qty, SUM(si.line_total)::float AS revenue
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.created_at BETWEEN $1 AND $2${saleBranchSql}
         GROUP BY si.product_name ORDER BY revenue DESC LIMIT 10`, saleParams
      )
    ]);

    const sales = salesResult.rows[0];
    const expenses = expensesResult.rows[0].total_expenses;
    const revenue = sales.total_revenue;

    // Look up branch name for the response
    let branchName = null;
    if (req.user.branchId) {
      const { rows: bRows } = await pool.query("SELECT name FROM branches WHERE id=$1", [req.user.branchId]);
      branchName = bRows[0]?.name || null;
    }

    res.json({
      date,
      branchName,
      summary: {
        totalTransactions: sales.total_transactions,
        totalRevenue: revenue,
        subtotal: sales.subtotal,
        totalDiscount: sales.total_discount,
        totalTax: sales.total_tax,
        totalPaid: sales.total_paid,
        totalChange: sales.total_change,
        totalExpenses: expenses,
        netProfit: revenue - expenses,
      },
      itemsSold: itemsResult.rows,
      topProducts: topProducts.rows,
    });
  } catch (e) { next(e); }
});

app.post("/api/reports/daily/email", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    if (!resend) return res.status(503).json({ message: "Email not configured. Add RESEND_API_KEY to .env" });

    const { date, recipientEmail } = req.body;
    if (!recipientEmail) return res.status(400).json({ message: "Recipient email required." });

    const reportDate = date || new Date().toISOString().slice(0, 10);
    const startDate = `${reportDate}T00:00:00`;
    const endDate = `${reportDate}T23:59:59`;

    // Branch-scoped: MANAGERs see only their branch
    const bf = buildBranchFilter(req);
    const saleBranchSql = bf.params.length ? ` AND s.branch_id = $${2 + bf.params.length}` : "";
    const expBranchSql = bf.params.length ? ` AND e.branch_id = $${2 + bf.params.length}` : "";
    const saleParams = [startDate, endDate, ...bf.params];
    const expParams = [startDate, endDate, ...bf.params];

    const [salesResult, itemsResult, expensesResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total_transactions,
                COALESCE(SUM(s.total),0)::float AS total_revenue,
                COALESCE(SUM(s.discount),0)::float AS total_discount,
                COALESCE(SUM(s.tax),0)::float AS total_tax
         FROM sales s WHERE s.created_at BETWEEN $1 AND $2${saleBranchSql}`, saleParams
      ),
      pool.query(
        `SELECT si.product_name, SUM(si.quantity)::int AS qty, SUM(si.line_total)::float AS revenue
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.created_at BETWEEN $1 AND $2${saleBranchSql}
         GROUP BY si.product_name ORDER BY revenue DESC LIMIT 15`, saleParams
      ),
      pool.query(
        `SELECT COALESCE(SUM(e.amount),0)::float AS total_expenses
         FROM expenses e WHERE e.created_at BETWEEN $1 AND $2${expBranchSql}`, expParams
      )
    ]);

    const sales = salesResult.rows[0];
    const expenses = expensesResult.rows[0].total_expenses;
    const revenue = sales.total_revenue;
    const profit = revenue - expenses;

    const fmt = (n) => "\u20A6" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });

    // Build HTML email
    const itemsHTML = itemsResult.rows.map((item, i) =>
      `<tr style="border-bottom:1px solid #eee">
        <td style="padding:8px">${i + 1}</td>
        <td style="padding:8px">${item.product_name}</td>
        <td style="padding:8px;text-align:center">${item.qty}</td>
        <td style="padding:8px;text-align:right">${fmt(item.revenue)}</td>
      </tr>`
    ).join("");

    // Look up branch name for the email header
    let branchName = "";
    if (req.user.branchId) {
      const { rows: bRows } = await pool.query("SELECT name FROM branches WHERE id=$1", [req.user.branchId]);
      branchName = bRows[0]?.name || "";
    }

    const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:#16a34a;color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center">
        <h1 style="margin:0;font-size:22px">🛍 RHoSAM Daily Sales Report</h1>
        <p style="margin:5px 0 0;opacity:0.9">${reportDate}${branchName ? ` — ${branchName}` : ""}</p>
      </div>

      <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb">
        <h2 style="margin:0 0 12px;font-size:16px;color:#374151">Summary</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#6b7280">Total Transactions</td><td style="padding:6px 0;text-align:right;font-weight:bold">${sales.total_transactions}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Total Revenue</td><td style="padding:6px 0;text-align:right;font-weight:bold;color:#16a34a">${fmt(revenue)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Discounts</td><td style="padding:6px 0;text-align:right;color:#b45309">-${fmt(sales.total_discount)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Tax</td><td style="padding:6px 0;text-align:right">${fmt(sales.total_tax)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Expenses</td><td style="padding:6px 0;text-align:right;color:#b42318">${fmt(expenses)}</td></tr>
          <tr style="border-top:2px solid #374151">
            <td style="padding:8px 0;font-weight:bold;font-size:15px">Net Profit</td>
            <td style="padding:8px 0;text-align:right;font-weight:bold;font-size:15px;color:${profit >= 0 ? '#16a34a' : '#b42318'}">${fmt(profit)}</td>
          </tr>
        </table>
      </div>

      ${itemsResult.rows.length ? `
      <div style="background:white;padding:20px;border:1px solid #e5e7eb;border-top:none">
        <h2 style="margin:0 0 12px;font-size:16px;color:#374151">Items Sold (${itemsResult.rows.length} products)</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f3f4f6">
            <th style="padding:8px;text-align:left">#</th>
            <th style="padding:8px;text-align:left">Product</th>
            <th style="padding:8px;text-align:center">Qty</th>
            <th style="padding:8px;text-align:right">Revenue</th>
          </tr></thead>
          <tbody>${itemsHTML}</tbody>
        </table>
      </div>` : ''}

      <div style="text-align:center;padding:16px;color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb">
        RHoSAM Supermarket POS • Generated ${new Date().toLocaleString('en-NG')}
      </div>
    </div>`;

    const { data, error } = await resend.emails.send({
      from: "RHoSAM Reports <onboarding@resend.dev>",
      to: recipientEmail,
      subject: `RHoSAM Daily Report${branchName ? ` — ${branchName}` : ""} — ${reportDate} — Revenue: ${fmt(revenue)}`,
      html,
    });

    if (error) {
      console.error("[EMAIL ERROR]", error);
      return res.status(500).json({ message: error.message || "Failed to send email." });
    }

    await audit(pool, req.user.id, "SEND_REPORT", "DAILY_REPORT", null, { date: reportDate, recipient: recipientEmail }, req);
    res.json({ message: "Report sent successfully.", id: data?.id });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 16: AI FORECASTING & DEMAND PREDICTION
// ═══════════════════════════════════════════════════════════════════

app.get("/api/forecast/demand", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const productId = req.query.product_id;
    // Get 90 days of sales data per product
    let sql = `
      SELECT si.product_id, p.name AS product_name, p.stock AS current_stock,
             p.reorder_level, p.cost_price::float, p.price::float,
             DATE(s.created_at) AS sale_date,
             SUM(si.quantity)::int AS daily_qty
      FROM sale_items si
      JOIN products p ON p.id = si.product_id
      JOIN sales s ON s.id = si.sale_id
      WHERE s.created_at >= NOW() - INTERVAL '90 days'`;
    const params = [];
    let paramIdx = 1;
    // Branch scoping
    if (req.user.role === "ADMIN" && req.query.branchId) {
      sql += ` AND s.branch_id = $${paramIdx++}`;
      params.push(Number(req.query.branchId));
    } else if (req.user.role !== "ADMIN" && req.user.branchId) {
      sql += ` AND s.branch_id = $${paramIdx++}`;
      params.push(req.user.branchId);
    }
    if (productId) { sql += ` AND si.product_id = $${paramIdx++}`; params.push(Number(productId)); }
    sql += ` GROUP BY si.product_id, p.name, p.stock, p.reorder_level, p.cost_price, p.price, DATE(s.created_at) ORDER BY sale_date`;

    const { rows: salesData } = await pool.query(sql, params);

    // Group by product and calculate simple moving average forecast
    const productMap = {};
    for (const row of salesData) {
      if (!productMap[row.product_id]) {
        productMap[row.product_id] = {
          productId: row.product_id,
          productName: row.product_name,
          currentStock: row.current_stock,
          reorderLevel: row.reorder_level,
          costPrice: row.cost_price,
          price: row.price,
          dailySales: [],
        };
      }
      productMap[row.product_id].dailySales.push({ date: row.sale_date, qty: row.daily_qty });
    }

    const forecasts = Object.values(productMap).map(p => {
      const sales = p.dailySales.map(d => d.qty);
      const n = sales.length;
      if (n === 0) return { ...p, avgDaily: 0, predicted7Day: 0, predicted30Day: 0, daysUntilStockout: Infinity, risk: 'UNKNOWN' };

      // Simple moving average (last 7 days weighted heavier)
      const recent7 = sales.slice(-7);
      const recent30 = sales.slice(-30);
      const avgRecent7 = recent7.reduce((a, b) => a + b, 0) / recent7.length;
      const avgRecent30 = recent30.reduce((a, b) => a + b, 0) / (recent30.length || 1);
      const avgDaily = avgRecent7 * 0.7 + avgRecent30 * 0.3;

      const predicted7Day = Math.round(avgDaily * 7);
      const predicted30Day = Math.round(avgDaily * 30);
      const daysUntilStockout = avgDaily > 0 ? Math.floor(p.currentStock / avgDaily) : Infinity;

      let risk = 'LOW';
      if (daysUntilStockout <= 3) risk = 'CRITICAL';
      else if (daysUntilStockout <= 7) risk = 'HIGH';
      else if (daysUntilStockout <= 14) risk = 'MEDIUM';

      return {
        productId: p.productId,
        productName: p.productName,
        currentStock: p.currentStock,
        reorderLevel: p.reorderLevel,
        costPrice: p.costPrice,
        price: p.price,
        avgDaily: Math.round(avgDaily * 10) / 10,
        predicted7Day,
        predicted30Day,
        daysUntilStockout,
        risk,
      };
    });

    // Sort by risk (CRITICAL first)
    const riskOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };
    forecasts.sort((a, b) => (riskOrder[a.risk] || 4) - (riskOrder[b.risk] || 4));

    res.json(forecasts);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 16: AUTO REORDER
// ═══════════════════════════════════════════════════════════════════

app.get("/api/auto-reorder/suggestions", auth, allow("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : req.user.branchId;
    let lowStock;
    if (branchId) {
      // Branch-aware: show low stock products for this specific branch
      const result = await pool.query(
        `SELECT p.id, p.barcode, p.name, p.category, COALESCE(bi.quantity, 0)::int AS stock,
                COALESCE(bi.reorder_level, p.reorder_level)::int AS reorder_level,
                p.cost_price::float, p.price::float
         FROM products p
         LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
         WHERE p.is_active = TRUE AND COALESCE(bi.quantity, 0) <= COALESCE(bi.reorder_level, p.reorder_level)
         ORDER BY (COALESCE(bi.quantity, 0)::float / GREATEST(COALESCE(bi.reorder_level, p.reorder_level), 1)) ASC`,
        [branchId]
      );
      lowStock = result.rows;
    } else {
      const result = await pool.query(
        `SELECT p.id, p.barcode, p.name, p.category, p.stock, p.reorder_level,
                p.cost_price::float, p.price::float
         FROM products p
         WHERE p.stock <= p.reorder_level AND p.is_active = TRUE
         ORDER BY (p.stock::float / GREATEST(p.reorder_level, 1)) ASC`
      );
      lowStock = result.rows;
    }
    const { rows: suppliers } = await pool.query("SELECT id, name FROM suppliers WHERE is_active = TRUE ORDER BY name LIMIT 1");
    const defaultSupplier = suppliers[0] || null;
    const suggestions = lowStock.map(p => {
      const suggestedQty = Math.max(p.reorder_level * 3, 20);
      const totalCost = suggestedQty * p.cost_price;
      return { ...p, supplier_name: defaultSupplier?.name || null, supplier_id: defaultSupplier?.id || null, suggestedQty, totalCost };
    });
    res.json(suggestions);
  } catch (e) { console.error("[AUTO-REORDER]", e.message); res.status(500).json({ message: e.message }); }
});

app.post("/api/auto-reorder/create", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { items } = req.body; // [{ productId, supplierId, quantity, unitCost }]
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ message: "Items required." });

    // Group by supplier
    const supplierGroups = {};
    for (const item of items) {
      const sid = item.supplierId;
      if (!supplierGroups[sid]) supplierGroups[sid] = [];
      supplierGroups[sid].push(item);
    }

    const created = [];
    await client.query("BEGIN");

    for (const [supplierId, supplierItems] of Object.entries(supplierGroups)) {
      let total = 0;
      const poNumber = `AUTO-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

      const { rows: poRows } = await client.query(
        `INSERT INTO purchase_orders(po_number,supplier_id,notes,created_by)
         VALUES($1,$2,$3,$4) RETURNING id`,
        [poNumber, Number(supplierId), "Auto-generated reorder", req.user.id]
      );
      const poId = poRows[0].id;

      for (const item of supplierItems) {
        const qty = Number(item.quantity);
        const cost = Number(item.unitCost);
        const lineTotal = qty * cost;
        total += lineTotal;
        await client.query(
          "INSERT INTO purchase_order_items(po_id,product_id,quantity,unit_cost,line_total) VALUES($1,$2,$3,$4,$5)",
          [poId, item.productId, qty, cost, lineTotal]
        );
      }

      await client.query("UPDATE purchase_orders SET total=$1 WHERE id=$2", [total, poId]);
      await audit(client, req.user.id, "AUTO_REORDER", "PURCHASE_ORDER", poId, { poNumber, supplierId, total }, req);
      created.push({ poId, poNumber, supplierId: Number(supplierId), total });
    }

    await client.query("COMMIT");
    res.status(201).json({ message: `Created ${created.length} purchase order(s).`, orders: created });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 16: EXECUTIVE DASHBOARD
// ═══════════════════════════════════════════════════════════════════

app.get("/api/executive/overview", auth, requireSuperAdmin, async (req, res) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    const bf = branchId ? ` AND branch_id = $1` : '';
    const bfParams = branchId ? [branchId] : [];
    const siBf = branchId ? ` AND s.branch_id = $1` : '';
    const queries = [
      pool.query(`SELECT
        COALESCE(SUM(total),0)::float AS total_revenue,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN total END),0)::float AS week_revenue,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN total END),0)::float AS month_revenue,
        COUNT(*)::int AS total_transactions,
        COALESCE(AVG(total),0)::float AS avg_transaction
       FROM sales WHERE 1=1${bf}`, bfParams),
      pool.query(`SELECT
        COALESCE(SUM(amount),0)::float AS total_expenses,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN amount END),0)::float AS month_expenses
       FROM expenses WHERE 1=1${bf}`, bfParams),
      pool.query(`SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN stock <= reorder_level THEN 1 END)::int AS low_stock,
        COUNT(CASE WHEN stock = 0 THEN 1 END)::int AS out_of_stock
       FROM products WHERE is_active = TRUE`),
      pool.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(total_spent),0)::float AS total_spent, COALESCE(AVG(total_spent),0)::float AS avg_spent FROM customers`),
      pool.query(`SELECT date_trunc('day',created_at)::date AS day,
        COUNT(*)::int AS transactions, COALESCE(SUM(total),0)::float AS revenue
       FROM sales WHERE created_at >= NOW() - INTERVAL '30 days'${bf}
       GROUP BY 1 ORDER BY 1`, bfParams),
      pool.query(`SELECT u.name, COUNT(s.id)::int AS transactions, COALESCE(SUM(s.total),0)::float AS revenue
       FROM sales s JOIN users u ON u.id = s.cashier_id
       WHERE s.created_at >= NOW() - INTERVAL '30 days'${siBf}
       GROUP BY u.id, u.name ORDER BY revenue DESC LIMIT 5`, bfParams),
      pool.query(`SELECT p.category, SUM(si.line_total)::float AS revenue, SUM(si.quantity)::int AS qty
       FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= NOW() - INTERVAL '30 days'${siBf}
       GROUP BY p.category ORDER BY revenue DESC`, bfParams),
      pool.query(`SELECT p.name, p.stock, p.reorder_level
       FROM products p WHERE p.stock <= p.reorder_level AND p.is_active = TRUE
       ORDER BY p.stock ASC LIMIT 10`)
    ];
    const results = await Promise.allSettled(queries);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) console.error('[EXECUTIVE]', failed.map(f => f.reason?.message).join('; '));
    const [revenue, expenses, products, customers, salesTrend, topCashiers, categoryBreakdown, recentAlerts] = results.map(r => r.status === 'fulfilled' ? r.value : { rows: [] });

    const r2 = revenue.rows[0];
    const e2 = expenses.rows[0];
    const p2 = products.rows[0];
    const c2 = customers.rows[0];

    res.json({
      revenue: {
        total: r2.total_revenue, week: r2.week_revenue, month: r2.month_revenue,
        transactions: r2.total_transactions, avgTransaction: r2.avg_transaction,
      },
      expenses: { total: e2.total_expenses, month: e2.month_expenses },
      profit: { total: r2.total_revenue - e2.total_expenses, month: r2.month_revenue - e2.month_expenses },
      products: { total: p2.total, lowStock: p2.low_stock, outOfStock: p2.out_of_stock },
      customers: { total: c2.total, totalSpent: c2.total_spent, avgSpent: c2.avg_spent },
      salesTrend: salesTrend.rows,
      topCashiers: topCashiers.rows,
      categoryBreakdown: categoryBreakdown.rows,
      alerts: recentAlerts.rows,
    });
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 16: CUSTOMER DISPLAY
// ═══════════════════════════════════════════════════════════════════

app.get("/api/customer-display/:saleId", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.saleId);
    const { rows: saleRows } = await pool.query(
      `SELECT s.*, u.name AS cashier_name FROM sales s JOIN users u ON u.id = s.cashier_id WHERE s.id=$1`, [id]
    );
    if (!saleRows[0]) return res.status(404).json({ message: "Sale not found." });
    const { rows: items } = await pool.query("SELECT * FROM sale_items WHERE sale_id=$1", [id]);
    res.json({ ...saleRows[0], items, display: true });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 16: SUPPLIER PORTAL
// ═══════════════════════════════════════════════════════════════════

app.get("/api/supplier-portal/orders/:supplierId", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.supplierId);
    const { rows } = await pool.query(
      `SELECT po.*, u.name AS created_by_name
       FROM purchase_orders po JOIN users u ON u.id = po.created_by
       WHERE po.supplier_id = $1 ORDER BY po.created_at DESC`, [id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.get("/api/supplier-portal/order/:id", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: poRows } = await pool.query(
      `SELECT po.*, s.name AS supplier_name FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id WHERE po.id=$1`, [id]
    );
    if (!poRows[0]) return res.status(404).json({ message: "Order not found." });
    const { rows: items } = await pool.query(
      `SELECT poi.*, p.name AS product_name FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id WHERE poi.po_id=$1`, [id]
    );
    res.json({ ...poRows[0], items });
  } catch (e) { next(e); }
});

app.patch("/api/supplier-portal/order/:id/confirm", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      "UPDATE purchase_orders SET status='APPROVED', updated_at=NOW() WHERE id=$1 AND status='PENDING' RETURNING *", [id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Order not found or not pending." });
    await audit(pool, req.user.id, "SUPPLIER_CONFIRM", "PURCHASE_ORDER", id, {}, req);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 16: EMAIL RECEIPT
// ═══════════════════════════════════════════════════════════════════

app.post("/api/sales/:id/email-receipt", auth, async (req, res, next) => {
  try {
    if (!resend) return res.status(503).json({ message: "Email not configured. Add RESEND_API_KEY to .env" });

    const saleId = Number(req.params.id);
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Customer email required." });

    const { rows: saleRows } = await pool.query(
      `SELECT s.*, u.name AS cashier_name FROM sales s JOIN users u ON u.id = s.cashier_id WHERE s.id=$1`, [saleId]
    );
    if (!saleRows[0]) return res.status(404).json({ message: "Sale not found." });

    const { rows: items } = await pool.query("SELECT * FROM sale_items WHERE sale_id=$1", [saleId]);
    const sale = saleRows[0];

    const fmt = (n) => "\u20A6" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });
    const dateStr = new Date(sale.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });

    // Build items HTML
    const itemsHTML = items.map((item, i) =>
      `<tr style="border-bottom:1px solid #e5e7eb">
        <td style="padding:10px 8px">${item.product_name}</td>
        <td style="padding:10px 8px;text-align:center">${item.quantity}</td>
        <td style="padding:10px 8px;text-align:right">${fmt(item.unit_price)}</td>
        <td style="padding:10px 8px;text-align:right;font-weight:600">${fmt(item.line_total)}</td>
      </tr>`
    ).join("");

    const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px">
      <div style="background:#16a34a;color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="margin:0;font-size:22px">🛍 RHoSAM Supermarket</h1>
        <p style="margin:6px 0 0;opacity:0.9;font-size:14px">Your Receipt</p>
      </div>

      <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:14px;color:#374151">
          <div>
            <p style="margin:2px 0"><strong>Receipt:</strong> ${sale.receipt_number}</p>
            <p style="margin:2px 0"><strong>Date:</strong> ${dateStr}</p>
            <p style="margin:2px 0"><strong>Cashier:</strong> ${sale.cashier_name}</p>
          </div>
          <div style="text-align:right">
            <p style="margin:2px 0"><strong>Payment:</strong> ${sale.payment_method}</p>
            <p style="margin:2px 0"><strong>Customer:</strong> ${sale.customer_name || 'Walk-in'}</p>
          </div>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
          <thead><tr style="background:#e5e7eb">
            <th style="padding:10px 8px;text-align:left">Item</th>
            <th style="padding:10px 8px;text-align:center">Qty</th>
            <th style="padding:10px 8px;text-align:right">Price</th>
            <th style="padding:10px 8px;text-align:right">Total</th>
          </tr></thead>
          <tbody>${itemsHTML}</tbody>
        </table>

        <div style="border-top:2px solid #374151;padding-top:12px;margin-top:12px">
          <table style="width:100%;font-size:14px">
            <tr><td style="padding:4px 0;color:#6b7280">Subtotal</td><td style="padding:4px 0;text-align:right">${fmt(sale.subtotal)}</td></tr>
            ${Number(sale.discount) > 0 ? `<tr><td style="padding:4px 0;color:#b45309">Discount</td><td style="padding:4px 0;text-align:right;color:#b45309">-${fmt(sale.discount)}</td></tr>` : ''}
            ${Number(sale.tax) > 0 ? `<tr><td style="padding:4px 0;color:#6b7280">Tax</td><td style="padding:4px 0;text-align:right">${fmt(sale.tax)}</td></tr>` : ''}
            <tr style="border-top:2px solid #374151">
              <td style="padding:10px 0;font-size:18px;font-weight:bold">TOTAL</td>
              <td style="padding:10px 0;text-align:right;font-size:18px;font-weight:bold;color:#16a34a">${fmt(sale.total)}</td>
            </tr>
          </table>
        </div>

        ${Number(sale.amount_paid) > 0 ? `<div style="margin-top:8px;font-size:14px;color:#6b7280">
          <p style="margin:2px 0">Paid: ${fmt(sale.amount_paid)}</p>
          ${Number(sale.change_amount) > 0 ? `<p style="margin:2px 0"><strong>Change: ${fmt(sale.change_amount)}</strong></p>` : ''}
        </div>` : ''}
      </div>

      <div style="text-align:center;padding:20px;color:#9ca3af;font-size:13px">
        <p style="margin:0 0 4px;color:#16a34a;font-weight:600;font-size:15px">Thank you for shopping with us!</p>
        <p style="margin:0">We appreciate your business. Visit us again soon!</p>
        <p style="margin:12px 0 0;font-size:11px">RHoSAM Supermarket POS • ${dateStr}</p>
      </div>
    </div>`;

    const { data, error } = await resend.emails.send({
      from: "RHoSAM Receipts <onboarding@resend.dev>",
      to: email,
      subject: `RHoSAM Receipt — ${sale.receipt_number} — ${fmt(sale.total)}`,
      html,
    });

    if (error) {
      console.error("[EMAIL RECEIPT ERROR]", error);
      return res.status(500).json({ message: error.message || "Failed to send email." });
    }

    // Note: Receipt email sent successfully. We intentionally do NOT overwrite
    // customer_name with the email address — that field stores the customer's name.
    // If a customer_email column is added in the future, store it there instead.

    await audit(pool, req.user.id, "EMAIL_RECEIPT", "SALE", saleId, { email, receiptNumber: sale.receipt_number }, req);
    res.json({ message: "Receipt sent successfully.", id: data?.id });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 16: OFFLINE SYNC
// ═══════════════════════════════════════════════════════════════════

app.post("/api/sync/sales", auth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { sales } = req.body; // Array of offline sales to sync
    if (!Array.isArray(sales) || !sales.length)
      return res.status(400).json({ message: "No sales to sync." });

    const results = [];
    await client.query("BEGIN");

    for (const sale of sales) {
      try {
        let subtotal = 0;
        for (const item of (sale.items || [])) {
          const { rows } = await client.query("SELECT price::float, stock FROM products WHERE id=$1 FOR UPDATE", [item.productId]);
          const product = rows[0];
          if (!product) continue;
          if (product.stock < item.quantity) continue;
          subtotal += product.price * item.quantity;
        }

        const receiptNumber = sale.receiptNumber || `SYNC-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
        const total = subtotal - Number(sale.discount || 0) + Number(sale.tax || 0);
        const saleBranchId = req.user.branchId || null;

        const { rows } = await client.query(
          `INSERT INTO sales(receipt_number,customer_name,payment_method,subtotal,discount,tax,total,amount_paid,change_amount,cashier_id,branch_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [receiptNumber, sale.customerName || "Walk-in Customer", sale.paymentMethod || "Cash",
           subtotal, sale.discount || 0, sale.tax || 0, total, sale.amountPaid || total, 0, req.user.id, saleBranchId]
        );

        for (const item of (sale.items || [])) {
          const { rows: pRows } = await client.query("SELECT price::float FROM products WHERE id=$1", [item.productId]);
          if (pRows[0]) {
            await client.query(
              "INSERT INTO sale_items(sale_id,product_id,product_name,unit_price,quantity,discount,line_total) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [rows[0].id, item.productId, item.name || 'Product', pRows[0].price, item.quantity, item.discount || 0, pRows[0].price * item.quantity]
            );
            await client.query("UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2", [item.quantity, item.productId]);
            // Also deduct from branch_inventory if branch is assigned
            if (saleBranchId) {
              await client.query(
                `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
                 VALUES($2, $3, 0, (SELECT reorder_level FROM products WHERE id = $3))
                 ON CONFLICT (branch_id, product_id)
                 DO UPDATE SET quantity = GREATEST(0, branch_inventory.quantity - $1), updated_at = NOW()`,
                [item.quantity, saleBranchId, item.productId]
              );
            }
            await client.query(
              "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id) VALUES($1,'SALE',$2,$3,$4)",
              [item.productId, -item.quantity, receiptNumber, req.user.id]
            );
          }
        }

        results.push({ localId: sale.localId, serverId: rows[0].id, receiptNumber, status: 'synced' });
      } catch (err) {
        results.push({ localId: sale.localId, status: 'failed', error: err.message });
      }
    }

    await client.query("COMMIT");
    res.json({ synced: results.filter(r => r.status === 'synced').length, failed: results.filter(r => r.status === 'failed').length, results });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); next(e); }
  finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// PAYMENT GATEWAY VERIFICATION
// ═══════════════════════════════════════════════════════════════════

app.post("/api/payments/verify", auth, async (req, res, next) => {
  try {
    const { saleId, gateway = "INTERNAL", reference, cardLast4, authCode, gatewayResponse } = req.body;
    if (!saleId || !reference)
      return res.status(400).json({ message: "saleId and reference are required." });

    const { rows: saleRows } = await pool.query("SELECT id, total, payment_method FROM sales WHERE id=$1", [Number(saleId)]);
    if (!saleRows[0]) return res.status(404).json({ message: "Sale not found." });

    // For non-cash payments, verify reference hasn't been used
    if (saleRows[0].payment_method !== "Cash") {
      const { rows: existing } = await pool.query(
        "SELECT id FROM payment_verifications WHERE reference=$1 AND status='VERIFIED'", [reference]
      );
      if (existing[0])
        return res.status(409).json({ message: "Payment reference already verified for another transaction." });
    }

    // Real gateway verification via API
    let verified = false;
    let gatewayResponseData = {};
    const activeGateway = getActiveGateway();

    if (gateway === "INTERNAL" || saleRows[0].payment_method === "Cash") {
      // Cash / internal: always verified
      verified = true;
    } else if (activeGateway === "PAYSTACK" && paystackSecretKey) {
      try {
        const result = await paystack.verifyTransaction(reference);
        verified = result.status === "success" && result.amount === Math.round(saleRows[0].total * 100);
        gatewayResponseData = result;
      } catch (err) {
        console.error("[PAYSTACK] Verification failed:", err.message);
        gatewayResponseData = { error: err.message };
      }
    } else if (activeGateway === "FLUTTERWAVE" && flutterwaveSecretKey) {
      try {
        const result = await flutterwave.verifyTransaction(reference);
        verified = result.status === "successful" && Math.abs(result.amount - saleRows[0].total) < 1;
        gatewayResponseData = result;
      } catch (err) {
        console.error("[FLUTTERWAVE] Verification failed:", err.message);
        gatewayResponseData = { error: err.message };
      }
    } else {
      // No gateway configured — mark as verified (manual confirmation)
      verified = true;
      gatewayResponseData = { note: "No payment gateway configured — manual verification" };
    }

    const status = verified ? "VERIFIED" : "FAILED";
    const verifiedAt = verified ? new Date() : null;

    const { rows } = await pool.query(
      `INSERT INTO payment_verifications(sale_id,gateway,reference,status,amount,card_last4,auth_code,gateway_response,verified_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,       [Number(saleId), gateway, reference, status, saleRows[0].total,
       cardLast4 || null, authCode || null, JSON.stringify(gatewayResponseData), verifiedAt]
    );

    await audit(pool, req.user.id, "VERIFY_PAYMENT", "SALE", saleId, { gateway, reference, status }, req);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.get("/api/payments/verify/:saleId", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM payment_verifications WHERE sale_id=$1 ORDER BY created_at DESC", [Number(req.params.saleId)]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ── Payment Initialization (for Card/Transfer/POS) ─────────────
app.post("/api/payments/initialize", auth, async (req, res, next) => {
  try {
    const { saleId, email } = req.body;
    if (!saleId) return res.status(400).json({ message: "saleId is required." });

    const { rows: saleRows } = await pool.query("SELECT id, total, receipt_number, payment_method FROM sales WHERE id=$1", [Number(saleId)]);
    if (!saleRows[0]) return res.status(404).json({ message: "Sale not found." });
    if (saleRows[0].payment_method === "Cash")
      return res.status(400).json({ message: "Cash payments don't need gateway initialization." });

    const activeGateway = getActiveGateway();
    const reference = `RHS-${saleRows[0].id}-${Date.now()}`;
    const customerEmail = email || req.user.email || "customer@rhosam.com";

    if (activeGateway === "PAYSTACK" && paystackSecretKey) {
      const result = await paystack.initializeTransaction({
        email: customerEmail,
        amount: saleRows[0].total,
        reference,
        metadata: { sale_id: saleRows[0].id, receipt_number: saleRows[0].receipt_number, cashier: req.user.name },
      });
      await audit(pool, req.user.id, "INIT_PAYMENT", "SALE", saleId, { gateway: "PAYSTACK", reference }, req);
      res.json({ gateway: "PAYSTACK", reference, authorizationUrl: result.authorization_url, accessCode: result.access_code });
    } else if (activeGateway === "FLUTTERWAVE" && flutterwaveSecretKey) {
      const result = await flutterwave.initializeTransaction({
        email: customerEmail,
        amount: saleRows[0].total,
        reference,
        redirectUrl: `${process.env.FRONTEND_URL || "http://localhost:5173"}/pos`,
      });
      await audit(pool, req.user.id, "INIT_PAYMENT", "SALE", saleId, { gateway: "FLUTTERWAVE", reference }, req);
      res.json({ gateway: "FLUTTERWAVE", reference, authorizationUrl: result.link });
    } else {
      // No gateway configured — return internal reference for manual entry
      res.json({ gateway: "INTERNAL", reference, authorizationUrl: null, message: "No payment gateway configured. Enter reference manually." });
    }
  } catch (e) { next(e); }
});

// ── Payment Gateway Status ─────────────────────────────────────
app.get("/api/payments/gateway-status", auth, async (_req, res) => {
  const active = getActiveGateway();
  const dbKey = paymentSettingsCache.paystackSecretKey || paystackSecretKey;
  const dbFwKey = paymentSettingsCache.flutterwaveSecretKey || flutterwaveSecretKey;
  res.json({
    activeGateway: active,
    paystackConfigured: !!(active === "PAYSTACK" && dbKey),
    flutterwaveConfigured: !!(active === "FLUTTERWAVE" && dbFwKey),
    paystackPublicKey: paymentSettingsCache.paystackPublicKey || paystackPublicKey || null,
    flutterwavePublicKey: paymentSettingsCache.flutterwavePublicKey || flutterwavePublicKey || null,
  });
});

// ── Payment Settings (Super-Admin only) ───────────────────────────────────
app.get("/api/payment-settings", auth, requireSuperAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM payment_settings WHERE is_active=TRUE ORDER BY id DESC LIMIT 1");
    if (!rows[0]) return res.json({ gateway: "INTERNAL", testMode: true });
    const s = rows[0];
    // Mask secret keys for security — only show last 4 chars
    res.json({
      id: s.id,
      gateway: s.gateway,
      paystackSecretKey: s.paystack_secret_key ? `****${s.paystack_secret_key.slice(-4)}` : "",
      paystackSecretKeyFull: s.paystack_secret_key || "",
      paystackPublicKey: s.paystack_public_key || "",
      flutterwaveSecretKey: s.flutterwave_secret_key ? `****${s.flutterwave_secret_key.slice(-4)}` : "",
      flutterwaveSecretKeyFull: s.flutterwave_secret_key || "",
      flutterwavePublicKey: s.flutterwave_public_key || "",
      webhookSecret: s.webhook_secret ? `****${s.webhook_secret.slice(-4)}` : "",
      webhookSecretFull: s.webhook_secret || "",
      testMode: s.test_mode,
      updatedBy: s.updated_by,
      updatedAt: s.updated_at,
    });
  } catch (e) { next(e); }
});

app.put("/api/payment-settings", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { gateway, paystackSecretKey, paystackPublicKey, flutterwaveSecretKey, flutterwavePublicKey, webhookSecret, testMode } = req.body;
    if (!gateway || !["INTERNAL", "PAYSTACK", "FLUTTERWAVE"].includes(gateway))
      return res.status(400).json({ message: "Invalid gateway. Must be INTERNAL, PAYSTACK, or FLUTTERWAVE." });

    // Deactivate old settings
    await pool.query("UPDATE payment_settings SET is_active=FALSE, updated_at=NOW() WHERE is_active=TRUE");

    // Insert new settings (keep existing values if not provided)
    const { rows } = await pool.query(
      `INSERT INTO payment_settings(gateway, paystack_secret_key, paystack_public_key, flutterwave_secret_key, flutterwave_public_key, webhook_secret, test_mode, updated_by)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        gateway,
        paystackSecretKey || null,
        paystackPublicKey || null,
        flutterwaveSecretKey || null,
        flutterwavePublicKey || null,
        webhookSecret || null,
        testMode !== false,
        req.user.id,
      ]
    );

    // Reload settings into memory
    await loadPaymentSettings();

    await audit(pool, req.user.id, "UPDATE", "PAYMENT_SETTINGS", rows[0].id, { gateway, testMode }, req);
    res.json({ message: "Payment settings updated.", gateway, testMode });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PAYSTACK TERMINAL — Device Management & Payments
// ═══════════════════════════════════════════════════════════════════

// List registered terminal devices (syncs with Paystack)
app.get("/api/terminals", auth, allow("ADMIN", "MANAGER"), async (_req, res, next) => {
  try {
    // Load local DB records
    const { rows: dbTerminals } = await pool.query(
      `SELECT td.*, b.name AS branch_name FROM terminal_devices td
       LEFT JOIN branches b ON b.id = td.branch_id
       ORDER BY td.name`
    );

    // Try to sync with Paystack API if gateway is Paystack
    let paystackTerminals = [];
    if (getActiveGateway() === "PAYSTACK") {
      try {
        paystackTerminals = await paystackTerminal.listTerminals();
      } catch (e) { console.error("[TERMINAL] Failed to list Paystack terminals:", e.message); }
    }

    res.json({ terminals: dbTerminals, paystackTerminals });
  } catch (e) { next(e); }
});

// Fetch a single terminal's details and presence
app.get("/api/terminals/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT td.*, b.name AS branch_name FROM terminal_devices td
       LEFT JOIN branches b ON b.id = td.branch_id WHERE td.id=$1`, [id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Terminal not found." });

    // Check online status from Paystack
    let presence = { online: false, available: false };
    if (getActiveGateway() === "PAYSTACK" && rows[0].terminal_code) {
      try {
        presence = await paystackTerminal.checkPresence(rows[0].terminal_code);
        await pool.query(
          "UPDATE terminal_devices SET is_online=$1, last_seen_at=NOW(), updated_at=NOW() WHERE id=$2",
          [presence.online, id]
        );
      } catch (e) { console.error("[TERMINAL] Presence check failed:", e.message); }
    }

    res.json({ ...rows[0], presence });
  } catch (e) { next(e); }
});

// Register a terminal device (Super-Admin only)
app.post("/api/terminals", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { paystackTerminalId, serialNumber, name, branchId } = req.body;
    if (!name) return res.status(400).json({ message: "Terminal name is required." });

    let terminalData = {};

    // If syncing from Paystack, fetch terminal details
    if (paystackTerminalId && getActiveGateway() === "PAYSTACK") {
      try {
        terminalData = await paystackTerminal.getTerminal(paystackTerminalId);
      } catch (e) {
        return res.status(400).json({ message: `Failed to fetch terminal from Paystack: ${e.message}` });
      }
    }

    const psId = terminalData.id || (paystackTerminalId ? Number(paystackTerminalId) : null);
    const code = terminalData.terminal_id || serialNumber || `TERM-${Date.now()}`;
    const serial = terminalData.serial_number || serialNumber || null;
    const deviceMake = terminalData.device_make || null;
    const address = terminalData.address || null;
    const psStatus = terminalData.status || "active";

    const { rows } = await pool.query(
      `INSERT INTO terminal_devices(paystack_id, terminal_code, serial_number, name, device_make, address, status, branch_id)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [psId, code, serial, name, deviceMake, address, psStatus, branchId || null]
    );

    await audit(pool, req.user.id, "CREATE", "TERMINAL", rows[0].id, { name, code }, req);
    res.status(201).json(rows[0]);
  } catch (e) { e.code === "23505" ? res.status(409).json({ message: "Terminal already registered." }) : next(e); }
});

// Update terminal (Super-Admin only)
app.put("/api/terminals/:id", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, branchId, address } = req.body;
    const updates = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name=$${idx++}`); params.push(name); }
    if (branchId !== undefined) { updates.push(`branch_id=$${idx++}`); params.push(branchId || null); }
    if (address !== undefined) { updates.push(`address=$${idx++}`); params.push(address); }
    if (!updates.length) return res.status(400).json({ message: "No fields to update." });
    updates.push(`updated_at=NOW()`);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE terminal_devices SET ${updates.join(",")} WHERE id=$${idx} RETURNING *`, params
    );
    if (!rows[0]) return res.status(404).json({ message: "Terminal not found." });
    await audit(pool, req.user.id, "UPDATE", "TERMINAL", id, req.body, req);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Delete terminal (Super-Admin only)
app.delete("/api/terminals/:id", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rowCount } = await pool.query("DELETE FROM terminal_devices WHERE id=$1", [id]);
    if (rowCount === 0) return res.status(404).json({ message: "Terminal not found." });
    await audit(pool, req.user.id, "DELETE", "TERMINAL", id, {}, req);
    res.json({ message: "Terminal removed." });
  } catch (e) { next(e); }
});

// ── Terminal Payments ──────────────────────────────────────────

// Initialize a transaction and send it to a terminal
app.post("/api/terminals/:id/charge", auth, allow("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const terminalId = Number(req.params.id);
    const { saleId, amount, email } = req.body;
    if (!terminalId) return res.status(400).json({ message: "Terminal ID required." });
    if (!saleId && !amount) return res.status(400).json({ message: "saleId or amount required." });

    // Fetch terminal from DB
    const { rows: termRows } = await pool.query("SELECT * FROM terminal_devices WHERE id=$1", [terminalId]);
    if (!termRows[0]) return res.status(404).json({ message: "Terminal not found in system." });
    const terminal = termRows[0];

    // Check terminal is online
    if (getActiveGateway() === "PAYSTACK") {
      try {
        const presence = await paystackTerminal.checkPresence(terminal.terminal_code);
        if (!presence.online) return res.status(400).json({ message: "Terminal is offline. Please check the device connection." });
        await pool.query("UPDATE terminal_devices SET is_online=TRUE, last_seen_at=NOW(), updated_at=NOW() WHERE id=$1", [terminalId]);
      } catch (e) {
        return res.status(500).json({ message: `Cannot reach terminal: ${e.message}` });
      }
    }

    // Get sale details if saleId provided
    let saleTotal = Number(amount);
    let saleRef = `TERM-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
    if (saleId) {
      const { rows: saleRows } = await pool.query("SELECT id, total, receipt_number FROM sales WHERE id=$1", [Number(saleId)]);
      if (!saleRows[0]) return res.status(404).json({ message: "Sale not found." });
      saleTotal = Number(saleRows[0].total);
      saleRef = saleRows[0].receipt_number;
    }

    if (!saleTotal || saleTotal <= 0) return res.status(400).json({ message: "Invalid amount." });

    // Initialize transaction with Paystack
    const reference = `RHS-T-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const customerEmail = email || req.user.email || "pos@rhosam.com";
    let paystackTxId = null;

    if (getActiveGateway() === "PAYSTACK") {
      const initResult = await paystack.initializeTransaction({
        email: customerEmail,
        amount: saleTotal,
        reference,
        metadata: { sale_id: saleId, terminal_id: terminalId, cashier: req.user.name },
      });
      paystackTxId = initResult.id;

      // Send transaction to terminal
      const eventResult = await paystackTerminal.sendEvent(
        terminal.terminal_code,
        "transaction",
        "process",
        { id: initResult.id }
      );

      // Record terminal transaction
      const { rows: txRows } = await pool.query(
        `INSERT INTO terminal_transactions(sale_id, terminal_id, paystack_transaction_id, event_id, reference, amount, status)
         VALUES($1, $2, $3, $4, $5, $6, 'SENT') RETURNING *`,
        [saleId || null, terminalId, paystackTxId, eventResult.id, reference, saleTotal]
      );

      await audit(pool, req.user.id, "TERMINAL_CHARGE", "TERMINAL", terminalId, { reference, amount: saleTotal, saleId }, req);
      res.json({
        terminalTransaction: txRows[0],
        reference,
        eventId: eventResult.id,
        status: "SENT",
        message: `Payment request sent to ${terminal.name}. Customer should tap/insert card on the terminal.`,
      });
    } else {
      return res.status(400).json({ message: "Terminal payments require Paystack gateway. Configure it in Payment Settings." });
    }
  } catch (e) { next(e); }
});

// Check terminal transaction status
app.get("/api/terminals/transactions/:txId/status", auth, async (req, res, next) => {
  try {
    const txId = Number(req.params.txId);
    const { rows } = await pool.query("SELECT * FROM terminal_transactions WHERE id=$1", [txId]);
    if (!rows[0]) return res.status(404).json({ message: "Terminal transaction not found." });
    const tx = rows[0];

    // Check event delivery status from Paystack
    if (tx.event_id && tx.terminal_id) {
      const { rows: termRows } = await pool.query("SELECT terminal_code FROM terminal_devices WHERE id=$1", [tx.terminal_id]);
      if (termRows[0] && getActiveGateway() === "PAYSTACK") {
        try {
          const eventStatus = await paystackTerminal.getEventStatus(termRows[0].terminal_code, tx.event_id);
          if (eventStatus.delivered && tx.status === "SENT") {
            await pool.query("UPDATE terminal_transactions SET event_delivered=TRUE, status='PROCESSING', updated_at=NOW() WHERE id=$1", [txId]);
            tx.status = "PROCESSING";
            tx.event_delivered = true;
          }
        } catch (e) { console.error("[TERMINAL] Event status check failed:", e.message); }
      }
    }

    // Also verify with Paystack if we have a transaction ID
    if (tx.paystack_transaction_id && getActiveGateway() === "PAYSTACK" && tx.status !== "SUCCESS" && tx.status !== "FAILED") {
      try {
        const payResult = await paystack.verifyTransaction(tx.reference);
        if (payResult.status === "success") {
          await pool.query(
            "UPDATE terminal_transactions SET status='SUCCESS', gateway_response=$1, updated_at=NOW() WHERE id=$2",
            [JSON.stringify(payResult), txId]
          );
          tx.status = "SUCCESS";
          tx.gateway_response = payResult;
        } else if (payResult.status === "failed") {
          await pool.query(
            "UPDATE terminal_transactions SET status='FAILED', gateway_response=$1, updated_at=NOW() WHERE id=$2",
            [JSON.stringify(payResult), txId]
          );
          tx.status = "FAILED";
        }
      } catch (e) { console.error("[TERMINAL] Transaction verify failed:", e.message); }
    }

    res.json(tx);
  } catch (e) { next(e); }
});

// List terminal transactions
app.get("/api/terminals/transactions", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const lim = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const tId = parseInt(req.query.terminalId, 10) || null;
    const params = tId ? [tId] : [];
    const where = tId ? " WHERE tt.terminal_id=$1" : "";
    const rows = (await pool.query(
      `SELECT tt.id, tt.sale_id, tt.terminal_id, tt.reference, tt.amount, tt.status, tt.created_at,
              td.name AS terminal_name, td.terminal_code, s.receipt_number
       FROM terminal_transactions tt
       LEFT JOIN terminal_devices td ON td.id = tt.terminal_id
       LEFT JOIN sales s ON s.id = tt.sale_id
       ${where} ORDER BY tt.created_at DESC LIMIT ${lim}`
    )).rows;
    res.json(rows);
  } catch (e) {
    if (e.message.includes("does not exist") || e.message.includes("NaN") || e.code === "42P01") {
      return res.json([]);
    }
    next(e);
  }
});

// ── Paystack Webhook ───────────────────────────────────────────
app.post("/api/webhooks/paystack", async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"] || "";
    // req.body is already parsed by global express.json(), so re-stringify for signature verification
    const body = JSON.stringify(req.body);

    if (!paystack.verifyWebhook(signature, body)) {
      console.error("[WEBHOOK] Invalid Paystack signature");
      return res.status(400).json({ message: "Invalid signature" });
    }

    const event = req.body;
    if (event.event === "charge.success") {
      const { reference, amount, status, gateway_response, card } = event.data || {};
      if (reference) {
        // Update or insert payment verification
        const { rows: existing } = await pool.query(
          "SELECT id, sale_id, status FROM payment_verifications WHERE reference=$1", [reference]
        );
        if (existing[0]) {
          if (existing[0].status !== "VERIFIED") {
            await pool.query(
              "UPDATE payment_verifications SET status='VERIFIED', verified_at=NOW(), gateway_response=$1 WHERE id=$2",
              [JSON.stringify(event.data), existing[0].id]
            );
          }
        } else {
          // Try to extract sale_id from reference format RHS-{saleId}-...
          const saleIdMatch = reference.match(/^RHS-(\d+)-/);
          const saleId = saleIdMatch ? Number(saleIdMatch[1]) : null;
          if (saleId) {
            await pool.query(
              "INSERT INTO payment_verifications(sale_id,gateway,reference,status,amount,card_last4,gateway_response,verified_at) VALUES($1,'PAYSTACK',$2,'VERIFIED',$3,$4,$5,NOW())",
              [saleId, reference, (amount || 0) / 100, card?.last4 || null, JSON.stringify(event.data)]
            );
          }
        }
        console.log(`[WEBHOOK] Paystack charge.success: ${reference}`);
      }
    }
    res.json({ received: true });
  } catch (e) {
    console.error("[WEBHOOK] Paystack error:", e.message);
    res.status(500).json({ message: "Webhook processing failed" });
  }
});

// ── Flutterwave Webhook ────────────────────────────────────────
app.post("/api/webhooks/flutterwave", async (req, res) => {
  try {
    const signature = req.headers["verif-hash"] || "";
    // req.body is already parsed by global express.json(), so re-stringify for signature verification
    const body = JSON.stringify(req.body);

    if (!flutterwave.verifyWebhook(signature, body)) {
      console.error("[WEBHOOK] Invalid Flutterwave signature");
      return res.status(400).json({ message: "Invalid signature" });
    }

    const event = req.body;
    if (event.event === "charge.completed" && event.data?.status === "successful") {
      const { tx_ref, amount, id: fwId, card, flw_ref } = event.data;
      if (tx_ref) {
        const { rows: existing } = await pool.query(
          "SELECT id, status FROM payment_verifications WHERE reference=$1", [tx_ref]
        );
        if (existing[0]) {
          if (existing[0].status !== "VERIFIED") {
            await pool.query(
              "UPDATE payment_verifications SET status='VERIFIED', verified_at=NOW(), gateway_response=$1 WHERE id=$2",
              [JSON.stringify(event.data), existing[0].id]
            );
          }
        } else {
          const saleIdMatch = tx_ref.match(/^RHS-(\d+)-/);
          const saleId = saleIdMatch ? Number(saleIdMatch[1]) : null;
          if (saleId) {
            await pool.query(
              "INSERT INTO payment_verifications(sale_id,gateway,reference,status,amount,card_last4,gateway_response,verified_at) VALUES($1,'FLUTTERWAVE',$2,'VERIFIED',$3,$4,$5,NOW())",
              [saleId, tx_ref, amount || 0, card?.last4 || null, JSON.stringify(event.data)]
            );
          }
        }
        console.log(`[WEBHOOK] Flutterwave charge.completed: ${tx_ref}`);
      }
    }
    res.json({ received: true });
  } catch (e) {
    console.error("[WEBHOOK] Flutterwave error:", e.message);
    res.status(500).json({ message: "Webhook processing failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DATABASE BACKUP (Admin)
// ═══════════════════════════════════════════════════════════════════

app.get("/api/admin/backup", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const tables = [
      "users", "products", "inventory_movements", "sales", "sale_items",
      "returns", "customers", "suppliers", "purchase_orders", "purchase_order_items",
      "expenses", "cash_drawer", "audit_logs", "branches", "payment_verifications"
    ];
    const backup = { version: "1.0", exported_at: new Date().toISOString(), tables: {} };

    for (const table of tables) {
      try {
        const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
        backup.tables[table] = rows;
      } catch (e) { backup.tables[table] = { error: e.message }; }
    }

    await audit(pool, req.user.id, "BACKUP", "DATABASE", null, { tables: tables.length }, req);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="rhosam-backup-${new Date().toISOString().slice(0,10)}.json"`);
    res.json(backup);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE: PRODUCT EXPIRY TRACKING
// ═══════════════════════════════════════════════════════════════════

// Get products expiring soon (within N days)
app.get("/api/inventory/expiring", auth, async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const branchId = req.query.branchId ? Number(req.query.branchId) : req.user.branchId;
    let sql, params;
    if (branchId) {
      sql = `SELECT p.id, p.barcode, p.name, p.category, p.unit, p.expiry_date, p.batch_number,
                   p.cost_price::float, p.price::float,
                   COALESCE(bi.quantity, 0)::int AS stock,
                   (p.expiry_date - CURRENT_DATE)::int AS days_until_expiry
             FROM products p
             LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
             WHERE p.is_active = TRUE AND p.expiry_date IS NOT NULL
               AND p.expiry_date <= CURRENT_DATE + INTERVAL '1 day' * $2
             ORDER BY p.expiry_date ASC`;
      params = [branchId, days];
    } else {
      sql = `SELECT id, barcode, name, category, unit, expiry_date, batch_number,
                   cost_price::float, price::float, stock,
                   (expiry_date - CURRENT_DATE)::int AS days_until_expiry
             FROM products
             WHERE is_active = TRUE AND expiry_date IS NOT NULL
               AND expiry_date <= CURRENT_DATE + INTERVAL '1 day' * $1
             ORDER BY expiry_date ASC`;
      params = [days];
    }
    const { rows } = await pool.query(sql, params);
    // Categorize
    const expired = rows.filter(r => r.days_until_expiry < 0);
    const expiringToday = rows.filter(r => r.days_until_expiry === 0);
    const expiringSoon = rows.filter(r => r.days_until_expiry > 0);
    res.json({ products: rows, summary: { total: rows.length, expired: expired.length, expiringToday: expiringToday.length, expiringSoon: expiringSoon.length }, days });
  } catch (e) { next(e); }
});

// Record an expiry event
app.post("/api/inventory/expiry-event", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { productId, eventType, quantity, notes } = req.body;
    if (!productId || !['EXPIRED','DISPOSED','NEAR_EXPIRY_ALERT','PRICE_MARKDOWN'].includes(eventType))
      return res.status(400).json({ message: 'Product and valid event type required.' });
    const { rows: product } = await pool.query('SELECT id, name, expiry_date, batch_number FROM products WHERE id=$1', [productId]);
    if (!product[0]) return res.status(404).json({ message: 'Product not found.' });
    const qty = Math.abs(Number(quantity) || 0);
    const { rows } = await pool.query(
      `INSERT INTO expiry_events(product_id, branch_id, event_type, quantity, expiry_date, batch_number, notes, performed_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
      [productId, req.user.branchId || null, eventType, qty, product[0].expiry_date, product[0].batch_number, notes || '', req.user.id]
    );
    // If disposed/expired, reduce stock
    if (['EXPIRED','DISPOSED'].includes(eventType) && qty > 0) {
      await pool.query('UPDATE products SET stock = GREATEST(stock - $1, 0), updated_at = NOW() WHERE id=$2', [qty, productId]);
      if (req.user.branchId) {
        await pool.query(
          `INSERT INTO branch_inventory(branch_id, product_id, quantity, reorder_level)
           VALUES($2, $3, 0, (SELECT reorder_level FROM products WHERE id = $3))
           ON CONFLICT (branch_id, product_id)
           DO UPDATE SET quantity = GREATEST(0, branch_inventory.quantity - $1), updated_at = NOW()`,
          [qty, req.user.branchId, productId]
        );
      }
      await pool.query(
        `INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,'EXPIRED',$2,$3,$4,$5)`,
        [productId, -qty, `EXP-${rows[0].id}`, req.user.id, notes || 'Expired product disposed']
      );
    }
    await audit(pool, req.user.id, 'EXPIRY_EVENT', 'PRODUCT', productId, { eventType, qty }, req);
    res.status(201).json({ message: 'Expiry event recorded.', event: rows[0] });
  } catch (e) { next(e); }
});

// Get expiry events history
app.get("/api/inventory/expiry-events", auth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { rows } = await pool.query(
      `SELECT ee.*, p.name AS product_name, p.barcode, u.name AS performed_by_name
       FROM expiry_events ee
       JOIN products p ON p.id = ee.product_id
       LEFT JOIN users u ON u.id = ee.performed_by
       ORDER BY ee.created_at DESC LIMIT $1`, [limit]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE: BULK IMPORT / EXPORT (CSV)
// ═══════════════════════════════════════════════════════════════════
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'text/csv' || file.originalname.endsWith('.csv');
    cb(ok ? null : new Error('Only CSV files are allowed.'), ok);
  },
});

// Export products as CSV
app.get("/api/inventory/export", auth, allow('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : req.user.branchId;
    let sql, params;
    if (branchId) {
      sql = `SELECT p.barcode, p.name, p.category, p.price::float AS price, p.cost_price::float AS cost_price,
                   COALESCE(bi.quantity, 0)::int AS stock, COALESCE(bi.reorder_level, p.reorder_level)::int AS reorder_level,
                   p.unit, p.expiry_date, p.batch_number, p.is_active
             FROM products p
             LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
             WHERE p.is_active = TRUE ORDER BY p.name`;
      params = [branchId];
    } else {
      sql = `SELECT barcode, name, category, price::float AS price, cost_price::float AS cost_price,
                   stock, reorder_level, unit, expiry_date, batch_number, is_active
             FROM products WHERE is_active = TRUE ORDER BY name`;
      params = [];
    }
    const { rows } = await pool.query(sql, params);
    const headers = ['barcode','name','category','price','cost_price','stock','reorder_level','unit','expiry_date','batch_number'];
    const csvLines = [headers.join(',')];
    for (const r of rows) {
      csvLines.push(headers.map(h => {
        let val = r[h];
        if (val === null || val === undefined) return '';
        val = String(val);
        return val.includes(',') || val.includes('"') || val.includes('\n') ? '"' + val.replace(/"/g, '""') + '"' : val;
      }).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="rhosam-inventory-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csvLines.join('\n'));
  } catch (e) { next(e); }
});

// Import products from CSV
app.post("/api/inventory/import", auth, allow('ADMIN'), csvUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No CSV file provided.' });
    const content = req.file.buffer.toString('utf8');
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ message: 'CSV must have a header row and at least one data row.' });
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const required = ['barcode', 'name', 'category', 'price'];
    const missing = required.filter(h => !headers.includes(h));
    if (missing.length) return res.status(400).json({ message: `Missing required columns: ${missing.join(', ')}` });
    let created = 0, updated = 0, skipped = 0, errors = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        // Simple CSV parse (handles quoted fields)
        const values = [];
        let current = '', inQuotes = false;
        for (const ch of lines[i]) {
          if (ch === '"') { inQuotes = !inQuotes; continue; }
          if (ch === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
          current += ch;
        }
        values.push(current.trim());
        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
        if (!row.barcode || !row.name) { skipped++; continue; }
        const { rows: existing } = await pool.query('SELECT id FROM products WHERE barcode=$1', [row.barcode]);
        if (existing[0]) {
          await pool.query(
            'UPDATE products SET name=$1, category=$2, price=$3, cost_price=COALESCE($4,cost_price), stock=COALESCE($5,stock), reorder_level=COALESCE($6,reorder_level), unit=COALESCE($7,unit), expiry_date=COALESCE($8,expiry_date), batch_number=COALESCE($9,batch_number), updated_at=NOW() WHERE barcode=$10',
            [row.name, row.category, row.price, row.cost_price || null, row.stock || null, row.reorder_level || null, row.unit || null, row.expiry_date || null, row.batch_number || null, row.barcode]
          );
          updated++;
        } else {
          await pool.query(
            'INSERT INTO products(barcode,name,category,price,cost_price,stock,reorder_level,unit,expiry_date,batch_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
            [row.barcode, row.name, row.category, row.price, row.cost_price || 0, row.stock || 0, row.reorder_level || 5, row.unit || 'PCS', row.expiry_date || null, row.batch_number || null]
          );
          created++;
        }
      } catch (err) { skipped++; errors.push(`Row ${i+1}: ${err.message}`); }
    }
    await audit(pool, req.user.id, 'CSV_IMPORT', 'PRODUCTS', null, { created, updated, skipped, file: req.file.originalname }, req);
    res.json({ message: 'Import complete.', created, updated, skipped, errors: errors.slice(0, 20) });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE: INVENTORY AUDIT CYCLE (Stock-Taking)
// ═══════════════════════════════════════════════════════════════════

// List audits
app.get("/api/inventory-audits", auth, allow('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : req.user.branchId;
    let sql = `SELECT ia.*, u.name AS created_by_name, u2.name AS completed_by_name, b.name AS branch_name
               FROM inventory_audits ia
               LEFT JOIN users u ON u.id = ia.created_by
               LEFT JOIN users u2 ON u2.id = ia.completed_by
               LEFT JOIN branches b ON b.id = ia.branch_id`;
    const params = [];
    if (branchId) { sql += ' WHERE ia.branch_id = $1'; params.push(branchId); }
    sql += ' ORDER BY ia.created_at DESC LIMIT 50';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// Get audit with items
app.get("/api/inventory-audits/:id", auth, allow('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT ia.*, u.name AS created_by_name, b.name AS branch_name
       FROM inventory_audits ia
       LEFT JOIN users u ON u.id = ia.created_by
       LEFT JOIN branches b ON b.id = ia.branch_id
       WHERE ia.id=$1`, [id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Audit not found.' });
    const { rows: items } = await pool.query(
      `SELECT iai.*, p.name AS product_name, p.barcode, p.category, p.unit,
              u.name AS counted_by_name
       FROM inventory_audit_items iai
       JOIN products p ON p.id = iai.product_id
       LEFT JOIN users u ON u.id = iai.counted_by
       WHERE iai.audit_id=$1 ORDER BY p.name`, [id]
    );
    res.json({ ...rows[0], items });
  } catch (e) { next(e); }
});

// Create audit (auto-populate with current products)
app.post("/api/inventory-audits", auth, allow('ADMIN', 'MANAGER'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { title, notes } = req.body;
    if (!title) return res.status(400).json({ message: 'Title required.' });
    const branchId = req.user.branchId;
    await client.query('BEGIN');
    const { rows: auditRows } = await client.query(
      `INSERT INTO inventory_audits(branch_id, title, notes, created_by, status)
       VALUES($1,$2,$3,$4,'DRAFT') RETURNING id, created_at`,
      [branchId || null, title, notes || '', req.user.id]
    );
    const auditId = auditRows[0].id;
    // Populate with current products
    let sql, params;
    if (branchId) {
      sql = `SELECT p.id AS product_id, COALESCE(bi.quantity, 0)::int AS qty, p.cost_price::float
             FROM products p
             LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
             WHERE p.is_active = TRUE`;
      params = [branchId];
    } else {
      sql = 'SELECT id AS product_id, stock AS qty, cost_price::float FROM products WHERE is_active = TRUE';
      params = [];
    }
    const { rows: products } = await client.query(sql, params);
    for (const p of products) {
      await client.query(
        'INSERT INTO inventory_audit_items(audit_id, product_id, system_quantity, unit_cost) VALUES($1,$2,$3,$4)',
        [auditId, p.product_id, p.qty, p.cost_price]
      );
    }
    await client.query('UPDATE inventory_audits SET total_items=$1 WHERE id=$2', [products.length, auditId]);
    await audit(client, req.user.id, 'CREATE', 'INVENTORY_AUDIT', auditId, { title, itemCount: products.length }, req);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Audit created.', id: auditId, totalItems: products.length });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); } finally { client.release(); }
});

// Update audit status
app.patch("/api/inventory-audits/:id/status", auth, allow('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!['IN_PROGRESS','COMPLETED','CANCELLED'].includes(status))
      return res.status(400).json({ message: 'Invalid status.' });
    // BRANCH SCOPING: Branch admins/managers can only update audits belonging to their branch
    if (req.user.branchId) {
      const { rows: auditRow } = await pool.query('SELECT branch_id FROM inventory_audits WHERE id=$1', [id]);
      if (!auditRow[0]) return res.status(404).json({ message: 'Audit not found.' });
      if (auditRow[0].branch_id !== req.user.branchId)
        return res.status(403).json({ message: 'Access denied. Audit belongs to another branch.' });
    }
    const updates = ['status=$1', 'updated_at=NOW()'];
    const params = [status];
    if (status === 'IN_PROGRESS') updates.push('started_at=NOW()');
    if (status === 'COMPLETED') {
      updates.push('completed_at=NOW()', `completed_by=$2`);
      params.push(req.user.id);
    }
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE inventory_audits SET ${updates.join(',')} WHERE id=$${params.length} RETURNING id, status`, params
    );
    if (!rows[0]) return res.status(404).json({ message: 'Audit not found.' });
    // If completed, calculate summary
    if (status === 'COMPLETED') {
      const { rows: summary } = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER(WHERE discrepancy = 0 OR counted_quantity IS NULL)::int AS matched,
                COUNT(*) FILTER(WHERE discrepancy != 0 AND counted_quantity IS NOT NULL)::int AS discrepant,
                COALESCE(SUM(discrepancy_value) FILTER(WHERE discrepancy != 0 AND counted_quantity IS NOT NULL), 0)::numeric AS total_discrepancy_value
         FROM inventory_audit_items WHERE audit_id=$1`, [id]
      );
      await pool.query(
        'UPDATE inventory_audits SET total_items=$1, matched_items=$2, discrepancy_items=$3, total_discrepancy_value=$4 WHERE id=$5',
        [summary[0].total, summary[0].matched, summary[0].discrepant, summary[0].total_discrepancy_value, id]
      );
    }
    await audit(pool, req.user.id, 'UPDATE_STATUS', 'INVENTORY_AUDIT', id, { status }, req);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Update a counted item within an audit
app.patch("/api/inventory-audits/:auditId/items/:itemId", auth, allow('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { auditId, itemId } = { auditId: Number(req.params.auditId), itemId: Number(req.params.itemId) };
    // BRANCH SCOPING: Branch admins/managers can only update items in audits belonging to their branch
    if (req.user.branchId) {
      const { rows: auditRow } = await pool.query('SELECT branch_id FROM inventory_audits WHERE id=$1', [auditId]);
      if (!auditRow[0]) return res.status(404).json({ message: 'Audit not found.' });
      if (auditRow[0].branch_id !== req.user.branchId)
        return res.status(403).json({ message: 'Access denied. Audit belongs to another branch.' });
    }
    const { countedQuantity, notes } = req.body;
    if (countedQuantity === undefined || countedQuantity === null)
      return res.status(400).json({ message: 'countedQuantity required.' });
    const { rows } = await pool.query(
      'UPDATE inventory_audit_items SET counted_quantity=$1, notes=$2, counted_by=$3, counted_at=NOW() WHERE id=$4 AND audit_id=$5 RETURNING id, product_id, system_quantity, counted_quantity, discrepancy, discrepancy_value',
      [Number(countedQuantity), notes || '', req.user.id, itemId, auditId]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Audit item not found.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Delete audit (DRAFT only)
app.delete("/api/inventory-audits/:id", auth, allow('ADMIN'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT status, branch_id FROM inventory_audits WHERE id=$1', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Audit not found.' });
    // BRANCH SCOPING: Branch admins can only delete audits belonging to their branch
    if (req.user.branchId && rows[0].branch_id !== req.user.branchId)
      return res.status(403).json({ message: 'Access denied. Audit belongs to another branch.' });
    if (rows[0].status !== 'DRAFT') return res.status(400).json({ message: 'Only DRAFT audits can be deleted.' });
    await pool.query('DELETE FROM inventory_audits WHERE id=$1', [id]);
    res.json({ message: 'Audit deleted.' });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE: STOCK ALERTS & NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════

// List alert rules
app.get("/api/alert-rules", auth, allow('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT ar.*, u.name AS created_by_name FROM alert_rules ar LEFT JOIN users u ON u.id = ar.created_by ORDER BY ar.alert_type, ar.name');
    res.json(rows);
  } catch (e) { next(e); }
});

// Create alert rule (Super-Admin only — global settings)
app.post("/api/alert-rules", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, alertType, category, thresholdValue, thresholdUnit, notifyEmail, notifyDashboard, emailRecipients } = req.body;
    if (!name || !alertType) return res.status(400).json({ message: 'Name and type required.' });
    const { rows } = await pool.query(
      `INSERT INTO alert_rules(name,alert_type,category,threshold_value,threshold_unit,notify_email,notify_dashboard,email_recipients,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, alertType, category || null, thresholdValue || 0, thresholdUnit || 'UNITS', notifyEmail || false, notifyDashboard !== false, emailRecipients || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// Update alert rule (Super-Admin only — global settings)
app.patch("/api/alert-rules/:id", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, category, thresholdValue, thresholdUnit, isActive, notifyEmail, notifyDashboard, emailRecipients } = req.body;
    const updates = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name=$${idx++}`); params.push(name); }
    if (category !== undefined) { updates.push(`category=$${idx++}`); params.push(category || null); }
    if (thresholdValue !== undefined) { updates.push(`threshold_value=$${idx++}`); params.push(thresholdValue); }
    if (thresholdUnit !== undefined) { updates.push(`threshold_unit=$${idx++}`); params.push(thresholdUnit); }
    if (isActive !== undefined) { updates.push(`is_active=$${idx++}`); params.push(isActive); }
    if (notifyEmail !== undefined) { updates.push(`notify_email=$${idx++}`); params.push(notifyEmail); }
    if (notifyDashboard !== undefined) { updates.push(`notify_dashboard=$${idx++}`); params.push(notifyDashboard); }
    if (emailRecipients !== undefined) { updates.push(`email_recipients=$${idx++}`); params.push(emailRecipients); }
    if (!updates.length) return res.status(400).json({ message: 'No fields to update.' });
    updates.push('updated_at=NOW()');
    params.push(id);
    const { rows } = await pool.query(`UPDATE alert_rules SET ${updates.join(',')} WHERE id=$${idx} RETURNING *`, params);
    if (!rows[0]) return res.status(404).json({ message: 'Rule not found.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Delete alert rule (Super-Admin only — global settings)
app.delete("/api/alert-rules/:id", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM alert_rules WHERE id=$1', [Number(req.params.id)]);
    if (!rowCount) return res.status(404).json({ message: 'Rule not found.' });
    res.json({ message: 'Rule deleted.' });
  } catch (e) { next(e); }
});

// Get active alerts (dashboard)
app.get("/api/stock-alerts", auth, async (req, res, next) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : req.user.branchId;
    const unreadOnly = req.query.unread === 'true';
    let sql = `SELECT sa.*, p.name AS product_name, p.barcode, b.name AS branch_name
               FROM stock_alerts sa
               LEFT JOIN products p ON p.id = sa.product_id
               LEFT JOIN branches b ON b.id = sa.branch_id`;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (branchId) { conditions.push(`sa.branch_id = $${idx++}`); params.push(branchId); }
    if (unreadOnly) { conditions.push('sa.is_read = FALSE'); }
    conditions.push('sa.is_dismissed = FALSE');
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY sa.created_at DESC LIMIT 100';
    const { rows } = await pool.query(sql, params);
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE is_read = FALSE)::int AS unread FROM stock_alerts WHERE is_dismissed = FALSE' + (branchId ? ' AND branch_id = $1' : ''),
      branchId ? [branchId] : []
    );
    res.json({ alerts: rows, ...countRows[0] });
  } catch (e) { next(e); }
});

// Scan for alerts based on rules
app.post("/api/stock-alerts/scan", auth, allow('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const branchId = req.user.branchId;
    let generated = 0;
    const { rows: rules } = await pool.query('SELECT * FROM alert_rules WHERE is_active = TRUE');
    for (const rule of rules) {
      let products = [];
      if (rule.alert_type === 'LOW_STOCK') {
        const sql = branchId
          ? `SELECT p.id, p.name, COALESCE(bi.quantity, 0)::int AS stock, ${rule.threshold_value} AS threshold FROM products p LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1 WHERE p.is_active = TRUE AND COALESCE(bi.quantity, 0) <= ${rule.threshold_value} AND COALESCE(bi.quantity, 0) > 0`
          : `SELECT id, name, stock, ${rule.threshold_value} AS threshold FROM products WHERE is_active = TRUE AND stock <= ${rule.threshold_value} AND stock > 0`;
        const { rows } = await pool.query(sql, branchId ? [branchId] : []);
        products = rows;
      } else if (rule.alert_type === 'OUT_OF_STOCK') {
        const sql = branchId
          ? `SELECT p.id, p.name, COALESCE(bi.quantity, 0)::int AS stock FROM products p LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1 WHERE p.is_active = TRUE AND COALESCE(bi.quantity, 0) = 0`
          : `SELECT id, name, stock FROM products WHERE is_active = TRUE AND stock = 0`;
        const { rows } = await pool.query(sql, branchId ? [branchId] : []);
        products = rows;
      } else if (rule.alert_type === 'EXPIRING_SOON') {
        const sql = branchId
          ? `SELECT p.id, p.name, p.expiry_date, (p.expiry_date - CURRENT_DATE)::int AS days FROM products p LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1 WHERE p.is_active = TRUE AND p.expiry_date IS NOT NULL AND p.expiry_date <= CURRENT_DATE + INTERVAL '1 day' * $2`
          : `SELECT id, name, expiry_date, (expiry_date - CURRENT_DATE)::int AS days FROM products WHERE is_active = TRUE AND expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + INTERVAL '1 day' * $1`;
        const { rows } = await pool.query(sql, branchId ? [branchId, rule.threshold_value] : [rule.threshold_value]);
        products = rows;
      }
      for (const p of products) {
        // Don't create duplicate active alerts for the same product+rule
        const { rows: existing } = await pool.query(
          'SELECT id FROM stock_alerts WHERE rule_id=$1 AND product_id=$2 AND branch_id IS NOT DISTINCT FROM $3 AND is_dismissed = FALSE',
          [rule.id, p.id, branchId || null]
        );
        if (existing[0]) continue;
        const severity = rule.alert_type === 'OUT_OF_STOCK' ? 'CRITICAL' : (p.days !== undefined && p.days <= 0 ? 'CRITICAL' : 'WARNING');
        const title = `${rule.name}: ${p.name}`;
        const message = rule.alert_type === 'EXPIRING_SOON'
          ? `${p.name} expires on ${p.expiry_date}`
          : `${p.name} has ${p.stock} units (threshold: ${rule.threshold_value})`;
        await pool.query(
          `INSERT INTO stock_alerts(rule_id, alert_type, severity, product_id, branch_id, title, message, current_value, threshold_value)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [rule.id, rule.alert_type, severity, p.id, branchId || null, title, message, p.stock, rule.threshold_value]
        );
        generated++;
        // Send SMS alerts for critical conditions
        if (rule.alert_type === 'OUT_OF_STOCK') {
          sendOutOfStockSmsAlert({ name: p.name, barcode: p.barcode || 'N/A' }).catch(() => {});
        } else if (rule.alert_type === 'LOW_STOCK') {
          sendLowStockSmsAlert({ name: p.name, unit: p.unit, reorder_level: rule.threshold_value }, p.stock).catch(() => {});
        } else if (rule.alert_type === 'EXPIRING_SOON') {
          sendExpirySmsAlert({ name: p.name, batch_number: p.batch_number || null }, p.days).catch(() => {});
        }
      }
    }
    await audit(pool, req.user.id, 'ALERT_SCAN', 'SYSTEM', null, { generated, rulesChecked: rules.length }, req);
    res.json({ message: `Alert scan complete. ${generated} new alerts generated.`, generated });
  } catch (e) { next(e); }
});

// Mark alerts as read
app.patch("/api/stock-alerts/mark-read", auth, async (req, res, next) => {
  try {
    const { ids } = req.body; // array of alert IDs, or empty for "mark all"
    if (Array.isArray(ids) && ids.length) {
      await pool.query('UPDATE stock_alerts SET is_read = TRUE WHERE id = ANY($1)', [ids]);
    } else {
      const branchId = req.user.branchId;
      if (branchId) {
        await pool.query('UPDATE stock_alerts SET is_read = TRUE WHERE branch_id=$1 AND is_read = FALSE', [branchId]);
      } else {
        await pool.query('UPDATE stock_alerts SET is_read = FALSE WHERE is_read = FALSE');
      }
    }
    res.json({ message: 'Alerts marked as read.' });
  } catch (e) { next(e); }
});

// Dismiss alerts
app.patch("/api/stock-alerts/dismiss", auth, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: 'ids required.' });
    await pool.query(
      'UPDATE stock_alerts SET is_dismissed = TRUE, dismissed_by = $1, dismissed_at = NOW() WHERE id = ANY($2)',
      [req.user.id, ids]
    );
    res.json({ message: 'Alerts dismissed.' });
  } catch (e) { next(e); }
});

// Delete alert (admin)
app.delete("/api/stock-alerts/:id", auth, allow('ADMIN'), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM stock_alerts WHERE id=$1', [Number(req.params.id)]);
    if (!rowCount) return res.status(404).json({ message: 'Alert not found.' });
    res.json({ message: 'Alert deleted.' });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION SERVICE: Email (Resend) + SMS (Telnyx)
// ═══════════════════════════════════════════════════════════════════

const NOTIFICATION_EVENT_TYPES = [
  'LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRING_SOON', 'DAILY_REPORT',
  'SALE_MILESTONE', 'NEW_SALE', 'STOCK_ADJUSTMENT', 'SYSTEM_ALERT'
];

// Send email via Resend
async function sendEmail(to, subject, html) {
  if (!resend) return { ok: false, error: 'Email not configured' };
  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'RHoSAM <onboarding@resend.dev>',
      to, subject, html,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Send SMS via Telnyx
async function sendSMS(to, message) {
  if (!telnyx) return { ok: false, error: 'SMS not configured' };
  try {
    await telnyx.messages.create({
      to,
      from: process.env.TELNYX_SENDER_ID || process.env.TELNYX_PHONE_NUMBER || '+1234567890',
      text: message,
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Check user preference and send notification
async function notifyUser(userId, eventType, { subject, emailHtml, smsText, metadata = {} }) {
  try {
    // Get user info
    const { rows: userRows } = await pool.query('SELECT id, name, email, phone FROM users WHERE id=$1 AND is_active=TRUE', [userId]);
    const user = userRows[0];
    if (!user) return;

    // Get preferences (default: email ON, SMS OFF)
    const { rows: prefRows } = await pool.query(
      'SELECT email_enabled, sms_enabled FROM notification_preferences WHERE user_id=$1 AND event_type=$2',
      [userId, eventType]
    );
    const pref = prefRows[0] || { email_enabled: true, sms_enabled: false };

    // Send email
    if (pref.email_enabled && user.email && emailHtml) {
      const result = await sendEmail(user.email, subject, emailHtml);
      try {
        await pool.query(
          'INSERT INTO notification_log(user_id,event_type,channel,recipient,subject,body,status,error_message,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [userId, eventType, 'EMAIL', user.email, subject, 'HTML email', result.ok ? 'SENT' : 'FAILED', result.error || null, JSON.stringify(metadata)]
        );
      } catch (_) { /* log table may not exist yet */ }
    }

    // Send SMS
    if (pref.sms_enabled && user.phone && smsText) {
      const result = await sendSMS(user.phone, smsText);
      try {
        await pool.query(
          'INSERT INTO notification_log(user_id,event_type,channel,recipient,subject,body,status,error_message,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [userId, eventType, 'SMS', user.phone, subject || 'RHoSAM', smsText, result.ok ? 'SENT' : 'FAILED', result.error || null, JSON.stringify(metadata)]
        );
      } catch (_) { /* log table may not exist yet */ }
    }
  } catch (e) { console.error('[NOTIFY]', e.message); }
}

// Broadcast notification to all users with a specific role
async function notifyRole(role, eventType, notificationData) {
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE role=$1 AND is_active=TRUE', [role]);
    for (const user of rows) {
      await notifyUser(user.id, eventType, notificationData);
    }
  } catch (e) { console.error('[NOTIFY BROADCAST]', e.message); }
}

// ── Notification Preferences API ───────────────────────────────
app.get('/api/notifications/preferences', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM notification_preferences WHERE user_id=$1 ORDER BY event_type', [req.user.id]
    );
    // Include unconfigured event types with defaults
    const configured = new Set(rows.map(r => r.event_type));
    const defaults = NOTIFICATION_EVENT_TYPES
      .filter(t => !configured.has(t))
      .map(t => ({ user_id: req.user.id, event_type: t, email_enabled: true, sms_enabled: false }));
    res.json([...rows, ...defaults]);
  } catch (e) { next(e); }
});

app.put('/api/notifications/preferences', auth, async (req, res, next) => {
  try {
    const { preferences } = req.body;
    if (!Array.isArray(preferences)) return res.status(400).json({ message: 'preferences array required.' });
    for (const p of preferences) {
      if (!p.event_type) continue;
      await pool.query(
        `INSERT INTO notification_preferences(user_id, event_type, email_enabled, sms_enabled, updated_at)
         VALUES($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, event_type)
         DO UPDATE SET email_enabled=$3, sms_enabled=$4, updated_at=NOW()`,
        [req.user.id, p.event_type, p.email_enabled !== false, p.sms_enabled === true]
      );
    }
    res.json({ message: 'Preferences updated.' });
  } catch (e) { next(e); }
});

// ── Notification Log API ───────────────────────────────────────
app.get('/api/notifications/log', auth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const channel = req.query.channel;
    const eventType = req.query.event_type;
    let sql = 'SELECT nl.*, u.name AS user_name FROM notification_log nl LEFT JOIN users u ON u.id = nl.user_id';
    const conditions = [];
    const params = [];
    let idx = 1;
    // Admin sees all, others see only their own
    if (req.user.role !== 'ADMIN') {
      conditions.push(`nl.user_id = $${idx++}`);
      params.push(req.user.id);
    }
    if (channel) { conditions.push(`nl.channel = $${idx++}`); params.push(channel.toUpperCase()); }
    if (eventType) { conditions.push(`nl.event_type = $${idx++}`); params.push(eventType); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ` ORDER BY nl.created_at DESC LIMIT $${idx}`;
    params.push(limit);
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    // If notification_log table doesn't exist, return empty array
    if (e.message && e.message.includes('does not exist')) return res.json([]);
    next(e);
  }
});

// ── Send test notification ─────────────────────────────────────
app.post('/api/notifications/test', auth, allow('ADMIN'), async (req, res, next) => {
  try {
    const { channel, recipient } = req.body;
    if (!channel || !recipient) return res.status(400).json({ message: 'channel and recipient required.' });
    if (channel === 'EMAIL') {
      const result = await sendEmail(recipient, 'RHoSAM Test Notification',
        `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px"><div style="background:#16a34a;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center"><h1 style="margin:0">📧 Test Email</h1></div><div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px"><p>This is a test notification from RHoSAM Supermarket POS.</p><p style="color:#666;font-size:13px">If you received this, email notifications are working correctly.</p><p style="color:#9ca3af;font-size:12px;margin-top:16px">Sent at ${new Date().toLocaleString('en-NG')}</p></div></div>`
      );
      try {
        await pool.query(
          'INSERT INTO notification_log(user_id,event_type,channel,recipient,subject,body,status,error_message) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [req.user.id, 'SYSTEM_ALERT', 'EMAIL', recipient, 'Test Email', 'Test notification', result.ok ? 'SENT' : 'FAILED', result.error || null]
        );
      } catch (_) { /* log table may not exist yet */ }
      return result.ok ? res.json({ message: 'Test email sent!' }) : res.status(500).json({ message: result.error });
    }
    if (channel === 'SMS') {
      const result = await sendSMS(recipient, 'RHoSAM Test: SMS notifications are working! 🛍️');
      try {
        await pool.query(
          'INSERT INTO notification_log(user_id,event_type,channel,recipient,subject,body,status,error_message) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [req.user.id, 'SYSTEM_ALERT', 'SMS', recipient, 'Test SMS', 'Test notification', result.ok ? 'SENT' : 'FAILED', result.error || null]
        );
      } catch (_) { /* log table may not exist yet */ }
      return result.ok ? res.json({ message: 'Test SMS sent!' }) : res.status(500).json({ message: result.error });
    }
    res.status(400).json({ message: 'Invalid channel. Use EMAIL or SMS.' });
  } catch (e) { next(e); }
});

// ── Send manual notification ───────────────────────────────────
app.post('/api/notifications/send', auth, allow('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { userId, eventType, subject, emailHtml, smsText } = req.body;
    if (!userId || !eventType) return res.status(400).json({ message: 'userId and eventType required.' });
    await notifyUser(Number(userId), eventType, { subject, emailHtml, smsText });
    res.json({ message: 'Notification sent.' });
  } catch (e) { next(e); }
});

// ── Notification status endpoint ───────────────────────────────
app.get('/api/notifications/status', auth, allow('ADMIN'), async (req, res, next) => {
  try {
    const emailConfigured = !!resend;
    const smsConfigured = !!telnyx;
    let stats = [];
    try {
      const result = await pool.query(
        `SELECT channel, status, COUNT(*)::int AS count
         FROM notification_log
         WHERE created_at >= NOW() - INTERVAL '7 days'
         GROUP BY channel, status`
      );
      stats = result.rows;
    } catch (_) { /* notification_log table may not exist yet */ }
    res.json({ emailConfigured, smsConfigured, recentStats: stats });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// SMS TEXT MESSAGING
// ═══════════════════════════════════════════════════════════════════

// ── SMS Receipt (after POS sale) ────────────────────────────────
app.post('/api/sales/:id/sms-receipt', auth, async (req, res, next) => {
  try {
    if (!telnyx) return res.status(503).json({ message: 'SMS not configured. Add TELNYX_API_KEY to environment.' });
    const saleId = Number(req.params.id);
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Customer phone number required.' });

    const { rows: saleRows } = await pool.query(
      `SELECT s.*, u.name AS cashier_name FROM sales s JOIN users u ON u.id = s.cashier_id WHERE s.id=$1`, [saleId]
    );
    if (!saleRows[0]) return res.status(404).json({ message: 'Sale not found.' });

    const { rows: items } = await pool.query('SELECT * FROM sale_items WHERE sale_id=$1', [saleId]);
    const sale = saleRows[0];
    const fmt = (n) => '\u20A6' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    const dateStr = new Date(sale.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

    // Build SMS text receipt
    let smsText = `RHoSAM Supermarket\nReceipt: ${sale.receipt_number}\nDate: ${dateStr}\nCashier: ${sale.cashier_name}\n\n`;
    for (const item of items) {
      smsText += `${item.product_name} x${item.quantity} — ${fmt(item.line_total)}\n`;
    }
    smsText += `\nSubtotal: ${fmt(sale.subtotal)}`;
    if (Number(sale.discount) > 0) smsText += `\nDiscount: -${fmt(sale.discount)}`;
    if (Number(sale.tax) > 0) smsText += `\nTax: ${fmt(sale.tax)}`;
    smsText += `\nTOTAL: ${fmt(sale.total)}`;
    if (Number(sale.amount_paid) > 0) {
      smsText += `\nPaid: ${fmt(sale.amount_paid)}`;
      if (Number(sale.change_amount) > 0) smsText += `\nChange: ${fmt(sale.change_amount)}`;
    }
    smsText += `\n\nThank you for shopping with us! RHoSAM Supermarket`;

    const result = await sendSMS(phone, smsText);

    try {
      await pool.query(
        'INSERT INTO notification_log(user_id,event_type,channel,recipient,subject,body,status,error_message,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [req.user.id, 'NEW_SALE', 'SMS', phone, 'SMS Receipt', smsText, result.ok ? 'SENT' : 'FAILED', result.error || null, JSON.stringify({ saleId, receiptNumber: sale.receipt_number })]
      );
    } catch (_) { /* log table may not exist yet */ }

    if (!result.ok) return res.status(500).json({ message: result.error || 'Failed to send SMS.' });
    await audit(pool, req.user.id, 'SMS_RECEIPT', 'SALE', saleId, { phone, receiptNumber: sale.receipt_number }, req);
    res.json({ message: 'SMS receipt sent successfully.' });
  } catch (e) { next(e); }
});

// ── Send SMS to a customer ──────────────────────────────────────
app.post('/api/sms/send', auth, allow('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    if (!telnyx) return res.status(503).json({ message: 'SMS not configured. Add TELNYX_API_KEY to environment.' });
    const { phone, message, customerId } = req.body;
    if (!phone || !message) return res.status(400).json({ message: 'phone and message required.' });
    if (message.length > 1600) return res.status(400).json({ message: 'Message too long (max 1600 characters).' });

    const result = await sendSMS(phone, message);

    try {
      await pool.query(
        'INSERT INTO notification_log(user_id,event_type,channel,recipient,subject,body,status,error_message,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [req.user.id, 'SYSTEM_ALERT', 'SMS', phone, 'Customer SMS', message, result.ok ? 'SENT' : 'FAILED', result.error || null, JSON.stringify({ customerId: customerId || null })]
      );
    } catch (_) { /* log table may not exist yet */ }

    await audit(pool, req.user.id, 'SMS_SENT', 'CUSTOMER', customerId || null, { phone, preview: message.substring(0, 100) }, req);
    if (!result.ok) return res.status(500).json({ message: result.error || 'Failed to send SMS.' });
    res.json({ message: 'SMS sent successfully.' });
  } catch (e) { next(e); }
});

// ── Bulk SMS to all customers with phone numbers ────────────────
app.post('/api/sms/bulk', auth, allow('ADMIN'), async (req, res, next) => {
  try {
    if (!telnyx) return res.status(503).json({ message: 'SMS not configured. Add TELNYX_API_KEY to environment.' });
    const { message, customerIds } = req.body;
    if (!message) return res.status(400).json({ message: 'message required.' });
    if (message.length > 1600) return res.status(400).json({ message: 'Message too long (max 1600 characters).' });

    // Get customers with phone numbers (optionally filtered by IDs)
    let sql = 'SELECT id, name, phone FROM customers WHERE phone IS NOT NULL AND phone != \'\'';
    const params = [];
    if (Array.isArray(customerIds) && customerIds.length > 0) {
      sql += ` AND id = ANY($1)`;
      params.push(customerIds);
    }
    sql += ' ORDER BY name';
    const { rows: customers } = await pool.query(sql, params);

    if (!customers.length) return res.status(400).json({ message: 'No customers with phone numbers found.' });

    let sent = 0, failed = 0;
    const results = [];

    for (const cust of customers) {
      try {
        const result = await sendSMS(cust.phone, message);
        try {
          await pool.query(
            'INSERT INTO notification_log(user_id,event_type,channel,recipient,subject,body,status,error_message,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [req.user.id, 'SYSTEM_ALERT', 'SMS', cust.phone, 'Bulk SMS', message, result.ok ? 'SENT' : 'FAILED', result.error || null, JSON.stringify({ customerId: cust.id, customerName: cust.name, bulk: true })]
          );
        } catch (_) { /* log table may not exist yet */ }
        if (result.ok) sent++; else failed++;
        results.push({ id: cust.id, name: cust.name, phone: cust.phone, status: result.ok ? 'SENT' : 'FAILED' });
      } catch {
        failed++;
        results.push({ id: cust.id, name: cust.name, phone: cust.phone, status: 'FAILED' });
      }
    }

    await audit(pool, req.user.id, 'BULK_SMS', 'CUSTOMER', null, { message: message.substring(0, 100), total: customers.length, sent, failed }, req);
    res.json({ message: `Bulk SMS complete: ${sent} sent, ${failed} failed out of ${customers.length} customers.`, sent, failed, total: customers.length, results });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// STAFF SMS ALERTS
// ═══════════════════════════════════════════════════════════════════

// Broadcast SMS alert to all users with a specific role
async function sendRoleSmsAlert(role, message) {
  if (!telnyx) return;
  try {
    const { rows } = await pool.query('SELECT id, name, phone FROM users WHERE role=$1 AND is_active=TRUE AND phone IS NOT NULL AND phone != \'\'', [role]);
    for (const user of rows) {
      // Check if user has SMS enabled for SYSTEM_ALERT
      const { rows: prefRows } = await pool.query(
        'SELECT sms_enabled FROM notification_preferences WHERE user_id=$1 AND event_type=$2', [user.id, 'SYSTEM_ALERT']
      );
      const pref = prefRows[0];
      if (pref && !pref.sms_enabled) continue; // user has explicitly disabled SMS for system alerts

      const result = await sendSMS(user.phone, message);
      try {
        await pool.query(
          'INSERT INTO notification_log(user_id,event_type,channel,recipient,subject,body,status,error_message,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [user.id, 'SYSTEM_ALERT', 'SMS', user.phone, 'Staff Alert', message, result.ok ? 'SENT' : 'FAILED', result.error || null]
        );
      } catch (_) { /* log table may not exist yet */ }
    }
  } catch (e) { console.error('[SMS ALERT]', e.message); }
}

// ── Low stock SMS alert helper ──────────────────────────────────
async function sendLowStockSmsAlert(product, quantity) {
  const msg = `⚠️ LOW STOCK ALERT\n\n${product.name} is running low!\nCurrent stock: ${quantity} ${product.unit || 'units'}\nReorder level: ${product.reorder_level || 5}\n\nAction needed: Reorder from suppliers.`;
  await sendRoleSmsAlert('ADMIN', msg);
  await sendRoleSmsAlert('MANAGER', msg);
}

// ── Out of stock SMS alert helper ───────────────────────────────
async function sendOutOfStockSmsAlert(product) {
  const msg = `🚫 OUT OF STOCK\n\n${product.name} (Barcode: ${product.barcode})\nis now OUT OF STOCK!\n\nImmediate action required.`;
  await sendRoleSmsAlert('ADMIN', msg);
  await sendRoleSmsAlert('MANAGER', msg);
}

// ── Expiring soon SMS alert helper ──────────────────────────────
async function sendExpirySmsAlert(product, daysLeft) {
  const msg = `⏰ EXPIRY ALERT\n\n${product.name} (Batch: ${product.batch_number || 'N/A'})\nis expiring in ${daysLeft} days!\n\nPlease arrange for clearance or removal.`;
  await sendRoleSmsAlert('ADMIN', msg);
  await sendRoleSmsAlert('MANAGER', msg);
}

// ── Dedicated SMS Test Endpoint ──────────────────────────────
app.post('/api/sms/test', auth, allow('ADMIN'), async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'phone number required.' });
    if (!telnyx) return res.status(503).json({ message: 'SMS not configured. Add TELNYX_API_KEY to environment.' });

    const testMessage = `✅ RHoSAM SMS Test\n\nSMS notifications are working correctly!\n\nSent at: ${new Date().toLocaleString('en-NG')}\nFrom: RHoSAM Supermarket POS`;
    const result = await sendSMS(phone, testMessage);

    try {
      await pool.query(
        'INSERT INTO notification_log(user_id,event_type,channel,recipient,subject,body,status,error_message) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [req.user.id, 'SYSTEM_ALERT', 'SMS', phone, 'SMS Test', testMessage, result.ok ? 'SENT' : 'FAILED', result.error || null]
      );
    } catch (_) { /* log table may not exist yet */ }

    if (!result.ok) return res.status(500).json({ message: result.error || 'Failed to send SMS.' });
    await audit(pool, req.user.id, 'SMS_TEST', 'SYSTEM', null, { phone }, req);
    res.json({ message: 'Test SMS sent successfully.', phone, timestamp: new Date().toISOString() });
  } catch (e) { next(e); }
});

// ── Wire SMS into stock deduction (products update endpoint) ────
// We hook into the product update to check stock levels after changes
// This is called from the existing PUT /api/products/:id and POST /api/sales

// ═══════════════════════════════════════════════════════════════════
// PHONE BARCODE SCANNER RELAY
// ═══════════════════════════════════════════════════════════════════
// In-memory store: session → { sseClients: Set, lastBarcode, lastSeen }
const scannerSessions = {};
// Cleanup stale sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of Object.entries(scannerSessions)) {
    if (now - session.lastSeen > 10 * 60 * 1000) {
      // Close all SSE connections for stale session
      for (const client of session.sseClients) {
        try { client.end(); } catch {}
      }
      delete scannerSessions[id];
    }
  }
}, 5 * 60 * 1000);

function getOrCreateSession(sessionId) {
  if (!scannerSessions[sessionId]) {
    scannerSessions[sessionId] = {
      sseClients: new Set(),
      lastBarcode: null,
      lastSeen: Date.now(),
    };
  }
  return scannerSessions[sessionId];
}

// GET /api/scanner/stream — POS subscribes via SSE to receive barcodes
app.get("/api/scanner/stream", (req, res) => {
  const sessionId = String(req.query.session || "");
  if (!sessionId) return res.status(400).json({ message: "session query param required." });
  const session = getOrCreateSession(sessionId);
  session.lastSeen = Date.now();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send initial keepalive comment
  res.write(":connected\n\n");

  session.sseClients.add(res);
  console.log(`[SCANNER] POS connected to session ${sessionId} (${session.sseClients.size} client(s))`);

  // Heartbeat every 15s to keep connection alive and prevent session cleanup
  const heartbeat = setInterval(() => {
    try { res.write(":heartbeat\n\n"); session.lastSeen = Date.now(); } catch {}
  }, 15000);

  req.on("close", () => {
    session.sseClients.delete(res);
    clearInterval(heartbeat);
    console.log(`[SCANNER] POS disconnected from session ${sessionId} (${session.sseClients.size} left)`);
  });
});

// POST /api/scanner/submit — Phone scanner submits a barcode
app.post("/api/scanner/submit", async (req, res, next) => {
  try {
    const { sessionId, barcode } = req.body;
    if (!sessionId || !barcode) return res.status(400).json({ message: "sessionId and barcode required." });
    const session = getOrCreateSession(sessionId);
    session.lastBarcode = { code: String(barcode), timestamp: Date.now() };
    session.lastSeen = Date.now();

    // Look up the product by barcode
    let product = null;
    try {
      const { rows } = await pool.query(
        "SELECT id, name, barcode, price, stock, category, reorder_level, image_url FROM products WHERE barcode = $1",
        [barcode]
      );
      product = rows[0] || null;
    } catch {}

    // Broadcast to all POS clients listening on this session
    const payload = JSON.stringify({ barcode: String(barcode), product, timestamp: Date.now() });
    for (const client of session.sseClients) {
      try {
        client.write(`data: ${payload}\n\n`);
      } catch {
        session.sseClients.delete(client);
      }
    }

    console.log(`[SCANNER] Barcode ${barcode} from session ${sessionId} → ${session.sseClients.size} POS client(s)`);
    res.json({ ok: true, product, listeners: session.sseClients.size });
  } catch (e) { next(e); }
});

// GET /api/scanner/status — POS checks if scanner is connected
app.get("/api/scanner/status", (req, res) => {
  const sessionId = String(req.query.session || "");
  if (!sessionId) return res.json({ connected: false });
  const session = scannerSessions[sessionId];
  if (!session) return res.json({ connected: false });
  // Consider scanner connected if someone submitted a barcode in last 30s
  const recentSubmit = Date.now() - session.lastSeen < 30000;
  res.json({ connected: recentSubmit, lastBarcode: session.lastBarcode, posListeners: session.sseClients.size });
});

// GET /api/scanner/lookup — public product search for phone scanner autocomplete (no auth required)
app.get("/api/scanner/lookup", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 1) return res.json([]);
    // Search by barcode (exact prefix) or name (LIKE), limit 8 results
    const { rows } = await pool.query(
      `SELECT id, barcode, name, category, price::float, stock::int, reorder_level::int, unit
       FROM products
       WHERE barcode LIKE $1 OR LOWER(name) LIKE $2
       ORDER BY
         CASE WHEN barcode LIKE $1 THEN 0 ELSE 1 END,
         name
       LIMIT 8`,
      [`${q}%`, `%${q.toLowerCase()}%`]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ── Store Commerce Feature Routes ─────────────────────────────
const registerStoreCommerceRoutes = require("./store-commerce-routes");
registerStoreCommerceRoutes(app, pool, auth, allow);

// ── Error handler (Express 5 compatible) ────────────────────────
app.use((e, _q, r, _next) => {
  console.error("[ERROR]", e.message, e.stack?.split("\n").slice(0,3).join("\n"));
  const status = e.status || e.statusCode || 500;
  r.status(status).json({ message: e.message || "Unexpected server error." });
});

const { runMigrations } = require("./run-migrations");

// Export for testing (app only starts listening when run directly)
module.exports = { app, pool };

if (require.main === module) {
  app.listen(port, async () => {
    console.log(`RHoSAM API running on http://localhost:${port}`);
    try { await runMigrations(pool); } catch (e) { console.error("[MIGRATIONS] Error:", e.message); }
    // Bootstrap default admin if no users exist
    try {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS cnt FROM users");
      if (rows[0].cnt === 0) {
        const hash = await bcrypt.hash("admin123", saltRounds);
        await pool.query(
          "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)",
          ["Admin", "admin@rhosam.com", hash, "ADMIN"]
        );
        console.log("[BOOTSTRAP] ✅ Created default admin: admin@rhosam.com / admin123 — CHANGE THIS PASSWORD!");
      }
    } catch (e) { console.error("[BOOTSTRAP] Error:", e.message); }
    await loadPaymentSettings();
  });
}
