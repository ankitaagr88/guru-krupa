import { useEffect, useState } from 'react';
import './medicineForm.css';

/* "Add a medicine" — one field, the medicine name, exactly as KiviHealth keeps
   it. Posted as `composition` (the server's required field; the display name
   defaults to it). Used inline in the prescription modal ("Add to medicine
   list") and inside the Admin add-medicine modal. */

export function emptyMedicine(seed = {}) {
  return { name: '', ...seed };
}

export default function MedicineForm({
  initial,
  onSubmit,
  onCancel,
  busy = false,
  submitLabel = 'Add to list',
  idPrefix = 'medForm',
}) {
  const [f, setF] = useState(() => emptyMedicine(initial));
  const [err, setErr] = useState('');
  useEffect(() => {
    setF(emptyMedicine(initial));
    setErr('');
  }, [initial]);

  const submit = (e) => {
    e?.preventDefault?.();
    const name = f.name.trim();
    if (!name) {
      setErr('Type the medicine name.');
      return;
    }
    setErr('');
    onSubmit({ composition: name });
  };

  return (
    <form className="med-form" onSubmit={submit} data-testid="medicine-form">
      <div className="med-form-row">
        <input
          className="fake-input"
          id={`${idPrefix}Name`}
          placeholder="Medicine name"
          aria-label="Medicine name"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          autoFocus
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
