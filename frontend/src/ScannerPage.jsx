import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import QRCode from "qrcode";

// Use relative /api path — routes through the frontend server proxy
// (avoids cross-origin CORS issues on the phone browser)
const API = "/api";

export default function ScannerPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session") || "";
  const [status, setStatus] = useState("idle"); // idle, scanning, sending, sent, error
  const [scans, setScans] = useState([]);
  const [error, setError] = useState("");
  const [posConnected, setPosConnected] = useState(false);
  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);
  const manualInputRef = useRef(null);
  const lastScanTimeRef = useRef({}); // debounce: { [barcode]: timestamp }
  const [manualBarcode, setManualBarcode] = useState("");
  const [manualQty, setManualQty] = useState(1);
  const [manualSending, setManualSending] = useState(false);
  // Recent barcodes (persisted, sorted by frequency)
  const [recentBarcodes, setRecentBarcodes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("scanner-recent") || "[]");
    } catch { return []; }
  });
  // Pinned favorite barcodes (persisted)
  const [pinnedBarcodes, setPinnedBarcodes] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("scanner-pinned") || "[]"));
    } catch { return new Set(); }
  });

  const PIN_LIMIT = 8;

  // Toggle pin status for a barcode
  const togglePin = useCallback((barcode) => {
    setPinnedBarcodes((prev) => {
      const next = new Set(prev);
      if (next.has(barcode)) {
        next.delete(barcode);
      } else if (next.size < PIN_LIMIT) {
        next.add(barcode);
      }
      // Don't add if at limit — silently ignore
      try { localStorage.setItem("scanner-pinned", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);
  // Last scan for repeat button
  const [lastScan, setLastScan] = useState(null); // { barcode, qty, productName }
  // Screen flash on scan
  const [flashColor, setFlashColor] = useState(null); // "success" | "error" | null
  const flashTimerRef = useRef(null);
  // Running batch timer
  const [batchStartTime, setBatchStartTime] = useState(null);
  const [timerDisplay, setTimerDisplay] = useState("00:00");

  // Settings: sound & vibration (persisted to localStorage)
  const [beepVolume, setBeepVolume] = useState(() => {
    try { return Number(localStorage.getItem("scanner-volume")) || 70; } catch { return 70; }
  });
  const [vibrationEnabled, setVibrationEnabled] = useState(() => {
    try { return localStorage.getItem("scanner-vibration") !== "off"; } catch { return true; }
  });

  const soundEnabled = beepVolume > 0;

  // Persist settings
  useEffect(() => {
    try { localStorage.setItem("scanner-volume", String(beepVolume)); } catch {}
  }, [beepVolume]);
  useEffect(() => {
    try { localStorage.setItem("scanner-vibration", vibrationEnabled ? "on" : "off"); } catch {}
  }, [vibrationEnabled]);

  // Play a confirmation beep — success (product found)
  const playSuccessBeep = useCallback(() => {
    if (beepVolume <= 0) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const vol = 0.02 + (beepVolume / 100) * 0.18;
      // Single high-pitched tone: 1500 Hz, short
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 1500;
      osc.type = "square";
      gain.gain.value = vol;
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    } catch {}
  }, [beepVolume]);

  // Play an error beep — product not found (lower double-beep)
  const playErrorBeep = useCallback(() => {
    if (beepVolume <= 0) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const vol = 0.02 + (beepVolume / 100) * 0.18;
      // Double low-pitched tone: 440 Hz, two short pulses
      for (const offset of [0, 0.12]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 440;
        osc.type = "square";
        gain.gain.setValueAtTime(vol, ctx.currentTime + offset);
        gain.gain.setValueAtTime(0, ctx.currentTime + offset + 0.06);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.07);
      }
    } catch {}
  }, [beepVolume]);

  // Vibrate — success pattern (single short buzz)
  const vibrateSuccess = useCallback(() => {
    if (!vibrationEnabled) return;
    try { navigator.vibrate?.(100); } catch {}
  }, [vibrationEnabled]);

  // Vibrate — error pattern (two short buzzes)
  const vibrateError = useCallback(() => {
    if (!vibrationEnabled) return;
    try { navigator.vibrate?.([80, 60, 80]); } catch {}
  }, [vibrationEnabled]);

  // Trigger screen flash
  const triggerFlash = useCallback((type) => {
    setFlashColor(type);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashColor(null), 350);
  }, []);

  // Send barcode to backend
  const submitBarcode = useCallback(async (barcode) => {
    if (!sessionId) return;
    setStatus("sending");
    try {
      const res = await fetch(`${API}/scanner/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, barcode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to submit");
      
      // Different sound/vibration for found vs not-found
      if (data.product) {
        playSuccessBeep();
        vibrateSuccess();
        triggerFlash("success");
      } else {
        playErrorBeep();
        vibrateError();
        triggerFlash("error");
      }

      const scanEntry = {
        barcode,
        product: data.product,
        timestamp: Date.now(),
        sent: true,
      };
      setScans((prev) => [scanEntry, ...prev].slice(0, 50));
      setPosConnected(data.listeners > 0);
      setStatus("sent");

      // Update recent barcodes list (tracks cumulative stats across sessions)
      setRecentBarcodes((prev) => {
        const price = parseFloat(data.product?.price) || 0;
        const existing = prev.find(r => r.barcode === barcode);
        let updated;
        if (existing) {
          updated = prev.map(r => r.barcode === barcode
            ? {
                ...r,
                count: r.count + 1,
                totalCount: (r.totalCount || r.count) + 1,
                totalValue: (r.totalValue || 0) + price,
                product: data.product || r.product,
                lastUsed: Date.now(),
              }
            : r
          );
        } else {
          updated = [{
            barcode,
            product: data.product,
            count: 1,
            totalCount: 1,
            totalValue: price,
            lastUsed: Date.now(),
          }, ...prev];
        }
        // Keep top 12 most-used, sort by count descending then recency
        updated = updated
          .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
          .slice(0, 12);
        try { localStorage.setItem("scanner-recent", JSON.stringify(updated)); } catch {}
        return updated;
      });
      // Reset status after a brief moment
      setTimeout(() => setStatus("scanning"), 800);
    } catch (err) {
      setError(`Send failed: ${err.message}`);
      setStatus("error");
      setTimeout(() => { setError(""); setStatus("scanning"); }, 2000);
    }
  }, [sessionId, playSuccessBeep, playErrorBeep, vibrateSuccess, vibrateError]);

  // Start the camera scanner
  const startScanner = useCallback(async () => {
    if (!sessionId) {
      setError("No session ID provided. Open the scanner from the POS page.");
      return;
    }
    try {
      setStatus("scanning");
      const scanner = new Html5Qrcode("scanner-preview");
      html5QrRef.current = scanner;
      
      await scanner.start(
        { facingMode: "environment" }, // Rear camera
        {
          fps: 10,
          qrbox: { width: 280, height: 120 },
          aspectRatio: 1.7778,
          disableFlip: false,
        },
        (decodedText) => {
          // Debounce: don't re-scan the same barcode within 2 seconds
          const now = Date.now();
          const lastTime = lastScanTimeRef.current[decodedText] || 0;
          if (now - lastTime < 2000) return; // skip duplicate scan
          lastScanTimeRef.current[decodedText] = now;
          submitBarcode(decodedText);
        },
        () => {} // Ignore scan failures (expected when no barcode in view)
      );
    } catch (err) {
      console.error("[Scanner]", err);
      let msg = err.message || String(err);
      if (msg.includes("Permission") || msg.includes("permission") || msg.includes("NotAllowed")) {
        msg = "Camera permission denied. Please allow camera access in your browser settings and try again.";
      } else if (msg.includes("NotFoundError") || msg.includes("DevicesNotFound")) {
        msg = "No camera found on this device.";
      }
      setError(msg);
      setStatus("error");
    }
  }, [sessionId, submitBarcode]);

  // Stop scanner on unmount
  useEffect(() => {
    return () => {
      if (html5QrRef.current) {
        html5QrRef.current.stop().catch(() => {});
        html5QrRef.current.clear().catch(() => {});
      }
    };
  }, []);

  // Check POS connection periodically
  useEffect(() => {
    if (!sessionId) return;
    const check = async () => {
      try {
        const res = await fetch(`${API}/scanner/status?session=${sessionId}`);
        const data = await res.json();
        setPosConnected(data.connected || false);
      } catch {}
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // Compute batch stats from scan history
  const batchStats = React.useMemo(() => {
    const totalScans = scans.length;
    const foundScans = scans.filter(s => s.product);
    const notFoundScans = scans.filter(s => !s.product);
    const uniqueBarcodes = new Set(scans.map(s => s.barcode));
    const totalValue = foundScans.reduce((sum, s) => sum + (parseFloat(s.product?.price) || 0), 0);
    const avgPrice = foundScans.length > 0 ? totalValue / foundScans.length : 0;
    // Scan rate: scans per minute (based on session duration)
    const firstScan = scans.length > 0 ? scans[scans.length - 1].timestamp : Date.now();
    const lastScan = scans.length > 0 ? scans[0].timestamp : Date.now();
    const durationMinutes = Math.max((lastScan - firstScan) / 60000, 0.1);
    const scanRate = totalScans > 1 ? (totalScans / durationMinutes).toFixed(1) : "—";
    // Not-found product names grouped
    const notFoundNames = {};
    notFoundScans.forEach(s => { notFoundNames[s.barcode] = (notFoundNames[s.barcode] || 0) + 1; });
    return {
      totalScans,
      foundCount: foundScans.length,
      notFoundCount: notFoundScans.length,
      uniqueBarcodes: uniqueBarcodes.size,
      totalValue,
      avgPrice,
      scanRate,
      notFoundNames,
    };
  }, [scans]);

  // Track batch start time on first scan
  useEffect(() => {
    if (scans.length === 1 && !batchStartTime) {
      setBatchStartTime(scans[0].timestamp);
    } else if (scans.length === 0) {
      setBatchStartTime(null);
      setTimerDisplay("00:00");
    }
  }, [scans, batchStartTime]);

  // Tick the timer every second while scanning
  useEffect(() => {
    if (!batchStartTime) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - batchStartTime) / 1000);
      const h = Math.floor(elapsed / 3600);
      const m = Math.floor((elapsed % 3600) / 60);
      const s = elapsed % 60;
      setTimerDisplay(
        h > 0
          ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
          : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      );
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [batchStartTime]);

  // Reset batch
  const resetBatch = useCallback(() => {
    if (confirm("Clear scan history? This won't remove items from the POS cart.")) {
      setScans([]);
      setBatchStartTime(null);
      setTimerDisplay("00:00");
    }
  }, []);

  // Export filter: "all" | "found" | "not-found"
  const [exportFilter, setExportFilter] = useState("all");

  // Build CSV content from scan data (shared by download and share)
  const buildCsvBlob = useCallback(() => {
    // Group scans by barcode to compute quantities
    const grouped = {};
    const scanOrder = [];
    for (const scan of scans) {
      const key = scan.barcode;
      if (!grouped[key]) {
        grouped[key] = {
          barcode: scan.barcode,
          name: scan.product?.name || "",
          category: scan.product?.category || "",
          unitPrice: parseFloat(scan.product?.price) || 0,
          quantity: 0,
          found: !!scan.product,
          firstScanned: scan.timestamp,
        };
        scanOrder.push(key);
      }
      grouped[key].quantity++;
    }

    // Apply filter
    let rows = scanOrder.map(key => grouped[key]);
    if (exportFilter === "found") rows = rows.filter(r => r.found);
    if (exportFilter === "not-found") rows = rows.filter(r => !r.found);

    const header = ["Barcode", "Product Name", "Category", "Unit Price (₦)", "Quantity", "Line Total (₦)", "Status"];
    const csvRows = [header.join(",")];

    let grandTotal = 0;
    for (const row of rows) {
      const lineTotal = row.unitPrice * row.quantity;
      grandTotal += lineTotal;
      csvRows.push([
        `"${row.barcode}"`,
        `"${(row.name || "Unknown").replace(/"/g, '""')}"`,
        `"${row.category}"`,
        row.unitPrice.toFixed(2),
        row.quantity,
        lineTotal.toFixed(2),
        row.found ? "Found" : "Not Found",
      ].join(","));
    }

    // Summary based on full data (not filtered)
    const allRows = scanOrder.map(key => grouped[key]);
    csvRows.push("");
    csvRows.push(["", "", "", "", "", "", ""].join(","));
    csvRows.push(["", "SUMMARY", "", "", "", "", ""].join(","));
    if (exportFilter !== "all") {
      csvRows.push(["", "Filter", exportFilter === "found" ? "Found Only" : "Not Found Only", "", "", "", ""].join(","));
    }
    csvRows.push(["", "Total Scans", scans.length, "", "", "", ""].join(","));
    csvRows.push(["", "Unique Items", rows.length, "", "", "", ""].join(","));
    csvRows.push(["", "Products Found", allRows.filter(r => r.found).length, "", "", "", ""].join(","));
    csvRows.push(["", "Not Found", allRows.filter(r => !r.found).length, "", "", "", ""].join(","));
    csvRows.push(["", "Exported Total", "", "", "", grandTotal.toFixed(2), ""].join(","));
    csvRows.push(["", "Exported", new Date().toLocaleString("en-NG"), "", "", "", ""].join(","));

    const csvContent = csvRows.join("\n");
    const filterSuffix = exportFilter === "all" ? "" : `-${exportFilter}`;
    const filename = `scan-batch${filterSuffix}-${new Date().toISOString().slice(0, 10)}.csv`;
    return { blob: new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" }), filename };
  }, [scans, exportFilter]);

  // CSV preview state
  const [showCsvPreview, setShowCsvPreview] = useState(false);

  // Build preview rows (same logic as CSV but returns objects)
  const csvPreviewRows = React.useMemo(() => {
    const grouped = {};
    const scanOrder = [];
    for (const scan of scans) {
      const key = scan.barcode;
      if (!grouped[key]) {
        grouped[key] = {
          barcode: scan.barcode,
          name: scan.product?.name || "",
          category: scan.product?.category || "",
          unitPrice: parseFloat(scan.product?.price) || 0,
          quantity: 0,
          found: !!scan.product,
        };
        scanOrder.push(key);
      }
      grouped[key].quantity++;
    }
    let rows = scanOrder.map(key => grouped[key]);
    if (exportFilter === "found") rows = rows.filter(r => r.found);
    if (exportFilter === "not-found") rows = rows.filter(r => !r.found);
    return rows.map(r => ({ ...r, lineTotal: r.unitPrice * r.quantity }));
  }, [scans, exportFilter]);

  const csvPreviewTotal = csvPreviewRows.reduce((s, r) => s + r.lineTotal, 0);

  // Preview table sorting
  const [previewSort, setPreviewSort] = useState({ key: "name", dir: "asc" });
  const sortedPreviewRows = React.useMemo(() => {
    const sorted = [...csvPreviewRows];
    const { key, dir } = previewSort;
    const mul = dir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      switch (key) {
        case "barcode": return mul * a.barcode.localeCompare(b.barcode);
        case "name": return mul * (a.name || "zzz").localeCompare(b.name || "zzz");
        case "price": return mul * (a.unitPrice - b.unitPrice);
        case "qty": return mul * (a.quantity - b.quantity);
        case "total": return mul * (a.lineTotal - b.lineTotal);
        default: return 0;
      }
    });
    return sorted;
  }, [csvPreviewRows, previewSort]);

  // Preview tab: "table" or "csv"
  const [previewTab, setPreviewTab] = useState("table");
  // Preview search
  const [previewSearch, setPreviewSearch] = useState("");
  const [csvCopied, setCsvCopied] = useState(false);

  // Generate raw CSV text for preview
  const rawCsvText = React.useMemo(() => {
    const header = ["Barcode", "Product Name", "Category", "Unit Price (₦)", "Quantity", "Line Total (₦)", "Status"];
    const rows = filteredPreviewRows.map(r => [
      r.barcode,
      r.name || "Unknown",
      r.category || "",
      r.unitPrice.toFixed(2),
      r.quantity,
      r.lineTotal.toFixed(2),
      r.found ? "Found" : "Not Found",
    ]);
    const totalRow = ["", "TOTAL", "", "", filteredPreviewRows.reduce((s, r) => s + r.quantity, 0), (previewSearch ? filteredPreviewRows.reduce((s, r) => s + r.lineTotal, 0) : csvPreviewTotal).toFixed(2), ""];
    return [header.join(","), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")), "", totalRow.join(",")].join("\n");
  }, [filteredPreviewRows, csvPreviewTotal, previewSearch]);

  const copyCsvText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawCsvText);
      setCsvCopied(true);
      setTimeout(() => setCsvCopied(false), 2000);
    } catch {}
  }, [rawCsvText]);
  const filteredPreviewRows = React.useMemo(() => {
    const q = previewSearch.trim().toLowerCase();
    if (!q) return sortedPreviewRows;
    return sortedPreviewRows.filter(r =>
      r.barcode.toLowerCase().includes(q) ||
      (r.name || "").toLowerCase().includes(q) ||
      (r.category || "").toLowerCase().includes(q)
    );
  }, [sortedPreviewRows, previewSearch]);

  const togglePreviewSort = (key) => {
    setPreviewSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: key === "qty" || key === "total" ? "desc" : "asc" };
    });
  };

  const sortIndicator = (key) => {
    if (previewSort.key !== key) return "";
    return previewSort.dir === "asc" ? " ▲" : " ▼";
  };

  // Preview product from autocomplete for price estimate
  const previewProduct = lookupResults.length > 0 ? lookupResults[0] : null;
  const estimatedTotal = previewProduct ? (parseFloat(previewProduct.price) || 0) * manualQty : 0;

  // Download CSV
  const exportCsv = useCallback(() => {
    if (!scans.length) return;
    const { blob, filename } = buildCsvBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setShowCsvPreview(false);
  }, [scans, buildCsvBlob]);

  // Share CSV via Web Share API
  const shareCsv = useCallback(async () => {
    if (!scans.length) return;
    try {
      const { blob, filename } = buildCsvBlob();
      const file = new File([blob], filename, { type: "text/csv" });
      await navigator.share({
        files: [file],
        title: "Scan Batch Export",
        text: `Scan batch export — ${new Date().toLocaleDateString("en-NG")}`,
      });
      setShowCsvPreview(false);
    } catch (err) {
      // User cancelled or share failed — fall back to download
      if (err.name !== "AbortError") exportCsv();
    }
  }, [scans, buildCsvBlob, exportCsv]);

  // QR code for scan data
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const qrCanvasRef = useRef(null);

  // Generate QR code from scan data
  const generateQr = useCallback(async () => {
    if (!scans.length) return;
    // Group by barcode
    const grouped = {};
    const order = [];
    for (const s of scans) {
      if (!grouped[s.barcode]) {
        grouped[s.barcode] = { barcode: s.barcode, qty: 0 };
        order.push(s.barcode);
      }
      grouped[s.barcode].qty++;
    }
    // Compact format: RHOSAM:barcode1:qty1,barcode2:qty2,...
    const payload = `RHOSAM:${order.map(k => `${grouped[k].barcode}:${grouped[k].qty}`).join(",")}`;
    try {
      const url = await QRCode.toDataURL(payload, {
        width: 280,
        margin: 2,
        color: { dark: '#111827', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
      setQrDataUrl(url);
      setShowQrModal(true);
    } catch {}
  }, [scans]);

  // Print batch summary
  const printBatch = useCallback(() => {
    if (!scans.length) return;
    // Group by barcode
    const grouped = {};
    const order = [];
    for (const s of scans) {
      if (!grouped[s.barcode]) {
        grouped[s.barcode] = { barcode: s.barcode, name: s.product?.name || "Unknown", price: parseFloat(s.product?.price) || 0, qty: 0, found: !!s.product };
        order.push(s.barcode);
      }
      grouped[s.barcode].qty++;
    }
    const rows = order.map(k => grouped[k]);
    const totalValue = rows.reduce((s, r) => s + r.price * r.qty, 0);
    const duration = timerDisplay;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Scan Batch Report</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 6px 8px; border-bottom: 2px solid #ccc; font-size: 11px; text-transform: uppercase; color: #666; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; }
  .right { text-align: right; }
  .total { font-weight: bold; border-top: 2px solid #333; }
  .not-found { color: #b45309; }
  .summary { margin-top: 16px; font-size: 12px; color: #666; }
  @media print { body { padding: 12px; } }
</style></head><body>
<h1>📦 Scan Batch Report</h1>
<div class="meta">
  Date: ${new Date().toLocaleString("en-NG")} · Duration: ${duration} · ${batchStats.totalScans} scans · ${rows.length} unique items
</div>
<table>
  <thead><tr>
    <th>#</th><th>Barcode</th><th>Product</th><th class="right">Price</th><th class="right">Qty</th><th class="right">Total</th>
  </tr></thead>
  <tbody>
    ${rows.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td style="font-family:monospace">${r.barcode}</td>
      <td class="${r.found ? "" : "not-found"}">${r.name}${r.found ? "" : " ⚠️"}</td>
      <td class="right">₦${r.price.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
      <td class="right">${r.qty}</td>
      <td class="right">₦${(r.price * r.qty).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
    </tr>`).join("\n")}
    <tr class="total">
      <td colspan="4"></td>
      <td class="right">${rows.reduce((s, r) => s + r.qty, 0)}</td>
      <td class="right">₦${totalValue.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
    </tr>
  </tbody>
</table>
<div class="summary">
  Products found: ${rows.filter(r => r.found).length} · Not found: ${rows.filter(r => !r.found).length}
</div>
<script>window.onload = () => { window.print(); }</script>
</body></html>`;

    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }, [scans, batchStats, timerDisplay]);

  // Share plain text barcode list via Web Share API
  const sharePlainText = useCallback(async () => {
    if (!scans.length) return;
    // Group by barcode with quantities
    const grouped = {};
    const order = [];
    for (const s of scans) {
      if (!grouped[s.barcode]) {
        grouped[s.barcode] = { barcode: s.barcode, name: s.product?.name || null, qty: 0 };
        order.push(s.barcode);
      }
      grouped[s.barcode].qty++;
    }
    const lines = order.map(k => {
      const g = grouped[k];
      const name = g.name ? `${g.name} — ` : "";
      return `${name}${g.barcode}${g.qty > 1 ? ` (×${g.qty})` : ""}`;
    });
    const text = `📦 Scan Batch (${scans.length} scans, ${order.length} items)\n${new Date().toLocaleDateString("en-NG")}\n\n${lines.join("\n")}`;
    try {
      await navigator.share({ text, title: "Scan Batch" });
    } catch (err) {
      // Fallback: copy to clipboard
      if (err.name !== "AbortError") {
        try {
          await navigator.clipboard.writeText(text);
          setFlashColor("success");
          setTimeout(() => setFlashColor(null), 350);
        } catch {}
      }
    }
  }, [scans]);

  // Product autocomplete for manual entry
  const [lookupResults, setLookupResults] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const lookupTimerRef = useRef(null);

  // Debounced product lookup
  const fetchSuggestions = useCallback((query) => {
    if (lookupTimerRef.current) clearTimeout(lookupTimerRef.current);
    const q = query.trim();
    if (q.length < 2) { setLookupResults([]); setShowSuggestions(false); return; }
    lookupTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/scanner/lookup?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setLookupResults(data);
        setShowSuggestions(data.length > 0);
      } catch { setLookupResults([]); setShowSuggestions(false); }
    }, 250);
  }, []);

  // Handle manual input change with autocomplete
  const handleManualChange = useCallback((e) => {
    const val = e.target.value;
    setManualBarcode(val);
    fetchSuggestions(val);
  }, [fetchSuggestions]);

  // Select a suggestion
  const selectSuggestion = useCallback((product) => {
    setShowSuggestions(false);
    setLookupResults([]);
    // Submit the barcode directly
    submitBarcode(product.barcode);
    setManualBarcode("");
    setManualQty(1);
    setTimeout(() => manualInputRef.current?.focus(), 50);
  }, [submitBarcode]);

  // Handle manual barcode submit (sends barcode qty times for cart quantity)
  const handleManualSubmit = useCallback(async (e) => {
    e.preventDefault();
    const code = manualBarcode.trim();
    const qty = Math.max(1, Math.min(99, manualQty || 1));
    if (!code) return;
    setShowSuggestions(false);
    setLookupResults([]);
    setManualSending(true);
    try {
      // First scan: full submit with feedback
      await submitBarcode(code);
      // Additional scans: submit silently (increments cart quantity on POS)
      for (let i = 1; i < qty; i++) {
        try {
          await fetch(`${API}/scanner/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, barcode: code }),
          });
        } catch {}
      }
    } finally {
      // Save last scan for repeat button
      const productName = lookupResults.length > 0 ? lookupResults[0]?.name : null;
      setLastScan({ barcode: code, qty, productName });
      setManualBarcode("");
      setManualQty(1);
      setManualSending(false);
      setTimeout(() => manualInputRef.current?.focus(), 50);
    }
  }, [manualBarcode, manualQty, sessionId, submitBarcode, lookupResults]);

  // Undo toast state
  const [undoToast, setUndoToast] = useState(null); // { barcode, removedScans, productName }
  const undoTimerRef = useRef(null);
  // Barcodes currently animating out
  const [removingBarcodes, setRemovingBarcodes] = useState(new Set());
  const removeTimerRef = useRef({});

  // Remove all scans of a barcode from history (with animation + undo)
  const removeBarcode = useCallback((barcode) => {
    // Start slide-out animation
    setRemovingBarcodes(prev => new Set([...prev, barcode]));
    // After animation completes, actually remove
    removeTimerRef.current[barcode] = setTimeout(() => {
      setScans(prev => {
        const removed = prev.filter(s => s.barcode === barcode);
        const remaining = prev.filter(s => s.barcode !== barcode);
        if (removed.length > 0) {
          setUndoToast({ barcode, removedScans: removed, productName: removed[0]?.product?.name || barcode });
          if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
          undoTimerRef.current = setTimeout(() => setUndoToast(null), 5000);
        }
        return remaining;
      });
      setRemovingBarcodes(prev => {
        const next = new Set(prev);
        next.delete(barcode);
        return next;
      });
      delete removeTimerRef.current[barcode];
    }, 300); // Match animation duration
  }, []);

  // Undo delete — restore scans and cancel any pending animations
  const undoDelete = useCallback(() => {
    if (!undoToast) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    // Cancel any pending remove timers for this barcode
    const barcodes = undoToast.barcode.split(",");
    barcodes.forEach(b => {
      if (removeTimerRef.current[b]) {
        clearTimeout(removeTimerRef.current[b]);
        delete removeTimerRef.current[b];
      }
    });
    setRemovingBarcodes(prev => {
      const next = new Set(prev);
      barcodes.forEach(b => next.delete(b));
      return next;
    });
    setScans(prev => [...undoToast.removedScans, ...prev]);
    setUndoToast(null);
  }, [undoToast]);  // Long-press quantity editor state
  const [editingBarcode, setEditingBarcode] = useState(null);
  const [editQty, setEditQty] = useState(1);
  const longPressTimer = useRef(null);
  // History sort: "time" (most recent first) or "qty" (most scanned first)
  const [historySort, setHistorySort] = useState("time");
  const editInputRef = useRef(null);

  // Multi-select mode for batch delete/edit
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedBarcodes, setSelectedBarcodes] = useState(new Set());
  const [batchEditQty, setBatchEditQty] = useState(1);
  const [showBatchEditor, setShowBatchEditor] = useState(false);

  // Start long-press detection — enters multi-select mode
  const handleItemTouchStart = useCallback((barcode) => {
    longPressTimer.current = setTimeout(() => {
      // Haptic feedback on long-press trigger
      try { navigator.vibrate?.(50); } catch {}
      setMultiSelectMode(true);
      setSelectedBarcodes(new Set([barcode]));
      setEditingBarcode(null);
    }, 500);
  }, []);

  // Cancel long-press on move or release
  const handleItemTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Toggle item selection in multi-select mode
  const toggleSelect = useCallback((barcode) => {
    setSelectedBarcodes(prev => {
      const next = new Set(prev);
      if (next.has(barcode)) next.delete(barcode);
      else next.add(barcode);
      return next;
    });
  }, []);

  // Select/deselect all
  const selectAll = useCallback(() => {
    const all = new Set([...new Set(scans.map(s => s.barcode))]);
    setSelectedBarcodes(all);
  }, [scans]);
  const deselectAll = useCallback(() => setSelectedBarcodes(new Set()), []);

  // Batch delete selected barcodes (with animation)
  const batchDelete = useCallback(() => {
    if (selectedBarcodes.size === 0) return;
    const toDelete = [...selectedBarcodes];
    // Start slide-out animation for all selected
    setRemovingBarcodes(prev => new Set([...prev, ...toDelete]));
    setSelectedBarcodes(new Set());
    setMultiSelectMode(false);
    // After animation, remove them
    setTimeout(() => {
      setScans(prev => {
        const removed = prev.filter(s => toDelete.includes(s.barcode));
        const remaining = prev.filter(s => !toDelete.includes(s.barcode));
        if (removed.length > 0) {
          setUndoToast({ barcode: toDelete.join(","), removedScans: removed, productName: `${toDelete.length} item${toDelete.length !== 1 ? "s" : ""}` });
          if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
          undoTimerRef.current = setTimeout(() => setUndoToast(null), 5000);
        }
        return remaining;
      });
      setRemovingBarcodes(prev => {
        const next = new Set(prev);
        toDelete.forEach(b => next.delete(b));
        return next;
      });
    }, 300);
  }, [selectedBarcodes]);

  // Exit multi-select mode
  const exitMultiSelect = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedBarcodes(new Set());
    setShowBatchEditor(false);
    setBatchEditQty(1);
  }, []);

  // Apply batch quantity edit to selected items
  const applyBatchEdit = useCallback(() => {
    if (selectedBarcodes.size === 0) return;
    const qty = Math.max(1, Math.min(99, batchEditQty || 1));
    setScans(prev => {
      const result = [];
      for (const scan of prev) {
        if (selectedBarcodes.has(scan.barcode)) {
          // Keep one instance per selected barcode, update timestamp
          if (!result.find(r => r.barcode === scan.barcode)) {
            result.push({ ...scan, timestamp: Date.now() });
          }
        } else {
          result.push(scan);
        }
      }
      // Now add duplicate entries for each selected barcode to match qty
      const final = [];
      const seen = new Set();
      for (const scan of result) {
        final.push(scan);
        if (selectedBarcodes.has(scan.barcode) && !seen.has(scan.barcode)) {
          seen.add(scan.barcode);
          for (let i = 1; i < qty; i++) {
            final.push({ ...scan, timestamp: Date.now() + i });
          }
        }
      }
      return final;
    });
    setShowBatchEditor(false);
    setBatchEditQty(1);
    exitMultiSelect();
  }, [selectedBarcodes, batchEditQty, exitMultiSelect]);

  // Apply edited quantity
  const applyEditQty = useCallback(() => {
    if (!editingBarcode) return;
    const newQty = Math.max(1, Math.min(99, editQty || 1));
    setScans(prev => {
      // Get all scans of this barcode
      const matches = prev.filter(s => s.barcode === editingBarcode);
      const others = prev.filter(s => s.barcode !== editingBarcode);
      if (newQty <= matches.length) {
        // Trim to new quantity
        return [...matches.slice(0, newQty), ...others];
      } else {
        // Need to add more scans — duplicate the last scan entry
        const last = matches[matches.length - 1];
        const extra = [];
        for (let i = matches.length; i < newQty; i++) {
          extra.push({ ...last, timestamp: Date.now() + i });
        }
        return [...matches, ...extra, ...others];
      }
    });
    setEditingBarcode(null);
  }, [editingBarcode, editQty]);

  // Swipeable row component for mobile delete gesture
  function SwipeableRow({ barcode, children }) {
    const [offset, setOffset] = useState(0);
    const [swiping, setSwiping] = useState(false);
    const startX = useRef(0);
    const currentX = useRef(0);
    const threshold = -70;

    const onTouchStart = (e) => {
      startX.current = e.touches[0].clientX;
      currentX.current = 0;
      setSwiping(true);
    };
    const onTouchMove = (e) => {
      const dx = e.touches[0].clientX - startX.current;
      // Only allow left swipe, max -100px
      currentX.current = Math.min(0, Math.max(-100, dx));
      setOffset(currentX.current);
    };
    const onTouchEnd = () => {
      setSwiping(false);
      if (currentX.current < threshold) {
        setOffset(-80);
      } else {
        setOffset(0);
      }
    };
    const handleDelete = () => {
      setOffset(0);
      removeBarcode(barcode);
    };

    return (
      <div style={{ position: "relative", overflow: "hidden", marginBottom: 6, borderRadius: 8 }}>
        {/* Delete button behind the content */}
        <div style={styles.swipeDeleteBg}>
          <button onClick={handleDelete} style={styles.swipeDeleteBtn}>🗑️ Delete</button>
        </div>
        {/* Draggable content */}
        <div
          style={{
            transform: `translateX(${offset}px)`,
            transition: swiping ? "none" : "transform 0.2s ease-out",
            position: "relative",
            zIndex: 1,
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {children}
        </div>
      </div>
    );
  }

  // No session — show error
  if (!sessionId) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.icon}>📷</div>
          <h2 style={styles.title}>RHoSAM Scanner</h2>
          <p style={styles.text}>
            No session ID provided. Please open the scanner from the POS page by clicking the "📱 Phone Scanner" button.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Screen flash overlay */}
      {flashColor && (
        <div style={{
          ...styles.flashOverlay,
          background: flashColor === "success"
            ? "rgba(22, 163, 74, 0.25)"
            : "rgba(245, 158, 11, 0.3)",
        }} />
      )}

      {/* Undo toast */}
      {undoToast && (
        <div style={styles.undoToast}>
          <span style={styles.undoToastText}>
            🗑️ Removed <strong>{undoToast.productName}</strong> ({undoToast.removedScans.length} scan{undoToast.removedScans.length !== 1 ? "s" : ""})
          </span>
          <button onClick={undoDelete} style={styles.undoToastBtn}>↩ Undo</button>
        </div>
      )}

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.headerTitle}>📷 Scanner</h1>
          <span style={{
            ...styles.statusBadge,
            background: posConnected ? "#16a34a" : status === "scanning" ? "#f59e0b" : "#6b7280",
          }}>
            {posConnected ? "🟢 POS Connected" : status === "scanning" ? "🟡 Waiting" : "⚪ Disconnected"}
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={styles.count}>{batchStats.totalScans} scan{batchStats.totalScans !== 1 ? "s" : ""}</div>
          {batchStats.totalScans > 0 && (
            <div style={{ fontSize: "0.7rem", opacity: 0.85 }}>
              {batchStats.foundCount} found · {batchStats.notFoundCount > 0 ? `${batchStats.notFoundCount} ✕` : "all ✓"}
            </div>
          )}
        </div>
      </div>

      {/* Settings bar */}
      <div style={styles.settingsBar}>
        <div style={styles.volumeControl}>
          <span
            style={styles.volumeIcon}
            onClick={() => setBeepVolume(v => v > 0 ? 0 : 70)}
            title={soundEnabled ? "Mute" : "Unmute"}
          >
            {beepVolume === 0 ? "🔇" : beepVolume < 40 ? "🔈" : beepVolume < 70 ? "🔉" : "🔊"}
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={beepVolume}
            onChange={e => setBeepVolume(Number(e.target.value))}
            style={styles.volumeSlider}
            title={`Volume: ${beepVolume}%`}
          />
          <span style={styles.volumeValue}>{beepVolume}%</span>
        </div>
        <button
          onClick={() => setVibrationEnabled(v => !v)}
          style={{
            ...styles.toggleBtn,
            background: vibrationEnabled ? "#16a34a" : "#e5e7eb",
            color: vibrationEnabled ? "#fff" : "#6b7280",
          }}
        >
          {vibrationEnabled ? "📳" : "📴"} Vibrate
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div style={styles.errorBanner}>
          ⚠️ {error}
          <button onClick={() => setError("")} style={styles.errorClose}>✕</button>
        </div>
      )}

      {/* Camera preview */}
      <div style={styles.scannerArea}>
        <div ref={scannerRef} id="scanner-preview" style={styles.preview} />
        {status === "idle" && (
          <button onClick={startScanner} style={styles.startButton}>
            📷 Start Camera
          </button>
        )}
        {status === "scanning" && (
          <div style={styles.scanOverlay}>
            <div style={styles.scanFrame}>
              <div style={{ ...styles.scanCorner, top: 0, left: 0 }} />
              <div style={{ ...styles.scanCorner, top: 0, right: 0, transform: "rotate(90deg)" }} />
              <div style={{ ...styles.scanCorner, bottom: 0, left: 0, transform: "rotate(-90deg)" }} />
              <div style={{ ...styles.scanCorner, bottom: 0, right: 0, transform: "rotate(180deg)" }} />
            </div>
            <p style={styles.scanHint}>Point camera at barcode</p>
          </div>
        )}
      </div>

      {/* Scan feedback */}
      {status === "sent" && scans.length > 0 && (
        <div style={styles.sentBanner}>
          ✅ Sent! {scans[0].product ? scans[0].product.name : scans[0].barcode}
        </div>
      )}

      {/* Manual barcode entry with autocomplete */}
      <div style={styles.manualEntry}>
        <form onSubmit={handleManualSubmit} style={styles.manualForm}>
          <div style={styles.manualInputWrapper}>
            <input
              ref={manualInputRef}
              type="text"
              inputMode="text"
              placeholder="⌨️ Type barcode or product name…"
              value={manualBarcode}
              onChange={handleManualChange}
              onFocus={() => { if (lookupResults.length > 0 && manualBarcode.trim().length >= 2) setShowSuggestions(true); }}
              onBlur={() => { setTimeout(() => setShowSuggestions(false), 200); }}
              disabled={manualSending}
              className="scanner-manual-input"
              style={styles.manualInput}
              autoComplete="off"
            />
            {/* Autocomplete suggestions */}
            {showSuggestions && lookupResults.length > 0 && (
              <div style={styles.suggestions}>
                {lookupResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="scanner-suggestion-item"
                    style={styles.suggestionItem}
                    onMouseDown={(e) => { e.preventDefault(); selectSuggestion(p); }}
                  >
                    <div style={styles.suggestionLeft}>
                      <strong style={styles.suggestionName}>{p.name}</strong>
                      <span style={styles.suggestionMeta}>
                        <span style={styles.suggestionBarcode}>{p.barcode}</span>
                        {p.category && <span> · {p.category}</span>}
                      </span>
                    </div>
                    <div style={styles.suggestionRight}>
                      <span style={styles.suggestionPrice}>₦{parseFloat(p.price).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
                      <span style={{ ...styles.suggestionStock, color: p.stock <= 0 ? "#dc2626" : p.stock <= (p.reorder_level || 5) ? "#f59e0b" : "#6b7280" }}>
                        {p.stock <= 0 ? "Out" : `${p.stock} in stock`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={styles.manualRight}>
            <div style={styles.qtySelector}>
              <button
                type="button"
                onClick={() => setManualQty(q => Math.max(1, q - 1))}
                style={styles.qtySelectorBtn}
              >−</button>
              <input
                type="number"
                min="1"
                max="99"
                value={manualQty}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1 && v <= 99) setManualQty(v);
                }}
                className="scanner-qty-input"
                style={styles.qtySelectorInput}
              />
              <button
                type="button"
                onClick={() => setManualQty(q => Math.min(99, q + 1))}
                style={styles.qtySelectorBtn}
              >+</button>
            </div>
            <div style={styles.presetRow}>
              {[1, 5, 10, 24].map(qty => (
                <button
                  key={qty}
                  type="button"
                  onClick={() => setManualQty(qty)}
                  style={{
                    ...styles.presetBtn,
                    background: manualQty === qty ? "#16a34a" : "#f3f4f6",
                    color: manualQty === qty ? "#fff" : "#374151",
                  }}
                >{qty}</button>
              ))}
            </div>
            {previewProduct && manualQty > 0 && (
              <div style={styles.pricePreview}>
                <span style={styles.pricePreviewLabel}>Est. total</span>
                <span style={styles.pricePreviewValue}>
                  ₦{estimatedTotal.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}
            <button
              type="submit"
              disabled={manualSending || !manualBarcode.trim()}
              style={{
                ...styles.manualBtn,
                opacity: manualSending || !manualBarcode.trim() ? 0.5 : 1,
              }}
            >
              {manualSending ? "⏳" : "➕"} Add{manualQty > 1 ? ` ×${manualQty}` : ""}
            </button>
          </div>
        </form>
        <p style={styles.manualHint}>Type a barcode number or product name — suggestions appear as you type</p>
        {lastScan && !manualSending && (
          <button
            type="button"
            onClick={() => {
              setManualBarcode(lastScan.barcode);
              setManualQty(lastScan.qty);
              // Auto-submit after a brief delay so state updates
              setTimeout(() => {
                submitBarcode(lastScan.barcode);
                // Send additional qty if > 1
                for (let i = 1; i < lastScan.qty; i++) {
                  fetch(`${API}/scanner/submit`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionId, barcode: lastScan.barcode }),
                  }).catch(() => {});
                }
              }, 50);
            }}
            style={styles.repeatBtn}
            title={`Repeat: ${lastScan.barcode} ×${lastScan.qty}`}
          >
            🔄 Repeat last: <strong>{lastScan.productName || lastScan.barcode}</strong>{lastScan.qty > 1 && <span> ×{lastScan.qty}</span>}
          </button>
        )}
      </div>

      {/* ⭐ Favorites section (pinned items) */}
      {recentBarcodes.some(r => pinnedBarcodes.has(r.barcode)) && (() => {
        const pinned = recentBarcodes
          .filter(r => pinnedBarcodes.has(r.barcode))
          .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed);
        const atLimit = pinned.length >= PIN_LIMIT;
        const nearLimit = pinned.length >= PIN_LIMIT - 2;
        return (
          <div style={styles.favSection}>
            <div style={styles.recentHeader}>
              <span style={styles.favTitle}>⭐ Favorites</span>
              <span style={{
                fontSize: "0.7rem",
                fontWeight: 600,
                color: atLimit ? "#dc2626" : nearLimit ? "#f59e0b" : "#9ca3af",
              }}>{pinned.length}/{PIN_LIMIT}</span>
            </div>
            {atLimit && (
              <div style={styles.pinLimitWarn}>
                ⚠️ Favorites full ({PIN_LIMIT}/{PIN_LIMIT}) — unpin an item to add a new one
              </div>
            )}
            <div style={styles.recentChips}>
              {pinned.map((item) => (
                <div key={item.barcode} style={{ position: "relative" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); togglePin(item.barcode); }}
                    style={{ ...styles.pinBtn, color: "#f59e0b" }}
                    title="Unpin from favorites"
                  >📌</button>
                  <button
                    onClick={() => submitBarcode(item.barcode)}
                    className="scanner-recent-chip"
                    style={{ ...styles.recentChip, borderColor: "#f59e0b", background: "#fffbeb" }}
                    title={`${item.barcode} — scanned ${item.count}× this batch`}>
                    <span style={styles.recentChipName}>
                      {item.product ? item.product.name : item.barcode}
                    </span>
                    <span style={styles.recentChipMeta}>
                      {item.product && <span style={styles.recentChipBarcode}>{item.barcode}</span>}
                      {item.count > 1 && <span style={styles.recentChipCount}>×{item.count}</span>}
                    </span>
                    {(item.totalCount > 1 || item.totalValue > 0) && (
                      <span style={styles.recentChipStats}>
                        {(item.totalCount || item.count) > 1 && <span>📦 {item.totalCount || item.count} total</span>}
                        {item.totalValue > 0 && <span>💰 ₦{item.totalValue.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>}
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 🕐 Recent barcodes quick-tap (unpinned) */}
      {recentBarcodes.length > 0 && (() => {
        const unpinned = recentBarcodes
          .filter(r => !pinnedBarcodes.has(r.barcode))
          .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed);
        if (unpinned.length === 0) return null;
        return (
          <div style={styles.recentSection}>
            <div style={styles.recentHeader}>
              <span style={styles.recentTitle}>🕐 Recent Items</span>
              <button
                onClick={() => {
                  if (confirm("Clear recent items list?")) {
                    setRecentBarcodes([]);
                    setPinnedBarcodes(new Set());
                    try { localStorage.removeItem("scanner-recent"); localStorage.removeItem("scanner-pinned"); } catch {}
                  }
                }}
                style={styles.recentClear}
              >Clear</button>
            </div>
            <div style={styles.recentChips}>
              {unpinned.map((item) => (
                <div key={item.barcode} style={{ position: "relative" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); togglePin(item.barcode); }}
                    style={{ ...styles.pinBtn, color: "#d1d5db" }}
                    title="Pin to favorites"
                  >📌</button>
                  <button
                    onClick={() => submitBarcode(item.barcode)}
                    className="scanner-recent-chip"
                    style={styles.recentChip}
                    title={`${item.barcode} — scanned ${item.count}× this batch`}>
                    <span style={styles.recentChipName}>
                      {item.product ? item.product.name : item.barcode}
                    </span>
                    <span style={styles.recentChipMeta}>
                      {item.product && <span style={styles.recentChipBarcode}>{item.barcode}</span>}
                      {item.count > 1 && <span style={styles.recentChipCount}>×{item.count}</span>}
                    </span>
                    {(item.totalCount > 1 || item.totalValue > 0) && (
                      <span style={styles.recentChipStats}>
                        {(item.totalCount || item.count) > 1 && <span>📦 {item.totalCount || item.count} total</span>}
                        {item.totalValue > 0 && <span>💰 ₦{item.totalValue.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>}
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </div>
            {/* Cumulative totals */}
            {(() => {
              const totalQty = unpinned.reduce((s, r) => s + (r.totalCount || r.count), 0);
              const totalVal = unpinned.reduce((s, r) => s + (r.totalValue || 0), 0);
              if (totalQty <= 1 && totalVal <= 0) return null;
              return (
                <div style={styles.recentTotals}>
                  <span>📊 All-time: <strong>{totalQty}</strong> scans</span>
                  {totalVal > 0 && <span>· 💰 <strong>₦{totalVal.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Batch Summary */}
      {batchStats.totalScans > 0 && (
        <div style={styles.batchSummary}>
          <div style={styles.batchHeader}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={styles.batchTitle}>📊 Batch Summary</h3>
              {batchStartTime && (
                <span style={styles.timer}>⏱️ {timerDisplay}</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={styles.filterGroup}>
                {[
                  { key: "all", label: "All" },
                  { key: "found", label: "✓ Found" },
                  { key: "not-found", label: "✕ Missing" },
                ].map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setExportFilter(opt.key)}
                    style={{
                      ...styles.filterBtn,
                      background: exportFilter === opt.key ? "#16a34a" : "transparent",
                      color: exportFilter === opt.key ? "#fff" : "#6b7280",
                    }}
                  >{opt.label}</button>
                ))}
              </div>
              <button onClick={() => setShowCsvPreview(true)} style={styles.exportBtn} title="Preview and export CSV">📥 CSV</button>
              {'share' in navigator && (
                <>
                  <button onClick={shareCsv} style={styles.shareBtn} title="Share CSV file via apps">📤 CSV</button>
                  <button onClick={sharePlainText} style={styles.shareTextBtn} title="Share barcode list as plain text">💬 Text</button>
                </>
              )}
              <button onClick={generateQr} style={styles.qrBtn} title="Generate QR code for scan data">📱 QR</button>
              <button onClick={printBatch} style={styles.printBtn} title="Print scan summary">🖨️ Print</button>
              <button onClick={resetBatch} style={styles.resetBtn} title="Clear scan history">🗑️ Reset</button>
            </div>
          </div>
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <span style={styles.statValue}>{batchStats.totalScans}</span>
              <span style={styles.statLabel}>Total Scans</span>
            </div>
            <div style={styles.statCard}>
              <span style={{ ...styles.statValue, color: "#16a34a" }}>{batchStats.foundCount}</span>
              <span style={styles.statLabel}>Products Found</span>
            </div>
            <div style={styles.statCard}>
              <span style={{ ...styles.statValue, color: batchStats.notFoundCount > 0 ? "#f59e0b" : undefined }}>{batchStats.notFoundCount}</span>
              <span style={styles.statLabel}>Not in POS</span>
            </div>
            <div style={styles.statCard}>
              <span style={styles.statValue}>{batchStats.uniqueBarcodes}</span>
              <span style={styles.statLabel}>Unique Items</span>
            </div>
          </div>
          <div style={styles.batchDetails}>
            <div style={styles.detailRow}>
              <span>💰 Total Value</span>
              <strong>₦{batchStats.totalValue.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
            <div style={styles.detailRow}>
              <span>📈 Avg. Price</span>
              <strong>₦{batchStats.avgPrice.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
            <div style={styles.detailRow}>
              <span>⏱️ Scan Rate</span>
              <strong>{batchStats.scanRate === "—" ? "—" : `${batchStats.scanRate}/min`}</strong>
            </div>
          </div>
          {batchStats.notFoundCount > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: "0.8rem", color: "#f59e0b", fontWeight: 600, cursor: "pointer" }}>
                ⚠️ {batchStats.notFoundCount} barcode(s) not found in POS ({Object.keys(batchStats.notFoundNames).length} unique)
              </summary>
              <div style={{ marginTop: 6, padding: "6px 0" }}>
                {Object.entries(batchStats.notFoundNames).map(([code, count]) => (
                  <div key={code} style={{ fontSize: "0.78rem", color: "#92400e", fontFamily: "monospace", padding: "2px 0" }}>
                    {code}{count > 1 ? ` (×${count})` : ""}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Scan history — grouped by barcode */}
      <div style={styles.historySection}>
        <div style={styles.historyHeader}>
          <h3 style={styles.historyTitle}>Scanned Items</h3>
          {scans.length > 0 && (
            <div style={styles.sortToggle}>
              <button
                onClick={() => setHistorySort("time")}
                style={{ ...styles.sortBtn, background: historySort === "time" ? "#16a34a" : "transparent", color: historySort === "time" ? "#fff" : "#6b7280" }}
              >🕐 Time</button>
              <button
                onClick={() => setHistorySort("qty")}
                style={{ ...styles.sortBtn, background: historySort === "qty" ? "#16a34a" : "transparent", color: historySort === "qty" ? "#fff" : "#6b7280" }}
              >📊 Qty</button>
            </div>
          )}
        </div>
        {/* Multi-select action bar */}
        {multiSelectMode && (
          <div style={styles.multiSelectBar}>
            <div style={styles.multiSelectLeft}>
              <button onClick={exitMultiSelect} style={styles.multiSelectExitBtn}>✕</button>
              <span style={styles.multiSelectCount}>{selectedBarcodes.size} selected</span>
            </div>
            <div style={styles.multiSelectRight}>
              <button onClick={selectedBarcodes.size === scans.length ? deselectAll : selectAll} style={styles.multiSelectActionBtn}>
                {selectedBarcodes.size === scans.length ? "Deselect all" : "Select all"}
              </button>
              <button
                onClick={() => setShowBatchEditor(!showBatchEditor)}
                disabled={selectedBarcodes.size === 0}
                style={{ ...styles.multiSelectEditBtn, opacity: selectedBarcodes.size === 0 ? 0.4 : 1 }}
              >✏️ Edit Qty</button>
              <button
                onClick={batchDelete}
                disabled={selectedBarcodes.size === 0}
                style={{ ...styles.multiSelectDeleteBtn, opacity: selectedBarcodes.size === 0 ? 0.4 : 1 }}
              >🗑️ Delete</button>
            </div>
          </div>
        )}
        {/* Batch quantity editor */}
        {multiSelectMode && showBatchEditor && (
          <div style={styles.batchEditorBar}>
            <span style={{ fontSize: "0.8rem", color: "#374151", fontWeight: 600 }}>Set qty for {selectedBarcodes.size} item{selectedBarcodes.size !== 1 ? "s" : ""}:</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={styles.qtySelector}>
                <button type="button" onClick={() => setBatchEditQty(q => Math.max(1, q - 1))} style={styles.qtySelectorBtn}>−</button>
                <input
                  type="number" min="1" max="99" value={batchEditQty}
                  onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1 && v <= 99) setBatchEditQty(v); }}
                  className="scanner-qty-input" style={styles.qtySelectorInput}
                />
                <button type="button" onClick={() => setBatchEditQty(q => Math.min(99, q + 1))} style={styles.qtySelectorBtn}>+</button>
              </div>
              <div style={styles.presetRow}>
                {[1, 5, 10, 24].map(qty => (
                  <button key={qty} type="button" onClick={() => setBatchEditQty(qty)}
                    style={{ ...styles.presetBtn, background: batchEditQty === qty ? "#16a34a" : "#f3f4f6", color: batchEditQty === qty ? "#fff" : "#374151" }}
                  >{qty}</button>
                ))}
              </div>
              <button onClick={applyBatchEdit} style={styles.batchApplyBtn}>✓ Apply</button>
            </div>
          </div>
        )}
        {scans.length === 0 && (
          <p style={styles.emptyText}>No barcodes scanned yet. Start the camera above.</p>
        )}
        {(() => {
          // Group scans by barcode, preserving scan order
          const grouped = [];
          const seen = new Set();
          for (let i = scans.length - 1; i >= 0; i--) {
            const scan = scans[i];
            if (seen.has(scan.barcode)) continue;
            seen.add(scan.barcode);
            const qty = scans.filter(s => s.barcode === scan.barcode).length;
            grouped.push({ ...scan, quantity: qty });
          }
          // Sort based on toggle
          if (historySort === "qty") {
            grouped.sort((a, b) => b.quantity - a.quantity || b.timestamp - a.timestamp);
          } else {
            grouped.sort((a, b) => b.timestamp - a.timestamp);
          }
          return grouped.map((item) => (
            <SwipeableRow key={item.barcode} barcode={item.barcode}>
              <div
                style={{
                  ...styles.groupedItem,
                  borderLeft: multiSelectMode
                    ? (selectedBarcodes.has(item.barcode) ? "3px solid #16a34a" : "3px solid #e5e7eb")
                    : (item.product ? "3px solid #16a34a" : "3px solid #f59e0b"),
                  background: multiSelectMode && selectedBarcodes.has(item.barcode) ? "#f0fdf4" : undefined,
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  touchAction: "pan-y",
                  transform: removingBarcodes.has(item.barcode) ? "translateX(-100%)" : undefined,
                  opacity: removingBarcodes.has(item.barcode) ? 0 : 1,
                  maxHeight: removingBarcodes.has(item.barcode) ? 0 : undefined,
                  overflow: "hidden",
                  marginBottom: removingBarcodes.has(item.barcode) ? 0 : 6,
                  padding: removingBarcodes.has(item.barcode) ? "0 14px" : undefined,
                  transition: "transform 0.3s ease-in, opacity 0.3s ease-in, max-height 0.3s ease-in, margin 0.3s ease-in, padding 0.3s ease-in",
                }}
                onTouchStart={() => multiSelectMode ? toggleSelect(item.barcode) : handleItemTouchStart(item.barcode)}
                onTouchEnd={handleItemTouchEnd}
                onTouchCancel={handleItemTouchEnd}
                onMouseDown={() => multiSelectMode ? toggleSelect(item.barcode) : handleItemTouchStart(item.barcode)}
                onMouseUp={handleItemTouchEnd}
                onMouseLeave={handleItemTouchEnd}
              >
                <div style={styles.groupedItemLeft}>
                  <div style={styles.groupedItemTop}>
                    {multiSelectMode && (
                      <span style={{
                        ...styles.selectCheck,
                        background: selectedBarcodes.has(item.barcode) ? "#16a34a" : "#e5e7eb",
                        color: selectedBarcodes.has(item.barcode) ? "#fff" : "transparent",
                      }}>✓</span>
                    )}
                    <strong style={styles.scanBarcode}>{item.barcode}</strong>
                    {item.quantity > 1 && editingBarcode !== item.barcode && (
                      <span style={styles.qtyBadge}>×{item.quantity}</span>
                    )}
                  </div>
                  <span style={styles.scanProduct}>
                    {item.product ? item.product.name : "⚠️ Not found in POS"}
                  </span>
                  {editingBarcode === item.barcode ? (
                    /* Inline quantity editor */
                    <div style={styles.editRow}>
                      <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Qty:</span>
                      <input
                        ref={editInputRef}
                        type="number"
                        min="1"
                        max="99"
                        value={editQty}
                        onChange={e => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v >= 1 && v <= 99) setEditQty(v);
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter") applyEditQty();
                          if (e.key === "Escape") setEditingBarcode(null);
                        }}
                        className="scanner-qty-input"
                        style={styles.editInput}
                      />
                      <button onClick={applyEditQty} style={styles.editConfirmBtn}>✓</button>
                      <button onClick={() => setEditingBarcode(null)} style={styles.editCancelBtn}>✕</button>
                    </div>
                  ) : (
                    <span style={styles.scanPrice}>
                      {item.product ? (
                        <>₦{parseFloat(item.product.price).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                        {" · "}Subtotal: ₦{(parseFloat(item.product.price) * item.quantity).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</>
                      ) : (
                        <span style={{ color: "#f59e0b" }}>Add this product to POS first</span>
                      )}
                    </span>
                  )}
                </div>
                <div style={styles.groupedItemRight}>
                  {editingBarcode !== item.barcode && (
                    <div style={styles.qtyControls}>
                      <button
                        onClick={() => {
                          setScans(prev => {
                            const idx = prev.findLastIndex(s => s.barcode === item.barcode);
                            return idx >= 0 ? prev.filter((_, i) => i !== idx) : prev;
                          });
                        }}
                        style={styles.qtyBtn}
                        title="Remove one scan"
                      >−</button>
                      <span style={styles.qtyValue}>{item.quantity}</span>
                      <button
                        onClick={() => submitBarcode(item.barcode)}
                        style={styles.qtyBtn}
                        title="Scan again"
                      >+</button>
                    </div>
                  )}
                  <div style={styles.historyItemMeta}>
                    {/* Pin/unpin from scan history */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePin(item.barcode);
                        // Also add to recent barcodes if not already there
                        setRecentBarcodes(prev => {
                          if (prev.find(r => r.barcode === item.barcode)) return prev;
                          const price = parseFloat(item.product?.price) || 0;
                          const updated = [{
                            barcode: item.barcode,
                            product: item.product,
                            count: item.quantity,
                            totalCount: item.quantity,
                            totalValue: price * item.quantity,
                            lastUsed: Date.now(),
                          }, ...prev].slice(0, 12);
                          try { localStorage.setItem("scanner-recent", JSON.stringify(updated)); } catch {}
                          return updated;
                        });
                      }}
                      style={{
                        ...styles.historyPinBtn,
                        color: pinnedBarcodes.has(item.barcode) ? "#f59e0b" : "#d1d5db",
                      }}
                      title={pinnedBarcodes.has(item.barcode) ? "Unpin from favorites" : (pinnedBarcodes.size >= PIN_LIMIT ? `Favorites full (${PIN_LIMIT}/${PIN_LIMIT})` : "Pin to favorites")}
                    >📌</button>
                    <span style={styles.scanTime}>
                      {new Date(item.timestamp).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>
                </div>
              </div>
            </SwipeableRow>
          ));
        })()}
      </div>

      {/* Instructions */}
      <div style={styles.instructions}>
        <h4>💡 How to use</h4>
        <ol>
          <li><strong>Camera scan:</strong> Point your camera at a product barcode</li>
          <li><strong>Manual entry:</strong> Type the barcode number for damaged items</li>
          <li>The barcode is sent to the POS automatically</li>
          <li>The product will appear in the POS cart</li>
        </ol>
      </div>

      {/* CSV Preview Modal */}
      {showCsvPreview && (
        <div style={styles.modalOverlay} onClick={() => setShowCsvPreview(false)}>
          <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>📥 CSV Preview</h3>
              <button onClick={() => setShowCsvPreview(false)} style={styles.modalClose}>✕</button>
            </div>
            <div style={styles.modalFilter}>
              <div style={styles.filterGroup}>
                {[
                  { key: "all", label: "All" },
                  { key: "found", label: "✓ Found" },
                  { key: "not-found", label: "✕ Missing" },
                ].map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setExportFilter(opt.key)}
                    style={{
                      ...styles.filterBtn,
                      background: exportFilter === opt.key ? "#16a34a" : "transparent",
                      color: exportFilter === opt.key ? "#fff" : "#6b7280",
                    }}
                  >{opt.label}</button>
                ))}
              </div>
              <div style={styles.previewSearchWrap}>
                <input
                  type="text"
                  placeholder="🔍 Search…"
                  value={previewSearch}
                  onChange={e => setPreviewSearch(e.target.value)}
                  style={styles.previewSearchInput}
                />
                {previewSearch && (
                  <button onClick={() => setPreviewSearch("")} style={styles.previewSearchClear}>✕</button>
                )}
              </div>
            </div>
            {/* Tab toggle */}
            <div style={styles.previewTabs}>
              <button
                onClick={() => setPreviewTab("table")}
                style={{ ...styles.previewTab, background: previewTab === "table" ? "#16a34a" : "transparent", color: previewTab === "table" ? "#fff" : "#6b7280" }}
              >📊 Table</button>
              <button
                onClick={() => setPreviewTab("csv")}
                style={{ ...styles.previewTab, background: previewTab === "csv" ? "#16a34a" : "transparent", color: previewTab === "csv" ? "#fff" : "#6b7280" }}
              >📝 CSV</button>
            </div>
            {previewTab === "table" ? (
            <div style={styles.modalTableWrap}>
              {filteredPreviewRows.length === 0 ? (
                <p style={{ textAlign: "center", color: "#9ca3af", padding: 20, fontSize: "0.85rem" }}>
                  {previewSearch ? `No items match "${previewSearch}"` : "No items match this filter."}
                </p>
              ) : (
                <table style={styles.modalTable}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, cursor: "pointer" }} onClick={() => togglePreviewSort("barcode")}>Barcode{sortIndicator("barcode")}</th>
                      <th style={{ ...styles.th, cursor: "pointer" }} onClick={() => togglePreviewSort("name")}>Product{sortIndicator("name")}</th>
                      <th style={{ ...styles.th, textAlign: "right", cursor: "pointer" }} onClick={() => togglePreviewSort("price")}>Price{sortIndicator("price")}</th>
                      <th style={{ ...styles.th, textAlign: "center", cursor: "pointer" }} onClick={() => togglePreviewSort("qty")}>Qty{sortIndicator("qty")}</th>
                      <th style={{ ...styles.th, textAlign: "right", cursor: "pointer" }} onClick={() => togglePreviewSort("total")}>Total{sortIndicator("total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreviewRows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={styles.tdMono}>{row.barcode}</td>
                        <td style={styles.td}>
                          <span style={{ color: row.found ? "#111827" : "#f59e0b" }}>
                            {row.name || "Not found"}
                          </span>
                          {row.category && <span style={{ display: "block", fontSize: "0.68rem", color: "#9ca3af" }}>{row.category}</span>}
                        </td>
                        <td style={{ ...styles.td, textAlign: "right" }}>₦{row.unitPrice.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                        <td style={{ ...styles.td, textAlign: "center", fontWeight: 700 }}>{row.quantity}</td>
                        <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>₦{row.lineTotal.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid #e5e7eb" }}>
                      <td colSpan={4} style={{ ...styles.td, fontWeight: 700, fontSize: "0.85rem" }}>
                        {previewSearch ? (
                          <>Filtered: {filteredPreviewRows.length} of {csvPreviewRows.length} items</>
                        ) : (
                          <>Total ({csvPreviewRows.length} items)</>
                        )}
                      </td>
                      <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, fontSize: "0.9rem", color: "#16a34a" }}>
                        ₦{(previewSearch ? filteredPreviewRows.reduce((s, r) => s + r.lineTotal, 0) : csvPreviewTotal).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
            ) : (
            /* CSV raw text view */
            <div style={styles.modalTableWrap}>
              <div style={{ padding: "8px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{rawCsvText.split("\n").length} lines · {rawCsvText.length} chars</span>
                  <button onClick={copyCsvText} style={{ ...styles.exportBtn, fontSize: "0.72rem", padding: "4px 10px" }}>
                    {csvCopied ? "✓ Copied!" : "📋 Copy"}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={rawCsvText}
                  style={styles.rawCsvTextarea}
                  onClick={e => e.target.select()}
                />
              </div>
            </div>
            )}
            <div style={styles.modalFooter}>
              <button onClick={() => setShowCsvPreview(false)} style={styles.modalCancelBtn}>Cancel</button>
              <div style={{ display: "flex", gap: 8 }}>
                {'share' in navigator && (
                  <button onClick={shareCsv} style={styles.shareBtn}>📤 Share</button>
                )}
                <button onClick={exportCsv} style={styles.exportBtn}>📥 Download CSV</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQrModal && qrDataUrl && (
        <div style={styles.modalOverlay} onClick={() => setShowQrModal(false)}>
          <div style={{ ...styles.modalCard, maxWidth: 340, textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>📱 Scan QR Code</h3>
              <button onClick={() => setShowQrModal(false)} style={styles.modalClose}>✕</button>
            </div>
            <div style={{ padding: 20 }}>
              <img src={qrDataUrl} alt="Scan data QR code" style={{ width: 220, height: 220, borderRadius: 8, border: "1px solid #e5e7eb" }} />
              <p style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: 12 }}>
                Scan with another device to import {scans.length} scans ({(() => {
                  const seen = new Set();
                  scans.forEach(s => seen.add(s.barcode));
                  return seen.size;
                })()} items)
              </p>
              <p style={{ fontSize: "0.68rem", color: "#9ca3af", marginTop: 4, fontFamily: "monospace", wordBreak: "break-all" }}>
                {(() => {
                  const grouped = {};
                  const order = [];
                  for (const s of scans) {
                    if (!grouped[s.barcode]) { grouped[s.barcode] = { barcode: s.barcode, qty: 0 }; order.push(s.barcode); }
                    grouped[s.barcode].qty++;
                  }
                  return `RHOSAM:${order.map(k => `${grouped[k].barcode}:${grouped[k].qty}`).join(",")}`;
                })()}
              </p>
            </div>
            <div style={{ ...styles.modalFooter, justifyContent: "center" }}>
              <button onClick={() => setShowQrModal(false)} style={styles.modalCancelBtn}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    maxWidth: 500,
    margin: "0 auto",
    padding: 0,
    position: "relative",
  },
  flashOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: "none",
    zIndex: 9999,
    animation: "scannerFlash 0.35s ease-out forwards",
  },
  undoToast: {
    position: "fixed",
    bottom: 20,
    left: 16,
    right: 16,
    maxWidth: 468,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    background: "#1f2937",
    color: "#fff",
    borderRadius: 10,
    boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
    zIndex: 10000,
    animation: "undoToastIn 0.2s ease-out",
  },
  undoToastText: {
    fontSize: "0.82rem",
    flex: 1,
    minWidth: 0,
  },
  undoToastBtn: {
    background: "none",
    border: "1.5px solid rgba(255,255,255,0.3)",
    borderRadius: 6,
    padding: "4px 12px",
    fontSize: "0.78rem",
    fontWeight: 700,
    color: "#fff",
    cursor: "pointer",
    flexShrink: 0,
    marginLeft: 10,
    transition: "background 0.12s",
  },
  header: {
    background: "linear-gradient(135deg, #16a34a, #15803d)",
    color: "#fff",
    padding: "16px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 700,
  },
  statusBadge: {
    fontSize: "0.7rem",
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: 10,
    color: "#fff",
  },
  count: {
    fontSize: "0.85rem",
    fontWeight: 600,
    opacity: 0.9,
  },
  settingsBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 16px",
    background: "#fff",
    borderBottom: "1px solid #e5e7eb",
  },
  volumeControl: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  volumeIcon: {
    fontSize: "1rem",
    cursor: "pointer",
    flexShrink: 0,
    userSelect: "none",
  },
  volumeSlider: {
    flex: 1,
    height: 6,
    appearance: "auto",
    accentColor: "#16a34a",
    cursor: "pointer",
    minWidth: 0,
  },
  volumeValue: {
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "#374151",
    minWidth: 30,
    textAlign: "right",
    fontFamily: "monospace",
  },
  toggleBtn: {
    border: "none",
    borderRadius: 8,
    padding: "5px 10px",
    fontSize: "0.75rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
    display: "flex",
    alignItems: "center",
    gap: 3,
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: 40,
    margin: 40,
    textAlign: "center",
    boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
  },
  icon: {
    fontSize: "3rem",
    marginBottom: 16,
  },
  title: {
    fontSize: "1.3rem",
    margin: "0 0 8px",
    color: "#111827",
  },
  text: {
    color: "#6b7280",
    fontSize: "0.95rem",
    lineHeight: 1.5,
  },
  scannerArea: {
    position: "relative",
    margin: "12px 16px",
    borderRadius: 12,
    overflow: "hidden",
    background: "#000",
    minHeight: 200,
  },
  preview: {
    width: "100%",
    minHeight: 200,
  },
  startButton: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "14px 28px",
    fontSize: "1rem",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(22,163,74,0.4)",
    zIndex: 10,
  },
  scanOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  scanFrame: {
    width: 280,
    height: 120,
    position: "relative",
    border: "2px solid rgba(255,255,255,0.3)",
    borderRadius: 8,
  },
  scanCorner: {
    position: "absolute",
    width: 20,
    height: 20,
    borderLeft: "3px solid #16a34a",
    borderTop: "3px solid #16a34a",
  },
  scanHint: {
    color: "#fff",
    fontSize: "0.85rem",
    marginTop: 12,
    textShadow: "0 1px 4px rgba(0,0,0,0.6)",
  },
  sentBanner: {
    margin: "8px 16px",
    padding: "10px 16px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 10,
    fontWeight: 600,
    color: "#15803d",
    fontSize: "0.9rem",
    textAlign: "center",
    animation: "fadeIn 0.2s",
  },
  errorBanner: {
    margin: "8px 16px",
    padding: "10px 16px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 10,
    fontWeight: 600,
    color: "#dc2626",
    fontSize: "0.85rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  errorClose: {
    background: "none",
    border: "none",
    color: "#dc2626",
    fontSize: "1rem",
    cursor: "pointer",
  },
  historySection: {
    padding: "12px 16px",
  },
  historyHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  historyTitle: {
    margin: 0,
    fontSize: "0.95rem",
    color: "#374151",
  },
  sortToggle: {
    display: "flex",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    overflow: "hidden",
  },
  sortBtn: {
    border: "none",
    padding: "3px 8px",
    fontSize: "0.7rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.12s",
  },
  emptyText: {
    color: "#9ca3af",
    fontSize: "0.85rem",
    textAlign: "center",
    padding: 20,
  },
  scanItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    background: "#fff",
    borderRadius: 8,
    marginBottom: 6,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },
  groupedItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    background: "#fff",
    borderRadius: 8,
    marginBottom: 6,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },
  groupedItemLeft: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  groupedItemTop: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  groupedItemRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
    flexShrink: 0,
    marginLeft: 8,
  },
  qtyBadge: {
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "#fff",
    background: "#16a34a",
    padding: "1px 7px",
    borderRadius: 10,
    lineHeight: "16px",
  },
  qtyControls: {
    display: "flex",
    alignItems: "center",
    gap: 0,
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    overflow: "hidden",
  },
  qtyBtn: {
    width: 28,
    height: 28,
    border: "none",
    background: "#f9fafb",
    color: "#374151",
    fontSize: "1rem",
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.1s",
  },
  qtyValue: {
    width: 30,
    textAlign: "center",
    fontSize: "0.85rem",
    fontWeight: 700,
    color: "#111827",
    borderLeft: "1px solid #e5e7eb",
    borderRight: "1px solid #e5e7eb",
    lineHeight: "28px",
  },
  scanItemLeft: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  scanBarcode: {
    fontFamily: "monospace",
    fontSize: "0.9rem",
    color: "#111827",
  },
  scanProduct: {
    fontSize: "0.8rem",
    color: "#374151",
  },
  scanPrice: {
    fontSize: "0.75rem",
    color: "#6b7280",
  },
  scanItemRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
  },
  historyItemMeta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  historyPinBtn: {
    background: "none",
    border: "none",
    fontSize: "0.75rem",
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
    transition: "color 0.15s",
  },
  scanTime: {
    fontSize: "0.7rem",
    color: "#9ca3af",
  },
  instructions: {
    margin: "8px 16px 24px",
    padding: 16,
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },
  batchSummary: {
    margin: "12px 16px",
    padding: 16,
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    border: "1px solid #e5e7eb",
  },
  batchHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  batchTitle: {
    margin: 0,
    fontSize: "0.95rem",
    color: "#374151",
  },
  timer: {
    fontSize: "0.82rem",
    fontWeight: 700,
    color: "#16a34a",
    background: "#f0fdf4",
    padding: "2px 8px",
    borderRadius: 6,
    fontFamily: "monospace",
    letterSpacing: "0.05em",
  },
  resetBtn: {
    background: "none",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: "0.78rem",
    color: "#6b7280",
    cursor: "pointer",
    fontWeight: 600,
  },
  exportBtn: {
    background: "#16a34a",
    border: "none",
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: "0.78rem",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
  shareBtn: {
    background: "#0ea5e9",
    border: "none",
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: "0.78rem",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
  shareTextBtn: {
    background: "#8b5cf6",
    border: "none",
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: "0.78rem",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
  qrBtn: {
    background: "#ec4899",
    border: "none",
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: "0.78rem",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
  printBtn: {
    background: "#6b7280",
    border: "none",
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: "0.78rem",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
  filterGroup: {
    display: "flex",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    overflow: "hidden",
  },
  filterBtn: {
    border: "none",
    padding: "4px 8px",
    fontSize: "0.68rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.12s",
    whiteSpace: "nowrap",
    borderRight: "1px solid #e5e7eb",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "8px 4px",
    background: "#f9fafb",
    borderRadius: 8,
  },
  statValue: {
    fontSize: "1.2rem",
    fontWeight: 800,
    color: "#111827",
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: "0.65rem",
    color: "#9ca3af",
    fontWeight: 500,
    marginTop: 2,
    textAlign: "center",
  },
  batchDetails: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 12px",
    background: "#f9fafb",
    borderRadius: 8,
  },
  detailRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "0.82rem",
    color: "#374151",
  },
  manualEntry: {
    margin: "0 16px 12px",
    padding: 14,
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    border: "1px solid #e5e7eb",
  },
  manualForm: {
    display: "flex",
    gap: 8,
  },
  manualInput: {
    flex: 1,
    padding: "12px 14px",
    fontSize: "1.1rem",
    fontFamily: "monospace",
    letterSpacing: "0.05em",
    border: "2px solid #e5e7eb",
    borderRadius: 10,
    outline: "none",
    background: "#f9fafb",
    color: "#111827",
    transition: "border-color 0.15s",
  },
  manualRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  qtySelector: {
    display: "flex",
    alignItems: "center",
    border: "1.5px solid #e5e7eb",
    borderRadius: 8,
    overflow: "hidden",
    background: "#fff",
  },
  qtySelectorBtn: {
    width: 28,
    height: 32,
    border: "none",
    background: "#f9fafb",
    color: "#374151",
    fontSize: "1rem",
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.1s",
  },
  presetRow: {
    display: "flex",
    gap: 4,
  },
  presetBtn: {
    width: 30,
    height: 24,
    border: "none",
    borderRadius: 6,
    fontSize: "0.7rem",
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.12s",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  pricePreview: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 8px",
    background: "#f0fdf4",
    borderRadius: 6,
    border: "1px solid #bbf7d0",
    gap: 6,
  },
  pricePreviewLabel: {
    fontSize: "0.68rem",
    color: "#6b7280",
    fontWeight: 500,
  },
  pricePreviewValue: {
    fontSize: "0.82rem",
    fontWeight: 700,
    color: "#16a34a",
    fontFamily: "monospace",
  },
  qtySelectorInput: {
    width: 36,
    height: 32,
    border: "none",
    borderLeft: "1px solid #e5e7eb",
    borderRight: "1px solid #e5e7eb",
    textAlign: "center",
    fontSize: "0.85rem",
    fontWeight: 700,
    color: "#111827",
    background: "#fff",
    outline: "none",
    padding: 0,
    fontFamily: "monospace",
    MozAppearance: "textfield",
  },
  manualBtn: {
    padding: "10px 18px",
    fontSize: "0.9rem",
    fontWeight: 700,
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "opacity 0.15s",
  },
  manualHint: {
    margin: "6px 0 0",
    fontSize: "0.72rem",
    color: "#9ca3af",
    textAlign: "center",
  },
  repeatBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    width: "100%",
    marginTop: 8,
    padding: "8px 12px",
    background: "#eff6ff",
    border: "1.5px solid #bfdbfe",
    borderRadius: 8,
    fontSize: "0.78rem",
    color: "#1d4ed8",
    cursor: "pointer",
    fontWeight: 500,
    transition: "all 0.12s",
  },
  manualInputWrapper: {
    flex: 1,
    position: "relative",
    minWidth: 0,
  },
  suggestions: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    zIndex: 50,
    maxHeight: 260,
    overflowY: "auto",
    marginTop: 4,
  },
  suggestionItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "10px 12px",
    background: "none",
    border: "none",
    borderBottom: "1px solid #f3f4f6",
    cursor: "pointer",
    textAlign: "left",
    transition: "background 0.1s",
  },
  suggestionLeft: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  suggestionName: {
    fontSize: "0.85rem",
    color: "#111827",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  suggestionMeta: {
    fontSize: "0.72rem",
    color: "#9ca3af",
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  suggestionBarcode: {
    fontFamily: "monospace",
    background: "#f3f4f6",
    padding: "0 4px",
    borderRadius: 3,
  },
  suggestionRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
    flexShrink: 0,
    marginLeft: 8,
  },
  suggestionPrice: {
    fontSize: "0.85rem",
    fontWeight: 700,
    color: "#111827",
  },
  suggestionStock: {
    fontSize: "0.68rem",
    fontWeight: 500,
  },
  favSection: {
    margin: "0 16px 8px",
    padding: "10px 14px",
    background: "#fffbeb",
    borderRadius: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    border: "1.5px solid #fde68a",
  },
  favTitle: {
    fontSize: "0.82rem",
    fontWeight: 700,
    color: "#92400e",
  },
  pinLimitWarn: {
    padding: "6px 10px",
    marginBottom: 8,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 6,
    fontSize: "0.72rem",
    color: "#991b1b",
    fontWeight: 500,
  },
  recentSection: {
    margin: "0 16px 12px",
    padding: "10px 14px",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    border: "1px solid #e5e7eb",
  },
  recentHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  recentTitle: {
    fontSize: "0.82rem",
    fontWeight: 600,
    color: "#374151",
  },
  recentClear: {
    background: "none",
    border: "none",
    fontSize: "0.72rem",
    color: "#9ca3af",
    cursor: "pointer",
    fontWeight: 500,
    padding: 0,
  },
  recentChips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  recentChip: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 1,
    padding: "6px 10px",
    background: "#f9fafb",
    border: "1.5px solid #e5e7eb",
    borderRadius: 8,
    cursor: "pointer",
    transition: "all 0.12s",
    maxWidth: 160,
    textAlign: "left",
  },
  recentChipName: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#111827",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
  recentChipMeta: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  recentChipBarcode: {
    fontSize: "0.65rem",
    fontFamily: "monospace",
    color: "#9ca3af",
  },
  recentChipCount: {
    fontSize: "0.65rem",
    fontWeight: 700,
    color: "#16a34a",
    background: "#f0fdf4",
    padding: "0 4px",
    borderRadius: 4,
  },
  pinBtn: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    border: "none",
    background: "none",
    fontSize: "0.7rem",
    cursor: "pointer",
    padding: 0,
    zIndex: 2,
    lineHeight: 1,
    transition: "color 0.15s",
  },
  recentChipStats: {
    display: "flex",
    gap: 6,
    fontSize: "0.62rem",
    color: "#9ca3af",
    fontWeight: 500,
  },
  recentTotals: {
    marginTop: 8,
    padding: "6px 10px",
    background: "#f9fafb",
    borderRadius: 6,
    fontSize: "0.75rem",
    color: "#6b7280",
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  // Multi-select bar
  multiSelectBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    marginBottom: 8,
    background: "#eff6ff",
    border: "1.5px solid #bfdbfe",
    borderRadius: 10,
  },
  multiSelectLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  multiSelectExitBtn: {
    width: 26,
    height: 26,
    border: "none",
    borderRadius: 6,
    background: "#e5e7eb",
    color: "#374151",
    fontSize: "0.8rem",
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  multiSelectCount: {
    fontSize: "0.82rem",
    fontWeight: 600,
    color: "#1d4ed8",
  },
  multiSelectRight: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  multiSelectActionBtn: {
    border: "none",
    padding: "5px 10px",
    fontSize: "0.72rem",
    fontWeight: 600,
    color: "#6b7280",
    background: "transparent",
    cursor: "pointer",
    borderRadius: 6,
  },
  multiSelectEditBtn: {
    border: "none",
    padding: "5px 12px",
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "#fff",
    background: "#f59e0b",
    cursor: "pointer",
    borderRadius: 8,
  },
  multiSelectDeleteBtn: {
    border: "none",
    padding: "5px 12px",
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "#fff",
    background: "#dc2626",
    cursor: "pointer",
    borderRadius: 8,
  },
  batchEditorBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    marginBottom: 8,
    background: "#fffbeb",
    border: "1.5px solid #fde68a",
    borderRadius: 10,
    gap: 10,
    flexWrap: "wrap",
  },
  batchApplyBtn: {
    border: "none",
    padding: "6px 14px",
    fontSize: "0.8rem",
    fontWeight: 700,
    color: "#fff",
    background: "#16a34a",
    cursor: "pointer",
    borderRadius: 8,
    flexShrink: 0,
  },
  selectCheck: {
    width: 18,
    height: 18,
    borderRadius: 4,
    border: "1.5px solid #d1d5db",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.7rem",
    fontWeight: 700,
    flexShrink: 0,
    transition: "all 0.12s",
  },
  // Inline quantity editor
  editRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  editInput: {
    width: 50,
    height: 30,
    border: "2px solid #16a34a",
    borderRadius: 6,
    textAlign: "center",
    fontSize: "0.9rem",
    fontWeight: 700,
    color: "#111827",
    background: "#f0fdf4",
    outline: "none",
    padding: 0,
    fontFamily: "monospace",
  },
  editConfirmBtn: {
    width: 30,
    height: 30,
    border: "none",
    borderRadius: 6,
    background: "#16a34a",
    color: "#fff",
    fontSize: "0.85rem",
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  editCancelBtn: {
    width: 30,
    height: 30,
    border: "none",
    borderRadius: 6,
    background: "#e5e7eb",
    color: "#6b7280",
    fontSize: "0.85rem",
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  // Swipeable row
  swipeDeleteBg: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 80,
    background: "#dc2626",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  swipeDeleteBtn: {
    background: "none",
    border: "none",
    color: "#fff",
    fontSize: "0.75rem",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  },
  // CSV Preview Modal
  modalOverlay: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
    padding: 12,
  },
  modalCard: {
    background: "#fff",
    borderRadius: 14,
    width: "100%",
    maxWidth: 520,
    maxHeight: "85vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 18px",
    borderBottom: "1px solid #e5e7eb",
  },
  modalTitle: {
    margin: 0,
    fontSize: "1rem",
    color: "#111827",
  },
  modalClose: {
    background: "none",
    border: "none",
    fontSize: "1.1rem",
    color: "#6b7280",
    cursor: "pointer",
    padding: 4,
  },
  modalFilter: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 18px",
    borderBottom: "1px solid #f3f4f6",
  },
  previewSearchWrap: {
    position: "relative",
    flex: 1,
    minWidth: 0,
  },
  previewSearchInput: {
    width: "100%",
    padding: "5px 28px 5px 8px",
    fontSize: "0.78rem",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    outline: "none",
    background: "#f9fafb",
    color: "#111827",
  },
  previewSearchClear: {
    position: "absolute",
    right: 4,
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    fontSize: "0.75rem",
    color: "#9ca3af",
    cursor: "pointer",
    padding: 2,
  },
  previewTabs: {
    display: "flex",
    padding: "0 18px",
    borderBottom: "1px solid #e5e7eb",
  },
  previewTab: {
    border: "none",
    padding: "6px 14px",
    fontSize: "0.78rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.12s",
    borderBottom: "2px solid transparent",
  },
  modalTableWrap: {
    flex: 1,
    overflowY: "auto",
    padding: "0 18px",
  },
  rawCsvTextarea: {
    width: "100%",
    minHeight: 200,
    padding: 10,
    fontFamily: "monospace",
    fontSize: "0.75rem",
    lineHeight: 1.5,
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    background: "#f9fafb",
    color: "#111827",
    resize: "vertical",
    outline: "none",
  },
  modalTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.8rem",
  },
  th: {
    textAlign: "left",
    padding: "8px 6px",
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "1px solid #e5e7eb",
    position: "sticky",
    top: 0,
    background: "#fff",
  },
  td: {
    padding: "7px 6px",
    color: "#374151",
    verticalAlign: "top",
  },
  tdMono: {
    padding: "7px 6px",
    fontFamily: "monospace",
    fontSize: "0.75rem",
    color: "#374151",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 18px",
    borderTop: "1px solid #e5e7eb",
    gap: 8,
  },
  modalCancelBtn: {
    background: "#f3f4f6",
    border: "none",
    borderRadius: 8,
    padding: "8px 16px",
    fontSize: "0.82rem",
    fontWeight: 600,
    color: "#6b7280",
    cursor: "pointer",
  },
};
