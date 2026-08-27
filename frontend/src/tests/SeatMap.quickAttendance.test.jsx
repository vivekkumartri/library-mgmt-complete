import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../i18n';
import SeatMap from '../pages/SeatMap';

vi.mock('../services/api', () => {
  const get = vi.fn();
  const post = vi.fn();
  return {
    default: { get, post },
    apiErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
  };
});

import api from '../services/api';

const floor = { floor_id: 'floor-1', floor_name: 'Floor 1', columns: 4 };
const soloSeat = {
  seat_id: 'seat-1', seat_number: 1, status: 'available',
  timeline: [{ allocationId: 'a1', studentId: 'LIB-2026-0001', studentName: 'Rahul Kumar', startTime: '06:00', endTime: '12:00', paymentUrgency: 'overdue', paymentDueDate: '2026-08-01' }],
};
const sharedSeat = {
  seat_id: 'seat-2', seat_number: 2, status: 'available',
  timeline: [
    { allocationId: 'a2', studentId: 'LIB-2026-0002', studentName: 'Neha Iyer', startTime: '06:00', endTime: '12:00', paymentUrgency: 'ok', paymentDueDate: null },
    { allocationId: 'a3', studentId: 'LIB-2026-0003', studentName: 'Karan Shah', startTime: '13:00', endTime: '18:00', paymentUrgency: 'due_soon', paymentDueDate: '2026-08-30' },
  ],
};
const emptySeat = { seat_id: 'seat-3', seat_number: 3, status: 'available', timeline: [] };

function mockLoad(seats) {
  api.get.mockImplementation((url) => {
    if (url === '/floors') return Promise.resolve({ data: { floors: [floor] } });
    if (url === `/floors/${floor.floor_id}/seats`) return Promise.resolve({ data: { seats } });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SeatMap — due date and quick attendance on each seat', () => {
  test('shows the due date on an occupied seat', async () => {
    mockLoad([soloSeat, emptySeat]);
    render(<SeatMap />);
    await waitFor(() => expect(screen.getByText('Due 2026-08-01')).toBeInTheDocument());
  });

  test('an empty seat shows no due date or attendance controls', async () => {
    mockLoad([emptySeat]);
    render(<SeatMap />);
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    expect(document.querySelector('.seat-due-date')).toBeNull();
    expect(screen.queryByText('Present')).not.toBeInTheDocument();
  });

  test('clicking Present on a single-occupant seat marks today\'s attendance directly, without opening the drawer', async () => {
    mockLoad([soloSeat]);
    api.post.mockResolvedValueOnce({ data: { attendance: { student_id: 'LIB-2026-0001', status: 'present' } } });
    render(<SeatMap />);
    await waitFor(() => expect(screen.getByText('Due 2026-08-01')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Present'));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/attendance', {
        studentId: 'LIB-2026-0001',
        date: new Date().toISOString().slice(0, 10),
        status: 'present',
      })
    );
    // The drawer never opened — no "End allocation" control from SeatDetailDrawer.
    expect(screen.queryByText('End allocation')).not.toBeInTheDocument();
  });

  test('a shared seat (multiple students) shows a count instead of quick attendance buttons', async () => {
    mockLoad([sharedSeat]);
    render(<SeatMap />);
    await waitFor(() => expect(screen.getByText('2 students')).toBeInTheDocument());
    expect(screen.queryByText('Present')).not.toBeInTheDocument();
  });
});
