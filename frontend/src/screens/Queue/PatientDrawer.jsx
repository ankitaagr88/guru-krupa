import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Drawer from '../../components/Drawer';
import { useToast } from '../../components/Toast';
import {
  patients as patientsApi,
  visits as visitsApi,
  readings as readingsApi,
  prescriptions as prescriptionsApi,
  errorMessage,
} from '../../api';
import { PrescriptionModal } from '../Prescription';
import { ageSex, fmtLastVisit } from '../../lib/format';
import DilationChecklist from './DilationChecklist';
import BillingPanel from './BillingPanel';
import RegistrationDetails from './RegistrationDetails';
import DispensePanel from './DispensePanel';
import {
  dilationComplete,
  normalizeExamPhoto,
  normalizeReading,
  numOrNull,
  referralNeedsDetail,
  splitPatch,
} from './queueModel';

const SAVE_DEBOUNCE_MS = 450;
const DETAIL_KEYS = [
  'name',
  'phone',
  'age',
  'sex',
  'address',
  'occupation',
  'screenHours',
  'existingConditions',
  'conditionOther',
  'language',
  'referralSource',
  'referralDetail',
  'elsewhere',
  'elsewhereNote',
  'doctorNotes',
  'note',
];
const KNOWN_STAGES = ['reg', 'pretest', 'doctor', 'dilate', 'billing', 'done'];
// Stages where the doctor writes / prints the prescription from the drawer (F14)
const RX_STAGES = ['doctor', 'dilate', 'billing']; // billing: the front desk confirms what was bought

function pickDraft(row) {
  const d = {};
  DETAIL_KEYS.forEach((k) => {
    d[k] = row[k];
  });
  d.existingConditions = [...(row.existingConditions || [])];
  d.va = { R: row.va?.R || '', L: row.va?.L || '' };
  return d;
}

const hintStyle = { fontSize: 11, color: 'var(--ink-faint)', margin: '-4px 0 10px' };

/* Patient drawer (mockup `openDrawer`): summary + the stage-specific section +
   the "Move patient" buttons. Everything autosaves (debounced PATCH). `row` is the
   normalised visit (see queueModel.js); `now` is the 1 s ticker; `refreshKey`
   bumps after every board reload so readings/bill refetch. */
export default function PatientDrawer({
  open,
  row,
  stages,
  config,
  now,
  refreshKey,
  onClose,
  onMove,
  onStartDilation,
  onComplete,
  onStepGiven,
  busy,
}) {
  const toast = useToast();
  const stage = row ? stages.find((s) => s.key === row.stage) : null;
  const stageKey = row?.stage;
  // Draft is keyed by visit id: re-seeded synchronously when a different visit opens,
  // but never clobbered by a poll while the user is typing.
  const [draftState, setDraftState] = useState(() => ({ id: row?.id, d: row ? pickDraft(row) : null }));
  const draft = draftState.id === row?.id ? draftState.d : row ? pickDraft(row) : null;
  const setDraft = (fn) =>
    setDraftState((s) => ({
      id: row?.id,
      d: typeof fn === 'function' ? fn(s.id === row?.id ? s.d : draft) : fn,
    }));
  const [readings, setReadings] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [paymentMode, setPaymentMode] = useState(null); // reported by BillingPanel
  const [rxLines, setRxLines] = useState(null); // null = not loaded → fall back to row.medicines
  const [rxOpen, setRxOpen] = useState(false);
  const pending = useRef({ row: null, patch: {} });
  const timer = useRef(null);
  const vaTimer = useRef(null);
  const rowRef = useRef(row);
  rowRef.current = row;

  const rowId = row?.id;
  useEffect(() => {
    setDraftState({ id: rowId, d: rowRef.current ? pickDraft(rowRef.current) : null });
  }, [rowId]);

  /* ---------- autosave ---------- */
  const flush = useCallback(async () => {
    const { row: r, patch } = pending.current;
    pending.current = { row: null, patch: {} };
    if (!r || Object.keys(patch).length === 0) return;
    const { patient, visit } = splitPatch(patch);
    try {
      const calls = [];
      if (Object.keys(patient).length) calls.push(patientsApi.update(r.patientId, patient));
      if (Object.keys(visit).length && typeof visitsApi.update === 'function')
        calls.push(visitsApi.update(r.id, visit));
      await Promise.all(calls);
    } catch (err) {
      toast.error('Could not save', errorMessage(err));
    }
  }, [toast]);

  const queueSave = useCallback(
    (patch, { immediate = false } = {}) => {
      // Patches are pinned to the row they were typed against, so a patient switch can't misroute them.
      if (pending.current.row && pending.current.row.id !== rowRef.current?.id) flush();
      pending.current = { row: rowRef.current, patch: { ...pending.current.patch, ...patch } };
      clearTimeout(timer.current);
      if (immediate) flush();
      else timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush]
  );
  // Flush on close / unmount / switching patient.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      flush();
    },
    [flush, rowId]
  );

  const setField = (k, v, opts) => {
    setDraft((d) => ({ ...d, [k]: v }));
    const out = k === 'age' ? numOrNull(v, { int: true }) : k === 'screenHours' ? numOrNull(v) : v;
    queueSave({ [k]: out }, opts);
  };

  const setVA = (side, val) => {
    const va = { ...(draft?.va || { R: '', L: '' }), [side]: val };
    setDraft((d) => ({ ...d, va }));
    clearTimeout(vaTimer.current);
    vaTimer.current = setTimeout(() => {
      visitsApi
        .setVA(rowRef.current.id, va)
        .catch((err) => toast.error('Could not save V/A', errorMessage(err)));
    }, SAVE_DEBOUNCE_MS);
  };

  /* ---------- readings / photos / prescription ---------- */
  useEffect(() => {
    const r = rowRef.current;
    if (!open || !r) return;
    let alive = true;
    readingsApi
      .listForVisit(r.id)
      .then((list) => alive && setReadings((list || []).map(normalizeReading)))
      .catch(() => alive && setReadings([]));
    if (typeof readingsApi.examPhotos === 'function') {
      readingsApi
        .examPhotos(r.id)
        .then((list) => alive && setPhotos((list || []).map(normalizeExamPhoto)))
        .catch(() => alive && setPhotos([]));
    } else setPhotos([]);
    if (RX_STAGES.includes(stageKey) && typeof prescriptionsApi?.get === 'function') {
      prescriptionsApi
        .get(r.id)
        .then((rx) => alive && setRxLines(Array.isArray(rx) ? rx : rx?.lines || []))
        .catch(() => alive && setRxLines(null));
    } else setRxLines(null);
    return () => {
      alive = false;
    };
  }, [open, rowId, stageKey, refreshKey]);

  useEffect(() => {
    setRxOpen(false);
    setPaymentMode(rowRef.current?.bill?.paymentMode ?? null);
  }, [rowId]);

  const rowReadings = row?.readings;
  const rowPhotos = row?.examPhotos;
  const allReadings = useMemo(() => {
    const applied = (rowReadings || []).map(normalizeReading);
    const seen = new Set(applied.map((r) => r.machine));
    return [...applied, ...readings.filter((r) => !seen.has(r.machine) || r.processing)];
  }, [rowReadings, readings]);
  const allPhotos = useMemo(() => {
    const own = (rowPhotos || []).map(normalizeExamPhoto);
    return own.length ? own : photos;
  }, [rowPhotos, photos]);

  if (!row || !draft) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const meta = `${row.token}${draft.age ? ' · ' + ageSex({ age: draft.age, sex: draft.sex }) : ''} · ${stage?.label || row.stage}`;
  const allDone = dilationComplete(row.dilation);
  const nextStage = stages[stages.findIndex((s) => s.key === stageKey) + 1];

  return (
    <Drawer
      open={open}
      name={draft.name || row.name}
      patientId={row.patientId}
      meta={meta}
      onClose={onClose}
      foot="Everything here saves on its own — nothing to submit."
    >
      <PatientSummary row={row} draft={draft} readings={allReadings} config={config} />

      {stageKey === 'reg' && (
        <RegistrationDetails
          draft={draft}
          config={config}
          setField={setField}
          setDraft={setDraft}
          queueSave={queueSave}
        />
      )}

      {stageKey === 'pretest' && (
        <div id="readingsSection">
          <div className="field-label">Visual acuity (Snellen chart)</div>
          <p className="hint" style={hintStyle}>
            Read off the chart by the technician — there is no machine printout for this one, so it is typed
            in directly.
          </p>
          <div className="detail-grid" style={{ marginBottom: 14 }}>
            <input
              className="fake-input"
              id="vaRight"
              placeholder="V/A (R) — e.g. 6/9"
              value={draft.va.R}
              onChange={(e) => setVA('R', e.target.value)}
              style={{ marginBottom: 0 }}
            />
            <input
              className="fake-input"
              id="vaLeft"
              placeholder="V/A (L) — e.g. 6/6"
              value={draft.va.L}
              onChange={(e) => setVA('L', e.target.value)}
              style={{ marginBottom: 0 }}
            />
          </div>
          <div className="field-label">Pre-test readings</div>
          <p className="hint" style={hintStyle}>
            Machine readings are captured from the <b>Machines</b> screen, not here — tests can happen before,
            during, or after the doctor, so capturing is not tied to this stage. Anything already scanned
            shows below.
          </p>
          <ReadingsList readings={allReadings} />
        </div>
      )}

      {stageKey === 'doctor' && (
        <div id="medsSection">
          <div className="field-label">Doctor&apos;s notes</div>
          <textarea
            className="fake-input"
            id="doctorNotesField"
            rows={2}
            placeholder="Diagnosis, findings, follow-up plan…"
            value={draft.doctorNotes || ''}
            onChange={(e) => setField('doctorNotes', e.target.value)}
          />
          <div className="field-label">Exam photos</div>
          <p className="hint" style={hintStyle}>
            Adnexa, Ant. Seg., Lens, Fundus — the diagrams from the exam sheet, saved as photos rather than
            fields. Attach them from the <b>Machines</b> screen (mobile camera).
          </p>
          <ExamPhotoList photos={allPhotos} />
          <RxSection lines={rxLines ?? row.medicines} onOpen={() => setRxOpen(true)} />
        </div>
      )}

      {stageKey === 'dilate' && (
        <div id="rxSection">
          <RxSection lines={rxLines ?? row.medicines} onOpen={() => setRxOpen(true)} />
        </div>
      )}

      {stageKey === 'dilate' && row.dilation && (
        <div id="dilationSection">
          <div className="field-label">Dilation protocol</div>
          <DilationChecklist dilation={row.dilation} now={now} onGiven={onStepGiven} busy={busy} />
        </div>
      )}

      {stageKey === 'billing' && (
        <DispensePanel
          visitId={row.id}
          lines={rxLines ?? row.medicines}
          busy={busy}
          onChange={(rx) => {
            if (Array.isArray(rx?.lines)) setRxLines(rx.lines);
          }}
        />
      )}
      {stageKey === 'billing' && (
        <BillingPanel
          key={row.id}
          visitId={row.id}
          fallbackBill={row.bill}
          refreshKey={refreshKey}
          busy={busy}
          onPaymentMode={setPaymentMode}
        />
      )}

      {RX_STAGES.includes(stageKey) && rxOpen && (
        <PrescriptionModal
          visit={row}
          onClose={() => setRxOpen(false)}
          onSaved={(res) => {
            if (Array.isArray(res?.lines)) setRxLines(res.lines);
          }}
        />
      )}

      <div className="field-label">Move patient</div>
      <div className="stage-buttons" id="stageButtons">
        {stageKey === 'reg' && (
          <button className="stage-btn" onClick={() => onMove('pretest')} disabled={busy}>
            Send for pre-testing <small>vision, IOP, refraction</small>
          </button>
        )}
        {stageKey === 'pretest' && (
          <button className="stage-btn" onClick={() => onMove('doctor')} disabled={busy}>
            Send in to doctor <small>pre-test done</small>
          </button>
        )}
        {stageKey === 'doctor' && (
          <>
            <button className="stage-btn amber" onClick={onStartDilation} disabled={busy}>
              Start dilation drops <small>{config.protocolSteps.length} step protocol, set in Admin</small>
            </button>
            <button className="stage-btn" onClick={() => onMove('billing')} disabled={busy}>
              Send to billing <small>no drops needed</small>
            </button>
          </>
        )}
        {stageKey === 'dilate' &&
          (allDone ? (
            <button className="stage-btn amber" onClick={() => onMove('doctor')} disabled={busy}>
              Back to doctor <small>all drops given</small>
            </button>
          ) : (
            <button className="stage-btn" onClick={() => onMove('doctor', { confirm: true })} disabled={busy}>
              Back to doctor now <small>override — steps still pending</small>
            </button>
          ))}
        {stageKey === 'billing' && (
          <button className={`stage-btn${paymentMode ? ' amber' : ''}`} onClick={onComplete} disabled={busy}>
            Mark visit complete{' '}
            <small>{paymentMode ? `paid via ${paymentMode}` : 'no payment mode selected yet'}</small>
          </button>
        )}
        {stageKey === 'done' && (
          <p className="hint" style={{ margin: 0 }}>
            Visit complete.
          </p>
        )}
        {!KNOWN_STAGES.includes(stageKey) && nextStage && (
          <button className="stage-btn" onClick={() => onMove(nextStage.key)} disabled={busy}>
            → {nextStage.label}
          </button>
        )}
      </div>
    </Drawer>
  );
}

/* F14: "Prescription" opens the PrescriptionModal; saved lines listed underneath. */
function RxSection({ lines, onOpen }) {
  const list = lines || [];
  return (
    <>
      <div className="field-label">Prescription</div>
      <button type="button" className="rx-drawer-btn" onClick={onOpen} id="openRxBtn">
        {list.length ? 'Open prescription' : 'Write prescription'}
        <small>
          {list.length
            ? `${list.length} medicine${list.length === 1 ? '' : 's'} · edit or print`
            : 'write, save and print'}
        </small>
      </button>
      {list.length === 0 ? (
        <p className="hint" style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '0 0 8px' }}>
          Nothing prescribed yet
        </p>
      ) : (
        <div className="med-rows" id="medChips">
          {list.map((m, i) => (
            <div key={m.id ?? i} className={`med-row${m.matched === false ? ' manual' : ''}`}>
              <div className="med-main">
                <div className="med-name">
                  {m.name}
                </div>
                {m.dosage && (
                  <div className="hint" style={{ margin: '3px 0 0', fontSize: 11.5 }}>
                    {m.dosage}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* mockup renderPatientSummary */
function PatientSummary({ row, draft, readings, config }) {
  const stage = row.stage;
  const cards = [];
  const p = { ...row, ...draft };

  if (stage !== 'reg') {
    const bits = [];
    if (p.elsewhere)
      bits.push(
        <div className="summary-line" key="els">
          <b>Treated elsewhere:</b> {p.elsewhereNote || 'yes, no details noted'}
        </div>
      );
    if (referralNeedsDetail(config.referralSources, p.referralSource) && p.referralDetail)
      bits.push(
        <div className="summary-line" key="ref">
          <b>Referred by:</b> {p.referralDetail}
        </div>
      );
    if (p.occupation)
      bits.push(
        <div className="summary-line" key="occ">
          <b>Occupation:</b> {p.occupation}
        </div>
      );
    if (p.screenHours)
      bits.push(
        <div className="summary-line" key="scr">
          <b>Screen time:</b> {p.screenHours} hrs/day
        </div>
      );
    if (p.existingConditions.length || p.conditionOther)
      bits.push(
        <div className="summary-line" key="cond">
          <b>Existing conditions:</b>{' '}
          {[...p.existingConditions, ...(p.conditionOther ? [p.conditionOther] : [])].join(', ')}
        </div>
      );
    if (p.lastVisitDate)
      bits.push(
        <div className="summary-line" key="lv">
          <b>Last visit:</b> {fmtLastVisit(String(p.lastVisitDate).slice(0, 10))}
        </div>
      );
    if (bits.length)
      cards.push(
        <div className="summary-card" key="bg">
          <div className="summary-card-title">Background</div>
          {bits}
        </div>
      );
  }

  const va = draft.va || row.va;
  if (stage !== 'pretest' && stage !== 'reg' && (readings.length || va.R || va.L)) {
    cards.push(
      <div className="summary-card" key="pre">
        <div className="summary-card-title">Pre-test readings</div>
        {(va.R || va.L) && (
          <div className="summary-line">
            <b>V/A:</b> R {va.R || '—'}, L {va.L || '—'}
          </div>
        )}
        {readings.map((r, i) => (
          <div className="summary-line" key={i}>
            <b>{r.machine}:</b>{' '}
            {r.processing ? 'processing…' : r.vals.map((v) => v.l + ' ' + v.v).join(', ')}
          </div>
        ))}
      </div>
    );
  }

  const afterDoctor = stage !== 'doctor' && stage !== 'reg' && stage !== 'pretest';
  if (afterDoctor && p.doctorNotes)
    cards.push(
      <div className="summary-card" key="dn">
        <div className="summary-card-title">Doctor&apos;s notes</div>
        <div className="summary-line">{p.doctorNotes}</div>
      </div>
    );
  if (afterDoctor && row.medicines.length)
    cards.push(
      <div className="summary-card" key="rx">
        <div className="summary-card-title">Prescribed</div>
        {row.medicines.map((m, i) => (
          <div className="summary-line" key={i}>
            {m.name}
            {m.dosage ? ' — ' + m.dosage : ''}
          </div>
        ))}
      </div>
    );

  if (!cards.length) return null;
  return (
    <div id="patientSummarySection">
      <div className="field-label" style={{ marginTop: 0 }}>
        Patient summary
      </div>
      {cards}
    </div>
  );
}

/* mockup renderReadings (read-only here — corrections happen on the Machines screen) */
function ReadingsList({ readings }) {
  if (!readings.length)
    return (
      <p className="hint" style={{ fontSize: 12, color: 'var(--ink-faint)' }} id="readingsList">
        None captured yet
      </p>
    );
  return (
    <div id="readingsList">
      {readings.map((r, i) => (
        <div className="reading-card" key={r.id ?? i}>
          <div className="reading-head">
            <span className="m">{r.machine}</span>
            <span className="src">{r.processing ? '' : r.src}</span>
          </div>
          {r.processing ? (
            <p className="processing-note">
              Photo uploaded — extracting values on the server, usually a few seconds…
            </p>
          ) : (
            <div className="reading-vals">
              {r.vals.map((v, j) => (
                <div className="reading-val" key={j}>
                  <label>{v.l}</label>
                  <input value={v.v} readOnly />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* mockup renderExamPhotos */
function ExamPhotoList({ photos }) {
  if (!photos.length)
    return (
      <p
        className="hint"
        style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '0 0 8px' }}
        id="examPhotoList"
      >
        None attached yet
      </p>
    );
  return (
    <div id="examPhotoList">
      {photos.map((ph, i) => (
        <div className="med-row manual" key={ph.id ?? i}>
          <div className="med-main">
            <div className="med-name">
              {ph.url ? (
                <a href={ph.url} target="_blank" rel="noreferrer">
                  Exam photo — {ph.capturedAt}
                </a>
              ) : (
                <>Exam photo — {ph.capturedAt}</>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
