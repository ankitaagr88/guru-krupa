import { useEffect, useState } from 'react';
import { rxPrint as rxPrintApi } from '../../api';
import { EditableText, ReorderBtns } from './pieces';
import './rxPrintAdmin.css';

/* Admin sections for the printed prescription (lane R), rendered from Admin.jsx:
     Prescription print (id "h-rxprint") — doctor's name, degrees, registration number and the
                                           footer note in each print language, with a mini preview.
     Exam findings      (id "h-exam")     — the Examination rows on the doctor's panel and the sheet:
                                           rename, default ("Normal"), reorder, switch off, add.
     Glass lens types   (id "h-lenstypes") — ARC, Blue cut…: rename, reorder, switch off, add.
   Rows are switched off rather than deleted, so old prescriptions still print them.
   Takes the parent's `run(fn, okMsg)`. */
export function RxPrintAdminSections({ run }) {
  return (
    <>
      <PrintSettingsSection run={run} />
      <ExamFindingsSection run={run} />
      <LensTypesSection run={run} />
    </>
  );
}

const LANGS = [
  ['english', 'English'],
  ['hindi', 'Hindi (Hinglish sheet)'],
  ['gujarati', 'Gujarati (Gujlish sheet)'],
];
const EMPTY = {
  doctorName: '',
  degrees: '',
  regNo: '',
  footerNote: { english: '', hindi: '', gujarati: '' },
};

function PrintSettingsSection({ run }) {
  const [form, setForm] = useState(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewLang, setPreviewLang] = useState('english');

  const load = async () => {
    try {
      const s = await rxPrintApi.settings();
      setForm({ ...EMPTY, ...s, footerNote: { ...EMPTY.footerNote, ...(s?.footerNote || {}) } });
      setDirty(false);
    } catch {
      setForm(EMPTY);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const setNote = (lang, v) => {
    setForm((f) => ({ ...f, footerNote: { ...f.footerNote, [lang]: v } }));
    setDirty(true);
  };
  const save = async (e) => {
    e?.preventDefault?.();
    setBusy(true);
    const ok = await run(() => rxPrintApi.admin.saveSettings(form), 'Prescription print settings saved');
    setBusy(false);
    if (ok) await load();
  };

  const note = (form.footerNote[previewLang] || '').trim() || (form.footerNote.english || '').trim();
  return (
    <section className="admin-block" aria-labelledby="h-rxprint">
      <h2 id="h-rxprint">Prescription print</h2>
      <p className="hint">
        Printed under the hospital name and at the signature of every prescription. The footer note prints in
        the prescription&apos;s language; a language left empty prints the English one.
      </p>
      <form className="rxp-settings" onSubmit={save}>
        <div className="rxp-fields">
          <label>
            <span>Doctor&apos;s name</span>
            <input
              className="fake-input"
              value={form.doctorName}
              maxLength={120}
              onChange={(e) => set('doctorName', e.target.value)}
            />
          </label>
          <label>
            <span>Degrees</span>
            <input
              className="fake-input"
              value={form.degrees}
              maxLength={160}
              placeholder="e.g. M.B.B.S., M.S. (Ophth.)"
              onChange={(e) => set('degrees', e.target.value)}
            />
          </label>
          <label>
            <span>Registration number</span>
            <input
              className="fake-input"
              value={form.regNo}
              maxLength={60}
              placeholder="Left empty: not printed"
              onChange={(e) => set('regNo', e.target.value)}
            />
          </label>
          {LANGS.map(([lang, label]) => (
            <label key={lang}>
              <span>Footer note — {label}</span>
              <input
                className="fake-input"
                value={form.footerNote[lang]}
                maxLength={300}
                aria-label={`Footer note ${lang}`}
                onChange={(e) => setNote(lang, e.target.value)}
              />
            </label>
          ))}
          <div className="rxp-save-row">
            {dirty && <span className="rxp-unsaved">Unsaved changes</span>}
            <button className="btn-primary sm" type="submit" disabled={!dirty || busy}>
              {busy ? 'Saving…' : 'Save print settings'}
            </button>
          </div>
        </div>
        <div className="rxp-preview" aria-label="Preview" data-testid="rxp-preview">
          <div className="rxp-preview-langs" role="group" aria-label="Preview language">
            {LANGS.map(([lang]) => (
              <button
                key={lang}
                type="button"
                className={previewLang === lang ? 'active' : ''}
                aria-pressed={previewLang === lang}
                onClick={() => setPreviewLang(lang)}
              >
                {lang[0].toUpperCase() + lang.slice(1)}
              </button>
            ))}
          </div>
          <div className="rxp-sheet">
            <div className="rxp-sheet-doc">
              <b>{form.doctorName || '—'}</b>
              {form.degrees && <span>{form.degrees}</span>}
              {form.regNo.trim() && <span className="mono">Reg. No. {form.regNo.trim()}</span>}
            </div>
            <div className="rxp-sheet-body">℞ …</div>
            {note && <div className="rxp-sheet-note">{note}</div>}
            <div className="rxp-sheet-sign">
              <div className="rxp-sheet-line" />
              {form.doctorName}
              {form.degrees && <small>{form.degrees}</small>}
              {form.regNo.trim() && <small className="mono">Reg. No. {form.regNo.trim()}</small>}
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}

/* One admin list (exam findings or lens types): reorder, rename, [default], switch off, add. */
function ListSection({ run, id, title, hint, noun, api, withDefault, placeholder }) {
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState('');
  const [def, setDef] = useState('');

  const load = async () => {
    try {
      setRows(await api.list());
    } catch {
      setRows([]);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (await doRun(() => api.create(n, def.trim()), `${n} added`)) {
      setLabel('');
      setDef('');
    }
  };
  const patch = (r, p) => doRun(() => api.update(r.key, p));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    doRun(() => api.reorder(next.map((r) => r.key)));
  };

  return (
    <section className="admin-block" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p className="hint">{hint}</p>
      <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}></th>
            <th>{noun}</th>
            {withDefault && <th>One-tap default</th>}
            <th style={{ width: 70 }}>Active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.key}
              data-testid={`${id}-${r.key}`}
              className={r.active === false ? 'staff-inactive' : ''}
            >
              <td className="no-label">
                <ReorderBtns
                  i={i}
                  n={rows.length}
                  onMove={(dir) => move(i, dir)}
                  label={`${noun} ${r.label}`}
                />
              </td>
              <td data-label={noun}>
                <EditableText
                  value={r.label}
                  ariaLabel={`${noun} ${r.label}`}
                  onCommit={(v) => v.trim() && v.trim() !== r.label && patch(r, { label: v.trim() })}
                />
              </td>
              {withDefault && (
                <td data-label="One-tap default">
                  <EditableText
                    value={r.defaultValue || ''}
                    placeholder="none"
                    ariaLabel={`Default for ${r.label}`}
                    onCommit={(v) => patch(r, { defaultValue: v.trim() })}
                  />
                </td>
              )}
              <td data-label="Active">
                <button
                  type="button"
                  className={`switch${r.active !== false ? ' on' : ''}`}
                  role="switch"
                  aria-checked={r.active !== false}
                  aria-label={`${noun} ${r.label} active`}
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
          placeholder={placeholder}
          aria-label={`New ${noun.toLowerCase()}`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        {withDefault && (
          <input
            className="fake-input"
            placeholder="Default (optional)"
            aria-label={`Default for the new ${noun.toLowerCase()}`}
            value={def}
            onChange={(e) => setDef(e.target.value)}
          />
        )}
        <button className="admin-add" type="submit" disabled={!label.trim()}>
          + Add
        </button>
      </form>
    </section>
  );
}

const examApi = {
  list: () => rxPrintApi.admin.examFindings(),
  create: (label, def) => rxPrintApi.admin.createExamFinding(label, def),
  update: (key, patch) => rxPrintApi.admin.updateExamFinding(key, patch),
  reorder: (keys) => rxPrintApi.admin.reorderExamFindings(keys),
};
const lensApi = {
  list: () => rxPrintApi.admin.lensTypes(),
  create: (label) => rxPrintApi.admin.createLensType(label),
  update: (key, patch) => rxPrintApi.admin.updateLensType(key, patch),
  reorder: (keys) => rxPrintApi.admin.reorderLensTypes(keys),
};

function ExamFindingsSection({ run }) {
  return (
    <ListSection
      run={run}
      id="h-exam"
      title="Exam findings"
      noun="Finding"
      withDefault
      api={examApi}
      placeholder="New finding — e.g. Cornea"
      hint={
        'The Examination rows on the doctor’s panel, each with a right-eye and a left-eye value, in this order. ' +
        'The default is what “Normal for all” fills in. Only filled-in rows print. Switch a row off to hide it ' +
        'from new visits; old prescriptions keep it.'
      }
    />
  );
}

function LensTypesSection({ run }) {
  return (
    <ListSection
      run={run}
      id="h-lenstypes"
      title="Glass lens types"
      noun="Lens type"
      api={lensApi}
      placeholder="New lens type — e.g. Anti-glare"
      hint={
        'The lens types the doctor can tick for a glasses prescription; they print next to “Glass details”. ' +
        'Switch one off to hide it from new visits.'
      }
    />
  );
}
