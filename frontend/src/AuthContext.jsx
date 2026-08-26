import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const AuthContext = createContext(null);
function resolveApiUrl(val) {
  if (!val) return "http://localhost:5000/api";
  // If it's just a hostname (no protocol), prepend https:// and append /api
  if (!/^https?:\/\//.test(val)) return `https://${val}/api`;
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
    user, loading, login, logout, request,
    // Convenience wrappers
    fetchProducts: (q, branchId) => request(`/products${(q || branchId) ? `?${new URLSearchParams({ ...(q ? { search: q } : {}), ...(branchId ? { branchId } : {}) })}` : ""}`),
    checkProductDuplicate: (field, value, excludeId) => request(`/products/check-duplicate?field=${field}&value=${encodeURIComponent(value)}${excludeId ? `&excludeId=${excludeId}` : ""}`),
    createProduct: (data) => request("/products", { method: "POST", body: JSON.stringify(data) }),
    updateProduct: (id, data) => request(`/products/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteProduct: (id) => request(`/products/${id}`, { method: "DELETE" }),
    adjustStock: (id, data) => request(`/products/${id}/adjust`, { method: "POST", body: JSON.stringify(data) }),
    fetchLowStock: () => request("/products/low-stock"),
    fetchInventoryMovements: (productId) => request(`/inventory/movements${productId ? `?product_id=${productId}` : ""}`),
    reportDamage: (data) => request("/inventory/damage", { method: "POST", body: JSON.stringify(data) }),
    reportWastage: (data) => request("/inventory/wastage", { method: "POST", body: JSON.stringify(data) }),
    fetchValuation: (branchId) => request(`/inventory/valuation${branchId ? `?branchId=${branchId}` : ""}`),
    captureSnapshot: (branchId) => request(`/inventory/snapshot${branchId ? `?branchId=${branchId}` : ""}`, { method: "POST" }),
    fetchValuationTrend: (branchId, days) => request(`/inventory/trend${branchId ? `?branchId=${branchId}` : ""}${days ? `${branchId ? '&' : '?'}days=${days}` : ""}`),
    fetchSales: (params) => request(`/sales${params ? `?${new URLSearchParams(params)}` : ""}`),
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
    fetchBranchSummary: () => request("/dashboard/branch-summary"),
    fetchSuppliers: () => request("/suppliers"),
    createSupplier: (data) => request("/suppliers", { method: "POST", body: JSON.stringify(data) }),
    updateSupplier: (id, data) => request(`/suppliers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteSupplier: (id) => request(`/suppliers/${id}`, { method: "DELETE" }),
    fetchPurchaseOrders: () => request("/purchase-orders"),
    getPurchaseOrder: (id) => request(`/purchase-orders/${id}`),
    createPurchaseOrder: (data) => request("/purchase-orders", { method: "POST", body: JSON.stringify(data) }),
    updatePOStatus: (id, status) => request(`/purchase-orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    getPOPayments: (id) => request(`/purchase-orders/${id}/payments`),
    createPOPayment: (id, data) => request(`/purchase-orders/${id}/payments`, { method: "POST", body: JSON.stringify(data) }),
    fetchCustomers: () => request("/customers"),
    createCustomer: (data) => request("/customers", { method: "POST", body: JSON.stringify(data) }),
    updateCustomer: (id, data) => request(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    fetchExpenses: () => request("/expenses"),
    createExpense: (data) => request("/expenses", { method: "POST", body: JSON.stringify(data) }),
    fetchFinanceSummary: () => request("/finance/summary"),
    fetchAuditLogs: (limit) => request(`/audit-logs${limit ? `?limit=${limit}` : ""}`),
    fetchLoginHistory: (params) => request(`/audit-logs/login-history${params ? `?${new URLSearchParams(params)}` : ""}`),
    fetchCategories: () => request("/categories"),
    createCategory: (data) => request("/categories", { method: "POST", body: JSON.stringify(data) }),
    updateCategory: (oldName, data) => request(`/categories/${encodeURIComponent(oldName)}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteCategory: (name) => request(`/categories/${encodeURIComponent(name)}`, { method: "DELETE" }),
    fetchBranches: () => request("/branches"),
    createBranch: (data) => request("/branches", { method: "POST", body: JSON.stringify(data) }),
    updateBranch: (id, data) => request(`/branches/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteBranch: (id) => request(`/branches/${id}`, { method: "DELETE" }),
    // Inter-branch messaging
    fetchMessages: (box) => request(`/messages${box ? `?box=${box}` : ""}`),
    getUnreadCount: () => request("/messages/unread"),
    sendMessage: (data) => request("/messages", { method: "POST", body: JSON.stringify(data) }),
    markMessageRead: (id) => request(`/messages/${id}/read`, { method: "PATCH" }),
    deleteMessage: (id) => request(`/messages/${id}`, { method: "DELETE" }),
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
    fetchAutoReorderSuggestions: () => request("/auto-reorder/suggestions"),
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
    fetchAudits: () => request('/inventory-audits'),
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
    fetchStockAlerts: (unreadOnly) => request(`/stock-alerts${unreadOnly ? '?unread=true' : ''}`),
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
    fetchExecutiveOverview: () => request("/executive/overview"),
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
  }), [user, loading, login, logout, request]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
};
