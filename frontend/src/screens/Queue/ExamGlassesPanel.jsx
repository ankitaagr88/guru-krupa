import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { rxPrint as rxPrintApi, errorMessage } from '../../api';
import {
  markExamGlassesUnsaved,
  EYES,
  LENS_FIELDS,
  LENS_ROWS,
  emptyGlasses,
  fmtAxis,
  fmtIpd,
  fmtPower,
  normalizeGlasses,
} from './glasses';
import './examGlasses.css';

/* The doctor's Examination and Glasses blocks (lane R), printed on the prescription sheet:
     Examination — one row per exam finding switched on in Admin (Fundus, Lens, IOP…), a right-eye
                   and a left-eye value; "Normal for all" / the per-row button fill the default.
     Glasses     — Dist / Near × R / L × Sph / Cyl / Axis / VA, lens types (Admin's list), IPD, note;
                   "Fill from machine reading" copies Sph / Cyl / Axis (+ PD as IPD, the chart VA as
                   Dist VA) from the visit's approved refraction reading.
   Empty = not printed. Saved explicitly with one button (Save / Saving… / Saved at 10:42 am). */

const clockTime = (d) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const FORMAT = {
  sph: (v, what) => fmtPower(v, what),
  cyl: (v, what) => {
    const out = fmtPower(v, what, 10);
    return out === 'Plano' ? '' : out;
  },
  axis: (v, what) => fmtAxis(v, what),
};

function examFromRows(rows) {
  const out = {};
  (rows || []).forEach((r) => {
    out[r.key] = { r: r.r || '', l: r.l || '' };
  });
  return out;
}

export default function ExamGlassesPanel({ visitId, disabled }) {
  const toast = useToast();
  const [lists, setLists] = useState({ examFindings: [], lensTypes: [] });
  const [saved, setSaved] = useState(null); // last ExamGlasses from the server
  const [exam, setExam] = useState({}); // key -> {r, l}
  const [glasses, setGlasses] = useState(emptyGlasses);
  const [bad, setBad] = useState({}); // field id -> message (tidy failed on blur)
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [filledFrom, setFilledFrom] = useState('');

  useEffect(() => {
    markExamGlassesUnsaved(visitId, dirty);
    return () => markExamGlassesUnsaved(visitId, false);
  }, [visitId, dirty]);

  const apply = (res) => {
    setSaved(res);
    setExam(examFromRows(res?.exam));
    setGlasses(normalizeGlasses(res?.glasses));
    setBad({});
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setDirty(false);
    setSavedAt(null);
    setFilledFrom('');
    Promise.all([rxPrintApi.lists(), rxPrintApi.get(visitId)])
      .then(([l, res]) => {
        if (!alive) return;
        setLists({ examFindings: l?.examFindings || [], lensTypes: l?.lensTypes || [] });
        apply(res);
      })
      .catch((err) => alive && toast.error('Could not load the exam and glasses', errorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  // Admin's switched-on findings, then any saved row whose finding was switched off since.
  const examRows = useMemo(() => {
    const rows = lists.examFindings.map((f) => ({
      key: f.key,
      label: f.label,
      defaultValue: f.defaultValue || '',
    }));
    (saved?.exam || []).forEach((r) => {
      if (!rows.some((x) => x.key === r.key)) rows.push({ key: r.key, label: r.label, defaultValue: '' });
    });
    return rows;
  }, [lists.examFindings, saved]);

  // Lens types: the switched-on list plus any already picked that was switched off since.
  const lensChips = useMemo(() => {
    const rows = [...lists.lensTypes];
    glasses.lensTypes.forEach((k) => {
      if (!rows.some((t) => t.key === k)) rows.push({ key: k, label: k });
    });
    return rows;
  }, [lists.lensTypes, glasses.lensTypes]);

  const touch = () => setDirty(true);
  const setExamValue = (key, eye, value) => {
    setExam((e) => ({ ...e, [key]: { r: '', l: '', ...e[key], [eye]: value } }));
    touch();
  };
  const fillRow = (row) => {
    setExam((e) => ({ ...e, [row.key]: { r: row.defaultValue, l: row.defaultValue } }));
    touch();
  };
  const fillAll = () => {
    setExam((e) => {
      const next = { ...e };
      examRows.forEach((row) => {
        if (!row.defaultValue) return;
        const cur = next[row.key] || { r: '', l: '' };
        next[row.key] = { r: cur.r || row.defaultValue, l: cur.l || row.defaultValue };
      });
      return next;
    });
    touch();
  };

  const setLens = (eye, row, field, value) => {
    setGlasses((g) => ({ ...g, [eye]: { ...g[eye], [row]: { ...g[eye][row], [field]: value } } }));
    touch();
  };
  const tidyLens = (eye, row, field, label) => {
    const fmt = FORMAT[field];
    if (!fmt) return;
    const id = `${eye}-${row}-${field}`;
    try {
      const v = fmt(glasses[eye][row][field], label);
      if (v !== glasses[eye][row][field])
        setGlasses((g) => ({ ...g, [eye]: { ...g[eye], [row]: { ...g[eye][row], [field]: v } } }));
      setBad(({ [id]: _drop, ...rest }) => rest);
    } catch (err) {
      setBad((b) => ({ ...b, [id]: err.message }));
    }
  };
  const tidyIpd = () => {
    try {
      const v = fmtIpd(glasses.ipd);
      if (v !== glasses.ipd) setGlasses((g) => ({ ...g, ipd: v }));
      setBad(({ ipd: _drop, ...rest }) => rest);
    } catch (err) {
      setBad((b) => ({ ...b, ipd: err.message }));
    }
  };
  const toggleLensType = (key) => {
    setGlasses((g) => ({
      ...g,
      lensTypes: g.lensTypes.includes(key) ? g.lensTypes.filter((k) => k !== key) : [...g.lensTypes, key],
    }));
    touch();
  };

  const fill = saved?.fromReading || null;
  const fillFromReading = () => {
    if (!fill) return;
    const va = saved?.va || {};
    setGlasses((g) => {
      const next = normalizeGlasses(g);
      EYES.forEach(([eye]) => {
        ['sph', 'cyl', 'axis'].forEach((f) => {
          next[eye].dist[f] = fill[eye]?.[f] || '';
        });
        if (!next[eye].dist.va && va[eye]) next[eye].dist.va = va[eye];
      });
      if (!next.ipd && fill.ipd) next.ipd = fill.ipd;
      return next;
    });
    setBad({});
    setFilledFrom(fill.machine);
    touch();
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        exam: examRows
          .map((row) => ({ key: row.key, r: exam[row.key]?.r || '', l: exam[row.key]?.l || '' }))
          .filter((r) => r.r.trim() || r.l.trim()),
        glasses,
      };
      const res = await rxPrintApi.save(visitId, body);
      apply(res);
      setDirty(false);
      setSavedAt(new Date());
      setFilledFrom('');
      toast.success('Exam and glasses saved', 'They print on the prescription.');
    } catch (err) {
      toast.error('Could not save the exam and glasses', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const hasSaved = !!saved && ((saved.exam || []).length > 0 || !!saved.glasses);
  const saveLabel = saving
    ? 'Saving…'
    : dirty
      ? 'Save exam & glasses'
      : savedAt
        ? `Saved at ${clockTime(savedAt)}`
        : hasSaved
          ? 'Saved'
          : 'Save exam & glasses';
  const off = disabled || loading || saving;
  const anyDefault = examRows.some((r) => r.defaultValue);

  return (
    <div className="eg-panel" id="examGlassesSection" data-testid="exam-glasses">
      <div className="eg-head">
        <div className="field-label">Examination</div>
        {anyDefault && (
          <button type="button" className="eg-link" onClick={fillAll} disabled={off}>
            Normal for all
          </button>
        )}
      </div>
      <table className="eg-table eg-exam">
        <thead>
          <tr>
            <th>Finding</th>
            <th>Right eye</th>
            <th>Left eye</th>
            <th aria-label="Quick fill" />
          </tr>
        </thead>
        <tbody>
          {examRows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {EYES.map(([eye, tag]) => (
                <td key={eye}>
                  <input
                    className="eg-input"
                    aria-label={`${row.label} ${tag}`}
                    maxLength={80}
                    value={exam[row.key]?.[eye] || ''}
                    onChange={(e) => setExamValue(row.key, eye, e.target.value)}
                    disabled={off}
                  />
                </td>
              ))}
              <td className="eg-quick">
                {row.defaultValue && (
                  <button
                    type="button"
                    className="eg-chip"
                    onClick={() => fillRow(row)}
                    disabled={off}
                    aria-label={`${row.label}: ${row.defaultValue} both eyes`}
                  >
                    {row.defaultValue}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="eg-head">
        <div className="field-label">Glasses</div>
        <button
          type="button"
          className="eg-link"
          onClick={fillFromReading}
          disabled={off || !fill}
          title={fill ? `From ${fill.machine}` : 'No approved refraction reading on this visit yet'}
        >
          Fill from machine reading
        </button>
      </div>
      {!loading && !fill && (
        <p className="eg-hint">No approved refraction reading on this visit yet — type the values.</p>
      )}
      {filledFrom && (
        <p className="eg-hint eg-filled" role="status">
          Filled from {filledFrom} — check the values, then save.
        </p>
      )}
      <div className="eg-scroll">
        <table className="eg-table eg-glasses">
          <thead>
            <tr>
              <th rowSpan={2} />
              {EYES.map(([eye, tag]) => (
                <th key={eye} colSpan={4} className="eg-eye">
                  {tag === 'R' ? 'Right eye' : 'Left eye'}
                </th>
              ))}
            </tr>
            <tr>
              {EYES.map(([eye]) =>
                LENS_FIELDS.map(([f, label]) => (
                  <th key={`${eye}-${f}`} className="eg-sub">
                    {label}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {LENS_ROWS.map(([row, rowLabel]) => (
              <tr key={row}>
                <th scope="row">{rowLabel}</th>
                {EYES.map(([eye, tag]) =>
                  LENS_FIELDS.map(([f, label]) => {
                    const id = `${eye}-${row}-${f}`;
                    const what = `${tag} ${rowLabel} ${label}`;
                    return (
                      <td key={id}>
                        <input
                          className={`eg-input mono${bad[id] ? ' bad' : ''}`}
                          aria-label={what}
                          aria-invalid={bad[id] ? true : undefined}
                          title={bad[id] || undefined}
                          inputMode={f === 'va' ? 'text' : 'decimal'}
                          maxLength={20}
                          value={glasses[eye][row][f]}
                          onChange={(e) => setLens(eye, row, f, e.target.value)}
                          onBlur={() => tidyLens(eye, row, f, what)}
                          disabled={off}
                        />
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.values(bad).length > 0 && (
        <p className="eg-hint eg-bad" role="alert">
          {Object.values(bad)[0]}
        </p>
      )}
      {lensChips.length > 0 && (
        <div className="eg-lens" role="group" aria-label="Lens type">
          {lensChips.map((t) => {
            const on = glasses.lensTypes.includes(t.key);
            return (
              <button
                key={t.key}
                type="button"
                className={`eg-chip${on ? ' active' : ''}`}
                aria-pressed={on}
                onClick={() => toggleLensType(t.key)}
                disabled={off}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="eg-row">
        <label className="eg-ipd">
          <span>IPD</span>
          <input
            className={`eg-input mono${bad.ipd ? ' bad' : ''}`}
            aria-label="IPD (mm)"
            inputMode="decimal"
            maxLength={8}
            value={glasses.ipd}
            onChange={(e) => {
              setGlasses((g) => ({ ...g, ipd: e.target.value }));
              touch();
            }}
            onBlur={tidyIpd}
            disabled={off}
          />
          <span className="faint">mm</span>
        </label>
        <input
          className="eg-input eg-note"
          aria-label="Glasses note"
          placeholder="Note for the optician (optional)"
          maxLength={255}
          value={glasses.note}
          onChange={(e) => {
            setGlasses((g) => ({ ...g, note: e.target.value }));
            touch();
          }}
          disabled={off}
        />
      </div>
      <div className="eg-actions">
        {dirty && !saving && (
          <span className="eg-unsaved" role="status" data-testid="eg-unsaved">
            Unsaved changes
          </span>
        )}
        <button
          type="button"
          className={`btn-primary sm eg-save${!dirty && !saving && (savedAt || hasSaved) ? ' saved' : ''}`}
          onClick={save}
          disabled={off || !dirty}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
