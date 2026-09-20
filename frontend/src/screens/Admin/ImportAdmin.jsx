import { useEffect, useRef, useState } from 'react';
import { imports as api, errorMessage } from '../../api';
import { IconUpload } from '../../components/Icons';
import './import.css';

/* Admin › Import from KiviHealth (B13/F15).
   Upload a CSV / Excel export → say what it holds → match its columns to the
   app's fields (suggested automatically from the header names) → preview every
   row (new / update / skip, with the reason) → import. Nothing is written
   until "Import" is pressed; a repeat import of the same file changes nothing. */

const ORDER_HINT = 'Import in this order: Patients → Medicines → Stock → Prescriptions (prescriptions need the patients to be there first).';

export function ImportSection() {
  const [targets, setTargets] = useState([]);
  const [file, setFile] = useState(null); // ImportFileOut
  const [target, setTarget] = useState('patients');
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    api.targets().then(setTargets).catch(() => setTargets([]));
  }, []);

  const fields = targets.find((t) => t.key === target)?.fields || [];

  const reset = () => {
    setFile(null);
    setMapping({});
    setPreview(null);
    setResult(null);
    setErr('');
    setShowAll(false);
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    reset();
    setBusy('upload');
    try {
      const info = await api.upload(f);
      setFile(info);
      // best guess of what the file is: the target with the most matched columns
      const best = Object.entries(info.suggested || {}).sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length)[0];
      const t = best && Object.keys(best[1]).length ? best[0] : 'patients';
      setTarget(t);
      setMapping(info.suggested?.[t] || {});
    } catch (ex) {
      setErr(errorMessage(ex, 'Could not read the file'));
    } finally {
      setBusy('');
    }
  };

  const pickTarget = (t) => {
    setTarget(t);
    setMapping(file?.suggested?.[t] || {});
    setPreview(null);
    setResult(null);
    setErr('');
  };

  const setMap = (key, header) => {
    setMapping((m) => {
      const next = { ...m };
      // a column can feed only one field
      Object.keys(next).forEach((k) => {
        if (next[k] === header && k !== key) delete next[k];
      });
      if (header) next[key] = header;
      else delete next[key];
      return next;
    });
    setPreview(null);
    setResult(null);
  };

  const runPreview = async () => {
    setBusy('preview');
    setErr('');
    setResult(null);
    try {
      setPreview(await api.preview(file.token, target, mapping));
    } catch (ex) {
      setErr(errorMessage(ex, 'Could not preview'));
    } finally {
      setBusy('');
    }
  };

  const runImport = async () => {
    if (!preview) return;
    const n = preview.new + preview.update;
    if (!window.confirm(`Import now? ${preview.new} new, ${preview.update} updated, ${preview.skip} skipped.${n === 0 ? ' Nothing will change.' : ''}`))
      return;
    setBusy('run');
    setErr('');
    try {
      const r = await api.run(file.token, target, mapping);
      setResult(r);
      setPreview(null);
    } catch (ex) {
      setErr(errorMessage(ex, 'Import failed — nothing was written'));
    } finally {
      setBusy('');
    }
  };

  const missing = fields.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
  const shown = (preview || result)?.rows || [];
  const rowsToShow = showAll ? shown : shown.slice(0, 50);

  return (
    <section className="admin-block" aria-labelledby="h-import">
      <h2 id="h-import">Import from KiviHealth</h2>
      <p className="hint">
        Bring the clinic&apos;s existing records in from a KiviHealth export (or any spreadsheet with the same
        information). Upload the file, check the column matching, look at the preview, then import.
        Nothing is written until you press Import, and importing the same file twice changes nothing. {ORDER_HINT}
      </p>

      {/* ---- step 1: file */}
      <div className="imp-step">
        <div className="imp-step-head">
          <span className="step-order">1</span>
          <span>Choose the export file</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onFile}
          style={{ display: 'none' }}
          data-testid="import-file-input"
          aria-label="Export file"
        />
        <button type="button" className="dashed-action" onClick={() => inputRef.current?.click()} disabled={busy === 'upload'}>
          <IconUpload />
          {busy === 'upload' ? 'Reading the file…' : file ? `Choose a different file (now: ${file.filename})` : 'Choose a CSV or Excel file'}
        </button>
        {file && (
          <p className="imp-file-note" data-testid="import-file-note">
            <b>{file.filename}</b> · {file.rowCount} row{file.rowCount === 1 ? '' : 's'} · columns: {file.headers.join(', ')}
          </p>
        )}
      </div>

      {file && (
        <>
          {/* ---- step 2: what is it */}
          <div className="imp-step">
            <div className="imp-step-head">
              <span className="step-order">2</span>
              <span>What does this file hold?</span>
            </div>
            <div className="seg-toggle imp-targets" role="radiogroup" aria-label="What to import">
              {targets.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={target === t.key}
                  className={target === t.key ? 'active' : ''}
                  onClick={() => pickTarget(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* ---- step 3: columns */}
          <div className="imp-step">
            <div className="imp-step-head">
              <span className="step-order">3</span>
              <span>Match the columns</span>
            </div>
            <table className="data-table uniform-cells admin-table imp-map" data-testid="import-mapping">
              <thead>
                <tr>
                  <th>The app needs</th>
                  <th>Column in the file</th>
                  <th>Example</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const h = mapping[f.key] || '';
                  const idx = file.headers.indexOf(h);
                  const example = idx >= 0 ? file.sample.map((r) => r[idx]).find((v) => v) || '' : '';
                  return (
                    <tr key={f.key}>
                      <td data-label="The app needs">
                        <b>{f.label}</b>
                        {f.required && <span className="imp-req"> · required</span>}
                        {f.hint && <div className="imp-hint">{f.hint}</div>}
                      </td>
                      <td data-label="Column in the file">
                        <select
                          className="admin-select"
                          value={h}
                          onChange={(e) => setMap(f.key, e.target.value)}
                          aria-label={`Column for ${f.label}`}
                        >
                          <option value="">— not in this file —</option>
                          {file.headers.map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label="Example" className="imp-example">
                        {example}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {missing.length > 0 && (
              <p className="ot-save-note err" data-testid="import-missing">
                Still needed: {missing.join(', ')}
              </p>
            )}
            <div className="reading-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={runPreview}
                disabled={busy !== '' || missing.length > 0}
                data-testid="import-preview"
              >
                {busy === 'preview' ? 'Checking every row…' : 'Preview'}
              </button>
              <span className="imp-hint">Shows what each row would do. Nothing is written.</span>
            </div>
          </div>

          {/* ---- step 4: preview / result */}
          {(preview || result) && (
            <div className="imp-step" data-testid="import-result">
              <div className="imp-step-head">
                <span className="step-order">4</span>
                <span>{result ? 'Imported' : 'Preview'}</span>
              </div>
              <div className="imp-summary">
                <span className="status-pill done">{(preview || result).new} new</span>
                <span className="status-pill info">{(preview || result).update} updated</span>
                <span className="status-pill">{(preview || result).skip} skipped</span>
                <span className="imp-hint">of {(preview || result).total} rows</span>
              </div>
              {result && (
                <p className="rx-fill-note" data-testid="import-done">
                  Done — {result.new} added, {result.update} updated, {result.skip} left as they were.
                  {target === 'prescriptions' && ' The treatment standards now count these prescriptions.'}
                </p>
              )}
              <table className="data-table uniform-cells admin-table imp-rows">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Row</th>
                    <th style={{ width: 90 }}>Action</th>
                    <th>What</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsToShow.map((r) => (
                    <tr key={r.row} className={`imp-row-${r.action}`}>
                      <td data-label="Row" className="num">
                        {r.row}
                      </td>
                      <td data-label="Action">
                        <span className={`status-pill ${r.action === 'new' ? 'done' : r.action === 'update' ? 'info' : ''}`}>
                          {r.action === 'new' ? 'New' : r.action === 'update' ? 'Update' : 'Skip'}
                        </span>
                      </td>
                      <td data-label="What">{r.label}</td>
                      <td data-label="Why" className="imp-reason">
                        {r.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 50 && !showAll && (
                <button type="button" className="admin-link" onClick={() => setShowAll(true)}>
                  Show all {shown.length} rows
                </button>
              )}
              {preview && (
                <div className="reading-actions">
                  <button type="button" className="btn-primary" onClick={runImport} disabled={busy !== ''} data-testid="import-run">
                    {busy === 'run' ? 'Importing…' : `Import ${preview.new + preview.update} row${preview.new + preview.update === 1 ? '' : 's'}`}
                  </button>
                  <button type="button" className="btn-ghost" onClick={reset} disabled={busy !== ''}>
                    Start over
                  </button>
                </div>
              )}
              {result && (
                <div className="reading-actions">
                  <button type="button" className="btn-ghost" onClick={reset}>
                    Import another file
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {err && (
        <p className="ot-save-note err" role="alert">
          {err}
        </p>
      )}
    </section>
  );
}
