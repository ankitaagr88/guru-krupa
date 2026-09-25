import { useEffect, useState } from 'react';
import { PAYMENT_MODES } from '../Queue/queueModel';
import { rupees } from './money';

/* "Receive payment" (lane M): the amount (starts at the balance — change it for a part payment)
   and one button per payment mode; tapping a mode receives that amount in that mode. Used on the
   bill, for an old balance in the billing drawer and on the patient page.
   `onReceive(amount, mode)` returns a promise; the box stays as it is when it rejects. */
export default function ReceivePayment({ balance, onReceive, busy = false, label }) {
  const [draft, setDraft] = useState(String(balance || ''));
  const [error, setError] = useState('');
  useEffect(() => setDraft(String(balance || '')), [balance]);

  const take = async (mode) => {
    const n = Math.round(Number(draft));
    if (!n || n < 1) {
      setError('Type the amount received.');
      return;
    }
    if (n > balance) {
      setError(`That is more than the ${rupees(balance)} still owed.`);
      return;
    }
    setError('');
    await onReceive(n, mode);
  };

  return (
    <div className="pay-box" data-testid="receive-payment">
      <div className="pay-row">
        <label className="pay-amount">
          <span>{label || 'Receive'}</span>
          <span className="bill-amount">
            ₹
            <input
              type="text"
              inputMode="numeric"
              aria-label="Amount received"
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
            />
          </span>
        </label>
        <span className="pay-by">by</span>
      </div>
      <div className="channel-toggle pay-modes" role="group" aria-label="Payment mode">
        {PAYMENT_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className="channel-opt walkin"
            data-pay={m.key}
            onClick={() => take(m.key)}
            disabled={busy}
          >
            {m.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="pay-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
