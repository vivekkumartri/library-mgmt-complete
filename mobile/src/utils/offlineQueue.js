import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import api from '../services/api';

/**
 * Generic offline-write queue — CREATE actions only (see the module
 * comment on each call site for why). An action is queued when the
 * device is offline (or the request fails for a network reason), persisted
 * to localStorage so it survives the app being killed, and flushed in
 * order as soon as connectivity returns.
 *
 * Deliberately does NOT support edits to existing records: appending a
 * second write for the same id on sync would either silently clobber
 * server state (if treated as an update) or create two rows claiming the
 * same id (if treated as an insert) — both are worse than just requiring
 * network for edits. Every queued entry here must be safe to POST again
 * from scratch with no prior context.
 */
const STORAGE_KEY = 'lib_offline_queue';

function readQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

function randomId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const listeners = new Set();
function notify() {
  const queue = readQueue();
  listeners.forEach((fn) => fn(queue));
}

/** Subscribe to queue changes (length/contents) — returns an unsubscribe function. */
export function subscribeToQueue(fn) {
  listeners.add(fn);
  fn(readQueue());
  return () => listeners.delete(fn);
}

export function getQueuedActions() {
  return readQueue();
}

/**
 * Queues a CREATE request for later sync. `url`/`body` are exactly what
 * would normally go to `api.post(url, body)`. `kind` is a short label
 * (e.g. 'attendance', 'payment') shown in the pending-sync UI. Returns the
 * queued entry's id immediately — this never touches the network itself.
 */
export function queueAction({ kind, url, body, label }) {
  const entry = {
    id: randomId(),
    kind,
    url,
    body,
    label: label || kind,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: '',
  };
  const queue = readQueue();
  queue.push(entry);
  writeQueue(queue);
  notify();
  return entry.id;
}

function removeFromQueue(id) {
  const queue = readQueue().filter((e) => e.id !== id);
  writeQueue(queue);
  notify();
}

function markAttempt(id, error) {
  const queue = readQueue();
  const entry = queue.find((e) => e.id === id);
  if (entry) {
    entry.attempts += 1;
    entry.lastError = error || '';
  }
  writeQueue(queue);
  notify();
}

let flushing = false;

/**
 * Sends every queued action to the server, in the order it was queued.
 * Stops at the first action that fails for a real (still-offline or
 * server 5xx) reason, leaving the rest queued for the next attempt — a
 * 4xx (e.g. validation error on a malformed queued body) is dropped
 * rather than retried forever, since retrying it would never succeed.
 */
export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    const queue = readQueue();
    for (const entry of queue) {
      try {
        await api.post(entry.url, entry.body);
        removeFromQueue(entry.id);
      } catch (err) {
        const status = err?.response?.status;
        if (status && status < 500 && status !== 408 && status !== 429) {
          // Not a connectivity problem — this request is simply invalid
          // and will never succeed on retry (e.g. 401/403/422). Drop it
          // rather than blocking every action queued after it forever.
          removeFromQueue(entry.id);
          continue;
        }
        markAttempt(entry.id, err?.message || 'Network error');
        break; // preserve order — stop here, retry everything from this point next time
      }
    }
  } finally {
    flushing = false;
  }
}

/** True if the device currently has a network connection. Falls back to navigator.onLine on web. */
export async function isOnline() {
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await Network.getStatus();
      return status.connected;
    } catch {
      return navigator.onLine;
    }
  }
  return navigator.onLine;
}

/**
 * Starts listening for connectivity changes and flushes the queue
 * whenever the device comes back online. Call once near app startup.
 * Returns a cleanup function.
 */
export function startQueueAutoSync() {
  flushQueue();
  if (Capacitor.isNativePlatform()) {
    let handle;
    Network.addListener('networkStatusChange', (status) => {
      if (status.connected) flushQueue();
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }
  const onOnline = () => flushQueue();
  window.addEventListener('online', onOnline);
  return () => window.removeEventListener('online', onOnline);
}
