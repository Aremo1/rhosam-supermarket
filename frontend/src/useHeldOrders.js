import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "rhosam-held-orders";

function defaultStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * A small persistence layer for held POS orders.
 *
 * A "held order" is a snapshot of the current in-progress sale:
 * - cart items
 * - customer name/email
 * - payment method
 * - discount / tax / amount paid so far
 * - cashier + branch at the time it was held
 * - timestamp
 *
 * This is intentionally frontend-local for now (localStorage) so a
 * cashier can hold an order, serve the next customer, and resume
 * later even after a browser refresh — without touching the backend.
 */
export function useHeldOrders() {
  const [held, setHeld] = useState(() => defaultStored());

  // Keep localStorage in sync with any state changes.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(held));
    } catch {
      // Storage full or unavailable — not fatal.
    }
  }, [held]);

  /** Capture the current in-progress order and clear the working state. */
  const hold = useCallback(
    (snapshot) => {
      const order = {
        id: "held-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        ...snapshot,
        heldAt: new Date().toISOString(),
      };
      setHeld((prev) => [order, ...prev]);
      return order;
    },
    []
  );

  /** Restore a held order into the active POS state and remove it from the held list. */
  const resume = useCallback(
    (orderId) => {
      setHeld((prev) => {
        const idx = prev.findIndex((o) => o.id === orderId);
        if (idx === -1) return prev;
        const [restored] = prev.splice(idx, 1);
        return prev;
      });
      return held.find((o) => o.id === orderId) || null;
    },
    [held]
  );

  /** Remove a held order without restoring it. */
  const remove = useCallback((orderId) => {
    setHeld((prev) => prev.filter((o) => o.id !== orderId));
  }, []);

  /** Clear all held orders. */
  const clearAll = useCallback(() => {
    setHeld([]);
  }, []);

  return {
    held,
    hold,
    resumeById: resume,
    remove,
    clearAll,
  };
}
