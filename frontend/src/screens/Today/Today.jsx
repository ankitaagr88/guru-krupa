import { useCallback, useEffect, useState } from 'react';
import { useTopbar } from '../../components/AppShell';
import DateStrip, { fmtDateLabel } from '../../components/DateStrip';
import { useToast } from '../../components/Toast';
import { billing as billingApi, reports as reportsApi, onDataChange, errorMessage } from '../../api';
import { dateStr } from '../../mocks/data';
import { PAYMENT_MODES } from '../Queue/queueModel';
import ReceiptPrint from '../Billing/Receipt';
import './today.css';

/* "Today" summary (lane B owns this screen): patients seen, average time per stage,
   collections by payment mode, medicines sold — so "more patients per day" is measurable.
   Data: `reports.today(date)` (GET /reports/today). Pick an earlier day from the strip or
   the date box. Receipts can be printed again from here. */

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function minutes(m) {
  if (m == null) return '—';
  const r = Math.round(Number(m));
  if (r < 60) return `${r} min`;
  return `${Math.floor(r / 60)} h ${r % 60} min`;
}

const modeLabel = (k) => PAYMENT_MODES.find((m) => m.key === k)?.label || k || '—';
const timeOf = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—';

export default function Today() {
  const toast = useToast();
  const today = dateStr(0);
  const [date, setDate] = useState(today);
  const [rep, setRep] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [printing, setPrinting] = useState(null);

  const load = useCallback(async () => {
    try {
      setRep(await reportsApi.today(date));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    setLoading(true);
    load();
    const unsub = onDataChange(load);
    const t = date === today ? setInterval(load, 60000) : null;
    return () => {
      unsub();
      if (t) clearInterval(t);
    };
  }, [load, date, today]);

  useTopbar({ sub: `Summary · ${fmtDateLabel(date, true)}` });

  const reprint = async (visitId) => {
    try {
      setPrinting(await billingApi.get(visitId));
    } catch (err) {
      toast.error('Could not load the bill', errorMessage(err));
    }
  };

  const p = rep?.patients || { registered: 0, seen: 0, inProgress: 0 };
  const money = rep?.collections;

  return (
    <div className="appt-wrap today-wrap">
      <div className="appt-head">
        <h2>{date === today ? "Today's summary" : `Summary for ${fmtDateLabel(date, true)}`}</h2>
        <label className="today-pick">
          Another day
          <input
            type="date"
            className="fake-input"
            value={date}
            max={today}
            aria-label="Pick a day"
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
      </div>
      <DateStrip value={date} onChange={setDate} from={-6} to={0} />

      {failed && !rep && (
        <p className="hint">Could not load the summary. Check the connection and try again.</p>
      )}
      {loading && !rep && !failed && <p className="hint">Loading…</p>}

      {rep && (
        <>
          <div className="today-tiles" data-testid="today-tiles">
            <StatTile
              label="Patients seen"
              value={p.seen}
              sub={`of ${p.registered} registered${p.inProgress ? ` · ${p.inProgress} still in the queue` : ''}`}
            />
            <StatTile
              label="Average time per visit"
              value={minutes(rep.avgVisitMinutes)}
              sub="registration to done"
            />
            <StatTile
              label="Money collected"
              value={rupees(money.total)}
              sub={`${money.billsPaid} bill${money.billsPaid === 1 ? '' : 's'} paid${
                money.unpaidTotal ? ` · ${rupees(money.unpaidTotal)} unpaid` : ''
              }`}
            />
            <StatTile
              label="Medicines sold"
              value={rep.medicinesQty}
              sub={`pack${rep.medicinesQty === 1 ? '' : 's'} · ${rupees(rep.medicinesAmount)}`}
            />
          </div>

          <div className="today-grid">
            <section className="today-card" aria-labelledby="h-stage-time">
              <h3 id="h-stage-time">Time spent in each stage</h3>
              <p className="today-note">
                Average minutes per patient, from entering a stage to leaving it. Patients still in a stage
                are shown as waiting and are not in the average.
              </p>
              <StageBars stages={rep.stages} />
            </section>

            <section className="today-card" aria-labelledby="h-collections">
              <h3 id="h-collections">Money collected by payment mode</h3>
              <table className="today-table" data-testid="collections">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th className="num">Bills</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {money.byMode.map((m) => (
                    <tr key={m.mode}>
                      <td>{modeLabel(m.mode)}</td>
                      <td className="num mono">{m.bills}</td>
                      <td className="num mono">{rupees(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num mono">{money.billsPaid}</td>
                    <td className="num mono">{rupees(money.total)}</td>
                  </tr>
                </tfoot>
              </table>
              {money.unpaid.length > 0 && (
                <div className="today-unpaid" data-testid="unpaid">
                  <h4>
                    Not paid yet · <span className="mono">{rupees(money.unpaidTotal)}</span>
                  </h4>
                  <ul>
                    {money.unpaid.map((u) => (
                      <li key={u.visitId}>
                        <span className="mono">{u.token}</span> <b>{u.name}</b>
                        <span className="mono">{rupees(u.total)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>

          <div className="today-grid">
            <section className="today-card" aria-labelledby="h-meds-sold">
              <h3 id="h-meds-sold">Medicines sold</h3>
              {rep.medicines.length === 0 ? (
                <p className="today-note">No medicines bought here on this day.</p>
              ) : (
                <table className="today-table" data-testid="medicines-sold">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th className="num">Packs</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rep.medicines.map((m) => (
                      <tr key={m.name}>
                        <td>{m.name}</td>
                        <td className="num mono">{m.qty}</td>
                        <td className="num mono">{rupees(m.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num mono">{rep.medicinesQty}</td>
                      <td className="num mono">{rupees(rep.medicinesAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </section>

            <section className="today-card" aria-labelledby="h-receipts">
              <h3 id="h-receipts">Receipts</h3>
              {rep.receipts.length === 0 ? (
                <p className="today-note">No bills paid on this day.</p>
              ) : (
                <table className="today-table today-receipts" data-testid="receipts">
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Time</th>
                      <th>Patient</th>
                      <th>Mode</th>
                      <th className="num">Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rep.receipts.map((r, i) => (
                      <tr key={r.receiptNo || i}>
                        <td className="mono">{r.receiptNo || '—'}</td>
                        <td className="mono">{timeOf(r.paidAt)}</td>
                        <td className="today-name">{r.name}</td>
                        <td>{modeLabel(r.paymentMode)}</td>
                        <td className="num mono">{rupees(r.total)}</td>
                        <td className="num">
                          {r.visitId != null && (
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => reprint(r.visitId)}
                              aria-label={`Print receipt ${r.receiptNo || ''} again`}
                            >
                              Print again
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
      {printing && <ReceiptPrint bill={printing} onDone={() => setPrinting(null)} />}
    </div>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value mono">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/* One horizontal bar per stage (single series, so no legend): the bar is the average
   minutes, the number sits at its tip, the visit count and who is waiting now underneath.
   Hovering or focusing a row shows the full sentence. */
function StageBars({ stages }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...stages.map((s) => Number(s.avgMinutes) || 0));
  return (
    <ul className="stage-bars" data-testid="stage-bars">
      {stages.map((s) => {
        const pct = s.avgMinutes ? Math.max(2, (Number(s.avgMinutes) / max) * 100) : 0;
        const tip = s.avgMinutes
          ? `${s.label}: ${minutes(s.avgMinutes)} on average over ${s.visits} patient${s.visits === 1 ? '' : 's'}`
          : `${s.label}: no patient has left this stage yet`;
        return (
          <li
            key={s.key}
            className="stage-bar-row"
            tabIndex={0}
            aria-label={`${tip}${s.waitingNow ? `; ${s.waitingNow} waiting now` : ''}`}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(s.key)}
            onBlur={() => setHover(null)}
            data-testid={`stage-bar-${s.key}`}
          >
            <span className="stage-bar-label">{s.label}</span>
            <span className="stage-bar-track">
              {pct > 0 && (
                <span className="stage-bar-fill" style={{ width: `calc((100% - 76px) * ${pct / 100})` }} />
              )}
              <span className="stage-bar-value mono">{minutes(s.avgMinutes)}</span>
              {hover === s.key && (
                <span className="stage-bar-tip" role="tooltip">
                  {tip}
                </span>
              )}
            </span>
            <span className="stage-bar-sub">
              <span className="mono">{s.visits}</span> patient{s.visits === 1 ? '' : 's'}
              {s.waitingNow > 0 && (
                <>
                  {' · '}
                  <span className="mono">{s.waitingNow}</span> waiting now
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
