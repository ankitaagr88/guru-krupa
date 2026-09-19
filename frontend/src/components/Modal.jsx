import { useEffect } from 'react';

/* Centered modal (mockup `.modal-overlay` / `.modal`). Renders nothing when
   closed. Esc and backdrop click call onClose.
     <Modal open title="New appointment" sub="…" onClose={…}
            actions={<><button className="btn-ghost">Cancel</button><button className="btn-primary full">Save</button></>}>
       …fields…
     </Modal>
   `className` extends `.modal` (e.g. "entry-modal", "rx-modal"). */
export default function Modal({
  open,
  title,
  sub,
  onClose,
  children,
  actions,
  className = '',
  style,
  id,
  closeOnBackdrop = true,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="modal-overlay show"
      id={id}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className={`modal ${className}`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
      >
        {title && <h2>{title}</h2>}
        {sub && <p className="sub">{sub}</p>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
