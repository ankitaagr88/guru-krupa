import { useEffect, useState } from 'react';
import { readings as readingsApi, errorMessage } from '../../api';
import { useAuthedImage } from '../../lib/useAuthedImage';
import ManualEntryForm from './ManualEntryForm';
import { STATUS_META, isBusy, isLowValue, readingLabel, readingValues, sourceLine } from './lib';

/* One reading (mockup `.reading-card`): status chip, the extracted values as
   editable inputs (coral when `ok:false` / low confidence), "Save corrections"
   → PATCH /readings/{id}/values, manual fallback for failed OCR, delete. */
export default function ReadingCard({ reading: r, machines, onChange, onRemove }) {
  const meta = STATUS_META[r.status] || { label: r.status, cls: '' };
  const values = readingValues(r);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [manual, setManual] = useState(false);
  const [showImg, setShowImg] = useState(false);
  const img = useAuthedImage(showImg ? r : null);
  const machine = machines.find((m) => m.key === r.machineKey);

  // New values from the server (poll / correction) reset local edits.
  useEffect(() => {
    setEdits({});
  }, [r.status, r.corrected, r.id]);

  const dirty = Object.keys(edits).some((l) => edits[l] !== (values.find((v) => v.l === l)?.v ?? ''));

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      const next = values.map((v) => ({ l: v.l, v: String(edits[v.l] ?? v.v ?? '').trim() }));
      const updated = await readingsApi.setValues(r.id, next);
      setEdits({});
      onChange?.(updated);
    } catch (ex) {
      setErr(errorMessage(ex, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Remove this reading?')) return;
    try {
      await readingsApi.remove(r.id);
      onRemove?.(r);
    } catch (ex) {
      setErr(errorMessage(ex, 'Could not remove'));
    }
  };

  const hasImage = !!(r.imageUrl || r.imagePath);

  return (
    <div className={`reading-card status-${r.status}`} data-testid={`reading-${r.id}`}>
      <div className="reading-head">
        <span className="m">{readingLabel(r, machines)}</span>
        {!isBusy(r) && <span className="src">{sourceLine(r)}</span>}
        <span className="rh-right">
          {r.confidence != null && r.status === 'done' && (
            <span className="reading-conf">OCR {Math.round(r.confidence * 100)}%</span>
          )}
          <span className={`status-pill ${meta.cls}`} data-testid="reading-status">
            {meta.label}
          </span>
          {!isBusy(r) && (
            <button type="button" className="rm" onClick={remove} aria-label="Remove reading" title="Remove">
              ✕
            </button>
          )}
        </span>
      </div>

      {isBusy(r) && (
        <p className="processing-note">
          ⏳ Photo uploaded — extracting values on the server, usually a few seconds… you can move on.
        </p>
      )}

      {r.status === 'failed' && !manual && (
        <>
          <p className="reading-note err">
            Couldn&apos;t read the printout{r.error ? ` — ${r.error}` : ''}. Retake the photo, or type the values.
          </p>
          <div className="reading-actions">
            <button type="button" className="btn-primary" onClick={() => setManual(true)}>
              Type the values instead
            </button>
          </div>
        </>
      )}

      {r.status === 'failed' && manual && (
        <ManualEntryForm
          visitId={r.visitId}
          machine={machine || { key: r.machineKey, label: readingLabel(r, machines), fields: values.map((v) => v.l) }}
          initial={values}
          onCancel={() => setManual(false)}
          onSaved={async (created) => {
            setManual(false);
            try {
              await readingsApi.remove(r.id);
            } catch {
              /* keep the failed one around if delete fails */
            }
            onRemove?.(r, created);
          }}
        />
      )}

      {r.status === 'done' && (
        <>
          {values.length === 0 ? (
            <p className="reading-note">No values were extracted.</p>
          ) : (
            <div className="reading-vals">
              {values.map((v) => {
                const low = isLowValue(v, r);
                return (
                  <div key={v.l} className={`reading-val${low ? ' low' : ''}`} title={low ? 'Low confidence — please check' : ''}>
                    <label htmlFor={`rv-${r.id}-${v.l}`}>{v.l}</label>
                    <input
                      id={`rv-${r.id}-${v.l}`}
                      value={edits[v.l] ?? v.v ?? ''}
                      onChange={(e) => setEdits((s) => ({ ...s, [v.l]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {(dirty || err) && (
            <div className="reading-actions">
              {dirty && (
                <button type="button" className="btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save corrections'}
                </button>
              )}
              {dirty && (
                <button type="button" className="btn-ghost" onClick={() => setEdits({})}>
                  Discard
                </button>
              )}
              {err && <span className="reading-note err">{err}</span>}
            </div>
          )}
          {values.some((v) => isLowValue(v, r)) && !dirty && (
            <p className="reading-note">Highlighted values need a check against the printout.</p>
          )}
        </>
      )}

      {hasImage && !isBusy(r) && (
        <div className="reading-actions">
          <button type="button" className="machine-type-link" style={{ margin: 0 }} onClick={() => setShowImg((s) => !s)}>
            {showImg ? 'Hide photo' : 'Show photo'}
          </button>
        </div>
      )}
      {showImg && img && <img className="reading-thumb" src={img} alt="Printout" />}
    </div>
  );
}
