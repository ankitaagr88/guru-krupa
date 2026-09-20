import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/* Toasts — mockup's `pushToast(p, extraLine)` (dilation reminder, coral) and
   `pushLowStockToast(item)` (amber "Running low"). Toasts persist until
   dismissed unless `timeout` (ms) is given. */

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    ({ title, body, variant = 'alert', dismissLabel = 'Got it', timeout = null, key = null }) => {
      const id = ++seq.current;
      setToasts((t) => {
        // De-dupe by key (e.g. one low-stock toast per item)
        const rest = key ? t.filter((x) => x.key !== key) : t;
        return [...rest, { id, key, title, body, variant, dismissLabel }];
      });
      if (timeout) setTimeout(() => dismiss(id), timeout);
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      push,
      dismiss,
      clear: () => setToasts([]),
      /** mockup pushToast(p, extraLine) */
      dilationDue: (p, extraLine) =>
        push({
          title: 'Dilation wait is up',
          body: `${p.name} (${p.token}) — ${extraLine}`,
          variant: 'alert',
          key: `dil-${p.id}`,
        }),
      /** mockup pushLowStockToast(item) */
      lowStock: (item) =>
        push({
          title: 'Running low',
          body: `${item.name} is down to ${item.stock} ${item.unit} — below the reorder point of ${item.reorder}.`,
          variant: 'low-stock',
          key: `low-${item.name}`,
        }),
      info: (title, body, timeout = 4000) =>
        push({ title, body, variant: 'info', timeout, dismissLabel: 'Got it' }),
      success: (title, body, timeout = 3500) =>
        push({ title, body, variant: 'success', timeout, dismissLabel: 'Got it' }),
      error: (title, body) => push({ title, body, variant: 'alert', dismissLabel: 'Dismiss' }),
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" id="toastStack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.variant}`} role="status">
            <div className="t-title">{t.title}</div>
            {t.body && <div className="t-body">{t.body}</div>}
            <button className="t-dismiss" onClick={() => dismiss(t.id)}>
              {t.dismissLabel}
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
