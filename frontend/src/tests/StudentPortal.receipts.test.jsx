import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../i18n';
import { StudentFees } from '../pages/StudentPortal';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'LIB-2026-0001', name: 'Rahul Kumar' } }),
}));

vi.mock('../services/api', () => {
  const get = vi.fn();
  const openReceipt = vi.fn();
  return {
    default: { get },
    apiErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
    openReceipt,
  };
});

import api, { openReceipt } from '../services/api';

const billingRow = { billing_id: 'b1', billing_month: '2026-08', payable: 1000, paid: 1000, status: 'paid' };
const paymentRow = { payment_id: 'p1', receipt_number: 'RCPT-2026-0001', payment_date: '2026-08-05', amount: 1000, payment_method: 'cash' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StudentFees — receipt download', () => {
  test('clicking "View PDF" fetches the receipt through the authenticated api client, not a plain link', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/billing') return Promise.resolve({ data: { billing: [billingRow] } });
      if (url === '/payments') return Promise.resolve({ data: { payments: [paymentRow] } });
      return Promise.resolve({ data: {} });
    });
    openReceipt.mockResolvedValueOnce();

    render(<StudentFees />);
    await waitFor(() => expect(screen.getByText('RCPT-2026-0001')).toBeInTheDocument());

    // There must be no plain <a href="...receipt.pdf"> — that's exactly
    // what caused UNAUTHENTICATED, since a top-level navigation never
    // carries the Authorization header.
    expect(document.querySelector('a[href*="receipt.pdf"]')).toBeNull();

    fireEvent.click(screen.getByText('View PDF'));
    await waitFor(() => expect(openReceipt).toHaveBeenCalledWith('p1', 'RCPT-2026-0001.pdf'));
  });

  test('shows a friendly error if the receipt fails to open', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/billing') return Promise.resolve({ data: { billing: [billingRow] } });
      if (url === '/payments') return Promise.resolve({ data: { payments: [paymentRow] } });
      return Promise.resolve({ data: {} });
    });
    openReceipt.mockRejectedValueOnce({ response: { data: { error: { message: 'Authentication required.' } } } });

    render(<StudentFees />);
    await waitFor(() => expect(screen.getByText('RCPT-2026-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByText('View PDF'));
    await waitFor(() => expect(screen.getByText('Authentication required.')).toBeInTheDocument());
  });
});
