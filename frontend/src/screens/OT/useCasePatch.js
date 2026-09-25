import { useCallback, useEffect, useRef } from 'react';
import { ot as otApi, errorMessage } from '../../api';

/** Immutable deep set: setIn({a:{b:1}}, ['a','c'], 2) → {a:{b:1,c:2}} */
export function setIn(obj, path, value) {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const cur = obj && typeof obj === 'object' ? obj : {};
  return { ...cur, [head]: setIn(cur[head], rest, value) };
}

export function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const out = { ...(base || {}) };
  Object.keys(patch).forEach((k) => {
    const v = patch[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  });
  return out;
}

export const PATCH_DEBOUNCE_MS = 600;

/* Debounced partial PATCH for an OT case (mockup updateOtField / updateOtNested /
   updateOtRx, which mutated in place — "everything saves on its own").
   `edit(path, value)` updates the local copy at once and accumulates ONLY the
   changed keys, e.g. {postOp:{finalRx:{R:{sph:'-0.25'}}}}, which the backend
   deep-merges (lists such as billing.team replace). `editNow` flushes immediately (toggles,
   radios) and resolves with the saved case, or null when the save failed (`onError(message)`);
   `onSaved()` runs after every successful save. */
export function useCasePatch(caseObj, setCase, { onError, onSaved, debounceMs = PATCH_DEBOUNCE_MS } = {}) {
  const pending = useRef({});
  const timer = useRef(null);
  const idRef = useRef(caseObj?.id);
  idRef.current = caseObj?.id;
  const setCaseRef = useRef(setCase);
  setCaseRef.current = setCase;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (!idRef.current || Object.keys(patch).length === 0) return null;
    const run = otApi
      .update(idRef.current, patch)
      .then((updated) => {
        // Server copy wins, but keep anything typed while the request was in flight.
        setCaseRef.current((prev) => (prev && prev.id === updated.id ? deepMerge(updated, pending.current) : prev));
        onSavedRef.current?.();
        return updated;
      })
      .catch((err) => {
        // Put the failed keys back so a later edit retries them.
        pending.current = deepMerge(patch, pending.current);
        onErrorRef.current?.(errorMessage(err, 'Could not save'));
        return null;
      });
    return run;
  }, []);

  const edit = useCallback(
    (path, value) => {
      setCaseRef.current((prev) => (prev ? setIn(prev, path, value) : prev));
      pending.current = setIn(pending.current, path, value);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, debounceMs);
    },
    [flush, debounceMs]
  );

  const editNow = useCallback(
    (path, value) => {
      setCaseRef.current((prev) => (prev ? setIn(prev, path, value) : prev));
      pending.current = setIn(pending.current, path, value);
      return flush();
    },
    [flush]
  );

  // Flush whatever is still pending when the drawer closes / unmounts.
  useEffect(
    () => () => {
      if (Object.keys(pending.current).length) flush();
    },
    [flush]
  );

  return { edit, editNow, flush };
}
