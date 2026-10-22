import { formatDate } from './formatDate';

/**
 * Payment reminder templates — admin-customizable free text with
 * {{placeholder}} tokens, edited in Settings (ReminderTemplatesSettings)
 * and stored under these Settings-sheet keys. FIELD_DEFS is the single
 * source of truth both for what Settings' "+ Add field" picker offers and
 * for what fillTemplate() actually substitutes, so a token can never be
 * typo'd into existence — it only ever gets there via the picker.
 */
export const REMINDER_TEMPLATE_KEYS = {
  whatsapp: 'reminder_template_whatsapp',
  sms: 'reminder_template_sms',
  emailSubject: 'reminder_template_email_subject',
  emailBody: 'reminder_template_email_body',
};

export const FIELD_DEFS = [
  { token: 'studentName', label: 'Student name' },
  { token: 'studentId', label: 'Student ID' },
  { token: 'mobile', label: 'Mobile number' },
  { token: 'email', label: 'Email address' },
  { token: 'joiningDate', label: 'Joining date' },
  { token: 'seat', label: 'Seat' },
  { token: 'lastPayment', label: 'Last payment' },
  { token: 'dueAmount', label: 'Due amount (₹)' },
  { token: 'dueDate', label: 'Due date' },
  { token: 'libraryName', label: 'Library name' },
  { token: 'libraryAddress', label: 'Library address' },
  { token: 'libraryPhone', label: 'Library phone' },
  { token: 'dueLine', label: 'Due status sentence (English)' },
  { token: 'dueLineHi', label: 'Due status sentence (Hindi)' },
  { token: 'libraryAddressLine', label: 'Library address line (English, blank if not set)' },
  { token: 'libraryAddressLineHi', label: 'Library address line (Hindi, blank if not set)' },
  { token: 'libraryPhoneLine', label: 'Library phone line (English, blank if not set)' },
  { token: 'libraryPhoneLineHi', label: 'Library phone line (Hindi, blank if not set)' },
  { token: 'seatHi', label: 'Seat (Hindi fallback wording)' },
  { token: 'lastPaymentHi', label: 'Last payment (Hindi fallback wording)' },
  { token: 'libraryNameSubject', label: 'Library name (email subject fallback wording)' },
];

// This is exactly the message every reminder sent before templates became
// customizable — the admin's very first "Payment reminder templates" view
// in Settings must show this, not an approximation, so nothing changes in
// what gets sent until they actually choose to edit it. dueLine/dueLineHi
// carry the old code's whole conditional sentence (different wording
// depending on whether anything is owed) since a single {{token}} can't
// express a conditional — libraryAddress/libraryPhone's old leading-newline
// formatting is reproduced the same way, folded into the surrounding text
// rather than left as separate tokens.
const DEFAULT_WHATSAPP_SMS_TEMPLATE = `Hi {{studentName}}, this is a reminder from {{libraryName}} — {{dueLine}}

Student ID: {{studentId}}
Joining date: {{joiningDate}}
Seat: {{seat}}
Last payment: {{lastPayment}}
{{libraryName}}{{libraryAddressLine}}{{libraryPhoneLine}}

Please clear your dues at your earliest convenience. Thank you!

---

नमस्ते {{studentName}}, यह {{libraryName}} की तरफ से एक रिमाइंडर है — {{dueLineHi}}

स्टूडेंट आईडी: {{studentId}}
जॉइनिंग तिथि: {{joiningDate}}
सीट: {{seatHi}}
पिछला भुगतान: {{lastPaymentHi}}
{{libraryName}}{{libraryAddressLineHi}}{{libraryPhoneLineHi}}

कृपया जल्द से जल्द अपना भुगतान करें। धन्यवाद!`;

// Old openEmailReminder used a different fallback ('Library') here than
// the message body's libName ('the library') — preserved via its own
// token rather than silently unifying the two and changing behavior for
// a library with no name set in Settings.
const DEFAULT_EMAIL_SUBJECT = 'Payment Reminder from {{libraryNameSubject}} / भुगतान रिमाइंडर';
const DEFAULT_EMAIL_BODY = DEFAULT_WHATSAPP_SMS_TEMPLATE;

export const DEFAULT_TEMPLATES = {
  [REMINDER_TEMPLATE_KEYS.whatsapp]: DEFAULT_WHATSAPP_SMS_TEMPLATE,
  [REMINDER_TEMPLATE_KEYS.sms]: DEFAULT_WHATSAPP_SMS_TEMPLATE,
  [REMINDER_TEMPLATE_KEYS.emailSubject]: DEFAULT_EMAIL_SUBJECT,
  [REMINDER_TEMPLATE_KEYS.emailBody]: DEFAULT_EMAIL_BODY,
};

/** Builds the {{token}} -> display-string map from an `info` object (see callers for its shape). */
function fieldValues(info) {
  const {
    fullName, studentId, mobile, email, joiningDate, seatLabel,
    lastPaymentText, balance, dueDate, libraryName, libraryAddress, libraryPhone,
  } = info;
  return {
    studentName: fullName || '',
    studentId: studentId || '',
    mobile: mobile || '',
    email: email || '',
    joiningDate: joiningDate ? formatDate(joiningDate) : '—',
    seat: seatLabel || 'Not allocated',
    seatHi: seatLabel || 'कोई सीट आवंटित नहीं',
    lastPayment: lastPaymentText || 'No payment recorded yet',
    lastPaymentHi: lastPaymentText || 'अभी तक कोई भुगतान नहीं हुआ',
    dueAmount: balance > 0 ? String(balance) : '0',
    dueDate: dueDate ? formatDate(dueDate) : '—',
    libraryName: libraryName || 'the library',
    libraryNameSubject: libraryName || 'Library',
    libraryAddress: libraryAddress || '',
    libraryPhone: libraryPhone || '',
    dueLine: balance > 0
      ? `your due amount is ₹${balance}${dueDate ? `, due by ${formatDate(dueDate)}` : ''}.`
      : 'you have no pending dues at the moment.',
    dueLineHi: balance > 0
      ? `आपकी बकाया राशि ₹${balance} है${dueDate ? `, जिसे ${formatDate(dueDate)} तक जमा करना है` : ''}।`
      : 'आपकी कोई बकाया राशि नहीं है।',
    libraryAddressLine: libraryAddress ? `\nAddress: ${libraryAddress}` : '',
    libraryPhoneLine: libraryPhone ? `\nPhone: ${libraryPhone}` : '',
    libraryAddressLineHi: libraryAddress ? `\nपता: ${libraryAddress}` : '',
    libraryPhoneLineHi: libraryPhone ? `\nफोन: ${libraryPhone}` : '',
  };
}

/** Replaces every {{token}} in `template` with its value from `info`. Unknown tokens are left as-is. */
export function fillTemplate(template, info) {
  const values = fieldValues(info);
  return (template || '').replace(/\{\{(\w+)\}\}/g, (match, token) =>
    Object.prototype.hasOwnProperty.call(values, token) ? values[token] : match
  );
}

/**
 * Builds the WhatsApp/SMS message from the admin's saved template (or the
 * built-in default if none is saved yet). `templates` is the flat
 * {key: value} object GET /settings already returns.
 */
export function buildReminderMessage(info, templates = {}) {
  const template = templates[REMINDER_TEMPLATE_KEYS.whatsapp] || DEFAULT_TEMPLATES[REMINDER_TEMPLATE_KEYS.whatsapp];
  return fillTemplate(template, info);
}

/** Normalizes a raw mobile number to a WhatsApp/SMS-ready "91XXXXXXXXXX" string, or null if missing. */
export function toReminderPhone(mobile) {
  const digits = (mobile || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 ? `91${digits}` : digits;
}

export function openWhatsappReminder(info, templates = {}) {
  const phone = toReminderPhone(info.mobile);
  if (!phone) return false;
  const template = templates[REMINDER_TEMPLATE_KEYS.whatsapp] || DEFAULT_TEMPLATES[REMINDER_TEMPLATE_KEYS.whatsapp];
  const message = fillTemplate(template, info);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

export function openSmsReminder(info, templates = {}) {
  const phone = toReminderPhone(info.mobile);
  if (!phone) return false;
  const template = templates[REMINDER_TEMPLATE_KEYS.sms] || DEFAULT_TEMPLATES[REMINDER_TEMPLATE_KEYS.sms];
  const message = fillTemplate(template, info);
  const separator = /iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?';
  window.location.href = `sms:+${phone}${separator}body=${encodeURIComponent(message)}`;
  return true;
}

export function openEmailReminder(info, templates = {}) {
  if (!info.email) return false;
  const subjectTemplate = templates[REMINDER_TEMPLATE_KEYS.emailSubject] || DEFAULT_TEMPLATES[REMINDER_TEMPLATE_KEYS.emailSubject];
  const bodyTemplate = templates[REMINDER_TEMPLATE_KEYS.emailBody] || DEFAULT_TEMPLATES[REMINDER_TEMPLATE_KEYS.emailBody];
  const subject = fillTemplate(subjectTemplate, info);
  const message = fillTemplate(bodyTemplate, info);
  window.location.href = `mailto:${info.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  return true;
}
