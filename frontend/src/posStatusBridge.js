/**
 * Tiny shared coordination bridge between POS and ScannerPage.
 *
 * This is intentionally minimal: POSPage updates a small status object,
 * ScannerPage reads it to decide what banner/state to show.
 *
 * Right now the only shared signal is:
 *  - hasHeldOrder: boolean
 *  - lastHeldAt: ISO timestamp (optional, for display only)
 *
 * This avoids importing POS internals into the scanner page and avoids
 * making scanner aware of the held-order snapshot structure.
 */
import { useState, useEffect } from "react";

let currentStatus = {
  hasHeldOrder: false,
  lastHeldAt: null,
};

let listeners = [];

function notify() {
  for (let i = 0; i < listeners.length; i += 1) {
    try {
      listeners[i](currentStatus);
    } catch {}
  }
}

export function setPosStatus(next) {
  if (next == null) return;
  const prev = currentStatus;
  currentStatus = {
    hasHeldOrder: !!next.hasHeldOrder,
    lastHeldAt: next.lastHeldAt ? String(next.lastHeldAt) : prev.lastHeldAt,
  };
  if (
    prev.hasHeldOrder !== currentStatus.hasHeldOrder ||
    prev.lastHeldAt !== currentStatus.lastHeldAt
  ) {
    notify();
  }
}

export function usePosStatus() {
  const [status, setStatus] = useState(currentStatus);
  useEffect(() => {
    const idx = listeners.push(setStatus) - 1;
    setStatus(currentStatus);
    return () => {
      listeners.splice(idx, 1);
    };
  }, []);
  return status;
}
