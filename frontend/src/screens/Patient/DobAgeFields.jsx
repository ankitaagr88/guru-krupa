import { ageFromDob, dobProblem, localIso, MAX_AGE_YEARS } from '../../lib/format';
import './patient.css';

/* Date of birth + age, used by the new-patient form, the registration drawer and the patient
   record's edit form. The DOB is the real answer (the age then grows by itself); the age box is
   the fallback for when the DOB is not known, and shows the worked-out age once a DOB is typed.
   `dob` is 'YYYY-MM-DD' or ''; `age` is whatever was typed. */
export default function DobAgeFields({ dob, age, onDob, onAge, idPrefix = 'np' }) {
  const today = new Date();
  const problem = dobProblem(dob, today);
  const worked = !problem ? ageFromDob(dob, today) : null;
  const maxIso = localIso(today);
  const minIso = `${today.getFullYear() - MAX_AGE_YEARS}${maxIso.slice(4)}`;
  return (
    <div className="dob-age">
      <div className="dob-age-row">
        <label className="dob-age-field" htmlFor={`${idPrefix}Dob`}>
          <span className="dob-age-label">Date of birth</span>
          <input
            type="date"
            className={`fake-input num${problem ? ' error' : ''}`}
            id={`${idPrefix}Dob`}
            value={dob || ''}
            min={minIso}
            max={maxIso}
            onChange={(e) => onDob(e.target.value)}
          />
        </label>
        <label className="dob-age-field" htmlFor={`${idPrefix}Age`}>
          <span className="dob-age-label">Age (if DOB not known)</span>
          <input
            className="fake-input num"
            id={`${idPrefix}Age`}
            placeholder="Age"
            value={dob && worked != null ? worked : (age ?? '')}
            onChange={(e) => onAge(e.target.value)}
            inputMode="numeric"
            disabled={!!dob && worked != null}
            title={dob && worked != null ? 'Worked out from the date of birth' : undefined}
          />
        </label>
      </div>
      {worked != null && (
        <p className="dob-age-note" data-testid={`${idPrefix}-dob-age`}>
          Age <b className="num">{worked} y</b> from the date of birth
        </p>
      )}
      {problem && (
        <p className="dob-age-note err" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
