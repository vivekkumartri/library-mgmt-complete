import { formatDate } from './formatDate';

/**
 * Payment reminder templates — admin-customizable free text with
 * {{placeholder}} tokens, edited in Settings (ReminderTemplatesSettings)
 * and stored under these Settings-sheet keys. FIELD_DEFS is the single
 * source of truth both for what Settings' "+ Add field" picker offers and
 * for what fillTemplate() actually substitutes, so a token can never be
 * typo'd into existence — it only ever gets there via the picker.
 *
 * Each channel has two separate templates — "pending" (balance > 0) and
 * "paidUp" (balance === 0) — picked at send time by balance, rather than
 * one template with a single computed sentence that silently branches
 * inside JS. A plain {{token}} substitution can't express "say X if
 * balance > 0, otherwise say Y" on its own, so forcing that into one
 * template either means keeping an opaque pre-computed sentence (not
 * really editable) or admins seeing "due ₹0" nonsense once paid up —
 * two full templates lets the admin write genuinely different wording
 * for each case.
 */
export const REMINDER_TEMPLATE_KEYS = {
  whatsappPending: 'reminder_template_whatsapp_pending',
  whatsappPaidUp: 'reminder_template_whatsapp_paidup',
  smsPending: 'reminder_template_sms_pending',
  smsPaidUp: 'reminder_template_sms_paidup',
  emailSubjectPending: 'reminder_template_email_subject_pending',
  emailSubjectPaidUp: 'reminder_template_email_subject_paidup',
  emailBodyPending: 'reminder_template_email_body_pending',
  emailBodyPaidUp: 'reminder_template_email_body_paidup',
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
  { token: 'daysOverdue', label: 'Days overdue (0 if not overdue)' },
  { token: 'dueVerb', label: 'Due status — "is"/"was" (English)' },
  { token: 'dueVerbHi', label: 'Due status — "है"/"था" (Hindi, used with जमा करना)' },
  { token: 'dueVerbHiFem', label: 'Due status — "है"/"थी" (Hindi, used with राशि)' },
  { token: 'overdueSuffix', label: 'Due status — "(N days overdue)" suffix (English, blank if not overdue)' },
  { token: 'overdueSuffixHi', label: 'Due status — "(N दिन से बकाया)" suffix (Hindi, blank if not overdue)' },
  { token: 'libraryName', label: 'Library name' },
  { token: 'libraryAddress', label: 'Library address' },
  { token: 'libraryPhone', label: 'Library phone' },
  { token: 'libraryAddressLine', label: 'Library address line (English, blank if not set)' },
  { token: 'libraryAddressLineHi', label: 'Library address line (Hindi, blank if not set)' },
  { token: 'libraryPhoneLine', label: 'Library phone line (English, blank if not set)' },
  { token: 'libraryPhoneLineHi', label: 'Library phone line (Hindi, blank if not set)' },
  { token: 'seatHi', label: 'Seat (Hindi fallback wording)' },
  { token: 'lastPaymentHi', label: 'Last payment (Hindi fallback wording)' },
  { token: 'libraryNameSubject', label: 'Library name (email subject fallback wording)' },
];

// Defaults reproduce the exact message every reminder sent before
// templates became customizable and per-status — an admin who never
// touches Settings must see the same wording as before, just now sourced
// from two templates (picked by balance) instead of one with a baked-in
// conditional. See reminders.defaultEquivalence.test.js.
const DEFAULT_WHATSAPP_SMS_PENDING = `Hi {{studentName}}, this is a reminder from {{libraryName}} — your due amount is ₹{{dueAmount}}, due by {{dueDate}}{{overdueSuffix}}.

Student ID: {{studentId}}
Joining date: {{joiningDate}}
Seat: {{seat}}
Last payment: {{lastPayment}}
{{libraryName}}{{libraryAddressLine}}{{libraryPhoneLine}}

Please clear your dues at your earliest convenience. Thank you!

---

नमस्ते {{studentName}}, यह {{libraryName}} की तरफ से एक रिमाइंडर है — आपकी बकाया राशि ₹{{dueAmount}} {{dueVerbHiFem}}, जिसे {{dueDate}} तक जमा करना {{dueVerbHi}}{{overdueSuffixHi}}।

स्टूडेंट आईडी: {{studentId}}
जॉइनिंग तिथि: {{joiningDate}}
सीट: {{seatHi}}
पिछला भुगतान: {{lastPaymentHi}}
{{libraryName}}{{libraryAddressLineHi}}{{libraryPhoneLineHi}}

कृपया जल्द से जल्द अपना भुगतान करें। धन्यवाद!`;

const DEFAULT_WHATSAPP_SMS_PAIDUP = `Hi {{studentName}}, this is a reminder from {{libraryName}} — you have no pending dues at the moment.

Student ID: {{studentId}}
Joining date: {{joiningDate}}
Seat: {{seat}}
Last payment: {{lastPayment}}
{{libraryName}}{{libraryAddressLine}}{{libraryPhoneLine}}

Please clear your dues at your earliest convenience. Thank you!

---

नमस्ते {{studentName}}, यह {{libraryName}} की तरफ से एक रिमाइंडर है — आपकी कोई बकाया राशि नहीं है।

स्टूडेंट आईडी: {{studentId}}
जॉइनिंग तिथि: {{joiningDate}}
सीट: {{seatHi}}
पिछला भुगतान: {{lastPaymentHi}}
{{libraryName}}{{libraryAddressLineHi}}{{libraryPhoneLineHi}}

कृपया जल्द से जल्द अपना भुगतान करें। धन्यवाद!`;

// Old openEmailReminder used a different fallback ('Library') here than
// the message body's libName ('the library') — preserved via its own
// token rather than silently unifying the two and changing behavior for
// a library with no name set in Settings. Subject text itself never
// varied by due status before, so both variants start out identical;
// admins can still diverge them since they're now separately editable.
const DEFAULT_EMAIL_SUBJECT = 'Payment Reminder from {{libraryNameSubject}} / भुगतान रिमाइंडर';

export const DEFAULT_TEMPLATES = {
  [REMINDER_TEMPLATE_KEYS.whatsappPending]: DEFAULT_WHATSAPP_SMS_PENDING,
  [REMINDER_TEMPLATE_KEYS.whatsappPaidUp]: DEFAULT_WHATSAPP_SMS_PAIDUP,
  [REMINDER_TEMPLATE_KEYS.smsPending]: DEFAULT_WHATSAPP_SMS_PENDING,
  [REMINDER_TEMPLATE_KEYS.smsPaidUp]: DEFAULT_WHATSAPP_SMS_PAIDUP,
  [REMINDER_TEMPLATE_KEYS.emailSubjectPending]: DEFAULT_EMAIL_SUBJECT,
  [REMINDER_TEMPLATE_KEYS.emailSubjectPaidUp]: DEFAULT_EMAIL_SUBJECT,
  [REMINDER_TEMPLATE_KEYS.emailBodyPending]: DEFAULT_WHATSAPP_SMS_PENDING,
  [REMINDER_TEMPLATE_KEYS.emailBodyPaidUp]: DEFAULT_WHATSAPP_SMS_PAIDUP,
};

/**
 * True if `dueDate` (an ISO "YYYY-MM-DD" string) is strictly before
 * today's calendar date — "due today" is not past due. Compares dates
 * only, never times, so this reads the same regardless of what time of
 * day the reminder happens to be sent.
 */
function isPastDue(dueDate) {
  if (!dueDate) return false;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return dueDate.slice(0, 10) < todayStr;
}

/**
 * Whole calendar days between `dueDate` and today, or 0 if not overdue
 * (dueDate missing, or today/future). Both dates are read as UTC
 * midnight so this isn't off by one depending on the caller's local
 * timezone relative to the plain "YYYY-MM-DD" dueDate string.
 */
function daysOverdue(dueDate) {
  if (!isPastDue(dueDate)) return 0;
  const [y, m, d] = dueDate.slice(0, 10).split('-').map(Number);
  const due = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - due) / (1000 * 60 * 60 * 24));
}

/** Builds the {{token}} -> display-string map from an `info` object (see callers for its shape). */
function fieldValues(info) {
  const {
    fullName, studentId, mobile, email, joiningDate, seatLabel,
    lastPaymentText, balance, dueDate, libraryName, libraryAddress, libraryPhone,
  } = info;
  const overdue = isPastDue(dueDate);
  const overdueDays = daysOverdue(dueDate);
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
    daysOverdue: String(overdueDays),
    libraryName: libraryName || 'the library',
    libraryNameSubject: libraryName || 'Library',
    libraryAddress: libraryAddress || '',
    libraryPhone: libraryPhone || '',
    // Hindi needs tense agreement that English doesn't: a due date already
    // in the past reads naturally as "था" (was due), not "है" (is due).
    dueVerb: overdue ? 'was' : 'is',
    dueVerbHi: overdue ? 'था' : 'है',
    dueVerbHiFem: overdue ? 'थी' : 'है',
    overdueSuffix: overdue ? ` (${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue)` : '',
    overdueSuffixHi: overdue ? ` (${overdueDays} दिन से बकाया)` : '',
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

function pickKey(info, pendingKey, paidUpKey) {
  return info.balance > 0 ? pendingKey : paidUpKey;
}

/**
 * Builds the WhatsApp/SMS message from the admin's saved template for
 * this student's current due status (or the matching built-in default
 * if nothing's saved yet). `templates` is the flat {key: value} object
 * GET /settings already returns.
 */
export function buildReminderMessage(info, templates = {}) {
  const key = pickKey(info, REMINDER_TEMPLATE_KEYS.whatsappPending, REMINDER_TEMPLATE_KEYS.whatsappPaidUp);
  const template = templates[key] || DEFAULT_TEMPLATES[key];
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
  const key = pickKey(info, REMINDER_TEMPLATE_KEYS.whatsappPending, REMINDER_TEMPLATE_KEYS.whatsappPaidUp);
  const message = fillTemplate(templates[key] || DEFAULT_TEMPLATES[key], info);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

export function openSmsReminder(info, templates = {}) {
  const phone = toReminderPhone(info.mobile);
  if (!phone) return false;
  const key = pickKey(info, REMINDER_TEMPLATE_KEYS.smsPending, REMINDER_TEMPLATE_KEYS.smsPaidUp);
  const message = fillTemplate(templates[key] || DEFAULT_TEMPLATES[key], info);
  const separator = /iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?';
  window.location.href = `sms:+${phone}${separator}body=${encodeURIComponent(message)}`;
  return true;
}

export function openEmailReminder(info, templates = {}) {
  if (!info.email) return false;
  const subjectKey = pickKey(info, REMINDER_TEMPLATE_KEYS.emailSubjectPending, REMINDER_TEMPLATE_KEYS.emailSubjectPaidUp);
  const bodyKey = pickKey(info, REMINDER_TEMPLATE_KEYS.emailBodyPending, REMINDER_TEMPLATE_KEYS.emailBodyPaidUp);
  const subject = fillTemplate(templates[subjectKey] || DEFAULT_TEMPLATES[subjectKey], info);
  const message = fillTemplate(templates[bodyKey] || DEFAULT_TEMPLATES[bodyKey], info);
  window.location.href = `mailto:${info.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  return true;
}
