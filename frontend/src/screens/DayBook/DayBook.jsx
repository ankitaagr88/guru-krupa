import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTopbar } from '../../components/AppShell';
import DateStrip, { fmtDateLabel } from '../../components/DateStrip';
import { useToast } from '../../components/Toast';
import { daybook as daybookApi, onDataChange, errorMessage } from '../../api';
import { dateStr } from '../../mocks/data';
import { modeLabel, rupees, shortDate, timeOf } from '../Billing/money';
import '../Today/today.css';
import './daybook.css';

/* Day book (lane M owns this screen) — the clinic's daily cash sheet on screen:
   # | Name | Phone | Age/Sex | Area | one money column per day-book column (Admin › Day book
   columns, e.g. OPD MED TEST GLASSES OT) | Total | Mode | Left. One row per visit that day (₹0
   visits too), OT cases under the OT column, and balances from earlier visits collected that day
   (marked "old balance"); the totals row under it. Below: the cash drawer (opening cash, + cash
   received, − cash taken out, = closing cash) with "Set opening cash" and "Cash taken out / put
   in", and the money received by mode. "Download Excel" gives the same sheet as a file.
   Data: `daybook.day(date)` (GET /daybook/{date}). Only cash payments touch the drawer. */

const OPENING_SOURCE = {
  set: (c) =>
    `set${c.openingSetBy ? ` by ${c.openingSetBy}` : ''}${c.openingSetAt ? ` at ${timeOf(c.openingSetAt)}` : ''}`,
  carried: () => 'the previous closing cash, carried forward',
  none: () => 'not set yet',
};

export default function DayBook() {
  const toast = useToast();
  const today = dateStr(0);
  const [date, setDate] = useState(today);
  const [book, setBook] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBook(await daybookApi.day(date));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [date]);

  useEffect(() => {
    setBook(null);
    load();
    const unsub = onDataChange(load);
    const t = date === today ? setInterval(load, 60000) : null;
    return () => {
      unsub();
      if (t) clearInterval(t);
    };
  }, [load, date, today]);

  useTopbar({ sub: `Day book · ${fmtDateLabel(date, true)}` });

  /** Cash-drawer writes answer with the whole day; show it. */
  const act = async (fn, okMsg, failTitle) => {
    setBusy(true);
    try {
      const next = await fn();
      if (next) setBook(next);
      if (okMsg) toast.success(okMsg);
      return true;
    } catch (err) {
      toast.error(failTitle, errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    try {
      const { blob, filename } = await daybookApi.download(date);
      if (typeof URL.createObjectURL !== 'function') return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error('Could not download the day book', errorMessage(err));
    }
  };

  return (
    <div className="appt-wrap today-wrap daybook-wrap">
      <div className="appt-head">
        <h2>{date === today ? "Today's day book" : `Day book for ${fmtDateLabel(date, true)}`}</h2>
        <div className="daybook-head-actions">
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
          <button type="button" className="btn-primary sm" onClick={download} disabled={!book}>
            Download Excel
          </button>
        </div>
      </div>
      <DateStrip value={date} onChange={setDate} from={-6} to={0} />

      {failed && !book && <p className="hint">Could not load the day book. Check the connection and try again.</p>}
      {!failed && !book && <p className="hint">Loading…</p>}

      {book && (
        <>
          <Sheet book={book} />
          <div className="today-grid daybook-grid">
            <CashDrawer book={book} date={date} busy={busy} act={act} />
            <ByMode book={book} />
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- the sheet ---------------- */
function Sheet({ book }) {
  const { heads, rows, totals } = book;
  const cell = (n) => (n ? Number(n).toLocaleString('en-IN') : '');
  return (
    <section className="today-card daybook-card" aria-labelledby="h-daybook-sheet">
      <h3 id="h-daybook-sheet">Patient list</h3>
      <p className="today-note">
        One row per visit (free visits show 0), surgeries under their column, and old balances collected on this
        day. Left is what is still owed now.
      </p>
      <div className="daybook-scroll" tabIndex={0} aria-label="Day book table, scrolls sideways">
        <table className="today-table daybook-table" data-testid="daybook-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Age/Sex</th>
              <th>Area</th>
              {heads.map((h) => (
                <th key={h.key} className="num daybook-head">
                  {h.label}
                </th>
              ))}
              <th className="num">Total</th>
              <th>Mode</th>
              <th className="num">Left</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8 + heads.length} className="today-note">
                  No patients on this day.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr
                key={`${r.kind}-${r.visitId ?? r.otCaseId ?? 'x'}-${i}`}
                className={`daybook-row ${r.kind}`}
                data-testid="daybook-row"
              >
                <td className="num mono">{i + 1}</td>
                <td className="today-name daybook-name">
                  {r.patientId != null ? <Link to={`/patients/${r.patientId}`}>{r.name}</Link> : r.name}
                  {r.kind === 'old_balance' && (
                    <span className="daybook-tag old">old balance · {shortDate(r.visitDate)}</span>
                  )}
                  {r.kind === 'ot' && <span className="daybook-tag ot">OT</span>}
                </td>
                <td className="mono daybook-nowrap">{r.phone || ''}</td>
                <td className="mono">{r.ageSex}</td>
                <td>{r.area}</td>
                {heads.map((h) => (
                  <td key={h.key} className="num mono">
                    {cell(r.amounts?.[h.key])}
                  </td>
                ))}
                <td className="num mono daybook-total">{Number(r.total || 0).toLocaleString('en-IN')}</td>
                <td className="daybook-nowrap">{r.modes.map(modeLabel).join(' + ')}</td>
                <td className={`num mono${r.left > 0 ? ' daybook-owed' : ''}`}>
                  {r.left < 0 ? `−${cell(-r.left)}` : Number(r.left || 0).toLocaleString('en-IN')}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="daybook-totals">
              <td></td>
              <td colSpan={4}>Total</td>
              {heads.map((h) => (
                <td key={h.key} className="num mono">
                  {Number(totals.amounts?.[h.key] || 0).toLocaleString('en-IN')}
                </td>
              ))}
              <td className="num mono">{Number(totals.total || 0).toLocaleString('en-IN')}</td>
              <td></td>
              <td className={`num mono${totals.left > 0 ? ' daybook-owed' : ''}`}>
                {Number(totals.left || 0).toLocaleString('en-IN')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ---------------- cash drawer ---------------- */
function CashDrawer({ book, date, busy, act }) {
  const cash = book.cash;
  const [form, setForm] = useState(null); // 'opening' | 'move' | null
  return (
    <section className="today-card" aria-labelledby="h-cash-drawer">
      <h3 id="h-cash-drawer">Cash drawer</h3>
      <p className="today-note">Only cash counts here — UPI, card and mediclaim are in the totals by mode.</p>
      <table className="today-table daybook-cash" data-testid="cash-box">
        <tbody>
          <tr>
            <td>
              Opening cash
              <small className="daybook-sub">{OPENING_SOURCE[cash.openingSource]?.(cash)}</small>
              {cash.openingNote && <small className="daybook-sub">{cash.openingNote}</small>}
            </td>
            <td className="num mono" data-testid="cash-opening">
              {rupees(cash.openingCash)}
            </td>
          </tr>
          <tr>
            <td>+ Cash received</td>
            <td className="num mono">+{rupees(cash.cashReceived)}</td>
          </tr>
          {cash.movements.map((m) => (
            <tr key={m.id} data-testid="cash-move">
              <td>
                {m.direction === 'in' ? '+ Put in' : '− Taken out'}
                {m.person ? ` · ${m.person}` : ''}
                {m.reason ? ` · ${m.reason}` : ''}
                <small className="daybook-sub">
                  {[m.byName, timeOf(m.at)].filter(Boolean).join(' · ')}{' '}
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    aria-label={`Undo ${m.direction === 'in' ? 'cash put in' : 'cash taken out'} ${rupees(m.amount)}${
                      m.person ? ` by ${m.person}` : ''
                    }`}
                    onClick={() =>
                      window.confirm('Remove this cash entry?') &&
                      act(() => daybookApi.removeMovement(date, m.id), 'Cash entry removed', 'Could not remove it')
                    }
                  >
                    Undo
                  </button>
                </small>
              </td>
              <td className="num mono">
                {m.direction === 'in' ? '+' : '−'}
                {rupees(m.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>= Closing cash</td>
            <td className="num mono" data-testid="cash-closing">
              {rupees(cash.closingCash)}
            </td>
          </tr>
        </tfoot>
      </table>
      {!form && (
        <div className="daybook-actions">
          <button type="button" className="btn-ghost" onClick={() => setForm('opening')} disabled={busy}>
            Set opening cash
          </button>
          <button type="button" className="btn-ghost" onClick={() => setForm('move')} disabled={busy}>
            Cash taken out / put in
          </button>
        </div>
      )}
      {form === 'opening' && (
        <OpeningForm
          cash={cash}
          busy={busy}
          onCancel={() => setForm(null)}
          onSave={async (body) =>
            (await act(() => daybookApi.setOpening(date, body), 'Opening cash saved', 'Could not save it')) &&
            setForm(null)
          }
        />
      )}
      {form === 'move' && (
        <MovementForm
          busy={busy}
          onCancel={() => setForm(null)}
          onSave={async (body) =>
            (await act(() => daybookApi.addMovement(date, body), 'Cash entry saved', 'Could not save it')) &&
            setForm(null)
          }
        />
      )}
    </section>
  );
}

function OpeningForm({ cash, busy, onSave, onCancel }) {
  const [amount, setAmount] = useState(String(cash.openingCash ?? 0));
  const [note, setNote] = useState(cash.openingNote || '');
  return (
    <form
      className="daybook-form"
      aria-label="Set opening cash"
      onSubmit={(e) => {
        e.preventDefault();
        if (amount === '') return;
        onSave({ openingCash: Math.round(Number(amount)), note: note.trim() });
      }}
    >
      <label>
        Opening cash (₹)
        <input
          className="fake-input mono"
          inputMode="numeric"
          aria-label="Opening cash"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
        />
      </label>
      <label>
        Note
        <input
          className="fake-input"
          aria-label="Opening cash note"
          placeholder="e.g. counted at 9:30"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="daybook-actions">
        <button type="submit" className="btn-primary sm" disabled={busy || amount === ''}>
          Save
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MovementForm({ busy, onSave, onCancel }) {
  const [direction, setDirection] = useState('out');
  const [amount, setAmount] = useState('');
  const [person, setPerson] = useState('');
  const [reason, setReason] = useState('');
  const [people, setPeople] = useState([]);
  useEffect(() => {
    let alive = true;
    daybookApi
      .people()
      .then((list) => alive && setPeople(list || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <form
      className="daybook-form"
      aria-label="Cash taken out or put in"
      onSubmit={(e) => {
        e.preventDefault();
        if (!Number(amount)) return;
        onSave({ direction, amount: Math.round(Number(amount)), person: person.trim(), reason: reason.trim() });
      }}
    >
      <div className="seg-toggle" role="group" aria-label="Taken out or put in">
        <button
          type="button"
          className={direction === 'out' ? 'active' : ''}
          aria-pressed={direction === 'out'}
          onClick={() => setDirection('out')}
        >
          Taken out
        </button>
        <button
          type="button"
          className={direction === 'in' ? 'active' : ''}
          aria-pressed={direction === 'in'}
          onClick={() => setDirection('in')}
        >
          Put in
        </button>
      </div>
      <label>
        Amount (₹)
        <input
          className="fake-input mono"
          inputMode="numeric"
          aria-label="Cash amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
        />
      </label>
      <label>
        Who
        <input
          className="fake-input"
          aria-label="Who took or gave it"
          list="cash-people"
          placeholder="e.g. MAAM"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        />
        <datalist id="cash-people">
          {people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label>
        Why
        <input
          className="fake-input"
          aria-label="Reason"
          placeholder="e.g. taken home, change for the day"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="daybook-actions">
        <button type="submit" className="btn-primary sm" disabled={busy || !Number(amount)}>
          Save
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ---------------- money by mode ---------------- */
function ByMode({ book }) {
  return (
    <section className="today-card" aria-labelledby="h-daybook-modes">
      <h3 id="h-daybook-modes">Money received by mode</h3>
      <p className="today-note">Every payment received on this day, bills and surgeries.</p>
      <table className="today-table" data-testid="daybook-modes">
        <thead>
          <tr>
            <th>Mode</th>
            <th className="num">Payments</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {book.byMode.map((m) => (
            <tr key={m.mode}>
              <td>{modeLabel(m.mode)}</td>
              <td className="num mono">{m.payments}</td>
              <td className="num mono">{rupees(m.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total received</td>
            <td className="num mono">{book.byMode.reduce((s, m) => s + m.payments, 0)}</td>
            <td className="num mono">{rupees(book.receivedTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
