import { describe, test, expect } from 'vitest';
import { formatDate } from '../utils/formatDate';
import { buildReminderMessage, fillTemplate, REMINDER_TEMPLATE_KEYS, DEFAULT_TEMPLATES } from '../utils/reminders';

/**
 * Verbatim copy of the OLD buildReminderMessage (before templates became
 * customizable, and before pending/paid-up became two separate
 * templates) — see git history of src/utils/reminders.js. The new
 * default templates are supposed to produce byte-identical output to
 * this for an admin who never customizes anything, regardless of which
 * of the two templates (pending vs paid-up) actually gets picked.
 */
function oldBuildReminderMessage(info) {
  const {
    fullName, studentId, joiningDate, seatLabel,
    lastPaymentText, balance, dueDate,
    libraryName, libraryAddress, libraryPhone,
  } = info;

  const isPastDue = dueDate && dueDate.slice(0, 10) < todayIso();
  const overdueDays = isPastDue ? daysBetween(dueDate, todayIso()) : 0;

  const dueLineEn = balance > 0
    ? `your due amount is ₹${balance}${dueDate ? `, due by ${formatDate(dueDate)}` : ''}${isPastDue ? ` (${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue)` : ''}.`
    : 'you have no pending dues at the moment.';
  const dueLineHi = balance > 0
    ? `आपकी बकाया राशि ₹${balance} ${isPastDue ? 'थी' : 'है'}${dueDate ? `, जिसे ${formatDate(dueDate)} तक जमा करना ${isPastDue ? 'था' : 'है'}` : ''}${isPastDue ? ` (${overdueDays} दिन से बकाया)` : ''}।`
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

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromIso, toIso) {
  const [fy, fm, fd] = fromIso.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = toIso.slice(0, 10).split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

/** 'YYYY-MM-DD' for today, offset by `days` (negative = past). Keeps fixture dates relative to whenever this test actually runs. */
function isoDaysFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const pendingScenarios = [
  {
    name: 'balance owed, due date in the future, full library info',
    info: {
      fullName: 'Rahul Kumar', studentId: 'LIB-2026-0001', joiningDate: '2026-08-01',
      seatLabel: 'Floor 1, Seat 12 (06:00 – 12:00)', lastPaymentText: '₹1000 on 1 August 2026 (Receipt RCPT-2026-0001)',
      balance: 500, dueDate: isoDaysFromToday(10), libraryName: 'Pilaan Library', libraryAddress: '123 MG Road, Pune', libraryPhone: '+91 98765 43210',
    },
  },
  {
    name: 'balance owed, due date already in the past (overdue)',
    info: {
      fullName: 'Rahul Kumar', studentId: 'LIB-2026-0001', joiningDate: '2026-08-01',
      seatLabel: 'Floor 1, Seat 12 (06:00 – 12:00)', lastPaymentText: '₹1000 on 1 August 2026 (Receipt RCPT-2026-0001)',
      balance: 500, dueDate: isoDaysFromToday(-12), libraryName: 'Pilaan Library', libraryAddress: '123 MG Road, Pune', libraryPhone: '+91 98765 43210',
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

const paidUpScenarios = [
  {
    name: 'no pending dues',
    info: {
      fullName: 'Priya Singh', studentId: 'LIB-2026-0002', joiningDate: '2026-01-15',
      seatLabel: 'Floor 2, Seat 5 (12:00 – 18:00)', lastPaymentText: '₹2000 on 1 January 2026 (Receipt RCPT-2026-0002)',
      balance: 0, dueDate: null, libraryName: 'City Library', libraryAddress: '', libraryPhone: '',
    },
  },
  {
    name: 'no pending dues, with a stale dueDate still on record from a past cycle',
    info: {
      fullName: 'Priya Singh', studentId: 'LIB-2026-0002', joiningDate: '2026-01-15',
      seatLabel: 'Floor 2, Seat 5 (12:00 – 18:00)', lastPaymentText: '₹2000 on 1 January 2026 (Receipt RCPT-2026-0002)',
      balance: 0, dueDate: isoDaysFromToday(-20), libraryName: 'City Library', libraryAddress: 'MG Road', libraryPhone: '9876543210',
    },
  },
];

describe('default WhatsApp/SMS templates (pending + paid-up) produce byte-identical output to the old hardcoded message', () => {
  for (const { name, info } of pendingScenarios) {
    test(`pending — ${name}`, () => {
      expect(buildReminderMessage(info, {})).toBe(oldBuildReminderMessage(info));
    });
  }
  for (const { name, info } of paidUpScenarios) {
    test(`paid up — ${name}`, () => {
      expect(buildReminderMessage(info, {})).toBe(oldBuildReminderMessage(info));
    });
  }
});

describe('default email subject matches the old hardcoded subject, including its different fallback name', () => {
  for (const { name, info } of [...pendingScenarios, ...paidUpScenarios]) {
    test(name, () => {
      const oldLibName = info.libraryName || 'Library';
      const oldSubject = `Payment Reminder from ${oldLibName} / भुगतान रिमाइंडर`;
      const key = info.balance > 0 ? REMINDER_TEMPLATE_KEYS.emailSubjectPending : REMINDER_TEMPLATE_KEYS.emailSubjectPaidUp;
      const newSubject = fillTemplate(DEFAULT_TEMPLATES[key], info);
      expect(newSubject).toBe(oldSubject);
    });
  }

  test('with no library name set at all, falls back to plain "Library" (not "the library")', () => {
    const newSubject = fillTemplate(DEFAULT_TEMPLATES[REMINDER_TEMPLATE_KEYS.emailSubjectPending], { libraryName: '' });
    expect(newSubject).toBe('Payment Reminder from Library / भुगतान रिमाइंडर');
  });
});

describe('the pending vs paid-up template is picked correctly by balance', () => {
  test('balance > 0 always uses the pending template, even with other falsy/odd values present', () => {
    const templates = {
      [REMINDER_TEMPLATE_KEYS.whatsappPending]: 'PENDING for {{studentName}}',
      [REMINDER_TEMPLATE_KEYS.whatsappPaidUp]: 'PAID UP for {{studentName}}',
    };
    expect(buildReminderMessage({ fullName: 'A', balance: 1 }, templates)).toBe('PENDING for A');
    expect(buildReminderMessage({ fullName: 'A', balance: 0 }, templates)).toBe('PAID UP for A');
    expect(buildReminderMessage({ fullName: 'A', balance: -5 }, templates)).toBe('PAID UP for A');
    expect(buildReminderMessage({ fullName: 'A' }, templates)).toBe('PAID UP for A'); // balance undefined
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

  test('a due date already in the past reads in past tense ("था")', () => {
    const message = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(-10) }, {});
    expect(message).toContain('आपकी बकाया राशि ₹500 थी');
    expect(message).toContain('जमा करना था');
    expect(message).not.toContain('बकाया राशि ₹500 है');
  });

  test('the English due line keeps "is" regardless of tense (no ambiguity to fix there) but gains an "(N days overdue)" suffix once overdue', () => {
    const future = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(10) }, {});
    const past = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(-10) }, {});
    const dueLine = (msg) => msg.split('\n')[0];
    expect(dueLine(future)).toContain('your due amount is ₹500, due by');
    expect(dueLine(future)).not.toContain('overdue');
    expect(dueLine(past)).toContain('your due amount is ₹500, due by');
    expect(dueLine(past)).toContain('overdue');
  });
});

describe('number of days overdue is included once a payment is actually overdue', () => {
  const baseInfo = { fullName: 'Rahul Kumar', studentId: 'LIB-2026-0001', balance: 500 };

  test('not yet due (future date) — no "overdue" wording', () => {
    const message = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(10) }, {});
    expect(message).not.toContain('overdue');
    expect(message).not.toContain('दिन से बकाया');
  });

  test('due today — not counted as overdue yet', () => {
    const message = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(0) }, {});
    expect(message).not.toContain('overdue');
  });

  test('10 days overdue — English says "10 days overdue", Hindi says "10 दिन से बकाया"', () => {
    const message = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(-10) }, {});
    expect(message).toContain('(10 days overdue)');
    expect(message).toContain('(10 दिन से बकाया)');
  });

  test('exactly 1 day overdue uses the singular "1 day overdue", not "1 days overdue"', () => {
    const message = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(-1) }, {});
    expect(message).toContain('(1 day overdue)');
    expect(message).not.toContain('1 days overdue');
  });

  test('zero balance (paid-up template) never mentions days overdue, even with a long-past dueDate on file', () => {
    const message = buildReminderMessage({ ...baseInfo, balance: 0, dueDate: isoDaysFromToday(-30) }, {});
    expect(message).not.toContain('overdue');
    expect(message).not.toContain('दिन से बकाया');
  });

  test('the {{daysOverdue}} token itself is directly insertable via a custom template', () => {
    const templates = { [REMINDER_TEMPLATE_KEYS.whatsappPending]: '{{daysOverdue}} days overdue for {{studentName}}' };
    const overdue = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(-7) }, templates);
    expect(overdue).toBe('7 days overdue for Rahul Kumar');
  });
});

describe('due-status sub-fields are individually insertable so a custom template can rebuild the sentence', () => {
  const baseInfo = { fullName: 'Rahul Kumar', studentId: 'LIB-2026-0001', balance: 500 };
  const customTemplates = {
    [REMINDER_TEMPLATE_KEYS.whatsappPending]: '{{studentName}} owes {{dueAmount}} ({{dueVerb}} due {{dueDate}}){{overdueSuffix}}',
  };
  const customTemplatesHi = {
    [REMINDER_TEMPLATE_KEYS.whatsappPending]: '{{studentName}} {{dueVerbHi}} बकाया{{overdueSuffixHi}}',
  };

  test('{{dueVerb}} is "is" for a future/today due date and "was" once overdue', () => {
    expect(buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(5) }, customTemplates))
      .toBe(`Rahul Kumar owes 500 (is due ${formatDate(isoDaysFromToday(5))})`);
    expect(buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(0) }, customTemplates))
      .toContain('(is due');
    expect(buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(-5) }, customTemplates))
      .toContain('(was due');
  });

  test('{{dueVerbHi}} is "है" for a future/today due date and "था" once overdue', () => {
    expect(buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(5) }, customTemplatesHi))
      .toContain('है बकाया');
    expect(buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(-5) }, customTemplatesHi))
      .toContain('था बकाया');
  });

  test('{{overdueSuffix}}/{{overdueSuffixHi}} are blank unless actually overdue', () => {
    const notYetDue = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(5) }, customTemplates);
    expect(notYetDue).not.toContain('overdue');
    const overdue = buildReminderMessage({ ...baseInfo, dueDate: isoDaysFromToday(-5) }, customTemplates);
    expect(overdue).toContain('(5 days overdue)');
  });

  test('a paid-up template can say whatever the admin wants, with no awkward "₹0" wording forced on them', () => {
    const templates = {
      [REMINDER_TEMPLATE_KEYS.whatsappPaidUp]: 'Thanks for staying paid up, {{studentName}}!',
    };
    const message = buildReminderMessage({ ...baseInfo, balance: 0 }, templates);
    expect(message).toBe('Thanks for staying paid up, Rahul Kumar!');
    expect(message).not.toContain('₹0');
  });
});
