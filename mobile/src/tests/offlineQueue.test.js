import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor/network', () => ({
  Network: { getStatus: vi.fn(), addListener: vi.fn() },
}));
vi.mock('../services/api', () => ({ default: { post: vi.fn() } }));

import api from '../services/api';
import { queueAction, getQueuedActions, flushQueue, subscribeToQueue } from '../utils/offlineQueue';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('offlineQueue — queueAction / getQueuedActions', () => {
  test('queues an action and persists it to localStorage', () => {
    queueAction({ kind: 'attendance', url: '/attendance', body: { studentId: 'S1' }, label: 'Present — S1' });

    const queue = getQueuedActions();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ kind: 'attendance', url: '/attendance', body: { studentId: 'S1' } });
    expect(queue[0].id).toBeTruthy();
  });

  test('queued actions survive being read back from a fresh localStorage parse', () => {
    queueAction({ kind: 'payment', url: '/payments', body: { amount: 500 } });
    const raw = localStorage.getItem('lib_offline_queue');
    expect(JSON.parse(raw)).toHaveLength(1);
  });

  test('notifies subscribers when an action is queued', () => {
    const fn = vi.fn();
    subscribeToQueue(fn);
    fn.mockClear(); // ignore the initial call with the current (empty) queue

    queueAction({ kind: 'attendance', url: '/attendance', body: {} });

    expect(fn).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ kind: 'attendance' })]));
  });
});

describe('offlineQueue — flushQueue', () => {
  test('sends each queued action and removes it from the queue on success', async () => {
    api.post.mockResolvedValue({ data: {} });
    queueAction({ kind: 'attendance', url: '/attendance', body: { studentId: 'S1', date: '2026-01-01', status: 'present' } });

    await flushQueue();

    expect(api.post).toHaveBeenCalledWith('/attendance', { studentId: 'S1', date: '2026-01-01', status: 'present' });
    expect(getQueuedActions()).toHaveLength(0);
  });

  test('sends queued actions in the order they were queued', async () => {
    api.post.mockResolvedValue({ data: {} });
    queueAction({ kind: 'attendance', url: '/attendance', body: { order: 1 } });
    queueAction({ kind: 'attendance', url: '/attendance', body: { order: 2 } });

    await flushQueue();

    expect(api.post.mock.calls[0][1]).toEqual({ order: 1 });
    expect(api.post.mock.calls[1][1]).toEqual({ order: 2 });
  });

  test('stops at the first action that still fails for a connectivity reason, leaving it and everything after it queued', async () => {
    api.post
      .mockResolvedValueOnce({ data: {} }) // first succeeds
      .mockRejectedValueOnce(new Error('Network Error')); // second has no response — still offline
    queueAction({ kind: 'attendance', url: '/attendance', body: { order: 1 } });
    queueAction({ kind: 'attendance', url: '/attendance', body: { order: 2 } });
    queueAction({ kind: 'attendance', url: '/attendance', body: { order: 3 } });

    await flushQueue();

    expect(api.post).toHaveBeenCalledTimes(2); // never attempted the third
    const remaining = getQueuedActions();
    expect(remaining).toHaveLength(2);
    expect(remaining[0].body).toEqual({ order: 2 });
    expect(remaining[0].attempts).toBe(1);
  });

  test('drops an action that fails with a real 4xx rejection instead of retrying it forever', async () => {
    api.post.mockRejectedValueOnce({ response: { status: 422, data: { error: { message: 'Invalid' } } } });
    queueAction({ kind: 'payment', url: '/payments', body: { amount: -5 } });

    await flushQueue();

    expect(getQueuedActions()).toHaveLength(0);
  });

  test('keeps retrying (does not drop) on a 5xx server error', async () => {
    api.post.mockRejectedValueOnce({ response: { status: 503 } });
    queueAction({ kind: 'attendance', url: '/attendance', body: {} });

    await flushQueue();

    expect(getQueuedActions()).toHaveLength(1);
  });
});
