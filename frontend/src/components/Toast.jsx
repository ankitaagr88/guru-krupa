import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import './toast.css';

/* Toasts — mockup's `pushToast(p, extraLine)` (dilation reminder, coral) and
   `pushLowStockToast(item)` (amber "Running low"). They sit at the bottom right (bottom centre
   above the tab bar on a phone, and above an open drawer's footer — see Drawer.jsx), so they never
   cover the top bar or a drawer's ✕.
   Ordinary toasts go away on their own after a few seconds (`timeout` ms; null = stays). The
   dilation reminder stays until someone acts on it and carries its own buttons
   (`actions: [{label, onClick, primary}]` — a click runs it and closes the toast). */

const ToastContext = createContext(null);

export const TOAST_MS = 5000;
const ERROR_MS = 8000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    ({ title, body, variant = 'alert', dismissLabel = 'Got it', timeout = TOAST_MS, key = null, actions = null }) => {
      const id = ++seq.current;
      setToasts((t) => {
        // De-dupe by key (e.g. one low-stock toast per item)
        const rest = key ? t.filter((x) => x.key !== key) : t;
        return [...rest, { id, key, title, body, variant, dismissLabel, actions }];
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
      /** mockup pushToast(p, extraLine). Stays until acted on; `actions` = its buttons
          (e.g. "Send to doctor", "Open"). */
      dilationDue: (p, extraLine, actions = null) =>
        push({
          title: 'Dilation wait is up',
          body: `${p.name} (${p.token}) — ${extraLine}`,
          variant: 'alert',
          key: `dil-${p.id}`,
          timeout: null,
          dismissLabel: 'Later',
          actions,
        }),
      /** mockup pushLowStockToast(item) */
      lowStock: (item) =>
        push({
          title: 'Running low',
          body: `${item.name} is down to ${item.stock} ${item.unit} — below the reorder point of ${item.reorder}.`,
          variant: 'low-stock',
          key: `low-${item.name}`,
          timeout: ERROR_MS,
        }),
      info: (title, body, timeout = 4000) =>
        push({ title, body, variant: 'info', timeout, dismissLabel: 'Got it' }),
      success: (title, body, timeout = 3500) =>
        push({ title, body, variant: 'success', timeout, dismissLabel: 'Got it' }),
      error: (title, body, timeout = ERROR_MS) => push({ title, body, variant: 'alert', dismissLabel: 'Dismiss', timeout }),
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" id="toastStack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.variant}`} role="status" data-testid="toast">
            <div className="t-title">{t.title}</div>
            {t.body && <div className="t-body">{t.body}</div>}
            <div className="t-actions">
              {(t.actions || []).map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`t-action${a.primary ? ' primary' : ''}`}
                  onClick={() => {
                    dismiss(t.id);
                    a.onClick?.();
                  }}
                >
                  {a.label}
                </button>
              ))}
              <button type="button" className="t-dismiss" onClick={() => dismiss(t.id)}>
                {t.dismissLabel}
              </button>
            </div>
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
