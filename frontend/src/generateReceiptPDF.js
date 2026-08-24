/**
 * RHoSAM — Zero-dependency PDF Receipt Generator
 * Generates thermal-printer-style receipts (80mm width) as downloadable PDFs.
 * No external libraries required — pure PDF spec.
 */

const Naira = (n) =>
  "\u20A6" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });

// Minimal PDF builder — produces a valid PDF 1.4 file with text content
function buildPDF(lines, opts = {}) {
  const pageW = opts.width || 595;  // A4 width in points
  const pageH = opts.height || 842;
  const margin = 40;
  const fontSize = opts.fontSize || 10;
  const leading = opts.leading || 14;

  // Collect all text objects
  const objects = [];
  let objNum = 1;

  function addObj(content) {
    objects.push(content);
    return objNum++;
  }

  // 1) Catalog
  const catalogId = addObj("<< /Type /Catalog /Pages 2 0 R >>");

  // 2) Pages
  const pagesId = addObj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");

  // 3) Page
  const pageId = addObj(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`
  );

  // 4) Content stream
  let stream = "BT\n";
  let y = pageH - margin;
  const centerX = pageW / 2;

  for (const line of lines) {
    if (y < margin + 30) break; // safety — don't overflow page

    const text = line.text || "";
    const size = line.size || fontSize;
    const bold = line.bold || false;
    const align = line.align || "left";

    // Font size
    const fontName = bold ? "/F1" : "/F1";
    stream += `/F1 ${size} Tf\n`;

    let x;
    if (align === "center") {
      // Approximate centering (rough char width at this size)
      const charW = size * 0.5;
      const textW = text.length * charW;
      x = centerX - textW / 2;
    } else if (align === "right") {
      const charW = size * 0.5;
      const textW = text.length * charW;
      x = pageW - margin - textW;
    } else {
      x = margin;
    }

    // Escape special PDF characters
    const escaped = text
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");

    // Bold simulation: draw text twice with slight offset
    if (bold) {
      stream += `1 0 0 1 ${x} ${y} Tm\n`;
      stream += `(${escaped}) Tj\n`;
      stream += `1 0 0 1 ${x + 0.3} ${y} Tm\n`;
      stream += `(${escaped}) Tj\n`;
    } else {
      stream += `1 0 0 1 ${x} ${y} Tm\n`;
      stream += `(${escaped}) Tj\n`;
    }

    y -= line.leading || leading;
  }

  stream += "ET\n";

  const streamBytes = Buffer.from ? Buffer.from(stream) : new TextEncoder().encode(stream);
  const streamLength = stream.length;

  const contentId = addObj(`<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`);

  // 5) Font
  const fontId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  // Build xref table
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

/**
 * Generate a PDF receipt and trigger download.
 * @param {Object} receipt - The sale receipt object from the API
 */
export function generateReceiptPDF(receipt) {
  if (!receipt) return;

  const lines = [];
  const add = (text, opts = {}) => lines.push({ text, ...opts });

  // Header
  add("RHoSAM SUPERMARKET", { size: 16, bold: true, align: "center", leading: 20 });
  add("================================", { align: "center", leading: 12 });
  add("", { leading: 6 });

  // Receipt info
  if (receipt.branchName) {
    add(`Branch: ${receipt.branchName}`, { leading: 13 });
  }
  add(`Receipt: ${receipt.receiptNumber}`, { leading: 13 });
  add(`Date: ${new Date(receipt.createdAt || receipt.created_at).toLocaleString("en-NG")}`, { leading: 13 });
  add(`Cashier: ${receipt.cashierName || "—"}`, { leading: 13 });
  add(`Customer: ${receipt.customerName || "Walk-in Customer"}`, { leading: 13 });
  add(`Payment: ${receipt.paymentMethod || "Cash"}`, { leading: 13 });
  add("", { leading: 6 });
  add("--------------------------------", { align: "center", leading: 10 });

  // Items
  for (const item of receipt.items || []) {
    const name = item.name || item.product_name || "Item";
    const qty = item.quantity || 1;
    const lineTotal = item.lineTotal || item.line_total || 0;
    add(`${name} x${qty}`, { leading: 13 });
    add(Naira(lineTotal), { align: "right", leading: 13 });
  }

  add("--------------------------------", { align: "center", leading: 10 });

  // Totals
  add(`Subtotal:    ${Naira(receipt.subtotal)}`, { leading: 13 });
  if (receipt.discount > 0) {
    add(`Discount:   -${Naira(receipt.discount)}`, { leading: 13 });
  }
  if (receipt.tax > 0) {
    add(`Tax:         ${Naira(receipt.tax)}`, { leading: 13 });
  }
  add("", { leading: 4 });
  add(`TOTAL:       ${Naira(receipt.total)}`, { bold: true, leading: 16 });
  add("", { leading: 4 });

  if (receipt.amountPaid > 0) {
    add(`Paid:        ${Naira(receipt.amountPaid)}`, { leading: 13 });
  }
  if (receipt.change_amount > 0) {
    add(`Change:      ${Naira(receipt.change_amount)}`, { leading: 13 });
  }

  add("", { leading: 8 });
  add("================================", { align: "center", leading: 10 });
  add("Thank you for shopping!", { align: "center", bold: true, leading: 14 });
  add("Visit us again!", { align: "center", leading: 14 });
  add("================================", { align: "center", leading: 10 });

  // Build PDF
  const pdfString = buildPDF(lines, { fontSize: 10, leading: 14 });

  // Trigger download
  const blob = new Blob([pdfString], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receipt-${receipt.receiptNumber || "sale"}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
