import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
import VisitKindPanel from './VisitKindPanel';
import RegistrationDetails from './RegistrationDetails';
import DispensePanel from './DispensePanel';
import {
  DiagnosisPicker,
  ExamSection,
  FollowUpPicker,
  GlassesSection,
  fmtFollowUp,
  useExamGlasses,
} from './DoctorPanel';
import { modesText, rupees } from '../Billing/money';
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
  'dob', // 'YYYY-MM-DD' or null; when set, the server works the age out from it
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

// The doctor's-panel fields of a visit (VisitOut or the normalised row).
const pickDoc = (v) => ({
  diagnosisId: v?.diagnosisId ?? null,
  diagnosisName: v?.diagnosisName ?? null,
  followUpDate: v?.followUpDate ?? null,
  followUpNote: v?.followUpNote ?? '',
});


/* Patient drawer (mockup `openDrawer`): summary + the stage-specific section; the buttons that
   move the patient on sit in the drawer's footer, always in view. Everything autosaves (debounced
   PATCH); pending saves go out before the drawer closes or the patient moves. `row` is the
   normalised visit (see queueModel.js); `now` is the 1 s ticker; `refreshKey`
   bumps after every board reload so readings/bill refetch. The visit type & fee panel
   (registration, doctor: "Different problem", billing) calls `onVisitChange` so the board reloads. */
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
  onVisitChange,
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
  const [billState, setBillState] = useState(null); // reported by BillingPanel: {total, balance, paid, payments…}
  const [rxLines, setRxLines] = useState(null); // null = not loaded → fall back to row.medicines
  const [rxOpen, setRxOpen] = useState(false);
  // Diagnosis + follow-up as last saved from this drawer (or the modal); the row otherwise.
  const [docState, setDocState] = useState({ id: null, d: null });
  const doc = docState.id === row?.id ? docState.d : pickDoc(row);
  const applyVisit = useCallback((v) => {
    if (v && v.id != null) setDocState({ id: v.id, d: pickDoc(v) });
  }, []);
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
    const out =
      k === 'age' ? numOrNull(v, { int: true }) : k === 'screenHours' ? numOrNull(v) : k === 'dob' ? v || null : v;
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
    setBillState(null);
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
  // What the prescription pop-up / print sees: the row with this drawer's latest diagnosis + follow-up.
  const rxVisit = useMemo(() => (row ? { ...row, ...doc } : null), [row, doc]);

  if (!row || !draft) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const meta = `${row.token}${draft.age ? ' · ' + ageSex({ age: draft.age, sex: draft.sex }) : ''} · ${stage?.label || row.stage}`;
  const allDone = dilationComplete(row.dilation);
  const nextStage = stages[stages.findIndex((s) => s.key === stageKey) + 1];
  // Whatever is still waiting to be saved goes first, then the patient moves.
  const leave = (fn) => () => {
    clearTimeout(timer.current);
    flush();
    fn();
  };

  return (
    <Drawer
      open={open}
      name={draft.name || row.name}
      patientId={row.patientId}
      meta={meta}
      onClose={leave(onClose)}
      wide={stageKey === 'doctor'}
      footActions
      foot={
        <DrawerActions
          stageKey={stageKey}
          known={KNOWN_STAGES.includes(stageKey)}
          nextStage={nextStage}
          allDone={allDone}
          protocolSteps={config.protocolSteps.length}
          billState={billState}
          busy={busy}
          onMove={(key, opts) => leave(() => onMove(key, opts))()}
          onStartDilation={leave(onStartDilation)}
          onComplete={leave(onComplete)}
        />
      }
    >
      <PatientSummary row={row} draft={draft} readings={allReadings} config={config} doc={doc} />

      {(stageKey === 'reg' || stageKey === 'billing') && (
        <VisitKindPanel row={row} busy={busy} onChanged={onVisitChange} />
      )}

      {stageKey === 'reg' && (
        <RegistrationDetails
          draft={draft}
          config={config}
          setField={setField}
          setDraft={setDraft}
          queueSave={queueSave}
          patientId={row.patientId}
        />
      )}

      {stageKey === 'pretest' && (
        <div id="readingsSection">
          <div className="field-label">Visual acuity (chart)</div>
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
          <div className="drawer-sec-head">
            <div className="field-label">Machine readings</div>
            <Link to={`/machines?visit=${row.id}`} className="drawer-sec-link" data-testid="capture-reading-link">
              Capture machine reading
            </Link>
          </div>
          <ReadingsList readings={allReadings} />
        </div>
      )}

      {stageKey === 'doctor' && (
        <DoctorStage
          key={row.id}
          row={row}
          draft={draft}
          doc={doc}
          readings={allReadings}
          photos={allPhotos}
          rxLines={rxLines ?? row.medicines}
          busy={busy}
          setField={setField}
          applyVisit={applyVisit}
          setRxLines={setRxLines}
          openRx={() => setRxOpen(true)}
          onVisitChange={onVisitChange}
        />
      )}

      {stageKey === 'dilate' && row.dilation && (
        <div id="dilationSection" className="dilation-first">
          <div className="field-label">Dilation drops</div>
          <DilationChecklist dilation={row.dilation} now={now} onGiven={onStepGiven} busy={busy} />
        </div>
      )}

      {stageKey === 'dilate' && (
        <div id="rxSection">
          <RxSection lines={rxLines ?? row.medicines} onOpen={() => setRxOpen(true)} secondary />
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
          onBillState={setBillState}
        />
      )}

      {RX_STAGES.includes(stageKey) && rxOpen && (
        <PrescriptionModal
          visit={rxVisit}
          onClose={() => setRxOpen(false)}
          onSaved={(res) => {
            if (Array.isArray(res?.lines)) setRxLines(res.lines);
          }}
          onVisitChange={applyVisit}
        />
      )}
    </Drawer>
  );
}

/* The doctor's stage, in the order the doctor works: machine readings → examination → diagnosis →
   prescription → glasses → follow-up. On a wide screen (>= 1280 px) two columns — left: readings,
   examination, glasses; right: diagnosis, prescription, follow-up (see queue.css `.doc-grid`). */
function DoctorStage({
  row,
  draft,
  doc,
  readings,
  photos,
  rxLines,
  busy,
  setField,
  applyVisit,
  setRxLines,
  openRx,
  onVisitChange,
}) {
  const eg = useExamGlasses(row.id, busy);
  const va = draft.va || row.va || {};
  return (
    <div id="medsSection" className="doc-grid">
      <div className="doc-col">
        <section className="doc-o1" id="doctorReadings" data-testid="doctor-readings">
          <div className="drawer-sec-head">
            <div className="field-label" style={{ marginTop: 0 }}>
              Readings
            </div>
            <Link to={`/machines?visit=${row.id}`} className="drawer-sec-link" data-testid="doctor-readings-link">
              {readings.length ? 'Machines' : 'Capture reading'}
            </Link>
          </div>
          <ReadingsSummary va={va} readings={readings} />
        </section>
        <section className="doc-o2">
          <ExamSection eg={eg} />
          {photos.length > 0 && (
            <>
              <div className="field-label">Exam photos</div>
              <ExamPhotoList photos={photos} />
            </>
          )}
          <Link to={`/machines?visit=${row.id}`} className="drawer-sec-link" data-testid="add-exam-photo">
            Add exam photo
          </Link>
        </section>
        <section className="doc-o5">
          <GlassesSection eg={eg} />
        </section>
      </div>
      <div className="doc-col">
        <section className="doc-o3">
          <DiagnosisPicker
            visitId={row.id}
            diagnosisId={doc.diagnosisId}
            lines={rxLines}
            onVisit={applyVisit}
            onRx={(res) => {
              if (Array.isArray(res?.lines)) setRxLines(res.lines);
            }}
            disabled={busy}
          />
          <div className="field-label">Doctor&apos;s notes</div>
          <textarea
            className="fake-input"
            id="doctorNotesField"
            rows={2}
            placeholder="Findings, advice…"
            value={draft.doctorNotes || ''}
            onChange={(e) => setField('doctorNotes', e.target.value)}
          />
        </section>
        <section className="doc-o4">
          <RxSection lines={rxLines} onOpen={openRx} />
        </section>
        <section className="doc-o6">
          <FollowUpPicker
            visitId={row.id}
            followUpDate={doc.followUpDate}
            followUpNote={doc.followUpNote}
            onVisit={applyVisit}
            disabled={busy}
          />
          <VisitKindPanel row={row} mode="link" busy={busy} onChanged={onVisitChange} />
        </section>
      </div>
    </div>
  );
}

/** The chart V/A and each machine reading, one line each (the doctor reads, the Machines screen corrects). */
function ReadingsSummary({ va, readings }) {
  if (!readings.length && !va.R && !va.L) return null;
  return (
    <div className="summary-card readings-summary">
      {(va.R || va.L) && (
        <div className="summary-line">
          <b>V/A:</b> <span className="mono">R {va.R || '—'} · L {va.L || '—'}</span>
        </div>
      )}
      {readings.map((r, i) => (
        <div className="summary-line" key={r.id ?? i}>
          <b>{r.machine}:</b>{' '}
          {r.processing ? 'processing…' : <span className="mono">{r.vals.map((v) => v.l + ' ' + v.v).join(' · ')}</span>}
        </div>
      ))}
    </div>
  );
}

/* The drawer's footer: the buttons that move the patient on (and, at billing, the money summary),
   always in view however long the drawer is. At billing, completing a visit that still owes money
   asks first, right here: "₹750 not received — complete anyway and keep it as owed?". */
function DrawerActions({
  stageKey,
  known,
  nextStage,
  allDone,
  protocolSteps,
  billState,
  busy,
  onMove,
  onStartDilation,
  onComplete,
}) {
  const [asking, setAsking] = useState(false);
  useEffect(() => setAsking(false), [stageKey, billState?.balance]);

  if (stageKey === 'billing') {
    const b = billState;
    const owed = b ? Math.max(0, b.balance) : 0;
    const complete = () => (owed > 0 ? setAsking(true) : onComplete());
    if (asking)
      return (
        <div className="foot-row foot-confirm" role="alertdialog" aria-label="Money still owed" data-testid="complete-confirm">
          <span className="foot-question">
            <b className="mono">{rupees(owed)}</b> not received — complete anyway and keep it as owed?
          </span>
          <div className="foot-btns">
            <button type="button" className="btn-ghost sm" onClick={() => setAsking(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-primary sm alert" onClick={onComplete} disabled={busy}>
              Complete, keep as owed
            </button>
          </div>
        </div>
      );
    const summary = !b
      ? ''
      : owed > 0
        ? null
        : b.noCharge
          ? 'No charge'
          : b.paid
            ? `Paid · ${modesText(b.payments, b.paymentMode)}`
            : b.total === 0
              ? 'Nothing to pay'
              : '';
    return (
      <div className="foot-row" data-testid="billing-actions">
        <span className="foot-summary" data-testid="foot-summary">
          {owed > 0 ? (
            <>
              Balance <b className="mono">{rupees(owed)}</b>
            </>
          ) : (
            summary
          )}
        </span>
        <div className="foot-btns">
          {owed > 0 && (
            <button type="button" className="btn-primary sm" onClick={focusReceive} disabled={busy}>
              Receive payment
            </button>
          )}
          <button
            type="button"
            className={owed > 0 ? 'btn-ghost sm' : 'btn-primary sm'}
            onClick={complete}
            disabled={busy || !b}
          >
            Complete visit
          </button>
        </div>
      </div>
    );
  }

  let buttons = null;
  if (stageKey === 'reg')
    buttons = (
      <button type="button" className="btn-primary sm" onClick={() => onMove('pretest')} disabled={busy}>
        Send for pre-testing
      </button>
    );
  else if (stageKey === 'pretest')
    buttons = (
      <button type="button" className="btn-primary sm" onClick={() => onMove('doctor')} disabled={busy}>
        Send in to doctor
      </button>
    );
  else if (stageKey === 'doctor')
    buttons = (
      <>
        <button
          type="button"
          className="btn-ghost sm"
          onClick={onStartDilation}
          disabled={busy}
          title={`${protocolSteps} step protocol, set in Admin`}
        >
          Start dilation drops
        </button>
        <button type="button" className="btn-primary sm" onClick={() => onMove('billing')} disabled={busy}>
          Send to billing
        </button>
      </>
    );
  else if (stageKey === 'dilate')
    buttons = allDone ? (
      <button type="button" className="btn-primary sm" onClick={() => onMove('doctor')} disabled={busy}>
        Back to doctor
      </button>
    ) : (
      <button type="button" className="btn-ghost sm" onClick={() => onMove('doctor', { confirm: true })} disabled={busy}>
        Back to doctor now
      </button>
    );
  else if (stageKey === 'done')
    return (
      <div className="foot-row">
        <span className="foot-summary">Visit complete</span>
      </div>
    );
  else if (!known && nextStage)
    buttons = (
      <button type="button" className="btn-primary sm" onClick={() => onMove(nextStage.key)} disabled={busy}>
        → {nextStage.label}
      </button>
    );

  return (
    <div className="foot-row" id="stageButtons">
      <div className="foot-btns">{buttons}</div>
    </div>
  );
}

/** Footer "Receive payment": bring the bill's receive box into view, amount ready to type. */
function focusReceive() {
  const box = document.querySelector('#billingSection [data-testid="receive-payment"]');
  if (!box) return;
  box.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  box.querySelector('input')?.focus({ preventScroll: true });
}

/* F14: "Prescription" opens the PrescriptionModal; saved lines listed underneath. */
function RxSection({ lines, onOpen, secondary = false }) {
  const list = lines || [];
  return (
    <>
      <div className="field-label">Prescription</div>
      <button type="button" className={`rx-drawer-btn${secondary ? ' secondary' : ''}`} onClick={onOpen} id="openRxBtn">
        {list.length ? 'Open prescription' : 'Write prescription'}
        {list.length > 0 && <small>{`${list.length} medicine${list.length === 1 ? '' : 's'}`}</small>}
      </button>
      {list.length > 0 && (
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

/* mockup renderPatientSummary. After registration the registration details fold into a
   "Patient details" section (closed until clicked); what the current stage needs stays open:
   the doctor's plan from the doctor on, what was prescribed once the visit is done. The doctor's
   stage shows the readings in its own layout, the dilation and billing stages list the medicines
   in their own panels. */
function PatientSummary({ row, draft, readings, config, doc }) {
  const stage = row.stage;
  const p = { ...row, ...draft };
  const folded = [];
  const open = [];

  if (stage !== 'reg') {
    const bits = [];
    if (p.phone)
      bits.push(
        <div className="summary-line" key="ph">
          <b>Phone:</b> <span className="mono">{p.phone}</span>
        </div>
      );
    if (p.address)
      bits.push(
        <div className="summary-line" key="addr">
          <b>Address:</b> {p.address}
        </div>
      );
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
    if (p.note)
      bits.push(
        <div className="summary-line" key="note">
          <b>Note:</b> {p.note}
        </div>
      );
    if (bits.length)
      folded.push(
        <div className="summary-card" key="bg">
          <div className="summary-card-title">Background</div>
          {bits}
        </div>
      );
  }

  const va = draft.va || row.va;
  const pastDoctor = !['reg', 'pretest', 'doctor'].includes(stage);
  if (pastDoctor && (readings.length || va.R || va.L)) {
    folded.push(
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

  if (pastDoctor && p.doctorNotes)
    folded.push(
      <div className="summary-card" key="dn">
        <div className="summary-card-title">Doctor&apos;s notes</div>
        <div className="summary-line">{p.doctorNotes}</div>
      </div>
    );
  if (stage === 'done' && row.medicines.length)
    open.push(
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

  // The doctor's plan: diagnosis once past the doctor, the booked follow-up from the doctor on.
  const showDx = pastDoctor && doc?.diagnosisName;
  const showFu = pastDoctor && doc?.followUpDate;
  if (showDx || showFu)
    open.push(
      <div className="summary-card" key="plan" id="doctorPlanCard">
        <div className="summary-card-title">Doctor&apos;s plan</div>
        {showDx && (
          <div className="summary-line">
            <b>Diagnosis:</b> {doc.diagnosisName}
          </div>
        )}
        {showFu && (
          <div className="summary-line" data-testid="summary-follow-up">
            <b>Follow-up:</b> <span className="mono">{fmtFollowUp(doc.followUpDate)}</span>
            {doc.followUpNote ? ` · ${doc.followUpNote}` : ''}
          </div>
        )}
      </div>
    );

  if (!folded.length && !open.length) return null;
  return (
    <div id="patientSummarySection">
      {folded.length > 0 && (
        <details className="patient-details" data-testid="patient-details">
          <summary>
            <span className="field-label">Patient details</span>
          </summary>
          {folded}
        </details>
      )}
      {open}
    </div>
  );
}

/* mockup renderReadings (read-only here — corrections happen on the Machines screen) */
function ReadingsList({ readings }) {
  if (!readings.length) return null;
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
  if (!photos.length) return null;
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
