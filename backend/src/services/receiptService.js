const PDFDocument = require('pdfkit');
const repos = require('../repositories');
const { AppError } = require('../utils/AppError');
const driveService = require('./googleDriveService');

/** Renders a payment receipt as a PDF buffer. */
async function buildReceiptPdf(paymentId) {
  const payment = await repos.payments.findById(paymentId);
  if (!payment) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
  const billing = await repos.billing.findById(payment.billing_id);
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
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, doc.page.width / 2 - 30, doc.y, { width: 60, height: 60, fit: [60, 60] });
        doc.moveDown(4);
      } catch {
        // Not a decodable image (e.g. SVG) — skip drawing it, still render the rest.
      }
    }

    doc.fontSize(18).text(settings.library_name || 'Library', { align: 'center' });
    if (settings.library_address) doc.fontSize(10).text(settings.library_address, { align: 'center' });
    if (settings.library_phone || settings.library_email) {
      doc.fontSize(10).text([settings.library_phone, settings.library_email].filter(Boolean).join('  |  '), { align: 'center' });
    }
    doc.moveDown();
    doc.fontSize(14).text('Payment Receipt', { align: 'center', underline: true });
    doc.moveDown();

    const row = (label, value) => {
      doc.fontSize(11).text(`${label}:`, { continued: true, width: 200 }).text(`  ${value ?? '-'}`);
    };

    row('Receipt Number', payment.receipt_number);
    row('Payment Date', payment.payment_date);
    row('Student Name', student?.full_name);
    row('Student ID', student?.student_id);
    if (floor) row('Floor', floor.floor_name);
    if (seat) row('Seat', seat.seat_number);
    if (billing) row('Billing Month', billing.billing_month);
    if (billing) row('Monthly Fee', billing.base_fee);
    if (billing) row('Discount', billing.discount);
    if (billing) row('Late Fee', billing.late_fee);
    if (billing) row('Total Payable', billing.payable);
    row('Amount Paid', payment.amount);
    if (billing) row('Remaining Amount', Math.max(0, Number(billing.payable) - Number(billing.paid)));
    row('Payment Method', payment.payment_method?.toUpperCase());
    if (payment.reference_number) row('Reference Number', payment.reference_number);
    row('Received By', payment.received_by);

    doc.moveDown(2);
    doc.fontSize(9).fillColor('gray').text('This is a computer-generated receipt.', { align: 'center' });

    doc.end();
  });
}

module.exports = { buildReceiptPdf };
