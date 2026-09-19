import { useEffect, useState } from 'react';

/* Small shared pieces for the Admin sections. */

export function ReorderBtns({ i, n, onMove, label }) {
  return (
    <div className="reorder-btns">
      <button
        className="reorder-btn"
        onClick={() => onMove(-1)}
        disabled={i === 0}
        aria-label={`Move ${label} up`}
        type="button"
      >
        ▲
      </button>
      <button
        className="reorder-btn"
        onClick={() => onMove(1)}
        disabled={i === n - 1}
        aria-label={`Move ${label} down`}
        type="button"
      >
        ▼
      </button>
    </div>
  );
}

/** Text input that keeps a local draft and commits on blur / Enter. */
export function EditableText({ value, onCommit, ariaLabel, className = '', placeholder }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => {
    if (draft !== (value ?? '')) onCommit(draft);
  };
  return (
    <input
      type="text"
      className={className}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value ?? '');
        }
      }}
    />
  );
}

/** Slugify a label into a medicine-type key: lowercase, dashes, ^[a-z0-9_-]+$. */
export function slugKey(label) {
  return (label || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
