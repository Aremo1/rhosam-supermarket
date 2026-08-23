import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const AuthContext = createContext(null);
const API = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(/\/$/, "");

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
    return d.user;
  }

  const value = useMemo(() => ({
    user, loading, login, logout, request,
    // Convenience wrappers
    fetchProducts: (q) => request(`/products${q ? `?search=${encodeURIComponent(q)}` : ""}`),
    createProduct: (data) => request("/products", { method: "POST", body: JSON.stringify(data) }),
    updateProduct: (id, data) => request(`/products/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteProduct: (id) => request(`/products/${id}`, { method: "DELETE" }),
    adjustStock: (id, data) => request(`/products/${id}/adjust`, { method: "POST", body: JSON.stringify(data) }),
    fetchLowStock: () => request("/products/low-stock"),
    fetchInventoryMovements: (productId) => request(`/inventory/movements${productId ? `?product_id=${productId}` : ""}`),
    fetchSales: (params) => request(`/sales${params ? `?${new URLSearchParams(params)}` : ""}`),
    getSale: (id) => request(`/sales/${id}`),
    createSale: (data) => request("/sales", { method: "POST", body: JSON.stringify(data) }),
    returnSale: (saleId, data) => request(`/sales/${saleId}/return`, { method: "POST", body: JSON.stringify(data) }),
    fetchUsers: () => request("/users"),
    createUser: (data) => request("/users", { method: "POST", body: JSON.stringify(data) }),
    updateUser: (id, data) => request(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteUser: (id) => request(`/users/${id}`, { method: "DELETE" }),
    changePassword: (current, newPwd) => request("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: newPwd }) }),
    fetchDashboard: () => request("/dashboard/stats"),
    fetchTopProducts: () => request("/dashboard/top-products"),
    fetchCategorySales: () => request("/dashboard/category-sales"),
    fetchSuppliers: () => request("/suppliers"),
    createSupplier: (data) => request("/suppliers", { method: "POST", body: JSON.stringify(data) }),
    updateSupplier: (id, data) => request(`/suppliers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteSupplier: (id) => request(`/suppliers/${id}`, { method: "DELETE" }),
    fetchPurchaseOrders: () => request("/purchase-orders"),
    getPurchaseOrder: (id) => request(`/purchase-orders/${id}`),
    createPurchaseOrder: (data) => request("/purchase-orders", { method: "POST", body: JSON.stringify(data) }),
    updatePOStatus: (id, status) => request(`/purchase-orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    fetchCustomers: () => request("/customers"),
    createCustomer: (data) => request("/customers", { method: "POST", body: JSON.stringify(data) }),
    updateCustomer: (id, data) => request(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    fetchExpenses: () => request("/expenses"),
    createExpense: (data) => request("/expenses", { method: "POST", body: JSON.stringify(data) }),
    fetchFinanceSummary: () => request("/finance/summary"),
    fetchAuditLogs: (limit) => request(`/audit-logs${limit ? `?limit=${limit}` : ""}`),
    fetchCategories: () => request("/categories"),
    fetchBranches: () => request("/branches"),
    createBranch: (data) => request("/branches", { method: "POST", body: JSON.stringify(data) }),
    updateBranch: (id, data) => request(`/branches/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteBranch: (id) => request(`/branches/${id}`, { method: "DELETE" }),
    fetchCashDrawers: () => request("/cash-drawer"),
    getActiveDrawer: () => request("/cash-drawer/active"),
    openDrawer: (data) => request("/cash-drawer/open", { method: "POST", body: JSON.stringify(data) }),
    closeDrawer: (data) => request("/cash-drawer/close", { method: "POST", body: JSON.stringify(data) }),
    fetchDailyReport: (date) => request(`/reports/daily${date ? `?date=${date}` : ""}`),
    emailDailyReport: (data) => request("/reports/daily/email", { method: "POST", body: JSON.stringify(data) }),
    uploadProductImage: async (productId, file) => {
      const formData = new FormData();
      formData.append("image", file);
      const r = await fetch(`${API}/products/${productId}/image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
