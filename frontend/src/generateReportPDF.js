/**
 * RHoSAM — Zero-dependency PDF Report Generator
 * Generates A4-style reports for damages, wastage, and inventory data.
 * No external libraries required — pure PDF spec.
 */

const Naira = (n) => {
  const v = parseFloat(n) || 0;
  return "\u20A6" + v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Multi-page PDF builder with automatic page breaks
function buildReportPDF(sections, opts = {}) {
  const pageW = 595;  // A4 width
  const pageH = 842;
  const margin = 40;
  const fontSize = opts.fontSize || 10;
  const leading = opts.leading || 14;

  const objects = [];
  let objNum = 1;
  function addObj(content) { objects.push(content); return objNum++; }

  // Collect all lines across sections
  const allLines = [];
  for (const section of sections) {
    if (typeof section === "string") {
      allLines.push({ text: section });
    } else {
      allLines.push(section);
    }
  }

  // Paginate lines
  const pages = [];
  let currentPage = [];
  let y = pageH - margin;

  for (const line of allLines) {
    const size = line.size || fontSize;
    const ld = line.leading || leading;

    if (y < margin + 30) {
      pages.push(currentPage);
      currentPage = [];
      y = pageH - margin;
    }

    currentPage.push({ ...line, y });
    y -= ld;
  }
  if (currentPage.length) pages.push(currentPage);

  // Build PDF objects
  const catalogId = addObj("<< /Type /Catalog /Pages 2 0 R >>");
  const pageRefs = [];

  for (let p = 0; p < pages.length; p++) {
    const pageObjNum = objNum + 1;
    pageRefs.push(`${pageObjNum} 0 R`);

    // Page object
    addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${pageObjNum + 1} 0 R /Resources << /Font << /F1 ${pageObjNum + 2} 0 R >> >> >>`);

    // Content stream
    let stream = "BT\n";
    for (const line of pages[p]) {
      const text = line.text || "";
      const size = line.size || fontSize;
      const bold = line.bold || false;
      const align = line.align || "left";

      stream += `/F1 ${size} Tf\n`;

      let x;
      if (align === "center") {
        const charW = size * 0.5;
        const textW = text.length * charW;
        x = pageW / 2 - textW / 2;
      } else if (align === "right") {
        const charW = size * 0.5;
        const textW = text.length * charW;
        x = pageW - margin - textW;
      } else {
        x = margin;
      }

      const escaped = text
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)");

      if (bold) {
        stream += `1 0 0 1 ${x} ${line.y} Tm\n(${escaped}) Tj\n`;
        stream += `1 0 0 1 ${x + 0.3} ${line.y} Tm\n(${escaped}) Tj\n`;
      } else {
        stream += `1 0 0 1 ${x} ${line.y} Tm\n(${escaped}) Tj\n`;
      }
    }
    stream += "ET\n";

    addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  }

  // Pages object
  const pagesObjNum = 2;
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages.length} >>`;

  // Build xref
  const offsets = [];
  let pdf = "%PDF-1.4\n";
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const off of offsets) {
    pdf += String(off).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function triggerDownload(pdfString, filename) {
  const blob = new Blob([pdfString], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate a Damages Report PDF
 * @param {Array} damages - Array of damage movement objects
 * @param {Object} opts - { branchName, dateRange, generatedBy }
 */
export function generateDamagesReportPDF(damages = [], opts = {}) {
  const lines = [];
  const add = (text, o = {}) => lines.push({ text, ...o });
  const hr = () => add("=".repeat(50), { align: "center", leading: 8 });

  // Header
  hr();
  add("RHoSAM SUPERMARKET", { size: 16, bold: true, align: "center", leading: 20 });
  add("DAMAGES REPORT", { size: 14, bold: true, align: "center", leading: 18 });
  hr();
  add("", { leading: 6 });

  // Report metadata
  if (opts.branchName) add(`Branch: ${opts.branchName}`, { leading: 13 });
  add(`Generated: ${new Date().toLocaleString("en-NG", { dateStyle: "full", timeStyle: "short" })}`, { leading: 13 });
  if (opts.generatedBy) add(`By: ${opts.generatedBy}`, { leading: 13 });
  if (opts.dateRange) add(`Period: ${opts.dateRange}`, { leading: 13 });
  add("", { leading: 6 });

  // Summary
  const totalUnits = damages.reduce((s, d) => s + Math.abs(d.quantity), 0);
  add("--- SUMMARY ---", { bold: true, align: "center", leading: 14 });
  add(`Total Reports:  ${damages.length}`, { leading: 14 });
  add(`Total Units:    ${totalUnits}`, { leading: 14 });
  add("", { leading: 6 });

  // Table header
  add("--- REPORTS ---", { bold: true, align: "center", leading: 14 });
  add("", { leading: 4 });
  add("Date          Product                    Qty    Reason", { bold: true, leading: 13 });
  add("-".repeat(50), { leading: 10 });

  // Table rows
  for (const d of damages) {
    const date = new Date(d.created_at).toLocaleDateString("en-NG", { dateStyle: "short" });
    const name = (d.product_name || "").slice(0, 24).padEnd(24);
    const qty = String(Math.abs(d.quantity)).padStart(4);
    const reason = (d.notes || "—").slice(0, 20);
    add(`${date.padEnd(14)}${name}  ${qty}    ${reason}`, { leading: 13 });
  }

  if (!damages.length) {
    add("No damage reports found.", { align: "center", leading: 14 });
  }

  add("", { leading: 8 });
  hr();
  add("This report was generated by RHoSAM Supermarket POS", { align: "center", size: 8, leading: 12 });

  const pdf = buildReportPDF(lines);
  triggerDownload(pdf, `damages-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * Generate a Wastage Report PDF
 * @param {Array} wastage - Array of wastage movement objects
 * @param {Object} opts - { branchName, dateRange, generatedBy }
 */
export function generateWastageReportPDF(wastage = [], opts = {}) {
  const lines = [];
  const add = (text, o = {}) => lines.push({ text, ...o });
  const hr = () => add("=".repeat(50), { align: "center", leading: 8 });

  // Header
  hr();
  add("RHoSAM SUPERMARKET", { size: 16, bold: true, align: "center", leading: 20 });
  add("WASTAGE REPORT", { size: 14, bold: true, align: "center", leading: 18 });
  hr();
  add("", { leading: 6 });

  // Report metadata
  if (opts.branchName) add(`Branch: ${opts.branchName}`, { leading: 13 });
  add(`Generated: ${new Date().toLocaleString("en-NG", { dateStyle: "full", timeStyle: "short" })}`, { leading: 13 });
  if (opts.generatedBy) add(`By: ${opts.generatedBy}`, { leading: 13 });
  if (opts.dateRange) add(`Period: ${opts.dateRange}`, { leading: 13 });
  add("", { leading: 6 });

  // Summary
  const totalUnits = wastage.reduce((s, w) => s + Math.abs(w.quantity), 0);
  add("--- SUMMARY ---", { bold: true, align: "center", leading: 14 });
  add(`Total Records:  ${wastage.length}`, { leading: 14 });
  add(`Total Units:    ${totalUnits}`, { leading: 14 });
  add("", { leading: 6 });

  // Table header
  add("--- RECORDS ---", { bold: true, align: "center", leading: 14 });
  add("", { leading: 4 });
  add("Date          Product                    Qty    Reason", { bold: true, leading: 13 });
  add("-".repeat(50), { leading: 10 });

  // Table rows
  for (const w of wastage) {
    const date = new Date(w.created_at).toLocaleDateString("en-NG", { dateStyle: "short" });
    const name = (w.product_name || "").slice(0, 24).padEnd(24);
    const qty = String(Math.abs(w.quantity)).padStart(4);
    const reason = (w.notes || "—").slice(0, 20);
    add(`${date.padEnd(14)}${name}  ${qty}    ${reason}`, { leading: 13 });
  }

  if (!wastage.length) {
    add("No wastage records found.", { align: "center", leading: 14 });
  }

  add("", { leading: 8 });
  hr();
  add("This report was generated by RHoSAM Supermarket POS", { align: "center", size: 8, leading: 12 });

  const pdf = buildReportPDF(lines);
  triggerDownload(pdf, `wastage-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * Generate a Combined Damages & Wastage Summary PDF
 * @param {Array} damages - Damage movements
 * @param {Array} wastage - Wastage movements
 * @param {Object} opts - { branchName, generatedBy }
 */
export function generateInventoryLossReportPDF(damages = [], wastage = [], opts = {}) {
  const lines = [];
  const add = (text, o = {}) => lines.push({ text, ...o });
  const hr = () => add("=".repeat(50), { align: "center", leading: 8 });

  hr();
  add("RHoSAM SUPERMARKET", { size: 16, bold: true, align: "center", leading: 20 });
  add("INVENTORY LOSS SUMMARY", { size: 14, bold: true, align: "center", leading: 18 });
  hr();
  add("", { leading: 6 });

  if (opts.branchName) add(`Branch: ${opts.branchName}`, { leading: 13 });
  add(`Generated: ${new Date().toLocaleString("en-NG", { dateStyle: "full", timeStyle: "short" })}`, { leading: 13 });
  if (opts.generatedBy) add(`By: ${opts.generatedBy}`, { leading: 13 });
  add("", { leading: 6 });

  // Combined summary
  const damageUnits = damages.reduce((s, d) => s + Math.abs(d.quantity), 0);
  const wastageUnits = wastage.reduce((s, w) => s + Math.abs(w.quantity), 0);

  add("--- LOSS SUMMARY ---", { bold: true, align: "center", leading: 14 });
  add("", { leading: 4 });
  add(`Category              Records    Units Lost`, { bold: true, leading: 13 });
  add(`-`.repeat(40), { leading: 10 });
  add(`Damages               ${String(damages.length).padStart(6)}    ${String(damageUnits).padStart(8)}`, { leading: 13 });
  add(`Wastage               ${String(wastage.length).padStart(6)}    ${String(wastageUnits).padStart(8)}`, { leading: 13 });
  add(`-`.repeat(40), { leading: 10 });
  add(`TOTAL                 ${String(damages.length + wastage.length).padStart(6)}    ${String(damageUnits + wastageUnits).padStart(8)}`, { bold: true, leading: 13 });
  add("", { leading: 8 });

  // Top damaged products
  const productLosses = {};
  for (const d of damages) {
    const name = d.product_name || "Unknown";
    productLosses[name] = (productLosses[name] || 0) + Math.abs(d.quantity);
  }
  for (const w of wastage) {
    const name = w.product_name || "Unknown";
    productLosses[name] = (productLosses[name] || 0) + Math.abs(w.quantity);
  }
  const sorted = Object.entries(productLosses).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (sorted.length) {
    add("--- TOP AFFECTED PRODUCTS ---", { bold: true, align: "center", leading: 14 });
    add("", { leading: 4 });
    add("Product                         Total Units", { bold: true, leading: 13 });
    add("-".repeat(40), { leading: 10 });
    for (const [name, units] of sorted) {
      add(`${name.slice(0, 30).padEnd(30)}  ${String(units).padStart(8)}`, { leading: 13 });
    }
  }

  add("", { leading: 8 });
  hr();
  add("This report was generated by RHoSAM Supermarket POS", { align: "center", size: 8, leading: 12 });

  const pdf = buildReportPDF(lines);
  triggerDownload(pdf, `inventory-loss-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}
