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

const scenarios = [
  {
    name: 'balance owed, due date set, full library info',
    info: {
      fullName: 'Rahul Kumar', studentId: 'LIB-2026-0001', joiningDate: '2026-08-01',
      seatLabel: 'Floor 1, Seat 12 (06:00 – 12:00)', lastPaymentText: '₹1000 on 1 August 2026 (Receipt RCPT-2026-0001)',
      balance: 500, dueDate: '2026-09-01', libraryName: 'Pilaan Library', libraryAddress: '123 MG Road, Pune', libraryPhone: '+91 98765 43210',
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
      balance: 300, dueDate: '2026-04-01', libraryName: '', libraryAddress: '', libraryPhone: '',
    },
  },
  {
    name: 'no seat allocated, no payment yet, no joining date',
    info: {
      fullName: 'Neha Verma', studentId: 'LIB-2026-0004', joiningDate: null,
      seatLabel: null, lastPaymentText: null,
      balance: 1200, dueDate: '2026-05-15', libraryName: 'Pilaan Library', libraryAddress: 'MG Road', libraryPhone: '1234567890',
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
