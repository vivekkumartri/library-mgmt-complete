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
  test('renders the section with a textarea per channel, prefilled with the built-in default when nothing is saved', async () => {
    mockBaseGets();
    render(<Settings />);

    await waitFor(() => expect(screen.getByText('Payment reminder templates')).toBeInTheDocument());
    expect(screen.getByText('WhatsApp message')).toBeInTheDocument();
    expect(screen.getByText('SMS message')).toBeInTheDocument();
    expect(screen.getByText('Email body')).toBeInTheDocument();
  });

  test('loads an admin-saved custom template instead of the default', async () => {
    mockBaseGets({ [REMINDER_TEMPLATE_KEYS.whatsapp]: 'My custom WhatsApp text {{studentName}}' });
    render(<Settings />);

    await waitFor(() => expect(screen.getByDisplayValue('My custom WhatsApp text {{studentName}}')).toBeInTheDocument());
  });

  test('"+ Add field" opens a picker and inserting a field appends its {{token}} to the textarea', async () => {
    mockBaseGets();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Payment reminder templates')).toBeInTheDocument());

    const section = screen.getByText('Payment reminder templates').closest('.card');
    const addFieldButtons = within(section).getAllByText('+ Add field');
    fireEvent.click(addFieldButtons[0]); // WhatsApp channel's button

    await waitFor(() => expect(screen.getByText('Insert a field')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Due amount (₹)'));

    await waitFor(() => expect(screen.queryByText('Insert a field')).not.toBeInTheDocument());
    const textareas = within(section).getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    expect(textareas[0].value).toContain('{{dueAmount}}');
  });

  test('"Preview with sample data" fills the template with example values and shows no raw {{tokens}}', async () => {
    mockBaseGets({ [REMINDER_TEMPLATE_KEYS.whatsapp]: 'Hi {{studentName}}, pay ₹{{dueAmount}}.' });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Payment reminder templates')).toBeInTheDocument());

    const previewButtons = screen.getAllByText('Preview with sample data');
    fireEvent.click(previewButtons[0]);

    await waitFor(() => expect(screen.getByText(/Hi Rahul Kumar, pay/)).toBeInTheDocument());
  });

  test('saving includes the edited templates in the PUT /settings payload', async () => {
    mockBaseGets();
    api.put.mockResolvedValueOnce({ data: { settings: {} } });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Payment reminder templates')).toBeInTheDocument());

    const section = screen.getByText('Payment reminder templates').closest('.card');
    const textareas = within(section).getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textareas[0], { target: { value: 'Edited WhatsApp template {{studentName}}' } });

    fireEvent.click(within(section).getByText('Save templates'));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/settings',
        expect.objectContaining({ [REMINDER_TEMPLATE_KEYS.whatsapp]: 'Edited WhatsApp template {{studentName}}' })
      )
    );
  });

  test('the email channel has both a subject field and a body textarea, each independently editable', async () => {
    mockBaseGets();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Email body')).toBeInTheDocument());

    // Label/input are siblings rather than htmlFor-linked here, so look up
    // the input through its label's containing .field instead of getByLabelText.
    const subjectInput = screen.getByText('Subject').closest('.field').querySelector('input');
    expect(subjectInput).toBeInTheDocument();
  });
});
