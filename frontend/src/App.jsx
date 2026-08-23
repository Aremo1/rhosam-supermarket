import React, { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import "./App.css";

// ═══════════════════════════════════════════════════════════════════
// LAYOUT
// ═══════════════════════════════════════════════════════════════════
const MENUS = {
  ADMIN: ["dashboard","pos","products","inventory","sales","customers","suppliers","procurement","expenses","finance","cashdrawer","branches","users","audit"],
  MANAGER: ["dashboard","pos","products","inventory","sales","customers","suppliers","procurement","expenses","finance","cashdrawer"],
  CASHIER: ["dashboard","pos","cashdrawer","sales"],
};
const LABELS = {
  dashboard: "Dashboard", pos: "Point of Sale", products: "Products", inventory: "Inventory",
  sales: "Sales History", customers: "Customers", suppliers: "Suppliers", procurement: "Purchase Orders",
  expenses: "Expenses", finance: "Finance", users: "User Management", audit: "Audit Logs",
  cashdrawer: "Cash Drawer", branches: "Branches",
};
const ICONS = {
  dashboard: "📊", pos: "🛒", products: "📦", inventory: "📋", sales: "💰", customers: "👥",
  suppliers: "🏭", procurement: "📥", expenses: "💸", finance: "🏦", users: "👤", audit: "📝",
  cashdrawer: "💵", branches: "🏢",
};

function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const currentPage = location.pathname.slice(1) || "dashboard";
  const menuItems = MENUS[user?.role] || MENUS.CASHIER;

  return (
    <div className="app-layout">
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
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <h1 className="page-title">{LABELS[currentPage] || "RHoSAM"}</h1>
          <div className="topbar-right">
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
    try { await login(email, password); navigate("/dashboard"); }
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
  const { fetchProducts, createSale, fetchCustomers } = useAuth();
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState("");
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [customerId, setCustomerId] = useState(null);
  const [payment, setPayment] = useState("Cash");
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
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
          <div className="receipt-actions no-print">
            <button onClick={() => window.print()}>🖨️ Print</button>
            <button onClick={() => setReceipt(null)}>🛒 New Sale</button>
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
  const { fetchProducts, createProduct, updateProduct, deleteProduct, user } = useAuth();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const isAdmin = ["ADMIN", "MANAGER"].includes(user?.role);

  const formDefault = { barcode: "", name: "", category: "", price: "", costPrice: "", stock: "", reorderLevel: "5", unit: "PCS", description: "" };
  const [form, setForm] = useState(formDefault);

  const load = useCallback(async () => {
    try { setProducts(await fetchProducts(search)); } catch { }
    finally { setLoading(false); }
  }, [fetchProducts, search]);

  useEffect(() => { load(); }, [load]);

  function startEdit(p) { setEditProduct(p); setForm({ barcode: p.barcode, name: p.name, category: p.category, price: p.price, costPrice: p.cost_price || 0, stock: p.stock, reorderLevel: p.reorder_level, unit: p.unit || "PCS", description: p.description || "" }); setShowForm(true); }
  function startNew() { setEditProduct(null); setForm(formDefault); setShowForm(true); }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editProduct) { await updateProduct(editProduct.id, form); }
      else { await createProduct(form); }
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
            <thead><tr><th>Barcode</th><th>Name</th><th>Category</th><th>Price</th><th>Cost</th><th>Stock</th><th>Reorder</th><th>Unit</th><th>Status</th>{isAdmin && <th>Actions</th>}</tr></thead>
            <tbody>{products.map(p => (
              <tr key={p.id}>
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
// USER MANAGEMENT (Phase 8)
// ═══════════════════════════════════════════════════════════════════
function UsersPage() {
  const { fetchUsers, createUser, updateUser, deleteUser, user } = useAuth();
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
      <div className="panel-header"><button className="btn primary" onClick={() => setShowForm(true)}>+ Add User</button></div>

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
// APP ROUTES
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
          <Route path="/cashdrawer" element={<CashDrawerPage />} />
          <Route path="/branches" element={<BranchesPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout></AuthGate>} />
    </Routes>
  );
}
