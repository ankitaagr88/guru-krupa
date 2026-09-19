import { dateStr } from '../mocks/data';

/* 7-day strip (mockup `buildDateStrip` / `fmtDateLabel`): yesterday → +6 days,
   with optional per-day counts ({ 'YYYY-MM-DD': n }). Used by Appointments and OT.
     <DateStrip value={date} onChange={setDate} counts={counts} /> */

export function fmtDateLabel(ds, forHeading = false) {
  const d = new Date(ds + 'T00:00:00');
  const today = dateStr(0);
  const tomorrow = dateStr(1);
  const dow = d.toLocaleDateString('en-IN', { weekday: 'short' });
  const dnum = d.getDate();
  if (forHeading) {
    const long = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
    if (ds === today) return 'Today · ' + long;
    if (ds === tomorrow) return 'Tomorrow · ' + long;
    return long;
  }
  return { dow: ds === today ? 'Today' : ds === tomorrow ? 'Tmrw' : dow, dnum };
}

export function stripDates(from = -1, to = 6) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(dateStr(i));
  return out;
}

export default function DateStrip({ value, onChange, counts = {}, from = -1, to = 6, showZero = false }) {
  const days = stripDates(from, to);
  return (
    <div className="date-strip" role="tablist" aria-label="Pick a day">
      {days.map((ds) => {
        const lbl = fmtDateLabel(ds, false);
        const n = counts[ds] || 0;
        const active = ds === value;
        return (
          <button
            key={ds}
            type="button"
            role="tab"
            aria-selected={active}
            className={`date-pill${active ? ' active' : ''}`}
            onClick={() => onChange?.(ds)}
            data-date={ds}
          >
            <div className="dow">{lbl.dow}</div>
            <div className="dnum">{lbl.dnum}</div>
            {(n > 0 || showZero) && <span className="dcount">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
