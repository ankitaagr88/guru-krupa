/* Existing-conditions checkbox grid (mockup `buildConditionGrid`). Controlled:
   `selected` is the array of checked labels, `onToggle(cond, checked)` reports changes. */
export default function ConditionGrid({ conditions, selected = [], onToggle, idPrefix = 'cond' }) {
  return (
    <div className="condition-grid">
      {conditions.map((c) => {
        const checked = selected.includes(c);
        return (
          <label key={c} className={`condition-item${checked ? ' checked' : ''}`}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onToggle(c, e.target.checked)}
              data-testid={`${idPrefix}-${c}`}
            />
            <span>{c}</span>
          </label>
        );
      })}
    </div>
  );
}

/** F / M / Other or language pill toggles (mockup `.sex-toggle`). */
export function PillToggle({ options, value, onChange, dataKey = 'value' }) {
  return (
    <div className="sex-toggle">
      {options.map((o) => {
        const key = typeof o === 'string' ? o : o.key;
        const label = typeof o === 'string' ? o : o.label;
        return (
          <button
            key={key}
            type="button"
            className={value === key ? 'active' : ''}
            onClick={() => onChange(key)}
            {...{ [`data-${dataKey}`]: key }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Treated-elsewhere switch row + expandable note box (mockup `toggleElsewhere`). */
export function ElsewhereToggle({ on, note, onToggle, onNote, noteId }) {
  return (
    <>
      <div className="toggle-row">
        <span>Patient brought earlier records</span>
        <button
          type="button"
          className={`switch${on ? ' on' : ''}`}
          onClick={onToggle}
          role="switch"
          aria-checked={on}
          aria-label="Treated at another hospital before"
        >
          <div className="knob" />
        </button>
      </div>
      <div className={`elsewhere-box${on ? ' show' : ''}`}>
        <div className="upload-hint">Tap to photograph prior prescription / report</div>
        <textarea
          className="fake-input"
          id={noteId}
          rows={2}
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="Or type what the patient tells you — e.g. cataract op, other city, 2 yrs ago"
          style={{ marginTop: 8 }}
        />
      </div>
    </>
  );
}
