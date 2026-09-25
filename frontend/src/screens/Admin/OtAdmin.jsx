import { useEffect, useState } from 'react';
import { admin as adminApi, otTeam as otTeamApi } from '../../api';
import { EditableText, ReorderBtns } from './pieces';

/* Admin › OT slots & procedures (B12), OT team roles and outside doctors.
   Time slots offered on the "Schedule surgery" form, and the procedure list.
   A slot or procedure that upcoming surgeries use can't be deleted — switch it
   off instead (it stays on the booked cases). Team roles (id "h-otroles") and
   outside doctors & partners (id "h-otpartners") are never deleted either —
   switched off, and old surgeries keep their copies. Takes the parent's `run(fn, okMsg)`. */

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

const digits = (v) => String(v ?? '').replace(/[^\d]/g, '');

export function OtTeamRolesSection({ run }) {
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState('');
  const [fee, setFee] = useState('');

  const load = async () => {
    try {
      setRows(await otTeamApi.admin.roles());
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
    if (await doRun(() => otTeamApi.admin.createRole(n, Number(digits(fee)) || 0), `${n} added`)) {
      setLabel('');
      setFee('');
    }
  };
  const patch = (r, p) => doRun(() => otTeamApi.admin.updateRole(r.key, p));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    doRun(() => otTeamApi.admin.reorderRoles(next.map((r) => r.key)));
  };

  return (
    <section className="admin-block" aria-labelledby="h-otroles">
      <h2 id="h-otroles">OT team roles</h2>
      <p className="hint">
        The roles offered for the OT team of a surgery (Surgeon, Anaesthetist…), in this order. The usual fee is filled
        in when that role is picked on a surgery, and can be changed there; it goes on the surgery&apos;s bill. Switch a
        role off to stop offering it — surgeries that already have it keep it.
      </p>
      <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}></th>
            <th>Role</th>
            <th style={{ width: 140 }}>Usual fee (₹)</th>
            <th style={{ width: 70 }}>Active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} data-testid={`ot-role-${r.key}`} className={r.active === false ? 'staff-inactive' : ''}>
              <td className="no-label">
                <ReorderBtns i={i} n={rows.length} onMove={(dir) => move(i, dir)} label={`role ${r.label}`} />
              </td>
              <td data-label="Role">
                <EditableText
                  value={r.label}
                  ariaLabel={`Role ${r.label}`}
                  onCommit={(v) => v.trim() && v.trim() !== r.label && patch(r, { label: v.trim() })}
                />
              </td>
              <td data-label="Usual fee">
                <div className="mins">
                  ₹
                  <EditableText
                    value={String(r.defaultFee ?? 0)}
                    ariaLabel={`Usual fee for ${r.label}`}
                    className="price-input"
                    onCommit={(v) => {
                      const n = Number(digits(v)) || 0;
                      if (n !== r.defaultFee) patch(r, { defaultFee: n });
                    }}
                  />
                </div>
              </td>
              <td data-label="Active">
                <button
                  type="button"
                  className={`switch${r.active !== false ? ' on' : ''}`}
                  role="switch"
                  aria-checked={r.active !== false}
                  aria-label={`Role ${r.label} active`}
                  onClick={() => patch(r, { active: r.active === false })}
                >
                  <div className="knob" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="admin-add-row" onSubmit={add}>
        <input
          className="fake-input"
          placeholder="New role — e.g. Circulating nurse"
          aria-label="New team role"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="fake-input"
          inputMode="numeric"
          placeholder="Usual fee ₹ (optional)"
          aria-label="Usual fee for the new role"
          value={fee}
          onChange={(e) => setFee(digits(e.target.value))}
        />
        <button className="admin-add" type="submit" disabled={!label.trim()}>
          + Add a role
        </button>
      </form>
    </section>
  );
}

const EMPTY_PARTNER = { name: '', qualification: '', regNo: '', phone: '', defaultRoleKey: '', defaultFee: '', note: '' };

export function OtPartnersSection({ run }) {
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState(EMPTY_PARTNER);

  const load = async () => {
    try {
      const [p, r] = await Promise.all([otTeamApi.admin.partners(), otTeamApi.admin.roles()]);
      setRows(p);
      setRoles(r);
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
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const add = async (e) => {
    e?.preventDefault?.();
    const name = form.name.trim();
    if (!name || !form.qualification.trim()) return;
    const body = { ...form, name, defaultRoleKey: form.defaultRoleKey || null, defaultFee: Number(form.defaultFee) || 0 };
    if (await doRun(() => otTeamApi.admin.createPartner(body), `${name} added`)) setForm(EMPTY_PARTNER);
  };
  const patch = (p, change) => doRun(() => otTeamApi.admin.updatePartner(p.id, change));
  const text = (p, field, label, placeholder) => (
    <EditableText
      value={p[field] || ''}
      placeholder={placeholder}
      ariaLabel={`${label} for ${p.name}`}
      onCommit={(v) => {
        const t = v.trim();
        if (t !== (p[field] || '') && (field !== 'name' || t)) patch(p, { [field]: t });
      }}
    />
  );

  return (
    <section className="admin-block" aria-labelledby="h-otpartners">
      <h2 id="h-otpartners">Outside doctors &amp; partners</h2>
      <p className="hint">
        Doctors who are not our staff but join the OT team — a visiting surgeon, an anaesthetist. Their medical
        qualification is needed and is written into the surgery record. Picking one on a surgery fills in their
        qualification, registration number and usual fee. Switch someone off to stop offering them; old surgeries keep
        what was recorded.
      </p>
      <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Qualification</th>
            <th>Reg. no.</th>
            <th>Phone</th>
            <th>Usual role</th>
            <th style={{ width: 120 }}>Usual fee (₹)</th>
            <th>Note</th>
            <th style={{ width: 70 }}>Active</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="empty-slot">
                No outside doctors yet — add one below.
              </td>
            </tr>
          )}
          {rows.map((p) => (
            <tr key={p.id} data-testid={`ot-partner-${p.id}`} className={p.active === false ? 'staff-inactive' : ''}>
              <td data-label="Name">{text(p, 'name', 'Name')}</td>
              <td data-label="Qualification">{text(p, 'qualification', 'Qualification')}</td>
              <td data-label="Reg. no.">{text(p, 'regNo', 'Reg. no.', 'optional')}</td>
              <td data-label="Phone">{text(p, 'phone', 'Phone', 'optional')}</td>
              <td data-label="Usual role">
                <select
                  className="drop-select"
                  value={p.defaultRoleKey || ''}
                  aria-label={`Usual role for ${p.name}`}
                  onChange={(e) => patch(p, { defaultRoleKey: e.target.value })}
                >
                  <option value="">—</option>
                  {roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                      {r.active === false ? ' (switched off)' : ''}
                    </option>
                  ))}
                </select>
              </td>
              <td data-label="Usual fee">
                <div className="mins">
                  ₹
                  <EditableText
                    value={String(p.defaultFee ?? 0)}
                    ariaLabel={`Usual fee for ${p.name}`}
                    className="price-input"
                    onCommit={(v) => {
                      const n = Number(digits(v)) || 0;
                      if (n !== p.defaultFee) patch(p, { defaultFee: n });
                    }}
                  />
                </div>
              </td>
              <td data-label="Note">{text(p, 'note', 'Note', 'optional')}</td>
              <td data-label="Active">
                <button
                  type="button"
                  className={`switch${p.active !== false ? ' on' : ''}`}
                  role="switch"
                  aria-checked={p.active !== false}
                  aria-label={`${p.name} active`}
                  onClick={() => patch(p, { active: p.active === false })}
                >
                  <div className="knob" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="admin-add-row" onSubmit={add} data-testid="ot-partner-add">
        <input
          className="fake-input"
          placeholder="Name — e.g. Dr. R. Mehta"
          aria-label="New outside doctor name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <input
          className="fake-input"
          placeholder="Qualification — e.g. MD Anaesthesia"
          aria-label="New outside doctor qualification"
          value={form.qualification}
          onChange={(e) => set('qualification', e.target.value)}
        />
        <input
          className="fake-input"
          placeholder="Reg. no. (optional)"
          aria-label="New outside doctor reg. no."
          value={form.regNo}
          onChange={(e) => set('regNo', e.target.value)}
        />
        <input
          className="fake-input"
          placeholder="Phone (optional)"
          aria-label="New outside doctor phone"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
        />
        <select
          className="drop-select"
          aria-label="New outside doctor usual role"
          value={form.defaultRoleKey}
          onChange={(e) => set('defaultRoleKey', e.target.value)}
        >
          <option value="">Usual role…</option>
          {roles
            .filter((r) => r.active !== false)
            .map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
        </select>
        <input
          className="fake-input"
          inputMode="numeric"
          placeholder="Usual fee ₹"
          aria-label="New outside doctor usual fee"
          value={form.defaultFee}
          onChange={(e) => set('defaultFee', digits(e.target.value))}
        />
        <input
          className="fake-input"
          placeholder="Note (optional)"
          aria-label="New outside doctor note"
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
        />
        <button className="admin-add" type="submit" disabled={!form.name.trim() || !form.qualification.trim()}>
          + Add outside doctor
        </button>
      </form>
    </section>
  );
}
