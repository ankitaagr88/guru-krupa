import { useMemo, useState } from 'react';
import Modal from '../../components/Modal';
import { admin as adminApi } from '../../api';
import MedicineForm from './MedicineForm';
import { EditableText, ReorderBtns, slugKey } from './pieces';

/* Admin › Medicines (master list, /admin/medicines) and Medicine types
   (/admin/medicine-forms). Both take the parent's `run(fn, okMsg)` so errors
   toast the same way as every other Admin section (409 → "Not allowed right now"
   + the server's message, e.g. "2 medicine(s) use form 'gel'"). */

const opt = (v) => (v == null || v === '' ? '' : String(v));

export function MedicinesSection({ medicines, forms, run, showInactive, onShowInactive }) {
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);

  const activeForms = forms.filter((f) => f.active !== false);
  const formLabel = (key) => forms.find((f) => f.key === key)?.label || key;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return medicines;
    return medicines.filter((m) =>
      [m.name, m.brand, m.composition, m.manufacturer].some((v) => (v || '').toLowerCase().includes(s))
    );
  }, [medicines, q]);

  const patch = (m, body, okMsg) => run(() => adminApi.medicines.update(m.id, body), okMsg);
  const setText = (m, key) => (v) => {
    const next = v.trim();
    if (next === opt(m[key]).trim()) return;
    if (key === 'composition' && !next) return;
    patch(m, { [key]: next }); // "" clears an optional field
  };
  const toggleActive = (m) =>
    m.active === false
      ? patch(m, { active: true }, `${m.name} reactivated`)
      : run(() => adminApi.medicines.remove(m.id), `${m.name} deactivated`);

  const create = async (body) => {
    setAddBusy(true);
    try {
      const ok = await run(() => adminApi.medicines.create(body), `${body.brand || body.composition} added`);
      if (ok) setAddOpen(false);
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <section className="admin-block" aria-labelledby="h-medicines">
      <h2 id="h-medicines">Medicines</h2>
      <p className="hint">
        The list the doctor picks from when writing a prescription. Chemists dispense by <b>brand</b>, so each
        row is a brand with its composition (generic) underneath — or a plain generic with no brand.
        Deactivated medicines stay on old prescriptions but leave the picker.
      </p>
      <div className="admin-tools">
        <input
          className="fake-input"
          placeholder="Find by brand, composition or maker…"
          aria-label="Find a medicine"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="admin-check">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => onShowInactive(e.target.checked)}
            aria-label="Show inactive medicines"
          />
          Show inactive
        </label>
      </div>
      <table className="data-table uniform-cells admin-table med-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th>Brand</th>
            <th>Composition</th>
            <th style={{ width: 120 }}>Type</th>
            <th style={{ width: 90 }}>Strength</th>
            <th style={{ width: 90 }}>Pack</th>
            <th style={{ width: 120 }}>Maker</th>
            <th style={{ width: 70 }}>Active</th>
          </tr>
        </thead>
        <tbody id="medicineList">
          {shown.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-slot">
                {medicines.length === 0 ? 'No medicines yet' : 'Nothing matches'}
              </td>
            </tr>
          )}
          {shown.map((m) => (
            <tr
              key={m.id}
              className={m.active === false ? 'staff-inactive' : ''}
              data-testid={`medicine-${m.id}`}
            >
              <td data-label="Brand">
                <EditableText
                  value={opt(m.brand)}
                  placeholder={m.brand ? '' : 'generic only'}
                  onCommit={setText(m, 'brand')}
                  ariaLabel={`Brand of ${m.name}`}
                />
              </td>
              <td data-label="Composition">
                <EditableText
                  value={opt(m.composition)}
                  onCommit={setText(m, 'composition')}
                  ariaLabel={`Composition of ${m.name}`}
                />
              </td>
              <td data-label="Type">
                <select
                  className="admin-select"
                  value={m.form}
                  aria-label={`Type of ${m.name}`}
                  onChange={(e) => patch(m, { form: e.target.value })}
                >
                  {!activeForms.some((f) => f.key === m.form) && (
                    <option value={m.form}>{formLabel(m.form)}</option>
                  )}
                  {activeForms.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </td>
              <td data-label="Strength">
                <EditableText
                  value={opt(m.strength)}
                  placeholder="—"
                  onCommit={setText(m, 'strength')}
                  ariaLabel={`Strength of ${m.name}`}
                />
              </td>
              <td data-label="Pack">
                <EditableText
                  value={opt(m.packSize)}
                  placeholder="—"
                  onCommit={setText(m, 'packSize')}
                  ariaLabel={`Pack size of ${m.name}`}
                />
              </td>
              <td data-label="Maker">
                <EditableText
                  value={opt(m.manufacturer)}
                  placeholder="—"
                  onCommit={setText(m, 'manufacturer')}
                  ariaLabel={`Manufacturer of ${m.name}`}
                />
              </td>
              <td data-label="Active">
                <button
                  type="button"
                  className={`switch${m.active !== false ? ' on' : ''}`}
                  role="switch"
                  aria-checked={m.active !== false}
                  aria-label={`${m.name} active`}
                  onClick={() => toggleActive(m)}
                >
                  <div className="knob" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="admin-add" onClick={() => setAddOpen(true)} type="button">
        + Add a medicine
      </button>

      <Modal
        open={addOpen}
        title="Add a medicine"
        sub="Brand as printed on the pack, with its composition. Leave the brand empty for a plain generic."
        onClose={() => setAddOpen(false)}
        className="med-add-modal"
      >
        {addOpen && (
          <MedicineForm
            forms={activeForms}
            busy={addBusy}
            idPrefix="adminMed"
            submitLabel="Add medicine"
            onCancel={() => setAddOpen(false)}
            onSubmit={create}
          />
        )}
      </Modal>
    </section>
  );
}

export function MedicineTypesSection({ forms, run }) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const effectiveKey = keyTouched ? key : slugKey(label);

  const swap = (rows, i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return null;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  const rename = (f, v) =>
    v.trim() && v.trim() !== f.label && run(() => adminApi.medicineForms.update(f.key, { label: v.trim() }));
  const move = (i, dir) => {
    const next = swap(forms, i, dir);
    if (next) run(() => adminApi.medicineForms.reorder(next.map((f) => f.key)));
  };
  const toggle = (f) => run(() => adminApi.medicineForms.update(f.key, { active: f.active === false }));
  const remove = (f) => {
    if (!window.confirm(`Delete the "${f.label}" type? Medicines using it must be changed first.`)) return;
    run(() => adminApi.medicineForms.remove(f.key), `${f.label} deleted`);
  };
  const add = async (e) => {
    e?.preventDefault?.();
    const l = label.trim();
    const k = effectiveKey.trim();
    if (!l || !k) return;
    const ok = await run(() => adminApi.medicineForms.create({ key: k, label: l }), `${l} added`);
    if (ok) {
      setLabel('');
      setKey('');
      setKeyTouched(false);
    }
  };

  return (
    <section className="admin-block" aria-labelledby="h-medforms">
      <h2 id="h-medforms">Medicine types</h2>
      <p className="hint">
        Drops, gel, tablet… — the type shown next to each medicine and printed on the prescription. Order here
        is the order in the type dropdown. A type that medicines still use can&apos;t be deleted; switch it
        off instead to hide it from new medicines.
      </p>
      <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}></th>
            <th>Type label</th>
            <th style={{ width: 120 }}>Key</th>
            <th style={{ width: 70 }}>Active</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody id="medicineFormList">
          {forms.map((f, i) => (
            <tr
              key={f.key}
              data-testid={`medform-${f.key}`}
              className={f.active === false ? 'staff-inactive' : ''}
            >
              <td className="no-label">
                <ReorderBtns
                  i={i}
                  n={forms.length}
                  onMove={(dir) => move(i, dir)}
                  label={`type ${f.label}`}
                />
              </td>
              <td data-label="Type label">
                <EditableText value={f.label} onCommit={(v) => rename(f, v)} ariaLabel={`Type ${f.label}`} />
              </td>
              <td data-label="Key">
                <code className="admin-key">{f.key}</code>
              </td>
              <td data-label="Active">
                <button
                  type="button"
                  className={`switch${f.active !== false ? ' on' : ''}`}
                  role="switch"
                  aria-checked={f.active !== false}
                  aria-label={`Type ${f.label} active`}
                  onClick={() => toggle(f)}
                >
                  <div className="knob" />
                </button>
              </td>
              <td className="no-label">
                <button
                  className="admin-del"
                  onClick={() => remove(f)}
                  aria-label={`Delete type ${f.label}`}
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
          placeholder="New type — e.g. Nasal spray"
          aria-label="New type label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="fake-input admin-key-input"
          placeholder="key"
          aria-label="New type key"
          value={effectiveKey}
          onChange={(e) => {
            setKeyTouched(true);
            setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-'));
          }}
        />
        <button className="admin-add" type="submit" disabled={!label.trim() || !effectiveKey}>
          + Add a type
        </button>
      </form>
    </section>
  );
}
