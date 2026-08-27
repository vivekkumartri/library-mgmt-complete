import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import SeatDetailDrawer from '../components/SeatDetailDrawer';

vi.mock('../services/api', () => {
  const post = vi.fn();
  const patch = vi.fn();
  return {
    default: { post, patch },
    apiErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
  };
});

import api from '../services/api';

const seat = {
  seat_id: 'seat-1',
  seat_number: 5,
  status: 'available',
  timeline: [
    { allocationId: 'a1', studentId: 'LIB-2026-0001', studentName: 'Rahul Kumar', studentMobile: '9999999999', startTime: '06:00', endTime: '12:00', monthlyFee: 1000 },
  ],
};
const floor = { floor_id: 'floor-1', floor_name: 'Floor 1' };

function renderDrawer(props = {}) {
  return render(
    <MemoryRouter>
      <SeatDetailDrawer seat={seat} floor={floor} onClose={vi.fn()} onChanged={vi.fn()} {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SeatDetailDrawer — mark attendance from the seat map', () => {
  test('marking present posts to /attendance with today\'s date and highlights the button', async () => {
    api.post.mockResolvedValueOnce({ data: { attendance: { student_id: 'LIB-2026-0001', status: 'present' } } });
    renderDrawer();

    const presentButtons = screen.getAllByText('Present');
    fireEvent.click(presentButtons[0]);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/attendance', {
        studentId: 'LIB-2026-0001',
        date: new Date().toISOString().slice(0, 10),
        status: 'present',
      })
    );
  });

  test('reverts the optimistic mark if the request fails', async () => {
    api.post.mockRejectedValueOnce({ response: { data: { error: { message: 'Network error' } } } });
    renderDrawer();

    const absentButtons = screen.getAllByText('Absent');
    fireEvent.click(absentButtons[0]);

    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });
});
