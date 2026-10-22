import { useEffect, useState } from 'react';
import { subscribeToQueue, startQueueAutoSync, flushQueue } from '../utils/offlineQueue';

/**
 * Shows how many offline-queued actions (attendance marks, payments) are
 * still waiting to sync, and starts the one app-wide auto-sync listener
 * that flushes the queue whenever connectivity returns. Mounted once in
 * AppShell so it's visible on every page, not tied to any one screen.
 */
export default function SyncStatusBadge() {
  const [queue, setQueue] = useState([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToQueue(setQueue);
    const stopAutoSync = startQueueAutoSync();
    return () => {
      unsubscribe();
      stopAutoSync?.();
    };
  }, []);

  if (queue.length === 0) return null;

  async function syncNow() {
    setSyncing(true);
    try {
      await flushQueue();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-outline"
      style={{ fontSize: 12, padding: '4px 10px', height: 'auto' }}
      onClick={syncNow}
      disabled={syncing}
      title={queue.map((e) => e.label).join('\n')}
    >
      {syncing ? 'Syncing…' : `${queue.length} pending sync`}
    </button>
  );
}
