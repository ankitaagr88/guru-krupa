import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('idb', () => import('../test/fakeIdb'));

import { resetFakeIdb } from '../test/fakeIdb';
import {
  _resetForTests,
  backoffMs,
  enqueueCapture,
  flushQueue,
  listPending,
  pendingCount,
  registerBackgroundSync,
} from './captureQueue';

describe('captureQueue (IndexedDB offline queue)', () => {
  beforeEach(() => {
    globalThis.indexedDB = {};
    resetFakeIdb();
    _resetForTests();
  });

  it('enqueues a capture with a uuid and keeps it while offline', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const rec = await enqueueCapture({ visitId: 4, machineKey: 'hrk8000a_ref', blob });
    expect(rec.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(rec.attempts).toBe(0);
    expect(await pendingCount()).toBe(1);

    const upload = vi.fn();
    const res = await flushQueue({ upload, isOnline: () => false });
    expect(upload).not.toHaveBeenCalled();
    expect(res.remaining).toBe(1);
  });

  it('flushes on reconnect, sending the same uuid as clientUuid, and removes on success', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const rec = await enqueueCapture({ visitId: 4, machineKey: 'hrk8000a_ref', blob });
    const upload = vi.fn(async (r) => ({ id: 1, status: 'pending', clientUuid: r.uuid }));
    const res = await flushQueue({ upload, isOnline: () => true });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0].uuid).toBe(rec.uuid);
    expect(upload.mock.calls[0][0].machineKey).toBe('hrk8000a_ref');
    expect(res.uploaded[0].reading.clientUuid).toBe(rec.uuid);
    expect(await pendingCount()).toBe(0);
  });

  it('backs off exponentially after a failed upload and retries when forced', async () => {
    await enqueueCapture({ visitId: 4, machineKey: 'hrk8000a_ref', blob: new Blob(['x']) });
    const upload = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValue({ id: 2 });
    let res = await flushQueue({ upload, isOnline: () => true });
    expect(res.failed).toHaveLength(1);
    const [rec] = await listPending();
    expect(rec.attempts).toBe(1);
    expect(rec.lastError).toBe('network down');
    expect(rec.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(20)).toBe(5 * 60 * 1000);

    // not due yet → skipped
    res = await flushQueue({ upload, isOnline: () => true });
    expect(upload).toHaveBeenCalledTimes(1);
    // forced (online event) → retried and cleared
    res = await flushQueue({ upload, isOnline: () => true, force: true });
    expect(res.uploaded).toHaveLength(1);
    expect(await pendingCount()).toBe(0);
  });

  it('drops captures the server rejects for good (4xx) instead of retrying forever', async () => {
    await enqueueCapture({ visitId: 4, machineKey: 'nope', blob: new Blob(['x']) });
    const err = new Error('bad');
    err.response = { status: 422, data: { detail: "Unknown machineKey 'nope'" } };
    const res = await flushQueue({ upload: vi.fn().mockRejectedValue(err), isOnline: () => true });
    expect(res.dropped).toHaveLength(1);
    expect(await pendingCount()).toBe(0);
  });

  it('registerBackgroundSync is a safe no-op without SyncManager', async () => {
    expect(await registerBackgroundSync()).toBe(false);
  });
});
