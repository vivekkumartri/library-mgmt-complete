import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Billing from '../pages/Billing';
import '../i18n';

vi.mock('../services/api', () => {
  const get = vi.fn();
  const post = vi.fn();
  return {
    default: { get, post },
    apiErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
  };
});

import api from '../services/api';

const student = { student_id: 'LIB-2026-0001', full_name: 'Rahul Kumar', mobile: '9999999999' };
const billingRow = {
  billing_id: 'b1',
  student_id: 'LIB-2026-0001',
  base_fee: 1000,
  discount: 0,
  late_fee: 0,
  payable: 1000,
  paid: 0,
  status: 'pending',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Billing page', () => {
  test('lists billing records for the selected month with student names resolved', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/billing') return Promise.resolve({ data: { billing: [billingRow] } });
      if (url === `/students/${student.student_id}`) return Promise.resolve({ data: { student } });
      return Promise.resolve({ data: {} });
    });

    render(<Billing />);

    await waitFor(() => expect(screen.getByText('Rahul Kumar')).toBeInTheDocument());
    expect(screen.getByText(/Payable ₹1000/)).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  test('shows an empty state with no billing records for the month', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/billing') return Promise.resolve({ data: { billing: [] } });
      return Promise.resolve({ data: {} });
    });

    render(<Billing />);

    await waitFor(() => expect(screen.getByText(/No billing records for this month/i)).toBeInTheDocument());
  });

  test('creates a new billing record', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/billing') return Promise.resolve({ data: { billing: [] } });
      if (url === '/students') return Promise.resolve({ data: { students: [student] } });
      return Promise.resolve({ data: {} });
    });
    api.post.mockResolvedValueOnce({ data: { billing: { billing_id: 'b2' } } });

    render(<Billing />);
    await waitFor(() => expect(screen.getByText(/No billing records/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText('New billing record'));

    const searchInput = screen.getByPlaceholderText(/Name, ID, or mobile/i);
    await userEvent.type(searchInput, 'Rahul');
    await waitFor(() => screen.getByText(/Rahul Kumar/i));
    fireEvent.click(screen.getByText(/Rahul Kumar/i));

    const [baseFeeInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(baseFeeInput, { target: { value: '1200' } });

    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/billing',
        expect.objectContaining({ studentId: student.student_id, baseFee: 1200 })
      )
    );
  });

  test('records a payment against an existing billing record, then offers the receipt before reloading', async () => {
    let billingList = [billingRow];
    api.get.mockImplementation((url) => {
      if (url === '/billing') return Promise.resolve({ data: { billing: billingList } });
      if (url === `/students/${student.student_id}`) return Promise.resolve({ data: { student } });
      return Promise.resolve({ data: {} });
    });
    api.post.mockResolvedValueOnce({ data: { payment: { payment_id: 'p1', receipt_number: 'RCPT-2026-0001', amount: 1000 } } });

    render(<Billing />);
    await waitFor(() => expect(screen.getByText('Rahul Kumar')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Record payment'));
    expect(screen.getByText(/Remaining: ₹1000/)).toBeInTheDocument();

    const submitButtons = screen.getAllByText('Record payment');
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/payments',
        expect.objectContaining({ studentId: student.student_id, billingId: 'b1', amount: 1000, paymentMethod: 'cash' })
      )
    );

    // Recording the payment doesn't immediately close the drawer — it
    // shows the receipt-ready panel first, so the receipt is one click away.
    await waitFor(() => expect(screen.getByText('Payment recorded')).toBeInTheDocument());
    expect(screen.getByText(/RCPT-2026-0001/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Done'));
    await waitFor(() => expect(screen.queryByText('Payment recorded')).not.toBeInTheDocument());
  });

  test('prefills base fee and discount from the student\'s current fee plan', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/billing') return Promise.resolve({ data: { billing: [] } });
      if (url === '/students') return Promise.resolve({ data: { students: [student] } });
      if (url === `/students/${student.student_id}/fee-plans`) {
        return Promise.resolve({
          data: { history: [], current: { monthly_fee: 1500, discount: 200, effective_from: '2026-08-01' } },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(<Billing />);
    await waitFor(() => expect(screen.getByText(/No billing records/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText('New billing record'));
    const searchInput = screen.getByPlaceholderText(/Name, ID, or mobile/i);
    await userEvent.type(searchInput, 'Rahul');
    await waitFor(() => screen.getByText(/Rahul Kumar/i));
    fireEvent.click(screen.getByText(/Rahul Kumar/i));

    await waitFor(() => expect(screen.getByText(/Prefilled from current fee plan/i)).toBeInTheDocument());
    const [baseFeeInput, discountInput] = screen.getAllByRole('spinbutton');
    expect(baseFeeInput.value).toBe('1500');
    expect(discountInput.value).toBe('200');
  });

  test('records a date-range payment with no billingId, offering the receipt afterward', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/billing') return Promise.resolve({ data: { billing: [] } });
      if (url === '/students') return Promise.resolve({ data: { students: [student] } });
      if (url === `/students/${student.student_id}/payment-status`) {
        return Promise.resolve({ data: { urgency: 'ok', paidThroughDate: null, joinDate: null, monthlyFee: null, paid: 0, owed: 0, balance: 0 } });
      }
      return Promise.resolve({ data: {} });
    });
    api.post.mockResolvedValueOnce({ data: { payment: { payment_id: 'p1', receipt_number: 'RCPT-2026-0002', amount: 750 } } });

    render(<Billing />);
    await waitFor(() => expect(screen.getByText(/No billing records/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText('Record payment (date range)'));

    const searchInput = screen.getByPlaceholderText(/Name, ID, or mobile/i);
    await userEvent.type(searchInput, 'Rahul');
    await waitFor(() => screen.getByText(/Rahul Kumar/i));
    fireEvent.click(screen.getByText(/Rahul Kumar/i));

    // From date / To date are the two date inputs in this drawer.
    const [fromInput, toInput] = document.querySelectorAll('input[type="date"]');
    fireEvent.change(fromInput, { target: { value: '2026-08-01' } });
    fireEvent.change(toInput, { target: { value: '2026-08-15' } });

    const [amountInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(amountInput, { target: { value: '750' } });

    const submitButtons = screen.getAllByText('Record payment');
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/payments',
        expect.objectContaining({
          studentId: student.student_id,
          periodStart: '2026-08-01',
          periodEnd: '2026-08-15',
          amount: 750,
          paymentMethod: 'cash',
        })
      )
    );

    await waitFor(() => expect(screen.getByText('Payment recorded')).toBeInTheDocument());
    expect(screen.getByText(/RCPT-2026-0002/)).toBeInTheDocument();
  });

  test('prefills the range payment "From date" from a student\'s automatic payment status', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/billing') return Promise.resolve({ data: { billing: [] } });
      if (url === '/students') return Promise.resolve({ data: { students: [student] } });
      if (url === `/students/${student.student_id}/payment-status`) {
        return Promise.resolve({
          data: { urgency: 'due_soon', paidThroughDate: '2026-09-01', joinDate: '2026-08-01', monthlyFee: 1000, paid: 1000, owed: 800, balance: 0 },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(<Billing />);
    await waitFor(() => expect(screen.getByText(/No billing records/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText('Record payment (date range)'));
    const searchInput = screen.getByPlaceholderText(/Name, ID, or mobile/i);
    await userEvent.type(searchInput, 'Rahul');
    await waitFor(() => screen.getByText(/Rahul Kumar/i));
    fireEvent.click(screen.getByText(/Rahul Kumar/i));

    await waitFor(() => expect(screen.getByText(/Currently paid through 2026-09-01/)).toBeInTheDocument());
    const [fromInput] = document.querySelectorAll('input[type="date"]');
    // The day after their existing coverage ends, not the join date, since they've already paid once.
    expect(fromInput.value).toBe('2026-09-02');
  });

  test('prefills the range payment "From date" from the joining date for a student with no payments yet', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/billing') return Promise.resolve({ data: { billing: [] } });
      if (url === '/students') return Promise.resolve({ data: { students: [student] } });
      if (url === `/students/${student.student_id}/payment-status`) {
        return Promise.resolve({
          data: { urgency: 'due_today', paidThroughDate: '2026-08-01', joinDate: '2026-08-01', monthlyFee: 1000, paid: 0, owed: 0, balance: 0 },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(<Billing />);
    await waitFor(() => expect(screen.getByText(/No billing records/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText('Record payment (date range)'));
    const searchInput = screen.getByPlaceholderText(/Name, ID, or mobile/i);
    await userEvent.type(searchInput, 'Rahul');
    await waitFor(() => screen.getByText(/Rahul Kumar/i));
    fireEvent.click(screen.getByText(/Rahul Kumar/i));

    await waitFor(() => expect(screen.getByText(/prefilled from their joining date/i)).toBeInTheDocument());
    const [fromInput] = document.querySelectorAll('input[type="date"]');
    expect(fromInput.value).toBe('2026-08-01');
  });

  test('shows a friendly error and allows retry when loading billing fails', async () => {
    api.get.mockRejectedValueOnce({ response: { data: { error: { message: 'Google Sheets unavailable' } } } });

    render(<Billing />);
    await waitFor(() => expect(screen.getByText('Google Sheets unavailable')).toBeInTheDocument());
  });
});
