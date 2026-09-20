import { useEffect, useState } from 'react';
import { admin as adminApi } from '../../api';
import { EditableText, ReorderBtns } from './pieces';

/* Admin › OT slots & procedures (B12).
   Time slots offered on the "Schedule surgery" form, and the procedure list.
   A slot or procedure that upcoming surgeries use can't be deleted — switch it
   off instead (it stays on the booked cases). Takes the parent's `run(fn, okMsg)`. */

export function OtSlotsSection({ run }) {
  const [slots, setSlots] = useState([]);
  const [label, setLabel] = useState('');
  const [grid, setGrid] = useState({ start: '09:00', end: '17:00', everyMin: 45 });
  const [showGrid, setShowGrid] = useState(false);

  const load = async () => {
    try {
      setSlots(await adminApi.otSlots.list());
    } catch {
      setSlots([]);
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
    if (await doRun(() => adminApi.otSlots.create(l), `Slot ${l} added`)) setLabel('');
  };
  const rename = (s) => (v) => v.trim() && v.trim() !== s.label && doRun(() => adminApi.otSlots.update(s.id, { label: v.trim() }));
  const toggle = (s) => doRun(() => adminApi.otSlots.update(s.id, { active: s.active === false }));
  const remove = (s) => {
    if (!window.confirm(`Delete the ${s.label} slot?`)) return;
    doRun(() => adminApi.otSlots.remove(s.id), `${s.label} deleted`);
  };
  const generate = async (e) => {
    e?.preventDefault?.();
    if (
      !window.confirm(
        `Replace the slot list with ${grid.start}–${grid.end} every ${grid.everyMin} minutes? Slots with upcoming surgeries are kept.`
      )
    )
      return;
    const ok = await doRun(
      () => adminApi.otSlots.generate(grid.start, grid.end, Number(grid.everyMin)),
      'Slot list replaced'
    );
    if (ok) setShowGrid(false);
  };

  return (
    <section className="admin-block" aria-labelledby="h-otslots">
      <h2 id="h-otslots">OT time slots</h2>
      <p className="hint">
        The times offered when scheduling a surgery. Switch a slot off to stop offering it (surgeries already
        booked in it are untouched). Type a time like <b>9:00 AM</b> or <b>14:15</b>.
      </p>
      <div className="ot-slot-chips" data-testid="ot-slot-list">
        {slots.length === 0 && <p className="machine-list-empty">No slots yet — add one or generate a grid below.</p>}
        {slots.map((s) => (
          <div key={s.id} className={`ot-slot-chip${s.active === false ? ' off' : ''}`} data-testid={`ot-slot-${s.id}`}>
            <EditableText value={s.label} onCommit={rename(s)} ariaLabel={`Slot ${s.label}`} className="ot-slot-input" />
            <button
              type="button"
              className={`switch${s.active !== false ? ' on' : ''}`}
              role="switch"
              aria-checked={s.active !== false}
              aria-label={`Slot ${s.label} active`}
              onClick={() => toggle(s)}
            >
              <div className="knob" />
            </button>
            <button className="admin-del" onClick={() => remove(s)} aria-label={`Delete slot ${s.label}`} type="button">
              ✕
            </button>
          </div>
        ))}
      </div>
      <form className="admin-add-row" onSubmit={add}>
        <input
          className="fake-input"
          placeholder="New slot — e.g. 5:15 PM"
          aria-label="New slot time"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className="admin-add" type="submit" disabled={!label.trim()}>
          + Add a slot
        </button>
        <button className="admin-link" type="button" onClick={() => setShowGrid((v) => !v)}>
          {showGrid ? 'Hide grid tool' : 'Generate a regular grid…'}
        </button>
      </form>
      {showGrid && (
        <form className="admin-add-row ot-grid-form" onSubmit={generate} data-testid="ot-grid-form">
          <label className="admin-check">
            From
            <input
              type="time"
              className="fake-input"
              aria-label="Grid start"
              value={grid.start}
              onChange={(e) => setGrid({ ...grid, start: e.target.value })}
            />
          </label>
          <label className="admin-check">
            to
            <input
              type="time"
              className="fake-input"
              aria-label="Grid end"
              value={grid.end}
              onChange={(e) => setGrid({ ...grid, end: e.target.value })}
            />
          </label>
          <label className="admin-check">
            every
            <input
              type="number"
              min={5}
              max={240}
              className="fake-input ot-grid-min"
              aria-label="Grid minutes"
              value={grid.everyMin}
              onChange={(e) => setGrid({ ...grid, everyMin: e.target.value })}
            />
            min
          </label>
          <button className="btn-primary sm" type="submit">
            Replace slot list
          </button>
        </form>
      )}
    </section>
  );
}

export function OtProceduresSection({ run }) {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');

  const load = async () => {
    try {
      setRows(await adminApi.otProcedures.list());
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
    const n = name.trim();
    if (!n) return;
    if (await doRun(() => adminApi.otProcedures.create(n), `${n} added`)) setName('');
  };
  const rename = (p) => (v) => v.trim() && v.trim() !== p.name && doRun(() => adminApi.otProcedures.update(p.id, { name: v.trim() }));
  const toggle = (p) => doRun(() => adminApi.otProcedures.update(p.id, { active: p.active === false }));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    doRun(() => adminApi.otProcedures.reorder(next.map((p) => p.id)));
  };
  const remove = (p) => {
    if (!window.confirm(`Delete "${p.name}"? If surgeries already use it, switch it off instead.`)) return;
    doRun(() => adminApi.otProcedures.remove(p.id), `${p.name} deleted`);
  };

  return (
    <section className="admin-block" aria-labelledby="h-otprocs">
      <h2 id="h-otprocs">OT procedures</h2>
      <p className="hint">
        The procedure list on the &ldquo;Schedule surgery&rdquo; form, in this order. A procedure that surgeries already use
        can&apos;t be deleted — switch it off to hide it from new bookings.
      </p>
      <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}></th>
            <th>Procedure</th>
            <th style={{ width: 70 }}>Active</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody id="otProcedureList">
          {rows.map((p, i) => (
            <tr key={p.id} data-testid={`ot-procedure-${p.id}`} className={p.active === false ? 'staff-inactive' : ''}>
              <td className="no-label">
                <ReorderBtns i={i} n={rows.length} onMove={(dir) => move(i, dir)} label={`procedure ${p.name}`} />
              </td>
              <td data-label="Procedure">
                <EditableText value={p.name} onCommit={rename(p)} ariaLabel={`Procedure ${p.name}`} />
              </td>
              <td data-label="Active">
                <button
                  type="button"
                  className={`switch${p.active !== false ? ' on' : ''}`}
                  role="switch"
                  aria-checked={p.active !== false}
                  aria-label={`Procedure ${p.name} active`}
                  onClick={() => toggle(p)}
                >
                  <div className="knob" />
                </button>
              </td>
              <td className="no-label">
                <button className="admin-del" onClick={() => remove(p)} aria-label={`Delete procedure ${p.name}`} type="button">
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
          placeholder="New procedure — e.g. Pterygium excision"
          aria-label="New procedure"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="admin-add" type="submit" disabled={!name.trim()}>
          + Add a procedure
        </button>
      </form>
    </section>
  );
}
