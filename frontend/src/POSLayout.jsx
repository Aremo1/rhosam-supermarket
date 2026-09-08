import React, { createContext, useContext, useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { useHeldOrders } from "./useHeldOrders";
import { usePosStatus } from "./posStatusBridge";

function fmtClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function fmtClockDate() {
  const now = new Date();
  return now.toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const STATUS_PILLS = [
  { label: "Connected", ok: true },
  { label: "Scanner Connected", ok: true },
  { label: "Hold", warn: true },
];

const POSContext = createContext(null);

export function usePOSApp() {
  const ctx = useContext(POSContext);
  if (!ctx) throw new Error("usePOSApp must be used inside POSLayout");
  return ctx;
}

export default function POSLayout({ children }) {
  const { user } = useAuth();
  const heldOrders = useHeldOrders().held;
  const posStatus = usePosStatus();
  const [clock, setClock] = useState(fmtClock);
  const [clockDate, setClockDate] = useState(fmtClockDate);
  const [activeTab, setActiveTab] = useState("lines");
  const [holdExpanded, setHoldExpanded] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [keypadMode, setKeypadMode] = useState("quantity");
  const [keypadValue, setKeypadValue] = useState("");
  const [focusedLine, setFocusedLine] = useState(null);

  const dispatchKeypad = useCallback(() => {
    if (keypadValue == null || keypadValue === "") return;
    if (keypadMode === "search") {
      setKeypadMode("search");
      setKeypadValue("");
    } else if (focusedLine != null) {
      setKeypadValue("");
    } else {
      setKeypadValue("");
    }
  }, [keypadMode, keypadValue, focusedLine, setKeypadValue, setKeypadMode]);

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(fmtClock());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setClockDate(fmtClockDate());
  }, []);

  const branchName =
    user?.branch?.name || user?.storeName || "POS Terminal";
  const cashierName = user?.name || "Cashier";
  const role = user?.role || "CASHIER";
  const themeOn = localStorage.getItem("rhosam-theme") !== "dark";

  const posContextValue = {
    activeTab,
    setActiveTab,
    selectedCategory,
    onCategoryChange: setSelectedCategory,
    keypadMode,
    setKeypadMode,
    keypadValue,
    setKeypadValue,
    focusedLine,
    onFocusLine: setFocusedLine,
    keypadDispatch: dispatchKeypad,
  };

  return (
    <div className="pos-shell">
      {/* Header */}
      <header className="pos-header">
        <div className="pos-header-left">
          <h1 className="pos-title">Point of Sale</h1>
          <div className="pos-cashier">
            <div className="pos-avatar">{cashierName?.[0]?.toUpperCase() || "C"}</div>
            <div>
              <div className="pos-cashier-name">{cashierName}</div>
              <div className="pos-branch">{branchName}</div>
            </div>
          </div>
        </div>

        <div className="pos-header-center">
          <div className="pos-clock-time">{clock}</div>
          <div className="pos-clock-date">{clockDate}</div>
        </div>

        <div className="pos-header-right">
          <button className="pos-theme-btn" type="button" title="Toggle theme">
            {themeOn ? "☀️" : "🌙"}
          </button>
          <button className="pos-notif-btn" type="button" title="Notifications">
            🔔
          </button>
          <div className="pos-identity">
            <span className="pos-org">🏢 {branchName}</span>
            <span className="pos-role-pill">{role}</span>
          </div>
        </div>

        <div className="pos-status-pills">
          {STATUS_PILLS.map((pill) => (
            <React.Fragment key={pill.label}>
              <span
                className={`pos-status-pill ${
                  pill.ok ? "pos-status-ok" : pill.warn ? "pos-status-warn" : ""
                }`}
              >
                {pill.ok ? "●" : pill.warn ? "◉" : "○"} {pill.label}
              </span>
              {pill.warn && heldOrders.length > 0 && (
                <span className="pos-hold-chip" onClick={() => setHoldExpanded((v) => !v)}>
                  ⏸ Held {heldOrders.length} {heldOrders.length === 1 ? "order" : "orders"}
                </span>
              )}
            </React.Fragment>
          ))}
        </div>

        {holdExpanded && heldOrders.length > 0 && (
          <div className="pos-held-chip-panel">
            <div className="pos-held-chip-head">
              <span className="pos-held-chip-title">⏸ Held Orders ({heldOrders.length})</span>
              <button
                className="pos-held-chip-close"
                type="button"
                onClick={() => setHoldExpanded(false)}
              >
                ✕
              </button>
            </div>
            <ul className="pos-held-chip-list">
              {heldOrders.map((order) => (
                <li key={order.id} className="pos-held-chip-row">
                  <div className="pos-held-chip-info">
                    <span className="pos-held-chip-customer">{order.customerName}</span>
                    <span className="pos-held-chip-meta">
                      {order.cart.length} item{order.cart.length !== 1 ? "s" : ""} · ₦
                      {order.cart.reduce((s, c) => s + (parseFloat(c.price) || 0) * (c.quantity || 1), 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="pos-held-chip-actions">
                    <button
                      className="pos-held-chip-resume"
                      type="button"
                      onClick={() => {
                        window.location.href = "/pos?resumeHeld=1";
                      }}
                    >
                      Resume
                    </button>
                    <button
                      className="pos-held-chip-discard"
                      type="button"
                      onClick={() => {
                        window.location.href = "/pos?discardHeld=" + encodeURIComponent(order.id);
                      }}
                    >
                      Discard
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      {/* Body */}
      <div className="pos-body">
        {/* Main area */}
        <div className="pos-main">
          {/* Tabs */}
          <div className="pos-tabs" role="tablist">
            <button
              className={`pos-tab ${activeTab === "lines" ? "pos-tab-active" : ""}`}
              onClick={() => setActiveTab("lines")}
            >
              Lines
            </button>
            <button
              className={`pos-tab ${activeTab === "payments" ? "pos-tab-active" : ""}`}
              onClick={() => setActiveTab("payments")}
            >
              Payments
            </button>
          </div>

          {/* Content slot */}
          <POSContext.Provider value={posContextValue}>
            <div className="pos-content">{children}</div>
          </POSContext.Provider>
        </div>

        {/* Right panel */}
        <aside className="pos-right-panel">
          <div className="pos-right-search">
            <input
              type="text"
              className="pos-right-search-input"
              placeholder={keypadMode === "search" ? "Search products…" : "Enter quantity"}
              value={keypadValue}
              onChange={(e) => setKeypadValue(e.target.value)}
              onFocus={() => setKeypadMode(keypadMode === "search" ? "search" : "quantity")}
            />
          </div>

          <div className="pos-keypad">
            <div className="pos-keypad-row">
              <button type="button" className="pos-keypad-key" onClick={() => setKeypadValue((v) => v + "7")}>7</button>
              <button type="button" className="pos-keypad-key" onClick={() => setKeypadValue((v) => v + "8")}>8</button>
              <button type="button" className="pos-keypad-key" onClick={() => setKeypadValue((v) => v + "9")}>9</button>
            </div>
            <div className="pos-keypad-row">
              <button type="button" className="pos-keypad-key pos-keypad-action" onClick={() => setKeypadValue((v) => v.slice(0, -1))}>←</button>
              <button type="button" className="pos-keypad-key" onClick={() => setKeypadValue((v) => v + "4")}>4</button>
              <button type="button" className="pos-keypad-key" onClick={() => setKeypadValue((v) => v + "5")}>5</button>
            </div>
            <div className="pos-keypad-row">
              <button type="button" className="pos-keypad-key" onClick={() => setKeypadValue((v) => v + "6")}>6</button>
              <button type="button" className="pos-keypad-key pos-keypad-toggle" onClick={() => setKeypadMode((m) => (m === "search" ? "quantity" : "search"))}>±</button>
              <button type="button" className="pos-keypad-key" onClick={() => setKeypadValue((v) => v + "1")}>1</button>
            </div>
            <div className="pos-keypad-row">
              <button type="button" className="pos-keypad-key" onClick={() => setKeypadValue((v) => v + "2")}>2</button>
              <button type="button" className="pos-keypad-key" onClick={() => setKeypadValue((v) => v + "3")}>3</button>
              <button type="button" className="pos-keypad-key pos-keypad-action">*</button>
            </div>
            <div className="pos-keypad-row">
              <button type="button" className="pos-keypad-key pos-keypad-wide" onClick={() => setKeypadValue((v) => v + "0")}>0</button>
              <button type="button" className="pos-keypad-key">.</button>
              <button type="button" className="pos-keypad-key pos-keypad-toggle" onClick={() => setKeypadMode((m) => (m === "search" ? "quantity" : "search"))}>abc</button>
            </div>
            <div className="pos-keypad-row pos-keypad-enter-row">
              <button type="button" className="pos-keypad-enter" onClick={dispatchKeypad}>↵</button>
            </div>
          </div>

          <div className="pos-categories">
            <button
              type="button"
              className={`pos-category-pill ${selectedCategory === "" ? "pos-category-active" : ""}`}
              onClick={() => setSelectedCategory("")}
            >
              All
            </button>
            <button
              type="button"
              className={`pos-category-pill ${selectedCategory === "200" ? "pos-category-active" : ""}`}
              onClick={() => setSelectedCategory("200")}
            >
              200
            </button>
            <button
              type="button"
              className={`pos-category-pill ${selectedCategory === "Baby Care Section" ? "pos-category-active" : ""}`}
              onClick={() => setSelectedCategory("Baby Care Section")}
            >
              Baby Care Section
            </button>
            <button
              type="button"
              className={`pos-category-pill ${selectedCategory === "Bakery Section" ? "pos-category-inactive" : ""}`}
              onClick={() => setSelectedCategory("Bakery Section")}
            >
              Bakery Section
            </button>
            <button
              type="button"
              className={`pos-category-pill ${selectedCategory === "Beverages" ? "pos-category-active" : ""}`}
              onClick={() => setSelectedCategory("Beverages")}
            >
              Beverages
            </button>
            <button
              type="button"
              className={`pos-category-pill ${selectedCategory === "Bottle Water" ? "pos-category-active" : ""}`}
              onClick={() => setSelectedCategory("Bottle Water")}
            >
              Bottle Water
            </button>
            <button
              type="button"
              className={`pos-category-pill ${selectedCategory === "Children & Toys Section" ? "pos-category-active" : ""}`}
              onClick={() => setSelectedCategory("Children & Toys Section")}
            >
              Children & Toys Section
            </button>
            <button
              type="button"
              className={`pos-category-pill ${selectedCategory === "Confectionaries & Snacks" ? "pos-category-active" : ""}`}
              onClick={() => setSelectedCategory("Confectionaries & Snacks")}
            >
              Confectionaries & Snacks
            </button>
            <button
              type="button"
              className={`pos-category-pill ${selectedCategory === "Electronics" ? "pos-category-active" : ""}`}
              onClick={() => setSelectedCategory("Electronics")}
            >
              Electronics
            </button>
          </div>
        </aside>

        {/* Far right vertical nav */}
        <nav className="pos-far-nav">
          <button className="pos-far-nav-item" type="button">
            <span className="pos-far-nav-icon">🏠</span>
            <span className="pos-far-nav-label">Home</span>
          </button>
          <button className="pos-far-nav-item" type="button">
            <span className="pos-far-nav-icon">⚡</span>
            <span className="pos-far-nav-label">ACTIONS</span>
          </button>
          <button className="pos-far-nav-item" type="button">
            <span className="pos-far-nav-icon">🛒</span>
            <span className="pos-far-nav-label">ORDERS</span>
          </button>
          <button className="pos-far-nav-item" type="button">
            <span className="pos-far-nav-icon">🏷️</span>
            <span className="pos-far-nav-label">DISCOUNTS</span>
          </button>
          <button className="pos-far-nav-item" type="button">
            <span className="pos-far-nav-icon">📦</span>
            <span className="pos-far-nav-label">PRODUCTS</span>
          </button>
        </nav>
      </div>

      {/* Bottom amount-due strip */}
      <footer className="pos-amount-due">
        <div className="pos-amount-due-label">AMOUNT DUE</div>
        <div className="pos-amount-due-value">₦0.00</div>
      </footer>
    </div>
  );
}
