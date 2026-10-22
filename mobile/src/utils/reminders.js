import { formatDate } from './formatDate';

/**
 * Builds a bilingual (English/Hindi) payment reminder message and opens it
 * via WhatsApp click-to-chat, the device's native SMS app, or mailto —
 * shared by the student profile page and the seat map's seat detail
 * drawer so both surfaces send an identical reminder.
 *
 * `info` fields (all optional except fullName/studentId):
 *   fullName, studentId, mobile, email, joiningDate, seatLabel,
 *   lastPaymentText, balance, dueDate, libraryName, libraryAddress,
 *   libraryPhone
 */
export function buildReminderMessage(info) {
  const {
    fullName, studentId, joiningDate, seatLabel,
    lastPaymentText, balance, dueDate,
    libraryName, libraryAddress, libraryPhone,
  } = info;

  const dueLineEn = balance > 0
    ? `your due amount is ₹${balance}${dueDate ? `, due by ${formatDate(dueDate)}` : ''}.`
    : 'you have no pending dues at the moment.';
  const dueLineHi = balance > 0
    ? `आपकी बकाया राशि ₹${balance} है${dueDate ? `, जिसे ${formatDate(dueDate)} तक जमा करना है` : ''}।`
    : 'आपकी कोई बकाया राशि नहीं है।';

  const libName = libraryName || 'the library';
  const libAddress = libraryAddress ? `\nAddress: ${libraryAddress}` : '';
  const libPhone = libraryPhone ? `\nPhone: ${libraryPhone}` : '';
  const libAddressHi = libraryAddress ? `\nपता: ${libraryAddress}` : '';
  const libPhoneHi = libraryPhone ? `\nफोन: ${libraryPhone}` : '';

  const messageEn = `Hi ${fullName}, this is a reminder from ${libName} — ${dueLineEn}

Student ID: ${studentId}
Joining date: ${joiningDate ? formatDate(joiningDate) : '—'}
Seat: ${seatLabel || 'Not allocated'}
Last payment: ${lastPaymentText || 'No payment recorded yet'}
${libName}${libAddress}${libPhone}

Please clear your dues at your earliest convenience. Thank you!`;

  const messageHi = `नमस्ते ${fullName}, यह ${libName} की तरफ से एक रिमाइंडर है — ${dueLineHi}

स्टूडेंट आईडी: ${studentId}
जॉइनिंग तिथि: ${joiningDate ? formatDate(joiningDate) : '—'}
सीट: ${seatLabel || 'कोई सीट आवंटित नहीं'}
पिछला भुगतान: ${lastPaymentText || 'अभी तक कोई भुगतान नहीं हुआ'}
${libName}${libAddressHi}${libPhoneHi}

कृपया जल्द से जल्द अपना भुगतान करें। धन्यवाद!`;

  return `${messageEn}\n\n---\n\n${messageHi}`;
}

/** Normalizes a raw mobile number to a WhatsApp/SMS-ready "91XXXXXXXXXX" string, or null if missing. */
export function toReminderPhone(mobile) {
  const digits = (mobile || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 ? `91${digits}` : digits;
}

export function openWhatsappReminder(info) {
  const phone = toReminderPhone(info.mobile);
  if (!phone) return false;
  const message = buildReminderMessage(info);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

export function openSmsReminder(info) {
  const phone = toReminderPhone(info.mobile);
  if (!phone) return false;
  const message = buildReminderMessage(info);
  const separator = /iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?';
  window.location.href = `sms:+${phone}${separator}body=${encodeURIComponent(message)}`;
  return true;
}

export function openEmailReminder(info) {
  if (!info.email) return false;
  const message = buildReminderMessage(info);
  const libName = info.libraryName || 'Library';
  const subject = `Payment Reminder from ${libName} / भुगतान रिमाइंडर`;
  window.location.href = `mailto:${info.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  return true;
}
