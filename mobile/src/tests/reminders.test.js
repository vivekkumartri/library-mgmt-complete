import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  fillTemplate, buildReminderMessage, openWhatsappReminder, openSmsReminder, openEmailReminder,
  REMINDER_TEMPLATE_KEYS, DEFAULT_TEMPLATES, FIELD_DEFS,
} from '../utils/reminders';

const info = {
  fullName: 'Rahul Kumar',
  studentId: 'LIB-2026-0001',
  mobile: '9999999999',
  email: 'rahul@example.com',
  joiningDate: '2026-08-01',
  seatLabel: 'Floor 1, Seat 12 (06:00 – 12:00)',
  lastPaymentText: '₹1000 on 1 August 2026 (Receipt RCPT-2026-0001)',
  balance: 500,
  dueDate: '2026-09-01',
  libraryName: 'Pilaan Library',
  libraryAddress: '123 MG Road, Pune',
  libraryPhone: '+91 98765 43210',
};

describe('fillTemplate', () => {
  test('substitutes every known {{token}} with its value', () => {
    const result = fillTemplate('Hi {{studentName}}, you owe ₹{{dueAmount}} (student {{studentId}}).', info);
    expect(result).toBe('Hi Rahul Kumar, you owe ₹500 (student LIB-2026-0001).');
  });

  test('leaves an unknown token untouched rather than silently dropping it', () => {
    const result = fillTemplate('Hello {{notARealField}}!', info);
    expect(result).toBe('Hello {{notARealField}}!');
  });

  test('falls back to a placeholder dash for missing optional fields', () => {
    const result = fillTemplate('Joined: {{joiningDate}}', { ...info, joiningDate: null });
    expect(result).toBe('Joined: —');
  });

  test('every field in FIELD_DEFS is actually substitutable', () => {
    const template = FIELD_DEFS.map((f) => `{{${f.token}}}`).join('|');
    const result = fillTemplate(template, info);
    expect(result).not.toContain('{{');
  });

  test('handles an empty/undefined template without throwing', () => {
    expect(fillTemplate(undefined, info)).toBe('');
    expect(fillTemplate('', info)).toBe('');
  });
});

describe('buildReminderMessage', () => {
  test('uses the default template when no custom one is saved', () => {
    const message = buildReminderMessage(info, {});
    expect(message).toContain('Rahul Kumar');
    expect(message).toContain('LIB-2026-0001');
    expect(message).not.toContain('{{');
  });

  test('uses the admin-saved WhatsApp template when present', () => {
    const templates = { [REMINDER_TEMPLATE_KEYS.whatsapp]: 'Yo {{studentName}}, pay up: ₹{{dueAmount}}' };
    const message = buildReminderMessage(info, templates);
    expect(message).toBe('Yo Rahul Kumar, pay up: ₹500');
  });
});

describe('openWhatsappReminder', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockImplementation(() => {});
  });

  test('returns false and never opens anything when there is no mobile number', () => {
    const result = openWhatsappReminder({ ...info, mobile: '' }, {});
    expect(result).toBe(false);
    expect(window.open).not.toHaveBeenCalled();
  });

  test('uses the custom saved template, not the built-in default', () => {
    const templates = { [REMINDER_TEMPLATE_KEYS.whatsapp]: 'Custom: {{studentName}} owes {{dueAmount}}' };
    openWhatsappReminder(info, templates);
    const url = window.open.mock.calls[0][0];
    expect(decodeURIComponent(url)).toContain('Custom: Rahul Kumar owes 500');
  });
});

describe('openSmsReminder', () => {
  test('uses the SMS-specific template, independent of the WhatsApp one', () => {
    const originalLocation = window.location;
    delete window.location;
    window.location = { href: '' };
    const templates = {
      [REMINDER_TEMPLATE_KEYS.whatsapp]: 'WHATSAPP VERSION {{studentName}}',
      [REMINDER_TEMPLATE_KEYS.sms]: 'SMS VERSION {{studentName}}',
    };
    openSmsReminder(info, templates);
    const url = decodeURIComponent(window.location.href);
    expect(url).toContain('SMS VERSION Rahul Kumar');
    expect(url).not.toContain('WHATSAPP VERSION');
    window.location = originalLocation;
  });
});

describe('openEmailReminder', () => {
  test('fills both the subject and body templates independently', () => {
    const originalLocation = window.location;
    delete window.location;
    window.location = { href: '' };
    const templates = {
      [REMINDER_TEMPLATE_KEYS.emailSubject]: 'Reminder for {{studentName}}',
      [REMINDER_TEMPLATE_KEYS.emailBody]: 'Dear {{studentName}}, you owe {{dueAmount}}.',
    };
    openEmailReminder(info, templates);
    const url = decodeURIComponent(window.location.href);
    expect(url).toContain('subject=Reminder for Rahul Kumar');
    expect(url).toContain('Dear Rahul Kumar, you owe 500.');
    window.location = originalLocation;
  });

  test('returns false when the student has no email', () => {
    const result = openEmailReminder({ ...info, email: '' }, {});
    expect(result).toBe(false);
  });
});

describe('DEFAULT_TEMPLATES', () => {
  test('every default template only references fields that actually exist in FIELD_DEFS', () => {
    const knownTokens = new Set(FIELD_DEFS.map((f) => f.token));
    for (const template of Object.values(DEFAULT_TEMPLATES)) {
      const used = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      for (const token of used) {
        expect(knownTokens.has(token)).toBe(true);
      }
    }
  });
});
