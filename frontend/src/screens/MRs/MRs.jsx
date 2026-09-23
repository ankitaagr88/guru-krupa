import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTopbar } from '../../components/AppShell';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { mr as mrApi, onDataChange, errorMessage } from '../../api';
import './mrs.css';
import PhoneInput from '../../components/PhoneInput';

/* MR visits (mockup renderMRs / openMrModal / addMrVisit / openMrDetail /
   closeMrDetail) with a rep/company filter, the rep summary from
   GET /mr-visits/reps and a "next visit due" indicator (B10). */

const ISO = /^\d{4}-\d{2}-\d{2}/;
const dateStr = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

/** Days from today to an ISO date (negative = past). null for free-text dates. */
export function daysFromToday(s, today = dateStr(0)) {
  if (!s || !ISO.test(s)) return null;
  return Math.round((new Date(s.slice(0, 10) + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
}

export function fmtVisitDate(s) {
  const d = daysFromToday(s);
  if (d == null) return s || '—';
  if (d === 0) return 'Today';
  if (d === -1) return 'Yesterday';
  if (d === 1) return 'Tomorrow';
  if (d < 0 && d > -30) return `${-d} days ago`;
  if (d > 0 && d < 30) return `in ${d} days`;
  return new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Next-visit-due indicator: {cls, text} */
export function dueStatus(next) {
  if (!next) return { cls: '', text: 'not set' };
  const d = daysFromToday(next);
  if (d == null) return { cls: 'plain', text: next };
  if (d < 0) return { cls: 'coral', text: `Overdue · ${fmtVisitDate(next)}` };
  if (d === 0) return { cls: 'coral', text: 'Due today' };
  if (d <= 7) return { cls: 'amber', text: `Due ${fmtVisitDate(next)}` };
  return { cls: 'plain', text: fmtVisitDate(next) };
}

const sortNewest = (rows) =>
  [...rows].sort((a, b) => {
    const da = ISO.test(a.visitDate || '') ? a.visitDate : '';
    const db = ISO.test(b.visitDate || '') ? b.visitDate : '';
    if (da !== db) return db.localeCompare(da);
    return (b.id || 0) - (a.id || 0);
  });

export default function MRs() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [reps, setReps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(false);
  const [detailRep, setDetailRep] = useState(null);

  const load = useCallback(async () => {
    try {
      const [v, r] = await Promise.all([mrApi.list(), mrApi.reps().catch(() => [])]);
      setRows(sortNewest(v || []));
      setReps(r || []);
    } catch (err) {
      toast.error('Could not load MR visits', errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    return onDataChange(load);
  }, [load]);

  const dueCount = reps.filter((r) => ['coral', 'amber'].includes(dueStatus(r.nextVisitDate).cls)).length;
  useTopbar({
    sub: `Medical representative visits · ${reps.length} rep${reps.length === 1 ? '' : 's'}${dueCount ? ` · ${dueCount} due soon` : ''}`,
    actions: (
      <button className="btn-primary" onClick={() => setModal(true)} type="button">
        + Log MR visit
      </button>
    ),
  });

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (v) =>
        (v.repName || '').toLowerCase().includes(s) ||
        (v.company || '').toLowerCase().includes(s) ||
        (v.products || '').toLowerCase().includes(s)
    );
  }, [rows, q]);

  return (
    <div className="appt-wrap mr-wrap">
      <div className="appt-head">
        <h2>Medical representative visits</h2>
        <input
          className="fake-input mr-filter"
          placeholder="Filter by rep, company or product…"
          aria-label="Filter visits"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <table className="data-table" id="mrTable">
        <thead>
          <tr>
            <th>Rep</th>
            <th>Company</th>
            <th>Phone</th>
            <th>Products</th>
            <th>Visit</th>
            <th>Next visit</th>
          </tr>
        </thead>
        <tbody id="mrList">
          {loading && (
            <tr>
              <td colSpan={6} className="empty-slot">
                Loading…
              </td>
            </tr>
          )}
          {!loading && shown.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-slot">
                {rows.length === 0 ? 'No MR visits logged yet' : 'No visits match'}
              </td>
            </tr>
          )}
          {shown.map((v) => {
            const due = dueStatus(v.nextVisitDate);
            return (
              <tr key={v.id} onClick={() => setDetailRep(v.repName)}>
                <td className="td-name mr-rep-link">{v.repName}</td>
                <td data-label="Company">{v.company}</td>
                <td data-label="Phone">{v.phone || '—'}</td>
                <td data-label="Products">
                  {v.products || '—'}
                  {v.notes && <span className="mr-note">{v.notes}</span>}
                </td>
                <td data-label="Visit">{fmtVisitDate(v.visitDate)}</td>
                <td data-label="Next visit">
                  {due.cls === 'coral' || due.cls === 'amber' ? (
                    <span className={`status-pill ${due.cls}`}>{due.text}</span>
                  ) : (
                    due.text
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <MrVisitModal
        open={modal}
        reps={reps}
        onClose={() => setModal(false)}
        onSaved={async () => {
          setModal(false);
          await load();
        }}
      />
      <MrDetail repName={detailRep} reps={reps} onClose={() => setDetailRep(null)} />
    </div>
  );
}

function MrVisitModal({ open, reps, onClose, onSaved }) {
  const toast = useToast();
  const empty = {
    repName: '',
    company: '',
    phone: '',
    products: '',
    visitDate: dateStr(0),
    nextVisitDate: '',
    notes: '',
  };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({ ...empty, visitDate: dateStr(0) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onRepName = (repName) => {
    const known = reps.find((r) => r.repName.toLowerCase() === repName.trim().toLowerCase());
    setF((cur) => ({
      ...cur,
      repName,
      company: known && !cur.company ? known.company : cur.company,
      phone: known && !cur.phone ? known.phone || '' : cur.phone,
    }));
  };

  const submit = async () => {
    if (!f.repName.trim() || !f.company.trim()) {
      toast.error('Add at least a rep name and company.');
      return;
    }
    setBusy(true);
    try {
      await mrApi.create({
        repName: f.repName.trim(),
        company: f.company.trim(),
        phone: f.phone.trim(),
        products: f.products.trim(),
        visitDate: f.visitDate || dateStr(0),
        nextVisitDate: f.nextVisitDate || undefined,
        notes: f.notes.trim() || undefined,
      });
      toast.success('MR visit logged', `${f.repName.trim()} · ${f.company.trim()}`);
      await onSaved();
    } catch (err) {
      toast.error('Could not save the visit', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      id="mrModalOverlay"
      title="Log MR visit"
      sub="Keep a record of pharma reps who've visited and what they discussed."
      onClose={onClose}
      actions={
        <>
          <button className="btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn-primary full" onClick={submit} disabled={busy} type="button">
            {busy ? 'Saving…' : 'Save visit'}
          </button>
        </>
      }
    >
      <input
        className="fake-input"
        id="mrRepName"
        list="mrRepNames"
        placeholder="Rep name"
        aria-label="Rep name"
        value={f.repName}
        onChange={(e) => onRepName(e.target.value)}
        autoFocus
      />
      <datalist id="mrRepNames">
        {reps.map((r) => (
          <option key={r.repName} value={r.repName}>
            {r.company}
          </option>
        ))}
      </datalist>
      <input
        className="fake-input"
        id="mrCompany"
        placeholder="Company"
        aria-label="Company"
        value={f.company}
        onChange={(e) => setF({ ...f, company: e.target.value })}
      />
      <PhoneInput id="mrPhone" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
      <input
        className="fake-input"
        id="mrProducts"
        placeholder="Products discussed (comma separated)"
        aria-label="Products discussed"
        value={f.products}
        onChange={(e) => setF({ ...f, products: e.target.value })}
      />
      <div className="mr-dates">
        <label>
          Visit date
          <input
            className="fake-input"
            id="mrVisitDate"
            type="date"
            aria-label="Visit date"
            value={f.visitDate}
            onChange={(e) => setF({ ...f, visitDate: e.target.value })}
          />
        </label>
        <label>
          Next visit (optional)
          <input
            className="fake-input"
            id="mrNextVisit"
            type="date"
            aria-label="Next visit date"
            min={f.visitDate}
            value={f.nextVisitDate}
            onChange={(e) => setF({ ...f, nextVisitDate: e.target.value })}
          />
        </label>
      </div>
      <textarea
        className="fake-input"
        id="mrNotes"
        rows={2}
        placeholder="Notes (optional) — samples left, offers, follow-ups"
        aria-label="Notes"
        value={f.notes}
        onChange={(e) => setF({ ...f, notes: e.target.value })}
      />
    </Modal>
  );
}

function MrDetail({ repName, reps, onClose }) {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!repName) return;
    let cancelled = false;
    setLoading(true);
    mrApi
      .list({ rep: repName })
      .then((v) => !cancelled && setVisits(sortNewest(v || [])))
      .catch(() => !cancelled && setVisits([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repName]);
  if (!repName) return null;
  const rep = reps.find((r) => r.repName === repName) || visits[0] || {};
  const products = [];
  visits.forEach((v) =>
    (v.products || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((m) => {
        if (!products.includes(m)) products.push(m);
      })
  );
  const next = rep.nextVisitDate || visits.find((v) => v.nextVisitDate)?.nextVisitDate;
  const due = dueStatus(next);
  const count = typeof rep.visits === 'number' ? rep.visits : visits.length;
  return (
    <Modal
      open
      id="mrDetailModalOverlay"
      onClose={onClose}
      className="mr-detail"
      actions={
        <button className="btn-ghost" style={{ flex: 1 }} onClick={onClose} type="button">
          Close
        </button>
      }
    >
      <div className="mr-detail-scroll">
        <div className="field-label" style={{ marginTop: 0 }}>
          {repName}
        </div>
        <p className="mr-detail-sub">
          {rep.company}
          {rep.phone ? ' · ' + rep.phone : ''}
        </p>
        <div className="mr-detail-stats">
          <span>
            <b>{count}</b> visit{count === 1 ? '' : 's'}
          </span>
          <span>
            Last: <b>{fmtVisitDate(rep.lastVisitDate || visits[0]?.visitDate)}</b>
          </span>
          <span>
            Next:{' '}
            {due.cls === 'coral' || due.cls === 'amber' ? (
              <span className={`status-pill ${due.cls}`}>{due.text}</span>
            ) : (
              <b>{due.text}</b>
            )}
          </span>
        </div>
        <div className="summary-card">
          <div className="summary-card-title">Medicines supplied (all visits)</div>
          {products.length === 0 ? (
            <div className="summary-line">None recorded</div>
          ) : (
            products.map((m) => (
              <div className="summary-line" key={m}>
                {m}
              </div>
            ))
          )}
        </div>
        <div className="field-label">Visit history ({visits.length})</div>
        {loading && <p className="small-note">Loading…</p>}
        {visits.map((v) => (
          <div className="reading-card" key={v.id}>
            <div className="reading-head">
              <span className="m">{fmtVisitDate(v.visitDate)}</span>
              {v.nextVisitDate && <span className="src">Next: {fmtVisitDate(v.nextVisitDate)}</span>}
            </div>
            <div className="summary-line" style={{ marginTop: 6 }}>
              <b>Products:</b> {v.products || '—'}
            </div>
            {v.notes && <div className="summary-line">{v.notes}</div>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
