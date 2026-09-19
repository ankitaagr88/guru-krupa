import { useEffect, useState } from 'react';
import './medicineForm.css';

/* Minimal "add / edit a medicine" form (POST/PATCH /admin/medicines body):
     { brand?, composition (required), form, strength?, packSize?, manufacturer? }
   Used inline in the prescription modal ("Add to medicine list") and inside the
   Admin add-medicine modal. `forms` = config.medicineForms [{key,label}]. */

const EMPTY = { brand: '', composition: '', form: 'drops', strength: '', packSize: '', manufacturer: '' };

export function emptyMedicine(seed = {}) {
  return { ...EMPTY, ...seed };
}

export default function MedicineForm({
  forms = [],
  initial,
  onSubmit,
  onCancel,
  busy = false,
  submitLabel = 'Add to list',
  idPrefix = 'medForm',
  autoFocusField = 'brand',
}) {
  const [f, setF] = useState(() => emptyMedicine(initial));
  const [err, setErr] = useState('');
  useEffect(() => {
    setF(emptyMedicine(initial));
    setErr('');
  }, [initial]);
  useEffect(() => {
    // default the type to the first configured one when "drops" isn't available
    if (forms.length && !forms.some((x) => x.key === f.form)) setF((v) => ({ ...v, form: forms[0].key }));
  }, [forms, f.form]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = (e) => {
    e?.preventDefault?.();
    if (!f.composition.trim()) {
      setErr('Composition (generic name) is required.');
      return;
    }
    setErr('');
    const body = { composition: f.composition.trim(), form: f.form };
    ['brand', 'strength', 'packSize', 'manufacturer'].forEach((k) => {
      const v = f[k].trim();
      if (v) body[k] = v;
    });
    onSubmit(body);
  };

  return (
    <form className="med-form" onSubmit={submit} data-testid="medicine-form">
      <div className="med-form-grid">
        <input
          className="fake-input"
          id={`${idPrefix}Brand`}
          placeholder="Brand (as printed on the pack)"
          aria-label="Brand"
          value={f.brand}
          onChange={set('brand')}
          autoFocus={autoFocusField === 'brand'}
        />
        <input
          className="fake-input"
          id={`${idPrefix}Composition`}
          placeholder="Composition / generic name *"
          aria-label="Composition"
          value={f.composition}
          onChange={set('composition')}
          autoFocus={autoFocusField === 'composition'}
        />
        <select
          className="drop-select"
          id={`${idPrefix}Form`}
          aria-label="Medicine type"
          value={f.form}
          onChange={set('form')}
        >
          {(forms.length ? forms : [{ key: 'drops', label: 'Drops' }]).map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
        <input
          className="fake-input"
          id={`${idPrefix}Strength`}
          placeholder="Strength — 0.5%"
          aria-label="Strength"
          value={f.strength}
          onChange={set('strength')}
        />
        <input
          className="fake-input"
          id={`${idPrefix}Pack`}
          placeholder="Pack — 5 ml / 10 tabs"
          aria-label="Pack size"
          value={f.packSize}
          onChange={set('packSize')}
        />
        <input
          className="fake-input"
          id={`${idPrefix}Maker`}
          placeholder="Manufacturer"
          aria-label="Manufacturer"
          value={f.manufacturer}
          onChange={set('manufacturer')}
        />
      </div>
      {err && (
        <p className="med-form-err" role="alert">
          {err}
        </p>
      )}
      <div className="med-form-actions">
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
