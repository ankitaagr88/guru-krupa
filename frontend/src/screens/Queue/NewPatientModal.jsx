import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { reception as receptionApi, visits as visitsApi, errorMessage } from '../../api';
import { dobProblem, phoneKey } from '../../lib/format';
import DobAgeFields from '../Patient/DobAgeFields';
import { SamePhonePrompt, relationMissing, useRelations } from '../Patient/familyParts';
import ConditionGrid, { PillToggle, ElsewhereToggle } from './ConditionGrid';
import { LANGUAGES, SEXES, numOrNull, referralNeedsDetail } from './queueModel';
import PhoneInput from '../../components/PhoneInput';

/* Patient entry form (mockup `openModal` / `addNewPatient` and the np* drafts).
   `onSubmit(body)` receives the PatientIn payload; the caller creates the patient,
   registers the visit and closes the modal.
   Number already on file: once the phone has 10 digits we look up who is registered with it.
   That usually means a relative, so the form shows whose number it is and asks the new patient's
   relation to its owner (required; `familyOwnerId` + `relationKey` go with the body). "Use this
   patient" on a row registers today's visit for that existing record instead (`onRegistered` lets
   the queue reload); "Not related — separate patient" carries on without a family link.
   `preset` = {phone, ownerId, ownerName} opens it straight in "Add as a family member" (patient
   page); `submitLabel` / `title` change the wording there. */
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
};

export default function NewPatientModal({
  open,
  onClose,
  onSubmit,
  onRegistered,
  config,
  busy = false,
  preset = null,
  submitLabel = 'Add to queue',
  title = 'Patient entry form',
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
  const relations = useRelations();
  const presetPhone = preset?.phone || '';
  const presetOwnerId = preset?.ownerId ?? null;
  const presetOwnerName = preset?.ownerName || '';
  useEffect(() => {
    if (open) {
      const hasSelf = config.referralSources.some((r) => r.key === 'self');
      setD({
        ...EMPTY,
        phone: presetPhone,
        referralSource: hasSelf ? 'self' : config.referralSources[0]?.key || 'self',
      });
      setError('');
      setRelError('');
      setSame({ key: '', rows: [] });
      setDismissed('');
      setFam(
        presetOwnerId != null
          ? { key: phoneKey(presetPhone), ownerId: presetOwnerId, ownerName: presetOwnerName, relationKey: null }
          : null
      );
    }
  }, [open, config.referralSources, presetPhone, presetOwnerId, presetOwnerName]);

  const key = phoneKey(d.phone);
  useEffect(() => {
    if (!open || key.length < 10 || typeof receptionApi?.samePhone !== 'function') return undefined;
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
  }, [open, key]);
  const matches = key.length >= 10 && same.key === key && dismissed !== key ? same.rows : [];
  const famChoice = fam && fam.key === key ? fam : null; // typing another number drops the family choice

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const needsDetail = referralNeedsDetail(config.referralSources, d.referralSource);
  const firstStage = config.stages?.[0]?.key || 'reg';

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
      const v = await visitsApi.create({ patientId: m.id });
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

  const submit = () => {
    const name = d.name.trim();
    if (!name) {
      setError('At least a name is needed.');
      return;
    }
    if (dobProblem(d.dob)) return; // shown under the field
    const missing = relationMissing(famChoice);
    if (missing) {
      setRelError(missing);
      return;
    }
    onSubmit({
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
      note: '',
      referralSource: d.referralSource,
      referralDetail: needsDetail ? d.referralDetail.trim() : '',
      existingConditions: d.existingConditions.slice(),
      conditionOther: d.conditionOther.trim(),
      ...(famChoice ? { familyOwnerId: famChoice.ownerId, relationKey: famChoice.relationKey || null } : {}),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      id="modalOverlay"
      className="entry-modal"
      title={title}
      sub="Token number is given automatically. This is everything reception needs at first contact."
      actions={
        <>
          <button className="btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn-primary full" onClick={submit} type="button" disabled={busy} id="npSubmit">
            {busy ? 'Adding…' : submitLabel}
          </button>
        </>
      }
    >
      <div className="entry-scroll">
        <p className="label">Patient details</p>
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
        />
        {error && (
          <p className="hint" style={{ color: 'var(--alert-ink)', margin: '-4px 0 8px' }}>
            {error}
          </p>
        )}
        <PhoneInput id="npPhone" value={d.phone} onChange={(v) => set('phone', v)} />
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
        <DobAgeFields
          dob={d.dob}
          age={d.age}
          onDob={(v) => set('dob', v)}
          onAge={(v) => set('age', v)}
          idPrefix="np"
        />
        <div style={{ marginBottom: 10 }}>
          <PillToggle options={SEXES} value={d.sex} onChange={(v) => set('sex', v)} dataKey="sex" />
        </div>
        <input
          className="fake-input"
          id="npAddress"
          placeholder="Address (optional)"
          value={d.address}
          onChange={(e) => set('address', e.target.value)}
        />
        <div className="detail-grid" style={{ marginTop: 8, marginBottom: 10 }}>
          <input
            className="fake-input"
            id="npOccupation"
            placeholder="Occupation"
            value={d.occupation}
            onChange={(e) => set('occupation', e.target.value)}
            style={{ marginBottom: 0 }}
          />
          <input
            className="fake-input"
            id="npScreenHours"
            placeholder="Screen time (hrs/day)"
            value={d.screenHours}
            onChange={(e) => set('screenHours', e.target.value)}
            inputMode="decimal"
            style={{ marginBottom: 0 }}
          />
        </div>

        <p className="label" style={{ marginTop: 16 }}>
          Existing medical conditions
        </p>
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
        <input
          className="fake-input"
          id="npConditionOther"
          placeholder="Other condition (if any)"
          value={d.conditionOther}
          onChange={(e) => set('conditionOther', e.target.value)}
          style={{ marginTop: 6 }}
        />

        <p className="label" style={{ marginTop: 16 }}>
          Preferred language
        </p>
        <PillToggle
          options={LANGUAGES}
          value={d.language}
          onChange={(v) => set('language', v)}
          dataKey="lang"
        />

        <p className="label" style={{ marginTop: 16 }}>
          How did they hear about us?
        </p>
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
        {needsDetail && (
          <input
            className="fake-input"
            id="npReferralDetail"
            placeholder={d.referralSource === 'doctor' ? "Referring doctor's name" : 'Who referred them?'}
            value={d.referralDetail}
            onChange={(e) => set('referralDetail', e.target.value)}
            style={{ marginTop: 8 }}
          />
        )}

        <p className="label" style={{ marginTop: 16 }}>
          Treated at another hospital before?
        </p>
        <ElsewhereToggle
          on={d.elsewhere}
          note={d.elsewhereNote}
          noteId="npElsewhereNote"
          onToggle={() => set('elsewhere', !d.elsewhere)}
          onNote={(v) => set('elsewhereNote', v)}
        />
      </div>
    </Modal>
  );
}
