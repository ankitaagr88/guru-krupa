import { useEffect } from 'react';

/* Right-hand slide-in drawer (mockup `openDrawer` / `closeDrawer`, `.drawer`).
   Always mounted so the slide animation runs; `open` toggles `.show`.
     <Drawer open={!!patient} name={p.name} meta={`${p.token} · 62F · Registration`}
             onClose={…} foot="Everything here saves on its own — nothing to submit.">
       …sections…
     </Drawer> */
export default function Drawer({ open, name, meta, onClose, children, foot, id = 'drawer' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={`overlay${open ? ' show' : ''}`} onClick={onClose} data-testid={`${id}-overlay`} />
      <aside className={`drawer${open ? ' show' : ''}`} id={id} aria-hidden={!open}>
        <div className="drawer-head">
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
          <div className="name">{name ?? '—'}</div>
          <div className="meta">{meta ?? '—'}</div>
        </div>
        <div className="drawer-body">{open ? children : null}</div>
        {foot && <div className="drawer-foot">{foot}</div>}
      </aside>
    </>
  );
}
