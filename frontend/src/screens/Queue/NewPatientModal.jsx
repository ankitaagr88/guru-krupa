import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { reception as receptionApi, visits as visitsApi, errorMessage } from '../../api';
import { dobProblem, phoneKey } from '../../lib/format';
import DobAgeFields from '../Patient/DobAgeFields';
import { RelationSelect, SamePhonePrompt, relationMissing, useRelations } from '../Patient/familyParts';
import ConditionGrid, { PillToggle, ElsewhereToggle } from './ConditionGrid';
import { LANGUAGES, SEXES, numOrNull, referralNeedsDetail } from './queueModel';
import PhoneInput, { tenDigits } from '../../components/PhoneInput';

/* Patient entry form (mockup `openModal` / `addNewPatient` and the np* drafts) — a full-size form:
   two columns on a desktop, full screen on a phone, every field with a visible label, Enter saves.
   `onSubmit(body, extra)` receives the PatientIn payload (+ `extra` below); the caller creates the
   patient, registers the visit and closes the form. `body.note` is the reason for visit (the
   queue's complaint).

   Reception ("+ New patient"): number already on file → once the phone has 10 digits we look up
   who is registered with it. That usually means a relative, so the form shows whose number it is
   and asks the new patient's relation to its owner (required; `familyOwnerId` + `relationKey` go
   with the body). "Use this patient" on a row registers today's visit for that existing record
   instead (`onRegistered` lets the queue reload); "Not related — separate patient" carries on
   without a family link.

   Family mode — `preset` = {phone, ownerId, ownerName, relatedName?, address?, language?,
   referralSource?} (patient page › "Add family member"): we already know the family, so there is no
   same-phone box. The relation to the owner is asked first and is required; the shared things are
   filled in from the relative (phone — read-only with "Change", address, language, how they heard
   of us); name, age, sex and the rest start empty. "Also add to today's queue" (off by default,
   with a reason for visit) comes back as `extra = {addToQueue, note}`. */
const EMPTY = {
  name: '',
  phone: '',
  dob: '',
  age: '',
  sex: null,
  address: '',
  occupation: '',
  screenHours: '',
  existingConditions: [],
  conditionOther: '',
  language: null,
  referralSource: 'self',
  referralDetail: '',
  elsewhere: false,
  elsewhereNote: '',
  note: '',
};

/** A visible label over its field. */
function Field({ label, htmlFor, children, hint, className = '' }) {
  return (
    <div className={`np-field ${className}`}>
      <label className="np-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="np-hint">{hint}</p>}
    </div>
  );
}

export default function NewPatientModal({
  open,
  onClose,
  onSubmit,
  onRegistered,
  config,
  busy = false,
  preset = null,
  submitLabel,
  title,
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [d, setD] = useState(EMPTY);
  const [error, setError] = useState('');
  const [same, setSame] = useState({ key: '', rows: [] }); // same-phone lookup result
  const [dismissed, setDismissed] = useState(''); // phone key the person said "new patient" for
  const [using, setUsing] = useState(null); // patient id being registered
  // "Add as a family member": {key (the phone key it was chosen for), ownerId, ownerName, relationKey}
  const [fam, setFam] = useState(null);
  const [relError, setRelError] = useState('');
  const [phoneLocked, setPhoneLocked] = useState(false);
  const [addToQueue, setAddToQueue] = useState(false);
  const relations = useRelations();
  const familyMode = preset?.ownerId != null;
  const presetPhone = preset?.phone || '';
  const presetOwnerId = preset?.ownerId ?? null;
  const presetOwnerName = preset?.ownerName || '';
  const presetAddress = preset?.address || '';
  const presetLanguage = preset?.language || null;
  const presetReferral = preset?.referralSource || '';
  useEffect(() => {
    if (open) {
      const hasSelf = config.referralSources.some((r) => r.key === 'self');
      const fallbackRef = hasSelf ? 'self' : config.referralSources[0]?.key || 'self';
      const knownRef = presetReferral && config.referralSources.some((r) => r.key === presetReferral);
      setD({
        ...EMPTY,
        phone: presetPhone,
        // Family member: only what a household shares comes over from the relative.
        address: presetAddress,
        language: presetLanguage,
        referralSource: knownRef ? presetReferral : fallbackRef,
      });
      setError('');
      setRelError('');
      setSame({ key: '', rows: [] });
      setDismissed('');
      setPhoneLocked(presetOwnerId != null && !!presetPhone);
      setAddToQueue(false);
      setFam(
        presetOwnerId != null
          ? { key: phoneKey(presetPhone), ownerId: presetOwnerId, ownerName: presetOwnerName, relationKey: null }
          : null
      );
    }
  }, [open, config.referralSources, presetPhone, presetOwnerId, presetOwnerName, presetAddress, presetLanguage, presetReferral]);

  const key = phoneKey(d.phone);
  useEffect(() => {
    if (!open || familyMode || key.length < 10 || typeof receptionApi?.samePhone !== 'function') return undefined;
    let alive = true;
    const t = setTimeout(() => {
      receptionApi
        .samePhone(key)
        .then((rows) => alive && setSame({ key, rows: Array.isArray(rows) ? rows : [] }))
        .catch(() => {}); // the check is a convenience; the form still works without it
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, key, familyMode]);
  const matches = !familyMode && key.length >= 10 && same.key === key && dismissed !== key ? same.rows : [];
  // Reception: typing another number drops the family choice. Family mode: the family is fixed.
  const famChoice = familyMode ? fam : fam && fam.key === key ? fam : null;

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const needsDetail = referralNeedsDetail(config.referralSources, d.referralSource);
  const firstStage = config.stages?.[0]?.key || 'reg';
  const askReason = !familyMode || addToQueue;

  const showInQueue = (m, stageKey) => {
    onClose();
    navigate(`/queue/${stageKey || firstStage}?patient=${m.id}`);
  };

  const registerExisting = async (m) => {
    if (m.visitId) {
      showInQueue(m, m.stage);
      return;
    }
    setUsing(m.id);
    try {
      const v = await visitsApi.create({ patientId: m.id, note: d.note.trim() || undefined });
      toast.success(`${m.name} added to the queue`, v?.token ? `Token ${v.token}` : undefined);
      await onRegistered?.();
      showInQueue(m, v?.stageKey || v?.stage || firstStage);
    } catch (err) {
      if (err?.response?.status === 409) {
        // Registered a moment ago (another desk / double click): just open them.
        const fresh = await receptionApi.samePhone(key).catch(() => []);
        const now = (fresh || []).find((x) => x.id === m.id);
        toast.info(`${m.name} is already in today's queue`, now?.token ? `Token ${now.token}` : undefined);
        await onRegistered?.();
        showInQueue(m, now?.stage);
      } else {
        toast.error('Could not add to the queue', errorMessage(err));
      }
    } finally {
      setUsing(null);
    }
  };

  const submit = (e) => {
    e?.preventDefault?.();
    if (busy) return;
    const name = d.name.trim();
    if (!name) {
      setError('At least a name is needed.');
      document.getElementById('npName')?.focus();
      return;
    }
    if (dobProblem(d.dob)) return; // shown under the field
    const missing = familyMode
      ? famChoice && !famChoice.relationKey
        ? `Choose their relation to ${famChoice.ownerName}.`
        : ''
      : relationMissing(famChoice);
    if (missing) {
      setRelError(missing);
      return;
    }
    const note = askReason ? d.note.trim() : '';
    onSubmit(
      {
        name,
        phone: d.phone.trim(),
        dob: d.dob || null,
        age: d.dob ? null : numOrNull(d.age, { int: true }),
        sex: d.sex,
        address: d.address.trim(),
        occupation: d.occupation.trim(),
        screenHours: numOrNull(d.screenHours),
        language: d.language,
        elsewhere: d.elsewhere,
        elsewhereNote: d.elsewhereNote.trim(),
        note,
        referralSource: d.referralSource,
        referralDetail: needsDetail ? d.referralDetail.trim() : '',
        existingConditions: d.existingConditions.slice(),
        conditionOther: d.conditionOther.trim(),
        ...(famChoice ? { familyOwnerId: famChoice.ownerId, relationKey: famChoice.relationKey || null } : {}),
      },
      { addToQueue: familyMode ? addToQueue : true, note }
    );
  };

  if (!open) return null;
  const heading = title || (familyMode ? `New family member of ${preset?.relatedName || presetOwnerName}` : 'New patient');
  const saveLabel = submitLabel || (familyMode ? (addToQueue ? 'Save and add to queue' : 'Save family member') : 'Add to queue');

  const reasonField = (
    <Field label="Reason for visit" htmlFor="npNote">
      <input
        className="fake-input"
        id="npNote"
        placeholder="e.g. Blurred vision, 3 days"
        value={d.note}
        onChange={(e) => set('note', e.target.value)}
      />
    </Field>
  );

  return (
    <div
      className="modal-overlay show np-overlay"
      id="modalOverlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose?.();
      }}
    >
      <form
        className="modal entry-modal np-modal"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onSubmit={submit}
        noValidate
      >
        <div className="np-head">
          <h2>{heading}</h2>
        </div>

        {familyMode && famChoice && (
          <div className="np-family" data-testid="family-join">
            <RelationSelect
              id="npFamilyRelation"
              relations={relations}
              label={`Their relation to ${famChoice.ownerName}`}
              placeholder="Choose their relation"
              value={famChoice.relationKey}
              error={relError}
              onChange={(v) => {
                setFam((f) => ({ ...f, relationKey: v }));
                if (v) setRelError('');
              }}
            />
            <div className="np-field">
              <span className="np-label">Mobile number (the family’s)</span>
              {phoneLocked ? (
                <p className="np-phone-fixed">
                  <span className="num">+91 {tenDigits(d.phone).replace(/^(\d{5})(\d{5})$/, '$1 $2')}</span>
                  <button type="button" className="link-btn" onClick={() => setPhoneLocked(false)}>
                    Change
                  </button>
                </p>
              ) : (
                <PhoneInput id="npPhone" value={d.phone} onChange={(v) => set('phone', v)} />
              )}
            </div>
          </div>
        )}

        <div className="np-cols">
          <section className="np-col" aria-label="Patient details">
            <p className="np-section">Patient details</p>
            <Field label="Full name" htmlFor="npName">
              <input
                className={`fake-input${error ? ' error' : ''}`}
                id="npName"
                placeholder="Full name"
                value={d.name}
                onChange={(e) => {
                  set('name', e.target.value);
                  if (error) setError('');
                }}
                autoFocus
                autoComplete="off"
              />
              {error && (
                <p className="hint" role="alert" style={{ color: 'var(--alert-ink)', margin: '4px 0 0' }}>
                  {error}
                </p>
              )}
            </Field>
            {!familyMode && (
              <>
                <Field label="Mobile number" htmlFor="npPhone">
                  <PhoneInput id="npPhone" value={d.phone} onChange={(v) => set('phone', v)} />
                </Field>
                <SamePhonePrompt
                  matches={matches}
                  choice={famChoice}
                  onChoice={(c) => {
                    setFam(c ? { ...c, key } : null);
                    if (c?.relationKey) setRelError('');
                  }}
                  onDismiss={() => setDismissed(key)}
                  relations={relations}
                  relationError={relError}
                  renderUse={(m) => (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => registerExisting(m)}
                      disabled={using != null || busy}
                    >
                      {m.visitId ? "Open today's visit" : using === m.id ? 'Adding…' : 'Use this patient'}
                    </button>
                  )}
                />
              </>
            )}
            <DobAgeFields
              dob={d.dob}
              age={d.age}
              onDob={(v) => set('dob', v)}
              onAge={(v) => set('age', v)}
              idPrefix="np"
            />
            <div className="np-field">
              <span className="np-label">Sex</span>
              <PillToggle options={SEXES} value={d.sex} onChange={(v) => set('sex', v)} dataKey="sex" />
            </div>
            <Field label="Address / area" htmlFor="npAddress">
              <input
                className="fake-input"
                id="npAddress"
                placeholder="Address (optional)"
                value={d.address}
                onChange={(e) => set('address', e.target.value)}
              />
            </Field>
            <div className="detail-grid">
              <Field label="Occupation" htmlFor="npOccupation">
                <input
                  className="fake-input"
                  id="npOccupation"
                  placeholder="e.g. Teacher"
                  value={d.occupation}
                  onChange={(e) => set('occupation', e.target.value)}
                />
              </Field>
              <Field label="Screen time (hrs/day)" htmlFor="npScreenHours">
                <input
                  className="fake-input num"
                  id="npScreenHours"
                  placeholder="e.g. 6"
                  value={d.screenHours}
                  onChange={(e) => set('screenHours', e.target.value)}
                  inputMode="decimal"
                />
              </Field>
            </div>
            {!familyMode && reasonField}
          </section>

          <section className="np-col" aria-label="Health and background">
            <p className="np-section">Existing medical conditions</p>
            <ConditionGrid
              conditions={config.conditions}
              selected={d.existingConditions}
              idPrefix="np-cond"
              onToggle={(c, on) =>
                set(
                  'existingConditions',
                  on ? [...new Set([...d.existingConditions, c])] : d.existingConditions.filter((x) => x !== c)
                )
              }
            />
            <Field label="Other condition" htmlFor="npConditionOther" className="np-gap">
              <input
                className="fake-input"
                id="npConditionOther"
                placeholder="Other condition (if any)"
                value={d.conditionOther}
                onChange={(e) => set('conditionOther', e.target.value)}
              />
            </Field>

            <div className="np-field">
              <span className="np-label">Preferred language</span>
              <PillToggle
                options={LANGUAGES}
                value={d.language}
                onChange={(v) => set('language', v)}
                dataKey="lang"
              />
            </div>

            <Field label="How did they hear about us?" htmlFor="npReferralSelect">
              <select
                className="drop-select"
                id="npReferralSelect"
                value={d.referralSource}
                onChange={(e) => {
                  const v = e.target.value;
                  setD((x) => ({
                    ...x,
                    referralSource: v,
                    referralDetail: referralNeedsDetail(config.referralSources, v) ? x.referralDetail : '',
                  }));
                }}
              >
                {config.referralSources.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            {needsDetail && (
              <Field
                label={d.referralSource === 'doctor' ? "Referring doctor's name" : 'Who referred them?'}
                htmlFor="npReferralDetail"
              >
                <input
                  className="fake-input"
                  id="npReferralDetail"
                  placeholder={d.referralSource === 'doctor' ? "Referring doctor's name" : 'Who referred them?'}
                  value={d.referralDetail}
                  onChange={(e) => set('referralDetail', e.target.value)}
                />
              </Field>
            )}

            <div className="np-field">
              <span className="np-label">Treated at another hospital before?</span>
              <ElsewhereToggle
                on={d.elsewhere}
                note={d.elsewhereNote}
                noteId="npElsewhereNote"
                onToggle={() => set('elsewhere', !d.elsewhere)}
                onNote={(v) => set('elsewhereNote', v)}
              />
            </div>

            {familyMode && (
              <div className="np-queue">
                <label className="np-check">
                  <input
                    type="checkbox"
                    checked={addToQueue}
                    onChange={(e) => setAddToQueue(e.target.checked)}
                    data-testid="np-add-to-queue"
                  />
                  Also add to today&apos;s queue
                </label>
                {addToQueue && reasonField}
              </div>
            )}
          </section>
        </div>

        <div className="modal-actions np-actions">
          <button className="btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn-primary full" type="submit" disabled={busy} id="npSubmit">
            {busy ? 'Saving…' : saveLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
