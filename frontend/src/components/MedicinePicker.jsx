import { useEffect, useId, useRef, useState } from 'react';
import { prescriptions } from '../api';
import './medicinePicker.css';

/* Searchable medicine picker (GET /medicines?q=). Shows the medicine name and
   nothing else (the list is names only, as in KiviHealth). Free text stays
   possible — the caller gets every keystroke via onChange and the picked master
   row via onPick.

     <MedicinePicker value={text} onChange={setText} onPick={(med) => …}
                     onEnter={() => addFreeText()} ariaLabel="Medicine name" />

   Keyboard: the first suggestion is highlighted as soon as the list shows; Enter or Tab
   picks the highlighted one, the arrow keys move. Pressing Enter before the suggestions
   have arrived waits for them, so "moxi" + Enter still picks "Moxifloxacin …".
   When `onEnter` is given, the list ends with an explicit "Add 'moxi' as typed" option —
   the only way to add text that doesn't match the list while suggestions are showing
   (with no suggestions at all, Enter adds what was typed).
   The list opens upward when there is no room under the box (e.g. at the bottom of a pop-up).

   `reloadKey` forces a refetch (e.g. after an admin adds a medicine). */

const DEBOUNCE_MS = 120;
const MAX_ROWS = 8;
const LIST_MAX_H = 260;

/** The one thing shown for a medicine: its name. */
export function medicineName(m) {
  return m?.name || m?.brand || m?.composition || '';
}

const norm = (v) => (v || '').trim().toLowerCase();
const isExact = (m, text) => {
  const t = norm(text);
  return !!t && [m?.name, m?.brand, m?.composition].some((x) => norm(x) === t);
};

/** The nearest box that clips its content (a pop-up, a drawer), else the window. */
function roomAround(el) {
  const r = el.getBoundingClientRect();
  let top = 0;
  let bottom = typeof window !== 'undefined' ? window.innerHeight : 800;
  let p = el.parentElement;
  while (p && p !== document.body) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'hidden') {
      const pr = p.getBoundingClientRect();
      top = Math.max(top, pr.top);
      bottom = Math.min(bottom, pr.bottom);
      break;
    }
    p = p.parentElement;
  }
  return { below: bottom - r.bottom, above: r.top - top };
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
  inputRef,
}) {
  const listId = useId();
  const [results, setResults] = useState([]);
  const [resultsFor, setResultsFor] = useState(''); // the query the results belong to
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [up, setUp] = useState(false);
  const seq = useRef(0);
  const focused = useRef(false);
  const wrapRef = useRef(null);
  const pendingEnter = useRef(false);

  const text = (value || '').trim();
  // The explicit "add as typed" row: only when the caller accepts free text and nothing matches exactly.
  const showTyped = !!onEnter && !!text && !results.some((m) => isExact(m, text));
  const options = [...results.map((m) => ({ med: m })), ...(showTyped ? [{ typed: true }] : [])];

  const pick = (m) => {
    setOpen(false);
    setHi(-1);
    onPick?.(m);
  };
  const addTyped = () => {
    setOpen(false);
    setHi(-1);
    onEnter?.();
  };
  const choose = (opt) => (opt?.typed ? addTyped() : opt?.med ? pick(opt.med) : null);

  /* Enter with results in hand: an exact match or the highlighted suggestion wins; the typed
     text only when there is nothing to suggest (or the "as typed" row is highlighted). */
  const commit = (rows, highlighted) => {
    const exact = rows.find((m) => isExact(m, value));
    if (exact) return pick(exact);
    if (highlighted >= 0 && highlighted < rows.length) return pick(rows[highlighted]);
    if (highlighted === rows.length && onEnter) return addTyped();
    if (rows.length && highlighted < 0) return pick(rows[0]);
    return onEnter?.();
  };

  useEffect(() => {
    const q = text;
    if (!q) {
      setResults([]);
      setResultsFor('');
      setHi(-1);
      pendingEnter.current = false;
      return undefined;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      let rows = [];
      try {
        rows = ((await prescriptions.medicines({ q })) || []).slice(0, MAX_ROWS);
      } catch {
        rows = [];
      }
      if (mine !== seq.current) return;
      setResults(rows);
      setResultsFor(q);
      setHi(rows.length ? 0 : onEnter ? 0 : -1);
      if (pendingEnter.current) {
        pendingEnter.current = false;
        commit(rows, rows.length ? 0 : -1);
        return;
      }
      if (focused.current) setOpen(true);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, reloadKey]);

  const showList = open && !!text && options.length > 0 && (results.length > 0 || showTyped);

  // Which way to open: down unless the box sits near the bottom of its pop-up / the screen.
  useEffect(() => {
    if (!showList || !wrapRef.current) return;
    const { below, above } = roomAround(wrapRef.current);
    setUp(below < Math.min(LIST_MAX_H, 60 + options.length * 38) && above > below);
  }, [showList, options.length]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault();
      setOpen(true);
      setHi((h) => (h + 1) % options.length);
    } else if (e.key === 'ArrowUp' && options.length) {
      e.preventDefault();
      setOpen(true);
      setHi((h) => (h <= 0 ? options.length - 1 : h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!text) return;
      if (resultsFor !== text) {
        // Suggestions for what was just typed are still on their way: decide when they land.
        pendingEnter.current = true;
        return;
      }
      if (showList && hi >= 0 && options[hi]) choose(options[hi]);
      else commit(results, -1);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      if (showList && hi >= 0 && options[hi]?.med) pick(options[hi].med);
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  return (
    <div className="med-picker" ref={wrapRef}>
      <input
        id={id}
        ref={inputRef}
        className={className}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={!!showList}
        aria-controls={listId}
        aria-activedescendant={showList && hi >= 0 ? `${listId}-o${hi}` : undefined}
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
        <ul
          className={`med-picker-list${up ? ' up' : ''}`}
          role="listbox"
          id={listId}
          aria-label="Medicines"
          data-testid="med-list"
        >
          {options.map((o, i) =>
            o.typed ? (
              <li
                key="__typed"
                id={`${listId}-o${i}`}
                role="option"
                aria-selected={i === hi}
                className={`med-picker-opt med-picker-typed${i === hi ? ' hi' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={addTyped}
                onMouseEnter={() => setHi(i)}
                data-testid="med-option-typed"
              >
                Add &ldquo;{text}&rdquo; as typed
                <span className="med-picker-sub">not from our medicine list</span>
              </li>
            ) : (
              <li
                key={o.med.id ?? o.med.name}
                id={`${listId}-o${i}`}
                role="option"
                aria-selected={i === hi}
                className={`med-picker-opt${i === hi ? ' hi' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.med)}
                onMouseEnter={() => setHi(i)}
                data-testid="med-option"
              >
                <div className="med-picker-main">
                  <b>{medicineName(o.med)}</b>
                </div>
              </li>
            )
          )}
        </ul>
      ) : null}
    </div>
  );
}
