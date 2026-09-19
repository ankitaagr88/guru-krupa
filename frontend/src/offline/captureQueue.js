/* Offline capture queue (F5). Mockup: `pendingCaptures` / `processPendingCaptures`.

   Every machine photo is written to IndexedDB *first* (even when online), then
   the sync loop uploads it with `POST /readings` and removes it on success.
   The `uuid` goes up as `clientUuid` so a retry after a dropped connection
   never creates a second reading (the backend answers 200 with the existing
   one). Failed uploads back off exponentially (2s, 4s, 8s … capped at 5 min).

   Record shape (store "captures", keyPath "uuid"):
     { uuid, visitId, machineKey, blob, capturedAt, attempts, lastError, nextAttemptAt, createdAt }

   Background Sync: when the browser exposes `SyncManager` we also register the
   tag `gk-capture-sync`; `public/sw-sync.js` (imported by the generated service
   worker) turns the sync event into a `{type:'gk-flush-captures'}` message and
   the loop below flushes. Without it, the `online` event + interval do the job. */
import { openDB } from 'idb';

export const DB_NAME = 'gk-offline';
export const DB_VERSION = 1;
export const STORE = 'captures';
export const SYNC_TAG = 'gk-capture-sync';
export const SW_FLUSH_MESSAGE = 'gk-flush-captures';

const MAX_BACKOFF_MS = 5 * 60 * 1000;
const BASE_BACKOFF_MS = 2000;

let dbPromise = null;

export function hasIndexedDB() {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function db() {
  if (!hasIndexedDB()) return Promise.reject(new Error('IndexedDB unavailable'));
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'uuid' });
          store.createIndex('visitId', 'visitId');
          store.createIndex('createdAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

/** Test/reset hook — drops the cached connection so a fresh DB is opened. */
export function _resetForTests() {
  dbPromise = null;
}

export function newUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC4122-ish fallback for very old WebViews
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function backoffMs(attempts) {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

/** Always called on capture — online or not. Returns the stored record. */
export async function enqueueCapture({ visitId, machineKey, blob, capturedAt }) {
  const rec = {
    uuid: newUuid(),
    visitId,
    machineKey,
    blob,
    capturedAt: capturedAt || new Date().toISOString(),
    attempts: 0,
    lastError: null,
    nextAttemptAt: 0,
    createdAt: Date.now(),
  };
  const d = await db();
  await d.put(STORE, rec);
  return rec;
}

export async function listPending() {
  if (!hasIndexedDB()) return [];
  try {
    const d = await db();
    const all = await d.getAll(STORE);
    return all.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function pendingCount() {
  if (!hasIndexedDB()) return 0;
  try {
    const d = await db();
    return await d.count(STORE);
  } catch {
    return 0;
  }
}

export async function removeCapture(uuid) {
  const d = await db();
  await d.delete(STORE, uuid);
}

export async function clearQueue() {
  if (!hasIndexedDB()) return;
  const d = await db();
  await d.clear(STORE);
}

async function markFailed(rec, err) {
  const attempts = (rec.attempts || 0) + 1;
  const updated = {
    ...rec,
    attempts,
    lastError: (err && (err.message || String(err))) || 'upload failed',
    nextAttemptAt: Date.now() + backoffMs(attempts),
  };
  const d = await db();
  await d.put(STORE, updated);
  return updated;
}

/** 4xx (other than 408/429) means the server rejected the capture for good —
 *  retrying will never succeed, so drop it rather than loop forever. */
function isPermanentError(err) {
  const s = err?.response?.status;
  return s && s >= 400 && s < 500 && s !== 408 && s !== 429;
}

let flushing = null;

/** Upload everything that is due. `upload(rec)` must resolve with the
 *  ReadingOut. Returns { uploaded: [{rec, reading}], failed: [rec], dropped: [rec], remaining }.
 *  Concurrent calls share one run. */
export function flushQueue({ upload, isOnline = () => true, force = false } = {}) {
  if (flushing) return flushing;
  flushing = (async () => {
    const result = { uploaded: [], failed: [], dropped: [], remaining: 0 };
    if (!hasIndexedDB() || !upload) return result;
    let items = [];
    try {
      items = await listPending();
    } catch {
      return result;
    }
    const now = Date.now();
    for (const rec of items) {
      if (!isOnline()) break;
      if (!force && rec.nextAttemptAt && rec.nextAttemptAt > now) continue;
      try {
        const reading = await upload(rec);
        await removeCapture(rec.uuid);
        result.uploaded.push({ rec, reading });
      } catch (err) {
        if (isPermanentError(err)) {
          await removeCapture(rec.uuid).catch(() => {});
          result.dropped.push({ ...rec, lastError: err?.response?.data?.detail || err.message });
        } else {
          result.failed.push(await markFailed(rec, err).catch(() => rec));
        }
      }
    }
    result.remaining = await pendingCount();
    return result;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Ask the service worker for a Background Sync. Resolves true when registered. */
export async function registerBackgroundSync() {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    if (typeof window === 'undefined' || !('SyncManager' in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    if (!reg?.sync) return false;
    await reg.sync.register(SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

/** The sync loop: flush on start, on `online`, on SW message, and every
 *  `intervalMs`. `onResult(result)` fires after each run. Returns a stop(). */
export function startSyncLoop({ upload, isOnline = () => navigator.onLine, onResult, intervalMs = 15000 }) {
  if (!hasIndexedDB()) return () => {};
  let stopped = false;
  const run = (force = false) => {
    if (stopped) return Promise.resolve(null);
    return flushQueue({ upload, isOnline, force })
      .then((r) => {
        if (!stopped) onResult?.(r);
        return r;
      })
      .catch(() => null);
  };
  const onOnline = () => run(true);
  const onMessage = (e) => {
    if (e?.data?.type === SW_FLUSH_MESSAGE) run(true);
  };
  window.addEventListener('online', onOnline);
  navigator.serviceWorker?.addEventListener?.('message', onMessage);
  const t = setInterval(() => run(false), intervalMs);
  run(false);
  return () => {
    stopped = true;
    clearInterval(t);
    window.removeEventListener('online', onOnline);
    navigator.serviceWorker?.removeEventListener?.('message', onMessage);
  };
}
