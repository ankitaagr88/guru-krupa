/* Several diagnoses per visit (up to the Admin limit, `maxDiagnoses`): the picked ones as chips in
   the order picked (the first is the main one), × removes one, and an "Add diagnosis" picker shows
   while there is room. Used by the doctor's panel (queue drawer) and the prescription pop-up. */

const norm = (s) => String(s || '').trim().toLowerCase();

/** A visit's / prescription's diagnoses as [{id, name}] (older rows: only diagnosisId/Name). */
export function dxList(o) {
  if (Array.isArray(o?.diagnoses) && o.diagnoses.length) return o.diagnoses;
  return o?.diagnosisId != null ? [{ id: o.diagnosisId, name: o.diagnosisName || '' }] : [];
}

/** All the names joined with " · " (falls back to diagnosisName). */
export function dxNames(o) {
  const names = (Array.isArray(o?.diagnoses) ? o.diagnoses : []).map((d) => d.name).filter(Boolean);
  return names.length ? names.join(' · ') : o?.diagnosisName || '';
}

/** The standard's lines not already listed (by name, case-insensitive), in order, each once. */
export function missingLines(current, stdLines) {
  const seen = new Set((current || []).map((l) => norm(l.name)));
  return (stdLines || []).filter((l) => {
    const k = norm(l.name);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * picked  — [{id, name}] in order
 * all     — the active diagnoses [{id, name}]
 * max     — how many a visit may have
 * onChange(ids, addedId | null) — the new list of ids (addedId set when one was added)
 */
export default function DiagnosisChips({ inputId, picked, all, max = 3, onChange, disabled }) {
  const ids = picked.map((d) => d.id);
  const nameOf = (d) => d.name || all.find((x) => x.id === d.id)?.name || '(switched off)';
  const choices = all.filter((d) => !ids.includes(d.id));
  return (
    <div className="dx-multi">
      <div className="field-label">Diagnosis</div>
      {picked.length > 0 && (
        <div className="dx-chips" data-testid="dx-chips">
          {picked.map((d, i) => (
            <span
              key={d.id}
              className={`dx-chip${i === 0 && picked.length > 1 ? ' dx-main' : ''}`}
              data-testid="dx-chip"
              title={i === 0 && picked.length > 1 ? 'Main diagnosis' : undefined}
            >
              {nameOf(d)}
              <button
                type="button"
                aria-label={`Remove ${nameOf(d)}`}
                onClick={() => onChange(ids.filter((x) => x !== d.id), null)}
                disabled={disabled}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {ids.length < max && (
        <select
          id={inputId}
          className="drop-select"
          aria-label="Add diagnosis"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onChange([...ids, id], id);
          }}
          disabled={disabled}
        >
          <option value="">{ids.length ? '+ Add diagnosis' : 'Pick a diagnosis'}</option>
          {choices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
