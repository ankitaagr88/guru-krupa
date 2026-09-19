import { useState } from 'react';
import { readings as readingsApi, errorMessage } from '../../api';

/* Manual-entry form — for `manualOnly` machines (TBUT / Schirmer) and as the
   fallback when OCR fails. Posts `POST /readings/manual {visitId, machineKey, values}`. */
export default function ManualEntryForm({ visitId, machine, initial = [], onSaved, onCancel, title }) {
  const fields = machine?.fields?.length ? machine.fields : initial.map((v) => v.l);
  const [vals, setVals] = useState(() =>
    Object.fromEntries(fields.map((l) => [l, initial.find((v) => v.l === l)?.v ?? '']))
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e?.preventDefault?.();
    const values = fields.map((l) => ({ l, v: String(vals[l] ?? '').trim() })).filter((v) => v.v !== '');
    if (values.length === 0) {
      setErr('Type at least one value.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const r = await readingsApi.manual({ visitId, machineKey: machine.key, values });
      onSaved?.(r);
    } catch (ex) {
      setErr(errorMessage(ex, 'Could not save the values'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="manual-form" onSubmit={submit} data-testid="manual-form">
      <div className="mf-title">
        <span>✍️ {title || `Type the ${machine?.label || ''} values`}</span>
        {onCancel && (
          <button type="button" className="rm" onClick={onCancel} aria-label="Cancel manual entry" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)' }}>
            ✕
          </button>
        )}
      </div>
      <div className="mf-grid">
        {fields.map((l) => (
          <label key={l}>
            {l}
            <input
              value={vals[l] ?? ''}
              onChange={(e) => setVals((s) => ({ ...s, [l]: e.target.value }))}
              inputMode="decimal"
              aria-label={l}
            />
          </label>
        ))}
      </div>
      {err && <p className="reading-note err">{err}</p>}
      <div className="modal-actions">
        <button type="submit" className="btn-primary full" disabled={saving}>
          {saving ? 'Saving…' : 'Save values'}
        </button>
      </div>
    </form>
  );
}
