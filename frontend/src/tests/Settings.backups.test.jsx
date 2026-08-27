import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from '../pages/Settings';
import '../i18n';

vi.mock('../services/api', () => {
  const get = vi.fn();
  const put = vi.fn();
  const post = vi.fn();
  return {
    default: { get, put, post },
    apiErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'super_admin' } }),
}));

import api from '../services/api';

const backups = [
  { date: '2026-08-25', time: '02-00-00' },
  { date: '2026-08-26', time: '02-00-00' },
];

function mockBaseGets() {
  api.get.mockImplementation((url) => {
    if (url === '/settings') return Promise.resolve({ data: { settings: {} } });
    if (url === '/floors') return Promise.resolve({ data: { floors: [] } });
    if (url === '/backup/list') return Promise.resolve({ data: { backups } });
    if (url === '/backup/status') {
      return Promise.resolve({
        data: { lastRun: { startedAt: '2026-08-26T02:00:00Z', ok: true } },
      });
    }
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Settings — Backups & restore panel', () => {
  test('super admin sees the list of available backups, most recent first', async () => {
    mockBaseGets();
    render(<Settings />);

    await waitFor(() => expect(screen.getAllByText('Restore…').length).toBe(2));

    const dates = screen.getAllByText(/2026-08-2[56]/).map((el) => el.textContent);
    expect(dates[0]).toBe('2026-08-26');
    expect(dates[1]).toBe('2026-08-25');
  });

  test('restoring requires the explicit acknowledgement checkbox before it is enabled', async () => {
    mockBaseGets();
    const user = userEvent.setup();
    render(<Settings />);

    await waitFor(() => expect(screen.getAllByText('Restore…').length).toBe(2));
    await user.click(screen.getAllByText('Restore…')[0]);

    const restoreNow = screen.getByRole('button', { name: /Restore now/i });
    expect(restoreNow).toBeDisabled();

    await user.click(screen.getByLabelText(/I understand this overwrites/i));
    expect(restoreNow).not.toBeDisabled();
  });

  test('confirmed restore calls the API with confirm: true and shows the result', async () => {
    mockBaseGets();
    api.post.mockResolvedValue({
      data: {
        restore: {
          restoredSheets: ['Students', 'Payments'],
          skippedSheets: [],
        },
      },
    });
    const user = userEvent.setup();
    render(<Settings />);

    await waitFor(() => expect(screen.getAllByText('Restore…').length).toBe(2));
    await user.click(screen.getAllByText('Restore…')[0]);
    await user.click(screen.getByLabelText(/I understand this overwrites/i));
    await user.click(screen.getByRole('button', { name: /Restore now/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/backup/restore', {
        date: '2026-08-26',
        time: '02-00-00',
        sheets: undefined,
        confirm: true,
      })
    );
    expect(await screen.findByText(/Restored 2 sheet\(s\)/)).toBeInTheDocument();
  });

  test('restoring a subset requires at least one sheet to be selected', async () => {
    mockBaseGets();
    const user = userEvent.setup();
    render(<Settings />);

    await waitFor(() => expect(screen.getAllByText('Restore…').length).toBe(2));
    await user.click(screen.getAllByText('Restore…')[0]);
    await user.click(screen.getByLabelText(/Restore specific sheets only/i));
    await user.click(screen.getByLabelText(/I understand this overwrites/i));
    await user.click(screen.getByRole('button', { name: /Restore now/i }));

    expect(await screen.findByText(/Choose at least one sheet/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('restoring a single record requires an ID before it is submitted', async () => {
    mockBaseGets();
    const user = userEvent.setup();
    render(<Settings />);

    await waitFor(() => expect(screen.getAllByText('Restore…').length).toBe(2));
    await user.click(screen.getAllByText('Restore…')[0]);
    await user.click(screen.getByLabelText(/Restore a single record/i));
    await user.click(screen.getByLabelText(/I understand this overwrites/i));
    await user.click(screen.getByRole('button', { name: /Restore now/i }));

    expect(await screen.findByText(/Enter the record ID/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('confirmed single-record restore calls restore-record with the chosen sheet and ID', async () => {
    mockBaseGets();
    api.post.mockResolvedValue({
      data: { restore: { sheet: 'Students', recordId: 'LIB-2026-0042', action: 'recreated', record: {} } },
    });
    const user = userEvent.setup();
    render(<Settings />);

    await waitFor(() => expect(screen.getAllByText('Restore…').length).toBe(2));
    await user.click(screen.getAllByText('Restore…')[0]);
    await user.click(screen.getByLabelText(/Restore a single record/i));
    await user.selectOptions(screen.getByLabelText('Sheet'), 'Payments');
    await user.type(screen.getByLabelText('Record ID'), 'LIB-2026-0042');
    await user.click(screen.getByLabelText(/I understand this overwrites/i));
    await user.click(screen.getByRole('button', { name: /Restore now/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/backup/restore-record', {
        date: '2026-08-26',
        time: '02-00-00',
        sheet: 'Payments',
        recordId: 'LIB-2026-0042',
        confirm: true,
      })
    );
    expect(await screen.findByText(/Re-created Students record LIB-2026-0042/)).toBeInTheDocument();
  });

  test('non-super-admin users do not see the backups panel', async () => {
    vi.resetModules();
    vi.doMock('../context/AuthContext', () => ({
      useAuth: () => ({ user: { role: 'staff' } }),
    }));
    vi.doMock('../services/api', () => ({
      default: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
      apiErrorMessage: (err, fallback) => err?.response?.data?.error?.message || fallback,
    }));
    const { default: SettingsStaff } = await import('../pages/Settings');
    const { default: apiStaff } = await import('../services/api');
    apiStaff.get.mockImplementation((url) => {
      if (url === '/settings') return Promise.resolve({ data: { settings: {} } });
      if (url === '/floors') return Promise.resolve({ data: { floors: [] } });
      return Promise.resolve({ data: {} });
    });
    render(<SettingsStaff />);

    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());
    expect(screen.queryByText('Backups & restore')).not.toBeInTheDocument();
  });
});
