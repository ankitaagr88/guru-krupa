import { ageSex, computeRowStatus } from '../lib/format';

/* Mobile queue card (mockup `patientCardHtml`). Desktop uses <QueueRow> inside
   #boardTable. Both share computeRowStatus(). `now` lets the queue ticker
   re-render every second without each card owning a timer. */

export function StatusPills({ status, note, tags }) {
  return (
    <>
      {status ? (
        <span className={`status-pill ${status.cls}`}>{status.text}</span>
      ) : note ? (
        <span className="status-note">{note}</span>
      ) : null}
      {tags.map((t, i) => (
        <span key={i} className={`status-pill ${t.cls}`}>
          {t.text}
        </span>
      ))}
    </>
  );
}

export default function PatientCard({ patient: p, stage, selected, onClick, now = Date.now() }) {
  const { status, note, tags, wait } = computeRowStatus(p, stage ?? p.stage, now);
  return (
    <div
      className={`patient-card${selected ? ' selected' : ''}`}
      onClick={() => onClick?.(p)}
      data-testid={`patient-card-${p.id}`}
    >
      <div className="pc-top">
        <div className="pc-name">{p.name}</div>
        <div className="pc-token">{p.token}</div>
      </div>
      <div className="pc-row">
        <span className="pc-label">Age/Sex</span>
        <span className="pc-val">{ageSex(p)}</span>
      </div>
      <div className="pc-row">
        <span className="pc-label">Phone</span>
        <span className="pc-val">{p.phone || '—'}</span>
      </div>
      <div className="pc-row">
        <span className="pc-label">Waiting</span>
        <span className="pc-val">
          <span className={`status-pill ${wait.cls}`}>{wait.text}</span>
        </span>
      </div>
      <div className="pc-status">
        <StatusPills status={status} note={note} tags={tags} />
      </div>
    </div>
  );
}

/** Desktop table row (mockup `rowHtml`). Use inside <table id="boardTable" className="data-table">. */
export function QueueRow({ patient: p, stage, selected, onClick, now = Date.now() }) {
  const { status, note, tags, wait } = computeRowStatus(p, stage ?? p.stage, now);
  return (
    <tr
      onClick={() => onClick?.(p)}
      className={selected ? 'row-selected' : undefined}
      data-testid={`queue-row-${p.id}`}
    >
      <td className="td-token">{p.token}</td>
      <td className="td-name">{p.name}</td>
      <td>{ageSex(p)}</td>
      <td>{p.phone || '—'}</td>
      <td>
        <span className={`status-pill ${wait.cls}`}>{wait.text}</span>
      </td>
      <td>
        <div className="status-cell">
          <StatusPills status={status} note={note} tags={tags} />
        </div>
      </td>
    </tr>
  );
}
