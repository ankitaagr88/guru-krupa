import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import './drawer.css';

/* Slide-in drawer (mockup `openDrawer` / `closeDrawer`, `.drawer`).
   Always mounted so the slide animation runs; `open` toggles `.show`.
     <Drawer open={!!patient} name={p.name} patientId={p.id} meta={`${p.token} · 62F · Registration`}
             onClose={…} foot="Everything here saves on its own — nothing to submit.">
       …sections…
     </Drawer>
   `patientId` adds a "Patient record" link in the header (the name itself is plain text).
   `foot` is the footer that stays in view while the body scrolls: a line of text, or the
   drawer's actions (pass `footActions` = true for the button row style). `wide` lets the body
   use the drawer's full width on a big screen (two columns). While open, the footer's height
   is published as --drawer-clear so toasts sit above it. */
export default function Drawer({
  open,
  name,
  meta,
  onClose,
  children,
  foot,
  footActions = false,
  wide = false,
  id = 'drawer',
  patientId = null,
}) {
  const footRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Toasts keep clear of the open drawer's footer.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = footRef.current;
    if (!open || !el) return undefined;
    const place = () => {
      const top = el.getBoundingClientRect().top;
      if (top > 0) root.style.setProperty('--drawer-clear', `${Math.round(window.innerHeight - top + 12)}px`);
    };
    place();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    ro?.observe(el);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
      root.style.removeProperty('--drawer-clear');
    };
  }, [open, foot]);

  return (
    <>
      <div className={`overlay${open ? ' show' : ''}`} onClick={onClose} data-testid={`${id}-overlay`} />
      <aside className={`drawer${open ? ' show' : ''}${wide ? ' drawer-wide' : ''}`} id={id} aria-hidden={!open}>
        <div className="drawer-head">
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
          <div className="name">{name ?? '—'}</div>
          <div className="meta">
            {meta ?? '—'}
            {patientId && (
              <Link
                to={`/patients/${patientId}`}
                className="drawer-record-link"
                title="Open the patient's record: past visits, prescriptions, bills"
                data-testid="drawer-record-link"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5M9 13h6M9 17h4" />
                </svg>
                Patient record
              </Link>
            )}
          </div>
        </div>
        <div className="drawer-body">{open ? children : null}</div>
        {foot && (
          <div className={`drawer-foot${footActions ? ' drawer-foot-actions' : ''}`} ref={footRef}>
            {open || !footActions ? foot : null}
          </div>
        )}
      </aside>
    </>
  );
}
