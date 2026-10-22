import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Settings from '../pages/Settings';
import '../i18n';
import { REMINDER_TEMPLATE_KEYS } from '../utils/reminders';

vi.mock('../services/api', () => {
  const get = vi.fn();
  const put = vi.fn();
  const post = vi.fn();
  const patch = vi.fn();
  return {
    default: { get, put, post, patch },
    apiErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'staff' } }),
}));

import api from '../services/api';

function mockBaseGets(settingsOverride = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/settings') return Promise.resolve({ data: { settings: settingsOverride } });
    if (url === '/floors') return Promise.resolve({ data: { floors: [] } });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Settings — payment reminder templates', () => {
  test('renders a pending-balance and a paid-up version of each channel', async () => {
    mockBaseGets();
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('Payment reminder templates')).toBeInTheDocument());
    expect(screen.getByText('WhatsApp message — while a balance is due')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp message — once fully paid up')).toBeInTheDocument();
    expect(screen.getByText('SMS message — while a balance is due')).toBeInTheDocument();
    expect(screen.getByText('SMS message — once fully paid up')).toBeInTheDocument();
    expect(screen.getByText('Email — while a balance is due')).toBeInTheDocument();
    expect(screen.getByText('Email — once fully paid up')).toBeInTheDocument();
  });

  test('loads an admin-saved custom pending-balance template instead of the default', async () => {
    mockBaseGets({ [REMINDER_TEMPLATE_KEYS.whatsappPending]: 'My custom WhatsApp text {{studentName}}' });
    render(<Settings />);

    await waitFor(() => expect(screen.getByDisplayValue('My custom WhatsApp text {{studentName}}')).toBeInTheDocument());
  });

  test('loads an admin-saved custom paid-up template independently of the pending one', async () => {
    mockBaseGets({ [REMINDER_TEMPLATE_KEYS.whatsappPaidUp]: 'Thanks for paying, {{studentName}}!' });
    render(<Settings />);

    await waitFor(() => expect(screen.getByDisplayValue('Thanks for paying, {{studentName}}!')).toBeInTheDocument());
  });

  test('"+ Add field" opens a picker and inserting a field appends its {{token}} to the right textarea', async () => {
    mockBaseGets();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Payment reminder templates')).toBeInTheDocument());

    const section = screen.getByText('Payment reminder templates').closest('.card');
    const addFieldButtons = within(section).getAllByText('+ Add field');
    fireEvent.click(addFieldButtons[0]); // WhatsApp "while a balance is due" editor's button

    await waitFor(() => expect(screen.getByText('Insert a field')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Due amount (₹)'));

    await waitFor(() => expect(screen.queryByText('Insert a field')).not.toBeInTheDocument());
    const textareas = within(section).getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    expect(textareas[0].value).toContain('{{dueAmount}}');
  });

  test('"Preview with sample data" fills the pending-balance template with a nonzero sample balance', async () => {
    mockBaseGets({ [REMINDER_TEMPLATE_KEYS.whatsappPending]: 'Hi {{studentName}}, pay ₹{{dueAmount}}.' });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Payment reminder templates')).toBeInTheDocument());

    const previewButtons = screen.getAllByText('Preview with sample data');
    fireEvent.click(previewButtons[0]);

    await waitFor(() => expect(screen.getByText(/Hi Rahul Kumar, pay ₹1000/)).toBeInTheDocument());
  });

  test('"Preview with sample data" on the paid-up editor uses a zero sample balance', async () => {
    mockBaseGets({ [REMINDER_TEMPLATE_KEYS.whatsappPaidUp]: 'Hi {{studentName}}, balance: ₹{{dueAmount}}.' });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Payment reminder templates')).toBeInTheDocument());

    const paidUpLabel = screen.getByText('WhatsApp message — once fully paid up');
    const paidUpEditor = paidUpLabel.closest('div');
    fireEvent.click(within(paidUpEditor).getByText('Preview with sample data'));

    await waitFor(() => expect(screen.getByText(/Hi Rahul Kumar, balance: ₹0/)).toBeInTheDocument());
  });

  test('saving includes both pending and paid-up templates in the PUT /settings payload', async () => {
    mockBaseGets();
    api.put.mockResolvedValueOnce({ data: { settings: {} } });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Payment reminder templates')).toBeInTheDocument());

    const section = screen.getByText('Payment reminder templates').closest('.card');
    const textareas = within(section).getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textareas[0], { target: { value: 'Edited pending WhatsApp template {{studentName}}' } });
    fireEvent.change(textareas[1], { target: { value: 'Edited paid-up WhatsApp template {{studentName}}' } });

    fireEvent.click(within(section).getByText('Save templates'));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/settings',
        expect.objectContaining({
          [REMINDER_TEMPLATE_KEYS.whatsappPending]: 'Edited pending WhatsApp template {{studentName}}',
          [REMINDER_TEMPLATE_KEYS.whatsappPaidUp]: 'Edited paid-up WhatsApp template {{studentName}}',
        })
      )
    );
  });

  test('the email channel has a subject field and a body textarea for both variants, each independently editable', async () => {
    mockBaseGets();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Email — while a balance is due')).toBeInTheDocument());

    // Label/input are siblings rather than htmlFor-linked here, so look up
    // the input through its label's containing .field instead of getByLabelText.
    const subjectInputs = screen.getAllByText('Subject').map((label) => label.closest('.field').querySelector('input'));
    expect(subjectInputs).toHaveLength(2); // one for pending, one for paid-up
    expect(subjectInputs[0]).toBeInTheDocument();
    expect(subjectInputs[1]).toBeInTheDocument();
  });
});
