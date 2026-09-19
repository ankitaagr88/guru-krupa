import { useEffect, useState } from 'react';
import { useTopbar } from '../../components/AppShell';
import DateStrip, { fmtDateLabel } from '../../components/DateStrip';
import { appointments as api, onDataChange } from '../../api';
import { dateStr } from '../../mocks/data';

const CHANNEL_LABEL = { whatsapp: 'WhatsApp', call: 'Call', walkin: 'Walk-in' };

/* Placeholder (F4 — Agent 2). Demonstrates DateStrip + counts wiring. */
export default function Appointments() {
  useTopbar({ sub: 'Appointments · booked via WhatsApp, call, or walk-in' });
  const [date, setDate] = useState(dateStr(0));
  const [counts, setCounts] = useState({});
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const load = () => {
      api
        .counts({ from: dateStr(-1), to: dateStr(6) })
        .then(setCounts)
        .catch(() => {});
      api
        .list({ date })
        .then((r) => setRows(r || []))
        .catch(() => {});
    };
    load();
    return onDataChange(load);
  }, [date]);

  return (
    <div className="appt-wrap">
      <div className="appt-head">
        <h2>{fmtDateLabel(date, true)}</h2>
      </div>
      <DateStrip value={date} onChange={setDate} counts={counts} />
      {rows.length === 0 ? (
        <div className="empty-slot">No appointments noted for this day</div>
      ) : (
        rows.map((a) => (
          <div className="appt-card" key={a.id}>
            <div className="appt-info">
              <div className="n">{a.name}</div>
              <div className="p">{a.phone}</div>
            </div>
            <span className={`channel-tag ${a.channel}`}>{CHANNEL_LABEL[a.channel] || a.channel}</span>
            <button className={`appt-checkin${a.checkedIn ? ' done' : ''}`} disabled={a.checkedIn}>
              {a.checkedIn ? 'Checked in' : 'Check in'}
            </button>
          </div>
        ))
      )}
      <p className="hint" style={{ marginTop: 18 }}>
        Coming soon — owned by Agent 2 (F4): add-appointment modal, check-in to queue.
      </p>
    </div>
  );
}
