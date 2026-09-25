import { useCallback, useEffect, useRef, useState } from 'react';
import { billing as billingApi, errorMessage } from '../../api';
import { useToast } from '../../components/Toast';
import ReceivePayment from './ReceivePayment';
import { rupees, shortDate } from './money';
import './billing.css';

/* Money a patient still owes from earlier visits (lane M) — "₹60 still owed from 24 Sep" with a
   "Receive payment" action that opens the amount + mode box. Shown on the patient page (`variant`
   "card") and in the queue billing drawer ("notice", leaving out the visit being billed there:
   `excludeVisitId`). Renders nothing while nothing is owed. `onPaid` runs after a payment;
   `onRows(rows)` hears the list (the bill offers "Also collect old balance"). */
export default function OwedBalances({ patientId, excludeVisitId = null, variant = 'card', refreshKey, onPaid, onRows }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const tell = useRef(onRows);
  tell.current = onRows;
  useEffect(() => {
    tell.current?.(rows);
  }, [rows]);
  const [open, setOpen] = useState(null); // visitId whose "Receive payment" box is open
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (patientId == null || typeof billingApi.owing !== 'function') return Promise.resolve();
    return billingApi
      .owing(patientId)
      .then((list) => setRows((list || []).filter((o) => Number(o.visitId) !== Number(excludeVisitId))))
      .catch(() => setRows([]));
  }, [patientId, excludeVisitId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const receive = async (row, amount, mode) => {
    setBusy(true);
    try {
      const bill = await billingApi.receive(row.visitId, { amount, mode });
      toast.success(
        bill.balance > 0 ? `${rupees(amount)} received — ${rupees(bill.balance)} still owed` : `${rupees(amount)} received — paid in full`
      );
      setOpen(null);
      await load();
      onPaid?.(bill);
    } catch (err) {
      toast.error('Could not record the payment', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + Number(r.balance || 0), 0);
  const body = (
    <ul className="owed-list">
      {rows.map((r) => (
        <li key={r.visitId} data-testid="owed-row">
          <div className="owed-line">
            <span>
              <b className="mono">{rupees(r.balance)}</b> still owed from {shortDate(r.visitDate)}
              {r.paidAmount > 0 && (
                <small>
                  {' '}
                  · bill <span className="mono">{rupees(r.total)}</span>, paid{' '}
                  <span className="mono">{rupees(r.paidAmount)}</span>
                </small>
              )}
            </span>
            {open !== r.visitId && (
              <button type="button" className="btn-ghost sm" onClick={() => setOpen(r.visitId)} disabled={busy}>
                Receive payment
              </button>
            )}
          </div>
          {open === r.visitId && (
            <>
              <ReceivePayment balance={r.balance} busy={busy} onReceive={(amount, mode) => receive(r, amount, mode)} />
              <button type="button" className="link-btn" onClick={() => setOpen(null)}>
                Cancel
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );

  if (variant === 'notice')
    return (
      <div className="owed-notice" data-testid="owed-notice" role="status">
        {body}
      </div>
    );
  return (
    <section className="card patient-card-static owed-card" aria-labelledby="ph-owed" data-testid="owed-card">
      <h3 id="ph-owed" className="section-title">
        Money still owed · <span className="mono">{rupees(total)}</span>
      </h3>
      {body}
    </section>
  );
}
