import React, { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import QRCode from "qrcode";
import { useAuth } from "./AuthContext";
import { generateReceiptPDF } from "./generateReceiptPDF";
import { generateDamagesReportPDF, generateWastageReportPDF, generateInventoryLossReportPDF } from "./generateReportPDF";
import "./App.css";

function resolveApiUrl(val) {
  if (!val) return "http://localhost:5000/api";
  if (!/^https?:\/\//.test(val)) return `https://${val}/api`;
  return val;
}

// ═══════════════════════════════════════════════════════════════════
// LAYOUT
// ═══════════════════════════════════════════════════════════════════
const MENUS = {
  ADMIN: ["dashboard","executive","pos","products","categories","inventory","damages","wastage","stock-valuation","expiry","import-export","audit-cycle","alerts","notifications","notification-prefs","sales","customers","suppliers","procurement","expenses","finance","forecast","reorder","dailyreport","cashdrawer","branches","messages","transfers","display","supplierportal","users","audit","loginhistory","change-password","mfa","wifiqr","payment-settings","terminals"],
  MANAGER: ["dashboard","pos","products","categories","inventory","damages","wastage","stock-valuation","expiry","import-export","audit-cycle","alerts","notification-prefs","sales","customers","suppliers","procurement","expenses","finance","forecast","reorder","dailyreport","cashdrawer","messages","transfers","change-password","mfa","wifiqr","terminals"],
  CASHIER: ["dashboard","pos","cashdrawer","sales","notification-prefs","change-password","wifiqr"],
};
const LABELS = {
  dashboard: "Dashboard", executive: "Executive", pos: "Point of Sale", products: "Products", categories: "Categories", inventory: "Inventory",
  sales: "Sales History", customers: "Customers", suppliers: "Suppliers", procurement: "Purchase Orders",
  expenses: "Expenses", finance: "Finance", forecast: "AI Forecast", reorder: "Auto Reorder",
  dailyreport: "Reports", users: "User Management", audit: "Audit Logs",
  damages: "Damages", wastage: "Wastage", "stock-valuation": "Stock Valuation",
  expiry: "Expiry Tracking", "import-export": "Import / Export", "audit-cycle": "Audit Cycle", alerts: "Stock Alerts", notifications: "Notification Center", "notification-prefs": "Notification Settings",
  cashdrawer: "Cash Drawer", branches: "Branches", messages: "Messages", transfers: "Stock Transfers", display: "Customer Display", supplierportal: "Supplier Portal",
  "change-password": "Change Password", mfa: "MFA / Security", loginhistory: "Login History", wifiqr: "Wi-Fi QR", "payment-settings": "Payment Settings", terminals: "Payment Terminals",
};
const ICONS = {
  dashboard: "📊", executive: "🎯", pos: "🛒", products: "📦", categories: "🏷️", inventory: "📋", sales: "💰", customers: "👥",
  suppliers: "🏭", procurement: "📥", expenses: "💸", finance: "🏦", forecast: "🤖", reorder: "🔄",
  damages: "⚠️", wastage: "🗑️", "stock-valuation": "💎",
  expiry: "⏰", "import-export": "📤", "audit-cycle": "🔍", alerts: "🔔", notifications: "📬", "notification-prefs": "⚙️",
  dailyreport: "📈", users: "👤", audit: "📝",
  cashdrawer: "💵", branches: "🏢", messages: "💬", transfers: "🔄", display: "🖥️", supplierportal: "🏭",
  "change-password": "🔐", mfa: "🛡️", loginhistory: "🕐", wifiqr: "📶", "payment-settings": "⚙️", terminals: "💳",
};function Layout({ children }) {
  const { user, logout, fetchStockAlerts, fetchInAppNotifications, markNotificationsRead } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("rhosam-theme") === "dark");
  const [alertCount, setAlertCount] = useState(0);
  const [notifCount, setNotifCount] = useState(0);
  const [notifDropdown, setNotifDropdown] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const currentPage = location.pathname.slice(1) || "dashboard";
  const menuItems = MENUS[user?.role] || MENUS.CASHIER;

  // Fetch unread alert count for sidebar badge + in-app notification count
  useEffect(() => {
    fetchStockAlerts(true).then(d => setAlertCount(d?.unread || 0)).catch(() => {});
    fetchInAppNotifications({ unread: true }).then(d => setNotifCount(d?.unread || 0)).catch(() => {});
    const interval = setInterval(() => {
      fetchStockAlerts(true).then(d => setAlertCount(d?.unread || 0)).catch(() => {});
      fetchInAppNotifications({ unread: true }).then(d => setNotifCount(d?.unread || 0)).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchStockAlerts, fetchInAppNotifications]);

  async function toggleNotifDropdown() {
    if (!notifDropdown) {
      try {
        const d = await fetchInAppNotifications({ limit: 20 });
        setNotifications(d?.notifications || []);
        setNotifCount(d?.unread || 0);
      } catch {}
    }
    setNotifDropdown(!notifDropdown);
  }

  async function handleNotifClick(notif) {
    // Mark as read
    if (!notif.is_read) {
      await markNotificationsRead([notif.id]).catch(() => {});
      setNotifCount(prev => Math.max(0, prev - 1));
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
    }
    // Navigate to relevant page
    if (notif.reference_type === 'stock_transfer') {
      navigate('/transfers');
    } else if (notif.reference_type === 'stock_alert') {
      navigate('/alerts');
    }
    setNotifDropdown(false);
  }

  async function markAllNotifsRead() {
    await markNotificationsRead().catch(() => {});
    setNotifCount(0);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  }

  // Apply dark mode class to body
  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
    localStorage.setItem("rhosam-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // PWA Install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    if (window.matchMedia("(display-mode: standalone)").matches) setIsInstalled(true);
    window.addEventListener("appinstalled", () => setIsInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setInstallPrompt(null);
  }

  return (
    <div className={`app-layout ${darkMode ? "dark" : ""}`}>
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <h2>RHoSAM</h2>
          <small>Supermarket POS</small>
        </div>
        <nav className="sidebar-nav">
          {menuItems.map((key) => (
            <button key={key} className={`nav-item ${currentPage === key ? "active" : ""}`}
              onClick={() => { navigate(`/${key}`); setSidebarOpen(false); }}>
              <span className="nav-icon">{ICONS[key]}</span>
              <span className="nav-label">{LABELS[key]}</span>
              {key === 'alerts' && alertCount > 0 && (
                <span className="nav-badge" style={{ marginLeft: 'auto', background: 'var(--danger, #ef4444)', color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 10, minWidth: 18, textAlign: 'center' }}>{alertCount > 99 ? '99+' : alertCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="avatar">{user?.name?.[0]?.toUpperCase() || "U"}</div>
            <div><strong>{user?.name}</strong><br /><small className="role-tag">{user?.role}</small></div>
          </div>
          <button className="logout-btn" onClick={() => { logout(); navigate("/login"); }}>Sign Out</button>
        </div>
      </aside>

      <div className={`sidebar-overlay ${sidebarOpen ? "show" : ""}`} onClick={() => { setSidebarOpen(false); setNotifDropdown(false); }} />

      <div className="main-content">
        {installPrompt && !isInstalled && (
          <div className="install-banner">
            <span>📱 Install RHoSAM POS on your device for faster access</span>
            <button className="btn primary" onClick={handleInstall}>Install</button>
            <button className="btn secondary" onClick={() => setInstallPrompt(null)}>Dismiss</button>
          </div>
        )}
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <h1 className="page-title">{LABELS[currentPage] || "RHoSAM"}</h1>
          <div className="topbar-right">
            <button className="theme-toggle" onClick={() => setDarkMode(!darkMode)} title={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
              {darkMode ? "☀️" : "🌙"}
            </button>
            {/* In-app notification bell */}
            <div style={{ position: 'relative' }}>
              <button onClick={toggleNotifDropdown} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', position: 'relative', padding: '4px 8px' }} title="Notifications">
                🔔
                {notifCount > 0 && (
                  <span style={{ position: 'absolute', top: -2, right: -2, background: 'var(--danger, #ef4444)', color: '#fff', fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 10, minWidth: 16, textAlign: 'center', lineHeight: '14px' }}>
                    {notifCount > 99 ? '99+' : notifCount}
                  </span>
                )}
              </button>
              {notifDropdown && (
                <div style={{ position: 'absolute', top: '100%', right: 0, width: 360, maxHeight: 420, overflowY: 'auto', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 1000, padding: 0 }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.9rem', color: 'var(--text)' }}>Notifications</strong>
                    {notifCount > 0 && <button onClick={markAllNotifsRead} style={{ background: 'none', border: 'none', color: 'var(--accent, #16a34a)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>Mark all read</button>}
                  </div>
                  {notifications.length === 0 && <p style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>No notifications</p>}
                  {notifications.map(n => (
                    <div key={n.id} onClick={() => handleNotifClick(n)} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: n.is_read ? 'transparent' : 'rgba(22,163,74,0.04)', transition: 'background 0.15s' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: n.is_read ? 400 : 600, color: 'var(--text)' }}>{n.title}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 2, lineHeight: 1.4 }}>{n.body}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 4 }}>{new Date(n.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <span className="user-badge">
              {user?.branch?.name && <span className="branch-tag">🏢 {user.branch.name} · </span>}
              {user?.name} · <span className="role-tag">{user?.role}</span>
            </span>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </div>
    </div>
  );
}

function AuthGate({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center"><div className="spinner" /><p>Loading…</p></div>;
  return user ? children : <Navigate to="/login" replace />;
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════
function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const result = await login(email, password);
      if (result.passwordExpired) { navigate("/change-password"); }
      else { navigate("/dashboard"); }
    }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>🛍️ RHoSAM Supermarket</h1>
        <p className="auth-subtitle">Sign in to your account</p>
        {error && <div className="auth-error">{error}</div>}
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
        <p style={{ textAlign: 'right', marginTop: -8, marginBottom: 12 }}><a href="/forgot-password" style={{ fontSize: '0.85rem' }}>Forgot password?</a></p>
        <button type="submit" className="auth-button" disabled={busy}>{busy ? "Signing in…" : "Sign In"}</button>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD (Phase 9)
// ═══════════════════════════════════════════════════════════════════
function DashboardPage() {
  const { fetchDashboard, fetchTopProducts, fetchCategorySales, fetchBranchSummary, fetchBranches, fetchExpiringProducts, user } = useAuth();
  const [stats, setStats] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [catSales, setCatSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState([]);
  const [branchSummary, setBranchSummary] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [expiringData, setExpiringData] = useState(null);
  const isAdmin = user?.role === "ADMIN";

  // Load branches list for admin selector
  useEffect(() => {
    if (isAdmin) {
      fetchBranches().then(setBranches).catch(() => {});
      fetchBranchSummary().then(setBranchSummary).catch(() => {});
    }
  }, [isAdmin, fetchBranches, fetchBranchSummary]);

  const load = useCallback(async (branchId) => {
    try {
      const bid = branchId || undefined;
      const promises = [fetchDashboard(bid), fetchTopProducts(bid), fetchCategorySales(bid), fetchExpiringProducts(30)];
      // Also refresh branch summary when loading (stays current)
      if (isAdmin) promises.push(fetchBranchSummary());
      const results = await Promise.allSettled(promises);
      if (results[0].status === 'fulfilled') setStats(results[0].value);
      if (results[1].status === 'fulfilled') setTopProducts(results[1].value);
      if (results[2].status === 'fulfilled') setCatSales(results[2].value);
      if (results[3].status === 'fulfilled') setExpiringData(results[3].value);
      if (isAdmin && results[4]?.status === 'fulfilled') setBranchSummary(results[4].value);
    } catch (err) { console.error('[Dashboard]', err); }
    finally { setLoading(false); }
  }, [fetchDashboard, fetchTopProducts, fetchCategorySales, fetchExpiringProducts, fetchBranchSummary, isAdmin]);

  useEffect(() => { load(selectedBranch || undefined); }, [load, selectedBranch]);

  if (loading) return <div className="loading">Loading dashboard…</div>;
  if (!stats) return <div className="error-msg">Failed to load dashboard.</div>;

  const fmt = (n) => { const v = parseFloat(n) || 0; return "₦" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const selectedBranchName = branches.find(b => String(b.id) === String(selectedBranch))?.name;

  return (
    <div className="dashboard">
      {/* Branch selector for Admin */}
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select
            value={selectedBranch}
            onChange={e => { setSelectedBranch(e.target.value); setLoading(true); }}
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}
          >
            <option value="">All Branches (Overview)</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {selectedBranchName && <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>— Viewing: <strong>{selectedBranchName}</strong></span>}
          {!selectedBranchName && <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>— Viewing aggregated data across all branches</span>}
        </div>
      )}

      {/* Non-admin branch indicator */}
      {!isAdmin && user?.branch?.name && (
        <div style={{ marginBottom: 16, padding: '10px 16px', background: 'var(--surface, var(--card-bg))', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem' }}>
          🏢 <strong>{user.branch.name}</strong> — Dashboard showing your branch data.
        </div>
      )}
      <div className="summary-grid">
        <div className="summary-card accent"><span>Today's Sales</span><strong>{stats.todaySales}</strong><small>{fmt(stats.todayRevenue)}</small></div>
        <div className="summary-card"><span>Total Revenue</span><strong>{fmt(stats.totalRevenue)}</strong></div>
        <div className="summary-card"><span>Products{selectedBranch ? ' at ' + selectedBranchName : ''}</span><strong>{stats.totalProducts}</strong></div>
        <div className="summary-card warning"><span>Low Stock{selectedBranch ? ' at ' + selectedBranchName : ''}</span><strong>{stats.lowStockCount}</strong></div>
        <div className="summary-card"><span>Total Transactions</span><strong>{stats.totalSales}</strong></div>
        <div className="summary-card"><span>Active Users{selectedBranch ? ' at ' + selectedBranchName : ''}</span><strong>{stats.totalUsers}</strong></div>
      </div>

      {/* Expiry Alerts Widget */}
      {expiringData && expiringData.summary && (expiringData.summary.expired > 0 || expiringData.summary.expiringSoon > 0) && (
        <div className="panel" style={{ borderLeft: '4px solid var(--warning, #f59e0b)' }}>
          <h2>⏰ Expiry Alerts</h2>
          <div className="summary-grid" style={{ marginTop: 8 }}>
            {expiringData.summary.expired > 0 && (
              <div className="summary-card" style={{ borderLeft: '3px solid var(--danger, #ef4444)' }}>
                <span style={{ color: 'var(--danger, #ef4444)' }}>Expired</span>
                <strong style={{ color: 'var(--danger, #ef4444)' }}>{expiringData.summary.expired}</strong>
                <small>products past expiry</small>
              </div>
            )}
            {expiringData.summary.expiringToday > 0 && (
              <div className="summary-card" style={{ borderLeft: '3px solid var(--warning, #f59e0b)' }}>
                <span style={{ color: 'var(--warning, #f59e0b)' }}>Expiring Today</span>
                <strong style={{ color: 'var(--warning, #f59e0b)' }}>{expiringData.summary.expiringToday}</strong>
                <small>expires today</small>
              </div>
            )}
            {expiringData.summary.expiringSoon > 0 && (
              <div className="summary-card" style={{ borderLeft: '3px solid var(--accent, #16a34a)' }}>
                <span>Expiring Soon</span>
                <strong>{expiringData.summary.expiringSoon}</strong>
                <small>within 30 days</small>
              </div>
            )}
          </div>
          {expiringData.products?.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>Product</th><th>Expiry Date</th><th>Days Left</th><th>Stock</th></tr></thead>
                <tbody>{expiringData.products.slice(0, 5).map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong>{p.batch_number && <code style={{ marginLeft: 6, fontSize: 11 }}>{p.batch_number}</code>}</td>
                    <td>{new Date(p.expiry_date).toLocaleDateString('en-NG', { dateStyle: 'medium' })}</td>
                    <td><span className={`status-badge ${p.days_until_expiry <= 0 ? 'inactive' : p.days_until_expiry <= 7 ? 'warning' : 'active'}`}>{p.days_until_expiry <= 0 ? 'Expired' : `${p.days_until_expiry}d`}</span></td>
                    <td>{p.stock}</td>
                  </tr>
                ))}</tbody>
              </table>
              {expiringData.products.length > 5 && <p style={{ marginTop: 8, fontSize: '0.8rem' }}>… and {expiringData.products.length - 5} more. <a href="/expiry">View all →</a></p>}
            </div>
          )}
        </div>
      )}

      {/* Branch Overview Table (Admin only, when viewing all branches) */}
      {isAdmin && !selectedBranch && branchSummary?.branches?.length > 0 && (
        <div className="panel">
          <h2>🏢 Branch Performance Overview</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Total Sales</th>
                  <th>Revenue</th>
                  <th>Today Revenue</th>
                  <th>Active Cashiers</th>
                  <th>Low Stock</th>
                </tr>
              </thead>
              <tbody>
                {branchSummary.branches.map(b => (
                  <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedBranch(String(b.id))}>
                    <td><strong>{b.name}</strong></td>
                    <td>{b.total_sales}</td>
                    <td>{fmt(b.total_revenue)}</td>
                    <td>{fmt(b.today_revenue)}</td>
                    <td>{b.active_cashiers}</td>
                    <td className={b.low_stock > 0 ? 'low-stock' : ''}>{b.low_stock}</td>
                  </tr>
                ))}
              </tbody>
              {branchSummary.totals && (
                <tfoot>
                  <tr style={{ fontWeight: 700, background: 'var(--surface, #f3f4f6)', borderTop: '2px solid var(--border)' }}>
                    <td>📊 All Branches (Total)</td>
                    <td>{branchSummary.totals.total_sales}</td>
                    <td>{fmt(branchSummary.totals.total_revenue)}</td>
                    <td>{fmt(branchSummary.totals.today_revenue)}</td>
                    <td>{branchSummary.totals.active_cashiers}</td>
                    <td className={branchSummary.totals.low_stock > 0 ? 'low-stock' : ''}>{branchSummary.totals.low_stock}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--muted)' }}>💡 Click any branch row to view its detailed dashboard.</p>
        </div>
      )}

      {/* Sales by Branch — Horizontal Bar Chart (Admin only, when viewing all branches) */}
      {isAdmin && !selectedBranch && branchSummary?.branches?.length > 0 && (() => {
        const maxRevenue = Math.max(...branchSummary.branches.map(b => b.total_revenue || 1));
        const branchColors = ['#16a34a', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#84cc16'];
        return (
          <div className="panel">
            <h2>📊 Sales Revenue by Branch</h2>
            <div style={{ display: 'grid', gap: 14 }}>
              {branchSummary.branches.map((b, i) => {
                const pct = maxRevenue > 0 ? ((b.total_revenue || 0) / maxRevenue) * 100 : 0;
                const color = branchColors[i % branchColors.length];
                return (
                  <div key={b.id} className="branch-chart-row"
                    onClick={() => setSelectedBranch(String(b.id))}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                    <div style={{ height: 28, background: 'var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(pct, 2)}%`, background: color, borderRadius: 14, transition: 'width 0.5s', display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
                        {pct > 15 && <span style={{ color: '#fff', fontSize: '0.75rem', fontWeight: 700 }}>{Math.round(pct)}%</span>}
                      </div>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text)' }}>{fmt(b.total_revenue)}</span>
                  </div>
                );
              })}
            </div>
            <p style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--muted)' }}>💡 Click a branch to filter the dashboard to that branch.</p>
          </div>
        );
      })()}

      {/* Sales Trend Chart (CSS bars) */}
      <div className="panel">
        <h2>Sales Trend (Last 30 Days)</h2>
        <div className="chart-bars">
          {(stats.salesChart || []).map((d, i) => {
            const maxRev = Math.max(...(stats.salesChart || []).map(x => x.revenue || 1));
            const pct = ((d.revenue || 0) / maxRev) * 100;
            return (
              <div key={i} className="bar-col" title={`${new Date(d.day).toLocaleDateString()}: ₦${(parseFloat(d.revenue) || 0).toLocaleString()} (${d.count} sales)`}>
                <div className="bar" style={{ height: `${Math.max(pct, 4)}%` }} />
                <small>{new Date(d.day).getDate()}</small>
              </div>
            );
          })}
          {(!stats.salesChart || !stats.salesChart.length) && <p className="muted">No sales data yet.</p>}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Top Products (30 Days){selectedBranch && selectedBranchName ? ` — ${selectedBranchName}` : ''}</h2>
          <table><thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th></tr></thead>
            <tbody>{topProducts.map((p, i) => (
              <tr key={i}><td>{p.product_name}</td><td>{p.total_qty}</td><td>{fmt(p.total_revenue)}</td></tr>
            ))}</tbody>
          </table>
          {!topProducts.length && <p className="muted">No sales yet.</p>}
        </div>

        <div className="panel">
          <h2>Sales by Category{selectedBranch && selectedBranchName ? ` — ${selectedBranchName}` : ''}</h2>
          <div className="category-chart">
            {catSales.map((c, i) => {
              const maxRev = Math.max(...catSales.map(x => x.revenue || 1));
              return (
                <div key={i} className="cat-bar-row">
                  <span className="cat-label">{c.category}</span>
                  <div className="cat-bar-track"><div className="cat-bar-fill" style={{ width: `${((c.revenue || 0) / maxRev) * 100}%` }} /></div>
                  <span className="cat-value">{fmt(c.revenue)}</span>
                </div>
              );
            })}
            {!catSales.length && <p className="muted">No data yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// POS (Phase 2)
// ═══════════════════════════════════════════════════════════════════
function POSPage() {
  const { fetchProducts, createSale, fetchCustomers, emailReceipt, smsReceipt, verifyPayment, initializePayment, getGatewayStatus, getActiveDrawer, user, notifyDataChange } = useAuth();
  const [products, setProducts] = useState([]);
  const [drawerOk, setDrawerOk] = useState(null); // null = loading, true = open, false = no drawer
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [customerId, setCustomerId] = useState(null);
  const [payment, setPayment] = useState("Cash");
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [receiptPhone, setReceiptPhone] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsMsg, setSmsMsg] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [scanFeedback, setScanFeedback] = useState(null);
  const searchRef = useRef(null);
  const scanTimeoutRef = useRef(null);
  // Payment gateway state
  const [gatewayStatus, setGatewayStatus] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null); // { saleId, reference, authorizationUrl, gateway }
  const [paymentVerifying, setPaymentVerifying] = useState(false);
  const [paymentReference, setPaymentReference] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  // Play a short beep for successful scans
  const playBeep = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 1200; osc.type = "square";
      gain.gain.value = 0.1;
      osc.start(); osc.stop(ctx.currentTime + 0.08);
    } catch { }
  }, []);

  // Show a brief scan feedback toast
  const showScanFeedback = useCallback((product) => {
    setScanFeedback({ name: product.name, price: product.price, id: Date.now() });
    playBeep();
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => setScanFeedback(null), 1500);
  }, [playBeep]);

  useEffect(() => { fetchProducts(undefined, user?.branchId).then(setProducts).catch(() => {}); fetchCustomers().then(setCustomers).catch(() => {}); getGatewayStatus().then(setGatewayStatus).catch(() => {}); }, [fetchProducts, fetchCustomers, getGatewayStatus, user]);

  // Check if cash drawer is open (required for cashiers)
  useEffect(() => {
    if (user?.role === 'ADMIN' || user?.role === 'MANAGER') { setDrawerOk(true); return; }
    getActiveDrawer().then(d => setDrawerOk(!!d?.id)).catch(() => setDrawerOk(false));
  }, [getActiveDrawer, user]);

  // Auto-focus search on mount and after cart changes
  useEffect(() => { searchRef.current?.focus(); }, [cart, receipt]);

  // Keyboard shortcut: Escape to clear cart (only when not in receipt view)
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && !receipt && cart.length > 0) {
        e.preventDefault();
        if (confirm("Clear all items from cart?")) setCart([]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cart, receipt]);

  // Derive unique categories from products
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();

  const filtered = products.filter(p => {
    const matchesSearch = !search.trim() ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode.includes(search) ||
      p.category.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !selectedCategory || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  function addToCart(product, fromScan = false) {
    if (product.stock <= 0) { setError(`${product.name} is out of stock!`); return; }
    // Warn if stock is low (at or below reorder level)
    if (product.stock <= product.reorder_level) {
      setError(`⚠️ Low stock warning: ${product.name} has only ${product.stock} unit(s) left!`);
    }
    setCart(prev => {
      const existing = prev.find(c => c.productId === product.id);
      if (existing) return prev.map(c => c.productId === product.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { productId: product.id, name: product.name, price: product.price, quantity: 1, discount: 0, maxStock: product.stock }];
    });
    if (fromScan) showScanFeedback(product);
    setSearch("");
    setTimeout(() => searchRef.current?.focus(), 10);
  }

  // Handle barcode scanner input: Enter key triggers exact barcode match
  function handleSearchKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const term = search.trim();
      if (!term) return;
      // Try exact barcode match first
      const exactMatch = products.find(p => p.barcode === term);
      if (exactMatch) {
        addToCart(exactMatch, true);
        return;
      }
      // Try exact name match (case-insensitive)
      const nameMatch = products.find(p => p.name.toLowerCase() === term.toLowerCase());
      if (nameMatch) {
        addToCart(nameMatch, true);
        return;
      }
      // If single filtered result, add it
      if (filtered.length === 1) {
        addToCart(filtered[0], true);
        return;
      }
      // No match found
      setError(`No product found for "${term}"`);
      setTimeout(() => setError(""), 2000);
    }
  }

  // Auto-detect barcode: if input exactly matches a barcode, add immediately
  useEffect(() => {
    if (!search.trim()) return;
    const match = products.find(p => p.barcode === search.trim());
    if (match) {
      addToCart(match, true);
    }
  }, [search, products]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateQty(productId, qty) {
    if (qty < 1) { setCart(prev => prev.filter(c => c.productId !== productId)); return; }
    // Check against available stock
    const product = products.find(p => p.id === productId);
    const maxQty = product?.stock || 0;
    if (product && qty > maxQty) {
      setError(`Cannot add more: ${product.name} only has ${maxQty} unit(s) in stock.`);
      setCart(prev => prev.map(c => c.productId === productId ? { ...c, quantity: maxQty, maxStock: maxQty } : c));
      return;
    }
    setCart(prev => prev.map(c => c.productId === productId ? { ...c, quantity: qty } : c));
  }

  const subtotal = cart.reduce((sum, c) => sum + c.price * c.quantity - c.discount, 0);
  const total = subtotal - discount + tax;

  async function handleCheckout() {
    if (!cart.length) return;
    setBusy(true); setError("");
    try {
      const result = await createSale({
        customerName, customerId, paymentMethod: payment,
        items: cart.map(c => ({ productId: c.productId, quantity: c.quantity, discount: c.discount })),
        discount, tax, amountPaid: amountPaid ? Number(amountPaid) : total,
      });
      // For electronic payments, initialize gateway payment
      if (payment !== "Cash" && result.id) {
        try {
          const initData = await initializePayment({ saleId: result.id, email: customerEmail || undefined });
          if (initData.authorizationUrl) {
            // Open gateway payment page in new tab
            window.open(initData.authorizationUrl, "_blank");
          }
          setPaymentModal({ saleId: result.id, reference: initData.reference, gateway: initData.gateway, authorizationUrl: initData.authorizationUrl });
          setReceipt(result);
        } catch (payErr) {
          // Payment init failed but sale was created — show receipt and manual verification option
          setReceipt(result);
          setPaymentModal({ saleId: result.id, reference: null, gateway: "INTERNAL", authorizationUrl: null, error: payErr.message });
        }
      } else {
        setReceipt(result);
      }
      setCart([]); setCustomerName("Walk-in Customer"); setCustomerId(null);
      setDiscount(0); setTax(0); setAmountPaid("");
      fetchProducts(undefined, user?.branchId).then(setProducts).catch(() => {});
      notifyDataChange(); // Bust cache so dashboard/branch summary refreshes
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function handleVerifyPayment() {
    if (!paymentModal?.saleId || !paymentReference.trim()) return;
    setPaymentVerifying(true);
    try {
      await verifyPayment({
        saleId: paymentModal.saleId,
        gateway: paymentModal.gateway || "INTERNAL",
        reference: paymentReference.trim(),
      });
      setPaymentModal(null);
      setPaymentReference("");
      // Reload receipt with verified status
    } catch (err) { setError(`Verification failed: ${err.message}`); }
    finally { setPaymentVerifying(false); }
  }

  async function handleEmailReceipt(e) {
    e.preventDefault();
    if (!receiptEmail || !receipt?.id) return;
    setEmailSending(true); setEmailMsg("");
    try {
      await emailReceipt(receipt.id, receiptEmail);
      setEmailMsg("Receipt sent!");
    } catch (err) { setEmailMsg(`Error: ${err.message}`); }
    finally { setEmailSending(false); }
  }

  async function handleSmsReceipt(e) {
    e.preventDefault();
    if (!receiptPhone || !receipt?.id) return;
    setSmsSending(true); setSmsMsg("");
    try {
      await smsReceipt(receipt.id, receiptPhone);
      setSmsMsg("SMS receipt sent!");
    } catch (err) { setSmsMsg(`Error: ${err.message}`); }
    finally { setSmsSending(false); }
  }

  // Payment verification modal
  if (paymentModal && receipt) {
    return (
      <div className="receipt-view">
        <div className="receipt">
          <h2>🛍️ RHoSAM Supermarket</h2>
          {user?.branch?.name && <p className="muted">Branch: {user.branch.name}</p>}
          <p className="muted">Receipt: {receipt.receiptNumber}</p>
          <p className="muted">Date: {receipt.created_at ? new Date(receipt.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          <p className="muted">Payment: {receipt.paymentMethod}</p>
          <hr />
          <div style={{ padding: '16px 0' }}>
            <h3>💳 Payment Verification</h3>
            {paymentModal.authorizationUrl && (
              <div style={{ marginBottom: 12, padding: 12, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.85rem', marginBottom: 8 }}>Gateway: <strong>{paymentModal.gateway}</strong></p>
                <p style={{ fontSize: '0.85rem', marginBottom: 8 }}>Reference: <code>{paymentModal.reference}</code></p>
                <button className="btn primary" onClick={() => window.open(paymentModal.authorizationUrl, '_blank')} style={{ fontSize: '0.85rem' }}>🔗 Open Payment Page</button>
              </div>
            )}
            {paymentModal.error && (
              <div style={{ marginBottom: 12, padding: 12, background: 'rgba(245,158,11,0.1)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.3)', fontSize: '0.85rem', color: '#92400e' }}>
                ⚠️ Gateway init failed: {paymentModal.error}
              </div>
            )}
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 8 }}>Enter the payment reference from the gateway to verify:</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={paymentReference}
                onChange={e => setPaymentReference(e.target.value)}
                placeholder="Payment reference"
                style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'monospace' }}
              />
              <button className="btn primary" onClick={handleVerifyPayment} disabled={paymentVerifying || !paymentReference.trim()}>
                {paymentVerifying ? 'Verifying…' : '✓ Verify'}
              </button>
            </div>
          </div>
          <div className="receipt-actions no-print">
            <button onClick={() => { setPaymentModal(null); setReceipt(null); setPaymentReference(""); }}>🛒 New Sale</button>
          </div>
        </div>
      </div>
    );
  }

  if (receipt) {
    return (
      <div className="receipt-view">
        <div className="receipt">
          <h2>🛍️ RHoSAM Supermarket</h2>
          {user?.branch?.name && <p className="muted">Branch: {user.branch.name}</p>}
          <p className="muted">Receipt: {receipt.receiptNumber}</p>
          <p className="muted">Date: {receipt.created_at ? new Date(receipt.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          <p className="muted">Cashier: {receipt.cashierName}</p>
          <p className="muted">Customer: {receipt.customerName}</p>
          <p className="muted">Payment: {receipt.paymentMethod}</p>
          <hr />
          {receipt.items?.map((item, i) => (
            <div key={i} className="receipt-line">
              <span>{item.name} × {item.quantity}</span>
              <span>₦{(parseFloat(item.lineTotal) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
            </div>
          ))}
          <hr />
          <div className="receipt-line"><span>Subtotal</span><span>₦{(parseFloat(receipt.subtotal) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>
          {receipt.discount > 0 && <div className="receipt-line"><span>Discount</span><span>-₦{(parseFloat(receipt.discount) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>}
          {receipt.tax > 0 && <div className="receipt-line"><span>Tax</span><span>₦{(parseFloat(receipt.tax) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>}
          <div className="receipt-line receipt-total"><span><strong>TOTAL</strong></span><strong>₦{(parseFloat(receipt.total) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</strong></div>
          {receipt.amountPaid > 0 && <div className="receipt-line"><span>Paid</span><span>₦{(parseFloat(receipt.amountPaid) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>}
          {receipt.change_amount > 0 && <div className="receipt-line"><span>Change</span><span>₦{(parseFloat(receipt.change_amount) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>}
          <p className="receipt-thanks">Thank you for shopping!</p>
          <div className="receipt-email-form no-print">
            <form onSubmit={handleEmailReceipt} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input type="email" value={receiptEmail} onChange={e => setReceiptEmail(e.target.value)}
                placeholder="Customer email for receipt" style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }} required />
              <button type="submit" className="btn primary" disabled={emailSending || !receiptEmail} style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
                {emailSending ? 'Sending...' : '📧 Email'}
              </button>
            </form>
            {emailMsg && <p className={emailMsg.startsWith('Error') ? 'error-msg' : 'muted'} style={{ marginTop: 6, fontSize: '0.8rem' }}>{emailMsg}</p>}
          </div>
          <div className="receipt-sms-form no-print">
            <form onSubmit={handleSmsReceipt} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input type="tel" value={receiptPhone} onChange={e => setReceiptPhone(e.target.value)}
                placeholder="📱 Phone number for SMS receipt" style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }} required />
              <button type="submit" className="btn primary" disabled={smsSending || !receiptPhone} style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
                {smsSending ? 'Sending...' : '📱 SMS'}
              </button>
            </form>
            {smsMsg && <p className={smsMsg.startsWith('Error') ? 'error-msg' : 'muted'} style={{ marginTop: 6, fontSize: '0.8rem' }}>{smsMsg}</p>}
          </div>
          <div className="receipt-actions no-print">
            <button onClick={() => generateReceiptPDF({ ...receipt, branchName: user?.branch?.name || "" })}>📄 Download PDF</button>
            <button onClick={() => window.print()}>🖨️ Print</button>
            <button onClick={() => { setReceipt(null); setReceiptEmail(""); setEmailMsg(""); setReceiptPhone(""); setSmsMsg(""); }}>🛒 New Sale</button>
          </div>
        </div>
      </div>
    );
  }

  // Guard: cashier must have open cash drawer
  if (drawerOk === null) return <div className="loading">Checking cash drawer…</div>;
  if (drawerOk === false) return (
    <div className="page-panel" style={{ textAlign: 'center', padding: 60 }}>
      <h2>💵 Cash Drawer Required</h2>
      <p style={{ margin: '16px 0', fontSize: '1.1rem' }}>You need to open a cash drawer before you can use the Point of Sale.</p>
      <a href="/cashdrawer" className="btn primary" style={{ display: 'inline-block', padding: '12px 32px', fontSize: '1rem', textDecoration: 'none' }}>Open Cash Drawer →</a>
    </div>
  );

  return (
    <div className="pos-layout">
      {scanFeedback && (
        <div className="scan-toast" key={scanFeedback.id}>
          <span className="scan-toast-icon">✓</span>
          <span className="scan-toast-text">{scanFeedback.name} — ₦{(parseFloat(scanFeedback.price) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
        </div>
      )}
      <div className="pos-products">
        <div className="pos-search-wrapper">
          <input ref={searchRef} type="text"
            placeholder="🔍 Scan barcode or search products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="pos-search"
            autoComplete="off"
            autoFocus
          />
          <small className="pos-search-hint">Point scanner here • Press Enter to add</small>
        </div>

        {/* Category Filter */}
        {categories.length > 1 && (
          <div className="pos-category-filter">
            <button
              className={`category-chip ${!selectedCategory ? 'active' : ''}`}
              onClick={() => setSelectedCategory("")}
            >All</button>
            {categories.map(cat => (
              <button
                key={cat}
                className={`category-chip ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(selectedCategory === cat ? "" : cat)}
              >{cat}</button>
            ))}
          </div>
        )}

        <div className="pos-product-count">
          {selectedCategory && (
            <span className="muted">
              Showing {filtered.length} of {products.filter(p => p.category === selectedCategory).length} {selectedCategory} products
              {search && ` matching "${search}"`}
              <button className="category-clear" onClick={() => { setSelectedCategory(""); setSearch(""); }}>✕ Clear filter</button>
            </span>
          )}
          {!selectedCategory && search && (
            <span className="muted">{filtered.length} product{filtered.length !== 1 ? 's' : ''} found</span>
          )}
        </div>

        <div className="product-grid">
          {filtered.map(p => (
            <div key={p.id} className={`product-card ${p.stock <= 0 ? "out-of-stock" : ""}`} onClick={() => p.stock > 0 && addToCart(p)}>
              {p.image_url && <img src={`${resolveApiUrl(import.meta.env.VITE_API_URL).replace(/\/api$/, "")}${p.image_url}`} alt={p.name} className="product-card-image" />}
              <div className="product-card-body">
                <div className="product-card-header">
                  <strong>{p.name}</strong>
                  <small>{p.barcode}</small>
                </div>
                <div className="product-card-meta">
                  <span className="category-tag">{p.category}</span>
                  <span className={`stock-tag ${p.stock <= p.reorder_level ? "low" : ""}`}>{p.stock} in stock</span>
                </div>
              </div>
              <div className="product-card-price">₦{(parseFloat(p.price) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</div>
            </div>
          ))}
          {!filtered.length && (
            <div className="pos-empty-state">
              <p>No products found</p>
              {(selectedCategory || search) && (
                <button className="btn secondary" onClick={() => { setSelectedCategory(""); setSearch(""); }}>Clear filters</button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="pos-cart">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>🛒 Cart ({cart.length})</h2>
          {cart.length > 0 && (
            <button className="btn-sm danger" onClick={() => { if (confirm('Clear all items from cart?')) setCart([]); }} title="Clear cart (Esc)">🗑️ Clear <kbd style={{ fontSize: '0.65rem', opacity: 0.7, marginLeft: 4 }}>Esc</kbd></button>
          )}
        </div>
        {error && <div className="error-msg">{error}</div>}

        <label>Customer
          <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Walk-in Customer" />
        </label>
        {customers.length > 0 && (
          <select value={customerId || ""} onChange={e => {
            const c = customers.find(cu => cu.id === Number(e.target.value));
            setCustomerId(c?.id || null);
            setCustomerName(c?.name || "Walk-in Customer");
          }}>
            <option value="">Walk-in Customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        <div className="cart-list">
          {!cart.length && <div className="empty-cart">Cart is empty<br />Click a product to add it</div>}
          {cart.map(item => {
            const product = products.find(p => p.id === item.productId);
            const availableStock = product?.stock ?? item.maxStock ?? 0;
            const isLow = availableStock <= (product?.reorder_level || 5) && availableStock > 0;
            const isMaxed = item.quantity >= availableStock;
            return (
              <div key={item.productId} className="cart-item" style={isLow ? { borderLeft: '3px solid var(--warning, #f59e0b)' } : isMaxed ? { borderLeft: '3px solid var(--danger, #ef4444)' } : {}}>
                <div>
                  <strong>{item.name}</strong>
                  <small>₦{(parseFloat(item.price) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })} each</small>
                  {isLow && <small style={{ color: 'var(--warning, #f59e0b)', fontSize: '0.7rem' }}>⚠️ Low stock: {availableStock} left</small>}
                </div>
                <div className="quantity-controls">
                  <button onClick={() => updateQty(item.productId, item.quantity - 1)}>−</button>
                  <input type="number" min="1" max={availableStock} value={item.quantity}
                    onChange={e => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val >= 1) updateQty(item.productId, val);
                    }}
                    style={{ width: 50, textAlign: 'center', border: '1.5px solid var(--border)', borderRadius: 6, padding: '4px 2px', fontWeight: 700, fontSize: '0.9rem', background: 'var(--card-bg, white)', color: 'var(--text)' }}
                  />
                  <button onClick={() => updateQty(item.productId, item.quantity + 1)} disabled={isMaxed} style={isMaxed ? { opacity: 0.4, cursor: 'not-allowed' } : {}}>+</button>
                </div>
                <div className="cart-item-total">₦{(parseFloat(item.price * item.quantity) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</div>
              </div>
            );
          })}
        </div>

        <div className="cart-summary">
          <label>Payment Method
            <select value={payment} onChange={e => setPayment(e.target.value)}>
              <option value="Cash">💵 Cash</option>
              <option value="Card">💳 Card {gatewayStatus?.activeGateway !== 'INTERNAL' ? `(${gatewayStatus?.activeGateway})` : ''}</option>
              <option value="Transfer">🏦 Transfer {gatewayStatus?.activeGateway !== 'INTERNAL' ? `(${gatewayStatus?.activeGateway})` : ''}</option>
              <option value="POS">📱 POS {gatewayStatus?.activeGateway !== 'INTERNAL' ? `(${gatewayStatus?.activeGateway})` : ''}</option>
            </select>
            {payment !== 'Cash' && gatewayStatus?.activeGateway === 'INTERNAL' && (
              <small style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>No gateway configured — manual verification</small>
            )}
          </label>
          {payment !== 'Cash' && (
            <label>Customer Email
              <input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="For payment link (optional)" style={{ fontSize: '0.85rem' }} />
            </label>
          )}
          <div className="summary-row"><span>Subtotal</span><span>₦{subtotal.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>
          <label>Discount<input type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(Number(e.target.value))} /></label>
          <label>Tax<input type="number" min="0" step="0.01" value={tax} onChange={e => setTax(Number(e.target.value))} /></label>
          <div className="summary-row total"><span>TOTAL</span><strong>₦{total.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</strong></div>
          <label>Amount Paid<input type="number" min="0" step="0.01" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} placeholder={total.toFixed(2)} /></label>
          {Number(amountPaid) > total && (
            <div className="summary-row"><span>Change</span><span className="change">₦{(Number(amountPaid) - total).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>
          )}
          {cart.some(item => { const p = products.find(x => x.id === item.productId); return p && p.stock <= p.reorder_level && p.stock > 0; }) && (
            <div style={{ padding: '8px 12px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, fontSize: '0.8rem', color: '#92400e' }}>
              ⚠️ Some items in cart are low on stock. After this sale, consider restocking.
            </div>
          )}
          <button className="checkout-btn" onClick={handleCheckout} disabled={busy || !cart.length}>{busy ? "Processing…" : "💳 Checkout"}</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCTS (Phase 3)
// ═══════════════════════════════════════════════════════════════════
function ProductsPage() {
  const { fetchProducts, createProduct, updateProduct, deleteProduct, uploadProductImage, checkProductDuplicate, user } = useAuth();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [dupWarnings, setDupWarnings] = useState({ barcode: null, name: null });
  const isAdmin = ["ADMIN", "MANAGER"].includes(user?.role);

  const API_BASE = resolveApiUrl(import.meta.env.VITE_API_URL).replace(/\/api$/, "");
  const formDefault = { barcode: "", name: "", category: "", price: "", costPrice: "", stock: "", reorderLevel: "5", unit: "PCS", description: "", expiryDate: "", batchNumber: "" };
  const [form, setForm] = useState(formDefault);

  const load = useCallback(async () => {
    try { setProducts(await fetchProducts(search, user?.branchId)); } catch { }
    finally { setLoading(false); }
  }, [fetchProducts, search, user]);

  useEffect(() => { load(); }, [load]);

  // Debounced duplicate check
  const checkDuplicate = useCallback(async (field, value) => {
    if (!value || value.length < 2) { setDupWarnings(prev => ({ ...prev, [field]: null })); return; }
    try {
      const result = await checkProductDuplicate(field, value, editProduct?.id);
      setDupWarnings(prev => ({ ...prev, [field]: result.exists ? result : null }));
    } catch { setDupWarnings(prev => ({ ...prev, [field]: null })); }
  }, [checkProductDuplicate, editProduct]);

  // Debounce timer refs
  const barcodeTimerRef = useRef(null);
  const nameTimerRef = useRef(null);

  function handleFieldChange(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    // Clear previous timer
    const timerRef = field === "barcode" ? barcodeTimerRef : nameTimerRef;
    if (timerRef.current) clearTimeout(timerRef.current);
    // Debounce duplicate check (500ms)
    timerRef.current = setTimeout(() => checkDuplicate(field, value), 500);
  }

  function startEdit(p) {
    setEditProduct(p);
    setForm({ barcode: p.barcode, name: p.name, category: p.category, price: p.price, costPrice: p.cost_price || 0, stock: p.stock, reorderLevel: p.reorder_level, unit: p.unit || "PCS", description: p.description || "", expiryDate: p.expiry_date ? p.expiry_date.slice(0, 10) : "", batchNumber: p.batch_number || "" });
    setDupWarnings({ barcode: null, name: null });
    setImageFile(null); setImagePreview(p.image_url ? `${API_BASE}${p.image_url}` : null);
    setShowForm(true);
  }
  function startNew() { setEditProduct(null); setForm(formDefault); setDupWarnings({ barcode: null, name: null }); setImageFile(null); setImagePreview(null); setShowForm(true); }

  function handleImageChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      let productId;
      if (editProduct) {
        const updated = await updateProduct(editProduct.id, form);
        productId = updated.id || editProduct.id;
      } else {
        const created = await createProduct(form);
        productId = created.id;
      }
      // Upload image if selected
      if (imageFile && productId) {
        await uploadProductImage(productId, imageFile);
      }
      setShowForm(false); load();
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try { await deleteProduct(id); load(); } catch (err) { alert(err.message); }
  }

  return (
    <div className="page-panel">
      <div className="panel-header">
        <input type="text" placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} className="search-input" />
        {isAdmin && <button className="btn primary" onClick={startNew}>+ Add Product</button>}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editProduct ? "Edit Product" : "New Product"}</h2>
            <form onSubmit={handleSubmit} className="form-grid">
              <label>Barcode
                <input value={form.barcode} onChange={e => handleFieldChange("barcode", e.target.value)} required style={dupWarnings.barcode ? { borderColor: 'var(--danger)' } : {}} />
                {dupWarnings.barcode && <small style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>⚠ {dupWarnings.barcode.match?.name ? `Exists: ${dupWarnings.barcode.match.name}` : 'Barcode already exists'}</small>}
              </label>
              <label>Name
                <input value={form.name} onChange={e => handleFieldChange("name", e.target.value)} required style={dupWarnings.name ? { borderColor: 'var(--danger)' } : {}} />
                {dupWarnings.name && <small style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>⚠ {dupWarnings.name.match?.barcode ? `Exists (barcode: ${dupWarnings.name.match.barcode})` : 'Name already exists'}</small>}
              </label>
              <label>Category
                <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} required list="category-list" />
                <datalist id="category-list">
                  {[...new Set(products.map(p => p.category))].map(c => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label>Price (₦)<input type="number" step="0.01" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} required /></label>
              <label>Cost Price (₦)<input type="number" step="0.01" min="0" value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} /></label>
              <label>Stock<input type="number" min="0" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} /></label>
              <label>Reorder Level<input type="number" min="0" value={form.reorderLevel} onChange={e => setForm({ ...form, reorderLevel: e.target.value })} /></label>
              <label>Unit<select value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                <option>PCS</option><option>KG</option><option>LTR</option><option>BOX</option><option>CARTON</option><option>BAG</option>
              </select></label>
              <label>Expiry Date<input type="date" value={form.expiryDate} onChange={e => setForm({ ...form, expiryDate: e.target.value })} /></label>
              <label>Batch Number<input value={form.batchNumber} onChange={e => setForm({ ...form, batchNumber: e.target.value })} placeholder="e.g. BATCH-2026-001" /></label>
              <label>Description<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></label>
              <label>Product Image
                <div className="image-upload-area">
                  {imagePreview ? (
                    <img src={imagePreview} alt="Preview" className="image-preview" />
                  ) : (
                    <div className="image-placeholder">📷 Click to upload image</div>
                  )}
                  <input type="file" accept="image/*" onChange={handleImageChange} className="image-input" />
                </div>
              </label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">{editProduct ? "Update" : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <p className="loading">Loading…</p> : (
        <>
          {products.filter(p => p.stock <= 0 && p.is_active).length > 0 && (
            <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, marginBottom: 12, fontSize: '0.85rem', color: '#991b1b' }}>
              🚫 <strong>{products.filter(p => p.stock <= 0 && p.is_active).length} product(s) are out of stock</strong> — these cannot be sold at POS until restocked.
            </div>
          )}
          {products.filter(p => p.stock > 0 && p.stock <= p.reorder_level && p.is_active).length > 0 && (
            <div style={{ padding: '10px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, marginBottom: 12, fontSize: '0.85rem', color: '#92400e' }}>
              ⚠️ <strong>{products.filter(p => p.stock > 0 && p.stock <= p.reorder_level && p.is_active).length} product(s) are low on stock</strong> — consider restocking soon.
            </div>
          )}
          <div className="table-wrap">
          <table>
            <thead><tr><th>Image</th><th>Barcode</th><th>Name</th><th>Category</th><th>Price</th><th>Cost</th><th>Stock</th><th>Expiry</th><th>Unit</th><th>Status</th>{isAdmin && <th>Actions</th>}</tr></thead>
            <tbody>{products.map(p => (
              <tr key={p.id}>
                <td>{p.image_url ? <img src={`${API_BASE}${p.image_url}`} alt={p.name} className="product-thumb" /> : <span className="no-image">—</span>}</td>
                <td><code>{p.barcode}</code></td><td>{p.name}</td><td>{p.category}</td>
                <td>₦{(parseFloat(p.price) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                <td>₦{(parseFloat(p.cost_price) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                <td className={p.stock <= p.reorder_level ? "low-stock" : ""}>{p.stock}</td>
                <td>{p.expiry_date ? (() => { const d = new Date(p.expiry_date); const days = Math.ceil((d - new Date()) / 86400000); return <span style={{ color: days <= 0 ? 'var(--danger)' : days <= 30 ? 'var(--warning)' : 'var(--muted)' }}>{d.toLocaleDateString('en-NG', { dateStyle: 'short' })}{days <= 0 ? ' ⚠️' : days <= 30 ? ` (${days}d)` : ''}</span>; })() : '—'}</td>
                <td>{p.unit}</td>
                <td><span className={`status-badge ${p.is_active ? "active" : "inactive"}`}>{p.is_active ? "Active" : "Inactive"}</span></td>
                {isAdmin && <td>
                  <button className="btn-sm" onClick={() => startEdit(p)}>Edit</button>
                  {user?.role === "ADMIN" && <button className="btn-sm danger" onClick={() => handleDelete(p.id, p.name)}>Delete</button>}
                </td>}
              </tr>
            ))}</tbody>
          </table>
          {!products.length && <p className="muted">No products found.</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INVENTORY (Phase 3)
// ═══════════════════════════════════════════════════════════════════
function InventoryPage() {
  const { fetchProducts, fetchLowStock, adjustStock, fetchInventoryMovements, user, fetchBranches, notifyDataChange } = useAuth();
  const [tab, setTab] = useState("stock");
  const [products, setProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [movements, setMovements] = useState([]);
  const [movementsCursor, setMovementsCursor] = useState(null);
  const [movementsHasMore, setMovementsHasMore] = useState(false);
  const [loadingMoreMovements, setLoadingMoreMovements] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adjustModal, setAdjustModal] = useState(null);
  const [adjForm, setAdjForm] = useState({ quantity: "", type: "STOCK_IN", notes: "" });
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (isAdmin) fetchBranches().then(setBranches).catch(() => {});
  }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    try {
      const bid = selectedBranch || user?.branchId || undefined;
      const params = bid ? { branchId: bid } : undefined;
      const [p, ls, mvResult] = await Promise.all([
        fetchProducts(undefined, bid),
        fetchLowStock(params),
        fetchInventoryMovements(undefined, bid)
      ]);
      setProducts(p); setLowStock(ls);
      setMovements(mvResult.data || []);
      setMovementsCursor(mvResult.nextCursor);
      setMovementsHasMore(mvResult.hasMore);
    } catch { }
    finally { setLoading(false); }
  }, [fetchProducts, fetchLowStock, fetchInventoryMovements, user, selectedBranch]);

  async function loadMoreMovements() {
    if (!movementsCursor || loadingMoreMovements) return;
    setLoadingMoreMovements(true);
    try {
      const bid = selectedBranch || user?.branchId || undefined;
      const result = await fetchInventoryMovements(undefined, bid, { cursor: JSON.stringify(movementsCursor) });
      setMovements(prev => [...prev, ...(result.data || [])]);
      setMovementsCursor(result.nextCursor);
      setMovementsHasMore(result.hasMore);
    } catch { }
    finally { setLoadingMoreMovements(false); }
  }

  useEffect(() => { load(); }, [load]);

  async function handleAdjust(e) {
    e.preventDefault();
    try {
      await adjustStock(adjustModal.id, { ...adjForm, quantity: Number(adjForm.quantity) });
      setAdjustModal(null); setAdjForm({ quantity: "", type: "STOCK_IN", notes: "" });
      load();
      notifyDataChange();
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="page-panel">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select
            value={selectedBranch}
            onChange={e => { setSelectedBranch(e.target.value); }}
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}
          >
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Inventory across all branches'}
          </span>
        </div>
      )}
      {!isAdmin && user?.branch?.name && (
        <div style={{ marginBottom: 12, padding: '8px 16px', background: 'var(--surface, var(--card-bg))', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem' }}>
          🏢 <strong>Branch:</strong> {user.branch.name} — Inventory filtered to your branch.
        </div>
      )}
      <div className="tabs">
        <button className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}>Stock Levels</button>
        <button className={tab === "low" ? "active" : ""} onClick={() => setTab("low")}>Low Stock ({lowStock.length})</button>
        <button className={tab === "movements" ? "active" : ""} onClick={() => setTab("movements")}>Movements</button>
      </div>

      {loading ? <p className="loading">Loading…</p> : (
        <>
          {tab === "stock" && (
            <>
              {products.filter(p => p.stock <= 0).length > 0 && (
                <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, marginBottom: 12, fontSize: '0.85rem', color: '#991b1b' }}>
                  🚫 <strong>{products.filter(p => p.stock <= 0).length} product(s) out of stock</strong> — adjust stock to make them available for sale.
                </div>
              )}
              <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Reorder Level</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>{products.map(p => (
                  <tr key={p.id} style={p.stock <= 0 ? { background: 'rgba(239,68,68,0.04)' } : {}}>
                    <td>{p.name}</td><td>{p.category}</td>
                    <td className={p.stock <= p.reorder_level ? "low-stock" : ""}>{p.stock}</td>
                    <td>{p.reorder_level}</td>
                    <td><span className={`status-badge ${p.stock <= 0 ? 'inactive' : p.stock <= p.reorder_level ? 'warning' : 'active'}`}>{p.stock <= 0 ? '🚫 Out' : p.stock <= p.reorder_level ? '⚠ Low' : '✓ OK'}</span></td>
                    <td><button className="btn-sm" onClick={() => setAdjustModal(p)}>Adjust</button></td>
                  </tr>
                ))}</tbody>
              </table>
              </div>
            </>
          )}

          {tab === "low" && (
            <div className="table-wrap">
              {lowStock.length ? (
                <table><thead><tr><th>Product</th><th>Barcode</th><th>Stock</th><th>Reorder Level</th><th>Price</th></tr></thead>
                  <tbody>{lowStock.map(p => (
                    <tr key={p.id} className="low-stock-row">
                      <td>{p.name}</td><td>{p.barcode}</td>
                      <td className="low-stock">{p.stock}</td><td>{p.reorder_level}</td>
                      <td>₦{(parseFloat(p.price) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="muted">All products are well-stocked.</p>}
            </div>
          )}

          {tab === "movements" && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Reference</th><th>User</th></tr></thead>
                <tbody>{movements.map(m => (
                  <tr key={m.id}>
                    <td>{new Date(m.created_at).toLocaleString()}</td><td>{m.product_name}</td>
                    <td><span className={`movement-type ${m.movement_type.toLowerCase()}`}>{m.movement_type}</span></td>
                    <td>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                    <td><code>{m.reference}</code></td><td>{m.user_name || "System"}</td>
                  </tr>
                ))}</tbody>
              </table>
              {!movements.length && <p className="muted">No movements recorded.</p>}
              {movementsHasMore && (
                <div style={{ textAlign: 'center', padding: 16 }}>
                  <button className="btn secondary" onClick={loadMoreMovements} disabled={loadingMoreMovements}>
                    {loadingMoreMovements ? 'Loading…' : `Load More (${movements.length} loaded)`}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {adjustModal && (
        <div className="modal-overlay" onClick={() => setAdjustModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Adjust Stock: {adjustModal.name}</h2>
            <p className="muted">Current stock: {adjustModal.stock}</p>
            <form onSubmit={handleAdjust} className="form-grid">
              <label>Type
                <select value={adjForm.type} onChange={e => setAdjForm({ ...adjForm, type: e.target.value })}>
                  <option value="STOCK_IN">Stock In (Add)</option>
                  <option value="STOCK_OUT">Stock Out (Remove)</option>
                  <option value="ADJUSTMENT">Adjustment (Add)</option>
                </select>
              </label>
              <label>Quantity<input type="number" min="1" value={adjForm.quantity} onChange={e => setAdjForm({ ...adjForm, quantity: e.target.value })} required /></label>
              <label>Notes<textarea value={adjForm.notes} onChange={e => setAdjForm({ ...adjForm, notes: e.target.value })} rows={2} /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setAdjustModal(null)}>Cancel</button>
                <button type="submit" className="btn primary">Adjust</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DAMAGES PAGE
// ═══════════════════════════════════════════════════════════════════
function DamagesPage() {
  const { fetchProducts, reportDamage, fetchInventoryMovements, user, fetchBranches, notifyDataChange } = useAuth();
  const [products, setProducts] = useState([]);
  const [damages, setDamages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ productId: "", quantity: "", reason: "" });
  const [msg, setMsg] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (isAdmin) fetchBranches().then(setBranches).catch(() => {});
  }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    try {
      const bid = selectedBranch || user?.branchId || undefined;
      const [p, m] = await Promise.all([
        fetchProducts(undefined, bid),
        fetchInventoryMovements(undefined, bid)
      ]);
      setProducts(p);
      setDamages(m.filter(mv => mv.movement_type === "DAMAGED"));
    } catch { } finally { setLoading(false); }
  }, [fetchProducts, fetchInventoryMovements, user, selectedBranch]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e) {
    e.preventDefault(); setMsg("");
    try {
      await reportDamage({ productId: Number(form.productId), quantity: Number(form.quantity), reason: form.reason });
      setMsg("Damage reported and stock deducted!");
      setForm({ productId: "", quantity: "", reason: "" });
      setShowForm(false); load(); notifyDataChange();
    } catch (err) { setMsg(`Error: ${err.message}`); }
  }

  return (
    <div className="page-panel">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Damages across all branches'}</span>
        </div>
      )}
      <div className="summary-grid">
        <div className="summary-card"><span>Total Damage Reports</span><strong>{damages.length}</strong></div>
        <div className="summary-card"><span>Units Lost</span><strong>{damages.reduce((s, d) => s + Math.abs(d.quantity), 0)}</strong></div>
      </div>
      <div className="panel-header">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={() => { setShowForm(true); setForm({ productId: "", quantity: "", reason: "" }); }}>+ Report Damage</button>
          <button className="btn secondary" onClick={() => generateDamagesReportPDF(damages, { branchName: user?.branch?.name, generatedBy: user?.name })}>📄 Export PDF</button>
        </div>
      </div>
      {msg && <div className={msg.startsWith("Error") ? "error-msg" : "muted"} style={{ marginBottom: 12 }}>{msg}</div>}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Report Damaged Product</h2>
            <form onSubmit={handleSubmit} className="form-grid">
              <label>Product
                <select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })} required>
                  <option value="">Select product…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</option>)}
                </select>
              </label>
              <label>Quantity<input type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required /></label>
              <label>Reason<textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={2} placeholder="e.g. Broken packaging, water damage" required /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Report Damage</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Product</th><th>Qty Lost</th><th>Reason</th><th>Reported By</th></tr></thead>
            <tbody>{damages.map(d => (
              <tr key={d.id}>
                <td>{new Date(d.created_at).toLocaleDateString()}</td>
                <td><strong>{d.product_name}</strong></td>
                <td className="low-stock">{Math.abs(d.quantity)}</td>
                <td>{d.notes || '—'}</td>
                <td>{d.user_name || 'System'}</td>
              </tr>
            ))}</tbody>
          </table>
          {!damages.length && <p className="muted">No damage reports yet.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// WASTAGE PAGE
// ═══════════════════════════════════════════════════════════════════
function WastagePage() {
  const { fetchProducts, reportWastage, fetchInventoryMovements, user, fetchBranches, notifyDataChange } = useAuth();
  const [products, setProducts] = useState([]);
  const [wastage, setWastage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ productId: "", quantity: "", reason: "" });
  const [msg, setMsg] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => { if (isAdmin) fetchBranches().then(setBranches).catch(() => {}); }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    try {
      const bid = selectedBranch || user?.branchId || undefined;
      const [p, m] = await Promise.all([
        fetchProducts(undefined, bid),
        fetchInventoryMovements(undefined, bid)
      ]);
      setProducts(p);
      setWastage(m.filter(mv => mv.movement_type === "WASTAGE"));
    } catch { } finally { setLoading(false); }
  }, [fetchProducts, fetchInventoryMovements, user, selectedBranch]);

  useEffect(() => { if (isAdmin) fetchBranches().then(setBranches).catch(() => {}); }, [isAdmin, fetchBranches]);
  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e) {
    e.preventDefault(); setMsg("");
    try {
      await reportWastage({ productId: Number(form.productId), quantity: Number(form.quantity), reason: form.reason });
      setMsg("Wastage recorded and stock deducted!");
      setForm({ productId: "", quantity: "", reason: "" });
      setShowForm(false); load(); notifyDataChange();
    } catch (err) { setMsg(`Error: ${err.message}`); }
  }

  return (
    <div className="page-panel">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Wastage across all branches'}</span>
        </div>
      )}
      <div className="summary-grid">
        <div className="summary-card"><span>Total Wastage Records</span><strong>{wastage.length}</strong></div>
        <div className="summary-card"><span>Units Wasted</span><strong>{wastage.reduce((s, w) => s + Math.abs(w.quantity), 0)}</strong></div>
      </div>
      <div className="panel-header">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={() => { setShowForm(true); setForm({ productId: "", quantity: "", reason: "" }); }}>+ Record Wastage</button>
          <button className="btn secondary" onClick={() => generateWastageReportPDF(wastage, { branchName: user?.branch?.name, generatedBy: user?.name })}>📄 Export PDF</button>
        </div>
      </div>
      {msg && <div className={msg.startsWith("Error") ? "error-msg" : "muted"} style={{ marginBottom: 12 }}>{msg}</div>}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Record Wastage</h2>
            <form onSubmit={handleSubmit} className="form-grid">
              <label>Product
                <select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })} required>
                  <option value="">Select product…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</option>)}
                </select>
              </label>
              <label>Quantity<input type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required /></label>
              <label>Reason<textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={2} placeholder="e.g. Expired, spoilt, near-useless" required /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Record Wastage</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Product</th><th>Qty Wasted</th><th>Reason</th><th>Reported By</th></tr></thead>
            <tbody>{wastage.map(w => (
              <tr key={w.id}>
                <td>{new Date(w.created_at).toLocaleDateString()}</td>
                <td><strong>{w.product_name}</strong></td>
                <td className="low-stock">{Math.abs(w.quantity)}</td>
                <td>{w.notes || '—'}</td>
                <td>{w.user_name || 'System'}</td>
              </tr>
            ))}</tbody>
          </table>
          {!wastage.length && <p className="muted">No wastage records yet.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STOCK VALUATION PAGE
// ═══════════════════════════════════════════════════════════════════
function StockValuationPage() {
  const { fetchValuation, captureSnapshot, fetchValuationTrend, user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tab, setTab] = useState("current");
  const [trend, setTrend] = useState(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendDays, setTrendDays] = useState(30);
  const [snapshotMsg, setSnapshotMsg] = useState("");

  const load = useCallback(async () => {
    try { setData(await fetchValuation(user?.branchId)); } catch { } finally { setLoading(false); }
  }, [fetchValuation, user]);

  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    try { setTrend(await fetchValuationTrend(user?.branchId, trendDays)); } catch { } finally { setTrendLoading(false); }
  }, [fetchValuationTrend, user, trendDays]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "trend") loadTrend(); }, [tab, loadTrend]);

  async function handleSnapshot() {
    setSnapshotMsg("");
    try {
      const res = await captureSnapshot(user?.branchId);
      setSnapshotMsg(`Snapshot #${res.snapshot.id} captured — total value: ${fmt(res.summary.totalValue)}`);
    } catch (err) { setSnapshotMsg(`Error: ${err.message}`); }
  }

  const fmt = (n) => { const v = parseFloat(n) || 0; return "\u20A6" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const filtered = categoryFilter ? (data?.products || []).filter(p => p.category === categoryFilter) : (data?.products || []);
  const categories = [...new Set((data?.products || []).map(p => p.category))].sort();

  const trendData = trend?.trend || [];
  const maxVal = Math.max(...trendData.map(t => t.totalValue), 1);

  return (
    <div className="page-panel">
      {/* Tabs */}
      <div className="panel-header">
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={tab === "current" ? "active" : ""} onClick={() => setTab("current")}>📊 Current Valuation</button>
          <button className={tab === "trend" ? "active" : ""} onClick={() => setTab("trend")}>📈 Trend History</button>
        </div>
        <button className="btn primary" onClick={handleSnapshot}>📸 Capture Snapshot</button>
      </div>
      {snapshotMsg && <div className={snapshotMsg.startsWith("Error") ? "error-msg" : "muted"} style={{ marginBottom: 12 }}>{snapshotMsg}</div>}

      {tab === "current" && data && (
        <>
          <div className="summary-grid">
            <div className="summary-card accent"><span>Total Products</span><strong>{data.summary.totalProducts}</strong></div>
            <div className="summary-card"><span>Total Units</span><strong>{data.summary.totalUnits.toLocaleString()}</strong></div>
            <div className="summary-card"><span>Total Value</span><strong>{fmt(data.summary.totalValue)}</strong></div>
            <div className="summary-card"><span>Categories</span><strong>{Object.keys(data.summary.byCategory).length}</strong></div>
          </div>
          <div className="tabs" style={{ marginTop: 8 }}>
            <button className={!categoryFilter ? "active" : ""} onClick={() => setCategoryFilter("")}>All</button>
            {categories.map(c => (
              <button key={c} className={categoryFilter === c ? "active" : ""} onClick={() => setCategoryFilter(c)}>{c}</button>
            ))}
          </div>
          {categoryFilter && (
            <div className="summary-grid" style={{ marginTop: 8 }}>
              <div className="summary-card"><span>{categoryFilter} Units</span><strong>{data.summary.byCategory[categoryFilter]?.units?.toLocaleString()}</strong></div>
              <div className="summary-card"><span>{categoryFilter} Value</span><strong>{fmt(data.summary.byCategory[categoryFilter]?.value)}</strong></div>
            </div>
          )}
          {loading ? <p className="loading">Loading…</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Barcode</th><th>Category</th><th>Stock</th><th>Unit</th><th>Cost Price</th><th>Reorder</th><th>Total Value</th></tr></thead>
                <tbody>{filtered.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td><code>{p.barcode}</code></td>
                    <td>{p.category}</td>
                    <td className={p.stock <= p.reorder_level ? "low-stock" : ""}>{p.stock}</td>
                    <td>{p.unit}</td>
                    <td>{fmt(p.cost_price)}</td>
                    <td>{p.reorder_level}</td>
                    <td><strong>{fmt(p.total_value)}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="panel" style={{ marginTop: 16 }}>
            <h2>Value by Category</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Category</th><th>Units</th><th>Value</th><th>% of Total</th></tr></thead>
                <tbody>{Object.entries(data.summary.byCategory).sort((a, b) => b[1].value - a[1].value).map(([cat, vals]) => (
                  <tr key={cat}>
                    <td><strong>{cat}</strong></td>
                    <td>{vals.units.toLocaleString()}</td>
                    <td>{fmt(vals.value)}</td>
                    <td>{((parseFloat(vals.value) || 0) / (parseFloat(data.summary.totalValue) || 1) * 100).toFixed(1)}%</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "trend" && (
        <>
          <div className="panel-header" style={{ marginTop: 8 }}>
            <div className="tabs" style={{ marginBottom: 0 }}>
              {[7, 14, 30, 60, 90, 365].map(d => (
                <button key={d} className={trendDays === d ? "active" : ""} onClick={() => setTrendDays(d)}>{d}d</button>
              ))}
            </div>
          </div>
          {trendLoading ? <p className="loading">Loading trend…</p> : trendData.length === 0 ? (
            <p className="muted" style={{ marginTop: 16 }}>No snapshots yet. Click "Capture Snapshot" above to start tracking.</p>
          ) : (
            <>
              <div className="summary-grid" style={{ marginTop: 8 }}>
                <div className="summary-card"><span>Snapshots</span><strong>{trendData.length}</strong></div>
                <div className="summary-card"><span>Latest Value</span><strong>{fmt(trendData[trendData.length - 1]?.totalValue)}</strong></div>
                <div className="summary-card"><span>First Value</span><strong>{fmt(trendData[0]?.totalValue)}</strong></div>
                <div className="summary-card"><span>Change</span><strong style={{ color: (trendData[trendData.length - 1]?.totalValue - trendData[0]?.totalValue) >= 0 ? "var(--success)" : "var(--danger)" }}>
                  {trendData.length > 1 ? `${(trendData[trendData.length - 1]?.totalValue - trendData[0]?.totalValue) >= 0 ? '+' : ''}${fmt((trendData[trendData.length - 1]?.totalValue - trendData[0]?.totalValue).toFixed(2))}` : '—'}
                </strong></div>
              </div>
              <div className="panel" style={{ marginTop: 12 }}>
                <h2>Stock Value Over Time</h2>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 200, padding: '8px 0', overflowX: 'auto' }}>
                  {trendData.map((t, i) => (
                    <div key={t.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: Math.max(30, 600 / trendData.length), flex: 1 }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{fmt(t.totalValue)}</div>
                      <div title={`Value: ${fmt(t.totalValue)}\nUnits: ${t.totalUnits.toLocaleString()}\nProducts: ${t.totalProducts}${t.delta ? `\nChange: ${t.delta.value >= 0 ? '+' : ''}${fmt(t.delta.value)}` : ''}`}
                        style={{ width: '100%', height: `${Math.max(4, (t.totalValue / maxVal) * 160)}px`, background: i === trendData.length - 1 ? 'var(--accent)' : 'var(--primary)', borderRadius: '4px 4px 0 0', transition: 'height 0.3s', cursor: 'pointer' }} />
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 60 }}>
                        {new Date(t.date).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead><tr><th>Date</th><th>Products</th><th>Units</th><th>Total Value</th><th>Change</th></tr></thead>
                  <tbody>{trendData.map(t => (
                    <tr key={t.id}>
                      <td>{new Date(t.date).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td>{t.totalProducts}</td>
                      <td>{t.totalUnits.toLocaleString()}</td>
                      <td><strong>{fmt(t.totalValue)}</strong></td>
                      <td style={{ color: t.delta ? (t.delta.value >= 0 ? 'var(--success)' : 'var(--danger)') : 'var(--muted)' }}>
                        {t.delta ? `${t.delta.value >= 0 ? '+' : ''}${fmt(t.delta.value)}` : '—'}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SALES (Phase 5)
// ═══════════════════════════════════════════════════════════════════
function SalesPage() {
  const { fetchSales, getSale, returnSale, user, fetchBranches } = useAuth();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [detail, setDetail] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (isAdmin) fetchBranches().then(setBranches).catch(() => {});
  }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo + "T23:59:59";
      if (selectedBranch) params.branchId = selectedBranch;
      const result = await fetchSales(Object.keys(params).length ? params : undefined);
      setSales(result.data || []);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch { }
    finally { setLoading(false); }
  }, [fetchSales, dateFrom, dateTo, selectedBranch]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = {};
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo + "T23:59:59";
      if (selectedBranch) params.branchId = selectedBranch;
      params.cursor = JSON.stringify(nextCursor);
      const result = await fetchSales(params);
      setSales(prev => [...prev, ...(result.data || [])]);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch { }
    finally { setLoadingMore(false); }
  }

  useEffect(() => { load(); }, [load]);

  async function viewDetail(id) {
    try { setDetail(await getSale(id)); } catch (err) { alert(err.message); }
  }

  async function handleReturn(saleId, productId, maxQty) {
    const qty = prompt(`Return how many? (max ${maxQty})`);
    if (!qty || Number(qty) < 1) return;
    const reason = prompt("Reason for return:") || "";
    try { await returnSale(saleId, { productId, quantity: Number(qty), reason }); alert("Return processed."); load(); }
    catch (err) { alert(err.message); }
  }

  return (
    <div className="page-panel">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select
            value={selectedBranch}
            onChange={e => { setSelectedBranch(e.target.value); }}
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}
          >
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Sales across all branches'}
          </span>
        </div>
      )}
      {!isAdmin && user?.branch?.name && (
        <div style={{ marginBottom: 12, padding: '8px 16px', background: 'var(--surface, var(--card-bg))', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem' }}>
          🏢 <strong>Branch:</strong> {user.branch.name} — Sales are filtered to your branch.
        </div>
      )}
      <div className="panel-header">
        <div className="filters">
          <label>From<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
          <label>To<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
        </div>
      </div>

      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Cashier</th><th>Items</th><th>Payment</th><th>Total</th><th>Actions</th></tr></thead>
            <tbody>{sales.map(s => (
              <tr key={s.id}>
                <td><code>{s.receipt_number}</code></td>
                <td>{new Date(s.created_at).toLocaleString()}</td>
                <td>{s.customer_name}</td><td>{s.cashier_name}</td>
                <td>{s.item_count}</td><td>{s.payment_method}</td>
                <td><strong>₦{(parseFloat(s.total) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</strong></td>
                <td>
                  <button className="btn-sm" onClick={() => viewDetail(s.id)}>View</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!sales.length && <p className="muted">No sales found.</p>}
          {hasMore && (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <button className="btn secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Load More (${sales.length} loaded)`}
              </button>
            </div>
          )}
        </div>
      )}

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Receipt: {detail.receipt_number}</h2>
              <button className="btn-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div className="sale-detail">
              <p><strong>Date:</strong> {new Date(detail.created_at).toLocaleString()}</p>
              <p><strong>Customer:</strong> {detail.customer_name}</p>
              <p><strong>Cashier:</strong> {detail.cashier_name}</p>
              {detail.branch_name && <p><strong>Branch:</strong> {detail.branch_name}</p>}
              <p><strong>Payment:</strong> {detail.payment_method}</p>
              <table><thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Discount</th><th>Total</th>{["ADMIN", "MANAGER"].includes(user?.role) && <th>Action</th>}</tr></thead>
                <tbody>{detail.items?.map((item, i) => (
                  <tr key={i}>
                    <td>{item.product_name}</td>
                    <td>₦{(parseFloat(item.unit_price) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                    <td>{item.quantity}</td>
                    <td>{item.discount ? `₦${(parseFloat(item.discount) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}` : "—"}</td>
                    <td>₦{(parseFloat(item.line_total) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                    <td>{["ADMIN", "MANAGER"].includes(user?.role) && (
                      <button className="btn-sm danger" onClick={() => handleReturn(detail.id, item.product_id, item.quantity)}>Return</button>
                    )}</td>
                  </tr>
                ))}</tbody>
              </table>
              <hr />
              <div className="sale-totals">
                <p>Subtotal: ₦{(parseFloat(detail.subtotal) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p>
                {detail.discount > 0 && <p>Discount: -₦{(parseFloat(detail.discount) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p>}
                {detail.tax > 0 && <p>Tax: ₦{(parseFloat(detail.tax) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p>}
                <p><strong>Total: ₦{(parseFloat(detail.total) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</strong></p>
              </div>
              <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn primary" onClick={() => {
                  const receipt = {
                    receiptNumber: detail.receipt_number,
                    createdAt: detail.created_at,
                    cashierName: detail.cashier_name,
                    customerName: detail.customer_name,
                    paymentMethod: detail.payment_method,
                    items: (detail.items || []).map(i => ({ name: i.product_name, quantity: i.quantity, lineTotal: i.line_total })),
                    subtotal: detail.subtotal,
                    discount: detail.discount,
                    tax: detail.tax,
                    total: detail.total,
                    amountPaid: detail.amount_paid,
                    change_amount: detail.change_amount,
                    branchName: detail.branch_name || user?.branch?.name || "",
                  };
                  generateReceiptPDF(receipt);
                }}>📄 Download PDF</button>
                <button className="btn secondary" onClick={() => window.print()}>🖨️ Print</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CUSTOMERS (Phase 12)
// ═══════════════════════════════════════════════════════════════════
function CustomersPage() {
  const { fetchCustomers, createCustomer, updateCustomer, sendCustomerSms, bulkSms } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editCust, setEditCust] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  // SMS state
  const [smsModal, setSmsModal] = useState(null); // customer object for individual SMS
  const [smsText, setSmsText] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsMsg, setSmsMsg] = useState("");
  // Bulk SMS state
  const [showBulkSms, setShowBulkSms] = useState(false);
  const [bulkSmsText, setBulkSmsText] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [selectedForBulk, setSelectedForBulk] = useState([]);

  const load = useCallback(async () => { try { setCustomers(await fetchCustomers()); } catch { } finally { setLoading(false); } }, [fetchCustomers]);
  useEffect(() => { load(); }, [load]);

  function startEdit(c) { setEditCust(c); setForm({ name: c.name, email: c.email || "", phone: c.phone || "" }); setShowForm(true); }
  function startNew() { setEditCust(null); setForm({ name: "", email: "", phone: "" }); setShowForm(true); }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editCust) await updateCustomer(editCust.id, form);
      else await createCustomer(form);
      setShowForm(false); load();
    } catch (err) { alert(err.message); }
  }

  // Send SMS to a single customer
  async function handleSendSms(e) {
    e.preventDefault();
    if (!smsModal?.phone || !smsText.trim()) return;
    setSmsSending(true); setSmsMsg("");
    try {
      await sendCustomerSms({ phone: smsModal.phone, message: smsText, customerId: smsModal.id });
      setSmsMsg("SMS sent!"); setSmsText("");
    } catch (err) { setSmsMsg(`Error: ${err.message}`); }
    finally { setSmsSending(false); }
  }

  // Bulk SMS
  async function handleBulkSms(e) {
    e.preventDefault();
    if (!bulkSmsText.trim()) return;
    setBulkSending(true); setBulkResult(null);
    try {
      const ids = selectedForBulk.length > 0 ? selectedForBulk : undefined;
      const r = await bulkSms({ message: bulkSmsText, customerIds: ids });
      setBulkResult(r);
      setBulkSmsText("");
    } catch (err) { setBulkResult({ message: `Error: ${err.message}` }); }
    finally { setBulkSending(false); }
  }

  function toggleBulkSelect(id) {
    setSelectedForBulk(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  const tierColor = { BRONZE: "bronze", SILVER: "silver", GOLD: "gold", PLATINUM: "platinum" };
  const customersWithPhone = customers.filter(c => c.phone);

  return (
    <div className="page-panel">
      <div className="panel-header">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={startNew}>+ Add Customer</button>
          <button className="btn secondary" onClick={() => { setShowBulkSms(true); setBulkResult(null); setBulkSmsText(""); setSelectedForBulk([]); }}>📱 Bulk SMS</button>
        </div>
      </div>

      {/* Individual SMS Modal */}
      {smsModal && (
        <div className="modal-overlay" onClick={() => setSmsModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 450 }}>
            <h2>📱 Send SMS to {smsModal.name}</h2>
            <p className="muted" style={{ marginBottom: 12 }}>To: {smsModal.phone}</p>
            <form onSubmit={handleSendSms} className="form-grid">
              <label>Message
                <textarea value={smsText} onChange={e => setSmsText(e.target.value)} rows={4}
                  placeholder="Type your message..." required style={{ resize: 'vertical' }} />
              </label>
              <p className="muted" style={{ fontSize: '0.8rem', marginTop: -8 }}>{smsText.length}/1600 characters</p>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setSmsModal(null)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={smsSending || !smsText.trim()}>
                  {smsSending ? 'Sending...' : '📱 Send SMS'}
                </button>
              </div>
            </form>
            {smsMsg && <p className={smsMsg.startsWith('Error') ? 'error-msg' : 'muted'} style={{ marginTop: 8 }}>{smsMsg}</p>}
          </div>
        </div>
      )}

      {/* Bulk SMS Modal */}
      {showBulkSms && (
        <div className="modal-overlay" onClick={() => setShowBulkSms(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 550 }}>
            <h2>📱 Bulk SMS to Customers</h2>
            <p className="muted" style={{ marginBottom: 12 }}>Send a text message to {selectedForBulk.length > 0 ? `${selectedForBulk.length} selected` : 'all'} customers with phone numbers ({customersWithPhone.length} total).</p>
            {!bulkResult ? (
              <form onSubmit={handleBulkSms} className="form-grid">
                <label>Message
                  <textarea value={bulkSmsText} onChange={e => setBulkSmsText(e.target.value)} rows={4}
                    placeholder="Type your bulk message... (e.g. promotions, announcements)" required style={{ resize: 'vertical' }} />
                </label>
                <p className="muted" style={{ fontSize: '0.8rem', marginTop: -8 }}>{bulkSmsText.length}/1600 characters</p>
                {customersWithPhone.length > 0 && (
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 8 }}>
                    <label style={{ marginBottom: 8, display: 'block', cursor: 'pointer' }}>
                      <input type="checkbox" checked={selectedForBulk.length === customersWithPhone.length}
                        onChange={() => setSelectedForBulk(selectedForBulk.length === customersWithPhone.length ? [] : customersWithPhone.map(c => c.id))} />
                      {' '}Select all ({customersWithPhone.length})
                    </label>
                    {customersWithPhone.map(c => (
                      <label key={c.id} style={{ display: 'block', padding: '4px 0', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={selectedForBulk.includes(c.id)}
                          onChange={() => toggleBulkSelect(c.id)} />
                        {' '}{c.name} — {c.phone}
                      </label>
                    ))}
                  </div>
                )}
                <div className="form-actions">
                  <button type="button" className="btn secondary" onClick={() => setShowBulkSms(false)}>Cancel</button>
                  <button type="submit" className="btn primary" disabled={bulkSending || !bulkSmsText.trim()}>
                    {bulkSending ? 'Sending...' : `📱 Send to ${selectedForBulk.length > 0 ? selectedForBulk.length : customersWithPhone.length} customers`}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <div className="summary-grid" style={{ marginTop: 12 }}>
                  <div className="summary-card"><span>✅ Sent</span><strong>{bulkResult.sent || 0}</strong></div>
                  <div className="summary-card"><span>❌ Failed</span><strong>{bulkResult.failed || 0}</strong></div>
                  <div className="summary-card"><span>📋 Total</span><strong>{bulkResult.total || 0}</strong></div>
                </div>
                <p className="muted" style={{ marginTop: 12 }}>{bulkResult.message}</p>
                <div className="form-actions" style={{ marginTop: 16 }}>
                  <button className="btn primary" onClick={() => { setShowBulkSms(false); setBulkResult(null); }}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editCust ? "Edit Customer" : "New Customer"}</h2>
            <form onSubmit={handleSubmit} className="form-grid">
              <label>Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
              <label>Email<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
              <label>Phone<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">{editCust ? "Update" : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Points</th><th>Tier</th><th>Total Spent</th><th>Visits</th><th>Actions</th></tr></thead>
            <tbody>{customers.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td><td>{c.email || "—"}</td><td>{c.phone || "—"}</td>
                <td>{c.loyalty_points}</td>
                <td><span className={`tier-badge ${tierColor[c.membership_tier] || ""}`}>{c.membership_tier}</span></td>
                <td>₦{(parseFloat(c.total_spent) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                <td>{c.visit_count}</td>
                <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button className="btn-sm" onClick={() => startEdit(c)}>Edit</button>
                  {c.phone && <button className="btn-sm" onClick={() => { setSmsModal(c); setSmsText(""); setSmsMsg(""); }}>📱 SMS</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!customers.length && <p className="muted">No customers yet.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SUPPLIERS (Phase 10)
// ═══════════════════════════════════════════════════════════════════
function SuppliersPage() {
  const { fetchSuppliers, createSupplier, updateSupplier, deleteSupplier } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editSup, setEditSup] = useState(null);
  const [form, setForm] = useState({ name: "", contactPerson: "", email: "", phone: "", address: "" });

  const load = useCallback(async () => { try { setSuppliers(await fetchSuppliers()); } catch { } finally { setLoading(false); } }, [fetchSuppliers]);
  useEffect(() => { load(); }, [load]);

  function startEdit(s) { setEditSup(s); setForm({ name: s.name, contactPerson: s.contact_person || "", email: s.email || "", phone: s.phone || "", address: s.address || "" }); setShowForm(true); }
  function startNew() { setEditSup(null); setForm({ name: "", contactPerson: "", email: "", phone: "", address: "" }); setShowForm(true); }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editSup) await updateSupplier(editSup.id, form);
      else await createSupplier(form);
      setShowForm(false); load();
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete supplier "${name}"?`)) return;
    try { await deleteSupplier(id); load(); } catch (err) { alert(err.message); }
  }

  return (
    <div className="page-panel">
      <div className="panel-header"><button className="btn primary" onClick={startNew}>+ Add Supplier</button></div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editSup ? "Edit Supplier" : "New Supplier"}</h2>
            <form onSubmit={handleSubmit} className="form-grid">
              <label>Company Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
              <label>Contact Person<input value={form.contactPerson} onChange={e => setForm({ ...form, contactPerson: e.target.value })} /></label>
              <label>Email<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
              <label>Phone<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
              <label>Address<textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">{editSup ? "Update" : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Contact</th><th>Email</th><th>Phone</th><th>Address</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{suppliers.map(s => (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.contact_person || "—"}</td><td>{s.email || "—"}</td>
                <td>{s.phone || "—"}</td><td>{s.address || "—"}</td>
                <td><span className={`status-badge ${s.is_active ? "active" : "inactive"}`}>{s.is_active ? "Active" : "Inactive"}</span></td>
                <td>
                  <button className="btn-sm" onClick={() => startEdit(s)}>Edit</button>
                  <button className="btn-sm danger" onClick={() => handleDelete(s.id, s.name)}>Delete</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!suppliers.length && <p className="muted">No suppliers yet.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PURCHASE ORDERS (Phase 10)
// ═══════════════════════════════════════════════════════════════════
function ProcurementPage() {
  const { fetchPurchaseOrders, createPurchaseOrder, updatePOStatus, fetchSuppliers, fetchProducts, getPOPayments, createPOPayment, user, fetchBranches } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ supplierId: "", notes: "", expectedDate: "", items: [{ productId: "", quantity: "", unitCost: "" }] });
  // Payment modal
  const [payModal, setPayModal] = useState(null);
  const [payForm, setPayForm] = useState({ amount: "", paymentMethod: "Cash", reference: "", notes: "" });
  const [payDetail, setPayDetail] = useState(null);
  const [payMsg, setPayMsg] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (isAdmin) fetchBranches().then(setBranches).catch(() => {});
  }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranch) params.branchId = selectedBranch;
      const [o, s, p] = await Promise.all([fetchPurchaseOrders(Object.keys(params).length ? params : undefined), fetchSuppliers(), fetchProducts(undefined, user?.branchId)]);
      setOrders(o); setSuppliers(s); setProducts(p);
    } catch { }
    finally { setLoading(false); }
  }, [fetchPurchaseOrders, fetchSuppliers, fetchProducts, user, selectedBranch]);

  useEffect(() => { load(); }, [load]);

  function addItem() { setForm({ ...form, items: [...form.items, { productId: "", quantity: "", unitCost: "" }] }); }
  function removeItem(i) { setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) }); }
  function updateItem(i, field, val) { setForm({ ...form, items: form.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item) }); }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      const validItems = form.items.filter(i => i.productId && i.quantity && i.unitCost !== "" && i.unitCost != null);
      if (!validItems.length) {
        alert("Please add at least one item with a product, quantity, and unit cost.");
        return;
      }
      await createPurchaseOrder({
        supplierId: Number(form.supplierId),
        notes: form.notes,
        expectedDate: form.expectedDate || null,
        items: validItems.map(i => ({ productId: Number(i.productId), quantity: Number(i.quantity), unitCost: Number(i.unitCost) })),
      });
      setShowForm(false); load();
    } catch (err) { alert(err.message); }
  }

  async function handleStatus(id, status) {
    try { await updatePOStatus(id, status); load(); } catch (err) { alert(err.message); }
  }

  async function openPayModal(po) {
    setPayMsg("");
    setPayForm({ amount: "", paymentMethod: "Cash", reference: "", notes: "" });
    try {
      const detail = await getPOPayments(po.id);
      setPayDetail(detail);
    } catch { setPayDetail({ ...po, total_paid: 0, balance: Number(po.total), payments: [] }); }
    setPayModal(po);
  }

  async function handleMakePayment(e) {
    e.preventDefault(); setPayMsg("");
    try {
      await createPOPayment(payModal.id, {
        amount: Number(payForm.amount),
        paymentMethod: payForm.paymentMethod,
        reference: payForm.reference || undefined,
        notes: payForm.notes || undefined,
      });
      setPayMsg("Payment recorded!");
      const detail = await getPOPayments(payModal.id);
      setPayDetail(detail);
      setPayForm({ amount: "", paymentMethod: "Cash", reference: "", notes: "" });
      load();
    } catch (err) { setPayMsg("Error: " + err.message); }
  }

  const fmt = (n) => { const v = parseFloat(n) || 0; return "\u20A6" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const statusColor = { PENDING: "warning", APPROVED: "info", RECEIVED: "active", CANCELLED: "inactive" };

  return (
    <div className="page-panel">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select
            value={selectedBranch}
            onChange={e => { setSelectedBranch(e.target.value); }}
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}
          >
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Purchase orders across all branches'}
          </span>
        </div>
      )}
      {!isAdmin && user?.branch?.name && (
        <div style={{ marginBottom: 12, padding: '8px 16px', background: 'var(--surface, var(--card-bg))', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem' }}>
          🏢 <strong>Branch:</strong> {user.branch.name} — Purchase orders are filtered to your branch.
        </div>
      )}
      <div className="panel-header"><button className="btn primary" onClick={() => { setShowForm(true); setForm({ supplierId: suppliers[0]?.id || "", notes: "", expectedDate: "", items: [{ productId: "", quantity: "", unitCost: "" }] }); }}>+ New Purchase Order</button></div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal wide" onClick={e => e.stopPropagation()}>
            <h2>New Purchase Order</h2>
            <form onSubmit={handleSubmit} className="form-grid">
              <label>Supplier
                <select value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })} required>
                  <option value="">Select supplier…</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label>Expected Date<input type="date" value={form.expectedDate} onChange={e => setForm({ ...form, expectedDate: e.target.value })} /></label>
              <label>Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></label>

              <div className="po-items">
                {form.items.map((item, i) => (
                  <div key={i} className="po-item-row">
                    <select value={item.productId} onChange={e => updateItem(i, "productId", e.target.value)} required>
                      <option value="">Product…</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name} (₦{p.price})</option>)}
                    </select>
                    <input type="number" min="1" placeholder="Qty" value={item.quantity} onChange={e => updateItem(i, "quantity", e.target.value)} required />
                    <input type="number" step="0.01" min="0" placeholder="Unit Cost" value={item.unitCost} onChange={e => updateItem(i, "unitCost", e.target.value)} required />
                    {form.items.length > 1 && <button type="button" className="btn-sm danger" onClick={() => removeItem(i)}>✕</button>}
                  </div>
                ))}
                <button type="button" className="btn secondary" onClick={addItem}>+ Add Item</button>
              </div>

              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Create PO</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>PO #</th><th>Supplier</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>{orders.map(o => (
              <tr key={o.id}>
                <td><code>{o.po_number}</code></td><td>{o.supplier_name}</td>
                <td>₦{(parseFloat(o.total) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                <td><span className={`status-badge ${statusColor[o.status] || ""}`}>{o.status}</span></td>
                <td>{new Date(o.created_at).toLocaleDateString()}</td>
                <td>
                  {o.status === "PENDING" && <button className="btn-sm" onClick={() => handleStatus(o.id, "APPROVED")}>Approve</button>}
                  {o.status === "APPROVED" && <button className="btn-sm" onClick={() => handleStatus(o.id, "RECEIVED")}>Receive</button>}
                  {Number(o.total) > 0 && <button className="btn-sm" style={{ background: 'var(--primary-dark)', color: '#fff' }} onClick={() => openPayModal(o)}>₦ Pay</button>}
                  {(o.status === "PENDING" || o.status === "APPROVED") && <button className="btn-sm danger" onClick={() => handleStatus(o.id, "CANCELLED")}>Cancel</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!orders.length && <p className="muted">No purchase orders yet.</p>}
        </div>
      )}

      {/* ── PAYMENT MODAL ── */}
      {payModal && (
        <div className="modal-overlay" onClick={() => setPayModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h2>💰 Pay Supplier — {payDetail?.supplier_name || payModal.supplier_name}</h2>
            <p className="muted" style={{ marginBottom: 12 }}>PO #{payDetail?.po_number || payModal.po_number}</p>

            {/* Payment summary */}
            {payDetail && (
              <div className="summary-grid" style={{ marginBottom: 16 }}>
                <div className="summary-card"><span>PO Total</span><strong>{fmt(payDetail.total)}</strong></div>
                <div className="summary-card"><span>Paid</span><strong style={{ color: 'var(--success)' }}>{fmt(payDetail.total_paid)}</strong></div>
                <div className="summary-card"><span>Balance</span><strong style={{ color: payDetail.balance > 0 ? 'var(--danger)' : 'var(--success)' }}>{fmt(payDetail.balance)}</strong></div>
              </div>
            )}

            {/* Previous payments */}
            {payDetail?.payments?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Previous Payments</h3>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>By</th></tr></thead>
                    <tbody>{payDetail.payments.map(p => (
                      <tr key={p.id}>
                        <td>{new Date(p.created_at).toLocaleDateString()}</td>
                        <td><strong>{fmt(p.amount)}</strong></td>
                        <td>{p.payment_method}</td>
                        <td>{p.reference || '—'}</td>
                        <td>{p.paid_by_name || '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Make payment form */}
            {payDetail && payDetail.balance > 0 && (
              <form onSubmit={handleMakePayment} className="form-grid">
                <label>Amount (₦)
                  <input type="number" min="1" step="0.01" max={payDetail.balance} value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} required placeholder={`Max: ${fmt(payDetail.balance)}`} style={{ fontSize: '1.1rem', fontWeight: 700 }} />
                </label>
                <label>Payment Method
                  <select value={payForm.paymentMethod} onChange={e => setPayForm({ ...payForm, paymentMethod: e.target.value })}>
                    <option value="Cash">💵 Cash</option>
                    <option value="Transfer">🏦 Bank Transfer</option>
                    <option value="POS">💳 POS</option>
                    <option value="Card">💳 Card</option>
                    <option value="Bank">🏦 Bank</option>
                  </select>
                </label>
                <label>Reference (optional)
                  <input value={payForm.reference} onChange={e => setPayForm({ ...payForm, reference: e.target.value })} placeholder="e.g. Transfer ref, receipt #" />
                </label>
                <label>Notes (optional)
                  <input value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })} placeholder="Payment notes" />
                </label>
                {payMsg && <div className={payMsg.startsWith('Error') ? 'error-msg' : 'muted'} style={{ gridColumn: '1 / -1' }}>{payMsg}</div>}
                <div className="form-actions">
                  <button type="button" className="btn secondary" onClick={() => setPayModal(null)}>Close</button>
                  <button type="submit" className="btn primary">💰 Record Payment</button>
                </div>
              </form>
            )}

            {payDetail && payDetail.balance <= 0 && (
              <div style={{ textAlign: 'center', padding: 16, background: '#dcfce7', borderRadius: 8, color: '#166534', fontWeight: 600 }}>
                ✅ This purchase order is fully paid!
                {payMsg && <div className="muted" style={{ marginTop: 8 }}>{payMsg}</div>}
                <button className="btn secondary" style={{ marginTop: 12 }} onClick={() => setPayModal(null)}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EXPENSES (Phase 13)
// ═══════════════════════════════════════════════════════════════════
function ExpensesPage() {
  const { fetchExpenses, createExpense, user, fetchBranches } = useAuth();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: "", description: "", amount: "", paymentMethod: "Cash", reference: "" });
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (isAdmin) fetchBranches().then(setBranches).catch(() => {});
  }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    const params = {};
    if (selectedBranch) params.branchId = selectedBranch;
    try { setExpenses(await fetchExpenses(Object.keys(params).length ? params : undefined)); } catch { } finally { setLoading(false); }
  }, [fetchExpenses, selectedBranch]);
  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    try { await createExpense({ ...form, amount: Number(form.amount) }); setShowForm(false); setForm({ category: "", description: "", amount: "", paymentMethod: "Cash", reference: "" }); load(); }
    catch (err) { alert(err.message); }
  }

  return (
    <div className="page-panel">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select
            value={selectedBranch}
            onChange={e => { setSelectedBranch(e.target.value); }}
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}
          >
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Expenses across all branches'}
          </span>
        </div>
      )}
      {!isAdmin && user?.branch?.name && (
        <div style={{ marginBottom: 12, padding: '8px 16px', background: 'var(--surface, var(--card-bg))', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem' }}>
          🏢 <strong>Branch:</strong> {user.branch.name} — Expenses are filtered to your branch.
        </div>
      )}
      <div className="panel-header"><button className="btn primary" onClick={() => setShowForm(true)}>+ Add Expense</button></div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>New Expense</h2>
            <form onSubmit={handleSubmit} className="form-grid">
              <label>Category<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. Rent, Utilities, Supplies" required /></label>
              <label>Description<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></label>
              <label>Amount (₦)<input type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /></label>
              <label>Payment Method
                <select value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value })}>
                  <option>Cash</option><option>Card</option><option>Transfer</option>
                </select>
              </label>
              <label>Reference<input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="Invoice # etc." /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Add Expense</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Method</th><th>Approved By</th></tr></thead>
            <tbody>{expenses.map(e => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td>{e.category}</td><td>{e.description || "—"}</td>
                <td>₦{(parseFloat(e.amount) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                <td>{e.payment_method}</td><td>{e.approved_by_name || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          {!expenses.length && <p className="muted">No expenses recorded.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FINANCE (Phase 13)
// ═══════════════════════════════════════════════════════════════════
function FinancePage() {
  const { fetchFinanceSummary, user, fetchBranches } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (isAdmin) fetchBranches().then(setBranches).catch(() => {});
  }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = {};
    if (selectedBranch) params.branchId = selectedBranch;
    try { setSummary(await fetchFinanceSummary(Object.keys(params).length ? params : undefined)); }
    catch { setSummary(null); }
    finally { setLoading(false); }
  }, [fetchFinanceSummary, selectedBranch]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => { const v = parseFloat(n) || 0; return "₦" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  if (loading) return <p className="loading">Loading…</p>;
  if (!summary) return <p className="error-msg">Failed to load financial summary.</p>;

  return (
    <div className="finance-page">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select
            value={selectedBranch}
            onChange={e => { setSelectedBranch(e.target.value); }}
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}
          >
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Finance across all branches'}
          </span>
        </div>
      )}
      {!isAdmin && user?.branch?.name && (
        <div style={{ marginBottom: 12, padding: '8px 16px', background: 'var(--surface, var(--card-bg))', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem' }}>
          🏢 <strong>Branch:</strong> {user.branch.name} — Finance data is filtered to your branch.
        </div>
      )}
      <div className="summary-grid">
        <div className="summary-card accent"><span>Total Revenue</span><strong>{fmt(summary.revenue)}</strong></div>
        <div className="summary-card warning"><span>Total Expenses</span><strong>{fmt(summary.expenses)}</strong></div>
        <div className="summary-card"><span>Net Profit</span><strong className={summary.profit >= 0 ? "profit" : "loss"}>{fmt(summary.profit)}</strong></div>
        <div className="summary-card"><span>Today's Revenue</span><strong>{fmt(summary.todayRevenue)}</strong></div>
      </div>
      <div className="panel">
        <h2>Profit & Loss Summary</h2>
        <table>
          <tbody>
            <tr><td>Revenue</td><td className="profit">{fmt(summary.revenue)}</td></tr>
            <tr><td>Expenses</td><td className="loss">{fmt(summary.expenses)}</td></tr>
            <tr className="total-row"><td><strong>Net Profit</strong></td><td><strong className={summary.profit >= 0 ? "profit" : "loss"}>{fmt(summary.profit)}</strong></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AI FORECASTING & DEMAND PREDICTION (Phase 16)
// ═══════════════════════════════════════════════════════════════════
function ForecastPage() {
  const { fetchDemandForecast } = useAuth();
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try { setForecast(await fetchDemandForecast()); }
    catch { setForecast([]); }
    finally { setLoading(false); }
  }, [fetchDemandForecast]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => { const v = parseFloat(n) || 0; return "\u20A6" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const riskColor = { CRITICAL: "inactive", HIGH: "warning", MEDIUM: "info", LOW: "active" };
  const filtered = filter === "all" ? forecast : forecast.filter(f => f.risk === filter.toUpperCase());
  const criticalCount = forecast.filter(f => f.risk === "CRITICAL").length;
  const highCount = forecast.filter(f => f.risk === "HIGH").length;

  return (
    <div className="page-panel">
      <div className="summary-grid">
        <div className="summary-card"><span>Products Analyzed</span><strong>{forecast.length}</strong></div>
        <div className="summary-card warning"><span>Critical Risk</span><strong>{criticalCount}</strong></div>
        <div className="summary-card"><span>High Risk</span><strong>{highCount}</strong></div>
      </div>
      <div className="panel-header">
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
          <button className={filter === "critical" ? "active" : ""} onClick={() => setFilter("critical")}>Critical</button>
          <button className={filter === "high" ? "active" : ""} onClick={() => setFilter("high")}>High</button>
          <button className={filter === "medium" ? "active" : ""} onClick={() => setFilter("medium")}>Medium</button>
        </div>
        <button className="btn primary" onClick={load}>Refresh</button>
      </div>
      {loading ? <p className="loading">Analyzing sales patterns...</p> : (
        <div className="table-wrap">
          <table><thead><tr><th>Product</th><th>Stock</th><th>Avg Daily</th><th>7-Day Pred</th><th>30-Day Pred</th><th>Days Left</th><th>Risk</th></tr></thead>
            <tbody>{filtered.map((f, i) => (
              <tr key={i}>
                <td><strong>{f.productName}</strong></td>
                <td className={f.currentStock <= f.reorderLevel ? "low-stock" : ""}>{f.currentStock}</td>
                <td>{f.avgDaily}</td>
                <td>{f.predicted7Day}</td>
                <td>{f.predicted30Day}</td>
                <td className={f.daysUntilStockout <= 7 ? "low-stock" : ""}>{f.daysUntilStockout === Infinity ? "—" : `${f.daysUntilStockout} days`}</td>
                <td><span className={`status-badge ${riskColor[f.risk] || ""}`}>{f.risk}</span></td>
              </tr>
            ))}</tbody>
          </table>
          {!filtered.length && <p className="muted">No forecast data yet. Need at least some sales history.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AUTO REORDER (Phase 16)
// ═══════════════════════════════════════════════════════════════════
function AutoReorderPage() {
  const { fetchAutoReorderSuggestions, createAutoReorder, user, fetchBranches } = useAuth();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState({});
  const [msg, setMsg] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => { if (isAdmin) fetchBranches().then(setBranches).catch(() => {}); }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = {};
    if (selectedBranch) params.branchId = selectedBranch;
    try { setSuggestions(await fetchAutoReorderSuggestions(Object.keys(params).length ? params : undefined)); }
    catch { setSuggestions([]); }
    finally { setLoading(false); }
  }, [fetchAutoReorderSuggestions, selectedBranch]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => { const v = parseFloat(n) || 0; return "\u20A6" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  function toggle(id) { setSelected(prev => ({ ...prev, [id]: !prev[id] })); }

  async function handleCreateOrders() {
    const items = suggestions.filter(s => selected[s.id]).map(s => ({
      productId: s.id, supplierId: s.supplier_id, quantity: s.suggestedQty, unitCost: s.costPrice,
    }));
    if (!items.length) return;
    setBusy(true); setMsg("");
    try {
      const result = await createAutoReorder(items);
      setMsg(`Created ${result.orders?.length || 0} purchase order(s)!`);
      setSelected({}); load();
    } catch (err) { setMsg(`Error: ${err.message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="page-panel">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Auto-reorder across all branches'}</span>
        </div>
      )}
      <div className="summary-grid">
        <div className="summary-card warning"><span>Need Reorder</span><strong>{suggestions.length}</strong></div>
        <div className="summary-card"><span>Selected</span><strong>{Object.values(selected).filter(Boolean).length}</strong></div>
        <div className="summary-card"><span>Total Cost</span><strong>{fmt(suggestions.filter(s => selected[s.id]).reduce((sum, s) => sum + s.totalCost, 0))}</strong></div>
      </div>
      {msg && <div className={msg.startsWith("Error") ? "error-msg" : "muted"} style={{ marginBottom: 12 }}>{msg}</div>}
      <div className="panel-header">
        <button className="btn primary" onClick={handleCreateOrders} disabled={busy || !Object.values(selected).some(Boolean)}>
          {busy ? "Creating..." : "Create Purchase Orders"}
        </button>
        <button className="btn secondary" onClick={load}>Refresh</button>
      </div>
      {loading ? <p className="loading">Checking stock levels...</p> : (
        <div className="table-wrap">
          <table><thead><tr><th></th><th>Product</th><th>Category</th><th>Stock</th><th>Reorder</th><th>Suggested Qty</th><th>Unit Cost</th><th>Total</th><th>Supplier</th></tr></thead>
            <tbody>{suggestions.map(s => (
              <tr key={s.id} style={{ background: selected[s.id] ? "#f0fdf4" : "" }}>
                <td><input type="checkbox" checked={!!selected[s.id]} onChange={() => toggle(s.id)} /></td>
                <td><strong>{s.name}</strong><br /><small>{s.barcode}</small></td>
                <td>{s.category}</td>
                <td className="low-stock">{s.stock}</td>
                <td>{s.reorder_level}</td>
                <td><strong>{s.suggestedQty}</strong></td>
                <td>{fmt(s.costPrice)}</td>
                <td>{fmt(s.totalCost)}</td>
                <td>{s.supplier_name || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
          {!suggestions.length && <p className="muted">All products are well-stocked!</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EXECUTIVE DASHBOARD (Phase 16)
// ═══════════════════════════════════════════════════════════════════
function ExecutiveDashboard() {
  const { fetchExecutiveOverview, user, fetchBranches } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => { if (isAdmin) fetchBranches().then(setBranches).catch(() => {}); }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = {};
    if (selectedBranch) params.branchId = selectedBranch;
    try { await fetchExecutiveOverview(Object.keys(params).length ? params : undefined).then(setData); }
    catch { setData(null); }
    finally { setLoading(false); }
  }, [fetchExecutiveOverview, selectedBranch]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => { const v = parseFloat(n) || 0; return "\u20A6" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  if (loading) return <p className="loading">Loading executive dashboard...</p>;
  if (!data) return <div className="error-msg">Failed to load data.</div>;

  return (
    <div className="dashboard">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Executive overview across all branches'}</span>
        </div>
      )}
      <div className="summary-grid">
        <div className="summary-card accent"><span>Total Revenue</span><strong>{fmt(data.revenue?.total)}</strong><small>Last 30 days: {fmt(data.revenue?.month)}</small></div>
        <div className="summary-card"><span>Total Profit</span><strong className={data.profit?.total >= 0 ? "profit" : "loss"}>{fmt(data.profit?.total)}</strong><small>Month: {fmt(data.profit?.month)}</small></div>
        <div className="summary-card warning"><span>Total Expenses</span><strong>{fmt(data.expenses?.total)}</strong></div>
        <div className="summary-card"><span>Transactions</span><strong>{data.revenue?.transactions?.toLocaleString()}</strong><small>Avg: {fmt(data.revenue?.avgTransaction)}</small></div>
        <div className="summary-card"><span>Products</span><strong>{data.products?.total}</strong><small className="loss">{data.products?.outOfStock} out of stock</small></div>
        <div className="summary-card"><span>Customers</span><strong>{data.customers?.total}</strong><small>Avg spend: {fmt(data.customers?.avgSpent)}</small></div>
      </div>

      <div className="grid-2">
        <div className="panel"><h2>Sales Trend (30 Days)</h2>
          <div className="chart-bars">
            {(data.salesTrend || []).map((d, i) => {
              const maxRev = Math.max(...(data.salesTrend || []).map(x => x.revenue || 1));
              const pct = ((d.revenue || 0) / maxRev) * 100;
              return (
                <div key={i} className="bar-col" title={`${d.day}: ${fmt(d.revenue)} (${d.transactions} sales)`}>
                  <div className="bar" style={{ height: `${Math.max(pct, 4)}%` }} />
                  <small>{new Date(d.day).getDate()}</small>
                </div>
              );
            })}
          </div>
        </div>
        <div className="panel"><h2>Top Cashiers (30 Days)</h2>
          <table><thead><tr><th>Cashier</th><th>Transactions</th><th>Revenue</th></tr></thead>
            <tbody>{(data.topCashiers || []).map((c, i) => (
              <tr key={i}><td>{c.name}</td><td>{c.transactions}</td><td>{fmt(c.revenue)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel"><h2>Revenue by Category</h2>
          <div className="category-chart">
            {(data.categoryBreakdown || []).map((c, i) => {
              const maxRev = Math.max(...(data.categoryBreakdown || []).map(x => x.revenue || 1));
              return (
                <div key={i} className="cat-bar-row">
                  <span className="cat-label">{c.category}</span>
                  <div className="cat-bar-track"><div className="cat-bar-fill" style={{ width: `${((c.revenue || 0) / maxRev) * 100}%` }} /></div>
                  <span className="cat-value">{fmt(c.revenue)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="panel"><h2>Stock Alerts</h2>
          <div className="table-wrap">
            <table><thead><tr><th>Product</th><th>Stock</th><th>Reorder</th></tr></thead>
              <tbody>{(data.alerts || []).map((a, i) => (
                <tr key={i} className="low-stock-row"><td>{a.name}</td><td className="low-stock">{a.stock}</td><td>{a.reorder_level}</td></tr>
              ))}</tbody>
            </table>
            {!data.alerts?.length && <p className="muted">No stock alerts.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CUSTOMER DISPLAY (Phase 16)
// ═══════════════════════════════════════════════════════════════════
function CustomerDisplayPage() {
  const { getCustomerDisplay } = useAuth();
  const [saleId, setSaleId] = useState("");
  const [sale, setSale] = useState(null);
  const [error, setError] = useState("");

  async function handleLookup(e) {
    e.preventDefault();
    if (!saleId) return;
    try {
      setSale(await getCustomerDisplay(saleId));
      setError("");
    } catch (err) { setError(err.message); setSale(null); }
  }

  const fmt = (n) => { const v = parseFloat(n) || 0; return "\u20A6" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  return (
    <div className="page-panel">
      <form onSubmit={handleLookup} className="form-grid" style={{ maxWidth: 400 }}>
        <label>Sale Receipt ID
          <input type="number" value={saleId} onChange={e => setSaleId(e.target.value)} placeholder="Enter sale ID" required />
        </label>
        <button type="submit" className="btn primary">Display Sale</button>
      </form>
      {error && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}
      {sale && (
        <div className="receipt" style={{ maxWidth: 500, marginTop: 20, padding: 24, borderRadius: 12 }}>
          <h2 style={{ textAlign: 'center' }}>RHoSAM Supermarket</h2>
          <p className="muted" style={{ textAlign: 'center' }}>Receipt: {sale.receipt_number}</p>
          <p className="muted" style={{ textAlign: 'center' }}>Cashier: {sale.cashier_name}</p>
          <p className="muted" style={{ textAlign: 'center' }}>Payment: {sale.payment_method}</p>
          <hr />
          {sale.items?.map((item, i) => (
            <div key={i} className="receipt-line">
              <span>{item.product_name} x{item.quantity}</span>
              <span>{fmt(item.line_total)}</span>
            </div>
          ))}
          <hr />
          <div className="receipt-line receipt-total"><span><strong>TOTAL</strong></span><strong>{fmt(sale.total)}</strong></div>
          <p style={{ textAlign: 'center', marginTop: 16, color: 'var(--primary)' }}>Thank you for shopping!</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SUPPLIER PORTAL (Phase 16)
// ═══════════════════════════════════════════════════════════════════
function SupplierPortalPage() {
  const { fetchSuppliers, fetchSupplierPortalOrders, getSupplierPortalOrder, confirmSupplierOrder } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [orders, setOrders] = useState([]);
  const [orderDetail, setOrderDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchSuppliers().then(setSuppliers).catch(() => {}).finally(() => setLoading(false)); }, [fetchSuppliers]);

  async function loadOrders(supplierId) {
    setSelectedSupplier(supplierId);
    setOrderDetail(null);
    try { setOrders(await fetchSupplierPortalOrders(supplierId)); }
    catch { setOrders([]); }
  }

  async function viewOrder(id) {
    try { setOrderDetail(await getSupplierPortalOrder(id)); }
    catch { setOrderDetail(null); }
  }

  async function handleConfirm(id) {
    try { await confirmSupplierOrder(id); viewOrder(id); loadOrders(selectedSupplier); }
    catch (err) { alert(err.message); }
  }

  const fmt = (n) => { const v = parseFloat(n) || 0; return "\u20A6" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const statusColor = { PENDING: "warning", APPROVED: "info", RECEIVED: "active", CANCELLED: "inactive" };

  if (loading) return <p className="loading">Loading suppliers...</p>;

  return (
    <div className="page-panel">
      <div className="panel-header"><h2>Supplier Portal</h2></div>
      <div className="tabs">
        {suppliers.map(s => (
          <button key={s.id} className={selectedSupplier === s.id ? "active" : ""} onClick={() => loadOrders(s.id)}>{s.name}</button>
        ))}
      </div>
      {!selectedSupplier && <p className="muted" style={{ marginTop: 16 }}>Select a supplier to view their orders.</p>}
      {selectedSupplier && !orderDetail && (
        <div className="table-wrap">
          <table><thead><tr><th>PO #</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>{orders.map(o => (
              <tr key={o.id}>
                <td><code>{o.po_number}</code></td>
                <td>{fmt(o.total)}</td>
                <td><span className={`status-badge ${statusColor[o.status] || ""}`}>{o.status}</span></td>
                <td>{new Date(o.created_at).toLocaleDateString()}</td>
                <td>
                  <button className="btn-sm" onClick={() => viewOrder(o.id)}>View</button>
                  {o.status === "PENDING" && <button className="btn-sm" onClick={() => handleConfirm(o.id)}>Confirm</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!orders.length && <p className="muted">No orders for this supplier.</p>}
        </div>
      )}
      {orderDetail && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-header">
            <h2>Order: {orderDetail.po_number}</h2>
            <button className="btn secondary" onClick={() => setOrderDetail(null)}>Back to Orders</button>
          </div>
          <div className="summary-grid" style={{ marginBottom: 16 }}>
            <div className="summary-card"><span>Status</span><strong><span className={`status-badge ${statusColor[orderDetail.status] || ""}`}>{orderDetail.status}</span></strong></div>
            <div className="summary-card"><span>Total</span><strong>{fmt(orderDetail.total)}</strong></div>
            <div className="summary-card"><span>Supplier</span><strong>{orderDetail.supplier_name}</strong></div>
          </div>
          <div className="table-wrap">
            <table><thead><tr><th>Product</th><th>Qty</th><th>Unit Cost</th><th>Line Total</th></tr></thead>
              <tbody>{(orderDetail.items || []).map((item, i) => (
                <tr key={i}><td>{item.product_name}</td><td>{item.quantity}</td><td>{fmt(item.unit_cost)}</td><td>{fmt(item.line_total)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DAILY REPORTS & EMAIL (Phase 15)
// ═══════════════════════════════════════════════════════════════════
function ReportsPage() {
  const { fetchDailyReport, emailDailyReport, fetchMonthlyReport, fetchProductSales, fetchLowStockReport, fetchCashierSales, fetchBranches, user } = useAuth();
  const [tab, setTab] = useState("daily");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  // Filters
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [year, setYear] = useState(new Date().getFullYear());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Branch filter (admin only)
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === "ADMIN";
  // Email
  const [emailTo, setEmailTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");

  const fmt = (n) => { const v = parseFloat(n) || 0; return "\u20A6" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  // Load branches for admin
  useEffect(() => {
    if (isAdmin) fetchBranches().then(setBranches).catch(() => {});
  }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    setLoading(true); setSendMsg("");
    try {
      const bid = selectedBranch || undefined;
      let result;
      switch (tab) {
        case "daily": result = await fetchDailyReport(date, bid); break;
        case "monthly": result = await fetchMonthlyReport(year, bid); break;
        case "products": {
          const params = {};
          if (dateFrom) params.from = dateFrom;
          if (dateTo) params.to = dateTo;
          if (bid) params.branchId = bid;
          result = await fetchProductSales(Object.keys(params).length ? params : null);
          break;
        }
        case "lowstock": result = await fetchLowStockReport(); break;
        case "cashiers": {
          const params = {};
          if (dateFrom) params.from = dateFrom;
          if (dateTo) params.to = dateTo;
          if (bid) params.branchId = bid;
          result = await fetchCashierSales(Object.keys(params).length ? params : null);
          break;
        }
      }
      setData(result);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [tab, date, year, dateFrom, dateTo, selectedBranch, fetchDailyReport, fetchMonthlyReport, fetchProductSales, fetchLowStockReport, fetchCashierSales]);

  useEffect(() => { load(); }, [load]);

  async function handleSendEmail(e) {
    e.preventDefault();
    if (!emailTo || tab !== "daily") return;
    setSending(true); setSendMsg("");
    try {
      await emailDailyReport({ date, recipientEmail: emailTo });
      setSendMsg("Report sent successfully!");
    } catch (err) { setSendMsg(`Error: ${err.message}`); }
    finally { setSending(false); }
  }

  return (
    <div className="page-panel">
      {/* Branch selector (Admin) / indicator (Manager/Cashier) */}
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select
            value={selectedBranch}
            onChange={e => setSelectedBranch(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}
          >
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Reports across all branches'}
          </span>
        </div>
      )}
      {!isAdmin && user?.branch?.name && (
        <div style={{ marginBottom: 12, padding: '8px 16px', background: 'var(--surface, var(--card-bg))', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem' }}>
          🏢 <strong>Branch:</strong> {user.branch.name} — Reports are filtered to your branch.
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button className={tab === "daily" ? "active" : ""} onClick={() => setTab("daily")}>Daily Sales</button>
        <button className={tab === "monthly" ? "active" : ""} onClick={() => setTab("monthly")}>Monthly Sales</button>
        <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>Product Sales</button>
        <button className={tab === "lowstock" ? "active" : ""} onClick={() => setTab("lowstock")}>Low Stock</button>
        <button className={tab === "cashiers" ? "active" : ""} onClick={() => setTab("cashiers")}>Cashier Sales</button>
      </div>

      {/* Filters */}
      <div className="panel-header">
        <div className="filters">
          {(tab === "daily") && (
            <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          )}
          {(tab === "monthly") && (
            <label>Year <input type="number" min="2020" max="2099" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 100 }} /></label>
          )}
          {(tab === "products" || tab === "cashiers") && (
            <>
              <label>From <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
              <label>To <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
            </>
          )}
          <button className="btn primary" onClick={load}>Refresh</button>
        </div>
      </div>

      {loading ? <p className="loading">Loading report...</p> : !data ? <div className="error-msg">Failed to load report.</div> : (
        <>
          {/* ═══ DAILY SALES ═══ */}
          {tab === "daily" && data.summary && (
            <>
              {data.branchName && <h3 style={{ marginBottom: 8, color: 'var(--primary)' }}>🏢 {data.branchName}</h3>}
              <div className="summary-grid">
                <div className="summary-card accent"><span>Transactions</span><strong>{data.summary.totalTransactions}</strong></div>
                <div className="summary-card"><span>Revenue</span><strong>{fmt(data.summary.totalRevenue)}</strong></div>
                <div className="summary-card"><span>Expenses</span><strong className="loss">{fmt(data.summary.totalExpenses)}</strong></div>
                <div className="summary-card"><span>Net Profit</span><strong className={data.summary.netProfit >= 0 ? "profit" : "loss"}>{fmt(data.summary.netProfit)}</strong></div>
                <div className="summary-card"><span>Discounts</span><strong>{fmt(data.summary.totalDiscount)}</strong></div>
                <div className="summary-card"><span>Tax</span><strong>{fmt(data.summary.totalTax)}</strong></div>
              </div>
              <div className="grid-2">
                <div className="panel">
                  <h2>Items Sold ({data.itemsSold?.length || 0})</h2>
                  <div className="table-wrap">
                    <table><thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead>
                      <tbody>{(data.itemsSold || []).map((item, i) => (
                        <tr key={i}><td>{item.product_name}</td><td>{item.qty}</td><td>{fmt(item.revenue)}</td></tr>
                      ))}</tbody>
                    </table>
                    {!data.itemsSold?.length && <p className="muted">No items sold.</p>}
                  </div>
                </div>
                <div className="panel">
                  <h2>Email Daily Report</h2>
                  <p className="muted" style={{ marginBottom: 12 }}>Send a formatted summary to any email address.</p>
                  <form onSubmit={handleSendEmail} className="form-grid">
                    <label>Recipient Email<input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="manager@example.com" required /></label>
                    <button type="submit" className="btn primary" disabled={sending || !emailTo}>{sending ? "Sending..." : "Send Report"}</button>
                  </form>
                  {sendMsg && <p className={sendMsg.startsWith("Error") ? "error-msg" : "muted"} style={{ marginTop: 8 }}>{sendMsg}</p>}
                </div>
              </div>
            </>
          )}

          {/* ═══ MONTHLY SALES ═══ */}
          {tab === "monthly" && data.data && (
            <>
              {data.branchName && <h3 style={{ marginBottom: 8, color: 'var(--primary)' }}>🏢 {data.branchName}</h3>}
              <div className="summary-grid">
                <div className="summary-card accent"><span>Total Revenue</span><strong>{fmt(data.data.reduce((s, m) => s + m.revenue, 0))}</strong></div>
                <div className="summary-card"><span>Total Transactions</span><strong>{data.data.reduce((s, m) => s + m.transactions, 0)}</strong></div>
                <div className="summary-card"><span>Avg Monthly</span><strong>{fmt(data.data.reduce((s, m) => s + m.revenue, 0) / (data.data.length || 1))}</strong></div>
              </div>
              <div className="panel"><h2>Monthly Breakdown — {data.year}</h2>
                <div className="table-wrap">
                  <table><thead><tr><th>Month</th><th>Transactions</th><th>Revenue</th><th>Discounts</th><th>Tax</th></tr></thead>
                    <tbody>{data.data.map((m, i) => (
                      <tr key={i}><td><strong>{m.month}</strong></td><td>{m.transactions}</td><td>{fmt(m.revenue)}</td><td>{fmt(m.discounts)}</td><td>{fmt(m.taxes)}</td></tr>
                    ))}</tbody>
                  </table>
                  {!data.data.length && <p className="muted">No data for this year.</p>}
                </div>
              </div>
            </>
          )}

          {/* ═══ PRODUCT SALES ═══ */}
          {tab === "products" && Array.isArray(data) && (
            <>
              <div className="summary-grid">
                <div className="summary-card accent"><span>Products Sold</span><strong>{data.length}</strong></div>
                <div className="summary-card"><span>Total Revenue</span><strong>{fmt(data.reduce((s, p) => s + p.revenue, 0))}</strong></div>
                <div className="summary-card"><span>Total Qty</span><strong>{data.reduce((s, p) => s + p.qty, 0)}</strong></div>
              </div>
              <div className="panel"><h2>Product Sales Breakdown</h2>
                <div className="table-wrap">
                  <table><thead><tr><th>Product</th><th>Category</th><th>Qty Sold</th><th>Revenue</th><th>Stock Left</th></tr></thead>
                    <tbody>{data.map((p, i) => (
                      <tr key={i}><td>{p.name}</td><td>{p.category}</td><td>{p.qty}</td><td>{fmt(p.revenue)}</td>
                        <td className={p.current_stock <= 0 ? "low-stock" : ""}>{p.current_stock}</td></tr>
                    ))}</tbody>
                  </table>
                  {!data.length && <p className="muted">No product sales data.</p>}
                </div>
              </div>
            </>
          )}

          {/* ═══ LOW STOCK ═══ */}
          {tab === "lowstock" && Array.isArray(data) && (
            <>
              <div className="summary-grid">
                <div className="summary-card warning"><span>Low Stock Items</span><strong>{data.length}</strong></div>
                <div className="summary-card"><span>Out of Stock</span><strong className="loss">{data.filter(p => p.status === 'OUT OF STOCK').length}</strong></div>
                <div className="summary-card"><span>Below Reorder</span><strong>{data.filter(p => p.status === 'LOW').length}</strong></div>
              </div>
              <div className="panel"><h2>Low Stock Products</h2>
                <div className="table-wrap">
                  <table><thead><tr><th>Barcode</th><th>Product</th><th>Category</th><th>Stock</th><th>Reorder Level</th><th>Price</th><th>Status</th></tr></thead>
                    <tbody>{data.map((p, i) => (
                      <tr key={i}><td><code>{p.barcode}</code></td><td>{p.name}</td><td>{p.category}</td>
                        <td className="low-stock">{p.stock}</td><td>{p.reorder_level}</td><td>{fmt(p.price)}</td>
                        <td><span className={`status-badge ${p.status === 'OUT OF STOCK' ? 'inactive' : 'warning'}`}>{p.status}</span></td></tr>
                    ))}</tbody>
                  </table>
                  {!data.length && <p className="muted">All products are well-stocked.</p>}
                </div>
              </div>
            </>
          )}

          {/* ═══ CASHIER SALES ═══ */}
          {tab === "cashiers" && Array.isArray(data) && (
            <>
              <div className="summary-grid">
                <div className="summary-card accent"><span>Cashiers</span><strong>{data.length}</strong></div>
                <div className="summary-card"><span>Total Revenue</span><strong>{fmt(data.reduce((s, c) => s + c.revenue, 0))}</strong></div>
                <div className="summary-card"><span>Top Cashier</span><strong>{data[0]?.cashier_name || '—'}</strong></div>
              </div>
              <div className="panel"><h2>Cashier Performance</h2>
                <div className="table-wrap">
                  <table><thead><tr><th>Cashier</th><th>Email</th><th>Transactions</th><th>Revenue</th><th>Avg Sale</th></tr></thead>
                    <tbody>{data.map((c, i) => (
                      <tr key={i}><td><strong>{c.cashier_name}</strong></td><td>{c.email}</td><td>{c.transactions}</td><td>{fmt(c.revenue)}</td><td>{fmt(c.avg_sale)}</td></tr>
                    ))}</tbody>
                  </table>
                  {!data.length && <p className="muted">No cashier sales data.</p>}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// USER MANAGEMENT (Phase 8)
// ═══════════════════════════════════════════════════════════════════
function UsersPage() {
  const { fetchUsers, createUser, updateUser, deleteUser, downloadBackup, user, fetchBranches } = useAuth();
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "CASHIER", branchId: "" });
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", password: "", role: "", branchId: "" });

  const load = useCallback(async () => {
    try {
      const [u, b] = await Promise.all([fetchUsers(), fetchBranches()]);
      setUsers(u); setBranches(b);
    } catch { }
    finally { setLoading(false); }
  }, [fetchUsers, fetchBranches]);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      const payload = { ...form, branchId: form.branchId ? Number(form.branchId) : null };
      await createUser(payload);
      setShowForm(false);
      setForm({ name: "", email: "", password: "", role: "CASHIER", branchId: "" });
      load();
    }
    catch (err) { alert(err.message); }
  }

  async function toggleActive(u) {
    try { await updateUser(u.id, { isActive: !u.is_active }); load(); }
    catch (err) { alert(err.message); }
  }

  async function unlockUser(u) {
    try { await updateUser(u.id, { unlock: true }); load(); }
    catch (err) { alert(err.message); }
  }

  async function changeRole(u, role) {
    try { await updateUser(u.id, { role }); load(); }
    catch (err) { alert(err.message); }
  }

  async function changeBranch(u, branchId) {
    try { await updateUser(u.id, { branchId: branchId ? Number(branchId) : null }); load(); }
    catch (err) { alert(err.message); }
  }

  function startEdit(u) {
    setEditUser(u);
    setEditForm({
      name: u.name,
      email: u.email,
      password: "",
      role: u.role,
      branchId: u.branch_id || "",
    });
  }

  async function handleEdit(e) {
    e.preventDefault();
    try {
      const payload = {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
        branchId: editForm.branchId ? Number(editForm.branchId) : null,
      };
      if (editForm.password) payload.password = editForm.password;
      await updateUser(editUser.id, payload);
      setEditUser(null);
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(u) {
    if (!confirm(`Delete user "${u.name}"?`)) return;
    try { await deleteUser(u.id); load(); }
    catch (err) { alert(err.message); }
  }

  return (
    <div className="page-panel">
      <div className="panel-header" style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <button className="btn primary" onClick={() => setShowForm(true)}>+ Add User</button>
        <button className="btn secondary" onClick={() => { if (confirm('Download a full JSON backup of the database?')) downloadBackup().catch(err => alert(err.message)); }}>💾 Database Backup</button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>New User</h2>
            <form onSubmit={handleCreate} className="form-grid">
              <label>Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
              <label>Email<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></label>
              <label>Password<input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required minLength={8} /></label>
              <label>Role<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="CASHIER">CASHIER</option><option value="MANAGER">MANAGER</option><option value="ADMIN">ADMIN</option>
              </select></label>
              <label>Branch
                <select value={form.branchId} onChange={e => setForm({ ...form, branchId: e.target.value })}>
                  <option value="">No Branch (All)</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Create User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Edit User: {editUser.name}</h2>
            <form onSubmit={handleEdit} className="form-grid">
              <label>Name<input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required /></label>
              <label>Email<input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} required /></label>
              <label>New Password <small className="muted" style={{ fontWeight: 400 }}>(leave blank to keep current)</small>
                <input type="password" value={editForm.password} onChange={e => setEditForm({ ...editForm, password: e.target.value })} placeholder="••••••••" minLength={8} />
              </label>
              <label>Role<select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })}>
                <option value="CASHIER">CASHIER</option><option value="MANAGER">MANAGER</option><option value="ADMIN">ADMIN</option>
              </select></label>
              <label>Branch
                <select value={editForm.branchId} onChange={e => setEditForm({ ...editForm, branchId: e.target.value })}>
                  <option value="">No Branch (All)</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setEditUser(null)}>Cancel</button>
                <button type="submit" className="btn primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th><th>Status</th><th>Failed Attempts</th><th>Locked Until</th><th>Last Login</th><th>Actions</th></tr></thead>
            <tbody>{users.map(u => (
              <tr key={u.id}>
                <td>{u.name} {u.id === user?.id && <span className="you-badge">You</span>}</td>
                <td>{u.email}</td>
                <td>
                  <select value={u.role} onChange={e => changeRole(u, e.target.value)} disabled={u.id === user?.id}>
                    <option value="CASHIER">CASHIER</option><option value="MANAGER">MANAGER</option><option value="ADMIN">ADMIN</option>
                  </select>
                </td>
                <td>
                  <select value={u.branch_id || ""} onChange={e => changeBranch(u, e.target.value)} disabled={u.id === user?.id}>
                    <option value="">No Branch</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </td>
                <td><span className={`status-badge ${u.is_active ? "active" : "inactive"}`}>{u.is_active ? "Active" : "Inactive"}</span></td>
                <td className={u.failed_login_attempts >= 3 ? "low-stock" : ""}>{u.failed_login_attempts}</td>
                <td>{u.locked_until ? new Date(u.locked_until).toLocaleString() : "—"}</td>
                <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}</td>
                <td className="actions-cell">
                  <button className="btn-sm" onClick={() => startEdit(u)}>Edit</button>
                  {u.id !== user?.id && (
                    <>
                      <button className="btn-sm" onClick={() => toggleActive(u)}>{u.is_active ? "Deactivate" : "Activate"}</button>
                      {u.locked_until && <button className="btn-sm warning" onClick={() => unlockUser(u)}>Unlock</button>}
                      <button className="btn-sm danger" onClick={() => handleDelete(u)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!users.length && <p className="muted">No users found.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AUDIT LOGS (Phase 8)
// ═══════════════════════════════════════════════════════════════════
function AuditPage() {
  const { fetchAuditLogs, user, fetchBranches } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (isAdmin) fetchBranches().then(setBranches).catch(() => {});
  }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = { limit: 50 };
    if (selectedBranch) params.branchId = selectedBranch;
    try {
      const result = await fetchAuditLogs(params);
      setLogs(result.data || []);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    }
    catch { setLogs([]); }
    finally { setLoading(false); }
  }, [fetchAuditLogs, selectedBranch]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = { limit: 50, cursor: JSON.stringify(nextCursor) };
      if (selectedBranch) params.branchId = selectedBranch;
      const result = await fetchAuditLogs(params);
      setLogs(prev => [...prev, ...(result.data || [])]);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch { }
    finally { setLoadingMore(false); }
  }

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page-panel">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select
            value={selectedBranch}
            onChange={e => { setSelectedBranch(e.target.value); }}
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}
          >
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Audit logs across all branches'}
          </span>
        </div>
      )}
      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>ID</th><th>Details</th></tr></thead>
            <tbody>{logs.map(l => (
              <tr key={l.id}>
                <td>{new Date(l.created_at).toLocaleString()}</td>
                <td>{l.user_name || "—"}</td>
                <td><span className={`action-badge ${l.action.toLowerCase().replace(/_/g, "-")}`}>{l.action}</span></td>
                <td>{l.entity_type}</td><td>{l.entity_id}</td>
                <td><code className="details-cell">{typeof l.details === "object" ? JSON.stringify(l.details) : l.details}</code></td>
              </tr>
            ))}</tbody>
          </table>
          {!logs.length && <p className="muted">No audit logs found.</p>}
          {hasMore && (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <button className="btn secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Load More (${logs.length} loaded)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CASH DRAWER
// ═══════════════════════════════════════════════════════════════════
function CashDrawerPage() {
  const { getActiveDrawer, openDrawer, closeDrawer, fetchCashDrawers, fetchBranches, user } = useAuth();
  const [activeDrawer, setActiveDrawer] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [openBal, setOpenBal] = useState(0);
  const [closeBal, setCloseBal] = useState(0);
  const [drawerName, setDrawerName] = useState("Main Drawer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const isAdmin = user?.role === 'ADMIN';

  const load = useCallback(async () => {
    try {
      const [active, hist] = await Promise.all([getActiveDrawer(), fetchCashDrawers()]);
      setActiveDrawer(active); setHistory(hist);
    } catch { }
    finally { setLoading(false); }
  }, [getActiveDrawer, fetchCashDrawers]);

  useEffect(() => {
    if (isAdmin) fetchBranches().then(setBranches).catch(() => {});
  }, [isAdmin, fetchBranches]);

  useEffect(() => { load(); }, [load]);

  async function handleOpen(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await openDrawer({ openingBalance: Number(openBal), drawerName });
      setShowOpenForm(false); load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function handleClose(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await closeDrawer({ closingBalance: Number(closeBal) });
      setShowCloseForm(false); load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const fmt = (n) => { const v = parseFloat(n) || 0; return "₦" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  if (loading) return <p className="loading">Loading…</p>;

  return (
    <div className="page-panel">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem' }}>
            <option value="">My Branch</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      {activeDrawer ? (
        <div className="summary-grid">
          <div className="summary-card accent">
            <span>Status</span>
            <strong style={{ color: "var(--success)" }}>🟢 OPEN</strong>
            <small>{activeDrawer.drawer_name}</small>
          </div>
          <div className="summary-card">
            <span>Opening Balance</span>
            <strong>{fmt(activeDrawer.opening_balance)}</strong>
          </div>
          <div className="summary-card">
            <span>Opened By</span>
            <strong>{activeDrawer.opened_by_name}</strong>
            <small>{new Date(activeDrawer.opened_at).toLocaleString()}</small>
          </div>
          <div className="summary-card">
            <span>Opened At</span>
            <strong>{new Date(activeDrawer.opened_at).toLocaleString()}</strong>
          </div>
        </div>
      ) : (
        <div className="summary-grid">
          <div className="summary-card">
            <span>Status</span>
            <strong style={{ color: "var(--muted)" }}>🔴 No Active Drawer</strong>
          </div>
        </div>
      )}

      {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="panel-header">
        <h2>Cash Drawer</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {!activeDrawer && <button className="btn primary" onClick={() => { setShowOpenForm(true); setShowCloseForm(false); }}>💵 Open Drawer</button>}
          {activeDrawer && <button className="btn danger" style={{ background: "var(--danger)" }} onClick={() => { setShowCloseForm(true); setShowOpenForm(false); }}>🔒 Close Drawer</button>}
        </div>
      </div>

      {showOpenForm && (
        <div className="modal-overlay" onClick={() => setShowOpenForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Open Cash Drawer</h2>
            <form onSubmit={handleOpen} className="form-grid">
              <label>Drawer Name<input value={drawerName} onChange={e => setDrawerName(e.target.value)} required /></label>
              <label>Opening Balance (₦)<input type="number" min="0" step="0.01" value={openBal} onChange={e => setOpenBal(e.target.value)} required /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowOpenForm(false)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={busy}>{busy ? "Opening…" : "Open Drawer"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCloseForm && (
        <div className="modal-overlay" onClick={() => setShowCloseForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Close Cash Drawer</h2>
            <form onSubmit={handleClose} className="form-grid">
              <label>Closing Balance (₦)<input type="number" min="0" step="0.01" value={closeBal} onChange={e => setCloseBal(e.target.value)} required /></label>
              <p className="muted">The system will compare your closing balance against expected total.</p>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowCloseForm(false)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={busy} style={{ background: "var(--danger)" }}>{busy ? "Closing…" : "Close Drawer"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Drawer History</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Drawer</th><th>Opened</th><th>Closed</th><th>Opening Bal</th><th>Closing Bal</th><th>Expected</th><th>Variance</th><th>Opened By</th><th>Closed By</th></tr></thead>
            <tbody>{history.map(d => (
              <tr key={d.id}>
                <td>{d.drawer_name}</td>
                <td>{new Date(d.opened_at).toLocaleString()}</td>
                <td>{d.closed_at ? new Date(d.closed_at).toLocaleString() : <span className="status-badge active">OPEN</span>}</td>
                <td>{fmt(d.opening_balance)}</td>
                <td>{d.closing_balance != null ? fmt(d.closing_balance) : "—"}</td>
                <td>{d.expected_balance != null ? fmt(d.expected_balance) : "—"}</td>
                <td className={d.variance > 0 ? "profit" : d.variance < 0 ? "loss" : ""}>
                  {d.variance != null ? fmt(d.variance) : "—"}
                </td>
                <td>{d.opened_by_name || "—"}</td>
                <td>{d.closed_by_name || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          {!history.length && <p className="muted">No drawer history yet.</p>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════════════
function CategoriesPage() {
  const { fetchCategories, createCategory, updateCategory, deleteCategory, user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newCat, setNewCat] = useState("");
  const [editCat, setEditCat] = useState(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = ["ADMIN", "MANAGER"].includes(user?.role);
  const isAdminOnly = user?.role === "ADMIN";

  const load = useCallback(async () => {
    try {
      const result = await fetchCategories();
      setCategories(Array.isArray(result) ? result : []);
    } catch (err) {
      setCategories([]);
      if (err.message && !err.message.includes('404')) setError(err.message);
    }
    finally { setLoading(false); }
  }, [fetchCategories]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newCat.trim()) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await createCategory({ name: newCat.trim() });
      setSuccess(`Category "${newCat.trim()}" created!`);
      setNewCat("");
      load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function handleEdit(e) {
    e.preventDefault();
    if (!editName.trim() || !editCat) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await updateCategory(editCat, { name: editName.trim() });
      setSuccess(`Category renamed to "${editName.trim()}"!`);
      setEditCat(null); setEditName("");
      load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function handleDelete(name) {
    if (!confirm(`Delete category "${name}"? This will remove any placeholder products.`)) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const result = await deleteCategory(name);
      setSuccess(result.message || `Category "${name}" deleted.`);
      load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="page-panel">
      <div className="panel">
        <h2 style={{ marginBottom: 8 }}>📦 Manage Categories</h2>
        <p className="muted" style={{ marginBottom: 16 }}>Categories are derived from products. Create a new category to make it available when adding products.</p>

        {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
        {success && <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: 12, fontWeight: 600 }}>{success}</div>}

        {isAdmin && (
          <form onSubmit={handleCreate} style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={newCat}
              onChange={e => setNewCat(e.target.value)}
              placeholder="Enter new category name…"
              className="search-input"
              style={{ flex: 1, minWidth: 200 }}
              required
            />
            <button type="submit" className="btn primary" disabled={busy || !newCat.trim()}>
              {busy ? 'Creating…' : '+ Add Category'}
            </button>
          </form>
        )}

        {loading ? <p className="loading">Loading…</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category Name</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {categories.map(cat => (
                  <tr key={cat}>
                    {editCat === cat ? (
                      <td colSpan={isAdmin ? 2 : 1}>
                        <form onSubmit={handleEdit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            type="text"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            className="search-input"
                            style={{ flex: 1, maxWidth: 300, padding: '6px 10px', fontSize: '0.88rem' }}
                            required
                            autoFocus
                          />
                          <button type="submit" className="btn primary" style={{ padding: '6px 14px', fontSize: '0.82rem' }} disabled={busy || !editName.trim()}>Save</button>
                          <button type="button" className="btn secondary" style={{ padding: '6px 14px', fontSize: '0.82rem' }} onClick={() => { setEditCat(null); setEditName(""); }}>Cancel</button>
                        </form>
                      </td>
                    ) : (
                      <>
                        <td><strong style={{ fontSize: '0.95rem' }}>{cat}</strong></td>
                        {isAdmin && (
                          <td style={{ display: 'flex', gap: 6 }}>
                            {isAdminOnly && <button className="btn-sm" onClick={() => { setEditCat(cat); setEditName(cat); setError(""); setSuccess(""); }}>Edit</button>}
                            <button className="btn-sm danger" onClick={() => handleDelete(cat)} disabled={busy}>Delete</button>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!categories.length && <p className="muted">No categories found. Create one above.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BRANCHES (Phase 14)
// ═══════════════════════════════════════════════════════════════════
function BranchesPage() {
  const { fetchBranches, createBranch, updateBranch, deleteBranch } = useAuth();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editBranch, setEditBranch] = useState(null);
  const [form, setForm] = useState({ name: "", address: "", phone: "" });

  const load = useCallback(async () => { try { setBranches(await fetchBranches()); } catch { } finally { setLoading(false); } }, [fetchBranches]);
  useEffect(() => { load(); }, [load]);

  function startEdit(b) { setEditBranch(b); setForm({ name: b.name, address: b.address || "", phone: b.phone || "" }); setShowForm(true); }
  function startNew() { setEditBranch(null); setForm({ name: "", address: "", phone: "" }); setShowForm(true); }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editBranch) await updateBranch(editBranch.id, form);
      else await createBranch(form);
      setShowForm(false); load();
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete branch "${name}"?`)) return;
    try { await deleteBranch(id); load(); } catch (err) { alert(err.message); }
  }

  async function toggleActive(branch) {
    try {
      await updateBranch(branch.id, { isActive: !branch.is_active });
      load();
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="page-panel">
      <div className="panel-header"><button className="btn primary" onClick={startNew}>+ Add Branch</button></div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editBranch ? "Edit Branch" : "New Branch"}</h2>
            <form onSubmit={handleSubmit} className="form-grid">
              <label>Branch Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
              <label>Address<textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} /></label>
              <label>Phone<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">{editBranch ? "Update" : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Address</th><th>Phone</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>{branches.map(b => (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td>{b.address || "—"}</td>
                <td>{b.phone || "—"}</td>
                <td><span className={`status-badge ${b.is_active ? "active" : "inactive"}`}>{b.is_active ? "Active" : "Inactive"}</span></td>
                <td>{new Date(b.created_at).toLocaleDateString()}</td>
                <td>
                  <button className="btn-sm" onClick={() => startEdit(b)}>Edit</button>
                  <button className="btn-sm" onClick={() => toggleActive(b)} style={{ color: b.is_active ? 'var(--warning, #f59e0b)' : 'var(--primary, #16a34a)' }}>{b.is_active ? 'Deactivate' : 'Activate'}</button>
                  <button className="btn-sm danger" onClick={() => handleDelete(b.id, b.name)}>Delete</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!branches.length && <p className="muted">No branches yet.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INTER-BRANCH MESSAGING
// ═══════════════════════════════════════════════════════════════════
function MessagesPage() {
  const { fetchMessages, sendMessage, markMessageRead, deleteMessage, fetchBranches, user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [box, setBox] = useState("inbox");
  const [showCompose, setShowCompose] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState(null);
  const [form, setForm] = useState({ toBranchId: "", subject: "", body: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, b] = await Promise.all([fetchMessages(box), fetchBranches()]);
      setMessages(m); setBranches(b);
    } catch { }
    finally { setLoading(false); }
  }, [fetchMessages, fetchBranches, box]);

  useEffect(() => { load(); }, [load]);

  async function handleSend(e) {
    e.preventDefault();
    try {
      await sendMessage({ toBranchId: Number(form.toBranchId), subject: form.subject, body: form.body });
      setShowCompose(false);
      setForm({ toBranchId: "", subject: "", body: "" });
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleRead(msg) {
    setSelectedMsg(msg);
    if (!msg.is_read && box === "inbox") {
      try { await markMessageRead(msg.id); load(); } catch { }
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this message?")) return;
    try { await deleteMessage(id); setSelectedMsg(null); load(); } catch (err) { alert(err.message); }
  }

  const unreadCount = messages.filter(m => !m.is_read && box === "inbox").length;
  const otherBranches = branches.filter(b => b.id !== user?.branchId);

  return (
    <div className="page-panel">
      <div className="panel-header" style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" onClick={() => { setShowCompose(true); setSelectedMsg(null); }}>✉️ Compose</button>
        <button className="btn secondary" onClick={load}>🔄 Refresh</button>
      </div>

      <div className="tabs">
        <button className={box === "inbox" ? "active" : ""} onClick={() => { setBox("inbox"); setSelectedMsg(null); }}>
          📥 Inbox {unreadCount > 0 && <span style={{ background: 'var(--danger)', color: 'white', borderRadius: 999, padding: '2px 8px', fontSize: '0.75rem', marginLeft: 4 }}>{unreadCount}</span>}
        </button>
        <button className={box === "sent" ? "active" : ""} onClick={() => { setBox("sent"); setSelectedMsg(null); }}>📤 Sent</button>
      </div>

      {showCompose && (
        <div className="modal-overlay" onClick={() => setShowCompose(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>✉️ Compose Message</h2>
            <form onSubmit={handleSend} className="form-grid">
              <label>To Branch
                <select value={form.toBranchId} onChange={e => setForm({ ...form, toBranchId: e.target.value })} required>
                  <option value="">Select branch…</option>
                  {otherBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <label>Subject<input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} required maxLength={200} /></label>
              <label>Message<textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={5} required /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowCompose(false)}>Cancel</button>
                <button type="submit" className="btn primary">Send</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedMsg && (
        <div className="modal-overlay" onClick={() => setSelectedMsg(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>{selectedMsg.subject}</h2>
              <button className="btn-close" onClick={() => setSelectedMsg(null)}>✕</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <p className="muted"><strong>From:</strong> {selectedMsg.from_branch_name} ({selectedMsg.from_user_name})</p>
              <p className="muted"><strong>To:</strong> {selectedMsg.to_branch_name}</p>
              <p className="muted"><strong>Date:</strong> {new Date(selectedMsg.created_at).toLocaleString()}</p>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', padding: 16, background: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              {selectedMsg.body}
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="btn danger" onClick={() => handleDelete(selectedMsg.id)}>🗑️ Delete</button>
            </div>
          </div>
        </div>
      )}

      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>From</th><th>To</th><th>Subject</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>{messages.map(m => (
              <tr key={m.id} onClick={() => handleRead(m)} style={{ cursor: 'pointer', fontWeight: !m.is_read && box === "inbox" ? 700 : 400 }}>
                <td>{m.from_branch_name}</td>
                <td>{m.to_branch_name}</td>
                <td>{m.subject}</td>
                <td>{new Date(m.created_at).toLocaleDateString()}</td>
                <td>{!m.is_read && box === "inbox" ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>● Unread</span> : <span className="muted">Read</span>}</td>
              </tr>
            ))}</tbody>
          </table>
          {!messages.length && <p className="muted">No messages {box === "inbox" ? "received" : "sent"}.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INTER-BRANCH STOCK TRANSFERS
// ═══════════════════════════════════════════════════════════════════
function StockTransfersPage() {
  const { fetchStockTransfers, createStockTransfer, updateTransferStatus, fetchBranches, fetchProducts, user } = useAuth();
  const [transfers, setTransfers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [box, setBox] = useState("incoming");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ toBranchId: "", productId: "", quantity: "", notes: "" });
  const [detail, setDetail] = useState(null);
  const [sourceProducts, setSourceProducts] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, b, p] = await Promise.all([fetchStockTransfers(box), fetchBranches(), fetchProducts(undefined, user?.branchId)]);
      setTransfers(t); setBranches(b); setProducts(p);
    } catch { }
    finally { setLoading(false); }
  }, [fetchStockTransfers, fetchBranches, fetchProducts, box, user]);

  useEffect(() => { load(); }, [load]);

  // Fetch products from source branch when selected
  useEffect(() => {
    if (form.toBranchId) {
      fetchProducts(undefined, Number(form.toBranchId)).then(setSourceProducts).catch(() => setSourceProducts([]));
    } else {
      setSourceProducts([]);
    }
  }, [form.toBranchId, fetchProducts]);

  // Use source products when a branch is selected, otherwise fall back to own branch products
  const formProducts = form.toBranchId ? sourceProducts : products;

  async function handleRequest(e) {
    e.preventDefault();
    try {
      await createStockTransfer({
        toBranchId: Number(form.toBranchId),
        productId: Number(form.productId),
        quantity: Number(form.quantity),
        notes: form.notes,
      });
      setShowForm(false);
      setForm({ toBranchId: "", productId: "", quantity: "", notes: "" });
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleAction(id, status, rejectionReason) {
    try {
      await updateTransferStatus(id, { status, rejectionReason });
      setDetail(null);
      load();
    } catch (err) { alert(err.message); }
  }

  const statusColor = { PENDING: "warning", APPROVED: "info", COMPLETED: "active", REJECTED: "inactive", CANCELLED: "inactive" };
  const otherBranches = branches.filter(b => b.id !== user?.branchId);
  const selectedProduct = formProducts.find(p => p.id === Number(form.productId));

  return (
    <div className="page-panel">
      <div className="panel-header" style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" onClick={() => { setShowForm(true); setDetail(null); }}>📦 Request Transfer</button>
        <button className="btn secondary" onClick={load}>🔄 Refresh</button>
      </div>

      <div className="tabs">
        <button className={box === "incoming" ? "active" : ""} onClick={() => { setBox("incoming"); setDetail(null); }}>📥 Incoming ({transfers.length})</button>
        <button className={box === "outgoing" ? "active" : ""} onClick={() => { setBox("outgoing"); setDetail(null); }}>📤 Outgoing</button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>📦 Request Stock Transfer</h2>
            <form onSubmit={handleRequest} className="form-grid">
              <label>To Branch
                <select value={form.toBranchId} onChange={e => setForm({ ...form, toBranchId: e.target.value })} required>
                  <option value="">Select branch to request from…</option>
                  {otherBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <label>Product
                <select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })} required>
                  <option value="">{form.toBranchId ? 'Select product from source branch…' : 'Select product…'}</option>
                  {formProducts.filter(p => p.stock > 0).map(p => <option key={p.id} value={p.id}>{p.name} ({p.barcode}) — {p.stock} in stock</option>)}
                </select>
              </label>
              <label>Quantity
                <input type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required />
                {selectedProduct && <small className="muted">Available: {selectedProduct.stock} at {form.toBranchId ? 'source branch' : 'your branch'}</small>}
              </label>
              <label>Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Reason for transfer…" /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Request</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Transfer #{detail.id}</h2>
              <button className="btn-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div className="sale-detail">
              <p><strong>Product:</strong> {detail.product_name} ({detail.barcode})</p>
              <p><strong>From:</strong> {detail.from_branch_name}</p>
              <p><strong>To:</strong> {detail.to_branch_name}</p>
              <p><strong>Quantity:</strong> {detail.quantity}</p>
              <p><strong>Requested by:</strong> {detail.requested_by_name}</p>
              <p><strong>Date:</strong> {new Date(detail.created_at).toLocaleString()}</p>
              <p><strong>Status:</strong> <span className={`status-badge ${statusColor[detail.status]}`}>{detail.status}</span></p>
              {detail.notes && <p><strong>Notes:</strong> {detail.notes}</p>}
              {detail.rejection_reason && <p><strong>Rejection Reason:</strong> {detail.rejection_reason}</p>}

              {/* Action buttons for incoming transfers (source branch approves) */}
              {box === "incoming" && detail.status === "PENDING" && detail.from_branch_id === user?.branchId && (
                <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                  <button className="btn primary" onClick={() => handleAction(detail.id, "APPROVED")}>✅ Approve</button>
                  <button className="btn danger" onClick={() => {
                    const reason = prompt("Rejection reason:");
                    if (reason !== null) handleAction(detail.id, "REJECTED", reason);
                  }}>❌ Reject</button>
                </div>
              )}

              {/* Complete button after approval */}
              {box === "incoming" && detail.status === "APPROVED" && detail.from_branch_id === user?.branchId && (
                <div style={{ marginTop: 16 }}>
                  <button className="btn primary" onClick={() => handleAction(detail.id, "COMPLETED")}>📦 Mark as Completed (Stock Moved)</button>
                </div>
              )}

              {/* Cancel button for pending transfers */}
              {detail.status === "PENDING" && (
                <div style={{ marginTop: 16 }}>
                  <button className="btn danger" onClick={() => handleAction(detail.id, "CANCELLED")}>Cancel Request</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Product</th><th>{box === "incoming" ? "From" : "To"}</th><th>Qty</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>{transfers.map(t => (
              <tr key={t.id}>
                <td>{t.id}</td>
                <td>{t.product_name}</td>
                <td>{box === "incoming" ? t.from_branch_name : t.to_branch_name}</td>
                <td>{t.quantity}</td>
                <td><span className={`status-badge ${statusColor[t.status]}`}>{t.status}</span></td>
                <td>{new Date(t.created_at).toLocaleDateString()}</td>
                <td><button className="btn-sm" onClick={() => setDetail(t)}>View</button></td>
              </tr>
            ))}</tbody>
          </table>
          {!transfers.length && <p className="muted">No {box} transfers.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN HISTORY
// ═══════════════════════════════════════════════════════════════════
function LoginHistoryPage() {
  const { fetchLoginHistory, fetchUsers } = useAuth();
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userFilter, setUserFilter] = useState("");
  const [limit, setLimit] = useState(100);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit };
      if (userFilter) params.user_id = userFilter;
      const [l, u] = await Promise.all([fetchLoginHistory(params), fetchUsers()]);
      setLogs(l); setUsers(u);
    } catch { }
    finally { setLoading(false); }
  }, [fetchLoginHistory, fetchUsers, userFilter, limit]);

  useEffect(() => { load(); }, [load]);

  function parseUA(ua) {
    if (!ua) return { device: "Unknown", browser: "—", os: "—" };
    const browser = ua.includes("Firefox") ? "Firefox"
      : ua.includes("Edg") ? "Edge"
      : ua.includes("Chrome") ? "Chrome"
      : ua.includes("Safari") ? "Safari"
      : ua.includes("Opera") ? "Opera"
      : "Other";
    const os = ua.includes("Windows") ? "Windows"
      : ua.includes("Mac OS") ? "macOS"
      : ua.includes("Linux") ? "Linux"
      : ua.includes("Android") ? "Android"
      : ua.includes("iPhone") || ua.includes("iPad") ? "iOS"
      : "Other";
    const device = ua.includes("Mobile") || ua.includes("Android") ? "📱 Mobile" : "💻 Desktop";
    return { device, browser, os };
  }

  const actionColor = {
    LOGIN: "active",
    FORGOT_PASSWORD: "warning",
    RESET_PASSWORD: "info",
    CHANGE_PASSWORD: "info",
    MFA_ENABLED: "active",
    MFA_DISABLED: "inactive",
  };

  const actionLabel = {
    LOGIN: "🟢 Login",
    FORGOT_PASSWORD: "🔑 Forgot Password",
    RESET_PASSWORD: "🔓 Password Reset",
    CHANGE_PASSWORD: "🔐 Password Changed",
    MFA_ENABLED: "🛡️ MFA Enabled",
    MFA_DISABLED: "⚠️ MFA Disabled",
  };

  return (
    <div className="page-panel">
      <div className="panel-header">
        <div className="filters">
          <label>User
            <select value={userFilter} onChange={e => setUserFilter(e.target.value)}>
              <option value="">All Users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
          </label>
          <label>Limit
            <select value={limit} onChange={e => setLimit(Number(e.target.value))}>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </label>
        </div>
      </div>

      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>IP Address</th><th>Device</th><th>Browser</th><th>OS</th><th>Details</th></tr></thead>
            <tbody>{logs.map(l => {
              const ua = parseUA(l.user_agent);
              return (
                <tr key={l.id}>
                  <td>{new Date(l.created_at).toLocaleString()}</td>
                  <td>
                    <strong>{l.user_name || "—"}</strong><br />
                    <small className="muted">{l.email || ""}</small>
                  </td>
                  <td><span className={`action-badge ${actionColor[l.action] || ""}`}>{actionLabel[l.action] || l.action}</span></td>
                  <td><code>{l.ip_address || "—"}</code></td>
                  <td>{ua.device}</td>
                  <td>{ua.browser}</td>
                  <td>{ua.os}</td>
                  <td><code className="details-cell" title={typeof l.details === 'object' ? JSON.stringify(l.details) : l.details}>{typeof l.details === 'object' ? JSON.stringify(l.details) : (l.details || '—')}</code></td>
                </tr>
              );
            })}</tbody>
          </table>
          {!logs.length && <p className="muted">No login history found.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CHANGE PASSWORD
// ═══════════════════════════════════════════════════════════════════
function ChangePasswordPage() {
  const { changePassword, user } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault(); setError(""); setMsg("");
    if (newPwd !== confirm) { setError("Passwords do not match."); return; }
    if (newPwd.length < 12) { setError("Password must be at least 12 characters."); return; }
    setBusy(true);
    try {
      await changePassword(current, newPwd);
      setMsg("Password changed successfully!");
      setCurrent(""); setNewPwd(""); setConfirm("");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="page-panel" style={{ maxWidth: 480 }}>
      <div className="panel"><h2>🔐 Change Password</h2>
        <p className="muted" style={{ marginBottom: 16 }}>Update your account password. Must be at least 12 characters.</p>
        {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
        {msg && <div className="muted" style={{ marginBottom: 12, color: "var(--success)" }}>{msg}</div>}
        <form onSubmit={handleSubmit} className="form-grid">
          <label>Current Password<input type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password" /></label>
          <label>New Password<input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} required minLength={12} autoComplete="new-password" /></label>
          <label>Confirm New Password<input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={12} autoComplete="new-password" /></label>
          <div className="form-actions">
            <button type="button" className="btn secondary" onClick={() => navigate(-1)}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Changing…" : "Change Password"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FORGOT PASSWORD
// ═══════════════════════════════════════════════════════════════════
function ForgotPasswordPage() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault(); setError(""); setMsg(""); setBusy(true);
    try {
      const result = await forgotPassword(email);
      setMsg(result.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>🔐 Forgot Password</h1>
        <p className="auth-subtitle">Enter your email to receive a reset link</p>
        {error && <div className="auth-error">{error}</div>}
        {msg && <div className="muted" style={{ color: "var(--success)", marginBottom: 12 }}>{msg}</div>}
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></label>
        <button type="submit" className="auth-button" disabled={busy}>{busy ? "Sending…" : "Send Reset Link"}</button>
        <p style={{ textAlign: "center", marginTop: 16 }}><a href="/login">← Back to Login</a></p>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RESET PASSWORD (from email link)
// ═══════════════════════════════════════════════════════════════════
function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  const token = searchParams.get("token") || "";
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  if (!token) return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>🔐 Reset Password</h1>
        <div className="error-msg">Invalid or missing reset token. Please request a new link.</div>
        <p style={{ textAlign: "center", marginTop: 16 }}><a href="/forgot-password">Request new link</a></p>
      </div>
    </div>
  );

  async function handleSubmit(e) {
    e.preventDefault(); setError(""); setMsg("");
    if (newPwd !== confirm) { setError("Passwords do not match."); return; }
    if (newPwd.length < 12) { setError("Password must be at least 12 characters."); return; }
    setBusy(true);
    try {
      await resetPassword(token, newPwd);
      setMsg("Password reset successfully! Redirecting to login…");
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>🔐 Reset Password</h1>
        <p className="auth-subtitle">Enter your new password below</p>
        {error && <div className="auth-error">{error}</div>}
        {msg && <div className="muted" style={{ color: "var(--success)", marginBottom: 12 }}>{msg}</div>}
        <label>New Password<input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} required minLength={12} autoComplete="new-password" /></label>
        <label>Confirm Password<input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={12} autoComplete="new-password" /></label>
        <button type="submit" className="auth-button" disabled={busy}>{busy ? "Resetting…" : "Reset Password"}</button>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MFA SETUP
// ═══════════════════════════════════════════════════════════════════
function MfaSetupPage() {
  const { setupMfa, verifyMfa, disableMfa, getMfaStatus, emailMfaBackup, user } = useAuth();
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [setupData, setSetupData] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("rhosam-theme") === "dark");
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [tab, setTab] = useState("status");

  useEffect(() => {
    getMfaStatus().then(d => { setMfaEnabled(d.mfaEnabled); setLoading(false); }).catch(() => setLoading(false));
  }, [getMfaStatus]);

  // Watch for dark mode changes via MutationObserver
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDarkMode(document.body.classList.contains("dark"));
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Generate QR code when setupData or darkMode changes
  useEffect(() => {
    if (setupData?.otpauthUrl) {
      const colors = darkMode
        ? { dark: '#f1f5f9', light: '#1e293b' }   // Light QR on dark background
        : { dark: '#172033', light: '#ffffff' };    // Dark QR on light background
      QRCode.toDataURL(setupData.otpauthUrl, {
        width: 240,
        margin: 2,
        color: colors,
        errorCorrectionLevel: 'M',
      }).then(setQrDataUrl).catch(() => setQrDataUrl(null));
    }
  }, [setupData, darkMode]);

  async function handleSetup() {
    setBusy(true); setError(""); setQrDataUrl(null);
    try {
      const data = await setupMfa();
      setSetupData(data);
      setTab("verify");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function handleVerify(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await verifyMfa(code);
      setMfaEnabled(true); setSetupData(null); setCode("");
      setMsg("MFA activated successfully!"); setTab("status");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function handleDisable(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await disableMfa(disablePassword);
      setMfaEnabled(false); setDisablePassword("");
      setMsg("MFA disabled."); setTab("status");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function handleEmailBackup() {
    if (!setupData) return;
    setEmailBusy(true); setEmailMsg("");
    try {
      const result = await emailMfaBackup({ secret: setupData.secret, backupCodes: setupData.backupCodes });
      setEmailMsg(result.message);
    } catch (err) { setEmailMsg(`Error: ${err.message}`); }
    finally { setEmailBusy(false); }
  }

  if (loading) return <p className="loading">Loading…</p>;

  return (
    <div className="page-panel" style={{ maxWidth: 560 }}>
      <div className="tabs">
        <button className={tab === "status" ? "active" : ""} onClick={() => { setTab("status"); setError(""); setMsg(""); }}>Status</button>
        {!mfaEnabled && <button className={tab === "verify" ? "active" : ""} onClick={() => setTab("verify")}>Setup</button>}
        {mfaEnabled && <button className={tab === "disable" ? "active" : ""} onClick={() => setTab("disable")}>Disable</button>}
      </div>

      {error && <div className="error-msg" style={{ margin: '12px 0' }}>{error}</div>}
      {msg && <div className="muted" style={{ margin: '12px 0', color: 'var(--success)' }}>{msg}</div>}

      {tab === "status" && (
        <div className="panel">
          <h2>Multi-Factor Authentication</h2>
          <div className="summary-grid" style={{ marginTop: 12 }}>
            <div className="summary-card">
              <span>Status</span>
              <strong style={{ color: mfaEnabled ? 'var(--success)' : 'var(--muted)' }}>
                {mfaEnabled ? '🟢 Enabled' : '⚪ Disabled'}
              </strong>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            MFA adds an extra layer of security. When enabled, you'll need to enter a 6-digit code from your authenticator app each time you sign in.
          </p>
          {!mfaEnabled && <button className="btn primary" style={{ marginTop: 16 }} onClick={handleSetup} disabled={busy}>Enable MFA</button>}
        </div>
      )}

      {tab === "verify" && setupData && (
        <div className="panel">
          <h2>Setup Authenticator</h2>
          <p className="muted" style={{ marginBottom: 16 }}>Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):</p>
          <div style={{ textAlign: 'center', margin: '16px 0' }}>
            {qrDataUrl ? (
              <>
                <img src={qrDataUrl} alt="MFA QR Code" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: darkMode ? '#1e293b' : 'white', transition: 'background 0.3s' }} />
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="btn secondary" onClick={() => {
                    const a = document.createElement('a');
                    a.href = qrDataUrl;
                    a.download = `rhosam-mfa-qr-${user?.email || 'code'}.png`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                  }}>📥 Download QR Code</button>
                </div>
              </>
            ) : (
              <div style={{ width: 240, height: 240, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--border)', borderRadius: 12 }}>
                <div className="spinner" />
              </div>
            )}
          </div>
          <details style={{ marginTop: 12 }}>
            <summary className="muted" style={{ cursor: 'pointer', fontSize: '0.85rem' }}>Can't scan? Enter secret manually</summary>              <div style={{ background: 'var(--border)', padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: '0.9rem', wordBreak: 'break-all', margin: '8px 0' }}>
              {setupData.secret}
            </div>
          </details>
          <p className="muted" style={{ marginTop: 16 }}>Enter the 6-digit code from your app to verify:</p>
          <form onSubmit={handleVerify} style={{ marginTop: 12 }}>
            <label>Verification Code
              <input type="text" value={code} onChange={e => setCode(e.target.value)} placeholder="000000" maxLength={8} required autoFocus style={{ fontFamily: 'monospace', fontSize: '1.2rem', letterSpacing: '0.3em', textAlign: 'center', width: 200 }} />
            </label>
            <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Verifying…" : "Verify & Activate"}</button>
          </form>
          {setupData.backupCodes?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p className="muted"><strong>Backup Codes (save these!):</strong></p>
              <div style={{ background: 'var(--border)', padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                {setupData.backupCodes.map((c, i) => <div key={i}>{c}</div>)}
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" className="btn secondary" onClick={() => window.print()}>🖨️ Print</button>
                <button type="button" className="btn secondary" onClick={handleEmailBackup} disabled={emailBusy}>{emailBusy ? "Sending…" : "📧 Email Backup"}</button>
              </div>
              {emailMsg && <p className={emailMsg.startsWith('Error') ? 'error-msg' : 'muted'} style={{ marginTop: 8, fontSize: '0.85rem' }}>{emailMsg}</p>}
            </div>
          )}
        </div>
      )}

      {/* ── Print-only backup sheet ─────────────────────────────── */}
      {tab === "verify" && setupData && (
        <div className="mfa-backup-sheet" style={{ display: 'none' }}>
          <style>{`
            @media print {
              .mfa-backup-sheet { display: block !important; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: white; z-index: 99999; padding: 40px; font-family: Arial, sans-serif; color: #111; }
              .mfa-backup-sheet * { visibility: visible !important; }
              .mfa-backup-sheet h1 { font-size: 24px; margin: 0 0 4px; }
              .mfa-backup-sheet h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 2px solid #111; padding-bottom: 4px; }
              .mfa-backup-sheet .backup-qr { text-align: center; margin: 16px 0; }
              .mfa-backup-sheet .backup-qr img { width: 200px; height: 200px; border: 1px solid #ccc; }
              .mfa-backup-sheet .secret-box { background: #f5f5f5; border: 1px solid #ccc; padding: 12px; font-family: monospace; font-size: 14px; word-break: break-all; margin: 8px 0; border-radius: 4px; }
              .mfa-backup-sheet .codes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }
              .mfa-backup-sheet .code-item { background: #f5f5f5; border: 1px solid #ccc; padding: 8px 12px; font-family: monospace; font-size: 14px; border-radius: 4px; }
              .mfa-backup-sheet .warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 12px; border-radius: 4px; margin: 16px 0; font-size: 13px; }
              .mfa-backup-sheet .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 11px; color: #666; text-align: center; }
              .mfa-backup-sheet .instructions { font-size: 13px; line-height: 1.6; margin: 8px 0; }
              .mfa-backup-sheet .instructions li { margin: 4px 0; }
            }
          `}</style>
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1>🛍️ RHoSAM Supermarket</h1>
                <p style={{ margin: 0, color: '#666', fontSize: 14 }}>Multi-Factor Authentication — Backup Sheet</p>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: '#666' }}>
                <div>User: {user?.name || '—'}</div>
                <div>Email: {user?.email || '—'}</div>
                <div>Date: {new Date().toLocaleDateString('en-NG', { dateStyle: 'long' })}</div>
              </div>
            </div>

            <h2>📱 QR Code</h2>
            <p className="instructions">Scan this code with your authenticator app (Google Authenticator, Authy, Microsoft Authenticator):</p>
            <div className="backup-qr">
              {qrDataUrl && <img src={qrDataUrl} alt="MFA QR Code" />}
            </div>

            <h2>🔑 Secret Key</h2>
            <p className="instructions">If you can't scan the QR code, enter this secret key manually in your authenticator app:</p>
            <div className="secret-box">{setupData.secret}</div>

            <h2>🔐 Backup Codes</h2>
            <p className="instructions">Use these codes to log in if you lose access to your authenticator app. Each code can only be used once.</p>
            <div className="codes-grid">
              {setupData.backupCodes.map((c, i) => (
                <div key={i} className="code-item">{i + 1}. {c}</div>
              ))}
            </div>

            <div className="warning">
              <strong>⚠️ Important:</strong> Store this sheet in a safe place (e.g., a locked drawer or safe). Do not share it with anyone. Each backup code can only be used once.
            </div>

            <h2>📋 Instructions</h2>
            <ol className="instructions">
              <li>Download an authenticator app: <strong>Google Authenticator</strong> (iOS/Android) or <strong>Authy</strong> (iOS/Android/Desktop)</li>
              <li>Open the app and tap <strong>+</strong> or <strong>Add Account</strong></li>
              <li>Choose <strong>Scan QR Code</strong> and scan the code above, or choose <strong>Enter Manually</strong> and type the secret key</li>
              <li>The app will generate a 6-digit code every 30 seconds — enter it on the setup screen to activate MFA</li>
              <li>Save this backup sheet in a secure location</li>
            </ol>

            <div className="footer">
              RHoSAM Supermarket POS — MFA Backup Sheet — Generated {new Date().toLocaleString('en-NG')}
              <br />Keep this document confidential. Destroy after MFA is disabled.
            </div>
          </div>
        </div>
      )}

      {tab === "disable" && (
        <div className="panel">
          <h2>Disable MFA</h2>
          <p className="muted">Enter your password to confirm disabling multi-factor authentication.</p>
          <form onSubmit={handleDisable} style={{ marginTop: 12 }}>
            <label>Password<input type="password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)} required autoComplete="current-password" /></label>
            <button type="submit" className="btn danger" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Disabling…" : "Disable MFA"}</button>
          </form>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// WI-FI QR CODE GENERATOR (Bonus Utility)
// ═══════════════════════════════════════════════════════════════════
function WifiQRPage() {
  const { fetchBranches, user } = useAuth();
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(() => {
    return localStorage.getItem("rhosam_wifi_selected_branch") || String(user?.branchId || "");
  });
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [encryption, setEncryption] = useState("WPA");
  const [hidden, setHidden] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("rhosam-theme") === "dark");
  const [error, setError] = useState("");

  // Load branches on mount
  useEffect(() => {
    fetchBranches().then(setBranches).catch(() => {});
  }, [fetchBranches]);

  // Load settings when branch changes
  useEffect(() => {
    const prefix = selectedBranch ? `rhosam_wifi_${selectedBranch}_` : "rhosam_wifi_";
    setSsid(localStorage.getItem(`${prefix}ssid`) || "");
    setPassword(localStorage.getItem(`${prefix}password`) || "");
    setEncryption(localStorage.getItem(`${prefix}encryption`) || "WPA");
    setHidden(localStorage.getItem(`${prefix}hidden`) === "true");
  }, [selectedBranch]);

  // Save selected branch
  useEffect(() => { localStorage.setItem("rhosam_wifi_selected_branch", selectedBranch); }, [selectedBranch]);

  // Save Wi-Fi settings to localStorage whenever they change (branch-scoped)
  useEffect(() => {
    const prefix = selectedBranch ? `rhosam_wifi_${selectedBranch}_` : "rhosam_wifi_";
    localStorage.setItem(`${prefix}ssid`, ssid);
  }, [ssid, selectedBranch]);
  useEffect(() => {
    const prefix = selectedBranch ? `rhosam_wifi_${selectedBranch}_` : "rhosam_wifi_";
    localStorage.setItem(`${prefix}password`, password);
  }, [password, selectedBranch]);
  useEffect(() => {
    const prefix = selectedBranch ? `rhosam_wifi_${selectedBranch}_` : "rhosam_wifi_";
    localStorage.setItem(`${prefix}encryption`, encryption);
  }, [encryption, selectedBranch]);
  useEffect(() => {
    const prefix = selectedBranch ? `rhosam_wifi_${selectedBranch}_` : "rhosam_wifi_";
    localStorage.setItem(`${prefix}hidden`, String(hidden));
  }, [hidden, selectedBranch]);

  // Watch for dark mode changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDarkMode(document.body.classList.contains("dark"));
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Generate QR code when inputs change
  useEffect(() => {
    if (!ssid.trim()) { setQrDataUrl(null); return; }
    // Wi-Fi QR format: WIFI:T:WPA;S:networkname;P:password;H:hidden;;
    const esc = (s) => s.replace(/\\/g, "\\\\\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/"/g, '\\"');
    let wifiString = "WIFI:T:" + encryption + ";S:" + esc(ssid) + ";";
    if (encryption !== "nopass") wifiString += "P:" + esc(password) + ";";
    if (hidden) wifiString += "H:true;";
    wifiString += ";";

    const colors = darkMode
      ? { dark: '#f1f5f9', light: '#1e293b' }
      : { dark: '#172033', light: '#ffffff' };

    QRCode.toDataURL(wifiString, {
      width: 280,
      margin: 2,
      color: colors,
      errorCorrectionLevel: 'M',
    }).then(setQrDataUrl).catch(() => { setError("Failed to generate QR code."); setQrDataUrl(null); });
  }, [ssid, password, encryption, hidden, darkMode]);

  function handleDownload() {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `wifi-${ssid || 'network'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="page-panel" style={{ maxWidth: 600 }}>
      <div className="panel">
        <h2>📶 Wi-Fi QR Code Generator</h2>
        <p className="muted" style={{ marginBottom: 16 }}>Generate a QR code that customers or staff can scan to connect to your Wi-Fi network instantly.</p>

        <div className="form-grid">
          {branches.length > 1 && (
            <label>Branch
              <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}>
                <option value="">General (All Branches)</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          <label>Network Name (SSID)
            <input type="text" value={ssid} onChange={e => setSsid(e.target.value)} placeholder="e.g. RHoSAM-Guest-WiFi" required />
          </label>
          <label>Encryption
            <select value={encryption} onChange={e => setEncryption(e.target.value)}>
              <option value="WPA">WPA/WPA2/WPA3 (Most common)</option>
              <option value="WEP">WEP (Legacy)</option>
              <option value="nopass">None (Open network)</option>
            </select>
          </label>
          {encryption !== "nopass" && (
            <label>Password
              <input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="Wi-Fi password" />
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} style={{ width: 'auto' }} />
            Hidden network (not broadcasting SSID)
          </label>
        </div>

        {error && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          {qrDataUrl ? (
            <>
              <img src={qrDataUrl} alt="Wi-Fi QR Code" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: darkMode ? '#1e293b' : 'white', transition: 'background 0.3s' }} />
              <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn primary" onClick={handleDownload}>📥 Download QR</button>
                <button className="btn secondary" onClick={() => window.print()}>🖨️ Print</button>
                <button className="btn-sm danger" onClick={() => {
                  if (confirm('Clear saved Wi-Fi settings for this branch?')) {
                    const prefix = selectedBranch ? `rhosam_wifi_${selectedBranch}_` : "rhosam_wifi_";
                    localStorage.removeItem(`${prefix}ssid`);
                    localStorage.removeItem(`${prefix}password`);
                    localStorage.removeItem(`${prefix}encryption`);
                    localStorage.removeItem(`${prefix}hidden`);
                    setSsid(""); setPassword(""); setEncryption("WPA"); setHidden(false);
                  }
                }}>🗑️ Clear Saved</button>
              </div>
              <div style={{ marginTop: 12 }}>
                <p className="muted" style={{ fontSize: '0.8rem' }}>Scan this code with any phone camera to connect automatically</p>
              </div>
            </>
          ) : (
            <div style={{ width: 280, height: 280, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--border)', borderRadius: 12, border: '1px dashed var(--border)' }}>
              <p className="muted" style={{ textAlign: 'center', padding: 20 }}>Enter a network name above to generate the QR code</p>
            </div>
          )}
        </div>
      </div>

      {/* Print-only version */}
      <div className="wifi-print" style={{ display: 'none' }}>
        <style>{`
          @media print {
            .wifi-print { display: block !important; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: white; z-index: 99999; padding: 40px; font-family: Arial, sans-serif; text-align: center; }
            .wifi-print * { visibility: visible !important; }
          }
        `}</style>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>📶 Connect to Wi-Fi</h1>
        <p style={{ fontSize: 16, color: '#666', marginBottom: 24 }}>Scan this code with your phone camera</p>
        {qrDataUrl && <img src={qrDataUrl} alt="Wi-Fi QR" style={{ width: 240, height: 240 }} />}
        <p style={{ marginTop: 16, fontSize: 14 }}><strong>{ssid}</strong></p>
        <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>RHoSAM Supermarket</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EXPIRY TRACKING PAGE
// ═══════════════════════════════════════════════════════════════════
function ExpiryTrackingPage() {
  const { fetchExpiringProducts, reportExpiryEvent, fetchExpiryEvents, user } = useAuth();
  const [tab, setTab] = useState('expiring');
  const [data, setData] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ productId: '', eventType: 'DISPOSED', quantity: '1', notes: '' });
  const [msg, setMsg] = useState('');
  const isAdmin = ['ADMIN', 'MANAGER'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, ev] = await Promise.all([fetchExpiringProducts(days), fetchExpiryEvents()]);
      setData(e); setEvents(ev);
    } catch {} finally { setLoading(false); }
  }, [fetchExpiringProducts, fetchExpiryEvents, days]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e) {
    e.preventDefault(); setMsg('');
    try {
      await reportExpiryEvent({ ...form, productId: Number(form.productId), quantity: Number(form.quantity) });
      setMsg('Event recorded.'); setShowForm(false); load();
    } catch (err) { setMsg('Error: ' + err.message); }
  }

  const fmt = (n) => { const v = parseFloat(n) || 0; return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  return (
    <div className="page-panel">
      <div className="panel-header">
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={tab === 'expiring' ? 'active' : ''} onClick={() => setTab('expiring')}>⏰ Expiring Products</button>
          <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>📋 Expiry Events</button>
        </div>
        {isAdmin && <button className="btn primary" onClick={() => setShowForm(true)}>+ Record Event</button>}
      </div>

      {tab === 'expiring' && (
        <>
          <div className="tabs" style={{ marginTop: 8 }}>
            {[7, 14, 30, 60, 90].map(d => (
              <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{d}d</button>
            ))}
          </div>
          {loading ? <p className="loading">Loading…</p> : (
            <>
              {data && (
                <div className="summary-grid" style={{ marginTop: 8 }}>
                  <div className="summary-card accent"><span>Total</span><strong>{data.summary.total}</strong></div>
                  <div className="summary-card" style={{ color: 'var(--danger)' }}><span>Expired</span><strong>{data.summary.expired}</strong></div>
                  <div className="summary-card" style={{ color: 'var(--warning)' }}><span>Expiring Today</span><strong>{data.summary.expiringToday}</strong></div>
                  <div className="summary-card"><span>Expiring Soon</span><strong>{data.summary.expiringSoon}</strong></div>
                </div>
              )}
              <div className="table-wrap" style={{ marginTop: 8 }}>
                {data?.products?.length ? (
                  <table>
                    <thead><tr><th>Name</th><th>Barcode</th><th>Category</th><th>Expiry Date</th><th>Days Left</th><th>Stock</th><th>Cost</th><th>Value</th></tr></thead>
                    <tbody>{data.products.map(p => (
                      <tr key={p.id} style={{ background: p.days_until_expiry <= 0 ? 'rgba(239,68,68,0.05)' : p.days_until_expiry <= 7 ? 'rgba(245,158,11,0.05)' : 'transparent' }}>
                        <td>{p.name}{p.batch_number && <code style={{ marginLeft: 6, fontSize: 11 }}>{p.batch_number}</code>}</td>
                        <td><code>{p.barcode}</code></td>
                        <td>{p.category}</td>
                        <td>{new Date(p.expiry_date).toLocaleDateString('en-NG', { dateStyle: 'medium' })}</td>
                        <td><span className={`status-badge ${p.days_until_expiry <= 0 ? 'inactive' : p.days_until_expiry <= 7 ? 'warning' : 'active'}`}>{p.days_until_expiry <= 0 ? 'Expired' : `${p.days_until_expiry}d`}</span></td>
                        <td>{p.stock}</td>
                        <td>{fmt(p.cost_price)}</td>
                        <td>{fmt(p.cost_price * p.stock)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : <p className="muted">No products expiring within {days} days. 🎉</p>}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'events' && (
        <div className="table-wrap">
          {events.length ? (
            <table>
              <thead><tr><th>Date</th><th>Product</th><th>Event</th><th>Qty</th><th>Performed By</th><th>Notes</th></tr></thead>
              <tbody>{events.map(ev => (
                <tr key={ev.id}>
                  <td>{new Date(ev.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{ev.product_name}</td>
                  <td><span className={`status-badge ${ev.event_type === 'EXPIRED' ? 'inactive' : ev.event_type === 'DISPOSED' ? 'warning' : 'active'}`}>{ev.event_type}</span></td>
                  <td>{ev.quantity}</td>
                  <td>{ev.performed_by_name}</td>
                  <td>{ev.notes || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className="muted">No expiry events recorded yet.</p>}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Record Expiry Event</h2>
            {msg && <div className={msg.startsWith('Error') ? 'error-msg' : 'muted'} style={{ marginBottom: 8 }}>{msg}</div>}
            <form onSubmit={handleSubmit} className="form-grid">
              <label>Product ID<input type="number" min="1" value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })} required /></label>
              <label>Event Type
                <select value={form.eventType} onChange={e => setForm({ ...form, eventType: e.target.value })}>
                  <option value="DISPOSED">Disposed</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="PRICE_MARKDOWN">Price Markdown</option>
                  <option value="NEAR_EXPIRY_ALERT">Near-Expiry Alert</option>
                </select>
              </label>
              <label>Quantity<input type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required /></label>
              <label>Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Record</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BULK IMPORT / EXPORT PAGE
// ═══════════════════════════════════════════════════════════════════
function BulkImportExportPage() {
  const { exportInventoryCSV, importInventoryCSV, user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const isAdmin = user?.role === 'ADMIN';

  async function handleExport() {
    try { await exportInventoryCSV(user?.branchId); } catch (err) { alert('Export failed: ' + err.message); }
  }

  async function handleFile(file) {
    if (!file || !file.name.endsWith('.csv')) { alert('Please select a CSV file.'); return; }
    setImporting(true); setResult(null);
    try {
      const r = await importInventoryCSV(file);
      setResult(r);
    } catch (err) { setResult({ error: err.message }); }
    finally { setImporting(false); }
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }

  return (
    <div className="page-panel">
      <div className="summary-grid">
        <div className="panel" style={{ flex: 1, minWidth: 300 }}>
          <h2>📤 Export Inventory</h2>
          <p className="muted">Download your current inventory as a CSV file for offline analysis or spreadsheet reporting.</p>
          <button className="btn primary" onClick={handleExport} style={{ marginTop: 12 }}>Download CSV</button>
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Includes: barcode, name, category, price, cost, stock, reorder level, unit, expiry date, batch number.</p>
        </div>
        <div className="panel" style={{ flex: 1, minWidth: 300 }}>
          <h2>📥 Import Products</h2>
          <p className="muted">Upload a CSV file to bulk create or update products. New barcodes are created, existing ones are updated.</p>
          {isAdmin ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              style={{
                border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 8, padding: 32, textAlign: 'center', marginTop: 12,
                background: dragOver ? 'var(--accent)10' : 'transparent', cursor: 'pointer', transition: 'all 0.2s'
              }}
              onClick={() => document.getElementById('csv-file-input').click()}
            >
              <input id="csv-file-input" type="file" accept='.csv' style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])} />
              {importing ? <p className="loading">Importing…</p> : (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                  <p>Drag & drop a CSV file here, or <strong>click to browse</strong></p>
                  <p className="muted" style={{ fontSize: 12 }}>Required columns: barcode, name, category, price</p>
                </>
              )}
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>Only administrators can import products.</p>
          )}
          {result && !result.error && (
            <div className="muted" style={{ marginTop: 12, padding: 12, background: 'var(--card)', borderRadius: 8 }}>
              <p><strong>Import Complete</strong></p>
              <p>✅ Created: {result.created} &nbsp; 🔄 Updated: {result.updated} &nbsp; ⏭️ Skipped: {result.skipped}</p>
              {result.errors?.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer' }}>Show errors ({result.errors.length})</summary>
                  <ul style={{ fontSize: 12, marginTop: 4 }}>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </details>
              )}
            </div>
          )}
          {result?.error && <div className="error-msg" style={{ marginTop: 12 }}>{result.error}</div>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INVENTORY AUDIT PAGE (Stock-Taking)
// ═══════════════════════════════════════════════════════════════════
function InventoryAuditPage() {
  const { fetchAudits, getAudit, createAudit, updateAuditStatus, updateAuditItem, deleteAudit, user, fetchBranches } = useAuth();
  const [audits, setAudits] = useState([]);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', notes: '' });
  const [countModal, setCountModal] = useState(null);
  const [countVal, setCountVal] = useState('');
  const [countNotes, setCountNotes] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => { if (isAdmin) fetchBranches().then(setBranches).catch(() => {}); }, [isAdmin, fetchBranches]);

  const load = useCallback(async () => {
    const params = {};
    if (selectedBranch) params.branchId = selectedBranch;
    try { setAudits(await fetchAudits(Object.keys(params).length ? params : undefined)); } catch {} finally { setLoading(false); }
  }, [fetchAudits]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await createAudit(form); setShowForm(false); setForm({ title: '', notes: '' }); load();
    } catch (err) { alert(err.message); }
  }

  async function openAudit(id) {
    try { setActive(await getAudit(id)); } catch (err) { alert(err.message); }
  }

  async function handleStatusChange(id, status) {
    try {
      await updateAuditStatus(id, status);
      if (active?.id === id) openAudit(id);
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleCount(e) {
    e.preventDefault();
    try {
      await updateAuditItem(active.id, countModal.id, { countedQuantity: Number(countVal), notes: countNotes });
      setCountModal(null); setCountVal(''); setCountNotes('');
      openAudit(active.id);
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this draft audit?')) return;
    try { await deleteAudit(id); load(); } catch (err) { alert(err.message); }
  }

  const fmt = (n) => { const v = parseFloat(n) || 0; return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const filteredItems = active?.items?.filter(i => !filter || i.product_name.toLowerCase().includes(filter.toLowerCase()) || (i.barcode || '').includes(filter)) || [];
  const countedCount = filteredItems.filter(i => i.counted_quantity !== null).length;
  const discrepancies = filteredItems.filter(i => i.counted_quantity !== null && i.discrepancy !== 0);

  return (
    <div className="page-panel">
      {isAdmin && branches.length > 0 && !active && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Audits across all branches'}</span>
        </div>
      )}
      <div className="panel-header">
        <h2 style={{ margin: 0 }}>{active ? `📋 Audit: ${active.title}` : 'Inventory Audits'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {active && <button className="btn secondary" onClick={() => setActive(null)}>← Back to List</button>}
          {isAdmin && !active && <button className="btn primary" onClick={() => setShowForm(true)}>+ New Audit</button>}
        </div>
      </div>

      {!active && (
        loading ? <p className="loading">Loading…</p> : (
          <div className="table-wrap">
            {audits.length ? (
              <table>
                <thead><tr><th>Title</th><th>Branch</th><th>Status</th><th>Items</th><th>Matched</th><th>Discrepancies</th><th>Value</th><th>Created By</th><th>Date</th><th>Actions</th></tr></thead>
                <tbody>{audits.map(a => (
                  <tr key={a.id}>
                    <td><button className="btn-sm" onClick={() => openAudit(a.id)}>{a.title}</button></td>
                    <td>{a.branch_name || 'All'}</td>
                    <td><span className={`status-badge ${a.status === 'COMPLETED' ? 'active' : a.status === 'IN_PROGRESS' ? 'warning' : a.status === 'CANCELLED' ? 'inactive' : ''}`}>{a.status}</span></td>
                    <td>{a.total_items}</td><td>{a.matched_items}</td>
                    <td className={a.discrepancy_items > 0 ? 'low-stock' : ''}>{a.discrepancy_items}</td>
                    <td>{fmt(a.total_discrepancy_value)}</td>
                    <td>{a.created_by_name}</td>
                    <td>{new Date(a.created_at).toLocaleDateString('en-NG', { dateStyle: 'medium' })}</td>
                    <td>
                      {a.status === 'DRAFT' && <><button className="btn-sm" onClick={() => handleStatusChange(a.id, 'IN_PROGRESS')}>Start</button>{' '}</>}
                      {a.status === 'IN_PROGRESS' && <button className="btn-sm" onClick={() => handleStatusChange(a.id, 'COMPLETED')}>Complete</button>}
                      {a.status === 'DRAFT' && <>{' '}<button className="btn-sm danger" onClick={() => handleDelete(a.id)}>Delete</button></>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <p className="muted">No audits yet. Create one to start stock-taking.</p>}
          </div>
        )
      )}

      {active && (
        <>
          <div className="summary-grid" style={{ marginTop: 8 }}>
            <div className="summary-card"><span>Total Items</span><strong>{active.total_items}</strong></div>
            <div className="summary-card"><span>Counted</span><strong>{countedCount}</strong></div>
            <div className="summary-card"><span>Discrepancies</span><strong style={{ color: discrepancies.length > 0 ? 'var(--danger)' : 'var(--success)' }}>{discrepancies.length}</strong></div>
            <div className="summary-card"><span>Status</span><strong>{active.status}</strong></div>
          </div>
          {active.status === 'IN_PROGRESS' && (
            <div style={{ margin: '8px 0' }}>
              <input className="search-input" placeholder='Search products…' value={filter} onChange={e => setFilter(e.target.value)} />
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Barcode</th><th>System Qty</th><th>Counted</th><th>Discrepancy</th><th>Value</th>{active.status === 'IN_PROGRESS' && <th>Action</th>}</tr></thead>
              <tbody>{filteredItems.map(i => (
                <tr key={i.id} style={{ background: i.discrepancy !== 0 && i.counted_quantity !== null ? 'rgba(239,68,68,0.05)' : 'transparent' }}>
                  <td>{i.product_name}</td><td><code>{i.barcode}</code></td>
                  <td>{i.system_quantity}</td>
                  <td>{i.counted_quantity !== null ? i.counted_quantity : '—'}</td>
                  <td style={{ color: i.discrepancy > 0 ? 'var(--success)' : i.discrepancy < 0 ? 'var(--danger)' : 'var(--muted)' }}>
                    {i.counted_quantity !== null ? `${i.discrepancy > 0 ? '+' : ''}${i.discrepancy}` : '—'}
                  </td>
                  <td>{i.counted_quantity !== null ? fmt(i.discrepancy_value) : '—'}</td>
                  {active.status === 'IN_PROGRESS' && (
                    <td>
                      <button className="btn-sm" onClick={() => { setCountModal(i); setCountVal(i.counted_quantity ?? ''); setCountNotes(i.notes || ''); }}>
                        {i.counted_quantity !== null ? 'Edit' : 'Count'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>New Inventory Audit</h2>
            <p className="muted">This will capture a snapshot of all current product stock levels for counting.</p>
            <form onSubmit={handleCreate} className="form-grid">
              <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder='e.g. Monthly Audit - August 2026' /></label>
              <label>Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Create Audit</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {countModal && (
        <div className="modal-overlay" onClick={() => setCountModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Count: {countModal.product_name}</h2>
            <p className="muted">System quantity: {countModal.system_quantity}</p>
            <form onSubmit={handleCount} className="form-grid">
              <label>Counted Quantity<input type="number" min="0" value={countVal} onChange={e => setCountVal(e.target.value)} required autoFocus /></label>
              <label>Notes<textarea value={countNotes} onChange={e => setCountNotes(e.target.value)} rows={2} placeholder='e.g. Damaged on shelf' /></label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setCountModal(null)}>Cancel</button>
                <button type="submit" className="btn primary">Save Count</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STOCK ALERTS PAGE
// ═══════════════════════════════════════════════════════════════════
function StockAlertsPage() {
  const { fetchStockAlerts, scanStockAlerts, markAlertsRead, dismissAlerts, fetchAlertRules, createAlertRule, updateAlertRule, deleteAlertRule, user, fetchBranches } = useAuth();
  const [tab, setTab] = useState('alerts');
  const [alerts, setAlerts] = useState({ alerts: [], total: 0, unread: 0 });
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [branches, setBranches] = useState([]);
  const isAdmin = user?.role === 'ADMIN';
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ name: '', alertType: 'LOW_STOCK', thresholdValue: 5, thresholdUnit: 'UNITS', notifyDashboard: true });
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedBranch) params.branchId = selectedBranch;
      const alertParams = Object.keys(params).length ? params : undefined;
      const [a, r] = await Promise.all([fetchStockAlerts(alertParams), fetchAlertRules()]);
      setAlerts(a); setRules(r);
    } catch {} finally { setLoading(false); }
  }, [fetchStockAlerts, fetchAlertRules, selectedBranch]);

  useEffect(() => { if (isAdmin) fetchBranches().then(setBranches).catch(() => {}); }, [isAdmin, fetchBranches]);

  useEffect(() => { load(); }, [load]);

  async function handleScan() {
    setScanning(true); setMsg('');
    try {
      const r = await scanStockAlerts();
      setMsg(r.message); load();
    } catch (err) { setMsg('Error: ' + err.message); }
    finally { setScanning(false); }
  }

  async function handleCreateRule(e) {
    e.preventDefault();
    try {
      await createAlertRule(ruleForm); setShowRuleForm(false);
      setRuleForm({ name: '', alertType: 'LOW_STOCK', thresholdValue: 5, thresholdUnit: 'UNITS', notifyDashboard: true });
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleDeleteRule(id) {
    if (!confirm('Delete this rule?')) return;
    try { await deleteAlertRule(id); load(); } catch (err) { alert(err.message); }
  }

  async function handleDismiss(ids) {
    try { await dismissAlerts(ids); load(); } catch (err) { alert(err.message); }
  }

  async function handleMarkRead() {
    try { await markAlertsRead(); load(); } catch (err) { alert(err.message); }
  }

  return (
    <div className="page-panel">
      {isAdmin && branches.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 16px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>🏢 Branch:</span>
          <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500 }}>
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{selectedBranch ? `— Viewing: ${branches.find(b => String(b.id) === String(selectedBranch))?.name}` : '— Alerts across all branches'}</span>
        </div>
      )}
      <div className="panel-header">
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}>🔔 Active Alerts ({alerts.unread || 0})</button>
          <button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>⚙️ Rules ({rules.length})</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn secondary" onClick={handleScan} disabled={scanning}>{scanning ? '⏳ Scanning…' : '🔍 Scan Now'}</button>
          {tab === 'alerts' && alerts.alerts?.length > 0 && <button className="btn secondary" onClick={handleMarkRead}>Mark All Read</button>}
          {isAdmin && tab === 'rules' && <button className="btn primary" onClick={() => setShowRuleForm(true)}>+ New Rule</button>}
        </div>
      </div>

      {msg && <div className="muted" style={{ margin: '8px 0' }}>{msg}</div>}

      {loading ? <p className="loading">Loading…</p> : (
        <>
          {tab === 'alerts' && (
            <div className="table-wrap">
              {alerts.alerts?.length ? (
                <table>
                  <thead><tr><th>Severity</th><th>Type</th><th>Alert</th><th>Message</th><th>Date</th><th>Actions</th></tr></thead>
                  <tbody>{alerts.alerts.map(a => (
                    <tr key={a.id} style={{ background: a.is_read ? 'transparent' : 'rgba(59,130,246,0.03)' }}>
                      <td><span className={`status-badge ${a.severity === 'CRITICAL' ? 'inactive' : a.severity === 'WARNING' ? 'warning' : 'active'}`}>{a.severity}</span></td>
                      <td>{a.alert_type}</td>
                      <td><strong>{a.title}</strong></td>
                      <td>{a.message}</td>
                      <td>{new Date(a.created_at).toLocaleDateString('en-NG', { dateStyle: 'short' })}</td>
                      <td>
                        <button className="btn-sm" onClick={() => handleDismiss([a.id])}>Dismiss</button>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="muted">No active alerts. Click "Scan Now" to check for issues.</p>}
            </div>
          )}

          {tab === 'rules' && (
            <div className="table-wrap">
              {rules.length ? (
                <table>
                  <thead><tr><th>Name</th><th>Type</th><th>Threshold</th><th>Dashboard</th><th>Email</th><th>Active</th><th>Actions</th></tr></thead>
                  <tbody>{rules.map(r => (
                    <tr key={r.id}>
                      <td><strong>{r.name}</strong></td>
                      <td><span className="status-badge active">{r.alert_type}</span></td>
                      <td>{r.threshold_value} {r.threshold_unit}</td>
                      <td>{r.notify_dashboard ? '✅' : '—'}</td>
                      <td>{r.notify_email ? '✅' : '—'}</td>
                      <td>{r.is_active ? '✅' : '❌'}</td>
                      <td>
                        <button className="btn-sm" onClick={() => updateAlertRule(r.id, { isActive: !r.is_active }).then(load)}>{r.is_active ? 'Disable' : 'Enable'}</button>
                        {isAdmin && <>{' '}<button className="btn-sm danger" onClick={() => handleDeleteRule(r.id)}>Delete</button></>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="muted">No alert rules configured. Create one to get started.</p>}
            </div>
          )}
        </>
      )}

      {showRuleForm && (
        <div className="modal-overlay" onClick={() => setShowRuleForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>New Alert Rule</h2>
            <form onSubmit={handleCreateRule} className="form-grid">
              <label>Name<input value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} required placeholder='e.g. Low Stock Warning' /></label>
              <label>Type
                <select value={ruleForm.alertType} onChange={e => setRuleForm({ ...ruleForm, alertType: e.target.value })}>
                  <option value='LOW_STOCK'>Low Stock</option>
                  <option value='OUT_OF_STOCK'>Out of Stock</option>
                  <option value='EXPIRING_SOON'>Expiring Soon</option>
                  <option value='NEGATIVE_STOCK'>Negative Stock</option>
                  <option value='OVERSTOCK'>Overstock</option>
                </select>
              </label>
              <label>Threshold<input type='number' min='0' step='any' value={ruleForm.thresholdValue} onChange={e => setRuleForm({ ...ruleForm, thresholdValue: Number(e.target.value) })} required /></label>
              <label>Unit
                <select value={ruleForm.thresholdUnit} onChange={e => setRuleForm({ ...ruleForm, thresholdUnit: e.target.value })}>
                  <option value='UNITS'>Units</option>
                  <option value='DAYS'>Days</option>
                  <option value='PERCENT'>Percent</option>
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type='checkbox' checked={ruleForm.notifyDashboard} onChange={e => setRuleForm({ ...ruleForm, notifyDashboard: e.target.checked })} />
                Show on Dashboard
              </label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowRuleForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Create Rule</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION PREFERENCES PAGE
// ═══════════════════════════════════════════════════════════════════
function NotificationPreferencesPage() {
  const { fetchNotificationPreferences, updateNotificationPreferences, user } = useAuth();
  const [prefs, setPrefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchNotificationPreferences().then(setPrefs).catch(() => {}).finally(() => setLoading(false));
  }, [fetchNotificationPreferences]);

  const EVENT_LABELS = {
    LOW_STOCK: { name: 'Low Stock Alerts', desc: 'When product stock drops below reorder level', icon: '📦' },
    OUT_OF_STOCK: { name: 'Out of Stock Alerts', desc: 'When a product hits zero stock', icon: '🚫' },
    EXPIRING_SOON: { name: 'Expiry Alerts', desc: 'When products are approaching their expiry date', icon: '⏰' },
    DAILY_REPORT: { name: 'Daily Reports', desc: 'End-of-day sales and performance summary', icon: '📊' },
    SALE_MILESTONE: { name: 'Sale Milestones', desc: 'Notifications for high-value sales targets', icon: '🎯' },
    STOCK_ADJUSTMENT: { name: 'Stock Adjustments', desc: 'When stock levels are manually changed', icon: '📋' },
    NEW_SALE: { name: 'New Sale Notifications', desc: 'Real-time notifications for each completed sale', icon: '🛒' },
    SYSTEM_ALERT: { name: 'System Alerts', desc: 'Critical system notifications and updates', icon: '🔔' },
  };

  function togglePref(eventType, channel) {
    setPrefs(prev => prev.map(p => {
      if (p.event_type !== eventType) return p;
      if (channel === 'email') return { ...p, email_enabled: !p.email_enabled };
      return { ...p, sms_enabled: !p.sms_enabled };
    }));
  }

  async function handleSave() {
    setSaving(true); setMsg('');
    try {
      await updateNotificationPreferences(prefs);
      setMsg('Preferences saved!');
    } catch (err) { setMsg('Error: ' + err.message); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="page-panel"><p className="loading">Loading preferences…</p></div>;

  return (
    <div className="page-panel">
      <div className="panel-header">
        <div><h2 style={{ margin: 0 }}>Notification Preferences</h2><p className="muted" style={{ margin: '4px 0 0' }}>Choose how you want to be notified for each event type</p></div>
        <button className="btn primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : '💾 Save Preferences'}</button>
      </div>
      {msg && <div className={msg.startsWith('Error') ? 'error-msg' : 'muted'} style={{ margin: '8px 0' }}>{msg}</div>}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Event</th><th>Description</th><th style={{ textAlign: 'center' }}>📧 Email</th><th style={{ textAlign: 'center' }}>📱 SMS</th></tr></thead>
          <tbody>{prefs.map(p => {
            const info = EVENT_LABELS[p.event_type] || { name: p.event_type, desc: '', icon: '📌' };
            return (
              <tr key={p.event_type}>
                <td><strong>{info.icon} {info.name}</strong></td>
                <td className="muted" style={{ fontSize: '0.85rem' }}>{info.desc}</td>
                <td style={{ textAlign: 'center' }}>
                  <label style={{ cursor: 'pointer', display: 'inline-flex' }}>
                    <input type="checkbox" checked={p.email_enabled} onChange={() => togglePref(p.event_type, 'email')} style={{ width: 18, height: 18 }} />
                  </label>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <label style={{ cursor: 'pointer', display: 'inline-flex' }}>
                    <input type="checkbox" checked={p.sms_enabled} onChange={() => togglePref(p.event_type, 'sms')} style={{ width: 18, height: 18 }} />
                  </label>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 12, fontSize: '0.8rem' }}>💡 Email notifications are sent to <strong>{user?.email}</strong>. SMS requires a phone number on your profile.</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION CENTER PAGE (Admin)
// ═══════════════════════════════════════════════════════════════════
function NotificationCenterPage() {
  const { fetchNotificationLog, sendTestNotification, getNotificationStatus, user } = useAuth();
  const [tab, setTab] = useState('log');
  const [log, setLog] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testForm, setTestForm] = useState({ channel: 'EMAIL', recipient: user?.email || '' });
  const [testMsg, setTestMsg] = useState('');
  const [filter, setFilter] = useState({ channel: '', event_type: '' });
  const isAdmin = user?.role === 'ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, s] = await Promise.all([
        fetchNotificationLog({ ...filter, limit: 100 }),
        isAdmin ? getNotificationStatus() : Promise.resolve(null)
      ]);
      setLog(l); setStatus(s);
    } catch {} finally { setLoading(false); }
  }, [fetchNotificationLog, getNotificationStatus, isAdmin, filter]);

  useEffect(() => { load(); }, [load]);

  async function handleTest(e) {
    e.preventDefault(); setTestMsg('');
    try {
      const r = await sendTestNotification(testForm);
      setTestMsg(r.message || 'Sent!');
    } catch (err) { setTestMsg('Error: ' + err.message); }
  }

  const channelColors = { EMAIL: 'active', SMS: 'warning' };
  const statusColors = { SENT: 'active', FAILED: 'inactive', PENDING: 'warning' };

  return (
    <div className="page-panel">
      <div className="panel-header">
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>📋 Notification Log</button>
          {isAdmin && <button className={tab === 'status' ? 'active' : ''} onClick={() => setTab('status')}>📊 Service Status</button>}
          {isAdmin && <button className={tab === 'test' ? 'active' : ''} onClick={() => setTab('test')}>🧪 Send Test</button>}
        </div>
      </div>

      {tab === 'log' && (
        <>
          <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
            <select value={filter.channel} onChange={e => setFilter(f => ({ ...f, channel: e.target.value }))} className="search-input" style={{ width: 120 }}>
              <option value="">All Channels</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
            </select>
            <select value={filter.event_type} onChange={e => setFilter(f => ({ ...f, event_type: e.target.value }))} className="search-input" style={{ width: 180 }}>
              <option value="">All Events</option>
              <option value="LOW_STOCK">Low Stock</option>
              <option value="OUT_OF_STOCK">Out of Stock</option>
              <option value="EXPIRING_SOON">Expiring Soon</option>
              <option value="DAILY_REPORT">Daily Report</option>
              <option value="SALE_MILESTONE">Sale Milestone</option>
              <option value="SYSTEM_ALERT">System Alert</option>
            </select>
          </div>
          {loading ? <p className="loading">Loading…</p> : (
            <div className="table-wrap">
              {log.length ? (
                <table>
                  <thead><tr><th>Date</th><th>Channel</th><th>Event</th><th>Recipient</th><th>Status</th><th>User</th></tr></thead>
                  <tbody>{log.map(n => (
                    <tr key={n.id}>
                      <td>{new Date(n.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td><span className={`status-badge ${channelColors[n.channel]}`}>{n.channel}</span></td>
                      <td>{n.event_type}</td>
                      <td><code style={{ fontSize: 12 }}>{n.recipient}</code></td>
                      <td><span className={`status-badge ${statusColors[n.status]}`}>{n.status}</span></td>
                      <td>{n.user_name || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="muted">No notifications sent yet.</p>}
            </div>
          )}
        </>
      )}

      {tab === 'status' && status && (
        <div className="summary-grid" style={{ marginTop: 12 }}>
          <div className="summary-card"><span>Email Service</span><strong style={{ color: status.emailConfigured ? 'var(--success)' : 'var(--danger)' }}>{status.emailConfigured ? '✅ Configured' : '❌ Not configured'}</strong><small>Resend API</small></div>
          <div className="summary-card"><span>SMS Service</span><strong style={{ color: status.smsConfigured ? 'var(--success)' : 'var(--danger)' }}>{status.smsConfigured ? '✅ Configured' : '❌ Not configured'}</strong><small>Telnyx API</small></div>
          {status.recentStats?.map(s => (
            <div key={`${s.channel}-${s.status}`} className="summary-card">
              <span>{s.channel} — {s.status}</span>
              <strong>{s.count}</strong>
              <small>Last 7 days</small>
            </div>
          ))}
        </div>
      )}

      {tab === 'test' && (
        <div className="panel" style={{ marginTop: 12, maxWidth: 500 }}>
          <h3>Send Test Notification</h3>
          <form onSubmit={handleTest} className="form-grid">
            <label>Channel
              <select value={testForm.channel} onChange={e => setTestForm({ ...testForm, channel: e.target.value })}>
                <option value="EMAIL">📧 Email</option>
                <option value="SMS">📱 SMS</option>
              </select>
            </label>
            <label>Recipient
              <input value={testForm.recipient} onChange={e => setTestForm({ ...testForm, recipient: e.target.value })} required
                placeholder={testForm.channel === 'EMAIL' ? 'email@example.com' : '+234...'} />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn primary">Send Test {testForm.channel}</button>
            </div>
          </form>
          {testMsg && <div className={testMsg.startsWith('Error') ? 'error-msg' : 'muted'} style={{ marginTop: 8 }}>{testMsg}</div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PAYSTACK TERMINAL
// ═══════════════════════════════════════════════════════════════════
function TerminalPage() {
  const { fetchTerminals, getTerminal, createTerminal, updateTerminal, deleteTerminal, chargeTerminal, getTerminalTxStatus, fetchTerminalTransactions, fetchBranches, user } = useAuth();
  const [terminals, setTerminals] = useState([]);
  const [paystackTerminals, setPaystackTerminals] = useState([]);
  const [txHistory, setTxHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("devices");
  const [selectedTerminal, setSelectedTerminal] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", serialNumber: "", branchId: "" });
  const [branches, setBranches] = useState([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  // Charge flow
  const [chargeModal, setChargeModal] = useState(null);
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeEmail, setChargeEmail] = useState("");
  const [activeCharge, setActiveCharge] = useState(null);
  const [polling, setPolling] = useState(false);
  const isAdmin = ["ADMIN", "MANAGER"].includes(user?.role);

  const fmt = (n) => { const v = parseFloat(n) || 0; return "\u20A6" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  const load = useCallback(async () => {
    setLoading(true); setMsg(""); setError("");
    try {
      const [t, b, tx] = await Promise.all([
        fetchTerminals(),
        fetchBranches().catch(() => []),
        fetchTerminalTransactions().catch(() => []),
      ]);
      setTerminals(t.terminals || []);
      setPaystackTerminals(t.paystackTerminals || []);
      setBranches(b);
      setTxHistory(tx);
    } catch {} finally { setLoading(false); }
  }, [fetchTerminals, fetchBranches, fetchTerminalTransactions]);

  useEffect(() => { load(); }, [load]);

  async function handleAddTerminal(e) {
    e.preventDefault(); setMsg(""); setError("");
    try {
      await createTerminal({
        name: addForm.name,
        serialNumber: addForm.serialNumber || undefined,
        branchId: addForm.branchId ? Number(addForm.branchId) : undefined,
      });
      setMsg("Terminal registered!"); setShowAddForm(false);
      setAddForm({ name: "", serialNumber: "", branchId: "" });
      load();
    } catch (err) { setError(err.message); }
  }

  async function handleSyncFromPaystack(psTerminal) {
    try {
      await createTerminal({
        paystackTerminalId: psTerminal.id,
        name: psTerminal.name || `Terminal ${psTerminal.terminal_id}`,
      });
      setMsg(`Synced "${psTerminal.name}" from Paystack!`);
      load();
    } catch (err) { setError(err.message); }
  }

  async function handleDeleteTerminal(id, name) {
    if (!confirm(`Remove terminal "${name}"?`)) return;
    try { await deleteTerminal(id); load(); } catch (err) { setError(err.message); }
  }

  async function handleCharge() {
    if (!chargeModal) return;
    setMsg(""); setError("");
    try {
      const result = await chargeTerminal(chargeModal.id, {
        amount: Number(chargeAmount),
        email: chargeEmail || undefined,
      });
      setActiveCharge(result);
      setChargeModal(null);
      // Start polling for status
      pollTxStatus(result.terminalTransaction.id);
    } catch (err) { setError(err.message); }
  }

  function pollTxStatus(txId) {
    setPolling(true);
    const interval = setInterval(async () => {
      try {
        const status = await getTerminalTxStatus(txId);
        if (status.status === "SUCCESS") {
          clearInterval(interval);
          setActiveCharge(prev => ({ ...prev, status: "SUCCESS" }));
          setMsg("✅ Payment successful!");
          setPolling(false);
          load();
        } else if (status.status === "FAILED") {
          clearInterval(interval);
          setActiveCharge(prev => ({ ...prev, status: "FAILED" }));
          setError("Payment failed.");
          setPolling(false);
        }
      } catch { }
    }, 3000);
    // Stop polling after 2 minutes
    setTimeout(() => { clearInterval(interval); setPolling(false); }, 120000);
  }

  async function handleRefreshTerminal(terminal) {
    try {
      const fresh = await getTerminal(terminal.id);
      setTerminals(prev => prev.map(t => t.id === terminal.id ? { ...t, ...fresh } : t));
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="page-panel">
      {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
      {msg && <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: 12, fontWeight: 600 }}>{msg}</div>}

      <div className="tabs">
        <button className={tab === "devices" ? "active" : ""} onClick={() => setTab("devices")}>📱 Devices ({terminals.length})</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>📋 Transaction History</button>
      </div>

      {/* ── DEVICES TAB ── */}
      {tab === "devices" && (
        <>
          <div className="panel-header" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => setShowAddForm(true)}>+ Register Terminal</button>
            <button className="btn secondary" onClick={load}>🔄 Refresh</button>
          </div>

          {/* Paystack terminals available to sync */}
          {paystackTerminals.length > 0 && (
            <div className="panel" style={{ borderLeft: '4px solid var(--accent, #16a34a)', marginTop: 12 }}>
              <h2 style={{ fontSize: '0.95rem' }}>🔗 Paystack Terminals Available</h2>
              <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 8 }}>These terminals are registered on your Paystack account but not yet linked to RHoSAM.</p>
              <div style={{ display: 'grid', gap: 8 }}>
                {paystackTerminals.map(pt => {
                  const alreadySynced = terminals.some(t => t.paystack_id === pt.id);
                  return (
                    <div key={pt.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div>
                        <strong>{pt.name}</strong>
                        <span className="muted" style={{ marginLeft: 8, fontSize: '0.8rem' }}>{pt.terminal_id}</span>
                        <span className={`status-badge ${pt.status === 'active' ? 'active' : 'inactive'}`} style={{ marginLeft: 8 }}>{pt.status}</span>
                      </div>
                      {alreadySynced ? (
                        <span className="muted" style={{ fontSize: '0.8rem' }}>✅ Linked</span>
                      ) : (
                        <button className="btn-sm" onClick={() => handleSyncFromPaystack(pt)}>Sync</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Registered terminals */}
          {loading ? <p className="loading">Loading…</p> : (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              {terminals.length ? (
                <table>
                  <thead><tr><th>Name</th><th>Code</th><th>Branch</th><th>Status</th><th>Online</th><th>Last Seen</th><th>Actions</th></tr></thead>
                  <tbody>{terminals.map(t => (
                    <tr key={t.id}>
                      <td><strong>{t.name}</strong></td>
                      <td><code>{t.terminal_code}</code></td>
                      <td>{t.branch_name || '—'}</td>
                      <td><span className={`status-badge ${t.status === 'active' ? 'active' : 'inactive'}`}>{t.status}</span></td>
                      <td>{t.is_online ? <span style={{ color: 'var(--success)' }}>🟢 Online</span> : <span style={{ color: 'var(--muted)' }}>🔴 Offline</span>}</td>
                      <td>{t.last_seen_at ? new Date(t.last_seen_at).toLocaleString() : 'Never'}</td>
                      <td>
                        <button className="btn-sm" onClick={() => handleRefreshTerminal(t)} title="Refresh status">🔄</button>
                        <button className="btn-sm" onClick={() => { setChargeModal(t); setChargeAmount(""); setChargeEmail(""); }} title="Charge">💳 Charge</button>
                        {isAdmin && <button className="btn-sm danger" onClick={() => handleDeleteTerminal(t.id, t.name)}>✕</button>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="muted">No terminals registered. Click "Register Terminal" or sync from Paystack above.</p>}
            </div>
          )}
        </>
      )}

      {/* ── TRANSACTION HISTORY TAB ── */}
      {tab === "history" && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          {txHistory.length ? (
            <table>
              <thead><tr><th>Date</th><th>Terminal</th><th>Reference</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead>
              <tbody>{txHistory.map(tx => (
                <tr key={tx.id}>
                  <td>{new Date(tx.created_at).toLocaleString()}</td>
                  <td>{tx.terminal_name || '—'}</td>
                  <td><code>{tx.reference}</code></td>
                  <td>{fmt(tx.amount)}</td>
                  <td><span className={`status-badge ${tx.status === 'SUCCESS' ? 'active' : tx.status === 'FAILED' ? 'inactive' : tx.status === 'PROCESSING' ? 'info' : 'warning'}`}>{tx.status}</span></td>
                  <td>{tx.receipt_number || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className="muted">No terminal transactions yet.</p>}
        </div>
      )}

      {/* ── ADD TERMINAL MODAL ── */}
      {showAddForm && (
        <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Register Terminal</h2>
            <form onSubmit={handleAddTerminal} className="form-grid">
              <label>Terminal Name<input value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} required placeholder="e.g. Front Counter Terminal" /></label>
              <label>Serial Number<input value={addForm.serialNumber} onChange={e => setAddForm({ ...addForm, serialNumber: e.target.value })} placeholder="Device serial number (optional)" /></label>
              <label>Branch
                <select value={addForm.branchId} onChange={e => setAddForm({ ...addForm, branchId: e.target.value })}>
                  <option value="">No Branch</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Register</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CHARGE MODAL ── */}
      {chargeModal && (
        <div className="modal-overlay" onClick={() => setChargeModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>💳 Charge: {chargeModal.name}</h2>
            <p className="muted" style={{ marginBottom: 12 }}>Send a payment request to this terminal. The customer will tap/insert their card on the device.</p>
            <form onSubmit={e => { e.preventDefault(); handleCharge(); }} className="form-grid">
              <label>Amount (₦)
                <input type="number" min="1" step="0.01" value={chargeAmount} onChange={e => setChargeAmount(e.target.value)} required autoFocus placeholder="Enter amount" style={{ fontSize: '1.2rem', fontWeight: 700 }} />
              </label>
              <label>Customer Email (optional)
                <input type="email" value={chargeEmail} onChange={e => setChargeEmail(e.target.value)} placeholder="For receipt (optional)" />
              </label>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setChargeModal(null)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={!chargeAmount || Number(chargeAmount) <= 0}>💳 Send to Terminal</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── ACTIVE CHARGE STATUS ── */}
      {activeCharge && (
        <div className="panel" style={{ marginTop: 16, borderLeft: `4px solid ${activeCharge.status === 'SUCCESS' ? 'var(--success)' : activeCharge.status === 'FAILED' ? 'var(--danger)' : 'var(--warning)'}` }}>
          <h2>⏳ Payment in Progress</h2>
          <div className="summary-grid" style={{ marginTop: 8 }}>
            <div className="summary-card"><span>Reference</span><strong><code>{activeCharge.reference}</code></strong></div>
            <div className="summary-card"><span>Amount</span><strong>{fmt(activeCharge.terminalTransaction?.amount)}</strong></div>
            <div className="summary-card">
              <span>Status</span>
              <strong style={{ color: activeCharge.status === 'SUCCESS' ? 'var(--success)' : activeCharge.status === 'FAILED' ? 'var(--danger)' : 'var(--warning)' }}>
                {activeCharge.status === 'SUCCESS' ? '✅ Success' : activeCharge.status === 'FAILED' ? '❌ Failed' : '⏳ Waiting for customer...'}
              </strong>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: '0.85rem' }}>{activeCharge.message}</p>
          {polling && <p className="muted" style={{ fontSize: '0.8rem' }}>🔄 Polling for payment status every 3 seconds…</p>}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="btn secondary" onClick={() => { setActiveCharge(null); setMsg(""); setError(""); }}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PAYMENT SETTINGS (Admin)
// ═══════════════════════════════════════════════════════════════════
function PaymentSettingsPage() {
  const { getPaymentSettings, updatePaymentSettings, user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // Form state — secrets start masked; we only send actual values when saving
  const [form, setForm] = useState({
    gateway: "INTERNAL",
    paystackSecretKey: "",
    paystackPublicKey: "",
    flutterwaveSecretKey: "",
    flutterwavePublicKey: "",
    webhookSecret: "",
    testMode: true,
  });
  const [showSecrets, setShowSecrets] = useState(false);

  useEffect(() => {
    getPaymentSettings()
      .then(s => {
        setSettings(s);
        setForm({
          gateway: s.gateway || "INTERNAL",
          paystackSecretKey: s.paystackSecretKeyFull || "",
          paystackPublicKey: s.paystackPublicKey || "",
          flutterwaveSecretKey: s.flutterwaveSecretKeyFull || "",
          flutterwavePublicKey: s.flutterwavePublicKey || "",
          webhookSecret: s.webhookSecretFull || "",
          testMode: s.testMode !== false,
        });
      })
      .catch(() => setSettings({ gateway: "INTERNAL", testMode: true }))
      .finally(() => setLoading(false));
  }, [getPaymentSettings]);

  async function handleSave(e) {
    e.preventDefault(); setSaving(true); setError(""); setMsg("");
    try {
      const result = await updatePaymentSettings(form);
      setMsg(result.message || "Saved!");
      // Reload to show masked values
      const fresh = await getPaymentSettings();
      setSettings(fresh);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="page-panel"><p className="loading">Loading payment settings…</p></div>;

  return (
    <div className="page-panel" style={{ maxWidth: 700 }}>
      <div className="panel">
        <h2>💳 Payment Gateway Settings</h2>
        <p className="muted" style={{ marginBottom: 16 }}>Configure which payment gateway to use for Card, Transfer, and POS transactions. Cash payments don't require a gateway.</p>

        {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
        {msg && <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: 12, fontWeight: 600 }}>{msg}</div>}

        {settings?.updatedAt && (
          <p className="muted" style={{ marginBottom: 12, fontSize: '0.8rem' }}>
            Last updated: {new Date(settings.updatedAt).toLocaleString('en-NG')}
          </p>
        )}

        <form onSubmit={handleSave} className="form-grid">
          {/* Gateway Selection */}
          <label>Active Gateway
            <select value={form.gateway} onChange={e => setForm({ ...form, gateway: e.target.value })}>
              <option value="INTERNAL">🔒 Internal (Cash Only — No Gateway)</option>
              <option value="PAYSTACK">💳 Paystack</option>
              <option value="FLUTTERWAVE">💳 Flutterwave</option>
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={form.testMode} onChange={e => setForm({ ...form, testMode: e.target.checked })} style={{ width: 'auto' }} />
            Test Mode (use sandbox/test API keys)
          </label>

          {/* Paystack Settings */}
          {form.gateway === "PAYSTACK" && (
            <>
              <div style={{ gridColumn: '1 / -1', marginTop: 8, padding: '8px 12px', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.85rem' }}>
                <strong>Paystack Configuration</strong>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.8rem' }}>Get your keys at <a href="https://dashboard.paystack.com/#/settings/keys" target="_blank" rel="noreferrer">dashboard.paystack.com</a></p>
              </div>
              <label>Secret Key
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    value={form.paystackSecretKey}
                    onChange={e => setForm({ ...form, paystackSecretKey: e.target.value })}
                    placeholder="sk_test_xxxxxxxx or sk_live_xxxxxxxx"
                    style={{ flex: 1, fontFamily: 'monospace' }}
                  />
                </div>
                {settings?.paystackSecretKey && <small className="muted">Current: {settings.paystackSecretKey}</small>}
              </label>
              <label>Public Key
                <input
                  type="text"
                  value={form.paystackPublicKey}
                  onChange={e => setForm({ ...form, paystackPublicKey: e.target.value })}
                  placeholder="pk_test_xxxxxxxx or pk_live_xxxxxxxx"
                  style={{ fontFamily: 'monospace' }}
                />
              </label>
            </>
          )}

          {/* Flutterwave Settings */}
          {form.gateway === "FLUTTERWAVE" && (
            <>
              <div style={{ gridColumn: '1 / -1', marginTop: 8, padding: '8px 12px', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.85rem' }}>
                <strong>Flutterwave Configuration</strong>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.8rem' }}>Get your keys at <a href="https://dashboard.flutterwave.com/dashboard/settings/apis" target="_blank" rel="noreferrer">dashboard.flutterwave.com</a></p>
              </div>
              <label>Secret Key
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    value={form.flutterwaveSecretKey}
                    onChange={e => setForm({ ...form, flutterwaveSecretKey: e.target.value })}
                    placeholder="FLWSECK-xxxxxxxx"
                    style={{ flex: 1, fontFamily: 'monospace' }}
                  />
                </div>
                {settings?.flutterwaveSecretKey && <small className="muted">Current: {settings.flutterwaveSecretKey}</small>}
              </label>
              <label>Public Key
                <input
                  type="text"
                  value={form.flutterwavePublicKey}
                  onChange={e => setForm({ ...form, flutterwavePublicKey: e.target.value })}
                  placeholder="FLWPUBK-xxxxxxxx"
                  style={{ fontFamily: 'monospace' }}
                />
              </label>
            </>
          )}

          {/* Webhook Secret (shown for both gateways) */}
          {form.gateway !== "INTERNAL" && (
            <label>Webhook Secret
              <input
                type={showSecrets ? 'text' : 'password'}
                value={form.webhookSecret}
                onChange={e => setForm({ ...form, webhookSecret: e.target.value })}
                placeholder="For verifying gateway callbacks"
                style={{ fontFamily: 'monospace' }}
              />
              {settings?.webhookSecret && <small className="muted">Current: {settings.webhookSecret}</small>}
            </label>
          )}

          {/* Show/hide secrets toggle */}
          {form.gateway !== "INTERNAL" && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={showSecrets} onChange={e => setShowSecrets(e.target.checked)} style={{ width: 'auto' }} />
              Show secret keys
            </label>
          )}

          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={saving}>{saving ? "Saving…" : "💾 Save Settings"}</button>
          </div>
        </form>

        {/* Webhook URLs */}
        {form.gateway !== "INTERNAL" && (
          <div style={{ marginTop: 20, padding: 16, background: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>📡 Webhook URLs</h3>
            <p className="muted" style={{ marginBottom: 8, fontSize: '0.8rem' }}>Add these URLs in your {form.gateway} dashboard to receive payment confirmations:</p>
            <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: 'var(--card-bg)', padding: 12, borderRadius: 6, border: '1px solid var(--border)', wordBreak: 'break-all' }}>
              <div style={{ marginBottom: 4 }}><strong>Paystack:</strong> {window.location.origin}/api/webhooks/paystack</div>
              <div><strong>Flutterwave:</strong> {window.location.origin}/api/webhooks/flutterwave</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// APP ROUTES
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/*" element={<AuthGate><Layout>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/pos" element={<POSPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/damages" element={<DamagesPage />} />
          <Route path="/wastage" element={<WastagePage />} />
          <Route path="/stock-valuation" element={<StockValuationPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/procurement" element={<ProcurementPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/executive" element={<ExecutiveDashboard />} />
          <Route path="/forecast" element={<ForecastPage />} />
          <Route path="/reorder" element={<AutoReorderPage />} />
          <Route path="/dailyreport" element={<ReportsPage />} />
          <Route path="/cashdrawer" element={<CashDrawerPage />} />
          <Route path="/display" element={<CustomerDisplayPage />} />
          <Route path="/supplierportal" element={<SupplierPortalPage />} />
          <Route path="/branches" element={<BranchesPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/transfers" element={<StockTransfersPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/loginhistory" element={<LoginHistoryPage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/mfa" element={<MfaSetupPage />} />
          <Route path="/wifiqr" element={<WifiQRPage />} />
          <Route path="/expiry" element={<ExpiryTrackingPage />} />
          <Route path="/import-export" element={<BulkImportExportPage />} />
          <Route path="/audit-cycle" element={<InventoryAuditPage />} />
          <Route path="/alerts" element={<StockAlertsPage />} />
          <Route path="/notifications" element={<NotificationCenterPage />} />           <Route path="/notification-prefs" element={<NotificationPreferencesPage />} />
           <Route path="/payment-settings" element={<PaymentSettingsPage />} />
           <Route path="/terminals" element={<TerminalPage />} />
           <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout></AuthGate>} />
    </Routes>
  );
}
