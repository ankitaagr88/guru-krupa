import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { billing as billingApi, daybook as daybookApi, fees as feesApi, errorMessage } from '../../api';
import { normalizeBill } from './queueModel';
import ReceiptPrint from '../Billing/Receipt';
import ReceivePayment from '../Billing/ReceivePayment';
import OwedBalances from '../Billing/OwedBalances';
import { BILL_CHANGED } from '../Billing/billEvents';
import { modeLabel, modesText, timeOf } from '../Billing/money';
import { rupees } from './visitKind';
import '../Billing/billing.css';
import './visitKind.css';

/* Bill panel for the billing stage (mockup `renderBilling` / `addBillItem` /
   `removeBillItem` / `selectPaymentMode`). Self-contained (lane B owns it; payments and day-book
   columns: lane M): loads and saves the visit's bill itself. The drawer only passes the visit and
   hears back the payment mode once the bill is fully paid (`onPaymentMode`) for its "Mark visit
   complete" button. `fallbackBill` is the bill embedded in the queue row, shown until the fetch
   lands; `refreshKey` bumps after every board reload.

   Works like a till: one tap adds a standard charge (Admin › Standard charges); "Bought
   here" in the medicines panel above puts the medicine on the bill on the server and
   announces it with a `gk:bill-changed` window event, so the panel reloads. Every amount
   can be changed (a discount, or a medicine that has no price yet). A charge priced ₹0 in Admin
   (Glasses) asks for the amount when tapped.

   Money (lane M): "Receive payment" takes an amount (the balance, or less for a part payment)
   and a mode; a bill can take several payments (₹500 cash now, ₹60 UPI later), each with Undo.
   The first payment gives the bill a receipt number and "Print receipt"; a ₹0 bill (free
   follow-up) is closed with "No charge". A typed line picks its day-book column (defaults to the
   Admin setting). A returning patient who still owes money from an earlier visit gets a notice
   at the top with "Receive payment".

   Visit fees (lane E2): a visit with no bill yet gets one started on the server with its visit
   kind's fee (and Emergency when flagged) already on it, marked "Suggested" — reception can
   remove or change it. The drawer's "Visit type & fee" is the one control for that fee: changing
   it swaps the line (once money has been taken, the line stays and a note says so), and the
   charges that belong to a visit type or the emergency fee are not offered again as chips here.
   Other chips sit under their Admin heading (Visit fees / Tests / Packages); a test priced per
   eye asks "One eye / Both eyes" and the line reads "Perimetry — both eyes".

   A returning patient's old balance can be collected with today's bill: "Also collect old
   balance ₹60" adds it to the amount, and the payment is recorded bill by bill (oldest first).
   `onBillState({total, balance, paid, noCharge, payments, paymentMode})` tells the drawer what
   its footer should offer (Receive payment / Complete visit). */

const itemBody = (it) => ({
  label: it.label,
  amount: Math.max(0, Math.round(Number(it.amount) || 0)),
  kind: it.kind || 'other',
  qty: Math.max(1, Number(it.qty) || 1),
  standardChargeId: it.standardChargeId ?? null,
  prescriptionLineId: it.prescriptionLineId ?? null,
  eyes: it.eyes ?? null,
  accountHeadKey: it.accountHeadKey ?? null,
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

/** A one-tap charge whose Admin price is ₹0 (Glasses): the amount is typed at billing. */
const askPrice = (ch) => Number(ch.amount) === 0 && ch.amountBothEyes == null;

/** GET the bill; none yet -> start it with the visit's suggested fee lines. */
const fetchBill = (visitId) =>
  billingApi.get(visitId).catch((err) => {
    if (err?.response?.status === 404 && typeof billingApi.start === 'function') return billingApi.start(visitId);
    throw err;
  });

export default function BillingPanel({ visitId, fallbackBill, refreshKey, onBillState, busy = false }) {
  const toast = useToast();
  const [bill, setBill] = useState(() => normalizeBill(fallbackBill));
  const [charges, setCharges] = useState([]);
  const [kinds, setKinds] = useState([]); // visit kinds (their fee charge)
  const [emergencyId, setEmergencyId] = useState(null);
  const [heads, setHeads] = useState([]); // day-book columns (for the typed-line picker)
  const [otherHead, setOtherHead] = useState('');
  const [printing, setPrinting] = useState(null);
  const [paying, setPaying] = useState(false);
  const [owed, setOwed] = useState([]); // earlier visits' bills still owing
  const [owedKey, setOwedKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const report = useRef(onBillState);
  report.current = onBillState;

  const [eyesFor, setEyesFor] = useState(null); // the eye-wise charge waiting for "one / both eyes"
  const [priceFor, setPriceFor] = useState(null); // the ₹0 charge waiting for its amount
  const [priceDraft, setPriceDraft] = useState('');
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
      .catch(() => alive && setBill(normalizeBill(fallbackBill)))
      .finally(() => alive && setLoaded(true));
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
    if (daybookApi?.heads) {
      daybookApi
        .heads()
        .then((rows) => alive && setHeads(rows || []))
        .catch(() => alive && setHeads([]));
      daybookApi
        .settings()
        .then((s) => alive && setOtherHead(s?.otherHead || ''))
        .catch(() => {});
    }
    if (typeof feesApi?.kinds === 'function') {
      Promise.all([feesApi.kinds(), feesApi.rules ? feesApi.rules() : null])
        .then(([k, r]) => {
          if (!alive) return;
          setKinds(k || []);
          setEmergencyId(r?.emergencyChargeId ?? null);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, []);

  const saveBill = async (next) => {
    const prev = bill;
    setBill(next);
    try {
      const body = { items: next.items.map(itemBody) };
      if (next.paymentMode && !(next.payments || []).length) body.paymentMode = next.paymentMode;
      const saved = await billingApi.save(visitId, body);
      if (saved) setBill(normalizeBill({ ...next, ...saved }));
    } catch (err) {
      setBill(prev);
      toast.error('Could not save bill', errorMessage(err));
    }
  };
  const onItems = (items) => saveBill({ ...bill, items });

  /** Money calls: receive / undo / no charge. The server answers with the whole bill. */
  const money = async (fn, failTitle) => {
    setPaying(true);
    try {
      const saved = await fn();
      if (saved) setBill(normalizeBill(saved));
      return saved;
    } catch (err) {
      toast.error(failTitle, errorMessage(err));
      return null;
    } finally {
      setPaying(false);
    }
  };
  const receiveToday = (amount, mode) =>
    money(
      () =>
        typeof billingApi.receive === 'function'
          ? billingApi.receive(visitId, { amount, mode })
          : billingApi.pay(visitId, mode),
      'Could not record the payment'
    );
  /** With "Also collect old balance": the old bills are paid first (oldest first), the rest goes
      on today's bill — one payment per bill, so each bill and receipt stays right. */
  const receive = async (amount, mode, { withOld = false } = {}) => {
    if (!withOld || !owed.length) return receiveToday(amount, mode);
    setPaying(true);
    let left = amount;
    try {
      const oldest = [...owed].sort((a, b) => String(a.visitDate).localeCompare(String(b.visitDate)));
      for (const o of oldest) {
        if (left <= 0) break;
        const part = Math.min(left, Number(o.balance) || 0);
        if (part > 0) await billingApi.receive(o.visitId, { amount: part, mode });
        left -= part;
      }
      const saved = left > 0 ? await billingApi.receive(visitId, { amount: left, mode }) : await billingApi.get(visitId);
      if (saved) setBill(normalizeBill(saved));
      toast.success(`${rupees(amount)} received`, "Old balance and today's bill");
      return saved;
    } catch (err) {
      toast.error('Could not record the payment', errorMessage(err));
      load();
      return null;
    } finally {
      setOwedKey((k) => k + 1);
      setPaying(false);
    }
  };
  const undo = (p) => {
    if (!window.confirm(`Undo the ${rupees(p.amount)} ${modeLabel(p.mode)} payment? The bill will owe it again.`))
      return;
    money(() => billingApi.undoPayment(visitId, p.id), 'Could not undo the payment');
  };
  const noCharge = () => money(() => billingApi.noCharge(visitId), 'Could not close the bill');

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [headPick, setHeadPick] = useState('');
  const [error, setError] = useState('');
  const items = bill?.items || [];
  const total = items.reduce((s, it) => s + Number(it.amount || 0), 0);
  const payments = bill?.payments || [];
  const paidAmount = payments.reduce((s, x) => s + Number(x.amount || 0), 0);
  const balance = total - paidAmount;
  const noChargeDone = bill?.status === 'no_charge' || (total === 0 && !!bill?.paid);
  const unpriced = items.filter(
    (it) => it.priceMissing ?? (it.kind === 'medicine' && Number(it.amount) === 0)
  );
  const newHead = headPick || otherHead;

  const add = () => {
    const l = label.trim();
    const a = parseFloat(amount);
    if (!l || Number.isNaN(a)) {
      setError('Add both an item name and an amount.');
      return;
    }
    setError('');
    const line = { label: l, amount: Math.round(a), kind: 'other', qty: 1 };
    if (newHead) line.accountHeadKey = newHead;
    onItems([...items, line]);
    setLabel('');
    setAmount('');
  };
  const addCharge = (ch, eyes = null) => {
    setEyesFor(null);
    setPriceFor(null);
    if (ch.amountBothEyes != null && !eyes) {
      setEyesFor(ch); // ask "One eye / Both eyes" first
      return;
    }
    if (askPrice(ch)) {
      setPriceDraft('');
      setPriceFor(ch); // Glasses: ask for the amount first
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
  const addPriced = () => {
    const n = Math.round(Number(priceDraft));
    if (!n || n < 1) return;
    const ch = priceFor;
    setPriceFor(null);
    onItems([...items, { label: ch.label, amount: n, kind: 'charge', qty: 1, standardChargeId: ch.id }]);
  };
  const remove = (i) => onItems(items.filter((_, j) => j !== i));
  const reprice = (i, value) => {
    const n = Math.round(Number(value));
    if (Number.isNaN(n) || n < 0 || n === Number(items[i].amount)) return;
    onItems(items.map((it, j) => (j === i ? { ...it, amount: n, priceMissing: false } : it)));
  };
  const rehead = (i, key) => onItems(items.map((it, j) => (j === i ? { ...it, accountHeadKey: key } : it)));

  const onBill = new Set(items.map((it) => it.standardChargeId).filter((x) => x != null));
  const disabled = busy || paying;

  // The visit fee comes from the visit type (the drawer's panel), not from a chip here.
  const kindChargeIds = new Set(kinds.map((k) => k.standardChargeId).filter((x) => x != null));
  const feeChargeIds = new Set([...kindChargeIds, ...(emergencyId != null ? [emergencyId] : [])]);
  const chips = charges.filter((ch) => !feeChargeIds.has(ch.id));
  // Money already taken, then the visit type changed: the fee line stays as it was — say so.
  const kindNow = kinds.find((k) => k.key === bill?.visitKindKey);
  const feeLine = items.find((it) => kindChargeIds.has(it.standardChargeId));
  const wantId = kindNow ? (kindNow.standardChargeId ?? null) : undefined;
  const feeOutOfStep =
    payments.length > 0 && kindNow && wantId !== undefined && (feeLine?.standardChargeId ?? null) !== wantId;
  const owedTotal = owed.reduce((s, o) => s + (Number(o.balance) || 0), 0);

  // The drawer's footer: Receive payment while money is owed, then Complete visit.
  const noChargeClosed = noChargeDone;
  useEffect(() => {
    report.current?.(
      !loaded
        ? null
        : {
            total,
            balance,
            paid: !!bill?.paid,
            noCharge: noChargeClosed,
            payments,
            paymentMode: bill?.paymentMode ?? null,
          }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, total, balance, bill?.paid, noChargeClosed, payments.length, bill?.paymentMode]);

  return (
    <div id="billingSection">
      <OwedBalances
        patientId={bill?.patientId ?? null}
        excludeVisitId={visitId}
        variant="notice"
        refreshKey={`${refreshKey}-${owedKey}`}
        onRows={setOwed}
      />
      <div className="drawer-sec-head">
        <div className="field-label">Bill</div>
        <Link to="/daybook" className="drawer-sec-link" data-testid="daybook-link">
          Day book
        </Link>
      </div>
      {chips.length > 0 ? (
        groupCharges(chips).map((g) => (
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
                  disabled={disabled || onBill.has(ch.id)}
                  title={onBill.has(ch.id) ? 'Already on the bill' : `Add ${ch.label} to the bill`}
                >
                  {ch.label}
                  {askPrice(ch) ? (
                    <span className="charge-chip-ask"> — enter price</span>
                  ) : ch.amountBothEyes != null ? (
                    <span className="mono">
                      {' '}
                      {rupees(ch.amount)} one eye · {rupees(ch.amountBothEyes)} both
                    </span>
                  ) : (
                    <span className="mono"> {rupees(ch.amount)}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))
      ) : (
        <p className="charge-chip-empty">No standard charges (Admin › Standard charges)</p>
      )}
      {eyesFor && (
        <div className="bill-eyes" role="group" aria-label={`${eyesFor.label}: one eye or both eyes`}>
          <b>{eyesFor.label}</b>
          <button type="button" className="btn-ghost sm" onClick={() => addCharge(eyesFor, 'one')} disabled={disabled}>
            One eye <span className="mono">{rupees(eyesFor.amount)}</span>
          </button>
          <button type="button" className="btn-ghost sm" onClick={() => addCharge(eyesFor, 'both')} disabled={disabled}>
            Both eyes <span className="mono">{rupees(eyesFor.amountBothEyes)}</span>
          </button>
          <button type="button" className="btn-ghost sm" onClick={() => setEyesFor(null)}>
            Cancel
          </button>
        </div>
      )}
      {priceFor && (
        <form
          className="bill-price-ask"
          aria-label={`${priceFor.label}: type the amount`}
          onSubmit={(e) => {
            e.preventDefault();
            addPriced();
          }}
        >
          <b>{priceFor.label}</b>
          <span className="bill-amount">
            ₹
            <input
              type="text"
              inputMode="numeric"
              aria-label={`Amount for ${priceFor.label}`}
              value={priceDraft}
              autoFocus
              onChange={(e) => setPriceDraft(e.target.value.replace(/[^\d]/g, ''))}
            />
          </span>
          <button type="submit" className="btn-primary sm" disabled={disabled || !Number(priceDraft)}>
            Add
          </button>
          <button type="button" className="btn-ghost sm" onClick={() => setPriceFor(null)}>
            Cancel
          </button>
        </form>
      )}
      {bill?.feeNote && (
        <p className="bill-fee-note" data-testid="bill-fee-note">
          {bill.feeNote}
        </p>
      )}
      {feeOutOfStep && (
        <p className="bill-fee-note warn" data-testid="bill-fee-kept">
          Now {kindNow.label} — already paid, so the fee stays{' '}
          {feeLine ? (
            <>
              {feeLine.label} <span className="mono">{rupees(feeLine.amount)}</span>
            </>
          ) : (
            'off'
          )}
          . Edit it below if needed.
        </p>
      )}
      {items.length > 0 && (
        <table className="bill-lines" id="billTable" style={{ marginBottom: 8 }}>
          <tbody id="billItems">
            {items.map((it, i) => {
              const needsPrice = unpriced.includes(it);
              const typed = (it.kind || 'other') === 'other';
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
                    {typed && heads.length > 0 && (
                      <HeadPicker
                        heads={heads}
                        value={it.accountHeadKey || otherHead}
                        onChange={(key) => rehead(i, key)}
                        label={`Day book column for ${it.label}`}
                        disabled={disabled}
                      />
                    )}
                  </td>
                  <td data-label="Amount" style={{ textAlign: 'right' }}>
                    <AmountInput
                      value={it.amount}
                      onCommit={(v) => reprice(i, v)}
                      label={it.label}
                      disabled={disabled}
                    />
                  </td>
                  <td className="no-label" style={{ width: '1%' }}>
                    <button
                      type="button"
                      className="bill-del"
                      onClick={() => remove(i)}
                      aria-label={`Remove ${it.label}`}
                      disabled={disabled}
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
          {unpriced.length === 1 ? '1 medicine' : `${unpriced.length} medicines`} without a price — type it
          (set prices in Admin › Medicines)
        </p>
      )}
      <div className="bill-total" id="billTotal">
        <span>Total</span>
        <span className="mono">{rupees(total)}</span>
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
        {heads.length > 0 && (
          <HeadPicker
            heads={heads}
            value={newHead}
            onChange={setHeadPick}
            label="Day book column for the new item"
            disabled={disabled}
          />
        )}
        <button type="button" className="med-add-btn" onClick={add} disabled={disabled}>
          Add
        </button>
      </div>
      {error && (
        <p className="hint" style={{ color: 'var(--alert-ink)', margin: '6px 0 0' }}>
          {error}
        </p>
      )}

      <p className="label" style={{ margin: '14px 0 6px' }}>
        Payment
      </p>
      {payments.length > 0 && (
        <ul className="bill-payments" data-testid="bill-payments">
          {payments.map((p) => (
            <li key={p.id}>
              <span className="mono">{rupees(p.amount)}</span>
              <span className="grow">
                {modeLabel(p.mode)} · {timeOf(p.at)}
                {p.byName ? ` · ${p.byName}` : ''}
              </span>
              <button
                type="button"
                className="link-btn"
                onClick={() => undo(p)}
                disabled={disabled}
                aria-label={`Undo the ${rupees(p.amount)} ${modeLabel(p.mode)} payment`}
              >
                Undo
              </button>
            </li>
          ))}
        </ul>
      )}
      {balance > 0 && (
        <>
          {payments.length > 0 && (
            <div className="bill-balance" data-testid="bill-balance">
              <span>Balance due</span>
              <span className="mono">{rupees(balance)}</span>
            </div>
          )}
          <ReceivePayment
            balance={balance}
            busy={disabled}
            onReceive={receive}
            label="Receive"
            extra={owedTotal > 0 ? { amount: owedTotal, label: `Also collect old balance ${rupees(owedTotal)}` } : null}
          />
        </>
      )}
      {balance < 0 && (
        <div className="bill-balance" data-testid="bill-balance">
          <span>Lines were taken off after paying — give back</span>
          <span className="mono">{rupees(-balance)}</span>
        </div>
      )}
      {total === 0 && !noChargeDone && bill?.id != null && (
        <div className="bill-balance settled" data-testid="bill-zero">
          <span>Nothing to pay on this visit</span>
          <button type="button" className="btn-primary sm" onClick={noCharge} disabled={disabled}>
            No charge
          </button>
        </div>
      )}
      {(bill?.paid || (bill?.receiptNo && payments.length > 0)) && (
        <div className="bill-paid" data-testid={bill?.paid ? 'bill-paid' : 'bill-part-paid'}>
          <span>
            {noChargeDone
              ? 'No charge'
              : bill?.paid
                ? `Paid · ${modesText(payments, bill.paymentMode)}`
                : `Part paid · ${rupees(paidAmount)} of ${rupees(total)}`}
            {bill?.receiptNo && (
              <>
                {' '}
                · Receipt <span className="mono">{bill.receiptNo}</span>
              </>
            )}
          </span>
          {!noChargeDone && (
            <button
              type="button"
              className="btn-primary sm"
              onClick={() => setPrinting({ ...bill, items, total })}
              disabled={!!printing}
            >
              Print receipt
            </button>
          )}
        </div>
      )}
      {printing && <ReceiptPrint bill={printing} onDone={() => setPrinting(null)} />}
    </div>
  );
}

/** Day-book column of a typed bill line (Admin › Day book columns). */
function HeadPicker({ heads, value, onChange, label, disabled }) {
  return (
    <span className="bill-head">
      <span className="bill-head-cap" aria-hidden="true">
        Day book
      </span>
      <select
        className="bill-head-pick"
        aria-label={label}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title="Which column of the day book this goes under"
      >
        {heads.map((h) => (
          <option key={h.key} value={h.key}>
            {h.label}
          </option>
        ))}
      </select>
    </span>
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
