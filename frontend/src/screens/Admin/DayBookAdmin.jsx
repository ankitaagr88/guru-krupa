import { useEffect, useState } from 'react';
import { daybook as daybookApi } from '../../api';
import { EditableText, ReorderBtns } from './pieces';

/* Admin › Day book columns (lane M owns this file): the money columns of the day book, like the
   clinic's cash sheet (OPD, MED, TEST, GLASSES, OT, OTHER) — rename, reorder, switch off, add,
   delete an unused one. Below them, the settings: which column medicines bought here go under,
   which one a hand-typed bill line starts in, and which one OT (lens) payments go under. Each
   standard charge picks its own column in Admin › Standard charges. Takes the parent's
   `run(fn, okMsg)` like the other sections. */
const SETTINGS = [
  ['medicineHead', 'Medicines bought here go under'],
  ['otherHead', 'Hand-typed bill lines start in'],
  ['otHead', 'OT (lens) payments go under'],
];

export function DayBookAdminSections({ run }) {
  const [rows, setRows] = useState([]);
  const [settings, setSettings] = useState(null);
  const [label, setLabel] = useState('');

  const load = async () => {
    try {
      const [heads, cfg] = await Promise.all([
        daybookApi.heads({ includeInactive: true }),
        daybookApi.settings(),
      ]);
      setRows(heads || []);
      setSettings(cfg || null);
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
    const n = label.trim();
    if (!n) return;
    if (await doRun(() => daybookApi.admin.create(n), `${n} added`)) setLabel('');
  };
  const rename = (h) => (v) =>
    v.trim() && v.trim() !== h.label && doRun(() => daybookApi.admin.update(h.key, { label: v.trim() }));
  const toggle = (h) => doRun(() => daybookApi.admin.update(h.key, { active: h.active === false }));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    doRun(() => daybookApi.admin.reorder(next.map((h) => h.key)));
  };
  const remove = (h) => {
    if (!window.confirm(`Delete the column "${h.label}"? If charges or bills use it, switch it off instead.`)) return;
    doRun(() => daybookApi.admin.remove(h.key), `${h.label} deleted`);
  };
  const setting = (field) => (e) => {
    const key = e.target.value;
    if (!key || key === settings?.[field]) return;
    const what = SETTINGS.find(([f]) => f === field)[1];
    const name = rows.find((h) => h.key === key)?.label || key;
    doRun(() => daybookApi.admin.saveSettings({ [field]: key }), `${what} ${name}`);
  };

  return (
    <section className="admin-block" aria-labelledby="h-heads">
      <h2 id="h-heads">Day book columns</h2>
      <p className="hint">
        The money columns of the day book, in this order — like the daily cash sheet (OPD, MED, TEST, GLASSES,
        OT…). Every bill line is counted under one: a standard charge under its own column (set in Standard
        charges), and the rest as set below. A column that charges or bills already use can&apos;t be deleted —
        switch it off to hide it.
      </p>
      <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}></th>
            <th>Column</th>
            <th style={{ width: 90 }}>Used by</th>
            <th style={{ width: 70 }}>Active</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody id="headList">
          {rows.map((h, i) => (
            <tr key={h.key} data-testid={`head-${h.key}`} className={h.active === false ? 'staff-inactive' : ''}>
              <td className="no-label">
                <ReorderBtns i={i} n={rows.length} onMove={(dir) => move(i, dir)} label={`column ${h.label}`} />
              </td>
              <td data-label="Column">
                <EditableText value={h.label} onCommit={rename(h)} ariaLabel={`Column ${h.label}`} />
              </td>
              <td data-label="Used by" className="num" title="Standard charges and bill lines counted under it">
                {h.useCount ?? 0}
              </td>
              <td data-label="Active">
                <button
                  type="button"
                  className={`switch${h.active !== false ? ' on' : ''}`}
                  role="switch"
                  aria-checked={h.active !== false}
                  aria-label={`Column ${h.label} active`}
                  onClick={() => toggle(h)}
                >
                  <div className="knob" />
                </button>
              </td>
              <td className="no-label">
                <button className="admin-del" onClick={() => remove(h)} aria-label={`Delete column ${h.label}`} type="button">
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
          placeholder="New column — e.g. CONTACT LENS"
          aria-label="New day book column"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className="admin-add" type="submit" disabled={!label.trim()}>
          + Add a column
        </button>
      </form>

      {settings && (
        <div className="daybook-settings" data-testid="daybook-settings">
          <h3 className="section-title" style={{ margin: '18px 0 8px' }}>
            Where the rest goes
          </h3>
          {SETTINGS.map(([field, text]) => (
            <label key={field} className="admin-inline-field" style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '0 0 8px' }}>
              <span style={{ minWidth: 220 }}>{text}</span>
              <select
                className="admin-select"
                aria-label={text}
                value={settings[field] || ''}
                onChange={setting(field)}
                style={{ maxWidth: 200 }}
              >
                {rows
                  .filter((h) => h.active || h.key === settings[field])
                  .map((h) => (
                    <option key={h.key} value={h.key}>
                      {h.label}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
