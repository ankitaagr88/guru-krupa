import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { HOSPITAL_PRINT } from '../Prescription/hospital';
import { PAYMENT_MODES } from '../Queue/queueModel';
import './billing.css';

/* Printed receipt for a paid bill (lane B). Rendered into <body> through a portal, like the
   prescription sheet; while it prints, <body> carries `printing-receipt` so billing.css hides
   everything else (and beats the prescription sheet's own print rule). Mount it with a
   BillOut ({receiptNo, patientName, token, items, total, paymentMode, paidAt, payments}); it prints
   once and calls `onDone`. With payments it lists each amount received (date, mode) and the
   balance still due, so a part payment gets a receipt too. The hospital header comes from HOSPITAL_PRINT, so a new logo
   there shows up here too. */
export default function ReceiptPrint({ bill, onDone }) {
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!bill) return undefined;
    document.body.classList.add('printing-receipt');
    // Let the portal paint before the print dialog opens.
    const t = setTimeout(() => {
      try {
        window.print();
      } finally {
        document.body.classList.remove('printing-receipt');
        done.current?.();
      }
    }, 50);
    return () => {
      clearTimeout(t);
      document.body.classList.remove('printing-receipt');
    };
  }, [bill]);

  if (!bill || typeof document === 'undefined') return null;
  return createPortal(<ReceiptSheet bill={bill} />, document.body);
}

export function ReceiptSheet({ bill }) {
  const h = HOSPITAL_PRINT;
  const mode = PAYMENT_MODES.find((m) => m.key === bill.paymentMode)?.label || bill.paymentMode || '—';
  const when = bill.paidAt ? new Date(bill.paidAt) : new Date();
  const items = bill.items || [];
  const total = bill.total ?? items.reduce((s, it) => s + Number(it.amount || 0), 0);
  // Part payments (lane M): every amount received with its mode, then the balance still due.
  const payments = bill.payments || [];
  const paidAmount = payments.reduce((s, x) => s + Number(x.amount || 0), 0);
  const balance = Number(total) - paidAmount;
  const modeName = (k) => PAYMENT_MODES.find((m) => m.key === k)?.label || k;
  return (
    <div className="receipt-print" data-testid="receipt-print">
      <div className="receipt-head">
        <img className="receipt-logo" src={h.logo} alt="" />
        <div>
          <h1>{h.name}</h1>
          <div className="receipt-addr">{h.address}</div>
          <div className="receipt-addr">Ph: {h.phone}</div>
        </div>
      </div>
      <div className="receipt-title">Receipt</div>
      <div className="receipt-meta">
        <span>
          Receipt no. <b className="mono">{bill.receiptNo || '—'}</b>
        </span>
        <span className="mono">
          {when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
          {when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>
      <div className="receipt-patient">
        <b>{bill.patientName || '—'}</b>
        {bill.token ? (
          <span>
            {' '}
            · Token <span className="mono">{bill.token}</span>
          </span>
        ) : null}
      </div>
      <table className="receipt-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id ?? i}>
              <td>{it.kind === 'medicine' ? it.label.replace(/ × \d+$/, '') : it.label}</td>
              <td className="num mono">{it.qty || 1}</td>
              <td className="num mono">{Number(it.amount || 0).toLocaleString('en-IN')}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Total</td>
            <td className="num mono">₹{Number(total).toLocaleString('en-IN')}</td>
          </tr>
        </tfoot>
      </table>
      {payments.length > 0 ? (
        <table className="receipt-payments" data-testid="receipt-payments">
          <tbody>
            {payments.map((x) => (
              <tr key={x.id}>
                <td>
                  Received{' '}
                  {new Date(x.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ·{' '}
                  {modeName(x.mode)}
                </td>
                <td className="num mono">₹{Number(x.amount).toLocaleString('en-IN')}</td>
              </tr>
            ))}
            <tr className="due">
              <td>{balance < 0 ? 'To give back' : 'Balance due'}</td>
              <td className="num mono">₹{Math.abs(balance).toLocaleString('en-IN')}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div className="receipt-mode">
          {bill.status === 'no_charge' || (Number(total) === 0 && bill.paid) ? (
            <b>No charge</b>
          ) : (
            <>
              Paid by <b>{mode}</b>
            </>
          )}
        </div>
      )}
      <div className="receipt-thanks">Received with thanks</div>
      <div className="receipt-sign">
        <div className="receipt-sign-line" />
        For {h.name}
      </div>
    </div>
  );
}
