import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { readings as readingsApi } from '../api';
import {
  enqueueCapture,
  flushQueue,
  hasIndexedDB,
  listPending,
  pendingCount as countPending,
  registerBackgroundSync,
  startSyncLoop,
} from './captureQueue';

/* Connectivity state shared across the app (mockup: `demoOffline`,
   `isOffline()`, `toggleDemoOffline()`), plus the capture sync loop
   (mockup `pendingCaptures` / `processPendingCaptures`) so queued machine
   photos upload on app start / reconnect even when the Machines screen
   isn't open. The Machines screen (F5) calls `enqueue()` for every capture
   and `flush()` after an explicit "back online". */

const OfflineContext = createContext(null);

/** Upload one queued record. Exported so tests can assert the payload. */
export function uploadQueuedCapture(rec) {
  return readingsApi.capture({
    visitId: rec.visitId,
    machineKey: rec.machineKey,
    file: rec.blob,
    clientUuid: rec.uuid,
    capturedAt: rec.capturedAt,
  });
}

export function OfflineProvider({ children, initialOnline, syncIntervalMs = 15000 }) {
  const [browserOnline, setBrowserOnline] = useState(
    initialOnline ?? (typeof navigator === 'undefined' ? true : navigator.onLine)
  );
  const [simulateOffline, setSimulateOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSync, setLastSync] = useState(null); // last flushQueue() result
  const reconnectHandlers = useRef(new Set());
  const uploadedHandlers = useRef(new Set());

  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const isOffline = simulateOffline || !browserOnline;
  const isOfflineRef = useRef(isOffline);
  isOfflineRef.current = isOffline;

  const refreshPendingCount = useCallback(async () => {
    const n = await countPending();
    setPendingCount(n);
    return n;
  }, []);

  const handleResult = useCallback((r) => {
    if (!r) return;
    setLastSync(r);
    setPendingCount(r.remaining ?? 0);
    if (r.uploaded?.length) {
      uploadedHandlers.current.forEach((fn) => {
        try {
          fn(r.uploaded);
        } catch (e) {
          console.error('uploaded handler failed', e);
        }
      });
    }
  }, []);

  const flush = useCallback(
    (force = true) =>
      flushQueue({ upload: uploadQueuedCapture, isOnline: () => !isOfflineRef.current, force }).then((r) => {
        handleResult(r);
        return r;
      }),
    [handleResult]
  );

  const enqueue = useCallback(
    async ({ visitId, machineKey, blob, capturedAt }) => {
      const rec = await enqueueCapture({ visitId, machineKey, blob, capturedAt });
      await refreshPendingCount();
      registerBackgroundSync(); // no-op where unsupported; the loop below covers it
      if (!isOfflineRef.current) flush(true);
      return rec;
    },
    [flush, refreshPendingCount]
  );

  // The sync loop: app start, `online` event, SW background-sync message, interval.
  useEffect(() => {
    if (!hasIndexedDB()) return undefined;
    refreshPendingCount();
    return startSyncLoop({
      upload: uploadQueuedCapture,
      isOnline: () => !isOfflineRef.current,
      onResult: handleResult,
      intervalMs: syncIntervalMs,
    });
  }, [handleResult, refreshPendingCount, syncIntervalMs]);

  // Fire reconnect handlers on the offline -> online edge (and flush the queue).
  const wasOffline = useRef(isOffline);
  useEffect(() => {
    if (wasOffline.current && !isOffline) {
      reconnectHandlers.current.forEach((fn) => {
        try {
          fn();
        } catch (e) {
          console.error('reconnect handler failed', e);
        }
      });
      if (hasIndexedDB()) flush(true);
    }
    wasOffline.current = isOffline;
  }, [isOffline, flush]);

  const onReconnect = useCallback((fn) => {
    reconnectHandlers.current.add(fn);
    return () => reconnectHandlers.current.delete(fn);
  }, []);

  /** Subscribe to "queued captures were uploaded" — fn([{rec, reading}]). */
  const onUploaded = useCallback((fn) => {
    uploadedHandlers.current.add(fn);
    return () => uploadedHandlers.current.delete(fn);
  }, []);

  const toggleSimulateOffline = useCallback(() => setSimulateOffline((v) => !v), []);

  const value = useMemo(
    () => ({
      isOffline,
      browserOnline,
      simulateOffline,
      setSimulateOffline,
      toggleSimulateOffline,
      pendingCount,
      setPendingCount,
      refreshPendingCount,
      listPending,
      enqueue,
      flush,
      lastSync,
      onReconnect,
      onUploaded,
    }),
    [
      isOffline,
      browserOnline,
      simulateOffline,
      toggleSimulateOffline,
      pendingCount,
      refreshPendingCount,
      enqueue,
      flush,
      lastSync,
      onReconnect,
      onUploaded,
    ]
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used inside <OfflineProvider>');
  return ctx;
}
