import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
                   Empty rows are pre-filled from the visit: IOP from the latest approved tonometer
                   reading, a V/A row from the chart V/A typed at pre-testing.
     Glasses     — Dist / Near × R / L × Sph / Cyl / Axis / VA, lens types (Admin's list), IPD, note;
                   "Fill from machine reading" copies Sph / Cyl / Axis (+ PD as IPD, the chart VA as
                   Dist VA) from the visit's approved refraction reading.
   Empty = not printed. Saves on its own like the rest of the drawer: ~0.8 s after a change, when a
   box loses focus and when the drawer closes or the patient changes ("Saving… / Saved at 10:42").
   A value that does not tidy (Sph "-2.3") stays red and is not sent; the rest still saves.

   `useExamGlasses` holds the state; <ExamSection> and <GlassesSection> render the two blocks, so
   the drawer can place them apart (two columns on a wide screen). <ExamGlassesPanel> is both. */

const SAVE_DEBOUNCE_MS = 800;
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

// Which Admin exam finding is the IOP row / the V/A row (Admin names them; matched loosely).
const isIopRow = (row) => row.key === 'iop' || /^iop\b/i.test(row.label || '');
const isVaRow = (row) =>
  ['va', 'vision', 'visual_acuity'].includes(row.key) || /^(v\/a|va|visual acuity|vision)\b/i.test(row.label || '');

/** The body PUT /exam-glasses gets: tidy values; a value that does not tidy keeps the last saved
    one (and is reported in `bad`). A cylinder still waiting for its axis is held back the same way. */
function buildBody(examRows, exam, glasses, savedGlasses) {
  const g = normalizeGlasses(glasses);
  const prev = normalizeGlasses(savedGlasses);
  const out = emptyGlasses();
  const bad = {};
  const held = {};
  EYES.forEach(([eye, tag]) =>
    LENS_ROWS.forEach(([row, rowLabel]) => {
      const cur = {};
      ['sph', 'cyl', 'axis'].forEach((f) => {
        const id = `${eye}-${row}-${f}`;
        const label = LENS_FIELDS.find(([k]) => k === f)[1];
        try {
          cur[f] = FORMAT[f](g[eye][row][f], `${tag} ${rowLabel} ${label}`);
        } catch (err) {
          bad[id] = err.message;
          cur[f] = prev[eye][row][f];
        }
      });
      if (cur.cyl && !cur.axis) {
        held[`${eye}-${row}-axis`] = `${tag} ${rowLabel}: a cylinder needs an axis (0–180) before it is saved`;
        cur.cyl = prev[eye][row].cyl;
        cur.axis = prev[eye][row].axis;
      }
      out[eye][row] = { ...cur, va: g[eye][row].va.trim().replace(/\s+/g, ' ') };
    })
  );
  try {
    out.ipd = fmtIpd(g.ipd);
  } catch (err) {
    bad.ipd = err.message;
    out.ipd = prev.ipd;
  }
  out.lensTypes = [...g.lensTypes];
  out.note = g.note.trim();
  const examOut = examRows
    .map((row) => ({ key: row.key, r: exam[row.key]?.r || '', l: exam[row.key]?.l || '' }))
    .filter((r) => r.r.trim() || r.l.trim());
  return { body: { exam: examOut, glasses: out }, bad, held };
}

export function useExamGlasses(visitId, disabled) {
  const toast = useToast();
  const [lists, setLists] = useState({ examFindings: [], lensTypes: [] });
  const [saved, setSaved] = useState(null); // last ExamGlasses from the server
  const [exam, setExam] = useState({}); // key -> {r, l}
  const [glasses, setGlasses] = useState(emptyGlasses);
  const [bad, setBad] = useState({}); // field id -> message (red, not sent)
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false); // changes not saved yet
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [failed, setFailed] = useState(false);
  const [filledFrom, setFilledFrom] = useState('');
  const [prefilled, setPrefilled] = useState(''); // "IOP from HNT-1P…"

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

  /* ---------- autosave ---------- */
  const live = useRef({});
  live.current = { visitId, examRows, exam, glasses, saved, dirty };
  const timer = useRef(null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true; // (again: StrictMode mounts, unmounts and mounts in development)
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const send = useCallback(
    async ({ strict = false } = {}) => {
      clearTimeout(timer.current);
      const cur = live.current;
      if (!cur.dirty) return;
      if (inFlight.current) {
        again.current = true;
        return;
      }
      const { body, bad: nowBad, held } = buildBody(cur.examRows, cur.exam, cur.glasses, cur.saved?.glasses);
      setBad((b) => {
        const next = {};
        // still bad → stays red; newly bad → red once the box was left (strict) or already red
        Object.entries(nowBad).forEach(([id, msg]) => {
          if (strict || b[id]) next[id] = msg;
        });
        if (strict) Object.assign(next, held);
        return next;
      });
      const snapshot = { exam: cur.exam, glasses: cur.glasses };
      inFlight.current = true;
      setSaving(true);
      try {
        const res = await rxPrintApi.save(cur.visitId, body);
        if (!aliveRef.current || live.current.visitId !== cur.visitId) return;
        setSaved(res);
        setSavedAt(new Date());
        setFailed(false);
        // typed on while it was saving → still dirty; else clean (a held-back value keeps it dirty)
        const same = live.current.exam === snapshot.exam && live.current.glasses === snapshot.glasses;
        const holding = Object.keys(nowBad).length > 0 || Object.keys(held).length > 0;
        if (same && !holding) setDirty(false);
        if (!same) again.current = true;
      } catch (err) {
        if (aliveRef.current) {
          setFailed(true);
          toast.error('Could not save the exam and glasses', errorMessage(err));
        }
      } finally {
        inFlight.current = false;
        if (aliveRef.current) setSaving(false);
        if (again.current) {
          again.current = false;
          if (aliveRef.current) timer.current = setTimeout(() => send(), SAVE_DEBOUNCE_MS);
        }
      }
    },
    [toast]
  );

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send(), SAVE_DEBOUNCE_MS);
  }, [send]);

  // Print warns while something is not saved yet.
  useEffect(() => {
    markExamGlassesUnsaved(visitId, dirty || saving);
    return () => markExamGlassesUnsaved(visitId, false);
  }, [visitId, dirty, saving]);

  // What the last committed render showed — still the old visit's while its cleanup runs below.
  const committed = useRef({});
  useEffect(() => {
    committed.current = live.current;
  });
  // Drawer closes / another patient opens: send what is pending (fire and forget).
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const cur = committed.current;
      if (cur.visitId !== visitId || !cur.dirty) return;
      const { body } = buildBody(cur.examRows, cur.exam, cur.glasses, cur.saved?.glasses);
      rxPrintApi.save(visitId, body).catch(() => {});
    },
    [visitId]
  );

  // A change: mark it and save shortly after.
  const touch = () => {
    setDirty(true);
    live.current.dirty = true;
    schedule();
  };
  const onLeave = () => {
    if (live.current.dirty) setTimeout(() => send({ strict: true }), 0); // after the blur's own state update
  };

  /* ---------- load (+ pre-fill IOP / V/A) ---------- */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setDirty(false);
    setSavedAt(null);
    setFailed(false);
    setFilledFrom('');
    setPrefilled('');
    setBad({});
    Promise.all([rxPrintApi.lists(), rxPrintApi.get(visitId)])
      .then(([l, res]) => {
        if (!alive) return;
        const findings = l?.examFindings || [];
        setLists({ examFindings: findings, lensTypes: l?.lensTypes || [] });
        setSaved(res);
        const ex = examFromRows(res?.exam);
        const notes = [];
        const empty = (k) => !ex[k]?.r && !ex[k]?.l;
        const iop = res?.iop;
        findings.forEach((f) => {
          if (isIopRow(f) && iop && (iop.r || iop.l) && empty(f.key)) {
            ex[f.key] = { r: iop.r || '', l: iop.l || '' };
            notes.push(`IOP from ${String(iop.machine || 'tonometer').split(' — ')[0]}`);
          } else if (isVaRow(f) && (res?.va?.r || res?.va?.l) && empty(f.key)) {
            ex[f.key] = { r: res.va.r || '', l: res.va.l || '' };
            notes.push('V/A from chart');
          }
        });
        setExam(ex);
        setGlasses(normalizeGlasses(res?.glasses));
        if (notes.length) {
          setPrefilled(notes.join(' · '));
          live.current = { ...live.current, exam: ex, examRows: findings, saved: res, dirty: true };
          setDirty(true);
          schedule();
        }
      })
      .catch((err) => alive && toast.error('Could not load the exam and glasses', errorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  // Lens types: the switched-on list plus any already picked that was switched off since.
  const lensChips = useMemo(() => {
    const rows = [...lists.lensTypes];
    glasses.lensTypes.forEach((k) => {
      if (!rows.some((t) => t.key === k)) rows.push({ key: k, label: k });
    });
    return rows;
  }, [lists.lensTypes, glasses.lensTypes]);

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
    if (fmt) {
      const id = `${eye}-${row}-${field}`;
      try {
        const v = fmt(glasses[eye][row][field], label);
        if (v !== glasses[eye][row][field])
          setGlasses((g) => ({ ...g, [eye]: { ...g[eye], [row]: { ...g[eye][row], [field]: v } } }));
        setBad(({ [id]: _drop, ...rest }) => rest);
      } catch (err) {
        setBad((b) => ({ ...b, [id]: err.message }));
      }
    }
    onLeave();
  };
  const tidyIpd = () => {
    try {
      const v = fmtIpd(glasses.ipd);
      if (v !== glasses.ipd) setGlasses((g) => ({ ...g, ipd: v }));
      setBad(({ ipd: _drop, ...rest }) => rest);
    } catch (err) {
      setBad((b) => ({ ...b, ipd: err.message }));
    }
    onLeave();
  };
  const toggleLensType = (key) => {
    setGlasses((g) => ({
      ...g,
      lensTypes: g.lensTypes.includes(key) ? g.lensTypes.filter((k) => k !== key) : [...g.lensTypes, key],
    }));
    touch();
  };
  const setIpd = (v) => {
    setGlasses((g) => ({ ...g, ipd: v }));
    touch();
  };
  const setNote = (v) => {
    setGlasses((g) => ({ ...g, note: v }));
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

  const hasSaved = !!saved && ((saved.exam || []).length > 0 || !!saved.glasses);
  const status = saving
    ? 'Saving…'
    : failed
      ? 'Not saved'
      : dirty
        ? Object.keys(bad).length
          ? 'Fix the red box to save it'
          : 'Saving…'
        : savedAt
          ? `Saved at ${clockTime(savedAt)}`
          : hasSaved
            ? 'Saved'
            : '';

  return {
    visitId,
    loading,
    off: disabled || loading,
    exam,
    examRows,
    glasses,
    lensChips,
    bad,
    fill,
    filledFrom,
    prefilled,
    status,
    failed,
    retry: () => send({ strict: true }),
    setExamValue,
    fillRow,
    fillAll,
    setLens,
    tidyLens,
    tidyIpd,
    toggleLensType,
    setIpd,
    setNote,
    fillFromReading,
    onLeave,
  };
}

/** "Saving… / Saved at 10:42" next to a block's heading. */
function SaveStatus({ eg, testId }) {
  if (!eg.status) return null;
  return (
    <span className={`eg-status${eg.failed ? ' failed' : ''}`} role="status" data-testid={testId}>
      {eg.status}
      {eg.failed && (
        <button type="button" className="eg-link" onClick={eg.retry}>
          Try again
        </button>
      )}
    </span>
  );
}

export function ExamSection({ eg }) {
  const anyDefault = eg.examRows.some((r) => r.defaultValue);
  return (
    <div className="eg-panel" id="examSection" data-testid="exam-section">
      <div className="eg-head">
        <div className="field-label">Examination</div>
        <div className="eg-head-right">
          <SaveStatus eg={eg} testId="eg-status-exam" />
          {anyDefault && (
            <button type="button" className="eg-link" onClick={eg.fillAll} disabled={eg.off}>
              Normal for all
            </button>
          )}
        </div>
      </div>
      {eg.prefilled && (
        <p className="eg-hint eg-filled" data-testid="eg-prefilled">
          {eg.prefilled}
        </p>
      )}
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
          {eg.examRows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {EYES.map(([eye, tag]) => (
                <td key={eye}>
                  <input
                    className="eg-input"
                    aria-label={`${row.label} ${tag}`}
                    maxLength={80}
                    value={eg.exam[row.key]?.[eye] || ''}
                    onChange={(e) => eg.setExamValue(row.key, eye, e.target.value)}
                    onBlur={eg.onLeave}
                    disabled={eg.off}
                  />
                </td>
              ))}
              <td className="eg-quick">
                {row.defaultValue && (
                  <button
                    type="button"
                    className="eg-chip"
                    onClick={() => eg.fillRow(row)}
                    disabled={eg.off}
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
    </div>
  );
}

export function GlassesSection({ eg }) {
  const { glasses, bad, fill } = eg;
  const badList = Object.values(bad);
  return (
    <div className="eg-panel" id="glassesSection" data-testid="glasses-section">
      <div className="eg-head">
        <div className="field-label">Glasses</div>
        <div className="eg-head-right">
          <SaveStatus eg={eg} testId="eg-status-glasses" />
          <button
            type="button"
            className="eg-link"
            onClick={eg.fillFromReading}
            disabled={eg.off || !fill}
            title={fill ? `From ${fill.machine}` : 'No refraction reading yet'}
          >
            Fill from machine reading
          </button>
        </div>
      </div>
      {!eg.loading && !fill && (
        <p className="eg-hint">No refraction reading yet</p>
      )}
      {eg.filledFrom && (
        <p className="eg-hint eg-filled" role="status">
          Filled from {eg.filledFrom}
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
                          onChange={(e) => eg.setLens(eye, row, f, e.target.value)}
                          onBlur={() => eg.tidyLens(eye, row, f, what)}
                          disabled={eg.off}
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
      {badList.length > 0 && (
        <p className="eg-hint eg-bad" role="alert">
          {badList[0]}
        </p>
      )}
      {eg.lensChips.length > 0 && (
        <div className="eg-lens" role="group" aria-label="Lens type">
          {eg.lensChips.map((t) => {
            const on = glasses.lensTypes.includes(t.key);
            return (
              <button
                key={t.key}
                type="button"
                className={`eg-chip${on ? ' active' : ''}`}
                aria-pressed={on}
                onClick={() => eg.toggleLensType(t.key)}
                disabled={eg.off}
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
            onChange={(e) => eg.setIpd(e.target.value)}
            onBlur={eg.tidyIpd}
            disabled={eg.off}
          />
          <span className="faint">mm</span>
        </label>
        <input
          className="eg-input eg-note"
          aria-label="Glasses note"
          placeholder="Note for optician"
          maxLength={255}
          value={glasses.note}
          onChange={(e) => eg.setNote(e.target.value)}
          onBlur={eg.onLeave}
          disabled={eg.off}
        />
      </div>
    </div>
  );
}

/** Both blocks together (one column). */
export default function ExamGlassesPanel({ visitId, disabled }) {
  const eg = useExamGlasses(visitId, disabled);
  return (
    <div id="examGlassesSection" data-testid="exam-glasses">
      <ExamSection eg={eg} />
      <GlassesSection eg={eg} />
    </div>
  );
}
