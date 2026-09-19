import { useEffect, useState } from 'react';
import { useOffline } from '../offline/OfflineContext';

/* Mockup `renderConnectivityBanner` — shows when offline (real or simulated),
   plus a brief "back online" flash. `pendingCount` is set by the Machines
   screen for queued captures. The dev toggle lives in the Machines screen
   (`toggleSimulateOffline` from useOffline); this banner just reflects it. */
export default function ConnectivityBanner() {
  const { isOffline, simulateOffline, setSimulateOffline, pendingCount } = useOffline();
  const [backOnline, setBackOnline] = useState(false);
  const [prev, setPrev] = useState(isOffline);

  useEffect(() => {
    if (prev && !isOffline) {
      setBackOnline(true);
      const t = setTimeout(() => setBackOnline(false), 3000);
      return () => clearTimeout(t);
    }
    setPrev(isOffline);
  }, [isOffline, prev]);

  useEffect(() => {
    setPrev(isOffline);
  }, [isOffline]);

  if (isOffline) {
    return (
      <div className="connectivity-banner" role="status" data-testid="connectivity-banner">
        <span>
          ⚠ No connection — photos will save on this device and process automatically once you&apos;re back
          online
          {pendingCount > 0 ? ` · ${pendingCount} waiting` : ''}
        </span>
        {simulateOffline && <button onClick={() => setSimulateOffline(false)}>End offline demo</button>}
      </div>
    );
  }
  if (backOnline) {
    return (
      <div className="connectivity-banner back-online" role="status" data-testid="connectivity-banner">
        <span>
          ✓ Back online
          {pendingCount > 0
            ? ` — processing ${pendingCount} queued capture${pendingCount === 1 ? '' : 's'}…`
            : ''}
        </span>
      </div>
    );
  }
  return null;
}
