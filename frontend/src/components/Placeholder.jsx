import { useTopbar } from './AppShell';

/* Temporary screen body used until the owning agent lands the real screen. */
export default function Placeholder({ title, sub, owner, task, children }) {
  useTopbar({ sub });
  return (
    <div className="placeholder">
      <div className="placeholder-card">
        <h2>{title}</h2>
        <p>
          Coming soon — owned by {owner}
          {task ? ` (task ${task})` : ''}.
        </p>
        {children}
        <span className="status-pill teal owner">{owner}</span>
      </div>
    </div>
  );
}
