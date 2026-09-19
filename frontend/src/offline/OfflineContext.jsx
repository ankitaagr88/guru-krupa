import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/* Connectivity state shared across the app (mockup: `demoOffline`,
   `isOffline()`, `toggleDemoOffline()`). The Machines screen (F5) reuses
   `simulateOffline` for its offline-capture demo and `onReconnect` to flush
   its IndexedDB queue (`processPendingCaptures`). */

const OfflineContext = createContext(null);

export function OfflineProvider({ children, initialOnline }) {
  const [browserOnline, setBrowserOnline] = useState(
    initialOnline ?? (typeof navigator === 'undefined' ? true : navigator.onLine)
  );
  const [simulateOffline, setSimulateOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const reconnectHandlers = useRef(new Set());

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

  // Fire reconnect handlers on the offline -> online edge.
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
    }
    wasOffline.current = isOffline;
  }, [isOffline]);

  const onReconnect = useCallback((fn) => {
    reconnectHandlers.current.add(fn);
    return () => reconnectHandlers.current.delete(fn);
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
      onReconnect,
    }),
    [isOffline, browserOnline, simulateOffline, toggleSimulateOffline, pendingCount, onReconnect]
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used inside <OfflineProvider>');
  return ctx;
}
