import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Attendance from '../pages/Attendance';
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

const student = { student_id: 'LIB-2026-0001', full_name: 'Rahul Kumar' };
const summary = { present: 0, absent: 0, notMarked: 1, attendancePercentage: 0 };

function mockDefaultLoad({ attendance = [] } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/attendance/dashboard') return Promise.resolve({ data: summary });
    if (url === '/students') return Promise.resolve({ data: { students: [student] } });
    if (url === '/attendance') return Promise.resolve({ data: { attendance } });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Attendance page', () => {
  test('marks a student present optimistically and persists it', async () => {
    mockDefaultLoad();
    api.post.mockResolvedValueOnce({ data: {} });

    render(<Attendance />);
    await waitFor(() => expect(screen.getByText('Rahul Kumar')).toBeInTheDocument());

    const row = screen.getByText('Rahul Kumar').closest('.list-item');
    fireEvent.click(within(row).getByText('Present'));

    // Optimistic UI update happens before the request resolves.
    expect(within(row).getByText('Present')).toHaveStyle({ background: 'var(--color-success)' });

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/attendance', {
        studentId: student.student_id,
        date: expect.any(String),
        status: 'present',
      })
    );
  });

  test('switching between present and absent updates the highlighted button', async () => {
    mockDefaultLoad();
    api.post.mockResolvedValue({ data: {} });

    render(<Attendance />);
    await waitFor(() => screen.getByText('Rahul Kumar'));
    const row = screen.getByText('Rahul Kumar').closest('.list-item');

    fireEvent.click(within(row).getByText('Present'));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    fireEvent.click(within(row).getByText('Absent'));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(within(row).getByText('Absent')).toHaveStyle({ background: 'var(--color-danger)' });
    expect(within(row).getByText('Present')).not.toHaveStyle({ background: 'var(--color-success)' });
  });

  test('rolls back and shows an error if marking attendance fails', async () => {
    mockDefaultLoad();
    api.post.mockRejectedValueOnce({ response: { data: { error: { message: 'Could not save attendance.' } } } });

    render(<Attendance />);
    await waitFor(() => screen.getByText('Rahul Kumar'));
    const row = screen.getByText('Rahul Kumar').closest('.list-item');

    fireEvent.click(within(row).getByText('Present'));

    await waitFor(() => expect(screen.getByText('Could not save attendance.')).toBeInTheDocument());
  });

  test('filters the student list by search', async () => {
    const other = { student_id: 'LIB-2026-0002', full_name: 'Priya Singh' };
    api.get.mockImplementation((url) => {
      if (url === '/attendance/dashboard') return Promise.resolve({ data: summary });
      if (url === '/students') return Promise.resolve({ data: { students: [student, other] } });
      if (url === '/attendance') return Promise.resolve({ data: { attendance: [] } });
      return Promise.resolve({ data: {} });
    });

    render(<Attendance />);
    await waitFor(() => screen.getByText('Rahul Kumar'));
    expect(screen.getByText('Priya Singh')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Search students/i), { target: { value: 'priya' } });

    expect(screen.queryByText('Rahul Kumar')).not.toBeInTheDocument();
    expect(screen.getByText('Priya Singh')).toBeInTheDocument();
  });
});
