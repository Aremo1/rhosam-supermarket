// ═══════════════════════════════════════════════════════════════════
// Store Commerce-Style Cashier POS
// Full-screen touch-optimized interface with:
// - Top status bar (clock, cashier, shift, scanner)
// - Large product grid with quick-add
// - Cart with hold/recall, loyalty points, layaway
// - Quick-tender payment buttons
// - Customer display mode
// ═══════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useRef } from "react";

function resolveApiUrl(val) {
  if (!val) return "/api";
  if (!/^https?:\/\//.test(val) && !val.startsWith("/")) return `https://${val}/api`;
  if (!/^https?:\/\//.test(val) && val.startsWith("/")) return val;
  return val;
}

export default function CashierPOSPage({ auth }) {
  const {
    fetchProducts, createSale, fetchCustomers, emailReceipt, smsReceipt,
    verifyPayment, initializePayment, getGatewayStatus, getActiveDrawer,
    user, notifyDataChange, validateGiftCard, validateCoupon, redeemGiftCard,
    fetchBundles, getActiveShift, getLoyaltyPoints, createLayawayOrder,
    earnLoyaltyPoints
  } = auth;

  // ── State ─────────────────────────────────────────────────────
  const [products, setProducts] = useState([]);
  const [drawerOk, setDrawerOk] = useState(null);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
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
  const [showPayModal, setShowPayModal] = useState(false);
  const searchRef = useRef(null);
  const scanTimeoutRef = useRef(null);

  // Gift Card state
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCard, setGiftCard] = useState(null);
  const [giftCardError, setGiftCardError] = useState("");
  const [giftCardAmount, setGiftCardAmount] = useState("");
  // Coupon state
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState(null);
  const [couponError, setCouponError] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  // Product detail modal
  const [selectedProduct, setSelectedProduct] = useState(null);
  // Bundles
  const [bundles, setBundles] = useState([]);
  // Payment gateway
  const [gatewayStatus, setGatewayStatus] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null);
  const [paymentVerifying, setPaymentVerifying] = useState(false);
  const [paymentReference, setPaymentReference] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  // Receipt email/SMS
  const [receiptEmail, setReceiptEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [receiptPhone, setReceiptPhone] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsMsg, setSmsMsg] = useState("");

  // ── Store Commerce Features ───────────────────────────────────
  const [clock, setClock] = useState(new Date());
  const [activeShift, setActiveShift] = useState(null);
  const [loyaltyData, setLoyaltyData] = useState(null);
  const [heldCarts, setHeldCarts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("rhosam_held_carts") || "[]"); } catch { return []; }
  });
  const [holdCount, setHoldCount] = useState(0);
  const [showLayawayModal, setShowLayawayModal] = useState(false);
  const [layawayDueDate, setLayawayDueDate] = useState("");
  const [layawayDeposit, setLayawayDeposit] = useState("");
  const [layawayNotes, setLayawayNotes] = useState("");
  const [orderMode, setOrderMode] = useState("SALE"); // SALE or LAYAWAY

  // Phone scanner state
  const [scannerSessionId] = useState(() => Math.random().toString(36).slice(2, 10));
  const [scannerConnected, setScannerConnected] = useState(false);
  const scannerEventSourceRef = useRef(null);

  // ── Clock ─────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Load Data ─────────────────────────────────────────────────
  useEffect(() => {
    fetchProducts(undefined, user?.branchId).then(setProducts).catch(() => {});
    fetchCustomers().then(setCustomers).catch(() => {});
    getGatewayStatus().then(setGatewayStatus).catch(() => {});
    fetchBundles({ active: 'true' }).then(d => setBundles(d?.data || [])).catch(() => {});
    getActiveShift().then(d => setActiveShift(d)).catch(() => {});
  }, []);

  // Cash drawer check
  useEffect(() => {
    if (user?.role === 'ADMIN' || user?.role === 'MANAGER') { setDrawerOk(true); return; }
    getActiveDrawer().then(d => setDrawerOk(!!d?.id)).catch(() => setDrawerOk(false));
  }, [getActiveDrawer, user]);

  // Hold count
  useEffect(() => { setHoldCount(heldCarts.length); }, [heldCarts]);

  // Auto-focus search
  useEffect(() => { searchRef.current?.focus(); }, [cart, receipt]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && !receipt && !showPayModal && cart.length > 0) {
        e.preventDefault();
        if (confirm("Clear all items from cart?")) setCart([]);
      }
      // F2 = Hold, F3 = Recall
      if (e.key === "F2") { e.preventDefault(); handleHoldCart(); }
      if (e.key === "F3") { e.preventDefault(); handleRecallLast(); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cart, receipt, showPayModal]);

  // Phone scanner SSE
  const productsRef = useRef(products);
  useEffect(() => { productsRef.current = products; }, [products]);
  const addToCartRef = useRef(addToCart);
  useEffect(() => { addToCartRef.current = addToCart; }, [addToCart]);

  useEffect(() => {
    const rawTarget = import.meta.env.VITE_API_URL || "";
    let backendBase = "http://localhost:5000";
    if (rawTarget) {
      backendBase = /^https?:\/\//.test(rawTarget) ? rawTarget : `https://${rawTarget}`;
    }
    const backendApi = backendBase.replace(/\/api$/, "");
    const streamUrl = `${backendApi}/api/scanner/stream?session=${scannerSessionId}`;
    const es = new EventSource(streamUrl);
    scannerEventSourceRef.current = es;
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.barcode) {
          const currentProducts = productsRef.current;
          const match = currentProducts.find(p => p.barcode === data.barcode);
          if (match) { addToCartRef.current(match, true); }
          else if (data.product) {
            setProducts(prev => prev.find(p => p.id === data.product.id) ? prev : [...prev, data.product]);
            addToCartRef.current({ ...data.product, stock: data.product.stock || 0, reorder_level: data.product.reorder_level || 0 }, true);
          }
          setScannerConnected(true);
        }
      } catch {}
    };
    es.onerror = () => setScannerConnected(false);
    es.onopen = () => setScannerConnected(true);
    return () => { es.close(); scannerEventSourceRef.current = null; };
  }, [scannerSessionId]);

  // Beep for scans
  const playBeep = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 1200; osc.type = "square"; gain.gain.value = 0.1;
      osc.start(); osc.stop(ctx.currentTime + 0.08);
    } catch {}
  }, []);

  const showScanFeedback = useCallback((product) => {
    setScanFeedback({ name: product.name, price: product.price, id: Date.now() });
    playBeep();
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => setScanFeedback(null), 1500);
  }, [playBeep]);

  // ── Derived ───────────────────────────────────────────────────
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  const filtered = products.filter(p => {
    const matchesSearch = !search.trim() ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode.includes(search) ||
      p.category.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !selectedCategory || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const fmt = (n) => "₦" + (parseFloat(n) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const subtotal = cart.reduce((sum, c) => sum + c.price * c.quantity - c.discount, 0);
  const total = subtotal - discount + tax - couponDiscount - Number(giftCardAmount || 0);
  const cartItemCount = cart.reduce((s, c) => s + c.quantity, 0);

  // ── Cart Functions ────────────────────────────────────────────
  function addToCart(product, fromScan = false) {
    if (product.stock <= 0) { setError(`${product.name} is out of stock!`); setTimeout(() => setError(""), 3000); return; }
    if (product.stock <= product.reorder_level) {
      setError(`⚠️ Low stock: ${product.name} — ${product.stock} left`);
      setTimeout(() => setError(""), 3000);
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

  function updateQty(productId, qty) {
    if (qty < 1) { setCart(prev => prev.filter(c => c.productId !== productId)); return; }
    const product = products.find(p => p.id === productId);
    const maxQty = product?.stock || 0;
    if (product && qty > maxQty) {
      setError(`Max stock: ${product.name} has ${maxQty}`);
      setTimeout(() => setError(""), 3000);
      setCart(prev => prev.map(c => c.productId === productId ? { ...c, quantity: maxQty, maxStock: maxQty } : c));
      return;
    }
    setCart(prev => prev.map(c => c.productId === productId ? { ...c, quantity: qty } : c));
  }

  function handleSearchKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const term = search.trim();
      if (!term) return;
      const exactMatch = products.find(p => p.barcode === term);
      if (exactMatch) { addToCart(exactMatch, true); return; }
      const nameMatch = products.find(p => p.name.toLowerCase() === term.toLowerCase());
      if (nameMatch) { addToCart(nameMatch, true); return; }
      if (filtered.length === 1) { addToCart(filtered[0], true); return; }
      setError(`No product found for "${term}"`);
      setTimeout(() => setError(""), 3000);
    }
  }

  useEffect(() => {
    if (!search.trim()) return;
    const match = products.find(p => p.barcode === search.trim());
    if (match) addToCart(match, true);
  }, [search, products]);

  // ── Hold / Recall ─────────────────────────────────────────────
  function handleHoldCart() {
    if (!cart.length) return;
    const held = { id: Date.now(), customerName, customerId, cart: [...cart], timestamp: new Date().toISOString(), discount, tax };
    const newHeld = [...heldCarts, held];
    setHeldCarts(newHeld);
    localStorage.setItem("rhosam_held_carts", JSON.stringify(newHeld));
    setCart([]); setCustomerName("Walk-in Customer"); setCustomerId(null); setDiscount(0); setTax(0);
  }

  function handleRecallCart(held) {
    setCart(held.cart); setCustomerName(held.customerName || "Walk-in Customer"); setCustomerId(held.customerId || null);
    setDiscount(held.discount || 0); setTax(held.tax || 0);
    setHeldCarts(prev => prev.filter(h => h.id !== held.id));
    localStorage.setItem("rhosam_held_carts", JSON.stringify(heldCarts.filter(h => h.id !== held.id)));
  }

  function handleRecallLast() {
    if (!heldCarts.length) return;
    handleRecallCart(heldCarts[heldCarts.length - 1]);
  }

  // ── Gift Card / Coupon ────────────────────────────────────────
  async function handleValidateGiftCard() {
    if (!giftCardCode.trim()) return;
    setGiftCardError("");
    try {
      const result = await validateGiftCard(giftCardCode.trim());
      if (result.valid) { setGiftCard(result.giftCard); setGiftCardAmount(String(Math.min(result.giftCard.current_balance, total))); }
      else { setGiftCard(null); setGiftCardAmount(""); setGiftCardError(result.message || "Invalid gift card"); }
    } catch (err) { setGiftCard(null); setGiftCardAmount(""); setGiftCardError(err.message); }
  }

  async function handleValidateCoupon() {
    if (!couponCode.trim()) return;
    setCouponError("");
    try {
      const result = await validateCoupon({ code: couponCode.trim(), cartTotal: subtotal - discount, productIds: cart.map(c => c.productId) });
      if (result.valid) { setCoupon(result.coupon); setCouponDiscount(result.discountAmount); }
      else { setCoupon(null); setCouponDiscount(0); setCouponError(result.message || "Invalid coupon"); }
    } catch (err) { setCoupon(null); setCouponDiscount(0); setCouponError(err.message); }
  }

  useEffect(() => {
    setCoupon(null); setCouponDiscount(0); setCouponCode(""); setCouponError("");
    setGiftCard(null); setGiftCardAmount(""); setGiftCardCode(""); setGiftCardError("");
  }, [cart.length]);

  // ── Customer Selection → Loyalty ──────────────────────────────
  async function handleCustomerSelect(e) {
    const id = Number(e.target.value);
    if (!id) { setCustomerId(null); setCustomerName("Walk-in Customer"); setLoyaltyData(null); return; }
    const c = customers.find(cu => cu.id === id);
    setCustomerId(id); setCustomerName(c?.name || "Walk-in Customer");
    try { const lp = await getLoyaltyPoints(id); setLoyaltyData(lp); } catch { setLoyaltyData(null); }
  }

  // ── Checkout ──────────────────────────────────────────────────
  async function handleCheckout() {
    if (!cart.length) return;
    setBusy(true); setError("");
    try {
      const result = await createSale({
        customerName, customerId, paymentMethod: payment,
        items: cart.map(c => ({ productId: c.productId, quantity: c.quantity, discount: c.discount })),
        discount, tax,
        couponId: coupon?.id || null, couponDiscount: couponDiscount || 0,
        giftCardId: giftCard?.id || null, giftCardAmount: Number(giftCardAmount) || 0,
        amountPaid: amountPaid ? Number(amountPaid) : (total > 0 ? total : 0),
      });
      // Redeem gift card
      if (giftCard && Number(giftCardAmount) > 0 && result.id) {
        try { await redeemGiftCard({ code: giftCard.code, amount: Number(giftCardAmount), saleId: result.id }); } catch {}
      }
      // Earn loyalty points
      if (customerId && result.id) {
        try { await earnLoyaltyPoints({ customerId, saleId: result.id, amount: subtotal }); } catch {}
      }
      // Electronic payments
      if (payment !== "Cash" && result.id) {
        try {
          const initData = await initializePayment({ saleId: result.id, email: customerEmail || undefined });
          if (initData.authorizationUrl) window.open(initData.authorizationUrl, "_blank");
          setPaymentModal({ saleId: result.id, reference: initData.reference, gateway: initData.gateway, authorizationUrl: initData.authorizationUrl });
        } catch (payErr) {
          setPaymentModal({ saleId: result.id, reference: null, gateway: "INTERNAL", authorizationUrl: null, error: payErr.message });
        }
      }
      setReceipt(result);
      setCart([]); setCustomerName("Walk-in Customer"); setCustomerId(null);
      setDiscount(0); setTax(0); setAmountPaid("");
      setGiftCard(null); setGiftCardCode(""); setGiftCardAmount("");
      setCoupon(null); setCouponCode(""); setCouponDiscount(0);
      setLoyaltyData(null); setShowPayModal(false);
      fetchProducts(undefined, user?.branchId).then(setProducts).catch(() => {});
      notifyDataChange();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  // ── Layaway ───────────────────────────────────────────────────
  async function handleLayawayCheckout() {
    if (!cart.length) return;
    setBusy(true); setError("");
    try {
      const result = await createLayawayOrder({
        customerId, branchId: user?.branchId,
        items: cart.map(c => ({ productId: c.productId, productName: c.name, quantity: c.quantity, unitPrice: c.price })),
        depositAmount: Number(layawayDeposit) || 0,
        dueDate: layawayDueDate || null,
        notes: layawayNotes || null,
        paymentMethod: payment,
      });
      setCart([]); setCustomerName("Walk-in Customer"); setCustomerId(null);
      setShowLayawayModal(false); setLayawayDeposit(""); setLayawayDueDate(""); setLayawayNotes("");
      setDiscount(0); setTax(0); setLoyaltyData(null);
      fetchProducts(undefined, user?.branchId).then(setProducts).catch(() => {});
      notifyDataChange();
      alert(`✅ Layaway order created: ${result.order_number}\nTotal: ${fmt(result.total_amount)}\nBalance: ${fmt(result.balance_due)}`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  // ── Verify Payment ────────────────────────────────────────────
  async function handleVerifyPayment() {
    if (!paymentModal?.saleId || !paymentReference.trim()) return;
    setPaymentVerifying(true);
    try {
      await verifyPayment({ saleId: paymentModal.saleId, gateway: paymentModal.gateway || "INTERNAL", reference: paymentReference.trim() });
      setPaymentModal(null); setPaymentReference("");
    } catch (err) { setError(`Verification failed: ${err.message}`); }
    finally { setPaymentVerifying(false); }
  }

  async function handleEmailReceipt(e) {
    e.preventDefault(); if (!receiptEmail || !receipt?.id) return;
    setEmailSending(true); setEmailMsg("");
    try { await emailReceipt(receipt.id, receiptEmail); setEmailMsg("✅ Receipt sent!"); }
    catch (err) { setEmailMsg(`❌ ${err.message}`); }
    finally { setEmailSending(false); }
  }

  async function handleSmsReceipt(e) {
    e.preventDefault(); if (!receiptPhone || !receipt?.id) return;
    setSmsSending(true); setSmsMsg("");
    try { await smsReceipt(receipt.id, receiptPhone); setSmsMsg("✅ SMS sent!"); }
    catch (err) { setSmsMsg(`❌ ${err.message}`); }
    finally { setSmsSending(false); }
  }

  // ═════════════════════════════════════════════════════════════════
  // RENDER: Payment Verification View
  // ═════════════════════════════════════════════════════════════════
  if (paymentModal && receipt) {
    return (
      <div className="pos-fullscreen">
        <div className="pos-receipt-panel">
          <div className="receipt">
            <h2>🛍️ RHoSAM Supermarket</h2>
            {user?.branch?.name && <p className="muted">Branch: {user.branch.name}</p>}
            <p className="muted">Receipt: {receipt.receiptNumber}</p>
            <p className="muted">Date: {new Date(receipt.created_at || Date.now()).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            <p className="muted">Payment: {receipt.paymentMethod}</p>
            <hr />
            <h3>💳 Payment Verification</h3>
            {paymentModal.authorizationUrl && (
              <div style={{ marginBottom: 12, padding: 12, background: 'var(--surface)', borderRadius: 8 }}>
                <p style={{ fontSize: '0.85rem' }}>Gateway: <strong>{paymentModal.gateway}</strong></p>
                <p style={{ fontSize: '0.85rem' }}>Reference: <code>{paymentModal.reference}</code></p>
                <button className="btn primary" onClick={() => window.open(paymentModal.authorizationUrl, '_blank')}>🔗 Open Payment Page</button>
              </div>
            )}
            {paymentModal.error && <div className="error-msg">⚠️ {paymentModal.error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="text" value={paymentReference} onChange={e => setPaymentReference(e.target.value)} placeholder="Payment reference" style={{ flex: 1, padding: '10px', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'monospace' }} />
              <button className="btn primary" onClick={handleVerifyPayment} disabled={paymentVerifying}>{paymentVerifying ? '⏳' : '✓ Verify'}</button>
            </div>
            <div style={{ marginTop: 16 }}><button className="btn primary" onClick={() => { setPaymentModal(null); setReceipt(null); setPaymentReference(""); }} style={{ width: '100%' }}>🛒 New Sale</button></div>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════
  // RENDER: Receipt View
  // ═════════════════════════════════════════════════════════════════
  if (receipt) {
    return (
      <div className="pos-fullscreen">
        <div className="pos-receipt-panel">
          <div className="receipt">
            <h2>🛍️ RHoSAM Supermarket</h2>
            {user?.branch?.name && <p className="muted">Branch: {user.branch.name}</p>}
            <p className="muted">Receipt: {receipt.receiptNumber}</p>
            <p className="muted">Date: {new Date(receipt.created_at || Date.now()).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            <p className="muted">Cashier: {receipt.cashierName}</p>
            <p className="muted">Customer: {receipt.customerName}</p>
            <p className="muted">Payment: {receipt.paymentMethod}</p>
            <hr />
            {receipt.items?.map((item, i) => (
              <div key={i} className="receipt-line">
                <span>{item.name} × {item.quantity}</span>
                <span>{fmt(item.lineTotal)}</span>
              </div>
            ))}
            <hr />
            <div className="receipt-line"><span>Subtotal</span><span>{fmt(receipt.subtotal)}</span></div>
            {receipt.discount > 0 && <div className="receipt-line"><span>Discount</span><span>-{fmt(receipt.discount)}</span></div>}
            {receipt.tax > 0 && <div className="receipt-line"><span>Tax</span><span>{fmt(receipt.tax)}</span></div>}
            <div className="receipt-line receipt-total"><span><strong>TOTAL</strong></span><strong>{fmt(receipt.total)}</strong></div>
            {receipt.amountPaid > 0 && <div className="receipt-line"><span>Paid</span><span>{fmt(receipt.amountPaid)}</span></div>}
            {receipt.change_amount > 0 && <div className="receipt-line"><span>Change</span><span className="change">{fmt(receipt.change_amount)}</span></div>}
            <p className="receipt-thanks">Thank you for shopping! 🛍️</p>

            {/* Email receipt */}
            <form onSubmit={handleEmailReceipt} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input type="email" value={receiptEmail} onChange={e => setReceiptEmail(e.target.value)} placeholder="Email for receipt" style={{ flex: 1, padding: '8px', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.85rem' }} required />
              <button type="submit" className="btn primary" disabled={emailSending} style={{ padding: '8px 14px', fontSize: '0.85rem' }}>{emailSending ? '⏳' : '📧 Email'}</button>
            </form>
            {emailMsg && <p style={{ fontSize: '0.78rem', marginTop: 4, color: emailMsg.startsWith('✅') ? 'var(--accent)' : 'var(--danger)' }}>{emailMsg}</p>}

            {/* SMS receipt */}
            <form onSubmit={handleSmsReceipt} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input type="tel" value={receiptPhone} onChange={e => setReceiptPhone(e.target.value)} placeholder="Phone for SMS" style={{ flex: 1, padding: '8px', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.85rem' }} required />
              <button type="submit" className="btn primary" disabled={smsSending} style={{ padding: '8px 14px', fontSize: '0.85rem' }}>{smsSending ? '⏳' : '📱 SMS'}</button>
            </form>
            {smsMsg && <p style={{ fontSize: '0.78rem', marginTop: 4, color: smsMsg.startsWith('✅') ? 'var(--accent)' : 'var(--danger)' }}>{smsMsg}</p>}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn secondary" style={{ flex: 1 }} onClick={() => { setReceipt(null); setReceiptEmail(""); setEmailMsg(""); setReceiptPhone(""); setSmsMsg(""); }}>📄 PDF</button>
              <button className="btn secondary" style={{ flex: 1 }} onClick={() => window.print()}>🖨️ Print</button>
              <button className="btn primary" style={{ flex: 1 }} onClick={() => { setReceipt(null); setReceiptEmail(""); setEmailMsg(""); setReceiptPhone(""); setSmsMsg(""); }}>🛒 New Sale</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════
  // RENDER: Cash Drawer Guard
  // ═════════════════════════════════════════════════════════════════
  if (drawerOk === null) return <div className="loading">Checking cash drawer…</div>;
  if (drawerOk === false) return (
    <div className="pos-fullscreen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: '4rem', marginBottom: 16 }}>💵</div>
        <h2 style={{ marginBottom: 8 }}>Cash Drawer Required</h2>
        <p style={{ color: 'var(--muted)', marginBottom: 20 }}>Open a cash drawer to start selling.</p>
        <a href="/cashdrawer" className="btn primary" style={{ display: 'inline-block', padding: '14px 36px', fontSize: '1.1rem', textDecoration: 'none', borderRadius: 12 }}>Open Cash Drawer →</a>
      </div>
    </div>
  );

  // ═════════════════════════════════════════════════════════════════
  // RENDER: Main POS (Store Commerce Style)
  // ═════════════════════════════════════════════════════════════════
  return (
    <div className="sc-pos">
      {/* ── Scan Feedback Toast ──────────────────────────────── */}
      {scanFeedback && (
        <div className="scan-toast" key={scanFeedback.id}>
          <span className="scan-toast-icon">✓</span>
          <span className="scan-toast-text">{scanFeedback.name} — {fmt(scanFeedback.price)}</span>
        </div>
      )}

      {/* ── Top Status Bar ──────────────────────────────────── */}
      <div className="sc-pos-topbar">
        <div className="sc-pos-topbar-left">
          <span className="sc-pos-cashier-avatar">{user?.name?.[0]?.toUpperCase() || "U"}</span>
          <div className="sc-pos-cashier-info">
            <strong>{user?.name || "Cashier"}</strong>
            <small>{user?.branch?.name || "Main Store"}</small>
          </div>
        </div>
        <div className="sc-pos-topbar-center">
          <span className="sc-pos-clock">{clock.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <span className="sc-pos-date">{clock.toLocaleDateString('en-NG', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        </div>
        <div className="sc-pos-topbar-right">
          <span className={`sc-pos-status-chip ${scannerConnected ? 'connected' : ''}`}>
            📱 {scannerConnected ? 'Scanner' : 'No Scanner'}
          </span>
          {activeShift && (
            <span className="sc-pos-status-chip shift">⏱️ Shift #{activeShift.shift_number?.slice(-5) || activeShift.id}</span>
          )}
          {activeShift && (
            <span className="sc-pos-status-chip">💵 {fmt(activeShift.opening_balance)}</span>
          )}
          <button className="sc-pos-hold-btn" onClick={handleHoldCart} disabled={!cart.length} title="Hold current cart (F2)">
            📌 Hold{holdCount > 0 && <span className="sc-pos-hold-badge">{holdCount}</span>}
          </button>
          {heldCarts.length > 0 && (
            <button className="sc-pos-recall-btn" onClick={handleRecallLast} title="Recall last held cart (F3)">
              📋 Recall
            </button>
          )}
        </div>
      </div>

      {/* ── Main Content ────────────────────────────────────── */}
      <div className="sc-pos-main">
        {/* ── Left: Products ──────────────────────────────── */}
        <div className="sc-pos-products">
          {/* Search */}
          <div className="sc-pos-search-area">
            <div className="sc-pos-search-box">
              <span className="sc-pos-search-icon">🔍</span>
              <input ref={searchRef} type="text" placeholder="Scan barcode or search products…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={handleSearchKeyDown} className="sc-pos-search-input" autoComplete="off" autoFocus />
              {search && <button className="sc-pos-search-clear" onClick={() => { setSearch(""); searchRef.current?.focus(); }}>✕</button>}
            </div>
          </div>

          {/* Categories */}
          {categories.length > 1 && (
            <div className="sc-pos-categories">
              <button className={`sc-pos-cat-chip ${!selectedCategory ? 'active' : ''}`} onClick={() => setSelectedCategory("")}>All</button>
              {categories.map(cat => (
                <button key={cat} className={`sc-pos-cat-chip ${selectedCategory === cat ? 'active' : ''}`} onClick={() => setSelectedCategory(selectedCategory === cat ? "" : cat)}>{cat}</button>
              ))}
            </div>
          )}

          {/* Product Count */}
          {(selectedCategory || search) && (
            <div className="sc-pos-product-count">
              {filtered.length} product{filtered.length !== 1 ? 's' : ''}
              <button className="sc-pos-clear-filter" onClick={() => { setSelectedCategory(""); setSearch(""); }}>✕ Clear</button>
            </div>
          )}

          {/* Product Grid */}
          <div className="sc-pos-product-grid">
            {filtered.map(p => (
              <div key={p.id} className={`sc-pos-product-card ${p.stock <= 0 ? "out-of-stock" : ""}`} onClick={() => setSelectedProduct(p)}>
                {p.stock > 0 && <button className="sc-pos-quick-add" onClick={e => { e.stopPropagation(); addToCart(p, true); }} title={`Add ${p.name}`}>+</button>}
                {p.image_url ? (
                  <img src={`${resolveApiUrl(import.meta.env.VITE_API_URL).replace(/\/api$/, "")}${p.image_url}`} alt={p.name} className="sc-pos-product-img" />
                ) : (
                  <div className="sc-pos-product-img-placeholder">{p.name?.[0]?.toUpperCase() || '?'}</div>
                )}
                <div className="sc-pos-product-info">
                  <span className="sc-pos-product-name">{p.name}</span>
                  <span className="sc-pos-product-stock">{p.stock} in stock</span>
                </div>
                <div className="sc-pos-product-price">{fmt(p.price)}</div>
              </div>
            ))}
            {!filtered.length && (
              <div className="sc-pos-empty">
                <div style={{ fontSize: '3rem', marginBottom: 12 }}>📦</div>
                <p>No products found</p>
                {(selectedCategory || search) && <button className="btn secondary" onClick={() => { setSelectedCategory(""); setSearch(""); }}>Clear filters</button>}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Cart ─────────────────────────────────── */}
        <div className="sc-pos-cart">
          {/* Cart Header */}
          <div className="sc-pos-cart-header">
            <h3>🛒 Cart <span className="sc-pos-cart-count">{cartItemCount}</span></h3>
            {cart.length > 0 && <button className="sc-pos-cart-clear" onClick={() => { if (confirm('Clear cart?')) setCart([]); }}>🗑️</button>}
          </div>

          {/* Error */}
          {error && <div className="sc-pos-error">{error}</div>}

          {/* Customer */}
          <div className="sc-pos-customer-row">
            <label className="sc-pos-customer-label">
              👤 Customer
              <select value={customerId || ""} onChange={handleCustomerSelect}>
                <option value="">Walk-in Customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>

          {/* Loyalty Points */}
          {loyaltyData && loyaltyData.points_balance > 0 && (
            <div className="sc-pos-loyalty-bar">
              <span>⭐ {loyaltyData.points_balance.toLocaleString()} pts</span>
              <span className={`sc-pos-tier ${loyaltyData.tier?.toLowerCase()}`}>{loyaltyData.tier}</span>
            </div>
          )}

          {/* Cart Items */}
          <div className="sc-pos-cart-items">
            {!cart.length && (
              <div className="sc-pos-cart-empty">
                <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🛒</div>
                <p>Cart is empty</p>
                <small>Tap products or scan barcodes</small>
              </div>
            )}
            {cart.map(item => {
              const product = products.find(p => p.id === item.productId);
              const avail = product?.stock ?? item.maxStock ?? 0;
              const isLow = avail <= (product?.reorder_level || 5) && avail > 0;
              return (
                <div key={item.productId} className={`sc-pos-cart-item ${isLow ? 'low-stock' : ''}`}>
                  <div className="sc-pos-cart-item-info">
                    <span className="sc-pos-cart-item-name">{item.name}</span>
                    <span className="sc-pos-cart-item-price">{fmt(item.price)} × {item.quantity}</span>
                  </div>
                  <div className="sc-pos-cart-item-qty">
                    <button className="sc-pos-qty-btn" onClick={() => updateQty(item.productId, item.quantity - 1)}>−</button>
                    <input type="number" min="1" max={avail} value={item.quantity} onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) updateQty(item.productId, v); }} />
                    <button className="sc-pos-qty-btn" onClick={() => updateQty(item.productId, item.quantity + 1)} disabled={item.quantity >= avail}>+</button>
                  </div>
                  <div className="sc-pos-cart-item-total">{fmt(item.price * item.quantity)}</div>
                </div>
              );
            })}
          </div>

          {/* Cart Summary */}
          {cart.length > 0 && (
            <div className="sc-pos-cart-summary">
              <div className="sc-pos-summary-row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
              <div className="sc-pos-summary-row"><span>Discount</span><span>-{fmt(discount)}</span></div>
              {tax > 0 && <div className="sc-pos-summary-row"><span>Tax</span><span>{fmt(tax)}</span></div>}
              {couponDiscount > 0 && <div className="sc-pos-summary-row discount"><span>🎟️ {coupon?.code}</span><span>-{fmt(couponDiscount)}</span></div>}
              {Number(giftCardAmount) > 0 && <div className="sc-pos-summary-row discount"><span>🎁 Gift Card</span><span>-{fmt(giftCardAmount)}</span></div>}
              <div className="sc-pos-summary-row total"><span>TOTAL</span><strong>{fmt(total)}</strong></div>
            </div>
          )}

          {/* Cart Actions */}
          {cart.length > 0 && (
            <div className="sc-pos-cart-actions">
              {/* Quick Discount */}
              <div className="sc-pos-quick-row">
                <label>Discount <input type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(Number(e.target.value))} /></label>
                <label>Tax <input type="number" min="0" step="0.01" value={tax} onChange={e => setTax(Number(e.target.value))} /></label>
              </div>
              {/* Coupon */}
              <div className="sc-pos-coupon-row">
                <input type="text" value={couponCode} onChange={e => setCouponCode(e.target.value)} placeholder="🎟️ Coupon code" onKeyDown={e => e.key === 'Enter' && handleValidateCoupon()} />
                <button onClick={handleValidateCoupon} disabled={!couponCode.trim()}>Apply</button>
              </div>
              {couponError && <small className="sc-pos-field-error">{couponError}</small>}
              {coupon && <div className="sc-pos-applied-tag">✅ {coupon.code} — {fmt(couponDiscount)} off</div>}
              {/* Gift Card */}
              <div className="sc-pos-coupon-row">
                <input type="text" value={giftCardCode} onChange={e => setGiftCardCode(e.target.value)} placeholder="🎁 Gift card" onKeyDown={e => e.key === 'Enter' && handleValidateGiftCard()} />
                <button onClick={handleValidateGiftCard} disabled={!giftCardCode.trim()}>Apply</button>
              </div>
              {giftCardError && <small className="sc-pos-field-error">{giftCardError}</small>}
              {giftCard && (
                <div className="sc-pos-applied-tag">
                  ✅ {fmt(giftCard.current_balance)} balance
                  <input type="number" min="0" max={giftCard.current_balance} step="0.01" value={giftCardAmount} onChange={e => setGiftCardAmount(e.target.value)} style={{ width: 80, marginLeft: 8, fontSize: '0.8rem' }} />
                </div>
              )}

              {/* Payment Method */}
              <select className="sc-pos-payment-select" value={payment} onChange={e => setPayment(e.target.value)}>
                <option value="Cash">💵 Cash</option>
                <option value="Card">💳 Card</option>
                <option value="Transfer">🏦 Transfer</option>
                <option value="POS">📱 POS</option>
              </select>
              {payment !== 'Cash' && gatewayStatus?.activeGateway === 'INTERNAL' && (
                <small style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>No gateway — manual verification</small>
              )}
              {payment !== 'Cash' && (
                <input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="Customer email for payment link" style={{ fontSize: '0.82rem' }} />
              )}

              {/* Low stock warning */}
              {cart.some(item => { const p = products.find(x => x.id === item.productId); return p && p.stock <= p.reorder_level && p.stock > 0; }) && (
                <div className="sc-pos-low-stock-warn">⚠️ Some items low on stock</div>
              )}

              {/* Checkout Buttons */}
              <button className="sc-pos-checkout-btn" onClick={() => setShowPayModal(true)} disabled={busy}>
                {busy ? '⏳ Processing…' : `💳 Pay ${fmt(total)}`}
              </button>
              <button className="sc-pos-layaway-btn" onClick={() => setShowLayawayModal(true)} disabled={busy || total <= 0}>
                📋 Create Layaway
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Payment Modal ────────────────────────────────────── */}
      {showPayModal && (
        <div className="modal-overlay" onClick={() => setShowPayModal(false)}>
          <div className="sc-pos-pay-modal" onClick={e => e.stopPropagation()}>
            <h2>💳 Complete Payment</h2>
            <div className="sc-pos-pay-total">{fmt(total)}</div>

            {/* Quick Tender Buttons */}
            <div className="sc-pos-tender-grid">
              {[100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].map(amt => (
                <button key={amt} className="sc-pos-tender-btn" onClick={() => setAmountPaid(String(amt))} disabled={amt < total}>
                  ₦{amt.toLocaleString()}
                </button>
              ))}
              <button className="sc-pos-tender-btn exact" onClick={() => setAmountPaid(total.toFixed(2))}>
                Exact
              </button>
            </div>

            {/* Amount Paid Input */}
            <div className="sc-pos-pay-input-row">
              <label>Amount Paid</label>
              <input type="number" min="0" step="0.01" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} placeholder={total > 0 ? total.toFixed(2) : '0.00'} autoFocus />
            </div>

            {/* Change */}
            {Number(amountPaid) > total && (
              <div className="sc-pos-pay-change">
                <span>Change</span>
                <strong>{fmt(Number(amountPaid) - total)}</strong>
              </div>
            )}
            {total <= 0 && <div className="sc-pos-pay-free">✅ Fully paid with gift card + coupon</div>}

            {/* Payment method selection in modal */}
            <div className="sc-pos-pay-method-row">
              {['Cash', 'Card', 'Transfer', 'POS'].map(m => (
                <button key={m} className={`sc-pos-pay-method-btn ${payment === m ? 'active' : ''}`} onClick={() => setPayment(m)}>
                  {m === 'Cash' ? '💵' : m === 'Card' ? '💳' : m === 'Transfer' ? '🏦' : '📱'} {m}
                </button>
              ))}
            </div>

            <div className="sc-pos-pay-actions">
              <button className="btn secondary" onClick={() => setShowPayModal(false)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn primary" onClick={handleCheckout} disabled={busy || !cart.length} style={{ flex: 2 }}>
                {busy ? '⏳ Processing…' : total <= 0 ? '✅ Complete Sale' : '💳 Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Layaway Modal ──────────────────────────────────── */}
      {showLayawayModal && (
        <div className="modal-overlay" onClick={() => setShowLayawayModal(false)}>
          <div className="sc-pos-pay-modal" onClick={e => e.stopPropagation()}>
            <h2>📋 Create Layaway Order</h2>
            <p className="muted">Customer can pay in installments and pick up when fully paid.</p>

            <div className="sc-pos-layaway-summary">
              <div className="sc-pos-summary-row"><span>Total</span><strong>{fmt(total)}</strong></div>
              <div className="sc-pos-summary-row"><span>Items</span><span>{cartItemCount}</span></div>
              <div className="sc-pos-summary-row"><span>Customer</span><span>{customerName}</span></div>
            </div>

            <div className="sc-pos-pay-input-row">
              <label>Initial Deposit (₦)</label>
              <input type="number" min="0" max={total} step="0.01" value={layawayDeposit} onChange={e => setLayawayDeposit(e.target.value)} placeholder="0.00" />
            </div>
            <div className="sc-pos-pay-input-row">
              <label>Due Date</label>
              <input type="date" value={layawayDueDate} onChange={e => setLayawayDueDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} />
            </div>
            <div className="sc-pos-pay-input-row">
              <label>Notes</label>
              <input type="text" value={layawayNotes} onChange={e => setLayawayNotes(e.target.value)} placeholder="Optional notes" />
            </div>

            {layawayDeposit && Number(layawayDeposit) < total && (
              <div className="sc-pos-layaway-balance">
                Balance after deposit: <strong>{fmt(total - Number(layawayDeposit))}</strong>
              </div>
            )}

            <div className="sc-pos-pay-actions">
              <button className="btn secondary" onClick={() => setShowLayawayModal(false)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn primary" onClick={handleLayawayCheckout} disabled={busy || !cart.length} style={{ flex: 2 }}>
                {busy ? '⏳ Creating…' : '📋 Create Layaway'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Product Detail Modal ─────────────────────────────── */}
      {selectedProduct && (
        <div className="modal-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="modal product-detail-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>{selectedProduct.name}</h2>
              <button className="btn secondary" onClick={() => setSelectedProduct(null)}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: selectedProduct.image_url ? '200px 1fr' : '1fr', gap: 20 }}>
              {selectedProduct.image_url ? (
                <div style={{ borderRadius: 12, overflow: 'hidden' }}>
                  <img src={`${resolveApiUrl(import.meta.env.VITE_API_URL).replace(/\/api$/, "")}${selectedProduct.image_url}`} alt={selectedProduct.name} style={{ width: '100%', height: 200, objectFit: 'cover' }} />
                </div>
              ) : (
                <div style={{ width: 200, height: 200, borderRadius: 12, background: 'linear-gradient(135deg, var(--primary, #16a34a), #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '4rem', fontWeight: 700 }}>{selectedProduct.name?.[0]?.toUpperCase() || '?'}</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div className="summary-card accent" style={{ flex: 1, minWidth: 100 }}><span>Price</span><strong>{fmt(selectedProduct.price)}</strong></div>
                  <div className="summary-card" style={{ flex: 1, minWidth: 100 }}><span>Stock</span><strong style={{ color: selectedProduct.stock <= selectedProduct.reorder_level ? 'var(--danger)' : 'inherit' }}>{selectedProduct.stock}</strong></div>
                  <div className="summary-card" style={{ flex: 1, minWidth: 100 }}><span>Category</span><strong>{selectedProduct.category || '—'}</strong></div>
                </div>
                <div style={{ padding: 10, background: selectedProduct.stock <= 0 ? 'rgba(239,68,68,0.08)' : selectedProduct.stock <= selectedProduct.reorder_level ? 'rgba(245,158,11,0.08)' : 'rgba(22,163,74,0.08)', borderRadius: 8, fontSize: '0.85rem', fontWeight: 600 }}>
                  {selectedProduct.stock <= 0 ? '❌ Out of Stock' : selectedProduct.stock <= selectedProduct.reorder_level ? `⚠️ Low Stock — ${selectedProduct.stock} left` : `✅ In Stock — ${selectedProduct.stock} units`}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <button className="btn primary" style={{ flex: 1 }} onClick={() => { if (selectedProduct.stock > 0) { addToCart(selectedProduct); setSelectedProduct(null); } }} disabled={selectedProduct.stock <= 0}>
                    {selectedProduct.stock <= 0 ? 'Out of Stock' : '🛒 Add to Cart'}
                  </button>
                  <button className="btn secondary" onClick={() => setSelectedProduct(null)}>Close</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
