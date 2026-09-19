import Placeholder from '../../components/Placeholder';
import { useOffline } from '../../offline/OfflineContext';

/* Placeholder (F5 — Agent 3). The offline demo toggle is wired to OfflineContext
   so the ConnectivityBanner can be exercised today (mockup `toggleDemoOffline`). */
export default function Machines() {
  const { simulateOffline, toggleSimulateOffline, isOffline } = useOffline();
  return (
    <Placeholder
      title="Machines"
      sub="Machines · capture a reading for any patient, any stage"
      owner="Agent 3"
      task="F5"
    >
      <p style={{ marginTop: 14 }}>
        <button
          className="stage-btn"
          style={{ display: 'inline-flex', width: 'auto' }}
          onClick={toggleSimulateOffline}
        >
          {simulateOffline ? 'End offline demo' : 'Simulate offline'}
        </button>
      </p>
      <p className="small-note" style={{ margin: '8px 0 0' }}>
        Currently {isOffline ? 'offline' : 'online'}.
      </p>
    </Placeholder>
  );
}
