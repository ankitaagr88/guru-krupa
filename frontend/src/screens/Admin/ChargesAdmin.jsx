import { useEffect, useState } from 'react';
import { admin as adminApi } from '../../api';
import { EditableText, ReorderBtns } from './pieces';

/* Admin › Standard charges (lane B owns this file): consultation, pre-test, dilation… with
   an amount each; the billing panel adds one to the bill with one tap, in this order.
   A charge already used on a bill can't be deleted — switch it off instead (old bills keep
   it). Takes the parent's `run(fn, okMsg)` like the other sections. */
export function ChargesSection({ run }) {
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');

  const load = async () => {
    try {
      setRows(await adminApi.standardCharges.list());
    } catch {
      setRows([]);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const doRun = async (fn, okMsg) => {
    const ok = await run(fn, okMsg);
    await load();
    return ok;
  };

  const add = async (e) => {
    e?.preventDefault?.();
    const l = label.trim();
    if (!l) return;
    const n = Math.round(Number(amount) || 0);
    if (await doRun(() => adminApi.standardCharges.create({ label: l, amount: n }), `${l} added`)) {
      setLabel('');
      setAmount('');
    }
  };
  const rename = (ch) => (v) =>
    v.trim() &&
    v.trim() !== ch.label &&
    doRun(() => adminApi.standardCharges.update(ch.id, { label: v.trim() }));
  const reprice = (ch) => (v) => {
    const n = Math.round(Number(String(v).replace(/[^\d.]/g, '')));
    if (Number.isNaN(n) || n < 0 || n === Number(ch.amount)) return;
    doRun(() => adminApi.standardCharges.update(ch.id, { amount: n }), `${ch.label}: ₹${n}`);
  };
  const toggle = (ch) => doRun(() => adminApi.standardCharges.update(ch.id, { active: ch.active === false }));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    doRun(() => adminApi.standardCharges.reorder(next.map((ch) => ch.id)));
  };
  const remove = (ch) => {
    if (!window.confirm(`Delete "${ch.label}"? If bills already use it, switch it off instead.`)) return;
    doRun(() => adminApi.standardCharges.remove(ch.id), `${ch.label} deleted`);
  };

  return (
    <section className="admin-block" aria-labelledby="h-charges">
      <h2 id="h-charges">Standard charges</h2>
      <p className="hint">
        Fees the front desk adds to a bill with one tap, in this order (for example Consultation ₹500). The
        amount can still be changed on the bill for a discount. A charge that bills already use can&apos;t be
        deleted — switch it off to hide it.
      </p>
      <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}></th>
            <th>Charge</th>
            <th style={{ width: 140 }}>Amount (₹)</th>
            <th style={{ width: 70 }}>Active</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody id="chargeList">
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="hint">
                No charges yet — add the first one below.
              </td>
            </tr>
          )}
          {rows.map((ch, i) => (
            <tr
              key={ch.id}
              data-testid={`charge-${ch.id}`}
              className={ch.active === false ? 'staff-inactive' : ''}
            >
              <td className="no-label">
                <ReorderBtns
                  i={i}
                  n={rows.length}
                  onMove={(dir) => move(i, dir)}
                  label={`charge ${ch.label}`}
                />
              </td>
              <td data-label="Charge">
                <EditableText value={ch.label} onCommit={rename(ch)} ariaLabel={`Charge ${ch.label}`} />
              </td>
              <td data-label="Amount">
                <div className="mins">
                  ₹
                  <EditableText
                    value={String(ch.amount ?? 0)}
                    onCommit={reprice(ch)}
                    ariaLabel={`Amount for ${ch.label}`}
                    className="price-input"
                  />
                </div>
              </td>
              <td data-label="Active">
                <button
                  type="button"
                  className={`switch${ch.active !== false ? ' on' : ''}`}
                  role="switch"
                  aria-checked={ch.active !== false}
                  aria-label={`Charge ${ch.label} active`}
                  onClick={() => toggle(ch)}
                >
                  <div className="knob" />
                </button>
              </td>
              <td className="no-label">
                <button
                  className="admin-del"
                  onClick={() => remove(ch)}
                  aria-label={`Delete charge ${ch.label}`}
                  type="button"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="admin-add-row" onSubmit={add}>
        <input
          className="fake-input"
          placeholder="New charge — e.g. OCT scan"
          aria-label="New charge"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="fake-input"
          placeholder="₹ amount"
          aria-label="New charge amount"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
          style={{ maxWidth: 120, fontFamily: 'var(--font-mono)' }}
        />
        <button className="admin-add" type="submit" disabled={!label.trim()}>
          + Add a charge
        </button>
      </form>
    </section>
  );
}
