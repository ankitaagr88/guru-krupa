import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../../components/Toast';
import { billing as billingApi, errorMessage } from '../../api';
import { PAYMENT_MODES, normalizeBill } from './queueModel';
import ReceiptPrint from '../Billing/Receipt';
import { BILL_CHANGED } from '../Billing/billEvents';
import { rupees } from './visitKind';
import '../Billing/billing.css';
import './visitKind.css';

/* Bill panel for the billing stage (mockup `renderBilling` / `addBillItem` /
   `removeBillItem` / `selectPaymentMode`). Self-contained (lane B owns it): loads and
   saves the visit's bill itself. The drawer only passes the visit and hears back which
   payment mode was picked (`onPaymentMode`) for its "Mark visit complete" button.
   `fallbackBill` is the bill embedded in the queue row, shown until the fetch lands;
   `refreshKey` bumps after every board reload.

   Works like a till: one tap adds a standard charge (Admin › Standard charges); "Bought
   here" in the medicines panel above puts the medicine on the bill on the server and
   announces it with a `gk:bill-changed` window event, so the panel reloads. Every amount
   can be changed (a discount, or a medicine that has no price yet). Paying gives the bill
   a receipt number and a "Print receipt" button.

   Visit fees (lane E2): a visit with no bill yet gets one started on the server with its visit
   kind's fee (and Emergency when flagged) already on it, marked "Suggested" — reception can
   remove or change it; changing the visit type in the drawer swaps that line. Chips sit under
   their Admin heading (Visit fees / Tests / Packages); a test priced per eye asks "One eye /
   Both eyes" and the line reads "Perimetry — both eyes". */

const itemBody = (it) => ({
  label: it.label,
  amount: Math.max(0, Math.round(Number(it.amount) || 0)),
  kind: it.kind || 'other',
  qty: Math.max(1, Number(it.qty) || 1),
  standardChargeId: it.standardChargeId ?? null,
  prescriptionLineId: it.prescriptionLineId ?? null,
  eyes: it.eyes ?? null,
});

const EYES = { one: 'one eye', both: 'both eyes' };

/** Charges in admin order, under their headings (first appearance decides the heading order). */
function groupCharges(charges) {
  const groups = [];
  charges.forEach((ch) => {
    const heading = (ch.groupLabel || '').trim();
    let g = groups.find((x) => x.heading === heading);
    if (!g) groups.push((g = { heading, charges: [] }));
    g.charges.push(ch);
  });
  return groups;
}

/** GET the bill; none yet -> start it with the visit's suggested fee lines. */
const fetchBill = (visitId) =>
  billingApi.get(visitId).catch((err) => {
    if (err?.response?.status === 404 && typeof billingApi.start === 'function') return billingApi.start(visitId);
    throw err;
  });

export default function BillingPanel({ visitId, fallbackBill, refreshKey, onPaymentMode, busy = false }) {
  const toast = useToast();
  const [bill, setBill] = useState(() => normalizeBill(fallbackBill));
  const [charges, setCharges] = useState([]);
  const [printing, setPrinting] = useState(null);
  const report = useRef(onPaymentMode);
  report.current = onPaymentMode;

  const [eyesFor, setEyesFor] = useState(null); // the eye-wise charge waiting for "one / both eyes"
  const load = useCallback(
    () =>
      fetchBill(visitId)
        .then((b) => setBill(normalizeBill(b)))
        .catch((err) => {
          if (err?.response?.status === 404) setBill((b) => b || normalizeBill(null));
        }),
    [visitId]
  );

  useEffect(() => {
    let alive = true;
    fetchBill(visitId)
      .then((b) => alive && setBill(normalizeBill(b)))
      .catch(() => alive && setBill(normalizeBill(fallbackBill)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId, refreshKey]);

  useEffect(() => {
    const onChanged = (e) => {
      if (Number(e.detail?.visitId) === Number(visitId)) load();
    };
    window.addEventListener(BILL_CHANGED, onChanged);
    return () => window.removeEventListener(BILL_CHANGED, onChanged);
  }, [visitId, load]);

  useEffect(() => {
    let alive = true;
    (billingApi.charges ? billingApi.charges() : Promise.resolve([]))
      .then((rows) => alive && setCharges(rows || []))
      .catch(() => alive && setCharges([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    report.current?.(bill?.paymentMode || null);
  }, [bill?.paymentMode]);

  const saveBill = async (next, { pay = false } = {}) => {
    const prev = bill;
    setBill(next);
    try {
      const body = { items: next.items.map(itemBody) };
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
  const unpriced = items.filter(
    (it) => it.priceMissing ?? (it.kind === 'medicine' && Number(it.amount) === 0)
  );

  const add = () => {
    const l = label.trim();
    const a = parseFloat(amount);
    if (!l || Number.isNaN(a)) {
      setError('Add both an item name and an amount.');
      return;
    }
    setError('');
    onItems([...items, { label: l, amount: Math.round(a), kind: 'other', qty: 1 }]);
    setLabel('');
    setAmount('');
  };
  const addCharge = (ch, eyes = null) => {
    setEyesFor(null);
    if (ch.amountBothEyes != null && !eyes) {
      setEyesFor(ch); // ask "One eye / Both eyes" first
      return;
    }
    const line = eyes
      ? {
          label: `${ch.label} — ${EYES[eyes]}`,
          amount: eyes === 'both' ? ch.amountBothEyes : ch.amount,
          eyes,
        }
      : { label: ch.label, amount: ch.amount };
    onItems([...items, { ...line, kind: 'charge', qty: 1, standardChargeId: ch.id }]);
  };
  const remove = (i) => onItems(items.filter((_, j) => j !== i));
  const reprice = (i, value) => {
    const n = Math.round(Number(value));
    if (Number.isNaN(n) || n < 0 || n === Number(items[i].amount)) return;
    onItems(items.map((it, j) => (j === i ? { ...it, amount: n, priceMissing: false } : it)));
  };

  const onBill = new Set(items.map((it) => it.standardChargeId).filter((x) => x != null));
  const modeLabel = PAYMENT_MODES.find((m) => m.key === bill?.paymentMode)?.label || bill?.paymentMode;

  return (
    <div id="billingSection">
      <div className="field-label">Bill</div>
      {charges.length > 0 ? (
        groupCharges(charges).map((g) => (
          <div className="bill-charge-group" key={g.heading || '-'}>
            {g.heading && <p className="bill-charge-heading">{g.heading}</p>}
            <div className="bill-charges" role="group" aria-label={g.heading || 'Add a standard charge'}>
              {g.charges.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  className="charge-chip"
                  data-testid={`charge-chip-${ch.id}`}
                  onClick={() => addCharge(ch)}
                  disabled={busy || onBill.has(ch.id)}
                  title={onBill.has(ch.id) ? 'Already on the bill' : `Add ${ch.label} to the bill`}
                >
                  {ch.label}{' '}
                  <span className="mono">
                    {rupees(ch.amount)}
                    {ch.amountBothEyes != null && ` / ${rupees(ch.amountBothEyes)}`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))
      ) : (
        <p className="charge-chip-empty">
          No standard charges yet — Admin › Standard charges adds them here.
        </p>
      )}
      {eyesFor && (
        <div className="bill-eyes" role="group" aria-label={`${eyesFor.label}: one eye or both eyes`}>
          <b>{eyesFor.label}</b>
          <button type="button" className="btn-ghost sm" onClick={() => addCharge(eyesFor, 'one')} disabled={busy}>
            One eye <span className="mono">{rupees(eyesFor.amount)}</span>
          </button>
          <button type="button" className="btn-ghost sm" onClick={() => addCharge(eyesFor, 'both')} disabled={busy}>
            Both eyes <span className="mono">{rupees(eyesFor.amountBothEyes)}</span>
          </button>
          <button type="button" className="btn-ghost sm" onClick={() => setEyesFor(null)}>
            Cancel
          </button>
        </div>
      )}
      {bill?.feeNote && (
        <p className="bill-fee-note" data-testid="bill-fee-note">
          {bill.feeNote}
        </p>
      )}
      {items.length > 0 && (
        <table className="bill-lines" id="billTable" style={{ marginBottom: 8 }}>
          <tbody id="billItems">
            {items.map((it, i) => {
              const needsPrice = unpriced.includes(it);
              return (
                <tr
                  key={it.id ?? `${it.label}-${i}`}
                  className={`bill-line${needsPrice ? ' needs-price' : ''}`}
                  style={{ cursor: 'default' }}
                  data-testid="bill-line"
                >
                  <td className="bill-line-label">
                    {it.label}
                    {it.suggested && (
                      <span className="bill-suggested" title="Added from the visit type — remove it if it does not apply">
                        Suggested
                      </span>
                    )}
                    {needsPrice && <small>Price not set — type the amount</small>}
                  </td>
                  <td data-label="Amount" style={{ textAlign: 'right' }}>
                    <AmountInput
                      value={it.amount}
                      onCommit={(v) => reprice(i, v)}
                      label={it.label}
                      disabled={busy}
                    />
                  </td>
                  <td className="no-label" style={{ width: '1%' }}>
                    <button
                      type="button"
                      className="bill-del"
                      onClick={() => remove(i)}
                      aria-label={`Remove ${it.label}`}
                      disabled={busy}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {unpriced.length > 0 && (
        <p className="bill-price-note" data-testid="price-not-set">
          {unpriced.length === 1 ? 'One medicine has' : `${unpriced.length} medicines have`} no price yet —
          type the amount on the bill. To fill it in automatically next time, set a price per pack in Admin ›
          Medicines.
        </p>
      )}
      <div className="bill-total" id="billTotal">
        <span>Total</span>
        <span className="mono">₹{total}</span>
      </div>
      <div className="bill-add-row">
        <input
          className="fake-input"
          id="billItemLabel"
          placeholder="Item — e.g. Eye patch"
          aria-label="Other item"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          style={{ marginBottom: 0 }}
        />
        <input
          className="fake-input mono"
          id="billItemAmount"
          placeholder="₹"
          aria-label="Other item amount"
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
      {bill?.paid && (
        <div className="bill-paid" data-testid="bill-paid">
          <span>
            Paid · {modeLabel}
            {bill.receiptNo && (
              <>
                {' '}
                · Receipt <span className="mono">{bill.receiptNo}</span>
              </>
            )}
          </span>
          <button
            type="button"
            className="btn-primary sm"
            onClick={() => setPrinting({ ...bill, items, total })}
            disabled={!!printing}
          >
            Print receipt
          </button>
        </div>
      )}
      {printing && <ReceiptPrint bill={printing} onDone={() => setPrinting(null)} />}
    </div>
  );
}

/** An amount on the bill that reception can change (discount, unpriced medicine). Commits on
    blur / Enter; Escape puts the old amount back. */
function AmountInput({ value, onCommit, label, disabled }) {
  const [draft, setDraft] = useState(String(value ?? 0));
  useEffect(() => setDraft(String(value ?? 0)), [value]);
  return (
    <span className="bill-amount">
      ₹
      <input
        type="text"
        inputMode="numeric"
        aria-label={`Amount for ${label}`}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => draft !== String(value ?? 0) && draft !== '' && onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') setDraft(String(value ?? 0));
        }}
      />
    </span>
  );
}
