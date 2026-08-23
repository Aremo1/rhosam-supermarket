import React, { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import QRCode from "qrcode";
import { useAuth } from "./AuthContext";
import { generateReceiptPDF } from "./generateReceiptPDF";
import "./App.css";

// ═══════════════════════════════════════════════════════════════════
// LAYOUT
// ═══════════════════════════════════════════════════════════════════
const MENUS = {
  ADMIN: ["dashboard","executive","pos","products","inventory","sales","customers","suppliers","procurement","expenses","finance","forecast","reorder","dailyreport","cashdrawer","branches","display","supplierportal","users","audit","loginhistory","change-password","mfa","wifiqr"],
  MANAGER: ["dashboard","pos","products","inventory","sales","customers","suppliers","procurement","expenses","finance","forecast","reorder","dailyreport","cashdrawer","change-password","mfa","wifiqr"],
  CASHIER: ["dashboard","pos","cashdrawer","sales","change-password","wifiqr"],
};
const LABELS = {
  dashboard: "Dashboard", executive: "Executive", pos: "Point of Sale", products: "Products", inventory: "Inventory",
  sales: "Sales History", customers: "Customers", suppliers: "Suppliers", procurement: "Purchase Orders",
  expenses: "Expenses", finance: "Finance", forecast: "AI Forecast", reorder: "Auto Reorder",
  dailyreport: "Reports", users: "User Management", audit: "Audit Logs",
  cashdrawer: "Cash Drawer", branches: "Branches", display: "Customer Display", supplierportal: "Supplier Portal",
  "change-password": "Change Password", mfa: "MFA / Security", loginhistory: "Login History", wifiqr: "Wi-Fi QR",
};
const ICONS = {
  dashboard: "📊", executive: "🎯", pos: "🛒", products: "📦", inventory: "📋", sales: "💰", customers: "👥",
  suppliers: "🏭", procurement: "📥", expenses: "💸", finance: "🏦", forecast: "🤖", reorder: "🔄",
  dailyreport: "📈", users: "👤", audit: "📝",
  cashdrawer: "💵", branches: "🏢", display: "🖥️", supplierportal: "🏭",
  "change-password": "🔐", mfa: "🛡️", loginhistory: "🕐", wifiqr: "📶",
};

function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("rhosam-theme") === "dark");
  const currentPage = location.pathname.slice(1) || "dashboard";
  const menuItems = MENUS[user?.role] || MENUS.CASHIER;

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

      <div className={`sidebar-overlay ${sidebarOpen ? "show" : ""}`} onClick={() => setSidebarOpen(false)} />

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
            <span className="user-badge">{user?.name} · <span className="role-tag">{user?.role}</span></span>
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
  const { fetchDashboard, fetchTopProducts, fetchCategorySales } = useAuth();
  const [stats, setStats] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [catSales, setCatSales] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, tp, cs] = await Promise.all([fetchDashboard(), fetchTopProducts(), fetchCategorySales()]);
      setStats(s); setTopProducts(tp); setCatSales(cs);
    } catch { }
    finally { setLoading(false); }
  }, [fetchDashboard, fetchTopProducts, fetchCategorySales]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="loading">Loading dashboard…</div>;
  if (!stats) return <div className="error-msg">Failed to load dashboard.</div>;

  const fmt = (n) => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });

  return (
    <div className="dashboard">
      <div className="summary-grid">
        <div className="summary-card accent"><span>Today's Sales</span><strong>{stats.todaySales}</strong><small>{fmt(stats.todayRevenue)}</small></div>
        <div className="summary-card"><span>Total Revenue</span><strong>{fmt(stats.totalRevenue)}</strong></div>
        <div className="summary-card"><span>Products</span><strong>{stats.totalProducts}</strong></div>
        <div className="summary-card warning"><span>Low Stock</span><strong>{stats.lowStockCount}</strong></div>
        <div className="summary-card"><span>Total Transactions</span><strong>{stats.totalSales}</strong></div>
        <div className="summary-card"><span>Active Users</span><strong>{stats.totalUsers}</strong></div>
      </div>

      {/* Sales Trend Chart (CSS bars) */}
      <div className="panel">
        <h2>Sales Trend (Last 30 Days)</h2>
        <div className="chart-bars">
          {(stats.salesChart || []).map((d, i) => {
            const maxRev = Math.max(...(stats.salesChart || []).map(x => x.revenue || 1));
            const pct = ((d.revenue || 0) / maxRev) * 100;
            return (
              <div key={i} className="bar-col" title={`${new Date(d.day).toLocaleDateString()}: ₦${Number(d.revenue).toLocaleString()} (${d.count} sales)`}>
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
          <h2>Top Products (30 Days)</h2>
          <table><thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th></tr></thead>
            <tbody>{topProducts.map((p, i) => (
              <tr key={i}><td>{p.product_name}</td><td>{p.total_qty}</td><td>{fmt(p.total_revenue)}</td></tr>
            ))}</tbody>
          </table>
          {!topProducts.length && <p className="muted">No sales yet.</p>}
        </div>

        <div className="panel">
          <h2>Sales by Category</h2>
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
  const { fetchProducts, createSale, fetchCustomers, emailReceipt } = useAuth();
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState("");
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [customerId, setCustomerId] = useState(null);
  const [payment, setPayment] = useState("Cash");
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [scanFeedback, setScanFeedback] = useState(null);
  const searchRef = useRef(null);
  const scanTimeoutRef = useRef(null);

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

  useEffect(() => { fetchProducts().then(setProducts).catch(() => {}); fetchCustomers().then(setCustomers).catch(() => {}); }, [fetchProducts, fetchCustomers]);

  // Auto-focus search on mount and after cart changes
  useEffect(() => { searchRef.current?.focus(); }, [cart, receipt]);

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.barcode.includes(search) ||
    p.category.toLowerCase().includes(search.toLowerCase())
  );

  function addToCart(product, fromScan = false) {
    if (product.stock <= 0) { setError(`${product.name} is out of stock!`); return; }
    setCart(prev => {
      const existing = prev.find(c => c.productId === product.id);
      if (existing) return prev.map(c => c.productId === product.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { productId: product.id, name: product.name, price: product.price, quantity: 1, discount: 0 }];
    });
    setError("");
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
    if (product && qty > product.stock) {
      setError(`Maximum stock for ${product.name} is ${product.stock}`);
      setTimeout(() => setError(""), 2000);
      setCart(prev => prev.map(c => c.productId === productId ? { ...c, quantity: product.stock } : c));
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
      setReceipt(result);
      setCart([]); setCustomerName("Walk-in Customer"); setCustomerId(null);
      setDiscount(0); setTax(0); setAmountPaid("");
      fetchProducts().then(setProducts).catch(() => {});
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
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

  if (receipt) {
    return (
      <div className="receipt-view">
        <div className="receipt">
          <h2>🛍️ RHoSAM Supermarket</h2>
          <p className="muted">Receipt: {receipt.receiptNumber}</p>
          <p className="muted">Cashier: {receipt.cashierName}</p>
          <p className="muted">Customer: {receipt.customerName}</p>
          <p className="muted">Payment: {receipt.paymentMethod}</p>
          <hr />
          {receipt.items?.map((item, i) => (
            <div key={i} className="receipt-line">
              <span>{item.name} × {item.quantity}</span>
              <span>₦{Number(item.lineTotal).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
            </div>
          ))}
          <hr />
          <div className="receipt-line"><span>Subtotal</span><span>₦{Number(receipt.subtotal).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>
          {receipt.discount > 0 && <div className="receipt-line"><span>Discount</span><span>-₦{Number(receipt.discount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>}
          {receipt.tax > 0 && <div className="receipt-line"><span>Tax</span><span>₦{Number(receipt.tax).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>}
          <div className="receipt-line receipt-total"><span><strong>TOTAL</strong></span><strong>₦{Number(receipt.total).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</strong></div>
          {receipt.amountPaid > 0 && <div className="receipt-line"><span>Paid</span><span>₦{Number(receipt.amountPaid).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>}
          {receipt.change_amount > 0 && <div className="receipt-line"><span>Change</span><span>₦{Number(receipt.change_amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>}
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
          <div className="receipt-actions no-print">
            <button onClick={() => generateReceiptPDF(receipt)}>📄 Download PDF</button>
            <button onClick={() => window.print()}>🖨️ Print</button>
            <button onClick={() => { setReceipt(null); setReceiptEmail(""); setEmailMsg(""); }}>🛒 New Sale</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pos-layout">
      {scanFeedback && (
        <div className="scan-toast" key={scanFeedback.id}>
          <span className="scan-toast-icon">✓</span>
          <span className="scan-toast-text">{scanFeedback.name} — ₦{Number(scanFeedback.price).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
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
        <div className="product-grid">
          {filtered.map(p => (
            <div key={p.id} className={`product-card ${p.stock <= 0 ? "out-of-stock" : ""}`} onClick={() => p.stock > 0 && addToCart(p)}>
              {p.image_url && <img src={`${(import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(/\/api$/, "")}${p.image_url}`} alt={p.name} className="product-card-image" />}
              <div className="product-card-header">
                <strong>{p.name}</strong>
                <small>{p.barcode}</small>
              </div>
              <div className="product-card-meta">
                <span className="category-tag">{p.category}</span>
                <span className={`stock-tag ${p.stock <= p.reorder_level ? "low" : ""}`}>{p.stock} in stock</span>
              </div>
              <div className="product-card-price">₦{Number(p.price).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</div>
            </div>
          ))}
          {!filtered.length && <p className="muted">No products found.</p>}
        </div>
      </div>

      <div className="pos-cart">
        <h2>🛒 Cart ({cart.length})</h2>
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
          {cart.map(item => (
            <div key={item.productId} className="cart-item">
              <div>
                <strong>{item.name}</strong>
                <small>₦{Number(item.price).toLocaleString("en-NG", { minimumFractionDigits: 2 })} each</small>
              </div>
              <div className="quantity-controls">
                <button onClick={() => updateQty(item.productId, item.quantity - 1)}>−</button>
                <span>{item.quantity}</span>
                <button onClick={() => updateQty(item.productId, item.quantity + 1)}>+</button>
              </div>
              <div className="cart-item-total">₦{Number(item.price * item.quantity).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</div>
            </div>
          ))}
        </div>

        <div className="cart-summary">
          <label>Payment Method
            <select value={payment} onChange={e => setPayment(e.target.value)}>
              <option value="Cash">Cash</option>
              <option value="Card">Card</option>
              <option value="Transfer">Transfer</option>
              <option value="POS">POS</option>
            </select>
          </label>
          <div className="summary-row"><span>Subtotal</span><span>₦{subtotal.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>
          <label>Discount<input type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(Number(e.target.value))} /></label>
          <label>Tax<input type="number" min="0" step="0.01" value={tax} onChange={e => setTax(Number(e.target.value))} /></label>
          <div className="summary-row total"><span>TOTAL</span><strong>₦{total.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</strong></div>
          <label>Amount Paid<input type="number" min="0" step="0.01" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} placeholder={total.toFixed(2)} /></label>
          {Number(amountPaid) > total && (
            <div className="summary-row"><span>Change</span><span className="change">₦{(Number(amountPaid) - total).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>
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
  const { fetchProducts, createProduct, updateProduct, deleteProduct, uploadProductImage, user } = useAuth();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const isAdmin = ["ADMIN", "MANAGER"].includes(user?.role);

  const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(/\/api$/, "");
  const formDefault = { barcode: "", name: "", category: "", price: "", costPrice: "", stock: "", reorderLevel: "5", unit: "PCS", description: "" };
  const [form, setForm] = useState(formDefault);

  const load = useCallback(async () => {
    try { setProducts(await fetchProducts(search)); } catch { }
    finally { setLoading(false); }
  }, [fetchProducts, search]);

  useEffect(() => { load(); }, [load]);

  function startEdit(p) {
    setEditProduct(p); setForm({ barcode: p.barcode, name: p.name, category: p.category, price: p.price, costPrice: p.cost_price || 0, stock: p.stock, reorderLevel: p.reorder_level, unit: p.unit || "PCS", description: p.description || "" });
    setImageFile(null); setImagePreview(p.image_url ? `${API_BASE}${p.image_url}` : null);
    setShowForm(true);
  }
  function startNew() { setEditProduct(null); setForm(formDefault); setImageFile(null); setImagePreview(null); setShowForm(true); }

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
              <label>Barcode<input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} required /></label>
              <label>Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
              <label>Category<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} required /></label>
              <label>Price (₦)<input type="number" step="0.01" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} required /></label>
              <label>Cost Price (₦)<input type="number" step="0.01" min="0" value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} /></label>
              <label>Stock<input type="number" min="0" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} /></label>
              <label>Reorder Level<input type="number" min="0" value={form.reorderLevel} onChange={e => setForm({ ...form, reorderLevel: e.target.value })} /></label>
              <label>Unit<select value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                <option>PCS</option><option>KG</option><option>LTR</option><option>BOX</option><option>CARTON</option><option>BAG</option>
              </select></label>
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
        <div className="table-wrap">
          <table>
            <thead><tr><th>Image</th><th>Barcode</th><th>Name</th><th>Category</th><th>Price</th><th>Cost</th><th>Stock</th><th>Reorder</th><th>Unit</th><th>Status</th>{isAdmin && <th>Actions</th>}</tr></thead>
            <tbody>{products.map(p => (
              <tr key={p.id}>
                <td>{p.image_url ? <img src={`${API_BASE}${p.image_url}`} alt={p.name} className="product-thumb" /> : <span className="no-image">—</span>}</td>
                <td><code>{p.barcode}</code></td><td>{p.name}</td><td>{p.category}</td>
                <td>₦{Number(p.price).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                <td>₦{Number(p.cost_price || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                <td className={p.stock <= p.reorder_level ? "low-stock" : ""}>{p.stock}</td>
                <td>{p.reorder_level}</td><td>{p.unit}</td>
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
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INVENTORY (Phase 3)
// ═══════════════════════════════════════════════════════════════════
function InventoryPage() {
  const { fetchProducts, fetchLowStock, adjustStock, fetchInventoryMovements } = useAuth();
  const [tab, setTab] = useState("stock");
  const [products, setProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adjustModal, setAdjustModal] = useState(null);
  const [adjForm, setAdjForm] = useState({ quantity: "", type: "STOCK_IN", notes: "" });

  const load = useCallback(async () => {
    try {
      const [p, ls, mv] = await Promise.all([fetchProducts(), fetchLowStock(), fetchInventoryMovements()]);
      setProducts(p); setLowStock(ls); setMovements(mv);
    } catch { }
    finally { setLoading(false); }
  }, [fetchProducts, fetchLowStock, fetchInventoryMovements]);

  useEffect(() => { load(); }, [load]);

  async function handleAdjust(e) {
    e.preventDefault();
    try {
      await adjustStock(adjustModal.id, { ...adjForm, quantity: Number(adjForm.quantity) });
      setAdjustModal(null); setAdjForm({ quantity: "", type: "STOCK_IN", notes: "" });
      load();
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="page-panel">
      <div className="tabs">
        <button className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}>Stock Levels</button>
        <button className={tab === "low" ? "active" : ""} onClick={() => setTab("low")}>Low Stock ({lowStock.length})</button>
        <button className={tab === "movements" ? "active" : ""} onClick={() => setTab("movements")}>Movements</button>
      </div>

      {loading ? <p className="loading">Loading…</p> : (
        <>
          {tab === "stock" && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Reorder Level</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>{products.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td><td>{p.category}</td>
                    <td className={p.stock <= p.reorder_level ? "low-stock" : ""}>{p.stock}</td>
                    <td>{p.reorder_level}</td>
                    <td><span className={`status-badge ${p.stock > p.reorder_level ? "active" : "warning"}`}>{p.stock <= p.reorder_level ? "⚠ Low" : "✓ OK"}</span></td>
                    <td><button className="btn-sm" onClick={() => setAdjustModal(p)}>Adjust</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {tab === "low" && (
            <div className="table-wrap">
              {lowStock.length ? (
                <table><thead><tr><th>Product</th><th>Barcode</th><th>Stock</th><th>Reorder Level</th><th>Price</th></tr></thead>
                  <tbody>{lowStock.map(p => (
                    <tr key={p.id} className="low-stock-row">
                      <td>{p.name}</td><td>{p.barcode}</td>
                      <td className="low-stock">{p.stock}</td><td>{p.reorder_level}</td>
                      <td>₦{Number(p.price).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
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
// SALES (Phase 5)
// ═══════════════════════════════════════════════════════════════════
function SalesPage() {
  const { fetchSales, getSale, returnSale, user } = useAuth();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo + "T23:59:59";
      setSales(await fetchSales(Object.keys(params).length ? params : undefined));
    } catch { }
    finally { setLoading(false); }
  }, [fetchSales, dateFrom, dateTo]);

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
                <td><strong>₦{Number(s.total).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</strong></td>
                <td>
                  <button className="btn-sm" onClick={() => viewDetail(s.id)}>View</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!sales.length && <p className="muted">No sales found.</p>}
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
              <p><strong>Payment:</strong> {detail.payment_method}</p>
              <table><thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Discount</th><th>Total</th><th></th></tr></thead>
                <tbody>{detail.items?.map((item, i) => (
                  <tr key={i}>
                    <td>{item.product_name}</td>
                    <td>₦{Number(item.unit_price).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                    <td>{item.quantity}</td>
                    <td>{item.discount ? `₦${Number(item.discount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}` : "—"}</td>
                    <td>₦{Number(item.line_total).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                    <td>{["ADMIN", "MANAGER"].includes(user?.role) && (
                      <button className="btn-sm danger" onClick={() => handleReturn(detail.id, item.product_id, item.quantity)}>Return</button>
                    )}</td>
                  </tr>
                ))}</tbody>
              </table>
              <hr />
              <div className="sale-totals">
                <p>Subtotal: ₦{Number(detail.subtotal).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p>
                {detail.discount > 0 && <p>Discount: -₦{Number(detail.discount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p>}
                {detail.tax > 0 && <p>Tax: ₦{Number(detail.tax).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p>}
                <p><strong>Total: ₦{Number(detail.total).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</strong></p>
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
  const { fetchCustomers, createCustomer, updateCustomer } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editCust, setEditCust] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });

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

  const tierColor = { BRONZE: "bronze", SILVER: "silver", GOLD: "gold", PLATINUM: "platinum" };

  return (
    <div className="page-panel">
      <div className="panel-header"><button className="btn primary" onClick={startNew}>+ Add Customer</button></div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editCust ? "Edit Customer" : "New Customer"}</h2>
            <form onSubmit={handleSubmit} className="form-grid">
              <label>Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
              <label>Email<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
              <label>Phone<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
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
                <td>₦{Number(c.total_spent).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                <td>{c.visit_count}</td>
                <td><button className="btn-sm" onClick={() => startEdit(c)}>Edit</button></td>
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
  const { fetchPurchaseOrders, createPurchaseOrder, updatePOStatus, fetchSuppliers, fetchProducts } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ supplierId: "", notes: "", expectedDate: "", items: [{ productId: "", quantity: "", unitCost: "" }] });

  const load = useCallback(async () => {
    try {
      const [o, s, p] = await Promise.all([fetchPurchaseOrders(), fetchSuppliers(), fetchProducts()]);
      setOrders(o); setSuppliers(s); setProducts(p);
    } catch { }
    finally { setLoading(false); }
  }, [fetchPurchaseOrders, fetchSuppliers, fetchProducts]);

  useEffect(() => { load(); }, [load]);

  function addItem() { setForm({ ...form, items: [...form.items, { productId: "", quantity: "", unitCost: "" }] }); }
  function removeItem(i) { setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) }); }
  function updateItem(i, field, val) { setForm({ ...form, items: form.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item) }); }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      await createPurchaseOrder({
        supplierId: Number(form.supplierId),
        notes: form.notes,
        expectedDate: form.expectedDate || null,
        items: form.items.filter(i => i.productId && i.quantity).map(i => ({ productId: Number(i.productId), quantity: Number(i.quantity), unitCost: Number(i.unitCost) })),
      });
      setShowForm(false); load();
    } catch (err) { alert(err.message); }
  }

  async function handleStatus(id, status) {
    try { await updatePOStatus(id, status); load(); } catch (err) { alert(err.message); }
  }

  const statusColor = { PENDING: "warning", APPROVED: "info", RECEIVED: "active", CANCELLED: "inactive" };

  return (
    <div className="page-panel">
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
                <td>₦{Number(o.total).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                <td><span className={`status-badge ${statusColor[o.status] || ""}`}>{o.status}</span></td>
                <td>{new Date(o.created_at).toLocaleDateString()}</td>
                <td>
                  {o.status === "PENDING" && <button className="btn-sm" onClick={() => handleStatus(o.id, "APPROVED")}>Approve</button>}
                  {o.status === "APPROVED" && <button className="btn-sm" onClick={() => handleStatus(o.id, "RECEIVED")}>Receive</button>}
                  {(o.status === "PENDING" || o.status === "APPROVED") && <button className="btn-sm danger" onClick={() => handleStatus(o.id, "CANCELLED")}>Cancel</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!orders.length && <p className="muted">No purchase orders yet.</p>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EXPENSES (Phase 13)
// ═══════════════════════════════════════════════════════════════════
function ExpensesPage() {
  const { fetchExpenses, createExpense } = useAuth();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: "", description: "", amount: "", paymentMethod: "Cash", reference: "" });

  const load = useCallback(async () => { try { setExpenses(await fetchExpenses()); } catch { } finally { setLoading(false); } }, [fetchExpenses]);
  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    try { await createExpense({ ...form, amount: Number(form.amount) }); setShowForm(false); setForm({ category: "", description: "", amount: "", paymentMethod: "Cash", reference: "" }); load(); }
    catch (err) { alert(err.message); }
  }

  return (
    <div className="page-panel">
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
                <td>₦{Number(e.amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
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
  const { fetchFinanceSummary } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchFinanceSummary().then(setSummary).catch(() => {}).finally(() => setLoading(false)); }, [fetchFinanceSummary]);

  const fmt = (n) => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });

  if (loading) return <p className="loading">Loading…</p>;
  if (!summary) return <p className="error-msg">Failed to load financial summary.</p>;

  return (
    <div className="finance-page">
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

  const fmt = (n) => "\u20A6" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });
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
  const { fetchAutoReorderSuggestions, createAutoReorder } = useAuth();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState({});
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setSuggestions(await fetchAutoReorderSuggestions()); }
    catch { setSuggestions([]); }
    finally { setLoading(false); }
  }, [fetchAutoReorderSuggestions]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => "\u20A6" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });

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
  const { fetchExecutiveOverview } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchExecutiveOverview().then(setData).catch(() => {}).finally(() => setLoading(false)); }, [fetchExecutiveOverview]);

  const fmt = (n) => "\u20A6" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });

  if (loading) return <p className="loading">Loading executive dashboard...</p>;
  if (!data) return <div className="error-msg">Failed to load data.</div>;

  return (
    <div className="dashboard">
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

  const fmt = (n) => "\u20A6" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });

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
        <div className="receipt" style={{ maxWidth: 500, marginTop: 20, background: 'white', padding: 24, borderRadius: 12 }}>
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

  const fmt = (n) => "\u20A6" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });
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
  const { fetchDailyReport, emailDailyReport, fetchMonthlyReport, fetchProductSales, fetchLowStockReport, fetchCashierSales } = useAuth();
  const [tab, setTab] = useState("daily");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  // Filters
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [year, setYear] = useState(new Date().getFullYear());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Email
  const [emailTo, setEmailTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");

  const fmt = (n) => "\u20A6" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });

  const load = useCallback(async () => {
    setLoading(true); setSendMsg("");
    try {
      let result;
      switch (tab) {
        case "daily": result = await fetchDailyReport(date); break;
        case "monthly": result = await fetchMonthlyReport(year); break;
        case "products": result = await fetchProductSales(dateFrom && dateTo ? { from: dateFrom, to: dateTo } : null); break;
        case "lowstock": result = await fetchLowStockReport(); break;
        case "cashiers": result = await fetchCashierSales(dateFrom && dateTo ? { from: dateFrom, to: dateTo } : null); break;
      }
      setData(result);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [tab, date, year, dateFrom, dateTo, fetchDailyReport, fetchMonthlyReport, fetchProductSales, fetchLowStockReport, fetchCashierSales]);

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
  const { fetchUsers, createUser, updateUser, deleteUser, downloadBackup, user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "CASHIER" });

  const load = useCallback(async () => { try { setUsers(await fetchUsers()); } catch { } finally { setLoading(false); } }, [fetchUsers]);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    try { await createUser(form); setShowForm(false); setForm({ name: "", email: "", password: "", role: "CASHIER" }); load(); }
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
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Create User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <p className="loading">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Failed Attempts</th><th>Locked Until</th><th>Last Login</th><th>Actions</th></tr></thead>
            <tbody>{users.map(u => (
              <tr key={u.id}>
                <td>{u.name} {u.id === user?.id && <span className="you-badge">You</span>}</td>
                <td>{u.email}</td>
                <td>
                  <select value={u.role} onChange={e => changeRole(u, e.target.value)} disabled={u.id === user?.id}>
                    <option value="CASHIER">CASHIER</option><option value="MANAGER">MANAGER</option><option value="ADMIN">ADMIN</option>
                  </select>
                </td>
                <td><span className={`status-badge ${u.is_active ? "active" : "inactive"}`}>{u.is_active ? "Active" : "Inactive"}</span></td>
                <td className={u.failed_login_attempts >= 3 ? "low-stock" : ""}>{u.failed_login_attempts}</td>
                <td>{u.locked_until ? new Date(u.locked_until).toLocaleString() : "—"}</td>
                <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}</td>
                <td className="actions-cell">
                  {u.id !== user?.id && (
                    <>
                      <button className="btn-sm" onClick={() => toggleActive(u)}>{u.is_active ? "Deactivate" : "Activate"}</button>
                      {u.locked_until && <button className="btn-sm warning" onClick={() => unlockUser(u)}>Unlock</button>}
                      {u.id !== user?.id && <button className="btn-sm danger" onClick={() => handleDelete(u)}>Delete</button>}
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
  const { fetchAuditLogs } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchAuditLogs(500).then(setLogs).catch(() => {}).finally(() => setLoading(false)); }, [fetchAuditLogs]);

  return (
    <div className="page-panel">
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
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CASH DRAWER
// ═══════════════════════════════════════════════════════════════════
function CashDrawerPage() {
  const { getActiveDrawer, openDrawer, closeDrawer, fetchCashDrawers, user } = useAuth();
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

  const load = useCallback(async () => {
    try {
      const [active, hist] = await Promise.all([getActiveDrawer(), fetchCashDrawers()]);
      setActiveDrawer(active); setHistory(hist);
    } catch { }
    finally { setLoading(false); }
  }, [getActiveDrawer, fetchCashDrawers]);

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

  const fmt = (n) => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });

  if (loading) return <p className="loading">Loading…</p>;

  return (
    <div className="page-panel">
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
              <div style={{ width: 240, height: 240, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', borderRadius: 12 }}>
                <div className="spinner" />
              </div>
            )}
          </div>
          <details style={{ marginTop: 12 }}>
            <summary className="muted" style={{ cursor: 'pointer', fontSize: '0.85rem' }}>Can't scan? Enter secret manually</summary>
            <div style={{ background: '#f3f4f6', padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: '0.9rem', wordBreak: 'break-all', margin: '8px 0' }}>
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
              <div style={{ background: '#f3f4f6', padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: '0.85rem' }}>
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
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [encryption, setEncryption] = useState("WPA");
  const [hidden, setHidden] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("rhosam-theme") === "dark");
  const [error, setError] = useState("");

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
              </div>
              <div style={{ marginTop: 12 }}>
                <p className="muted" style={{ fontSize: '0.8rem' }}>Scan this code with any phone camera to connect automatically</p>
              </div>
            </>
          ) : (
            <div style={{ width: 280, height: 280, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', borderRadius: 12, border: '1px dashed var(--border)' }}>
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
          <Route path="/inventory" element={<InventoryPage />} />
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
          <Route path="/users" element={<UsersPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/loginhistory" element={<LoginHistoryPage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/mfa" element={<MfaSetupPage />} />
          <Route path="/wifiqr" element={<WifiQRPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout></AuthGate>} />
    </Routes>
  );
}
