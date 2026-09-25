import { useEffect, useState } from 'react';
import { admin as adminApi, daybook as daybookApi } from '../../api';
import { EditableText, ReorderBtns } from './pieces';

/* Admin › Standard charges (lane B owns this file): consultation, pre-test, dilation… with
   an amount each; the billing panel adds one to the bill with one tap, in this order.
   A charge already used on a bill can't be deleted — switch it off instead (old bills keep
   it). Takes the parent's `run(fn, okMsg)` like the other sections.
   Tests are priced per eye: "Both eyes" set = the bill asks "One eye / Both eyes" (Amount is the
   one-eye price); empty = one price. "Heading" groups the chips on the bill (Visit fees, Tests,
   Packages — any text). "Day book column" is where the charge is counted on the day book (lane M:
   Admin › Day book columns); a ₹0 charge (Glasses) asks for its amount on the bill. */
export function ChargesSection({ run }) {
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [both, setBoth] = useState('');
  const [group, setGroup] = useState('');
  const [heads, setHeads] = useState([]); // day-book columns (lane M)
  const [head, setHead] = useState('');

  const load = async () => {
    try {
      setRows(await adminApi.standardCharges.list());
    } catch {
      setRows([]);
    }
  };
  useEffect(() => {
    load();
    daybookApi
      ?.heads?.({ includeInactive: true })
      .then((rows) => setHeads(rows || []))
      .catch(() => setHeads([]));
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
    const body = { label: l, amount: n, groupLabel: group.trim() };
    if (both !== '') body.amountBothEyes = Math.round(Number(both) || 0);
    if (head) body.accountHeadKey = head;
    if (await doRun(() => adminApi.standardCharges.create(body), `${l} added`)) {
      setLabel('');
      setAmount('');
      setBoth('');
    }
  };
  // Both-eyes price: empty clears it (one price whatever the eyes).
  const repriceBoth = (ch) => (v) => {
    const t = String(v).replace(/[^\d.]/g, '');
    const n = t === '' ? null : Math.round(Number(t));
    if (n === (ch.amountBothEyes ?? null) || (n != null && (Number.isNaN(n) || n < 0))) return;
    doRun(
      () => adminApi.standardCharges.update(ch.id, { amountBothEyes: n }),
      n == null ? `${ch.label}: one price` : `${ch.label}: both eyes ₹${n}`
    );
  };
  const regroup = (ch) => (v) =>
    v.trim() !== (ch.groupLabel || '') &&
    doRun(() => adminApi.standardCharges.update(ch.id, { groupLabel: v.trim() }));
  const rehead = (ch) => (key) =>
    key &&
    key !== ch.accountHeadKey &&
    doRun(
      () => adminApi.standardCharges.update(ch.id, { accountHeadKey: key }),
      `${ch.label}: day book column ${heads.find((h) => h.key === key)?.label || key}`
    );
  const groups = [...new Set(rows.map((ch) => ch.groupLabel).filter(Boolean))];
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
        Fees the front desk adds to a bill with one tap, in this order (for example Consultation ₹700). The
        amount can still be changed on the bill for a discount. A charge that bills already use can&apos;t be
        deleted — switch it off to hide it. For a test priced per eye, fill in <b>Both eyes</b>: the bill
        then asks &ldquo;One eye / Both eyes&rdquo; and <b>Amount</b> is the one-eye price. <b>Heading</b>{' '}
        groups the buttons on the bill (Visit fees, Tests, Packages). <b>Day book column</b> is the column the
        charge is counted under on the day book. An amount of ₹0 means the price is typed on the bill (Glasses).
      </p>
      <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}></th>
            <th>Charge</th>
            <th style={{ width: 130 }}>Amount (₹)</th>
            <th style={{ width: 130 }}>Both eyes (₹)</th>
            <th style={{ width: 140 }}>Heading</th>
            <th style={{ width: 130 }}>Day book column</th>
            <th style={{ width: 70 }}>Active</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody id="chargeList">
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="hint">
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
              <td data-label="Both eyes">
                <div className="mins">
                  ₹
                  <EditableText
                    value={ch.amountBothEyes == null ? '' : String(ch.amountBothEyes)}
                    onCommit={repriceBoth(ch)}
                    ariaLabel={`Both eyes amount for ${ch.label}`}
                    className="price-input"
                    placeholder="—"
                  />
                </div>
              </td>
              <td data-label="Heading">
                <EditableText
                  value={ch.groupLabel || ''}
                  onCommit={regroup(ch)}
                  ariaLabel={`Heading for ${ch.label}`}
                  placeholder="No heading"
                />
              </td>
              <td data-label="Day book column">
                <select
                  className="admin-select"
                  aria-label={`Day book column for ${ch.label}`}
                  value={ch.accountHeadKey || ''}
                  onChange={(e) => rehead(ch)(e.target.value)}
                >
                  {!ch.accountHeadKey && <option value="">Not set</option>}
                  {heads
                    .filter((h) => h.active || h.key === ch.accountHeadKey)
                    .map((h) => (
                      <option key={h.key} value={h.key}>
                        {h.label}
                        {h.active ? '' : ' (off)'}
                      </option>
                    ))}
                </select>
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
        <input
          className="fake-input"
          placeholder="₹ both eyes"
          aria-label="New charge both eyes amount"
          inputMode="numeric"
          value={both}
          onChange={(e) => setBoth(e.target.value.replace(/[^\d]/g, ''))}
          style={{ maxWidth: 120, fontFamily: 'var(--font-mono)' }}
        />
        <input
          className="fake-input"
          placeholder="Heading — e.g. Tests"
          aria-label="New charge heading"
          list="charge-groups"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          style={{ maxWidth: 160 }}
        />
        <select
          className="admin-select"
          aria-label="New charge day book column"
          value={head}
          onChange={(e) => setHead(e.target.value)}
          style={{ maxWidth: 160 }}
        >
          <option value="">Day book column…</option>
          {heads
            .filter((h) => h.active)
            .map((h) => (
              <option key={h.key} value={h.key}>
                {h.label}
              </option>
            ))}
        </select>
        <datalist id="charge-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <button className="admin-add" type="submit" disabled={!label.trim()}>
          + Add a charge
        </button>
      </form>
    </section>
  );
}
