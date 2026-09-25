import { useState } from 'react';

/* Surgery start and end time on the OT case (stored as operative.startTime / operative.endTime,
   "HH:MM"). They replace the old "Start surgery" / "Mark completed" buttons: the status follows the
   times — a start time makes the case In progress, an end time Completed, clearing them steps back.
   `onTimes(startTime, endTime)` saves both and moves the status; it resolves when done. */
const nowHM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const minutes = (hm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export function fmtTime(hm) {
  const t = minutes(hm);
  if (t == null) return '';
  const h = Math.floor(t / 60);
  return `${h % 12 || 12}:${String(t % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
export function duration(start, end) {
  const a = minutes(start);
  const b = minutes(end);
  if (a == null || b == null || b <= a) return '';
  const d = b - a;
  return d >= 60 ? `${Math.floor(d / 60)} h ${d % 60} min` : `${d} min`;
}

export default function SurgeryTimes({ k, canEdit, busy, onTimes }) {
  const o = k.operative || {};
  const start = o.startTime || '';
  const end = o.endTime || '';
  const [error, setError] = useState('');
  const cancelled = k.status === 'cancelled';
  const locked = !canEdit || cancelled || busy;

  const change = (nextStart, nextEnd) => {
    setError('');
    if (nextEnd && !nextStart) return setError('Enter the start time first.');
    if (nextStart && nextEnd && minutes(nextEnd) <= minutes(nextStart))
      return setError('End time must be after the start time.');
    return onTimes(nextStart, nextEnd);
  };

  const took = duration(start, end);
  return (
    <div className="ot-times" data-testid="ot-times">
      <div className="ot-time-field">
        <label htmlFor="otStartTime">Start time</label>
        <div className="ot-time-row">
          <input
            id="otStartTime"
            type="time"
            className="fake-input num"
            value={start}
            onChange={(e) => change(e.target.value, end)}
            disabled={locked}
          />
          {!locked && !start && (
            <button type="button" className="btn-ghost" onClick={() => change(nowHM(), end)}>
              Now
            </button>
          )}
        </div>
      </div>
      <div className="ot-time-field">
        <label htmlFor="otEndTime">End time</label>
        <div className="ot-time-row">
          <input
            id="otEndTime"
            type="time"
            className="fake-input num"
            value={end}
            onChange={(e) => change(start, e.target.value)}
            disabled={locked || !start}
          />
          {!locked && start && !end && (
            <button type="button" className="btn-ghost" onClick={() => change(start, nowHM())}>
              Now
            </button>
          )}
        </div>
      </div>
      {took && (
        <p className="ot-save-note" data-testid="ot-duration">
          Took {took}
        </p>
      )}
      {error && (
        <p className="ot-save-note err" role="alert">
          {error}
        </p>
      )}
      {!canEdit && !cancelled && <p className="ot-save-note">Times are entered by the doctor / OT staff.</p>}
    </div>
  );
}
