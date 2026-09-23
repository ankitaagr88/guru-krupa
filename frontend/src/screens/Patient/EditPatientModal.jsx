import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import { patients as patientsApi, errorMessage } from '../../api';
import { ageFromDob, dobProblem } from '../../lib/format';
import ConditionGrid, { PillToggle } from '../Queue/ConditionGrid';
import { LANGUAGES, SEXES, numOrNull } from '../Queue/queueModel';
import useConfig from '../Queue/useConfig';
import DobAgeFields from './DobAgeFields';

/* "Edit details" on the patient record: the person's own details (not a visit's).
   Saves with one PATCH and hands the saved patient to `onSaved`. */
function fromPatient(p) {
  return {
    name: p.name || '',
    phone: p.phone || '',
    dob: p.dob ? String(p.dob).slice(0, 10) : '',
    age: p.age ?? '',
    sex: p.sex || null,
    address: p.address || '',
    occupation: p.occupation || '',
    language: p.language || null,
    existingConditions: [...(p.existingConditions || [])],
    conditionOther: p.conditionOther || '',
  };
}

export default function EditPatientModal({ open, patient, onClose, onSaved }) {
  const config = useConfig();
  const [d, setD] = useState(() => fromPatient(patient || {}));
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open && patient) {
      setD(fromPatient(patient));
      setErr('');
    }
  }, [open, patient]);

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const name = d.name.trim();
    if (!name) {
      setErr('The name cannot be empty.');
      return;
    }
    const problem = dobProblem(d.dob);
    if (problem) {
      setErr(problem);
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const saved = await patientsApi.update(patient.id, {
        name,
        phone: d.phone.trim() || null,
        dob: d.dob || null,
        // With a DOB the server works the age out; without one this is the told age.
        age: d.dob ? ageFromDob(d.dob) : numOrNull(d.age, { int: true }),
        sex: d.sex,
        address: d.address.trim() || null,
        occupation: d.occupation.trim() || null,
        language: d.language,
        existingConditions: d.existingConditions.slice(),
        conditionOther: d.conditionOther.trim(),
      });
      onSaved?.(saved);
    } catch (e) {
      setErr(errorMessage(e, 'Could not save the details'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      id="editPatientModal"
      className="entry-modal patient-edit"
      title="Edit patient details"
      sub="Changes apply to this person's record, for every visit."
      actions={
        <>
          <button className="btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn-primary full" onClick={save} type="button" disabled={saving}>
            {saving ? 'Saving…' : 'Save details'}
          </button>
        </>
      }
    >
      <div className="entry-scroll">
        <p className="label">Name and phone</p>
        <input
          className="fake-input"
          id="edName"
          aria-label="Full name"
          placeholder="Full name"
          value={d.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <input
          className="fake-input num"
          id="edPhone"
          aria-label="Phone number"
          placeholder="Phone number"
          value={d.phone}
          onChange={(e) => set('phone', e.target.value)}
          inputMode="tel"
        />
        <p className="label" style={{ marginTop: 8 }}>
          Age
        </p>
        <DobAgeFields
          dob={d.dob}
          age={d.age}
          idPrefix="ed"
          onDob={(v) => setD((x) => ({ ...x, dob: v, age: v ? x.age : (ageFromDob(x.dob) ?? x.age) }))}
          onAge={(v) => set('age', v)}
        />
        <div style={{ marginBottom: 10 }}>
          <PillToggle options={SEXES} value={d.sex} onChange={(v) => set('sex', v)} dataKey="sex" />
        </div>
        <input
          className="fake-input"
          id="edAddress"
          aria-label="Address"
          placeholder="Address"
          value={d.address}
          onChange={(e) => set('address', e.target.value)}
        />
        <input
          className="fake-input"
          id="edOccupation"
          aria-label="Occupation"
          placeholder="Occupation"
          value={d.occupation}
          onChange={(e) => set('occupation', e.target.value)}
        />

        <p className="label" style={{ marginTop: 16 }}>
          Preferred language
        </p>
        <PillToggle options={LANGUAGES} value={d.language} onChange={(v) => set('language', v)} dataKey="lang" />

        <p className="label" style={{ marginTop: 16 }}>
          Existing medical conditions
        </p>
        <ConditionGrid
          conditions={config.conditions}
          selected={d.existingConditions}
          idPrefix="ed-cond"
          onToggle={(c, on) =>
            set(
              'existingConditions',
              on ? [...new Set([...d.existingConditions, c])] : d.existingConditions.filter((x) => x !== c)
            )
          }
        />
        <input
          className="fake-input"
          id="edConditionOther"
          aria-label="Other condition"
          placeholder="Other condition (if any)"
          value={d.conditionOther}
          onChange={(e) => set('conditionOther', e.target.value)}
          style={{ marginTop: 6 }}
        />
        {err && (
          <p className="patient-edit-err" role="alert">
            {err}
          </p>
        )}
      </div>
    </Modal>
  );
}
