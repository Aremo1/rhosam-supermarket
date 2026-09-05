import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const AuthContext = createContext(null);
function resolveApiUrl(val) {
  if (!val) return "/api"; // relative path — works with Vite proxy in dev, frontend server proxy in production
  // If it's just a hostname (no protocol), prepend https:// and append /api
  if (!/^https?:\/\//.test(val) && !val.startsWith("/")) return `https://${val}/api`;
  if (!/^https?:\/\//.test(val) && val.startsWith("/")) return val; // already a relative path
  return val;
}
const API = resolveApiUrl(import.meta.env.VITE_API_URL).replace(/\/$/, "");

async function parse(r) {
  const t = await r.text();
  let d = {};
  if (t) try { d = JSON.parse(t); } catch { throw new Error(`Non-JSON response (${r.status}).`); }
  if (!r.ok) throw new Error(d.message || d.error || `Request failed (${r.status}).`);
  return d;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem("rhosam_user") || "null"); } catch { return null; } });
  const [loading, setLoading] = useState(true);
  const [dataVersion, setDataVersion] = useState(0);
  const notifyDataChange = useCallback(() => setDataVersion(v => v + 1), []);

  const logout = useCallback(() => {
    localStorage.removeItem("rhosam_token");
    localStorage.removeItem("rhosam_user");
    setUser(null);
  }, []);

  const request = useCallback(async (path, opts = {}) => {
    const token = localStorage.getItem("rhosam_token");
    const r = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    });
    if (r.status === 401) logout();
    return parse(r);
  }, [logout]);

  const fetchUser = useCallback(async () => {
    const d = await request("/auth/me");
    setUser(d.user);
    localStorage.setItem("rhosam_user", JSON.stringify(d.user));
    return d.user;
  }, [request]);

  useEffect(() => {
    const token = localStorage.getItem("rhosam_token");
    if (!token) { setLoading(false); return; }
    fetchUser().catch(logout).finally(() => setLoading(false));
  }, [fetchUser, logout]);

  async function login(email, password) {
    const d = await parse(await fetch(`${API}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    }));
    localStorage.setItem("rhosam_token", d.token);
    localStorage.setItem("rhosam_user", JSON.stringify(d.user));
    setUser(d.user);
    return { ...d.user, passwordExpired: d.passwordExpired };
  }

  const value = useMemo(() => ({
    user, loading, login, logout, request, notifyDataChange,
    // Convenience wrappers
    fetchProducts: (q, branchId) => request(`/products${(q || branchId) ? `?${new URLSearchParams({ ...(q ? { search: q } : {}), ...(branchId ? { branchId } : {}) })}` : ""}`),
    checkProductDuplicate: (field, value, excludeId) => request(`/products/check-duplicate?field=${field}&value=${encodeURIComponent(value)}${excludeId ? `&excludeId=${excludeId}` : ""}`),
    createProduct: (data) => request("/products", { method: "POST", body: JSON.stringify(data) }),
    updateProduct: (id, data) => request(`/products/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteProduct: (id) => request(`/products/${id}`, { method: "DELETE" }),
    adjustStock: (id, data) => request(`/products/${id}/adjust`, { method: "POST", body: JSON.stringify(data) }),
    fetchLowStock: (params) => request(`/products/low-stock${params ? `?${new URLSearchParams(params)}` : ""}`),
    fetchInventoryMovements: (productId, branchId, params) => request(`/inventory/movements?${new URLSearchParams({ ...(productId ? { product_id: productId } : {}), ...(branchId ? { branchId } : {}), ...(params || {}) })}`),  // Returns { data, nextCursor, hasMore }
    reportDamage: (data) => request("/inventory/damage", { method: "POST", body: JSON.stringify(data) }),
    reportWastage: (data) => request("/inventory/wastage", { method: "POST", body: JSON.stringify(data) }),
    fetchValuation: (branchId) => request(`/inventory/valuation${branchId ? `?branchId=${branchId}` : ""}`),
    captureSnapshot: (branchId) => request(`/inventory/snapshot${branchId ? `?branchId=${branchId}` : ""}`, { method: "POST" }),
    fetchValuationTrend: (branchId, days) => request(`/inventory/trend${branchId ? `?branchId=${branchId}` : ""}${days ? `${branchId ? '&' : '?'}days=${days}` : ""}`),
    fetchSales: (params) => request(`/sales${params ? `?${new URLSearchParams(params)}` : ""}`),  // Returns { data, nextCursor, hasMore }
    getSale: (id) => request(`/sales/${id}`),
    createSale: (data) => request("/sales", { method: "POST", body: JSON.stringify(data) }),
    returnSale: (saleId, data) => request(`/sales/${saleId}/return`, { method: "POST", body: JSON.stringify(data) }),
    fetchUsers: () => request("/users"),
    createUser: (data) => request("/users", { method: "POST", body: JSON.stringify(data) }),
    updateUser: (id, data) => request(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteUser: (id) => request(`/users/${id}`, { method: "DELETE" }),
    changePassword: (current, newPwd) => request("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: newPwd }) }),
    forgotPassword: (email) => request("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
    resetPassword: (token, newPassword) => request("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) }),
    setupMfa: () => request("/auth/mfa/setup", { method: "POST" }),
    verifyMfa: (code) => request("/auth/mfa/verify", { method: "POST", body: JSON.stringify({ code }) }),
    disableMfa: (password) => request("/auth/mfa/disable", { method: "POST", body: JSON.stringify({ password }) }),
    emailMfaBackup: (data) => request("/auth/mfa/email-backup", { method: "POST", body: JSON.stringify(data) }),
    getMfaStatus: () => request("/auth/mfa/status"),
    fetchDashboard: (branchId) => request(`/dashboard/stats${branchId ? `?branchId=${branchId}` : ""}`),
    fetchTopProducts: (branchId) => request(`/dashboard/top-products${branchId ? `?branchId=${branchId}` : ""}`),
    fetchCategorySales: (branchId) => request(`/dashboard/category-sales${branchId ? `?branchId=${branchId}` : ""}`),
    fetchBranchSummary: () => request(`/dashboard/branch-summary?_v=${dataVersion}`),
    fetchSuppliers: async (params) => { const r = await request(`/suppliers${params ? `?${new URLSearchParams(params)}` : "?limit=1000"}`); return params ? r : (r.data || r); },
    createSupplier: (data) => request("/suppliers", { method: "POST", body: JSON.stringify(data) }),
    updateSupplier: (id, data) => request(`/suppliers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteSupplier: (id) => request(`/suppliers/${id}`, { method: "DELETE" }),
    fetchPurchaseOrders: (params) => request(`/purchase-orders${params ? `?${new URLSearchParams(params)}` : ""}`),
    getPurchaseOrder: (id) => request(`/purchase-orders/${id}`),
    createPurchaseOrder: (data) => request("/purchase-orders", { method: "POST", body: JSON.stringify(data) }),
    updatePOStatus: (id, status) => request(`/purchase-orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    getPOPayments: (id) => request(`/purchase-orders/${id}/payments`),
    createPOPayment: (id, data) => request(`/purchase-orders/${id}/payments`, { method: "POST", body: JSON.stringify(data) }),
    fetchCustomers: async (params) => { const r = await request(`/customers${params ? `?${new URLSearchParams(params)}` : "?limit=1000"}`); return params ? r : (r.data || r); },
    createCustomer: (data) => request("/customers", { method: "POST", body: JSON.stringify(data) }),
    updateCustomer: (id, data) => request(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    fetchExpenses: (params) => request(`/expenses${params ? `?${new URLSearchParams(params)}` : ""}`),
    createExpense: (data) => request("/expenses", { method: "POST", body: JSON.stringify(data) }),
    fetchFinanceSummary: (params) => request(`/finance/summary${params ? `?${new URLSearchParams(params)}` : ""}`),
    fetchAuditLogs: (params) => request(`/audit-logs${params ? `?${new URLSearchParams(params)}` : ""}`),  // Returns { data, nextCursor, hasMore }
    fetchLoginHistory: (params) => request(`/audit-logs/login-history${params ? `?${new URLSearchParams(params)}` : ""}`),
    fetchCategories: () => request("/categories"),
    createCategory: (data) => request("/categories", { method: "POST", body: JSON.stringify(data) }),
    updateCategory: (oldName, data) => request(`/categories/${encodeURIComponent(oldName)}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteCategory: (name) => request(`/categories/${encodeURIComponent(name)}`, { method: "DELETE" }),
    fetchBranchInventory: (branchId) => request(`/branch-inventory?branchId=${branchId}`),
    updateBranchInventory: (branchId, productId, data) => request(`/branch-inventory/${branchId}/${productId}`, { method: 'PUT', body: JSON.stringify(data) }),
    bulkUpdateBranchInventory: (branchId, items) => request(`/branch-inventory/${branchId}/bulk`, { method: 'POST', body: JSON.stringify({ items }) }),
    fetchBranches: async (params) => { const r = await request(`/branches${params ? `?${new URLSearchParams(params)}` : "?limit=1000"}`); return params ? r : (r.data || r); },
    createBranch: (data) => request("/branches", { method: "POST", body: JSON.stringify(data) }),
    updateBranch: (id, data) => request(`/branches/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteBranch: (id) => request(`/branches/${id}`, { method: "DELETE" }),
    // Inter-branch messaging
    fetchMessages: (box) => request(`/messages${box ? `?box=${box}` : ""}`),
    getUnreadCount: () => request("/messages/unread"),
    sendMessage: (data) => request("/messages", { method: "POST", body: JSON.stringify(data) }),
    markMessageRead: (id) => request(`/messages/${id}/read`, { method: "PATCH" }),
    deleteMessage: (id) => request(`/messages/${id}`, { method: "DELETE" }),
    // In-app notifications
    fetchInAppNotifications: (params) => request(`/in-app-notifications${params ? `?${new URLSearchParams(params)}` : ''}`),
    markNotificationsRead: (ids) => request('/in-app-notifications/read', { method: 'PATCH', body: JSON.stringify({ ids: ids || [] }) }),
    // Inter-branch stock transfers
    fetchStockTransfers: (box) => request(`/stock-transfers${box ? `?box=${box}` : ""}`),
    createStockTransfer: (data) => request("/stock-transfers", { method: "POST", body: JSON.stringify(data) }),
    updateTransferStatus: (id, data) => request(`/stock-transfers/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
    fetchCashDrawers: () => request("/cash-drawer"),
    getActiveDrawer: () => request("/cash-drawer/active"),
    openDrawer: (data) => request("/cash-drawer/open", { method: "POST", body: JSON.stringify(data) }),
    closeDrawer: (data) => request("/cash-drawer/close", { method: "POST", body: JSON.stringify(data) }),
    fetchDailyReport: (date, branchId) => {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (branchId) params.set('branchId', branchId);
      return request(`/reports/daily?${params.toString()}`);
    },
    emailDailyReport: (data) => request("/reports/daily/email", { method: "POST", body: JSON.stringify(data) }),
    fetchMonthlyReport: (year, branchId) => {
      const params = new URLSearchParams();
      params.set('year', year || new Date().getFullYear());
      if (branchId) params.set('branchId', branchId);
      return request(`/reports/monthly?${params.toString()}`);
    },
    fetchProductSales: (params) => request(`/reports/product-sales${params ? `?${new URLSearchParams(params)}` : ""}`),
    fetchLowStockReport: () => request("/reports/low-stock"),
    fetchCashierSales: (params) => request(`/reports/cashier-sales${params ? `?${new URLSearchParams(params)}` : ""}`),
    // AI Forecasting
    fetchDemandForecast: (productId) => request(`/forecast/demand${productId ? `?product_id=${productId}` : ""}`),
    // Auto Reorder
    fetchAutoReorderSuggestions: (params) => request(`/auto-reorder/suggestions${params ? `?${new URLSearchParams(params)}` : ""}`),
    createAutoReorder: (items) => request("/auto-reorder/create", { method: "POST", body: JSON.stringify({ items }) }),
    // Expiry tracking
    fetchExpiringProducts: (days) => request(`/inventory/expiring${days ? `?days=${days}` : ''}`),
    reportExpiryEvent: (data) => request('/inventory/expiry-event', { method: 'POST', body: JSON.stringify(data) }),
    fetchExpiryEvents: (limit) => request(`/inventory/expiry-events${limit ? `?limit=${limit}` : ''}`),
    // Bulk import/export
    exportInventoryCSV: async (branchId) => {
      const token = localStorage.getItem('rhosam_token');
      const r = await fetch(`${API}/inventory/export${branchId ? `?branchId=${branchId}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('Export failed');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `rhosam-inventory-${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    },
    importInventoryCSV: async (file) => {
      const token = localStorage.getItem('rhosam_token');
      const fd = new FormData(); fd.append('file', file);
      const r = await fetch(`${API}/inventory/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const d = await r.json(); if (!r.ok) throw new Error(d.message || 'Import failed'); return d;
    },
    // Inventory audits
    fetchAudits: (params) => request(`/inventory-audits${params ? `?${new URLSearchParams(params)}` : ''}`),
    getAudit: (id) => request(`/inventory-audits/${id}`),
    createAudit: (data) => request('/inventory-audits', { method: 'POST', body: JSON.stringify(data) }),
    updateAuditStatus: (id, status) => request(`/inventory-audits/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    updateAuditItem: (auditId, itemId, data) => request(`/inventory-audits/${auditId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteAudit: (id) => request(`/inventory-audits/${id}`, { method: 'DELETE' }),
    // Stock alerts
    fetchAlertRules: () => request('/alert-rules'),
    createAlertRule: (data) => request('/alert-rules', { method: 'POST', body: JSON.stringify(data) }),
    updateAlertRule: (id, data) => request(`/alert-rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteAlertRule: (id) => request(`/alert-rules/${id}`, { method: 'DELETE' }),
    fetchStockAlerts: (params) => request(`/stock-alerts${params ? `?${new URLSearchParams(params)}` : ''}`),
    scanStockAlerts: () => request('/stock-alerts/scan', { method: 'POST' }),
    markAlertsRead: (ids) => request('/stock-alerts/mark-read', { method: 'PATCH', body: JSON.stringify({ ids: ids || [] }) }),
    dismissAlerts: (ids) => request('/stock-alerts/dismiss', { method: 'PATCH', body: JSON.stringify({ ids }) }),
    deleteStockAlert: (id) => request(`/stock-alerts/${id}`, { method: 'DELETE' }),
    // Notifications
    fetchNotificationPreferences: () => request('/notifications/preferences'),
    updateNotificationPreferences: (preferences) => request('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ preferences }) }),
    fetchNotificationLog: (params) => request(`/notifications/log${params ? `?${new URLSearchParams(params)}` : ''}`),
    sendTestNotification: (data) => request('/notifications/test', { method: 'POST', body: JSON.stringify(data) }),
    sendNotification: (data) => request('/notifications/send', { method: 'POST', body: JSON.stringify(data) }),
    getNotificationStatus: () => request('/notifications/status'),
    // Executive Dashboard
    fetchExecutiveOverview: (params) => request(`/executive/overview${params ? `?${new URLSearchParams(params)}` : ""}`),
    // Customer Display
    getCustomerDisplay: (saleId) => request(`/customer-display/${saleId}`),
    // Supplier Portal
    fetchSupplierPortalOrders: (supplierId) => request(`/supplier-portal/orders/${supplierId}`),
    getSupplierPortalOrder: (id) => request(`/supplier-portal/order/${id}`),
    confirmSupplierOrder: (id) => request(`/supplier-portal/order/${id}/confirm`, { method: "PATCH" }),
    // Email Receipt
    emailReceipt: (saleId, email) => request(`/sales/${saleId}/email-receipt`, { method: "POST", body: JSON.stringify({ email }) }),
    // SMS
    smsReceipt: (saleId, phone) => request(`/sales/${saleId}/sms-receipt`, { method: "POST", body: JSON.stringify({ phone }) }),
    sendCustomerSms: (data) => request("/sms/send", { method: "POST", body: JSON.stringify(data) }),
    bulkSms: (data) => request("/sms/bulk", { method: "POST", body: JSON.stringify(data) }),
    testSms: (phone) => request("/sms/test", { method: "POST", body: JSON.stringify({ phone }) }),
    // Offline Sync
    syncOfflineSales: (sales) => request("/sync/sales", { method: "POST", body: JSON.stringify({ sales }) }),
    // Payment Verification
    verifyPayment: (data) => request("/payments/verify", { method: "POST", body: JSON.stringify(data) }),
    getPaymentVerifications: (saleId) => request(`/payments/verify/${saleId}`),
    initializePayment: (data) => request("/payments/initialize", { method: "POST", body: JSON.stringify(data) }),
    getGatewayStatus: () => request("/payments/gateway-status"),
    // Payment Settings (Admin)
    getPaymentSettings: () => request("/payment-settings"),
    updatePaymentSettings: (data) => request("/payment-settings", { method: "PUT", body: JSON.stringify(data) }),
    // Terminal Management
    fetchTerminals: () => request("/terminals"),
    getTerminal: (id) => request(`/terminals/${id}`),
    createTerminal: (data) => request("/terminals", { method: "POST", body: JSON.stringify(data) }),
    updateTerminal: (id, data) => request(`/terminals/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteTerminal: (id) => request(`/terminals/${id}`, { method: "DELETE" }),
    chargeTerminal: (terminalId, data) => request(`/terminals/${terminalId}/charge`, { method: "POST", body: JSON.stringify(data) }),
    getTerminalTxStatus: (txId) => request(`/terminals/transactions/${txId}/status`),
    fetchTerminalTransactions: (params) => request(`/terminals/transactions${params ? `?${new URLSearchParams(params)}` : ""}`),
    // Admin Backup
    downloadBackup: async () => {
      const token = localStorage.getItem("rhosam_token");
      const r = await fetch(`${API}/admin/backup`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || "Backup failed"); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `rhosam-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    uploadProductImage: async (productId, file) => {
      const formData = new FormData();
      formData.append("image", file);
      const r = await fetch(`${API}/products/${productId}/image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("rhosam_token")}` },
        body: formData,
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || "Upload failed"); }
      return r.json();
    },
    // ── Store Commerce Features ──────────────────────────────────
    // Gift Cards
    fetchGiftCards: (params) => request(`/gift-cards${params ? `?${new URLSearchParams(params)}` : ""}`),
    createGiftCard: (data) => request("/gift-cards", { method: "POST", body: JSON.stringify(data) }),
    validateGiftCard: (code) => request("/gift-cards/validate", { method: "POST", body: JSON.stringify({ code }) }),
    redeemGiftCard: (data) => request("/gift-cards/redeem", { method: "POST", body: JSON.stringify(data) }),
    fetchGiftCardTransactions: (id) => request(`/gift-cards/${id}/transactions`),
    deleteGiftCard: (id) => request(`/gift-cards/${id}`, { method: "DELETE" }),
    // Coupons
    fetchCoupons: (params) => request(`/coupons${params ? `?${new URLSearchParams(params)}` : ""}`),
    createCoupon: (data) => request("/coupons", { method: "POST", body: JSON.stringify(data) }),
    validateCoupon: (data) => request("/coupons/validate", { method: "POST", body: JSON.stringify(data) }),
    updateCoupon: (id, data) => request(`/coupons/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteCoupon: (id) => request(`/coupons/${id}`, { method: "DELETE" }),
    // Shifts
    fetchShifts: (params) => request(`/shifts${params ? `?${new URLSearchParams(params)}` : ""}`),
    getActiveShift: () => request("/shifts/active"),
    openShift: (data) => request("/shifts/open", { method: "POST", body: JSON.stringify(data) }),
    closeShift: (id, data) => request(`/shifts/${id}/close`, { method: "POST", body: JSON.stringify(data) }),
    getShiftSummary: (id) => request(`/shifts/${id}/summary`),
    // Tasks
    fetchTasks: (params) => request(`/tasks${params ? `?${new URLSearchParams(params)}` : ""}`),
    createTask: (data) => request("/tasks", { method: "POST", body: JSON.stringify(data) }),
    updateTask: (id, data) => request(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteTask: (id) => request(`/tasks/${id}`, { method: "DELETE" }),
    fetchTaskComments: (id) => request(`/tasks/${id}/comments`),
    addTaskComment: (id, data) => request(`/tasks/${id}/comments`, { method: "POST", body: JSON.stringify(data) }),
    // Commissions
    fetchCommissions: (params) => request(`/commissions${params ? `?${new URLSearchParams(params)}` : ""}`),
    approveCommissions: (ids) => request("/commissions/approve", { method: "POST", body: JSON.stringify({ ids }) }),
    payCommissions: (ids) => request("/commissions/pay", { method: "POST", body: JSON.stringify({ ids }) }),
    fetchCommissionRules: () => request("/commissions/rules"),
    createCommissionRule: (data) => request("/commissions/rules", { method: "POST", body: JSON.stringify(data) }),
    fetchCommissionSummary: (params) => request(`/commissions/summary${params ? `?${new URLSearchParams(params)}` : ""}`),
    // Bundles
    fetchBundles: (params) => request(`/bundles${params ? `?${new URLSearchParams(params)}` : ""}`),
    getBundle: (id) => request(`/bundles/${id}`),
    createBundle: (data) => request("/bundles", { method: "POST", body: JSON.stringify(data) }),
    updateBundle: (id, data) => request(`/bundles/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteBundle: (id) => request(`/bundles/${id}`, { method: "DELETE" }),
    // Quotations
    fetchQuotations: (params) => request(`/quotations${params ? `?${new URLSearchParams(params)}` : ""}`),
    getQuotation: (id) => request(`/quotations/${id}`),
    createQuotation: (data) => request("/quotations", { method: "POST", body: JSON.stringify(data) }),
    updateQuotation: (id, data) => request(`/quotations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    convertQuotation: (id) => request(`/quotations/${id}/convert`, { method: "POST" }),
    deleteQuotation: (id) => request(`/quotations/${id}`, { method: "DELETE" }),
    // Customer Notes / Clienteling
    fetchCustomerNotes: (id) => request(`/customers/${id}/notes`),
    addCustomerNote: (id, data) => request(`/customers/${id}/notes`, { method: "POST", body: JSON.stringify(data) }),
    deleteCustomerNote: (id) => request(`/customers/notes/${id}`, { method: "DELETE" }),
    fetchCustomerActivities: (id, params) => request(`/customers/${id}/activities${params ? `?${new URLSearchParams(params)}` : ""}`),
    // Price Checks
    priceCheck: (data) => request("/price-check", { method: "POST", body: JSON.stringify(data) }),
    fetchPriceChecks: (params) => request(`/price-checks${params ? `?${new URLSearchParams(params)}` : ""}`),
    // Product Detail
    fetchProductDetail: (id) => request(`/products/${id}/detail`),
    // ── Priority Gaps ─────────────────────────────────────────────
    // 1. Offline Mode
    syncOfflineData: (data) => request("/offline/sync", { method: "POST", body: JSON.stringify(data) }),
    getOfflineSyncStatus: (params) => request(`/offline/sync/status${params ? `?${new URLSearchParams(params)}` : ""}`),
    processOfflineSync: () => request("/offline/sync/process", { method: "POST" }),
    cacheOfflineData: (data) => request("/offline/cache", { method: "POST", body: JSON.stringify(data) }),
    getOfflineCache: (params) => request(`/offline/cache?${new URLSearchParams(params)}`),
    // 2. Product Variants
    fetchProductVariants: (id) => request(`/products/${id}/variants`),
    fetchProductVariantOptions: (id) => request(`/products/${id}/variant-options`),
    createProductVariants: (id, data) => request(`/products/${id}/variants`, { method: "POST", body: JSON.stringify(data) }),
    updateVariant: (id, data) => request(`/variants/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteVariant: (id) => request(`/variants/${id}`, { method: "DELETE" }),
    // 3. Discount Rules
    fetchDiscountRules: (params) => request(`/discount-rules${params ? `?${new URLSearchParams(params)}` : ""}`),
    createDiscountRule: (data) => request("/discount-rules", { method: "POST", body: JSON.stringify(data) }),
    calculateDiscounts: (data) => request("/discount-rules/calculate", { method: "POST", body: JSON.stringify(data) }),
    updateDiscountRule: (id, data) => request(`/discount-rules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteDiscountRule: (id) => request(`/discount-rules/${id}`, { method: "DELETE" }),
    // 4. Multi-Currency
    fetchCurrencies: () => request("/currencies"),
    fetchCurrencyRates: (params) => request(`/currencies/rates${params ? `?${new URLSearchParams(params)}` : ""}`),
    convertCurrency: (data) => request("/currencies/convert", { method: "POST", body: JSON.stringify(data) }),
    updateCurrencyRates: (data) => request("/currencies/rates", { method: "PUT", body: JSON.stringify(data) }),
    createCurrency: (data) => request("/currencies", { method: "POST", body: JSON.stringify(data) }),
    // 5. Digital Wallets
    getDigitalWalletStatus: () => request("/digital-wallets/status"),
    updateDigitalWallets: (data) => request("/digital-wallets", { method: "PUT", body: JSON.stringify(data) }),
    // 6. Wish Lists
    fetchWishlists: (customerId) => request(`/wishlists/${customerId}`),
    addWishlistItem: (data) => request("/wishlists", { method: "POST", body: JSON.stringify(data) }),
    removeWishlistItem: (id) => request(`/wishlists/${id}`, { method: "DELETE" }),
    // 7. Receipt Templates
    fetchReceiptTemplates: () => request("/receipt-templates"),
    getReceiptTemplate: (id) => request(`/receipt-templates/${id}`),
    createReceiptTemplate: (data) => request("/receipt-templates", { method: "POST", body: JSON.stringify(data) }),
    updateReceiptTemplate: (id, data) => request(`/receipt-templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteReceiptTemplate: (id) => request(`/receipt-templates/${id}`, { method: "DELETE" }),
    previewReceiptTemplate: (id) => request(`/receipt-templates/${id}/preview`, { method: "POST" }),
    // 8. Fulfillment
    fetchFulfillments: (params) => request(`/fulfillments${params ? `?${new URLSearchParams(params)}` : ""}`),
    getFulfillment: (id) => request(`/fulfillments/${id}`),
    createFulfillment: (data) => request("/fulfillments", { method: "POST", body: JSON.stringify(data) }),
    updateFulfillmentStatus: (id, data) => request(`/fulfillments/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
    updateFulfillmentItem: (fulfillmentId, itemId, data) => request(`/fulfillments/${fulfillmentId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteFulfillment: (id) => request(`/fulfillments/${id}`, { method: "DELETE" }),
    // ── Final Gaps ────────────────────────────────────────────────
    // Layaway/Deposits
    fetchLayawayOrders: (params) => request(`/layaway-orders${params ? `?${new URLSearchParams(params)}` : ""}`),
    getLayawayOrder: (id) => request(`/layaway-orders/${id}`),
    createLayawayOrder: (data) => request("/layaway-orders", { method: "POST", body: JSON.stringify(data) }),
    payLayawayOrder: (id, data) => request(`/layaway-orders/${id}/pay`, { method: "POST", body: JSON.stringify(data) }),
    fulfillLayawayOrder: (id) => request(`/layaway-orders/${id}/fulfill`, { method: "POST" }),
    deleteLayawayOrder: (id) => request(`/layaway-orders/${id}`, { method: "DELETE" }),
    // Loyalty Points
    fetchLoyaltyPoints: (params) => request(`/loyalty/points${params ? `?${new URLSearchParams(params)}` : ""}`),
    getLoyaltyPoints: (customerId) => request(`/loyalty/points/${customerId}`),
    earnLoyaltyPoints: (data) => request("/loyalty/earn", { method: "POST", body: JSON.stringify(data) }),
    redeemLoyaltyPoints: (data) => request("/loyalty/redeem", { method: "POST", body: JSON.stringify(data) }),
    adjustLoyaltyPoints: (data) => request("/loyalty/adjust", { method: "POST", body: JSON.stringify(data) }),
    fetchLoyaltyRules: () => request("/loyalty/rules"),
    createLoyaltyRule: (data) => request("/loyalty/rules", { method: "POST", body: JSON.stringify(data) }),
    deleteLoyaltyRule: (id) => request(`/loyalty/rules/${id}`, { method: "DELETE" }),
    // Customer Groups
    fetchCustomerGroups: () => request("/customer-groups"),
    createCustomerGroup: (data) => request("/customer-groups", { method: "POST", body: JSON.stringify(data) }),
    updateCustomerGroup: (id, data) => request(`/customer-groups/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteCustomerGroup: (id) => request(`/customer-groups/${id}`, { method: "DELETE" }),
    addGroupMember: (groupId, customerId) => request(`/customer-groups/${groupId}/members`, { method: "POST", body: JSON.stringify({ customerId }) }),
    removeGroupMember: (groupId, customerId) => request(`/customer-groups/${groupId}/members/${customerId}`, { method: "DELETE" }),
    fetchGroupMembers: (groupId) => request(`/customer-groups/${groupId}/members`),
    // Marketing Segmentation
    fetchMarketingSegments: () => request("/marketing/segments"),
    createMarketingSegment: (data) => request("/marketing/segments", { method: "POST", body: JSON.stringify(data) }),
    previewSegment: (id) => request(`/marketing/segments/${id}/preview`, { method: "POST" }),
    deleteMarketingSegment: (id) => request(`/marketing/segments/${id}`, { method: "DELETE" }),
    fetchMarketingCampaigns: () => request("/marketing/campaigns"),
    createMarketingCampaign: (data) => request("/marketing/campaigns", { method: "POST", body: JSON.stringify(data) }),
    sendCampaign: (id) => request(`/marketing/campaigns/${id}/send`, { method: "POST" }),
    deleteMarketingCampaign: (id) => request(`/marketing/campaigns/${id}`, { method: "DELETE" }),
    // Label Printing
    fetchLabelTemplates: () => request("/label-templates"),
    createLabelTemplate: (data) => request("/label-templates", { method: "POST", body: JSON.stringify(data) }),
    updateLabelTemplate: (id, data) => request(`/label-templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteLabelTemplate: (id) => request(`/label-templates/${id}`, { method: "DELETE" }),
    previewLabels: (data) => request("/label-templates/preview", { method: "POST", body: JSON.stringify(data) }),
    // Omnichannel (BOPIS / Endless Aisle)
    fetchOmnichannelOrders: (params) => request(`/omnichannel${params ? `?${new URLSearchParams(params)}` : ""}`),
    getOmnichannelOrder: (id) => request(`/omnichannel/${id}`),
    createOmnichannelOrder: (data) => request("/omnichannel", { method: "POST", body: JSON.stringify(data) }),
    updateOmnichannelStatus: (id, data) => request(`/omnichannel/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
    assignOmnichannelOrder: (id, data) => request(`/omnichannel/${id}/assign`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteOmnichannelOrder: (id) => request(`/omnichannel/${id}`, { method: "DELETE" }),
    fetchEndlessAisle: () => request("/endless-aisle"),
    createEndlessAisle: (data) => request("/endless-aisle", { method: "POST", body: JSON.stringify(data) }),
  }), [user, loading, login, logout, request, notifyDataChange, dataVersion]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
};
