import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Reports from '../pages/Reports';
import '../i18n';

vi.mock('../services/api', () => {
  const get = vi.fn();
  const post = vi.fn();
  const patch = vi.fn();
  return {
    default: { get, post, patch },
    apiErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
  };
});

vi.mock('../utils/exportTable', () => ({
  exportCsv: vi.fn(),
  exportXlsx: vi.fn(),
}));

import api from '../services/api';
import { exportCsv } from '../utils/exportTable';

const financial = { month: '2026-08', expectedFees: 1000, collected: 900, pendingFees: 100, overdueFees: 0, totalExpenses: 200, netIncome: 700 };
const operational = { activeStudents: 5, pastStudents: 1, vacantSeats: 3, disabledSeats: 1, totalSeats: 10, seatUtilizationPercent: 70 };

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url === '/reports/financial') return Promise.resolve({ data: financial });
    if (url === '/reports/operational') return Promise.resolve({ data: operational });
    if (url === '/reports/students') return Promise.resolve({ data: { counts: { active: 1, past: 0, new: 1, leaving: 0 }, active: [], past: [], newThisMonth: [], leavingThisMonth: [] } });
    if (url === '/reports/seats') return Promise.resolve({ data: { byFloor: [], conflicts: [] } });
    if (url === '/reports/payments') return Promise.resolve({ data: { totalCollection: 0, cashTotal: 0, upiTotal: 0, dateWise: [] } });
    if (url === '/reports/attendance') return Promise.resolve({ data: { totalMarked: 0, present: 0, absent: 0, dateWise: [] } });
    if (url === '/expenses') return Promise.resolve({ data: { expenses: [{ expense_id: 'e1', date: '2026-08-01', category: 'Rent', description: '', amount: 500, payment_mode: 'cash', status: 'active' }] } });
    return Promise.resolve({ data: {} });
  });
});

describe('Reports page', () => {
  test('shows the financial tab by default', async () => {
    render(<Reports />);
    await waitFor(() => expect(screen.getByText('Financial & operational')).toBeInTheDocument());
    expect(screen.getByText('₹900')).toBeInTheDocument(); // collected
  });

  test('switches to the Students tab and loads its report', async () => {
    render(<Reports />);
    await waitFor(() => expect(screen.getByText('Financial & operational')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Students'));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/reports/students', expect.anything()));
    await waitFor(() => expect(screen.getAllByText('New this month').length).toBeGreaterThan(0));
  });

  test('switches to the Expenses tab and can void an expense with a reason', async () => {
    render(<Reports />);
    await waitFor(() => expect(screen.getByText('Financial & operational')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }));
    await waitFor(() => expect(screen.getByText('Rent')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Void'));
    fireEvent.click(screen.getByText('Void expense'));
    expect(screen.getByText(/reason is required/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Duplicate entry' } });
    fireEvent.click(screen.getByText('Void expense'));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/expenses/e1/void', { reason: 'Duplicate entry' }));
  });

  test('exporting the financial tab calls exportCsv with report rows', async () => {
    render(<Reports />);
    await waitFor(() => expect(screen.getByText('Financial & operational')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Export CSV'));
    expect(exportCsv).toHaveBeenCalled();
  });
});
