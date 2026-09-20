import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import ConditionGrid, { PillToggle, ElsewhereToggle } from './ConditionGrid';
import { LANGUAGES, SEXES, numOrNull, referralNeedsDetail } from './queueModel';

/* Patient entry form (mockup `openModal` / `addNewPatient` and the np* drafts).
   `onSubmit(body)` receives the PatientIn payload; the caller creates the patient,
   registers the visit and closes the modal. */
const EMPTY = {
  name: '',
  phone: '',
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

export default function NewPatientModal({ open, onClose, onSubmit, config, busy = false }) {
  const [d, setD] = useState(EMPTY);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      const hasSelf = config.referralSources.some((r) => r.key === 'self');
      setD({ ...EMPTY, referralSource: hasSelf ? 'self' : config.referralSources[0]?.key || 'self' });
      setError('');
    }
  }, [open, config.referralSources]);

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const needsDetail = referralNeedsDetail(config.referralSources, d.referralSource);

  const submit = () => {
    const name = d.name.trim();
    if (!name) {
      setError('At least a name is needed.');
      return;
    }
    onSubmit({
      name,
      phone: d.phone.trim(),
      age: numOrNull(d.age, { int: true }),
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
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      id="modalOverlay"
      className="entry-modal"
      title="Patient entry form"
      sub="Token number is given automatically. This is everything reception needs at first contact."
      actions={
        <>
          <button className="btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn-primary full" onClick={submit} type="button" disabled={busy} id="npSubmit">
            {busy ? 'Adding…' : 'Add to queue'}
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
        <input
          className="fake-input"
          id="npPhone"
          placeholder="Phone number"
          value={d.phone}
          onChange={(e) => set('phone', e.target.value)}
          inputMode="tel"
        />
        <div className="detail-grid" style={{ marginBottom: 10 }}>
          <input
            className="fake-input"
            id="npAge"
            placeholder="Age"
            value={d.age}
            onChange={(e) => set('age', e.target.value)}
            inputMode="numeric"
            style={{ marginBottom: 0 }}
          />
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
