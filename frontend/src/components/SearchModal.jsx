import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal';
import { IconSearch } from './Icons';
import { patients as patientsApi } from '../api';

/* Global patient search (mockup `openSearchModal` / `renderSearchResults` /
   `jumpToPatient`). Desktop/tablet: the always-visible box in the top bar
   (`TopbarSearch`, focused with "/" or Ctrl+K) drops the results under it.
   Phone: the magnifier opens this modal. Picking a result navigates to
   /queue/:stage?patient=:id — the Queue screen reads `?patient=` and opens
   the drawer for that patient. */

export const SEARCH_PLACEHOLDER = 'Search patients by name, phone or token';

export function jumpToPatientPath(p) {
  return `/queue/${p.stage}?patient=${p.id}`;
}

/** Debounced patient search: results for `q` (first 10) while `enabled`. */
function usePatientSearch(q, enabled) {
  const [results, setResults] = useState([]);
  useEffect(() => {
    const query = q.trim();
    if (!enabled || !query) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await patientsApi.list({ q: query });
        if (!cancelled) setResults((rows || []).slice(0, 10));
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, enabled]);
  return results;
}

/** Arrow keys move the highlight, Enter jumps. Returns [focus, setFocus, onKeyDown]. */
function useResultKeys(results, onPick) {
  const [focus, setFocus] = useState(0);
  useEffect(() => setFocus(0), [results]);
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus((f) => Math.min(f + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocus((f) => Math.max(f - 1, 0));
    } else if (e.key === 'Enter' && results[focus]) {
      onPick(results[focus]);
    }
  };
  return [focus, setFocus, onKeyDown];
}

function SearchResults({ query, results, focus, setFocus, onPick, stages, id }) {
  const stageLabel = (key) => stages.find((s) => s.key === key)?.label || key;
  return (
    <div id={id} className="search-results" role="listbox" aria-label="Matching patients">
      {query.trim() && results.length === 0 && <p className="search-empty">No matches</p>}
      {results.map((p, i) => (
        <div
          key={p.id}
          role="option"
          aria-selected={i === focus}
          className={`search-result-row${i === focus ? ' focused' : ''}`}
          // mousedown, not click: the top-bar box would otherwise blur and close the list first
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(p);
          }}
          onMouseEnter={() => setFocus(i)}
          data-testid={`search-result-${p.id}`}
        >
          <div>
            <div className="sr-name">{p.name}</div>
            <div className="sr-meta">
              {p.token}
              {p.phone ? ' · ' + p.phone : ''}
            </div>
          </div>
          <span className={`status-pill stage-${p.stage}`}>{stageLabel(p.stage)}</span>
        </div>
      ))}
    </div>
  );
}

/** The top-bar search box (desktop/tablet). The parent focuses it via the ref (`/`, Ctrl+K). */
export const TopbarSearch = forwardRef(function TopbarSearch({ stages = [] }, ref) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const results = usePatientSearch(q, open);
  const jump = (p) => {
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
    navigate(jumpToPatientPath(p));
  };
  const [focus, setFocus, onResultKeys] = useResultKeys(results, jump);
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setQ('');
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    onResultKeys(e);
  };

  return (
    <div className="topbar-search">
      <IconSearch />
      <input
        ref={inputRef}
        id="topbarSearch"
        type="search"
        placeholder={SEARCH_PLACEHOLDER}
        aria-label="Search patients"
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <kbd className="topbar-search-key" aria-hidden="true">
        /
      </kbd>
      {open && q.trim() && (
        <div className="topbar-search-panel">
          <SearchResults
            id="topbarSearchResults"
            query={q}
            results={results}
            focus={focus}
            setFocus={setFocus}
            onPick={jump}
            stages={stages}
          />
        </div>
      )}
    </div>
  );
});

export default function SearchModal({ open, onClose, stages = [] }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setQ('');
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  const results = usePatientSearch(q, open);
  const jump = (p) => {
    onClose?.();
    navigate(jumpToPatientPath(p));
  };
  const [focus, setFocus, onKeyDown] = useResultKeys(results, jump);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Find a patient"
      sub="Search by name, token, or phone — across every stage."
      style={{ width: 420 }}
      id="searchModalOverlay"
      actions={
        <button className="btn-ghost" onClick={onClose} style={{ flex: 1 }}>
          Close
        </button>
      }
    >
      <input
        ref={inputRef}
        className="fake-input"
        id="searchInput"
        placeholder={SEARCH_PLACEHOLDER}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        <SearchResults
          id="searchResultsList"
          query={q}
          results={results}
          focus={focus}
          setFocus={setFocus}
          onPick={jump}
          stages={stages}
        />
      </div>
    </Modal>
  );
}
