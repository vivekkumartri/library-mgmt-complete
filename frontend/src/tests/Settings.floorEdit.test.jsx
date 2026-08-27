import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Settings from '../pages/Settings';
import '../i18n';

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

const floor = {
  floor_id: 'floor-1', floor_name: 'Floor 1', floor_number: '1', rows: 5, columns: 10,
  opening_time: '06:00', closing_time: '22:00', status: 'active', notes: '',
};

function mockBaseGets() {
  api.get.mockImplementation((url) => {
    if (url === '/settings') return Promise.resolve({ data: { settings: {} } });
    if (url === '/floors') return Promise.resolve({ data: { floors: [floor] } });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Settings — editing a floor', () => {
  test('shows an Edit button per floor and saves changes via PATCH /floors/:id', async () => {
    mockBaseGets();
    api.patch.mockResolvedValueOnce({ data: { floor: { ...floor, floor_name: 'Ground Floor' } } });

    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Floor 1')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => expect(screen.getByText('Edit floor')).toBeInTheDocument());

    const nameInput = screen.getByDisplayValue('Floor 1');
    fireEvent.change(nameInput, { target: { value: 'Ground Floor' } });

    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/floors/floor-1', expect.objectContaining({ floor_name: 'Ground Floor' }))
    );
  });

  test('does not offer to change rows/columns — only a note explaining why', async () => {
    mockBaseGets();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('Floor 1')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => expect(screen.getByText('Edit floor')).toBeInTheDocument());

    expect(screen.getByText(/seat grid size can't be changed here/i)).toBeInTheDocument();
  });
});
