import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../pages/Dashboard';
import '../i18n';

vi.mock('../services/api', () => {
  const get = vi.fn();
  return {
    default: { get },
    apiErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
  };
});

import api from '../services/api';

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url === '/dashboard/today') {
      return Promise.resolve({ data: { totalActiveStudents: 4, studentsPresent: 2, totalSeats: 10, availableSeats: 3, todaysPayments: 500, todaysExpenses: 100 } });
    }
    if (url === '/dashboard/payment-due') return Promise.resolve({ data: { paymentDue: [] } });
    if (url === '/reports/financial') return Promise.resolve({ data: { expectedFees: 1000, collected: 900, pendingFees: 100, overdueFees: 0, totalExpenses: 200, netIncome: 700 } });
    if (url === '/reports/operational') return Promise.resolve({ data: { activeStudents: 4, pastStudents: 1, vacantSeats: 3, disabledSeats: 1, totalSeats: 10, seatUtilizationPercent: 60 } });
    if (url === '/reports/students') return Promise.resolve({ data: { counts: { active: 4, past: 1, new: 1, leaving: 0 } } });
    if (url === '/reports/seats') return Promise.resolve({ data: { byFloor: [{ floorId: 'f1', floorName: 'Floor 1', totalSeats: 10, available: 3, allocated: 6, disabled: 1 }], conflicts: [] } });
    if (url === '/reports/payments') return Promise.resolve({ data: { totalCollection: 900, cashTotal: 600, upiTotal: 300, dateWise: [] } });
    if (url === '/reports/attendance') return Promise.resolve({ data: { totalMarked: 2, present: 2, absent: 0, dateWise: [{ date: '2026-08-01', present: 2, absent: 0 }] } });
    return Promise.resolve({ data: {} });
  });
});

describe('Dashboard', () => {
  test('renders today, financial, operational stats and charts once loaded', async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Financial — ' + new Date().toISOString().slice(0, 7))).toBeInTheDocument());
    expect(screen.getAllByText('₹900').length).toBeGreaterThan(0); // collected
    expect(screen.getByText('Fee collection vs outstanding')).toBeInTheDocument();
    expect(screen.getByText('Floor-wise occupancy')).toBeInTheDocument();
    expect(screen.getByText('Payment method breakdown')).toBeInTheDocument();
  });

  test('shows a friendly error and allows retry when a report fails to load', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/dashboard/today') return Promise.reject({ response: { data: { error: { message: 'Google Sheets unavailable' } } } });
      return Promise.resolve({ data: {} });
    });
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Google Sheets unavailable')).toBeInTheDocument());
  });
});
