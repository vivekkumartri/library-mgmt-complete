import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AllocateForm from '../components/AllocateForm';

vi.mock('../services/api', () => {
  const post = vi.fn();
  const get = vi.fn();
  return {
    default: { post, get },
    apiErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
  };
});

import api from '../services/api';

const seat = { seat_id: 'seat-1', seat_number: 5 };
const floor = { floor_id: 'floor-1', floor_name: 'Floor 1' };
const student = { student_id: 'LIB-2026-0001', full_name: 'Rahul Kumar', mobile: '9999999999' };

function selectStudent() {
  api.get.mockResolvedValueOnce({ data: { students: [student] } });
  const input = screen.getByPlaceholderText(/Name, ID, or mobile/i);
  return userEvent.type(input, 'Rahul');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AllocateForm overlap-confirm flow', () => {
  test('shows a warning and requires explicit confirmation before saving on overlap', async () => {
    const onDone = vi.fn();
    render(<AllocateForm seat={seat} floor={floor} onClose={vi.fn()} onDone={onDone} />);

    await selectStudent();
    await waitFor(() => screen.getByText(/Rahul Kumar/i));
    fireEvent.click(screen.getByText(/Rahul Kumar/i));

    const [monthlyFeeInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(monthlyFeeInput, { target: { value: '1000' } });

    // First submit: backend says this overlaps and needs confirmation.
    api.post.mockResolvedValueOnce({
      data: { requiresConfirmation: true, warning: "This allocation overlaps with another student's existing allocation.", overlappingAllocations: [] },
    });

    fireEvent.click(screen.getByText('Save allocation'));

    await waitFor(() => expect(screen.getByText(/overlaps with another student/i)).toBeInTheDocument());

    // The allocation must NOT be considered done yet — still requires an explicit confirm click.
    expect(onDone).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/allocations', expect.objectContaining({ confirmOverlap: false }));

    // Second submit ("Confirm anyway") actually saves it.
    api.post.mockResolvedValueOnce({ data: { allocation: { allocation_id: 'a1' } } });
    fireEvent.click(screen.getByText('Confirm anyway'));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.post).toHaveBeenLastCalledWith('/allocations', expect.objectContaining({ confirmOverlap: true }));
  });

  test('saves directly with no warning when there is no overlap', async () => {
    const onDone = vi.fn();
    render(<AllocateForm seat={seat} floor={floor} onClose={vi.fn()} onDone={onDone} />);

    await selectStudent();
    await waitFor(() => screen.getByText(/Rahul Kumar/i));
    fireEvent.click(screen.getByText(/Rahul Kumar/i));
    const [monthlyFeeInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(monthlyFeeInput, { target: { value: '1000' } });

    api.post.mockResolvedValueOnce({ data: { allocation: { allocation_id: 'a1' } } });
    fireEvent.click(screen.getByText('Save allocation'));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(screen.queryByText(/overlaps with another student/i)).not.toBeInTheDocument();
  });

  test('blocks submission with a client-side message when no student is selected', async () => {
    render(<AllocateForm seat={seat} floor={floor} onClose={vi.fn()} onDone={vi.fn()} />);
    fireEvent.click(screen.getByText('Save allocation'));
    await waitFor(() => expect(screen.getByText(/select a student first/i)).toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();
  });
});
