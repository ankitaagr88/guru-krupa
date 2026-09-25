import { useState } from 'react';

/* OT team on a surgery (stored as billing.team — any staff may edit it; the fees are part of the
   surgery's bill). One row per person: role, name (type, or pick clinic staff / an outside doctor
   from the list), qualification, reg. no., "Outside (not our staff)", fee. Picking an outside
   doctor fills their qualification, reg. no. and usual fee; picking a role on a new row fills the
   role's usual fee. Role label, name and qualification are copied onto the case, so old records
   stay as they were when the lists change.

   The drawer keeps the rows as a draft (`rows`, each with a local `_id`); `onChange(rows)` saves
   the rows that have a name — a row without a name yet is not sent (the server needs one). */

let seq = 0;
export const newRowId = () => {
  seq += 1;
  return `t${seq}`;
};

export const blankMember = () => ({
  _id: newRowId(),
  roleKey: '',
  roleLabel: '',
  name: '',
  qualification: '',
  regNo: '',
  external: false,
  partnerId: null,
  fee: 0,
});

/** Server team → draft rows (local ids added). */
export const toDraft = (team) => (team || []).map((m) => ({ ...blankMember(), ...m, _id: newRowId() }));

/** Draft rows → what is saved: rows with a name, without the local id. */
export const toSaved = (rows) =>
  (rows || [])
    .filter((r) => (r.name || '').trim())
    .map(({ _id, ...m }) => ({ ...m, fee: Number(m.fee) || 0 }));

export const sumFees = (rows) => toSaved(rows).reduce((s, m) => s + (Number(m.fee) || 0), 0);

export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const STAFF_ROLE_LABEL = { doctor: 'Doctor', ot_staff: 'OT staff', optometrist: 'Optometrist' };

export function memberLabel(m) {
  return `${m.roleLabel || 'Team'} — ${m.name}${m.external ? ' (Outside)' : ''}`;
}

export default function OtTeam({ rows, options, onChange, isAdmin, onSavePartner }) {
  const roles = options?.roles || [];
  const partners = options?.partners || [];
  const staff = options?.staff || [];
  const [busyRow, setBusyRow] = useState(null);

  const roleByKey = (key) => roles.find((r) => r.key === key);
  const update = (id, patch) => onChange(rows.map((r) => (r._id === id ? { ...r, ...patch } : r)));

  const pickRole = (row, key) => {
    const role = roleByKey(key);
    const oldDefault = roleByKey(row.roleKey)?.defaultFee || 0;
    const patch = { roleKey: key, roleLabel: role?.label || '' };
    // a new row (or one still at the old role's usual fee) takes the role's usual fee
    if (role && !row.partnerId && (!Number(row.fee) || Number(row.fee) === oldDefault)) patch.fee = role.defaultFee || 0;
    update(row._id, patch);
  };

  const typeName = (row, value) => {
    const partner = partners.find((p) => p.name.toLowerCase() === value.trim().toLowerCase());
    if (partner) {
      const roleKey = row.roleKey || partner.defaultRoleKey || '';
      const role = roleByKey(roleKey);
      update(row._id, {
        name: partner.name,
        qualification: partner.qualification,
        regNo: partner.regNo || '',
        external: true,
        partnerId: partner.id,
        roleKey,
        roleLabel: role?.label || row.roleLabel,
        fee: partner.defaultFee || role?.defaultFee || 0,
      });
      return;
    }
    const person = staff.find((s) => s.name.toLowerCase() === value.trim().toLowerCase());
    const patch = { name: value, partnerId: null };
    if (person) patch.external = false;
    update(row._id, patch);
  };

  const add = () => onChange([...rows, blankMember()]);
  const remove = (row) => onChange(rows.filter((r) => r._id !== row._id));

  const savePartner = async (row) => {
    setBusyRow(row._id);
    try {
      const p = await onSavePartner?.(row);
      if (p?.id) update(row._id, { partnerId: p.id, name: p.name, qualification: p.qualification });
    } finally {
      setBusyRow(null);
    }
  };

  return (
    <div className="ot-team" data-testid="ot-team">
      <datalist id="ot-team-people">
        {staff.map((s) => (
          <option key={`s-${s.name}-${s.role}`} value={s.name}>
            {STAFF_ROLE_LABEL[s.role] || s.role} (our staff)
          </option>
        ))}
        {partners.map((p) => (
          <option key={`p-${p.id}`} value={p.name}>
            Outside · {p.qualification}
          </option>
        ))}
      </datalist>
      {rows.length === 0 && <p className="machine-list-empty">No one added yet.</p>}
      {rows.map((row, i) => {
        const n = i + 1;
        const inList = roles.some((r) => r.key === row.roleKey);
        const needsQual = row.external && row.name.trim() && !row.qualification.trim();
        const canSavePartner =
          isAdmin && row.external && !row.partnerId && row.name.trim() && row.qualification.trim();
        return (
          <div
            key={row._id}
            className={`ot-team-row${row.external ? ' outside' : ''}`}
            data-testid={`ot-team-row-${n}`}
          >
            <div className="ot-team-line">
              <select
                className="drop-select"
                value={row.roleKey}
                onChange={(e) => pickRole(row, e.target.value)}
                aria-label={`Role ${n}`}
              >
                <option value="">Role…</option>
                {!inList && row.roleKey && <option value={row.roleKey}>{row.roleLabel || row.roleKey}</option>}
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              <input
                className="fake-input"
                list="ot-team-people"
                placeholder="Name — type or pick"
                value={row.name}
                onChange={(e) => typeName(row, e.target.value)}
                aria-label={`Name ${n}`}
              />
            </div>
            <div className="ot-team-line">
              <input
                className="fake-input"
                placeholder={row.external ? 'Qualification (needed) — e.g. MD Anaesthesia' : 'Qualification'}
                value={row.qualification}
                onChange={(e) => update(row._id, { qualification: e.target.value })}
                aria-label={`Qualification ${n}`}
              />
              <input
                className="fake-input"
                placeholder="Reg. no. (optional)"
                value={row.regNo}
                onChange={(e) => update(row._id, { regNo: e.target.value })}
                aria-label={`Reg. no. ${n}`}
              />
            </div>
            <div className="ot-team-line ot-team-foot">
              <label className="ot-team-outside">
                <input
                  type="checkbox"
                  checked={!!row.external}
                  onChange={(e) => update(row._id, { external: e.target.checked, partnerId: e.target.checked ? row.partnerId : null })}
                  aria-label={`Outside (not our staff) ${n}`}
                />
                Outside (not our staff)
              </label>
              {row.external && <span className="ot-outside-tag">Outside</span>}
              <label className="ot-team-fee">
                Fee ₹
                <input
                  className="fake-input num"
                  inputMode="numeric"
                  value={String(row.fee ?? 0)}
                  onChange={(e) => update(row._id, { fee: Number(e.target.value.replace(/[^\d]/g, '')) || 0 })}
                  aria-label={`Fee ${n}`}
                />
              </label>
              <button
                type="button"
                className="ot-team-del"
                onClick={() => remove(row)}
                aria-label={`Remove team member ${n}`}
              >
                ✕
              </button>
            </div>
            {!row.name.trim() && (row.roleKey || Number(row.fee) > 0) && (
              <p className="ot-save-note">Enter a name — this row is saved once it has one.</p>
            )}
            {needsQual && (
              <p className="ot-save-note err">An outside doctor needs a medical qualification (e.g. MD Anaesthesia).</p>
            )}
            {canSavePartner && (
              <button
                type="button"
                className="ot-team-link"
                onClick={() => savePartner(row)}
                disabled={busyRow === row._id}
              >
                {busyRow === row._id ? 'Saving…' : 'Save to outside-doctor list'}
              </button>
            )}
          </div>
        );
      })}
      <button type="button" className="ot-team-add" onClick={add}>
        + Add team member
      </button>
    </div>
  );
}
