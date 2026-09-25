import { useCallback, useEffect, useRef, useState } from 'react';
import Drawer from '../../components/Drawer';
import { useAuth } from '../../auth/AuthContext';
import { ot as otApi, otTeam as otTeamApi, errorMessage } from '../../api';
import { PhotoTile } from '../Machines/ExamPhotos';
import { IconCamera, IconPaperclip } from '../../components/Icons';
import { useCasePatch } from './useCasePatch';
import SurgeryTimes from './SurgeryTimes';
import OtTeam, { memberLabel, rupees, sumFees, toDraft, toSaved } from './OtTeam';
import {
  ANESTHESIA,
  BIOMETRY_ROWS,
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

// The status follows the surgery times: an end time = Completed, a start time = In progress.
export const statusFromTimes = (start, end) => (end ? 'completed' : start ? 'in_progress' : 'scheduled');

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

function OperativeTab({ k, edit, canEdit, team }) {
  const o = k.operative || {};
  const ro = !canEdit;
  return (
    <>
      <div className="field-label" style={{ marginTop: 0 }}>
        OT team
      </div>
      <p className="small-note">
        Everyone in the theatre for this surgery. Tick &ldquo;Outside&rdquo; for a doctor who is not our staff (visiting
        surgeon, anaesthetist…) — they need their medical qualification. Fees go on the surgery&apos;s bill.
      </p>
      <OtTeam {...team} />

      <div className="field-label">Operative details</div>
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

function BillingTab({ k, editNow, lensTiers, teamRows, onTeamChange }) {
  const b = k.billing || {};
  const tier = lensTiers.find((t) => t.key === b.lensTier);
  const lensPrice = tier ? tier.price : (b.lensPrice ?? 0);
  // worked out here from the lens and the team as typed, so it follows the fee boxes at once
  const total = lensPrice + sumFees(teamRows);
  const named = teamRows.filter((r) => (r.name || '').trim());
  const setFee = (row, value) =>
    onTeamChange(teamRows.map((r) => (r._id === row._id ? { ...r, fee: Number(value.replace(/[^\d]/g, '')) || 0 } : r)));
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
      <div className="ot-bill-lines" data-testid="ot-bill-lines">
        <div className="ot-bill-line">
          <span>{tier ? tier.label : 'Lens'}</span>
          <span className="num" data-testid="ot-lens-price">
            {tier ? rupees(lensPrice) : 'not chosen'}
          </span>
        </div>
        {named.map((m) => (
          <div className="ot-bill-line" key={m._id} data-testid="ot-bill-team-line">
            <span>
              {memberLabel(m)}
              {m.qualification ? <small> · {m.qualification}</small> : null}
            </span>
            <label className="ot-team-fee">
              ₹
              <input
                className="fake-input num"
                inputMode="numeric"
                value={String(m.fee ?? 0)}
                onChange={(e) => setFee(m, e.target.value)}
                aria-label={`Fee for ${m.name}`}
              />
            </label>
          </div>
        ))}
        {named.length === 0 && (
          <p className="ot-save-note">No OT team yet — add the team on the Operative tab; their fees show here.</p>
        )}
      </div>
      <div className="bill-total" style={{ marginTop: 10 }}>
        <span>Total</span>
        <span data-testid="ot-total">{rupees(total)}</span>
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
  const isAdmin = currentUser?.role === 'admin';
  const [tab, setTab] = useState('preop');
  const [saveErr, setSaveErr] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [teamOptions, setTeamOptions] = useState({ roles: [], partners: [], staff: [] });
  const [teamRows, setTeamRows] = useState([]); // draft of billing.team (rows without a name are not saved yet)
  const onError = useCallback((msg) => setSaveErr(msg), []);
  const onSaved = useCallback(() => setSaveErr(''), []);
  const { edit, editNow, flush } = useCasePatch(caseObj, setCase, { onError, onSaved });

  useEffect(() => {
    setTab('preop');
    setSaveErr('');
    setTeamRows(toDraft(caseObj?.billing?.team));
    // only when another case is opened: the draft is the source while this one is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseObj?.id]);

  useEffect(() => {
    let alive = true;
    otTeamApi
      .options()
      .then((o) => alive && o && setTeamOptions(o))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const k = caseObj;
  const open = !!k;
  const st = OT_STATUS[k?.status] || { label: k?.status, cls: '' };

  const changeTeam = (rows) => {
    setTeamRows(rows);
    edit(['billing', 'team'], toSaved(rows));
  };
  const savePartner = async (row) => {
    try {
      const p = await otTeamApi.admin.createPartner({
        name: row.name,
        qualification: row.qualification,
        regNo: row.regNo,
        defaultRoleKey: row.roleKey || null,
        defaultFee: Number(row.fee) || 0,
      });
      setTeamOptions((o) => ({ ...o, partners: [...o.partners, p].sort((a, b) => a.name.localeCompare(b.name)) }));
      return p;
    } catch (ex) {
      setSaveErr(errorMessage(ex, 'Could not add to the outside-doctor list'));
      return null;
    }
  };

  /* Save both surgery times, then move the status to match (never on a cancelled case). */
  const onTimes = async (start, end) => {
    if (!k || k.status === 'cancelled') return;
    setStatusBusy(true);
    setSaveErr('');
    try {
      edit(['operative', 'startTime'], start);
      const saved = await editNow(['operative', 'endTime'], end);
      if (!saved) return; // not saved: the error is on screen
      const next = statusFromTimes(start, end);
      if (next !== saved.status) {
        const updated = await otApi.setStatus(k.id, next);
        setCase((prev) => (prev && prev.id === updated.id ? { ...prev, status: updated.status, updatedAt: updated.updatedAt } : prev));
        onStatus?.(updated);
      }
    } catch (ex) {
      setSaveErr(errorMessage(ex, 'Could not change status'));
    } finally {
      setStatusBusy(false);
    }
  };

  const reopen = () => {
    if (!window.confirm('Reopen this surgery? Its end time will be cleared, so it shows as not finished.')) return;
    onTimes(k.operative?.startTime || '', '');
  };

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
          {tab === 'operative' && (
            <OperativeTab
              k={k}
              edit={edit}
              canEdit={canEditClinical}
              team={{ rows: teamRows, options: teamOptions, onChange: changeTeam, isAdmin, onSavePartner: savePartner }}
            />
          )}
          {tab === 'consent' && <ConsentTab k={k} setCase={setCase} isMobile={isMobile} />}
          {tab === 'postop' && <PostOpTab k={k} edit={edit} canEdit={canEditClinical} />}
          {tab === 'billing' && (
            <BillingTab k={k} editNow={editNow} lensTiers={lensTiers} teamRows={teamRows} onTeamChange={changeTeam} />
          )}

          <div className="field-label">Status</div>
          <SurgeryTimes k={k} canEdit={canEditClinical} busy={statusBusy} onTimes={onTimes} />
          <div className="ot-status-actions">
            {k.status === 'completed' && canEditClinical && (
              <button type="button" className="stage-btn" onClick={reopen} disabled={statusBusy}>
                Reopen <small>clears the end time</small>
              </button>
            )}
            {k.status !== 'cancelled' && (
              <button type="button" className="stage-btn danger" onClick={() => setStatus('cancelled')} disabled={statusBusy}>
                Cancel surgery
              </button>
            )}
            {k.status === 'cancelled' && (
              <button
                type="button"
                className="stage-btn"
                onClick={() => setStatus(statusFromTimes(k.operative?.startTime, k.operative?.endTime))}
                disabled={statusBusy}
              >
                Re-schedule <small>same slot if still free</small>
              </button>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
