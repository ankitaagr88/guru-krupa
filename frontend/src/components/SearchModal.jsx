import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal';
import { patients as patientsApi } from '../api';

/* Global patient search (mockup `openSearchModal` / `renderSearchResults` /
   `jumpToPatient`). Opened with Ctrl+K, "/" or the topbar button.
   Picking a result navigates to /queue/:stage?patient=:id — the Queue
   screen reads `?patient=` and opens the drawer for that patient. */

export function jumpToPatientPath(p) {
  return `/queue/${p.stage}?patient=${p.id}`;
}

export default function SearchModal({ open, onClose, stages = [] }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [focus, setFocus] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setQ('');
      setResults([]);
      setFocus(0);
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await patientsApi.list({ q: query });
        if (!cancelled) {
          setResults((rows || []).slice(0, 10));
          setFocus(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const jump = (p) => {
    onClose?.();
    navigate(jumpToPatientPath(p));
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus((f) => Math.min(f + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocus((f) => Math.max(f - 1, 0));
    } else if (e.key === 'Enter' && results[focus]) {
      jump(results[focus]);
    }
  };

  const stageLabel = (key) => stages.find((s) => s.key === key)?.label || key;

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
        placeholder="Start typing…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      <div id="searchResultsList" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {q.trim() && results.length === 0 && <p className="search-empty">No matches</p>}
        {results.map((p, i) => (
          <div
            key={p.id}
            className={`search-result-row${i === focus ? ' focused' : ''}`}
            onClick={() => jump(p)}
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
    </Modal>
  );
}
