import { useMemo, useState } from 'react';
import Modal from '../../components/Modal';
import { admin as adminApi } from '../../api';
import MedicineForm from './MedicineForm';
import { EditableText } from './pieces';

/* Admin › Medicines (master list, /admin/medicines): the name, plus the price per pack
   that "Bought here" puts on the bill (empty = not priced; the bill then asks reception to
   type it). Takes the
   parent's `run(fn, okMsg)` so errors toast the same way as every other Admin
   section. The medicine-types list (/admin/medicine-forms) still exists on the
   server but is no longer shown — medicines carry no details. */

export function MedicinesSection({ medicines, run, showInactive, onShowInactive }) {
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return medicines;
    return medicines.filter((m) => (m.name || '').toLowerCase().includes(s));
  }, [medicines, q]);

  const patch = (m, body, okMsg) => run(() => adminApi.medicines.update(m.id, body), okMsg);
  const rename = (m) => (v) => {
    const next = v.trim();
    if (!next || next === m.name) return;
    // The name is stored as the composition (the server's required field); keep both in step.
    patch(m, { name: next, composition: next, brand: '' });
  };
  const reprice = (m) => (v) => {
    const s = String(v).replace(/[^\d]/g, '');
    const next = s === '' ? null : Number(s);
    if (next === (m.price ?? null)) return;
    patch(m, { price: next }, next == null ? `${m.name}: price cleared` : `${m.name}: ₹${next} a pack`);
  };
  const toggleActive = (m) =>
    m.active === false
      ? patch(m, { active: true }, `${m.name} reactivated`)
      : run(() => adminApi.medicines.remove(m.id), `${m.name} deactivated`);

  const create = async (body) => {
    setAddBusy(true);
    try {
      const ok = await run(() => adminApi.medicines.create(body), `${body.composition} added`);
      if (ok) setAddOpen(false);
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <section className="admin-block" aria-labelledby="h-medicines">
      <h2 id="h-medicines">Medicines</h2>
      <p className="hint">
        The list the doctor picks from when writing a prescription — the medicine name, as in KiviHealth, and the
        price per pack the clinic sells it for. When the front desk presses &ldquo;Bought here&rdquo;, that price goes on
        the bill; leave it empty and reception types it. Deactivated medicines stay on old prescriptions but leave the
        picker.
      </p>
      <div className="admin-tools">
        <input
          className="fake-input"
          placeholder="Find a medicine…"
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
            <th>Medicine</th>
            <th style={{ width: 150 }}>Price per pack (₹)</th>
            <th style={{ width: 70 }}>Active</th>
          </tr>
        </thead>
        <tbody id="medicineList">
          {shown.length === 0 && (
            <tr>
              <td colSpan={3} className="empty-slot">
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
              <td data-label="Medicine">
                <EditableText value={m.name} onCommit={rename(m)} ariaLabel={`Name of ${m.name}`} />
              </td>
              <td data-label="Price per pack">
                <div className="mins">
                  ₹
                  <EditableText
                    value={m.price == null ? '' : String(m.price)}
                    onCommit={reprice(m)}
                    ariaLabel={`Price per pack of ${m.name}`}
                    className="price-input"
                    placeholder="not set"
                  />
                </div>
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

      <Modal open={addOpen} title="Add a medicine" onClose={() => setAddOpen(false)} className="med-add-modal">
        {addOpen && (
          <MedicineForm
            busy={addBusy}
            idPrefix="adminMed"
            submitLabel="Add medicine"
            withPrice
            onCancel={() => setAddOpen(false)}
            onSubmit={create}
          />
        )}
      </Modal>
    </section>
  );
}
