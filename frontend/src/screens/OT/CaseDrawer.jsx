import { useCallback, useEffect, useRef, useState } from 'react';
import Drawer from '../../components/Drawer';
import { useAuth } from '../../auth/AuthContext';
import { ot as otApi, errorMessage } from '../../api';
import { PhotoTile } from '../Machines/ExamPhotos';
import { IconCamera, IconPaperclip } from '../../components/Icons';
import { useCasePatch } from './useCasePatch';
import {
  ANESTHESIA,
  BIOMETRY_ROWS,
  DEFAULT_SURGEON,
  OT_STATUS,
  PAYMENT_MODES,
  TECHNIQUES,
  caseSlot,
  emptyBiometry,
} from './constants';

const TABS = [
  { key: 'preop', label: 'Pre-op' },
  { key: 'operative', label: 'Operative' },
  { key: 'consent', label: 'Consent' },
  { key: 'postop', label: 'Post-op' },
  { key: 'billing', label: 'Billing' },
];

const CLINICAL_ROLES = ['admin', 'doctor', 'ot_staff'];

function filled(obj) {
  if (!obj || typeof obj !== 'object') return !!obj;
  return Object.values(obj).some((v) => (v && typeof v === 'object' ? filled(v) : v !== '' && v != null && v !== false));
}

/* ---------------------------------------------------------------- tabs */
/* Pre-op tab. "Scan biometry report" photographs the HBM-1 IOL / biometry
   printout; the server reads it and fills the grid with every plausible value
   (the person checks and corrects the rest). */
function PreOpTab({ k, edit, setCase, flush, isMobile }) {
  const b = { ...emptyBiometry(), ...(k.preOpBiometry || {}) };
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // {ok:[], bad:[], confidence}
  const [err, setErr] = useState('');

  useEffect(() => {
    setNote(null);
    setErr('');
  }, [k.id]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr('');
    setNote(null);
    try {
      await flush?.(); // typed edits first, so the scan merges on top of them
      const res = await otApi.scanBiometry(k.id, file);
      if (res?.case) setCase((prev) => (prev && prev.id === res.case.id ? { ...prev, ...res.case } : prev));
      const vals = res?.values || [];
      setNote({
        ok: vals.filter((v) => v.ok !== false),
        bad: vals.filter((v) => v.ok === false),
        confidence: res?.confidence,
      });
    } catch (ex) {
      setErr(errorMessage(ex, 'Could not read the report'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="field-label" style={{ marginTop: 0 }}>
        Pre-op biometry (HBM-1)
      </div>
      <p className="small-note">Axial length, anterior chamber depth, keratometry and the target refraction per eye.</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(isMobile ? { capture: 'environment' } : {})}
        onChange={onFile}
        style={{ display: 'none' }}
        data-testid="biometry-input"
        aria-label="Biometry report photo"
      />
      <button
        type="button"
        className="capture-btn"
        style={{ marginBottom: 10 }}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        data-testid="scan-biometry"
      >
        {isMobile ? <IconCamera /> : <IconPaperclip />}
        {busy ? 'Reading the report…' : isMobile ? 'Scan biometry report' : 'Scan biometry report (file)'}
      </button>
      {busy && (
        <div className="capture-flash" data-testid="biometry-busy">
          <div className="spin" />
          <p>Reading the HBM-1 printout — a few seconds.</p>
        </div>
      )}
      {err && <p className="ot-save-note err">{err}</p>}
      {note && (
        <p className="ot-save-note" data-testid="biometry-note" style={{ color: 'var(--ink-soft)' }}>
          Filled {note.ok.length} value{note.ok.length === 1 ? '' : 's'} from the report
          {note.confidence != null ? ` (OCR ${Math.round(note.confidence * 100)}%)` : ''}.
          {note.bad.length > 0 && (
            <>
              {' '}
              Could not read: {note.bad.map((v) => v.l).join(', ')} — type {note.bad.length === 1 ? 'it' : 'them'} in.
            </>
          )}{' '}
          Check every number against the printout.
        </p>
      )}
      <div className="bio-grid" data-testid="biometry-grid">
        <div />
        <div className="bh">R</div>
        <div className="bh">L</div>
        {BIOMETRY_ROWS.map((row) => (
          <RowFragment key={row.key} row={row} b={b} edit={edit} />
        ))}
      </div>
    </>
  );
}

function RowFragment({ row, b, edit }) {
  return (
    <>
      <div className="bl">{row.label}</div>
      {['R', 'L'].map((side) => (
        <input
          key={side}
          className="fake-input"
          placeholder={row.ph}
          value={b[row.key]?.[side] ?? ''}
          onChange={(e) => edit(['preOpBiometry', row.key, side], e.target.value)}
          aria-label={`${row.label} ${side}`}
        />
      ))}
    </>
  );
}

function OperativeTab({ k, edit, canEdit }) {
  const o = k.operative || {};
  const ro = !canEdit;
  return (
    <>
      <div className="field-label" style={{ marginTop: 0 }}>
        Operative details
      </div>
      {ro && <p className="ot-save-note">Operative notes can be edited by the doctor / OT staff.</p>}
      <input
        className="fake-input"
        placeholder="IOL brand / model"
        value={o.iolBrand ?? ''}
        onChange={(e) => edit(['operative', 'iolBrand'], e.target.value)}
        readOnly={ro}
        aria-label="IOL brand"
      />
      <input
        className="fake-input"
        placeholder="IOL power implanted (e.g. 22.5D)"
        value={o.iolPower ?? ''}
        onChange={(e) => edit(['operative', 'iolPower'], e.target.value)}
        readOnly={ro}
        aria-label="IOL power"
      />
      <select
        className="drop-select"
        value={o.technique ?? ''}
        onChange={(e) => edit(['operative', 'technique'], e.target.value)}
        disabled={ro}
        aria-label="Technique"
      >
        <option value="">Technique…</option>
        {TECHNIQUES.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <select
        className="drop-select"
        value={o.anesthesia ?? ''}
        onChange={(e) => edit(['operative', 'anesthesia'], e.target.value)}
        disabled={ro}
        aria-label="Anesthesia"
      >
        <option value="">Anesthesia…</option>
        {ANESTHESIA.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <input
        className="fake-input"
        placeholder="Surgeon"
        value={o.surgeon ?? DEFAULT_SURGEON}
        onChange={(e) => edit(['operative', 'surgeon'], e.target.value)}
        readOnly={ro}
        aria-label="Surgeon"
      />
      <textarea
        className="fake-input"
        rows={2}
        placeholder="Complications (if any)"
        value={o.complications ?? ''}
        onChange={(e) => edit(['operative', 'complications'], e.target.value)}
        readOnly={ro}
        aria-label="Complications"
      />
      <textarea
        className="fake-input"
        rows={3}
        placeholder="Operative notes"
        value={o.notes ?? ''}
        onChange={(e) => edit(['operative', 'notes'], e.target.value)}
        readOnly={ro}
        aria-label="Operative notes"
      />
    </>
  );
}

function ConsentTab({ k, setCase, isMobile }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  const photos = k.consentPhotos || [];

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const updated = await otApi.addConsentPhoto(k.id, { file });
      if (updated?.consentPhotos) setCase((prev) => ({ ...prev, consentPhotos: updated.consentPhotos }));
    } catch (ex) {
      setErr(errorMessage(ex, 'Could not save the consent photo'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (ph) => {
    try {
      await otApi.removeConsentPhoto(k.id, ph.id);
      setCase((prev) => ({ ...prev, consentPhotos: (prev.consentPhotos || []).filter((x) => x.id !== ph.id) }));
    } catch (ex) {
      setErr(errorMessage(ex, 'Could not remove the photo'));
    }
  };

  return (
    <>
      <div className="field-label" style={{ marginTop: 0 }}>
        Surgical consent
      </div>
      <div id="otConsentList">
        {photos.length === 0 ? (
          <p className="machine-list-empty" style={{ margin: '0 0 8px' }}>
            None attached yet
          </p>
        ) : (
          <div className="photo-grid">
            {photos.map((ph) => (
              <PhotoTile key={ph.id} photo={ph} label="Signed consent" onRemove={remove} />
            ))}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(isMobile ? { capture: 'environment' } : {})}
        onChange={onFile}
        style={{ display: 'none' }}
        data-testid="consent-input"
      />
      <button type="button" className="capture-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? 'Saving photo…' : isMobile ? 'Attach signed consent' : 'Attach signed consent (file)'}
      </button>
      {!isMobile && (
        <p className="ot-save-note" style={{ marginTop: 8 }}>
          On the phone this opens the camera; here you can pick a scanned file.
        </p>
      )}
      {err && <p className="reading-note err">{err}</p>}
    </>
  );
}

function PostOpTab({ k, edit, canEdit }) {
  const p = k.postOp || {};
  const rx = p.finalRx || {};
  const ro = !canEdit;
  const rxInput = (side, field, ph) => (
    <input
      key={side + field}
      className="fake-input"
      placeholder={ph}
      value={rx[side]?.[field] ?? ''}
      onChange={(e) => edit(['postOp', 'finalRx', side, field], e.target.value)}
      readOnly={ro}
      aria-label={`${side} ${ph}`}
    />
  );
  return (
    <>
      <div className="field-label" style={{ marginTop: 0 }}>
        Post-op
      </div>
      {ro && <p className="ot-save-note">Post-op notes can be edited by the doctor / OT staff.</p>}
      <textarea
        className="fake-input"
        rows={2}
        placeholder="Wound check / follow-up notes"
        value={p.followUpNotes ?? ''}
        onChange={(e) => edit(['postOp', 'followUpNotes'], e.target.value)}
        readOnly={ro}
        aria-label="Follow-up notes"
      />
      <div className="detail-grid">
        <input
          className="fake-input"
          placeholder="Follow-up V/A (R)"
          value={p.followUpVA?.R ?? ''}
          onChange={(e) => edit(['postOp', 'followUpVA', 'R'], e.target.value)}
          readOnly={ro}
          aria-label="Follow-up VA R"
        />
        <input
          className="fake-input"
          placeholder="Follow-up V/A (L)"
          value={p.followUpVA?.L ?? ''}
          onChange={(e) => edit(['postOp', 'followUpVA', 'L'], e.target.value)}
          readOnly={ro}
          aria-label="Follow-up VA L"
        />
      </div>
      <input
        className="fake-input"
        placeholder="Next follow-up — e.g. in 1 week"
        value={p.nextFollowUp ?? ''}
        onChange={(e) => edit(['postOp', 'nextFollowUp'], e.target.value)}
        readOnly={ro}
        aria-label="Next follow-up"
      />

      <div className="field-label">Final prescription (post-op)</div>
      <p className="label" style={{ margin: '0 0 6px' }}>
        R eye
      </p>
      <div className="rx-grid">
        {rxInput('R', 'sph', 'SPH')}
        {rxInput('R', 'cyl', 'CYL')}
        {rxInput('R', 'axis', 'Axis')}
        {rxInput('R', 'va', 'V/A')}
      </div>
      <p className="label" style={{ margin: '8px 0 6px' }}>
        L eye
      </p>
      <div className="rx-grid">
        {rxInput('L', 'sph', 'SPH')}
        {rxInput('L', 'cyl', 'CYL')}
        {rxInput('L', 'axis', 'Axis')}
        {rxInput('L', 'va', 'V/A')}
      </div>
    </>
  );
}

function BillingTab({ k, editNow, lensTiers }) {
  const b = k.billing || {};
  const tier = lensTiers.find((t) => t.key === b.lensTier);
  const total = b.total ?? (tier ? tier.price : 0);
  return (
    <>
      <div className="field-label" style={{ marginTop: 0 }}>
        Surgical billing
      </div>
      <p className="small-note">Package prices shown are placeholders — confirm real pricing before this goes live.</p>
      <div className="ot-tier-list" role="radiogroup" aria-label="Lens tier">
        {lensTiers.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={b.lensTier === t.key}
            className={`stage-btn${b.lensTier === t.key ? ' amber' : ''}`}
            onClick={() => editNow(['billing', 'lensTier'], t.key)}
          >
            {t.label} <small>₹{Number(t.price).toLocaleString('en-IN')}</small>
          </button>
        ))}
        {lensTiers.length === 0 && <p className="ot-save-note">No lens tiers configured — add them in Admin.</p>}
      </div>
      <div className="toggle-row">
        <span>Mediclaim / insurance case</span>
        <button
          type="button"
          className={`switch${b.mediclaim ? ' on' : ''}`}
          role="switch"
          aria-checked={!!b.mediclaim}
          aria-label="Mediclaim"
          onClick={() => editNow(['billing', 'mediclaim'], !b.mediclaim)}
        >
          <div className="knob" />
        </button>
      </div>
      <div className="bill-total" style={{ marginTop: 10 }}>
        <span>Total</span>
        <span data-testid="ot-total">₹{Number(total || 0).toLocaleString('en-IN')}</span>
      </div>
      <p className="label" style={{ margin: '10px 0 6px' }}>
        Payment mode
      </p>
      <div className="channel-toggle" role="radiogroup" aria-label="Payment mode">
        {PAYMENT_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={b.paymentMode === m.key}
            className={`channel-opt walkin${b.paymentMode === m.key ? ' active' : ''}`}
            onClick={() => editNow(['billing', 'paymentMode'], m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- drawer */
export default function CaseDrawer({ caseObj, setCase, lensTiers, isMobile, onClose, onStatus }) {
  const { currentUser } = useAuth();
  const canEditClinical = CLINICAL_ROLES.includes(currentUser?.role);
  const [tab, setTab] = useState('preop');
  const [saveErr, setSaveErr] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const onError = useCallback((msg) => setSaveErr(msg), []);
  const { edit, editNow, flush } = useCasePatch(caseObj, setCase, { onError });

  useEffect(() => {
    setTab('preop');
    setSaveErr('');
  }, [caseObj?.id]);

  const k = caseObj;
  const open = !!k;
  const st = OT_STATUS[k?.status] || { label: k?.status, cls: '' };

  const setStatus = async (status) => {
    if (!k) return;
    if (status === 'cancelled' && !window.confirm('Cancel this surgery? The slot will be freed.')) return;
    setStatusBusy(true);
    setSaveErr('');
    try {
      await flush();
      const updated = await otApi.setStatus(k.id, status);
      setCase(updated);
      onStatus?.(updated);
    } catch (ex) {
      setSaveErr(errorMessage(ex, 'Could not change status'));
    } finally {
      setStatusBusy(false);
    }
  };

  const doneMarks = k
    ? {
        preop: filled(k.preOpBiometry),
        operative: filled({ ...(k.operative || {}), surgeon: '' }),
        consent: (k.consentPhotos || []).length > 0,
        postop: filled(k.postOp),
        billing: !!k.billing?.lensTier,
      }
    : {};

  return (
    <Drawer
      open={open}
      id="otCaseDrawer"
      name={k?.patientName}
      patientId={k?.patientId}
      meta={k ? `${k.procedure} · ${k.date} · ${caseSlot(k)}${k.age ? ` · ${k.age}${k.sex ? k.sex[0] : ''}` : ''}` : ''}
      onClose={() => onClose?.(flush())}
      foot="Everything here saves on its own — nothing to submit."
    >
      {k && (
        <div className="ot-drawer">
          <div className="ot-status-row">
            <span className={`status-pill ${st.cls}`} data-testid="ot-case-status">
              {st.label}
            </span>
            {saveErr ? (
              <span className="ot-save-note err">{saveErr}</span>
            ) : (
              <span className="ot-save-note">Auto-saves as you type</span>
            )}
          </div>

          <div className="ot-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`ot-tab${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {doneMarks[t.key] && <span className="dot" aria-hidden="true" />}
              </button>
            ))}
          </div>

          {tab === 'preop' && <PreOpTab k={k} edit={edit} setCase={setCase} flush={flush} isMobile={isMobile} />}
          {tab === 'operative' && <OperativeTab k={k} edit={edit} canEdit={canEditClinical} />}
          {tab === 'consent' && <ConsentTab k={k} setCase={setCase} isMobile={isMobile} />}
          {tab === 'postop' && <PostOpTab k={k} edit={edit} canEdit={canEditClinical} />}
          {tab === 'billing' && <BillingTab k={k} editNow={editNow} lensTiers={lensTiers} />}

          <div className="field-label">Status</div>
          <div className="ot-status-actions">
            {k.status === 'scheduled' && (
              <button type="button" className="stage-btn" onClick={() => setStatus('in_progress')} disabled={statusBusy}>
                Start surgery <small>in progress</small>
              </button>
            )}
            {k.status !== 'completed' && k.status !== 'cancelled' && (
              <button type="button" className="stage-btn amber" onClick={() => setStatus('completed')} disabled={statusBusy}>
                Mark completed
              </button>
            )}
            {k.status === 'completed' && (
              <button type="button" className="stage-btn" onClick={() => setStatus('scheduled')} disabled={statusBusy}>
                Reopen <small>back to scheduled</small>
              </button>
            )}
            {k.status !== 'cancelled' && (
              <button type="button" className="stage-btn danger" onClick={() => setStatus('cancelled')} disabled={statusBusy}>
                Cancel surgery
              </button>
            )}
            {k.status === 'cancelled' && (
              <button type="button" className="stage-btn" onClick={() => setStatus('scheduled')} disabled={statusBusy}>
                Re-schedule <small>same slot if still free</small>
              </button>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
