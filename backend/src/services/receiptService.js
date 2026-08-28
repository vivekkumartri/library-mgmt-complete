const PDFDocument = require('pdfkit');
const repos = require('../repositories');
const { AppError } = require('../utils/AppError');
const driveService = require('./googleDriveService');

// A single neutral brand color used for the header band, the "PAID" stamp,
// and table accents — deliberately not configurable per-library (the app
// has no theming settings), but kept in one place so it's easy to change.
const BRAND = '#1F4B6B';
const BRAND_SOFT = '#EAF1F5';
const INK = '#1A1A1A';
const INK_SOFT = '#6B7280';
const BORDER = '#DDE3E8';

function formatMoney(value) {
  const n = Number(value || 0);
  return `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Monthly_Billing only stores a "YYYY-MM" month, not day-level dates — the
// receipt still needs to say which dates the fee covers, so derive the
// calendar month's first/last day from it.
function monthToDateRange(billingMonth) {
  if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) return null;
  const [year, month] = billingMonth.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// Small-number-to-words for the "Amount in words" line on the receipt —
// intentionally simple (handles up to crores), no external dependency.
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsToWords(n) {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${TENS[tens]}${ones ? ' ' + ONES[ones] : ''}`;
}

function threeDigitsToWords(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return `${hundreds ? ONES[hundreds] + ' Hundred' + (rest ? ' ' : '') : ''}${rest ? twoDigitsToWords(rest) : ''}`;
}

function amountToWords(amount) {
  const rupees = Math.floor(Number(amount || 0));
  const paise = Math.round((Number(amount || 0) - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  let n = rupees;
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = n;

  if (crore) parts.push(`${twoDigitsToWords(crore) || threeDigitsToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitsToWords(lakh) || threeDigitsToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitsToWords(thousand) || threeDigitsToWords(thousand)} Thousand`);
  if (hundred) parts.push(threeDigitsToWords(hundred));

  let words = parts.filter(Boolean).join(' ') || 'Zero';
  words += ' Rupees';
  if (paise > 0) words += ` and ${twoDigitsToWords(paise)} Paise`;
  return `${words} Only`;
}

/** Renders a payment receipt as a PDF buffer. */
async function buildReceiptPdf(paymentId) {
  const payment = await repos.payments.findById(paymentId);
  if (!payment) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
  const billing = payment.billing_id ? await repos.billing.findById(payment.billing_id) : null;
  const student = await repos.students.findById(payment.student_id);
  const settingsRows = await repos.settings.findAll();
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));

  let allocation = null;
  if (billing?.allocation_id) allocation = await repos.allocations.findById(billing.allocation_id);
  let seat = null;
  let floor = null;
  if (allocation) {
    seat = await repos.seats.findById(allocation.seat_id);
    floor = await repos.floors.findById(allocation.floor_id);
  }

  // The date range this payment covers — from the billing month (Monthly_
  // Billing only stores "YYYY-MM", so its calendar month bounds are used)
  // or directly from the range-payment fields. Shown both in the info box
  // and the itemized line below.
  let periodLabel = null;
  if (billing) {
    const range = monthToDateRange(billing.billing_month);
    periodLabel = range ? `${formatDate(range.start)} to ${formatDate(range.end)}` : billing.billing_month || null;
  } else if (payment.period_start && payment.period_end) {
    periodLabel = `${formatDate(payment.period_start)} to ${formatDate(payment.period_end)}`;
  }

  // Best-effort logo fetch — a Drive hiccup here must never block the
  // receipt itself from generating, it just prints without the logo.
  let logoBuffer = null;
  if (settings.library_logo_drive_file_id) {
    try {
      logoBuffer = await driveService.getFileBuffer(settings.library_logo_drive_file_id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[receipt] failed to fetch library logo, generating receipt without it', err.message);
    }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const marginX = 50;
    const contentWidth = pageWidth - marginX * 2;

    // ---- Header band ----
    const headerHeight = 100;
    doc.rect(0, 0, pageWidth, headerHeight).fill(BRAND);

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, marginX, 20, { width: 56, height: 56, fit: [56, 56] });
      } catch {
        // Not a decodable image (e.g. SVG) — skip drawing it, still render the rest.
      }
    }
    const nameX = logoBuffer ? marginX + 70 : marginX;
    doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold')
      .text(settings.library_name || 'Library', nameX, 26, { width: contentWidth - (nameX - marginX) });
    doc.fontSize(9).font('Helvetica')
      .text(
        [settings.library_address, [settings.library_phone, settings.library_email].filter(Boolean).join('  ·  ')]
          .filter(Boolean).join('\n'),
        nameX, 52, { width: contentWidth - (nameX - marginX) }
      );

    // ---- Title + receipt meta ----
    let y = headerHeight + 24;
    doc.fillColor(INK).fontSize(16).font('Helvetica-Bold').text('Payment Receipt', marginX, y);
    doc.fillColor(BRAND).fontSize(11).font('Helvetica-Bold')
      .text(payment.receipt_number || '-', marginX, y, { width: contentWidth, align: 'right' });
    y += 22;
    doc.moveTo(marginX, y).lineTo(pageWidth - marginX, y).lineWidth(1).strokeColor(BORDER).stroke();
    y += 18;

    // ---- PAID stamp (top-right, only for active payments) ----
    if (payment.status !== 'void') {
      const stampW = 90;
      const stampX = pageWidth - marginX - stampW;
      doc.save();
      doc.roundedRect(stampX, y - 4, stampW, 26, 4).lineWidth(1.5).strokeColor(BRAND).stroke();
      doc.fillColor(BRAND).fontSize(12).font('Helvetica-Bold')
        .text('PAID', stampX, y + 3, { width: stampW, align: 'center' });
      doc.restore();
    } else {
      const stampW = 90;
      const stampX = pageWidth - marginX - stampW;
      doc.save();
      doc.roundedRect(stampX, y - 4, stampW, 26, 4).lineWidth(1.5).strokeColor('#B91C1C').stroke();
      doc.fillColor('#B91C1C').fontSize(12).font('Helvetica-Bold')
        .text('VOID', stampX, y + 3, { width: stampW, align: 'center' });
      doc.restore();
    }

    // ---- Two-column info block: Billed To / Receipt Info ----
    const colWidth = (contentWidth - 24) / 2;
    const infoTop = y;

    doc.fillColor(INK_SOFT).fontSize(9).font('Helvetica-Bold').text('BILLED TO', marginX, infoTop);
    doc.fillColor(INK).fontSize(11).font('Helvetica-Bold')
      .text(student?.full_name || '-', marginX, infoTop + 14, { width: colWidth });
    doc.fillColor(INK_SOFT).fontSize(10).font('Helvetica')
      .text(
        [student?.student_id, student?.mobile].filter(Boolean).join('  ·  '),
        marginX, infoTop + 32, { width: colWidth }
      );
    if (floor || seat) {
      doc.text(
        [floor?.floor_name, seat ? `Seat ${seat.seat_number}` : null].filter(Boolean).join('  ·  '),
        marginX, infoTop + 48, { width: colWidth }
      );
    }
    if (periodLabel) {
      doc.fillColor(INK_SOFT).fontSize(9).font('Helvetica-Bold').text('PAYMENT PERIOD', marginX, infoTop + 66);
      doc.fillColor(INK).fontSize(10).font('Helvetica-Bold').text(periodLabel, marginX, infoTop + 78, { width: colWidth });
    }

    const rightColX = marginX + colWidth + 24;
    doc.fillColor(INK_SOFT).fontSize(9).font('Helvetica-Bold').text('RECEIPT INFO', rightColX, infoTop);
    const metaRow = (label, value, offsetY) => {
      doc.fillColor(INK_SOFT).fontSize(10).font('Helvetica').text(label, rightColX, infoTop + offsetY, { continued: true, width: 100 });
      doc.fillColor(INK).font('Helvetica-Bold').text(`  ${value ?? '-'}`);
    };
    metaRow('Date', formatDate(payment.payment_date), 14);
    metaRow('Method', (payment.payment_method || '-').toUpperCase(), 30);
    if (payment.reference_number) metaRow('Reference', payment.reference_number, 46);

    y = infoTop + (periodLabel ? 96 : 72);
    doc.moveTo(marginX, y).lineTo(pageWidth - marginX, y).lineWidth(1).strokeColor(BORDER).stroke();
    y += 20;

    // ---- Itemized table ----
    const col1X = marginX;
    const col2X = pageWidth - marginX - 130;
    const tableHeaderY = y;
    doc.rect(marginX, tableHeaderY, contentWidth, 24).fill(BRAND_SOFT);
    doc.fillColor(BRAND).fontSize(9).font('Helvetica-Bold')
      .text('DESCRIPTION', col1X + 10, tableHeaderY + 7)
      .text('AMOUNT', col2X, tableHeaderY + 7, { width: 120, align: 'right' });
    y = tableHeaderY + 24;

    const line = (label, value, opts = {}) => {
      const rowH = 24;
      doc.fillColor(opts.bold ? INK : INK_SOFT).fontSize(10).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .text(label, col1X + 10, y + 6, { width: col2X - col1X - 20 });
      doc.fillColor(INK).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .text(value, col2X, y + 6, { width: 120, align: 'right' });
      y += rowH;
      doc.moveTo(marginX, y).lineTo(pageWidth - marginX, y).lineWidth(0.5).strokeColor(BORDER).stroke();
    };

    if (billing) {
      line(`Library fee — ${periodLabel || billing.billing_month || ''}`, formatMoney(billing.base_fee));
      if (Number(billing.discount) > 0) line('Discount', `- ${formatMoney(billing.discount)}`);
      if (Number(billing.late_fee) > 0) line('Late fee', formatMoney(billing.late_fee));
      line('Total payable', formatMoney(billing.payable), { bold: true });
    } else if (periodLabel) {
      line(`Library fee — ${periodLabel}`, formatMoney(payment.amount));
    } else {
      line('Library fee', formatMoney(payment.amount));
    }

    // ---- Amount paid highlight ----
    y += 10;
    const paidBoxH = 40;
    doc.rect(marginX, y, contentWidth, paidBoxH).fill(BRAND);
    doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold').text('AMOUNT PAID', col1X + 10, y + 13);
    doc.fontSize(15).text(formatMoney(payment.amount), col2X - 20, y + 10, { width: 140, align: 'right' });
    y += paidBoxH + 10;

    if (billing) {
      const remaining = Math.max(0, Number(billing.payable) - Number(billing.paid));
      doc.fillColor(INK_SOFT).fontSize(9).font('Helvetica')
        .text(`Remaining balance for this billing period: ${formatMoney(remaining)}`, marginX, y, { width: contentWidth, align: 'right' });
      y += 16;
    }

    // ---- Amount in words ----
    doc.fillColor(INK_SOFT).fontSize(9).font('Helvetica-Oblique')
      .text(`Amount in words: ${amountToWords(payment.amount)}`, marginX, y, { width: contentWidth });
    y += 24;

    if (payment.status === 'void' && payment.void_reason) {
      doc.fillColor('#B91C1C').fontSize(9).font('Helvetica')
        .text(`This receipt was voided. Reason: ${payment.void_reason}`, marginX, y, { width: contentWidth });
      y += 20;
    }

    // ---- Footer ----
    const footerY = doc.page.height - 90;
    doc.moveTo(marginX, footerY).lineTo(pageWidth - marginX, footerY).lineWidth(1).strokeColor(BORDER).stroke();
    doc.fillColor(INK_SOFT).fontSize(9).font('Helvetica')
      .text(`Received by: ${payment.received_by || '-'}`, marginX, footerY + 10);
    doc.text('This is a computer-generated receipt and does not require a signature.', marginX, footerY + 26, {
      width: contentWidth, align: 'center',
    });
    doc.text(
      `${settings.library_name || 'Library'} — generated on ${formatDate(new Date().toISOString())}`,
      marginX, footerY + 40, { width: contentWidth, align: 'center' }
    );

    doc.end();
  });
}

module.exports = { buildReceiptPdf, amountToWords, formatMoney };
