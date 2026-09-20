import { Link } from 'react-router-dom';

/* A patient's name, linking to their record (/patients/:id). Used wherever a
   name appears — table rows, cards, drawers — so the history is one click away.
   The click stays on the link (it does not also open the row's drawer). */
export default function PatientLink({ id, name, className = '', children }) {
  if (!id) return <span className={className}>{children ?? name}</span>;
  return (
    <Link
      to={`/patients/${id}`}
      className={`patient-link ${className}`.trim()}
      onClick={(e) => e.stopPropagation()}
      title="Open patient record"
      data-testid="patient-link"
    >
      {children ?? name}
    </Link>
  );
}
