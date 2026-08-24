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

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "2mb" }));

// Simple in-memory rate limiter (Express 5 compatible)
const rateLimits = {};
function makeRateLimiter(windowMs, max) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const key = `${req.path}:${ip}`;
    const now = Date.now();
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
app.use("/api/auth/forgot-password", makeRateLimiter(15 * 60 * 1000, 20));

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

app.get("/api/health", async (_q, r, n) => {
  try { await pool.query("SELECT 1"); r.json({ status: "ok" }); }
  catch (e) { n(e); }
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
    await pool.query("UPDATE users SET password_hash=$1,password_changed_at=NOW(),updated_at=NOW() WHERE id=$2", [hash, req.user.id]);
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
    await pool.query("UPDATE users SET mfa_secret=$1 WHERE id=$2", [secret, req.user.id]);

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

app.get("/api/users", auth, allow("ADMIN"), async (_q, r, n) => {
  try {
    r.json((await pool.query(
      `SELECT u.id,u.name,u.email,u.role,u.is_active,u.failed_login_attempts,u.locked_until,u.last_login_at,u.created_at,
              u.branch_id, b.name AS branch_name
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
       ORDER BY u.name`
    )).rows);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

app.post("/api/users", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const { name, email, password, role, branchId } = req.body;
    if (!name || !email || String(password).length < 8 || !["ADMIN", "MANAGER", "CASHIER"].includes(role))
      return res.status(400).json({ message: "Name, valid email, role and password (min 8 chars) required." });
    const hash = await bcrypt.hash(password, saltRounds);
    const { rows } = await pool.query(
      "INSERT INTO users(name,email,password_hash,role,branch_id) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,is_active,branch_id",
      [name, String(email).trim().toLowerCase(), hash, role, branchId || null]
    );
    await audit(pool, req.user.id, "CREATE", "USER", rows[0].id, { name: rows[0].name, email: rows[0].email, role, branchId }, req);
    res.status(201).json(rows[0]);
  } catch (e) { e.code === "23505" ? res.status(409).json({ message: "Email already exists." }) : next(e); }
});

app.patch("/api/users/:id", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
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
    // Fetch user details before deletion for audit log
    const { rows: userRows } = await pool.query("SELECT name, email, role FROM users WHERE id=$1", [id]);
    if (!userRows[0]) return res.status(404).json({ message: "User not found." });
    const deletedUser = userRows[0];
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
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
    let sql = "SELECT id,barcode,name,category,price::float,cost_price::float,stock,reorder_level,unit,image_url,description,is_active,created_at FROM products";
    const params = [];
    if (search) {
      sql += " WHERE LOWER(name) LIKE $1 OR barcode LIKE $1 OR LOWER(category) LIKE $1";
      params.push(`%${String(search).toLowerCase()}%`);
    }
    sql += " ORDER BY name";
    r.json((await pool.query(sql, params)).rows);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

app.post("/api/products", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { barcode, name, category, price, costPrice = 0, stock = 0, reorderLevel = 5, unit = "PCS", description = "" } = req.body;
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
      `INSERT INTO products(barcode,name,category,price,cost_price,stock,reorder_level,unit,description,image_url)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id,barcode,name,category,price::float,cost_price::float,stock,reorder_level,unit,image_url,description,is_active`,
      [barcode, name, category, price, costPrice, stock, reorderLevel, unit, description, req.body.imageUrl || null]
    );
    await audit(pool, req.user.id, "CREATE", "PRODUCT", rows[0].id, { barcode, name, category }, req);
    const warnings = [];
    if (categoryExists) warnings.push(`Category "${category}" already has other products.`);
    res.status(201).json({ ...rows[0], warnings });
  } catch (e) { next(e); }
});

app.put("/api/products/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { barcode, name, category, price, costPrice, stock, reorderLevel, unit, description, isActive } = req.body;

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
        image_url=COALESCE($12,image_url), updated_at=NOW()
       WHERE id=$11
       RETURNING id,barcode,name,category,price::float,cost_price::float,stock,reorder_level,unit,image_url,description,is_active`,
      [barcode, name, category, price, costPrice, stock, reorderLevel, unit, description, isActive, id, req.body.imageUrl ?? null]
    );
    if (!rows[0]) return res.status(404).json({ message: "Product not found." });
    await audit(pool, req.user.id, "UPDATE", "PRODUCT", id, req.body, req);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.delete("/api/products/:id", auth, allow("ADMIN"), async (req, res, next) => {
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
    await pool.query(
      "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,$2,$3,$4,$5,$6)",
      [id, type, adj, `ADJ-${Date.now()}`, req.user.id, notes || ""]
    );
    await audit(pool, req.user.id, "ADJUST_STOCK", "PRODUCT", id, { type, qty: adj }, req);
    res.json({ message: "Stock adjusted." });
  } catch (e) { next(e); }
});

app.get("/api/inventory/movements", auth, async (q, r, n) => {
  try {
    const productId = q.query.product_id;
    let sql = `SELECT im.*, p.name AS product_name, u.name AS user_name
               FROM inventory_movements im
               JOIN products p ON p.id = im.product_id
               LEFT JOIN users u ON u.id = im.user_id`;
    const params = [];
    if (productId) { sql += " WHERE im.product_id = $1"; params.push(Number(productId)); }
    sql += " ORDER BY im.created_at DESC LIMIT 200";
    r.json((await pool.query(sql, params)).rows);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

app.get("/api/products/low-stock", auth, async (_q, r, n) => {
  try {
    r.json((await pool.query(
      "SELECT id,barcode,name,category,stock,reorder_level,price::float FROM products WHERE stock <= reorder_level ORDER BY stock ASC"
    )).rows);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 2: POS / SALES
// ═══════════════════════════════════════════════════════════════════

app.get("/api/sales", auth, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    let where = [];
    let params = [];
    let paramIdx = 1;
    // Cashiers only see their own sales; MANAGERs/ADMINs see branch-wide sales
    if (req.user.role === "CASHIER") { where.push(`s.cashier_id = $${paramIdx++}`); params.push(req.user.id); }
    else if (req.user.role === "MANAGER" && req.user.branchId) { where.push(`s.branch_id = $${paramIdx++}`); params.push(req.user.branchId); }
    // ADMIN sees all branches (no branch filter)
    if (from) { where.push(`s.created_at >= $${paramIdx++}`); params.push(from); }
    if (to) { where.push(`s.created_at <= $${paramIdx++}`); params.push(to); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const sql = `SELECT s.id,s.receipt_number,s.customer_name,s.payment_method,s.subtotal::float,s.discount::float,s.tax::float,
              s.total::float,s.amount_paid::float,s.status,s.created_at,s.branch_id,b.name AS branch_name,u.name AS cashier_name,
              COALESCE(SUM(si.quantity),0)::int AS item_count
       FROM sales s JOIN users u ON u.id = s.cashier_id
       LEFT JOIN branches b ON b.id = s.branch_id
       LEFT JOIN sale_items si ON si.sale_id = s.id ${w}
       GROUP BY s.id,u.name,b.name ORDER BY s.created_at DESC LIMIT 200`;
    const result = await pool.query(sql, params);
    res.json(result.rows);
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
    const { customerName = "Walk-in Customer", customerId, paymentMethod, items, discount = 0, tax = 0, amountPaid } = req.body;
    if (!["Cash", "Card", "Transfer", "POS"].includes(paymentMethod))
      return res.status(400).json({ message: "Invalid payment method." });
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ message: "Cart is empty." });

    await client.query("BEGIN");
    let subtotal = 0;
    const details = [];

    for (const x of items) {
      const productId = Number(x.productId);
      const quantity = Number(x.quantity);
      const itemDiscount = Number(x.discount || 0);
      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1)
        throw Object.assign(new Error("Invalid sale item."), { status: 400 });

      const { rows } = await client.query("SELECT id,name,price::float,stock FROM products WHERE id=$1 FOR UPDATE", [productId]);
      const product = rows[0];
      if (!product) throw Object.assign(new Error("Product not found."), { status: 404 });
      if (product.stock < quantity)
        throw Object.assign(new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}`), { status: 409 });

      const lineTotal = Number(product.price) * quantity - itemDiscount;
      subtotal += lineTotal;
      details.push({ productId: product.id, name: product.name, price: Number(product.price), quantity, discount: itemDiscount, lineTotal });
    }

    const total = subtotal - Number(discount) + Number(tax);
    const paidRaw = amountPaid != null ? Number(amountPaid) : total;
    const paid = Number.isFinite(paidRaw) && paidRaw >= 0 ? paidRaw : total;
    const change = Math.max(0, paid - total);
    const receiptNumber = `RHS-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

    // Use the logged-in user's branch_id for the sale
    const saleBranchId = req.user.branchId || null;
    const { rows } = await client.query(
      `INSERT INTO sales(receipt_number,customer_name,customer_id,payment_method,subtotal,discount,tax,total,amount_paid,change_amount,cashier_id,branch_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,created_at`,
      [receiptNumber, customerName, customerId || null, paymentMethod, subtotal, discount, tax, total, paid, change, req.user.id, saleBranchId]
    );
    const sale = rows[0];

    for (const item of details) {
      await client.query(
        "INSERT INTO sale_items(sale_id,product_id,product_name,unit_price,quantity,discount,line_total) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [sale.id, item.productId, item.name, item.price, item.quantity, item.discount, item.lineTotal]
      );
      await client.query("UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2", [item.quantity, item.productId]);
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

app.get("/api/dashboard/stats", auth, async (req, r, n) => {
  try {
    // Branch-scoped: ADMIN can pick a branch via ?branchId=X; others see their own branch
    const adminBranchId = req.user.role === "ADMIN" ? (req.query.branchId ? Number(req.query.branchId) : null) : null;
    let branchFilter, userBranchFilter;
    if (adminBranchId) {
      branchFilter = ` AND s.branch_id = ${adminBranchId}`;
      userBranchFilter = ` AND u.branch_id = ${adminBranchId}`;
    } else if (req.user.role === "ADMIN") {
      branchFilter = "";
      userBranchFilter = "";
    } else if (req.user.branchId) {
      branchFilter = ` AND s.branch_id = ${req.user.branchId}`;
      userBranchFilter = ` AND u.branch_id = ${req.user.branchId}`;
    } else {
      branchFilter = ` AND s.cashier_id = ${req.user.id}`;
      userBranchFilter = ` AND u.id = ${req.user.id}`;
    }
    // When viewing a specific branch, scope products to those sold at that branch
    const productFilter = adminBranchId
      ? ` AND p.id IN (SELECT si.product_id FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.branch_id = ${adminBranchId})`
      : (req.user.role !== 'ADMIN' && req.user.branchId)
        ? ` AND p.id IN (SELECT si.product_id FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.branch_id = ${req.user.branchId})`
        : '';
    const lowStockFilter = productFilter; // same logic: if branch-scoped, show only that branch's low-stock products
    const [totalProducts, totalSales, totalRevenue, lowStock, todaySales, todayRevenue, totalUsers, recentSales] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM products p WHERE p.is_active = TRUE${productFilter}`),
      pool.query(`SELECT COUNT(*)::int AS count FROM sales s WHERE 1=1${branchFilter}`),
      pool.query(`SELECT COALESCE(SUM(s.total),0)::float AS total FROM sales s WHERE 1=1${branchFilter}`),
      pool.query(`SELECT COUNT(*)::int AS count FROM products p WHERE p.stock <= p.reorder_level AND p.is_active = TRUE${lowStockFilter}`),
      pool.query(`SELECT COUNT(*)::int AS count FROM sales s WHERE s.created_at::date = CURRENT_DATE${branchFilter}`),
      pool.query(`SELECT COALESCE(SUM(s.total),0)::float AS total FROM sales s WHERE s.created_at::date = CURRENT_DATE${branchFilter}`),
      pool.query(`SELECT COUNT(*)::int AS count FROM users u WHERE u.is_active = TRUE${userBranchFilter}`),
      pool.query(`SELECT date_trunc('day',s.created_at)::date AS day, COUNT(*)::int AS count, COALESCE(SUM(s.total),0)::float AS revenue
                  FROM sales s WHERE s.created_at >= NOW() - INTERVAL '30 days'${branchFilter}
                  GROUP BY 1 ORDER BY 1`)
    ]);
    r.json({
      totalProducts: totalProducts.rows[0].count,
      totalSales: totalSales.rows[0].count,
      totalRevenue: totalRevenue.rows[0].total,
      lowStockCount: lowStock.rows[0].count,
      todaySales: todaySales.rows[0].count,
      todayRevenue: todayRevenue.rows[0].total,
      totalUsers: totalUsers.rows[0].count,
      salesChart: recentSales.rows
    });
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

app.get("/api/dashboard/top-products", auth, async (req, r, n) => {
  try {
    const adminBranchId = req.user.role === "ADMIN" ? (req.query.branchId ? Number(req.query.branchId) : null) : null;
    let branchFilter;
    if (adminBranchId) branchFilter = ` AND s.branch_id = ${adminBranchId}`;
    else if (req.user.role === "ADMIN") branchFilter = "";
    else if (req.user.branchId) branchFilter = ` AND s.branch_id = ${req.user.branchId}`;
    else branchFilter = ` AND s.cashier_id = ${req.user.id}`;
    r.json((await pool.query(
      `SELECT si.product_name, SUM(si.quantity)::int AS total_qty, SUM(si.line_total)::float AS total_revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= NOW() - INTERVAL '30 days'${branchFilter}
       GROUP BY si.product_name ORDER BY total_revenue DESC LIMIT 10`
    )).rows);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

app.get("/api/dashboard/category-sales", auth, async (req, r, n) => {
  try {
    const adminBranchId = req.user.role === "ADMIN" ? (req.query.branchId ? Number(req.query.branchId) : null) : null;
    let branchFilter;
    if (adminBranchId) branchFilter = ` AND s.branch_id = ${adminBranchId}`;
    else if (req.user.role === "ADMIN") branchFilter = "";
    else if (req.user.branchId) branchFilter = ` AND s.branch_id = ${req.user.branchId}`;
    else branchFilter = ` AND s.cashier_id = ${req.user.id}`;
    r.json((await pool.query(
      `SELECT p.category, SUM(si.line_total)::float AS revenue, SUM(si.quantity)::int AS qty
       FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= NOW() - INTERVAL '30 days'${branchFilter}
       GROUP BY p.category ORDER BY revenue DESC`
    )).rows);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// BRANCH SUMMARY — Admin overview of all branches
// ═══════════════════════════════════════════════════════════════════

app.get("/api/dashboard/branch-summary", auth, allow("ADMIN"), async (req, res, next) => {
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
    // Low stock per branch: products sold at that branch that are below reorder level
    const branchIds = result.rows.map(r => r.id);
    let lowStockMap = {};
    if (branchIds.length) {
      const { rows: stockRows } = await pool.query(
        `SELECT s.branch_id, COUNT(DISTINCT p.id)::int AS low_stock_count
         FROM products p
         JOIN sale_items si ON si.product_id = p.id
         JOIN sales s ON s.id = si.sale_id
         WHERE p.stock <= p.reorder_level AND p.is_active = TRUE
         GROUP BY s.branch_id`
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

app.get("/api/suppliers", auth, async (_q, r, n) => {
  try { r.json((await pool.query("SELECT * FROM suppliers ORDER BY name")).rows); }
  catch (e) { n(e); }
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

app.put("/api/suppliers/:id", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
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
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.delete("/api/suppliers/:id", auth, allow("ADMIN"), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM suppliers WHERE id=$1", [Number(req.params.id)]);
    if (rowCount === 0) return res.status(404).json({ message: "Supplier not found." });
    await audit(pool, req.user.id, "DELETE", "SUPPLIER", req.params.id, {}, req);
    res.json({ message: "Supplier deleted." });
  } catch (e) { next(e); }
});

// Purchase Orders
app.get("/api/purchase-orders", auth, async (_q, r, n) => {
  try {
    let whereClause = "";
    const params = [];
    if (req.user.role !== "ADMIN" && req.user.branchId) {
      whereClause = " WHERE po.branch_id = $1";
      params.push(req.user.branchId);
    }
    r.json((await pool.query(
      `SELECT po.*, s.name AS supplier_name, u.name AS created_by_name
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN users u ON u.id = po.created_by${whereClause}
       ORDER BY po.created_at DESC LIMIT 100`,
      params
    )).rows);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

app.get("/api/purchase-orders/:id", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: poRows } = await pool.query(
      `SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id=$1`, [id]
    );
    if (!poRows[0]) return res.status(404).json({ message: "Purchase order not found." });
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
    const { rows: existing } = await client.query("SELECT status FROM purchase_orders WHERE id=$1", [id]);
    if (!existing[0]) { await client.query("ROLLBACK").catch(() => {}); client.release(); return res.status(404).json({ message: "Purchase order not found." }); }
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
      for (const item of items) {
        const qty = Number(item.quantity);
        await client.query("UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2", [qty, item.product_id]);
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
// PHASE 12: CUSTOMERS / CRM
// ═══════════════════════════════════════════════════════════════════

app.get("/api/customers", auth, async (_q, r, n) => {
  try { r.json((await pool.query("SELECT * FROM customers ORDER BY name")).rows); }
  catch (e) { n(e); }
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

app.put("/api/customers/:id", auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, email, phone } = req.body;
    const { rows } = await pool.query(
      "UPDATE customers SET name=COALESCE($1,name),email=COALESCE($2,email),phone=COALESCE($3,phone) WHERE id=$4 RETURNING *",
      [name, email, phone, id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Customer not found." });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 13: FINANCE — Expenses
// ═══════════════════════════════════════════════════════════════════

app.get("/api/expenses", auth, async (_q, r, n) => {
  try {
    let whereClause = "";
    const params = [];
    if (req.user.role !== "ADMIN" && req.user.branchId) {
      whereClause = " WHERE e.branch_id = $1";
      params.push(req.user.branchId);
    }
    r.json((await pool.query(
      `SELECT e.*, u.name AS approved_by_name FROM expenses e LEFT JOIN users u ON u.id = e.approved_by${whereClause} ORDER BY e.created_at DESC LIMIT 200`,
      params
    )).rows);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
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

app.get("/api/finance/summary", auth, allow("ADMIN", "MANAGER"), async (_q, r, n) => {
  try {
    // Branch-scoped for managers
    const branchFilter = req.user.role === "ADMIN" ? ""
      : req.user.branchId ? ` AND branch_id = ${req.user.branchId}` : "";
    const [salesRev, totalExpenses, todaySales] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total),0)::float AS revenue FROM sales WHERE 1=1${branchFilter}`),
      pool.query(`SELECT COALESCE(SUM(amount),0)::float AS total FROM expenses WHERE 1=1${branchFilter}`),
      pool.query(`SELECT COALESCE(SUM(s.total),0)::float AS revenue,
        COALESCE((SELECT SUM(p.cost_price * si.quantity) FROM sale_items si
          JOIN products p ON p.id = si.product_id
          JOIN sales s2 ON s2.id = si.sale_id
          WHERE s2.created_at::date = CURRENT_DATE${branchFilter.replace(/branch_id/g, 's2.branch_id')}),0)::float AS cost
        FROM sales s WHERE s.created_at::date = CURRENT_DATE${branchFilter.replace(/branch_id/g, 's.branch_id')}`)
    ]);
    const revenue = salesRev.rows[0].revenue;
    const expenses = totalExpenses.rows[0].total;
    const profit = revenue - expenses;
    r.json({ revenue, expenses, profit, todayRevenue: todaySales.rows[0].revenue, todayCost: todaySales.rows[0].cost });
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 8: AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════

app.get("/api/audit-logs", auth, allow("ADMIN"), async (q, r, n) => {
  try {
    const limit = Math.min(Number(q.query.limit) || 200, 500);
    r.json((await pool.query(
      `SELECT a.id,u.name AS user_name,a.action,a.entity_type,a.entity_id,a.details,a.ip_address,a.user_agent,a.created_at
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT $1`, [limit]
    )).rows);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

app.get("/api/audit-logs/login-history", auth, allow("ADMIN"), async (q, r, n) => {
  try {
    const limit = Math.min(Number(q.query.limit) || 100, 500);
    const userId = q.query.user_id;
    let sql = `
      SELECT a.id, u.name AS user_name, u.email, a.action, a.details, a.ip_address, a.user_agent, a.created_at
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.action IN ('LOGIN','FORGOT_PASSWORD','RESET_PASSWORD','CHANGE_PASSWORD','MFA_ENABLED','MFA_DISABLED')`;
    const params = [];
    if (userId) { params.push(Number(userId)); sql += ` AND a.user_id = $${params.length}`; }
    sql += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    r.json((await pool.query(sql, params)).rows);
  } catch (e) { console.error("[LOGIN-HISTORY]", e.message); res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 14: BRANCHES
// ═══════════════════════════════════════════════════════════════════

app.get("/api/branches", auth, async (_q, r, n) => {
  try { r.json((await pool.query("SELECT * FROM branches ORDER BY name")).rows); }
  catch (e) { n(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 14: CASH DRAWER
// ═══════════════════════════════════════════════════════════════════

app.get("/api/cash-drawer", auth, async (_q, r, n) => {
  try {
    r.json((await pool.query(
      `SELECT cd.*, uo.name AS opened_by_name, uc.name AS closed_by_name
       FROM cash_drawer cd
       LEFT JOIN users uo ON uo.id = cd.opened_by
       LEFT JOIN users uc ON uc.id = cd.closed_by
       ORDER BY cd.opened_at DESC LIMIT 50`
    )).rows);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

app.get("/api/cash-drawer/active", auth, async (req, r, n) => {
  try {
    // Branch-scoped: filter active drawer by user's branch
    let whereClause = "cd.status = 'OPEN'";
    const params = [];
    if (req.user.role !== "ADMIN" && req.user.branchId) {
      whereClause += " AND cd.branch_id = $1";
      params.push(req.user.branchId);
    }
    const { rows } = await pool.query(
      `SELECT cd.*, uo.name AS opened_by_name
       FROM cash_drawer cd LEFT JOIN users uo ON uo.id = cd.opened_by
       WHERE ${whereClause} ORDER BY cd.opened_at DESC LIMIT 1`, params
    );
    r.json(rows[0] || null);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

app.post("/api/cash-drawer/open", auth, allow("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const { openingBalance = 0, drawerName = "Main Drawer" } = req.body;
    // Branch-scoped: only check for open drawer in same branch
    let existingQuery = "SELECT id FROM cash_drawer WHERE status = 'OPEN'";
    const existingParams = [];
    if (req.user.role !== "ADMIN" && req.user.branchId) {
      existingQuery += " AND branch_id = $1";
      existingParams.push(req.user.branchId);
    }
    const existing = await pool.query(existingQuery, existingParams);
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
    const { rows: openDrawer } = await pool.query("SELECT * FROM cash_drawer WHERE status = 'OPEN' LIMIT 1");
    if (!openDrawer[0]) return res.status(404).json({ message: "No open drawer found." });
    const drawer = openDrawer[0];
    const salesInPeriod = await pool.query(
      "SELECT COALESCE(SUM(total),0)::float AS total FROM sales WHERE created_at >= $1",
      [drawer.opened_at]
    );
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

app.post("/api/branches", auth, allow("ADMIN"), async (req, res, next) => {
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

app.put("/api/branches/:id", auth, allow("ADMIN"), async (req, res, next) => {
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

app.delete("/api/branches/:id", auth, allow("ADMIN"), async (req, res, next) => {
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
    // Check source branch has enough stock
    const { rows: stockRows } = await pool.query("SELECT stock FROM products WHERE id=$1", [productId]);
    if (!stockRows[0]) return res.status(404).json({ message: "Product not found." });
    const { rows } = await pool.query(
      `INSERT INTO stock_transfers(from_branch_id, to_branch_id, product_id, quantity, requested_by, notes)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [fromBranchId, Number(toBranchId), productId, Number(quantity), req.user.id, notes || ""]
    );
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

    // Get the transfer
    const { rows: existing } = await client.query(
      "SELECT * FROM stock_transfers WHERE id=$1", [id]
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
      // Deduct from source branch (we can't do per-branch stock since products are shared,
      // but we track the movement for audit)
      await client.query(
        "UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2 AND stock >= $1",
        [qty, transfer.product_id]
      );
      // Record inventory movement for source
      await client.query(
        "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,'TRANSFER_OUT',$2,$3,$4,$5)",
        [transfer.product_id, -qty, `TRANSFER-${id}`, req.user.id, `Transfer to branch ${transfer.to_branch_id}`]
      );
      // Add stock to destination
      await client.query(
        "UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2",
        [qty, transfer.product_id]
      );
      // Record inventory movement for destination
      await client.query(
        "INSERT INTO inventory_movements(product_id,movement_type,quantity,reference,user_id,notes) VALUES($1,'TRANSFER_IN',$2,$3,$4,$5)",
        [transfer.product_id, qty, `TRANSFER-${id}`, req.user.id, `Transfer from branch ${transfer.from_branch_id}`]
      );
    }

    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════
// CATEGORY LIST (for dropdowns)
// ═══════════════════════════════════════════════════════════════════

app.get("/api/categories", auth, async (_q, r, n) => {
  try {
    r.json((await pool.query("SELECT DISTINCT category FROM products ORDER BY category")).rows.map(r => r.category));
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// PHASE 15: COMPREHENSIVE REPORTS
// ═══════════════════════════════════════════════════════════════════

// Monthly Sales Report
app.get("/api/reports/monthly", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const adminBranchId = req.user.role === "ADMIN" ? (req.query.branchId ? Number(req.query.branchId) : null) : null;
    let branchFilter;
    if (adminBranchId) branchFilter = ` AND branch_id = ${adminBranchId}`;
    else if (req.user.role === "ADMIN") branchFilter = "";
    else if (req.user.branchId) branchFilter = ` AND branch_id = ${req.user.branchId}`;
    else branchFilter = "";
    const result = await pool.query(
      `SELECT EXTRACT(MONTH FROM created_at)::int AS month,
              COUNT(*)::int AS transactions,
              COALESCE(SUM(total),0)::float AS revenue,
              COALESCE(SUM(discount),0)::float AS discounts,
              COALESCE(SUM(tax),0)::float AS taxes
       FROM sales WHERE EXTRACT(YEAR FROM created_at) = $1${branchFilter}
       GROUP BY 1 ORDER BY 1`, [year]
    );
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const data = result.rows.map(r => ({ month: months[r.month - 1], ...r }));
    // Look up branch name
    let branchName = null;
    const targetBranchId = adminBranchId || req.user.branchId;
    if (targetBranchId) {
      const { rows: bRows } = await pool.query("SELECT name FROM branches WHERE id=$1", [targetBranchId]);
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
    // Branch-scoped: ADMIN can pick a branch
    if (req.user.role === "ADMIN" && req.query.branchId) {
      where.push(`s.branch_id = $${idx++}`);
      params.push(Number(req.query.branchId));
    } else if (req.user.role !== "ADMIN" && req.user.branchId) {
      where.push(`s.branch_id = $${idx++}`);
      params.push(req.user.branchId);
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
app.get("/api/reports/low-stock", auth, allow("ADMIN", "MANAGER"), async (_q, r, n) => {
  try {
    r.json((await pool.query(
      `SELECT id, barcode, name, category, stock, reorder_level, price::float, cost_price::float,
              CASE WHEN stock = 0 THEN 'OUT OF STOCK'
                   WHEN stock <= reorder_level THEN 'LOW'
                   ELSE 'OK' END AS status
       FROM products WHERE stock <= reorder_level AND is_active = TRUE
       ORDER BY stock ASC`
    )).rows);
  } catch (e) { console.error("[SERVER]", e.message); res.status(500).json({ message: e.message }); }
});

// Cashier Sales Report
app.get("/api/reports/cashier-sales", auth, allow("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    let where = [];
    let params = [];
    let idx = 1;
    // Branch-scoped: ADMIN can pick a branch
    if (req.user.role === "ADMIN" && req.query.branchId) {
      where.push(`s.branch_id = $${idx++}`);
      params.push(Number(req.query.branchId));
    } else if (req.user.role !== "ADMIN" && req.user.branchId) {
      where.push(`s.branch_id = $${idx++}`);
      params.push(req.user.branchId);
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
    const adminBranchId = req.user.role === "ADMIN" ? (req.query.branchId ? Number(req.query.branchId) : null) : null;
    let branchFilter, expenseBranchFilter;
    if (adminBranchId) {
      branchFilter = ` AND s.branch_id = ${adminBranchId}`;
      expenseBranchFilter = ` AND e.branch_id = ${adminBranchId}`;
    } else if (req.user.role === "ADMIN") {
      branchFilter = "";
      expenseBranchFilter = "";
    } else if (req.user.branchId) {
      branchFilter = ` AND s.branch_id = ${req.user.branchId}`;
      expenseBranchFilter = ` AND e.branch_id = ${req.user.branchId}`;
    } else {
      branchFilter = "";
      expenseBranchFilter = "";
    }

    const [salesResult, itemsResult, expensesResult, topProducts] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total_transactions,
                COALESCE(SUM(s.total),0)::float AS total_revenue,
                COALESCE(SUM(s.subtotal),0)::float AS subtotal,
                COALESCE(SUM(s.discount),0)::float AS total_discount,
                COALESCE(SUM(s.tax),0)::float AS total_tax,
                COALESCE(SUM(s.amount_paid),0)::float AS total_paid,
                COALESCE(SUM(s.change_amount),0)::float AS total_change
         FROM sales s WHERE s.created_at BETWEEN $1 AND $2${branchFilter}`, [startDate, endDate]
      ),
      pool.query(
        `SELECT si.product_name, SUM(si.quantity)::int AS qty, SUM(si.line_total)::float AS revenue
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.created_at BETWEEN $1 AND $2${branchFilter}
         GROUP BY si.product_name ORDER BY revenue DESC`, [startDate, endDate]
      ),
      pool.query(
        `SELECT COALESCE(SUM(e.amount),0)::float AS total_expenses
         FROM expenses e WHERE e.created_at BETWEEN $1 AND $2${expenseBranchFilter}`, [startDate, endDate]
      ),
      pool.query(
        `SELECT si.product_name, SUM(si.quantity)::int AS qty, SUM(si.line_total)::float AS revenue
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.created_at BETWEEN $1 AND $2${branchFilter}
         GROUP BY si.product_name ORDER BY revenue DESC LIMIT 10`, [startDate, endDate]
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
    const branchFilter = req.user.role === "ADMIN" ? ""
      : req.user.branchId ? ` AND s.branch_id = ${req.user.branchId}` : "";
    const expenseBranchFilter = req.user.role === "ADMIN" ? ""
      : req.user.branchId ? ` AND e.branch_id = ${req.user.branchId}` : "";

    const [salesResult, itemsResult, expensesResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total_transactions,
                COALESCE(SUM(s.total),0)::float AS total_revenue,
                COALESCE(SUM(s.discount),0)::float AS total_discount,
                COALESCE(SUM(s.tax),0)::float AS total_tax
         FROM sales s WHERE s.created_at BETWEEN $1 AND $2${branchFilter}`, [startDate, endDate]
      ),
      pool.query(
        `SELECT si.product_name, SUM(si.quantity)::int AS qty, SUM(si.line_total)::float AS revenue
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.created_at BETWEEN $1 AND $2${branchFilter}
         GROUP BY si.product_name ORDER BY revenue DESC LIMIT 15`, [startDate, endDate]
      ),
      pool.query(
        `SELECT COALESCE(SUM(e.amount),0)::float AS total_expenses
         FROM expenses e WHERE e.created_at BETWEEN $1 AND $2${expenseBranchFilter}`, [startDate, endDate]
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
    if (productId) { sql += ` AND si.product_id = $1`; params.push(Number(productId)); }
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
    const { rows: lowStock } = await pool.query(
      `SELECT p.id, p.barcode, p.name, p.category, p.stock, p.reorder_level,
              p.cost_price::float, p.price::float
       FROM products p
       WHERE p.stock <= p.reorder_level AND p.is_active = TRUE
       ORDER BY (p.stock::float / GREATEST(p.reorder_level, 1)) ASC`
    );
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

app.get("/api/executive/overview", auth, allow("ADMIN"), async (req, res) => {
  try {
    const queries = [
      pool.query(`SELECT
        COALESCE(SUM(total),0)::float AS total_revenue,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN total END),0)::float AS week_revenue,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN total END),0)::float AS month_revenue,
        COUNT(*)::int AS total_transactions,
        COALESCE(AVG(total),0)::float AS avg_transaction
       FROM sales`),
      pool.query(`SELECT
        COALESCE(SUM(amount),0)::float AS total_expenses,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN amount END),0)::float AS month_expenses
       FROM expenses`),
      pool.query(`SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN stock <= reorder_level THEN 1 END)::int AS low_stock,
        COUNT(CASE WHEN stock = 0 THEN 1 END)::int AS out_of_stock
       FROM products WHERE is_active = TRUE`),
      pool.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(total_spent),0)::float AS total_spent, COALESCE(AVG(total_spent),0)::float AS avg_spent FROM customers`),
      pool.query(`SELECT date_trunc('day',created_at)::date AS day,
        COUNT(*)::int AS transactions, COALESCE(SUM(total),0)::float AS revenue
       FROM sales WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1 ORDER BY 1`),
      pool.query(`SELECT u.name, COUNT(s.id)::int AS transactions, COALESCE(SUM(s.total),0)::float AS revenue
       FROM sales s JOIN users u ON u.id = s.cashier_id
       WHERE s.created_at >= NOW() - INTERVAL '30 days'
       GROUP BY u.id, u.name ORDER BY revenue DESC LIMIT 5`),
      pool.query(`SELECT p.category, SUM(si.line_total)::float AS revenue, SUM(si.quantity)::int AS qty
       FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= NOW() - INTERVAL '30 days'
       GROUP BY p.category ORDER BY revenue DESC`),
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

    // Save customer email on the sale
    if (email && !sale.customer_email) {
      await pool.query("UPDATE sales SET customer_name = COALESCE(customer_name, $1) WHERE id = $2 AND customer_name = 'Walk-in Customer'", [email, saleId]);
    }

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

        const { rows } = await client.query(
          `INSERT INTO sales(receipt_number,customer_name,payment_method,subtotal,discount,tax,total,amount_paid,change_amount,cashier_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [receiptNumber, sale.customerName || "Walk-in Customer", sale.paymentMethod || "Cash",
           subtotal, sale.discount || 0, sale.tax || 0, total, sale.amountPaid || total, 0, req.user.id]
        );

        for (const item of (sale.items || [])) {
          const { rows: pRows } = await client.query("SELECT price::float FROM products WHERE id=$1", [item.productId]);
          if (pRows[0]) {
            await client.query(
              "INSERT INTO sale_items(sale_id,product_id,product_name,unit_price,quantity,discount,line_total) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [rows[0].id, item.productId, item.name || 'Product', pRows[0].price, item.quantity, item.discount || 0, pRows[0].price * item.quantity]
            );
            await client.query("UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2", [item.quantity, item.productId]);
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

    // Simulate gateway verification (replace with real Paystack/Flutterwave call)
    // In production: call gateway API to confirm payment matches amount
    const verified = gateway === "INTERNAL" || saleRows[0].payment_method === "Cash"
      ? true  // Cash / internal always verified
      : true; // TODO: Replace with actual gateway API verification

    const status = verified ? "VERIFIED" : "FAILED";
    const verifiedAt = verified ? new Date() : null;

    const { rows } = await pool.query(
      `INSERT INTO payment_verifications(sale_id,gateway,reference,status,amount,card_last4,auth_code,gateway_response,verified_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [Number(saleId), gateway, reference, status, saleRows[0].total,
       cardLast4 || null, authCode || null, JSON.stringify(gatewayResponse || {}), verifiedAt]
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

// ═══════════════════════════════════════════════════════════════════
// DATABASE BACKUP (Admin)
// ═══════════════════════════════════════════════════════════════════

app.get("/api/admin/backup", auth, allow("ADMIN"), async (req, res, next) => {
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

// ── Error handler (Express 5 compatible) ────────────────────────
app.use((e, _q, r, _next) => {
  console.error("[ERROR]", e.message, e.stack?.split("\n").slice(0,3).join("\n"));
  const status = e.status || e.statusCode || 500;
  r.status(status).json({ message: e.message || "Unexpected server error." });
});

app.listen(port, () => console.log(`RHoSAM API running on http://localhost:${port}`));
