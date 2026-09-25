import ConditionGrid, { PillToggle, ElsewhereToggle } from './ConditionGrid';
import { LANGUAGES, SEXES, numOrNull, referralNeedsDetail } from './queueModel';
import DobAgeFields from '../Patient/DobAgeFields';
import RegistrationFamily from '../Patient/RegistrationFamily';
import { ageFromDob, dobProblem } from '../../lib/format';
import PhoneInput from '../../components/PhoneInput';

const hintStyle = { fontSize: 11, color: 'var(--ink-faint)', margin: '-4px 0 10px' };

/** A visible label over its field (placeholders are only examples). */
function Field({ label, htmlFor, children }) {
  return (
    <div className="reg-field">
      <label className="reg-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

/* Registration-stage "Patient details" block of the queue drawer (lane A owns this file).
   Everything autosaves through the drawer: `setField(key, value, {immediate})` for one field,
   `setDraft` + `queueSave(patch, {immediate})` when two fields change together.
   Under the phone: the family on that number (`patientId` = the visit's patient) — the relation
   to the number's owner, or "Part of the ... family?" when others already use the number.
   Every field has a visible label; "Reason for visit" is the visit's note (the queue's complaint). */
export default function RegistrationDetails({ draft, config, setField, setDraft, queueSave, patientId = null }) {
  const needsDetail = referralNeedsDetail(config.referralSources, draft.referralSource);
  return (
    <div id="elsewhereSection">
      <div className="field-label">Patient details</div>
      <Field label="Reason for visit" htmlFor="detNote">
        <input
          className="fake-input"
          id="detNote"
          placeholder="e.g. Blurred vision, 3 days"
          value={draft.note || ''}
          onChange={(e) => setField('note', e.target.value)}
        />
      </Field>
      <Field label="Full name" htmlFor="detName">
        <input
          className="fake-input"
          id="detName"
          placeholder="Full name"
          value={draft.name || ''}
          onChange={(e) => setField('name', e.target.value)}
        />
      </Field>
      <Field label="Mobile number" htmlFor="detPhone">
        <PhoneInput id="detPhone" value={draft.phone || ''} onChange={(v) => setField('phone', v)} />
      </Field>
      {patientId != null && <RegistrationFamily patientId={patientId} phone={draft.phone} />}
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
      <div className="reg-field">
        <span className="reg-label">Sex</span>
        <PillToggle
          options={SEXES}
          value={draft.sex}
          onChange={(v) => setField('sex', v, { immediate: true })}
          dataKey="sex"
        />
      </div>
      <Field label="Address / area" htmlFor="detAddress">
        <input
          className="fake-input"
          id="detAddress"
          placeholder="Address"
          value={draft.address || ''}
          onChange={(e) => setField('address', e.target.value)}
        />
      </Field>
      <div className="detail-grid">
        <Field label="Occupation" htmlFor="detOccupation">
          <input
            className="fake-input"
            id="detOccupation"
            placeholder="e.g. Teacher"
            value={draft.occupation || ''}
            onChange={(e) => setField('occupation', e.target.value)}
          />
        </Field>
        <Field label="Screen time (hrs/day)" htmlFor="detScreenHours">
          <input
            className="fake-input num"
            id="detScreenHours"
            placeholder="e.g. 6"
            value={draft.screenHours ?? ''}
            onChange={(e) => setField('screenHours', e.target.value)}
            inputMode="decimal"
          />
        </Field>
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
      <div style={{ marginTop: 8 }}>
        <Field label="Other condition" htmlFor="detConditionOther">
          <input
            className="fake-input"
            id="detConditionOther"
            placeholder="Other condition (if any)"
            value={draft.conditionOther || ''}
            onChange={(e) => setField('conditionOther', e.target.value)}
          />
        </Field>
      </div>

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
        <div style={{ marginTop: 8 }}>
          <Field
            label={draft.referralSource === 'doctor' ? "Referring doctor's name" : 'Who referred them?'}
            htmlFor="referralDetail"
          >
            <input
              className="fake-input"
              id="referralDetail"
              placeholder={draft.referralSource === 'doctor' ? 'e.g. Dr. Shah' : 'e.g. her brother'}
              value={draft.referralDetail || ''}
              onChange={(e) => setField('referralDetail', e.target.value)}
            />
          </Field>
        </div>
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
