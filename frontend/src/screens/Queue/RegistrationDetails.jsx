import ConditionGrid, { PillToggle, ElsewhereToggle } from './ConditionGrid';
import { LANGUAGES, SEXES, numOrNull, referralNeedsDetail } from './queueModel';
import DobAgeFields from '../Patient/DobAgeFields';
import { ageFromDob, dobProblem } from '../../lib/format';

const hintStyle = { fontSize: 11, color: 'var(--ink-faint)', margin: '-4px 0 10px' };

/* Registration-stage "Patient details" block of the queue drawer (lane A owns this file).
   Everything autosaves through the drawer: `setField(key, value, {immediate})` for one field,
   `setDraft` + `queueSave(patch, {immediate})` when two fields change together. */
export default function RegistrationDetails({ draft, config, setField, setDraft, queueSave }) {
  const needsDetail = referralNeedsDetail(config.referralSources, draft.referralSource);
  return (
    <div id="elsewhereSection">
      <div className="field-label">Patient details</div>
      <input
        className="fake-input"
        id="detName"
        placeholder="Full name"
        value={draft.name || ''}
        onChange={(e) => setField('name', e.target.value)}
      />
      <input
        className="fake-input"
        id="detPhone"
        placeholder="Phone number"
        value={draft.phone || ''}
        onChange={(e) => setField('phone', e.target.value)}
        inputMode="tel"
      />
      <DobAgeFields
        dob={draft.dob || ''}
        age={draft.age}
        idPrefix="det"
        onDob={(v) => {
          if (!v) {
            // DOB cleared: keep the age it gave as the told age.
            const keep = ageFromDob(draft.dob) ?? numOrNull(draft.age, { int: true });
            setDraft((d) => ({ ...d, dob: '', age: keep ?? '' }));
            queueSave({ dob: null, age: keep });
          } else if (dobProblem(v)) {
            setDraft((d) => ({ ...d, dob: v })); // shown under the field, not saved
          } else {
            setDraft((d) => ({ ...d, dob: v, age: ageFromDob(v) }));
            queueSave({ dob: v });
          }
        }}
        onAge={(v) => setField('age', v)}
      />
      <PillToggle
        options={SEXES}
        value={draft.sex}
        onChange={(v) => setField('sex', v, { immediate: true })}
        dataKey="sex"
      />
      <input
        className="fake-input"
        id="detAddress"
        placeholder="Address"
        value={draft.address || ''}
        onChange={(e) => setField('address', e.target.value)}
        style={{ marginTop: 8 }}
      />
      <div className="detail-grid" style={{ marginTop: 8 }}>
        <input
          className="fake-input"
          id="detOccupation"
          placeholder="Occupation"
          value={draft.occupation || ''}
          onChange={(e) => setField('occupation', e.target.value)}
          style={{ marginBottom: 0 }}
        />
        <input
          className="fake-input"
          id="detScreenHours"
          placeholder="Screen time (hrs/day)"
          value={draft.screenHours ?? ''}
          onChange={(e) => setField('screenHours', e.target.value)}
          inputMode="decimal"
          style={{ marginBottom: 0 }}
        />
      </div>
      <div className="field-label">Existing medical conditions</div>
      <ConditionGrid
        conditions={config.conditions}
        selected={draft.existingConditions}
        onToggle={(c, on) => {
          const next = on
            ? [...new Set([...draft.existingConditions, c])]
            : draft.existingConditions.filter((x) => x !== c);
          setField('existingConditions', next, { immediate: true });
        }}
      />
      <input
        className="fake-input"
        id="detConditionOther"
        placeholder="Other condition (if any)"
        value={draft.conditionOther || ''}
        onChange={(e) => setField('conditionOther', e.target.value)}
        style={{ marginTop: 6 }}
      />

      <div className="field-label">Preferred language</div>
      <p className="hint" style={{ ...hintStyle, margin: '-4px 0 8px' }}>
        So the WhatsApp bot knows which language to use automatically next time this number messages.
      </p>
      <PillToggle
        options={LANGUAGES}
        value={draft.language}
        onChange={(v) => setField('language', v, { immediate: true })}
        dataKey="lang"
      />

      <div className="field-label">How did they hear about us?</div>
      <select
        className="drop-select"
        id="referralSelect"
        value={draft.referralSource || 'self'}
        onChange={(e) => {
          const v = e.target.value;
          const keep = referralNeedsDetail(config.referralSources, v);
          setDraft((d) => ({ ...d, referralSource: v, referralDetail: keep ? d.referralDetail : '' }));
          queueSave({ referralSource: v, ...(keep ? {} : { referralDetail: '' }) }, { immediate: true });
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
          id="referralDetail"
          placeholder={
            draft.referralSource === 'doctor' ? "Referring doctor's name" : 'Who referred them?'
          }
          value={draft.referralDetail || ''}
          onChange={(e) => setField('referralDetail', e.target.value)}
          style={{ marginTop: 8 }}
        />
      )}

      <div className="field-label">Treated at another hospital before?</div>
      <ElsewhereToggle
        on={!!draft.elsewhere}
        note={draft.elsewhereNote || ''}
        noteId="elsewhereNoteField"
        onToggle={() => setField('elsewhere', !draft.elsewhere, { immediate: true })}
        onNote={(v) => setField('elsewhereNote', v)}
      />
    </div>
  );
}
