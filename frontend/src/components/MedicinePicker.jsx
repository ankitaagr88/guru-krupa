import { useEffect, useId, useRef, useState } from 'react';
import { prescriptions } from '../api';
import './medicinePicker.css';

/* Searchable medicine picker (GET /medicines?q=). Shows the medicine name and
   nothing else (the list is names only, as in KiviHealth). Free text stays
   possible — the caller gets every keystroke via onChange and the picked master
   row via onPick.

     <MedicinePicker value={text} onChange={setText} onPick={(med) => …}
                     onEnter={() => addFreeText()} ariaLabel="Medicine name" />

   `reloadKey` forces a refetch (e.g. after an admin adds a medicine). */

const DEBOUNCE_MS = 120;
const MAX_ROWS = 8;

/** The one thing shown for a medicine: its name. */
export function medicineName(m) {
  return m?.name || m?.brand || m?.composition || '';
}

export default function MedicinePicker({
  value,
  onChange,
  onPick,
  onEnter,
  placeholder = 'Search medicine…',
  ariaLabel = 'Medicine name',
  id,
  className = 'med-search',
  reloadKey = 0,
  autoFocus = false,
  disabled = false,
}) {
  const listId = useId();
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const seq = useRef(0);
  const focused = useRef(false);

  useEffect(() => {
    const q = (value || '').trim();
    if (!q) {
      setResults([]);
      setHi(-1);
      return undefined;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const rows = await prescriptions.medicines({ q });
        if (mine !== seq.current) return;
        setResults((rows || []).slice(0, MAX_ROWS));
        setHi(-1);
        if (focused.current) setOpen(true);
      } catch {
        if (mine === seq.current) setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, reloadKey]);

  const pick = (m) => {
    setOpen(false);
    setHi(-1);
    onPick?.(m);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setOpen(true);
      setHi((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setHi((h) => (h <= 0 ? results.length - 1 : h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && hi >= 0 && results[hi]) pick(results[hi]);
      else onEnter?.();
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  const showList = open && results.length > 0 && (value || '').trim();

  return (
    <div className="med-picker">
      <input
        id={id}
        className={className}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={!!showList}
        aria-controls={listId}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          focused.current = true;
          if (results.length) setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
          // let a click on an option land first
          setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul className="med-picker-list" role="listbox" id={listId} aria-label="Medicines">
          {results.map((m, i) => (
            <li
              key={m.id ?? m.name}
              role="option"
              aria-selected={i === hi}
              className={`med-picker-opt${i === hi ? ' hi' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(m)}
              onMouseEnter={() => setHi(i)}
              data-testid="med-option"
            >
              <div className="med-picker-main">
                <b>{medicineName(m)}</b>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
