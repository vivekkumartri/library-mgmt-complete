import { describe, test, expect } from 'vitest';
import { formatDate } from '../utils/formatDate';
import { buildReminderMessage, fillTemplate, REMINDER_TEMPLATE_KEYS, DEFAULT_TEMPLATES } from '../utils/reminders';

/**
 * Verbatim copy of the OLD buildReminderMessage (before templates became
 * customizable) — see git history of src/utils/reminders.js prior to the
 * "payment reminder templates" commit. The new default template is
 * supposed to produce byte-identical output to this, so that an admin who
 * never customizes anything gets exactly the message that was already
 * being sent — this test is the guarantee of that, not just an eyeball
 * comparison of two template strings.
 */
function oldBuildReminderMessage(info) {
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

/** 'YYYY-MM-DD' for today, offset by `days` (negative = past). Keeps fixture dates relative to whenever this test actually runs. */
function isoDaysFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Due dates here are always in the future (so the Hindi due line's tense
// — see the dedicated describe() below — stays present/future "है" and
// doesn't interfere with this equivalence check, which predates tense
// awareness and isn't about it).
const scenarios = [
  {
    name: 'balance owed, due date set, full library info',
    info: {
      fullName: 'Rahul Kumar', studentId: 'LIB-2026-0001', joiningDate: '2026-08-01',
      seatLabel: 'Floor 1, Seat 12 (06:00 – 12:00)', lastPaymentText: '₹1000 on 1 August 2026 (Receipt RCPT-2026-0001)',
      balance: 500, dueDate: isoDaysFromToday(10), libraryName: 'Pilaan Library', libraryAddress: '123 MG Road, Pune', libraryPhone: '+91 98765 43210',
    },
  },
  {
    name: 'no pending dues',
    info: {
      fullName: 'Priya Singh', studentId: 'LIB-2026-0002', joiningDate: '2026-01-15',
      seatLabel: 'Floor 2, Seat 5 (12:00 – 18:00)', lastPaymentText: '₹2000 on 1 January 2026 (Receipt RCPT-2026-0002)',
      balance: 0, dueDate: null, libraryName: 'City Library', libraryAddress: '', libraryPhone: '',
    },
  },
  {
    name: 'no library address/phone set at all',
    info: {
      fullName: 'Amit Shah', studentId: 'LIB-2026-0003', joiningDate: '2026-03-10',
      seatLabel: null, lastPaymentText: null,
      balance: 300, dueDate: isoDaysFromToday(20), libraryName: '', libraryAddress: '', libraryPhone: '',
    },
  },
  {
    name: 'no seat allocated, no payment yet, no joining date',
    info: {
      fullName: 'Neha Verma', studentId: 'LIB-2026-0004', joiningDate: null,
      seatLabel: null, lastPaymentText: null,
      balance: 1200, dueDate: isoDaysFromToday(30), libraryName: 'Pilaan Library', libraryAddress: 'MG Road', libraryPhone: '1234567890',
    },
  },
];

describe('default WhatsApp/SMS template produces byte-identical output to the old hardcoded message', () => {
  for (const { name, info } of scenarios) {
    test(name, () => {
      expect(buildReminderMessage(info, {})).toBe(oldBuildReminderMessage(info));
    });
  }
});

describe('default email subject matches the old hardcoded subject, including its different fallback name', () => {
  for (const { name, info } of scenarios) {
    test(name, () => {
      const oldLibName = info.libraryName || 'Library'; // old openEmailReminder's own fallback, distinct from the body's
      const oldSubject = `Payment Reminder from ${oldLibName} / भुगतान रिमाइंडर`;
      const newSubject = fillTemplate(DEFAULT_TEMPLATES[REMINDER_TEMPLATE_KEYS.emailSubject], info);
      expect(newSubject).toBe(oldSubject);
    });
  }

  test('with no library name set at all, falls back to plain "Library" (not "the library")', () => {
    const newSubject = fillTemplate(DEFAULT_TEMPLATES[REMINDER_TEMPLATE_KEYS.emailSubject], { libraryName: '' });
    expect(newSubject).toBe('Payment Reminder from Library / भुगतान रिमाइंडर');
  });
});

describe('Hindi due-line tense agrees with whether the due date is past or future', () => {
  const baseInfo = { fullName: 'Rahul Kumar', studentId: 'LIB-2026-0001', balance: 500 };

  test('a due date still in the future reads in present/future tense ("है")', () => {
    const message = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(10) }, {});
    expect(message).toContain('आपकी बकाया राशि ₹500 है');
    expect(message).toContain('जमा करना है');
    expect(message).not.toContain('थी');
    expect(message).not.toContain('करना था');
  });

  test('a due date today (not yet elapsed) still reads in present tense, not past', () => {
    const message = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(0) }, {});
    expect(message).toContain('आपकी बकाया राशि ₹500 है');
    expect(message).toContain('जमा करना है');
  });

  test('a due date already in the past reads in past tense ("थी"/"था")', () => {
    const message = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(-10) }, {});
    expect(message).toContain('आपकी बकाया राशि ₹500 थी');
    expect(message).toContain('जमा करना था');
    expect(message).not.toContain('बकाया राशि ₹500 है');
  });

  test('zero balance never mentions tense either way — the "no dues" sentence is used instead', () => {
    const message = buildReminderMessage({ ...baseInfo, balance: 0, dueDate: isoDaysFromToday(-10) }, {});
    expect(message).toContain('आपकी कोई बकाया राशि नहीं है');
    expect(message).not.toContain('थी');
  });

  test('the English line is unaffected by tense either way (no grammatical ambiguity to fix there)', () => {
    const future = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(10) }, {});
    const past = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(-10) }, {});
    const dueLine = (msg) => msg.split('\n')[0];
    expect(dueLine(future)).toContain('your due amount is ₹500, due by');
    expect(dueLine(past)).toContain('your due amount is ₹500, due by');
  });
});
