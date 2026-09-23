import { useEffect, useRef, useState } from 'react';
import { useToast } from '../../components/Toast';
import { billing as billingApi, errorMessage } from '../../api';
import { PAYMENT_MODES, normalizeBill } from './queueModel';

/* Bill panel for the billing stage (mockup `renderBilling` / `addBillItem` /
   `removeBillItem` / `selectPaymentMode`). Self-contained (lane B owns it): loads and
   saves the visit's bill itself. The drawer only passes the visit and hears back which
   payment mode was picked (`onPaymentMode`) for its "Mark visit complete" button.
   `fallbackBill` is the bill embedded in the queue row, shown until the fetch lands;
   `refreshKey` bumps after every board reload. */
export default function BillingPanel({ visitId, fallbackBill, refreshKey, onPaymentMode, busy = false }) {
  const toast = useToast();
  const [bill, setBill] = useState(() => normalizeBill(fallbackBill));
  const report = useRef(onPaymentMode);
  report.current = onPaymentMode;

  useEffect(() => {
    let alive = true;
    billingApi
      .get(visitId)
      .then((b) => alive && setBill(normalizeBill(b)))
      .catch(() => alive && setBill(normalizeBill(fallbackBill)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId, refreshKey]);

  useEffect(() => {
    report.current?.(bill?.paymentMode || null);
  }, [bill?.paymentMode]);

  const saveBill = async (next, { pay = false } = {}) => {
    const prev = bill;
    setBill(next);
    try {
      const body = {
        items: next.items.map((it) => ({ label: it.label, amount: Math.round(Number(it.amount) || 0) })),
      };
      if (next.paymentMode) body.paymentMode = next.paymentMode;
      let saved = await billingApi.save(visitId, body);
      if (pay && next.paymentMode) saved = await billingApi.pay(visitId, next.paymentMode);
      if (saved) setBill(normalizeBill({ ...next, ...saved }));
    } catch (err) {
      setBill(prev);
      toast.error('Could not save bill', errorMessage(err));
    }
  };
  const onItems = (items) => saveBill({ ...bill, items });
  const onPaymentModePick = (mode) => saveBill({ ...bill, paymentMode: mode }, { pay: true });

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const items = bill?.items || [];
  const total = items.reduce((s, it) => s + Number(it.amount || 0), 0);

  const add = () => {
    const l = label.trim();
    const a = parseFloat(amount);
    if (!l || Number.isNaN(a)) {
      setError('Add both an item name and an amount.');
      return;
    }
    setError('');
    onItems([...items, { label: l, amount: Math.round(a) }]);
    setLabel('');
    setAmount('');
  };
  const remove = (i) => onItems(items.filter((_, j) => j !== i));

  return (
    <div id="billingSection">
      <div className="field-label">Bill</div>
      {items.length > 0 && (
        <table className="data-table" id="billTable" style={{ marginBottom: 8 }}>
          <tbody id="billItems">
            {items.map((it, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td>{it.label}</td>
                <td
                  data-label="Amount"
                  style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500 }}
                >
                  ₹{it.amount}
                </td>
                <td className="no-label" style={{ width: '1%' }}>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Remove ${it.label}`}
                    disabled={busy}
                    style={{ background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="bill-total" id="billTotal">
        <span>Total</span>
        <span>₹{total}</span>
      </div>
      <div className="bill-add-row">
        <input
          className="fake-input"
          id="billItemLabel"
          placeholder="Item — e.g. Consultation fee"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          style={{ marginBottom: 0 }}
        />
        <input
          className="fake-input"
          id="billItemAmount"
          placeholder="₹"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          inputMode="decimal"
          style={{ marginBottom: 0, width: 80 }}
        />
        <button type="button" className="med-add-btn" onClick={add} disabled={busy}>
          Add
        </button>
      </div>
      {error && (
        <p className="hint" style={{ color: 'var(--alert-ink)', margin: '6px 0 0' }}>
          {error}
        </p>
      )}
      <p className="label" style={{ margin: '14px 0 6px' }}>
        Payment mode
      </p>
      <div className="channel-toggle" id="paymentToggle">
        {PAYMENT_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`channel-opt walkin${bill?.paymentMode === m.key ? ' active' : ''}`}
            data-pay={m.key}
            onClick={() => onPaymentModePick(m.key)}
            disabled={busy}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
