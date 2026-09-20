import { useState } from 'react';
import { PAYMENT_MODES } from './queueModel';

/* Bill panel for the billing stage (mockup `renderBilling` / `addBillItem` /
   `removeBillItem` / `selectPaymentMode`). Controlled by the drawer: `bill` is the
   normalised bill, `onChange({items, paymentMode})` persists it. */
export default function BillingPanel({ bill, onItems, onPaymentMode, busy = false }) {
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
            onClick={() => onPaymentMode(m.key)}
            disabled={busy}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
